import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
import { constants as zlibConstants } from 'node:zlib';
import { paymentMethodsFor, productionConfigurationErrors } from './production-config.js';

const app = express();
const PORT = Number(process.env.PORT || 4173);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_SITE_URL = 'https://samaraorganics.in';
const inlineScriptHashes = new Set();
for (const filename of readdirSync(ROOT).filter(name => name.endsWith('.html'))) {
  const html = readFileSync(join(ROOT, filename), 'utf8');
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) inlineScriptHashes.add(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  }
}
const INLINE_SCRIPT_CSP = [...inlineScriptHashes].join(' ');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || (IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1');

const PRODUCTS_INFO = Object.create(null);
async function refreshProductCatalog() {
  const products = await dbAll('SELECT product_name, price, unit, active, sort_order, updated_at FROM catalog_products ORDER BY sort_order, product_name');
  for (const name of Object.keys(PRODUCTS_INFO)) delete PRODUCTS_INFO[name];
  for (const product of products) PRODUCTS_INFO[product.product_name] = { price: product.price, unit: product.unit, active: Boolean(product.active), sortOrder: product.sort_order, updatedAt: product.updated_at };
  return PRODUCTS_INFO;
}
const structuredProductDetails = new Map([
  ['Organic A2 Milk', { name: 'Farm Fresh Milk', image: 'assets/samara-heritage-milk.jpg', anchor: 'milk' }],
  ['Bilona Desi Ghee', { name: 'Bilona Desi Ghee', image: 'assets/samara-heritage-ghee.jpg', anchor: 'ghee' }],
  ['Traditional Dahi', { name: 'Traditional Dahi', image: 'assets/samara-heritage-dahi.jpg', anchor: 'dahi' }]
]);
function siteStructuredData(inventoryRows = []) {
  const inventory = new Map(inventoryRows.map(row => [row.product_name, Number(row.available_qty) || 0]));
  const products = [...structuredProductDetails].map(([catalogueName, details]) => {
    const product = PRODUCTS_INFO[catalogueName] || {};
    const available = Boolean(product.active) && (inventory.get(catalogueName) || 0) > 0;
    const productUrl = `${PUBLIC_SITE_URL}/products.html#${details.anchor}`;
    return {
      '@type': 'Product', '@id': `${PUBLIC_SITE_URL}/products.html#product-${details.anchor}`, name: details.name,
      brand: { '@type': 'Brand', name: 'Samara Organics' }, category: 'Dairy',
      image: `${PUBLIC_SITE_URL}/${details.image}`,
      offers: {
        '@type': 'Offer', url: productUrl, price: Number(product.price) || 0,
        priceCurrency: 'INR', availability: `https://schema.org/${available ? 'InStock' : 'OutOfStock'}`,
        itemCondition: 'https://schema.org/NewCondition', seller: { '@id': `${PUBLIC_SITE_URL}/#business` }
      }
    };
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'LocalBusiness', '@id': `${PUBLIC_SITE_URL}/#business`, name: 'Samara Organics', url: `${PUBLIC_SITE_URL}/`,
        image: `${PUBLIC_SITE_URL}/assets/samara-heritage-hero.jpg`, logo: `${PUBLIC_SITE_URL}/assets/samara-heritage-logo.jpg`,
        description: 'Farm-fresh, locally handled dairy with transparent batch records serving Aligarh, Bulandshahr and nearby communities.',
        telephone: '+91-8077366897', email: 'samaraorganics.india@gmail.com',
        address: { '@type': 'PostalAddress', streetAddress: 'Kothi Lalarukh, Above Union Bank of India, Civil Lines, Medical Road', addressLocality: 'Aligarh', addressRegion: 'Uttar Pradesh', addressCountry: 'IN' },
        areaServed: ['Aligarh', 'Bulandshahr', 'Khurja'], sameAs: ['https://instagram.com/samaraorganics.india']
      },
      ...products,
      {
        '@type': 'FAQPage', mainEntity: [
          { '@type': 'Question', name: 'Where will you deliver first?', acceptedAnswer: { '@type': 'Answer', text: 'Initial routes are planned around Aligarh, Bulandshahr, Khurja and nearby communities.' } },
          { '@type': 'Question', name: 'How will Samara prove quality?', acceptedAnswer: { '@type': 'Answer', text: 'Samara is designing batch-level quality information covering source, collection timing, core checks and handling.' } },
          { '@type': 'Question', name: 'Which products are launching?', acceptedAnswer: { '@type': 'Answer', text: 'Farm fresh milk, naturally set dahi and bilona desi ghee are planned first.' } },
          { '@type': 'Question', name: 'Can I reserve a subscription now?', acceptedAnswer: { '@type': 'Answer', text: 'Customers can join the first-delivery list and will be contacted when their route opens.' } }
        ]
      }
    ]
  };
}
const DELIVERY_SLOTS = new Set(['Morning (6:00 AM - 9:00 AM)', 'Evening (6:00 PM - 9:00 PM)']);
// Checkout creates one delivery only. Recurring commitments belong exclusively
// to /api/subscriptions so the first occurrence cannot be duplicated in both tables.
const DELIVERY_SCHEDULES = new Set(['one-time']);
const SUBSCRIPTION_SCHEDULES = new Set(['daily', 'alternate', 'weekend', 'custom']);
const PAYMENT_PROVIDER_ENABLED = process.env.PAYMENT_PROVIDER_ENABLED === '1';
const PAYMENT_METHODS = new Set(paymentMethodsFor(process.env));
const ORDER_STATUSES = new Set(['Pending', 'Awaiting Payment Verification', 'Confirmed', 'Out for Delivery', 'Delivered', 'Cancelled', 'Payment Failed']);
const ORDER_TRANSITIONS = new Map([
  ['Pending', new Set(['Confirmed', 'Cancelled'])],
  ['Awaiting Payment Verification', new Set(['Confirmed', 'Payment Failed', 'Cancelled'])],
  ['Confirmed', new Set(['Out for Delivery', 'Cancelled'])],
  ['Out for Delivery', new Set(['Delivered'])],
  ['Delivered', new Set()],
  ['Cancelled', new Set()],
  ['Payment Failed', new Set()]
]);
const SUPPORT_CATEGORIES = new Set(['Delivery', 'Payment', 'Product Quality', 'Subscription', 'Refund', 'Privacy', 'Other']);
const SUPPORT_STATUSES = new Set(['Received', 'In Review', 'Waiting for Customer', 'Resolved', 'Closed']);
const SERVICEABLE_PREFIXES = (process.env.SERVICEABLE_PIN_PREFIXES || '202,203').split(',').map(value => value.trim()).filter(Boolean).sort((left, right) => right.length - left.length);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const IDEMPOTENCY_ENCRYPTION_SECRET = process.env.IDEMPOTENCY_ENCRYPTION_KEY;
const ERROR_MONITORING_WEBHOOK_URL = process.env.ERROR_MONITORING_WEBHOOK_URL;
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
const localOrigins = IS_PRODUCTION ? [] : [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
const allowedOrigins = new Set([...configuredOrigins, ...localOrigins]);

if (IS_PRODUCTION) {
  const configurationErrors = productionConfigurationErrors(process.env);
  if (configurationErrors.length) {
    console.error(`Production configuration is invalid:\n- ${configurationErrors.join('\n- ')}`);
    process.exit(1);
  }
}

// Validate production secrets before opening persistent storage. This keeps a
// misconfigured deployment fail-closed even when its database is unavailable.
const { dbGet, dbRun, dbAll, dbTransaction, dbExclusive, databaseReady, closeDatabase } = await import('./database.js');

const requestContext = new AsyncLocalStorage();
const redactRequestPath = path => String(path || '')
  .replace(/(\/api\/orders\/track\/)[^/]+/i, '$1:private-reference')
  .replace(/(\/api\/subscriptions\/manage\/)[^/]+/i, '$1:private-reference')
  .replace(/(\/api\/support\/tickets\/)[^/]+/i, '$1:private-reference');
function reportError(context, error, metadata = {}) {
  const event = {
    type: 'error',
    service: 'samara-api',
    context,
    requestId: requestContext.getStore()?.requestId,
    error: { name: error?.name || 'Error', message: String(error?.message || error || 'Unknown error').slice(0, 500) },
    metadata,
    timestamp: new Date().toISOString()
  };
  console.error(JSON.stringify(event));
  if (ERROR_MONITORING_WEBHOOK_URL) fetch(ERROR_MONITORING_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) }).catch(monitoringError => {
    console.error(JSON.stringify({ type: 'monitoring-delivery-error', message: String(monitoringError?.message || monitoringError).slice(0, 300), timestamp: new Date().toISOString() }));
  });
  return event;
}

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(compression({ threshold: 1024, brotli: { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } } }));

app.use((request, response, next) => {
  const suppliedId = request.get('x-request-id');
  request.id = suppliedId && /^[a-zA-Z0-9._-]{8,80}$/.test(suppliedId) ? suppliedId : randomUUID();
  response.setHeader('X-Request-ID', request.id);
  const startedAt = process.hrtime.bigint();
  response.on('finish', () => {
    if (!request.path.startsWith('/api/')) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(JSON.stringify({ type: 'request', requestId: request.id, method: request.method, path: redactRequestPath(request.path), status: response.statusCode, durationMs: Number(durationMs.toFixed(1)) }));
  });
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Content-Security-Policy', `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' ${INLINE_SCRIPT_CSP}; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://wa.me`);
  if (IS_PRODUCTION && request.secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  requestContext.run({ requestId: request.id }, next);
});

app.use(cors({
  credentials: false,
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed.'));
  }
}));
app.use(express.json({
  limit: '64kb',
  verify(request, _response, buffer) { request.rawBody = Buffer.from(buffer); }
}));

function rateLimit({ windowMs, max, label }) {
  const requests = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests) if (now >= record.resetAt) requests.delete(key);
  }, windowMs);
  cleanup.unref?.();
  return (request, response, next) => {
    const now = Date.now();
    const key = `${request.ip}:${label}`;
    const record = requests.get(key);
    if (!record || now >= record.resetAt) {
      requests.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > max) {
      response.setHeader('Retry-After', Math.ceil((record.resetAt - now) / 1000));
      return response.status(429).json({ success: false, message: 'Too many requests. Please try again shortly.' });
    }
    next();
  };
}

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 150, label: 'api' });
const purchaseLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: IS_PRODUCTION ? 12 : 50, label: 'purchase' });
const customerPortalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, label: 'customer-portal' });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, label: 'admin' });
app.use('/api', apiLimiter);

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function adminAuth(request, response, next) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return response.status(503).json({ success: false, message: 'Admin access is disabled until secure credentials are configured.' });
  }
  const header = request.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    response.setHeader('WWW-Authenticate', 'Basic realm="Samara Farm Administration", charset="UTF-8"');
    return response.status(401).send('Admin authentication required.');
  }
  let username = '';
  let password = '';
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator >= 0) {
      username = decoded.slice(0, separator);
      password = decoded.slice(separator + 1);
    }
  } catch { /* handled below */ }
  if (!secureEqual(username, ADMIN_USERNAME) || !secureEqual(password, ADMIN_PASSWORD)) {
    response.setHeader('WWW-Authenticate', 'Basic realm="Samara Farm Administration", charset="UTF-8"');
    return response.status(401).send('Invalid admin credentials.');
  }
  request.adminUser = username;
  next();
}

function verifyPaymentWebhook(request, response, next) {
  if (!WEBHOOK_SECRET) return response.status(503).json({ success: false, message: 'Payment webhook is not configured.' });
  const signature = request.get('x-samara-signature') || '';
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(request.rawBody || Buffer.alloc(0)).digest('hex');
  if (!secureEqual(signature, expected)) return response.status(401).json({ success: false, message: 'Invalid webhook signature.' });
  next();
}

const clean = value => typeof value === 'string' ? value.trim() : '';
const validPhone = value => /^[6-9]\d{9}$/.test(value);
const validEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value);
const validPrivateToken = value => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validPincode = value => /^\d{6}$/.test(value);
const routePrefixFor = value => validPincode(value) ? SERVICEABLE_PREFIXES.find(prefix => value.startsWith(prefix)) : null;
const serviceablePincode = value => Boolean(routePrefixFor(value));
const privateTokenDigest = token => createHash('sha256').update(String(token)).digest('hex');
const privateTokenCandidates = token => [privateTokenDigest(token), token];
const idempotencyEncryptionKey = IDEMPOTENCY_ENCRYPTION_SECRET ? createHash('sha256').update(IDEMPOTENCY_ENCRYPTION_SECRET).digest() : null;
function protectIdempotencyPayload(payload) {
  if (!idempotencyEncryptionKey) return JSON.stringify(payload);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', idempotencyEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}
function readIdempotencyPayload(value) {
  if (!String(value).startsWith('enc:v1:')) return JSON.parse(value);
  if (!idempotencyEncryptionKey) throw new Error('Encrypted idempotency data cannot be read without IDEMPOTENCY_ENCRYPTION_KEY.');
  const [, version, iv, tag, encrypted] = String(value).split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted idempotency payload.');
  const decipher = createDecipheriv('aes-256-gcm', idempotencyEncryptionKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'));
}
async function restoreIdempotencyPayload(scope, key, value) {
  const payload = readIdempotencyPayload(value);
  if (idempotencyEncryptionKey && !String(value).startsWith('enc:v1:')) {
    await dbRun('UPDATE idempotency_keys SET response_json = ? WHERE scope = ? AND key = ? AND response_json = ?', [protectIdempotencyPayload(payload), scope, key, value]);
  }
  return payload;
}
async function migratePrivateToken(table, column, id, storedToken, rawToken) {
  if (storedToken === rawToken) await dbRun(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`, [privateTokenDigest(rawToken), id, rawToken]);
}
const validName = value => value.length >= 2 && value.length <= 80;
const validAddress = value => value.length >= 10 && value.length <= 350;
const validQty = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20;
const productRecord = name => Object.hasOwn(PRODUCTS_INFO, name) ? PRODUCTS_INFO[name] : null;
const productFor = name => productRecord(name)?.active ? productRecord(name) : null;
const parseDateValue = value => {
  const text = clean(value);
  let year;
  let month;
  let day;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) [, year, month, day] = match;
  else {
    match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (!match) return null;
    [, day, month, year] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date;
};
const validDeliveryDate = value => {
  const date = parseDateValue(value);
  if (!date) return false;
  const indiaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const start = parseDateValue(indiaToday).getTime();
  return date.getTime() >= start && date.getTime() <= start + 180 * 86400000;
};
const indiaDate = (offsetDays = 0) => {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const subscriptionDisplayStatus = subscription => ['Active', 'Paused'].includes(subscription.status) && subscription.end_date && subscription.end_date < indiaDate() ? 'Expired' : subscription.status;
const jsonDates = value => {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
function subscriptionDueOn(subscription, dateText) {
  if (subscription.status !== 'Active' || jsonDates(subscription.skipped_dates).includes(dateText)) return false;
  const target = parseDateValue(dateText);
  const startText = subscription.start_date || String(subscription.created_at || '').slice(0, 10);
  const start = parseDateValue(startText);
  if (!target || !start || target < start) return false;
  const end = parseDateValue(subscription.end_date);
  if (end && target > end) return false;
  if (subscription.schedule === 'custom') return jsonDates(subscription.custom_dates).includes(dateText);
  const elapsedDays = Math.floor((target - start) / 86400000);
  if (subscription.schedule === 'daily') return true;
  if (subscription.schedule === 'alternate') return elapsedDays % 2 === 0;
  if (subscription.schedule === 'weekend') return [0, 6].includes(target.getUTCDay());
  return false;
}
async function subscriptionCommitments(dateText, deliverySlot, pincodePrefix, excludedId) {
  const parameters = [deliverySlot, pincodePrefix];
  let exclusion = '';
  if (excludedId) {
    exclusion = ' AND id <> ?';
    parameters.push(excludedId);
  }
  const candidates = await dbAll(`SELECT id, qty, schedule, start_date, end_date, custom_dates, skipped_dates, status, created_at FROM subscriptions WHERE delivery_slot = ? AND delivery_route_prefix = ? AND status = 'Active'${exclusion}`, parameters);
  const due = candidates.filter(subscription => subscriptionDueOn(subscription, dateText));
  return { orders: due.length, units: due.reduce((sum, subscription) => sum + subscription.qty, 0), subscriptions: due };
}
async function ensureSubscriptionCapacity(subscription, excludedId) {
  const capacity = await dbGet('SELECT max_orders, max_units FROM route_capacity WHERE pincode_prefix = ? AND delivery_slot = ? AND active = 1', [subscription.delivery_route_prefix, subscription.delivery_slot]);
  if (!capacity) throw operationalError('This delivery route is not accepting subscriptions for the selected slot.', 'ROUTE_UNAVAILABLE');

  const horizonDates = Array.from({ length: 181 }, (_value, offset) => indiaDate(offset));
  const dueDates = horizonDates.filter(date => subscriptionDueOn({ ...subscription, status: 'Active' }, date));
  if (!dueDates.length) return;

  const exclusion = excludedId ? ' AND id <> ?' : '';
  const subscriptionParameters = [subscription.delivery_slot, subscription.delivery_route_prefix];
  if (excludedId) subscriptionParameters.push(excludedId);
  const existingSubscriptions = await dbAll(`SELECT id, qty, schedule, start_date, end_date, custom_dates, skipped_dates, status, created_at FROM subscriptions WHERE delivery_slot = ? AND delivery_route_prefix = ? AND status = 'Active'${exclusion}`, subscriptionParameters);
  const firstDate = horizonDates[0];
  const lastDate = horizonDates.at(-1);
  const orderRows = await dbAll(`SELECT delivery_date, COUNT(*) AS orders, COALESCE(SUM(order_units), 0) AS units FROM orders WHERE delivery_slot = ? AND delivery_route_prefix = ? AND delivery_date BETWEEN ? AND ? AND status NOT IN ('Cancelled', 'Payment Failed') GROUP BY delivery_date`, [subscription.delivery_slot, subscription.delivery_route_prefix, firstDate, lastDate]);
  const ordersByDate = new Map(orderRows.map(row => [row.delivery_date, row]));

  for (const date of dueDates) {
    const booked = ordersByDate.get(date) || { orders: 0, units: 0 };
    const recurring = existingSubscriptions.filter(existing => subscriptionDueOn(existing, date));
    const recurringUnits = recurring.reduce((sum, existing) => sum + existing.qty, 0);
    if (booked.orders + recurring.length + 1 > capacity.max_orders || booked.units + recurringUnits + subscription.qty > capacity.max_units) {
      throw operationalError(`This subscription route is at capacity on ${date}. Please choose another slot or schedule.`, 'ROUTE_FULL');
    }
  }
}
const operationalError = (message, code) => Object.assign(new Error(message), { operational: true, code });
const validateOrderTransition = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) return false;
  if (!ORDER_TRANSITIONS.get(currentStatus)?.has(nextStatus)) throw operationalError(`Order status cannot move from ${currentStatus} to ${nextStatus}.`, 'INVALID_STATUS_TRANSITION');
  return true;
};
async function reserveInventory(items) {
  for (const item of items) {
    const result = await dbRun('UPDATE inventory SET available_qty = available_qty - ?, updated_at = CURRENT_TIMESTAMP WHERE product_name = ? AND available_qty >= ?', [item.qty, item.name, item.qty]);
    if (!result.changes) throw operationalError(`${item.name} is currently unavailable in the requested quantity.`, 'OUT_OF_STOCK');
  }
}
async function releaseInventory(items) {
  for (const item of items) await dbRun('UPDATE inventory SET available_qty = available_qty + ?, updated_at = CURRENT_TIMESTAMP WHERE product_name = ?', [Number(item.qty) || 0, item.name]);
}
const publicError = (response, message) => response.status(400).json({ success: false, message });
const recordAudit = (request, action, entityType, entityId, details = {}) => dbRun(
  'INSERT INTO audit_log (actor, action, entity_type, entity_id, details_json, request_id) VALUES (?, ?, ?, ?, ?, ?)',
  [request.adminUser || request.auditActor || 'system', action, entityType, String(entityId || ''), JSON.stringify(details), request.id]
);

app.get('/api/health', (_request, response) => response.json({ success: true, service: 'samara-api', uptime: Math.round(process.uptime()) }));
app.get('/api/ready', async (request, response) => {
  try {
    await databaseReady;
    await dbGet('SELECT 1 AS ready');
    response.json({ success: true, service: 'samara-api', database: 'ready' });
  } catch (error) {
    reportError('readiness-check', error);
    response.status(503).json({ success: false, message: 'Service is not ready.', requestId: request.id });
  }
});
app.get('/api/catalog', (_request, response) => {
  response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  response.json({ success: true, currency: 'INR', products: Object.entries(PRODUCTS_INFO).map(([name, product]) => ({ name, ...product })), deliverySlots: [...DELIVERY_SLOTS], paymentMethods: [...PAYMENT_METHODS] });
});
app.get('/api/serviceability/:pincode', async (request, response) => {
  try {
    const pincode = clean(request.params.pincode);
    if (!validPincode(pincode)) return publicError(response, 'Please enter a valid 6-digit PIN code.');
    const prefix = routePrefixFor(pincode);
    const deliveryDate = clean(request.query.date) || indiaDate(1);
    if (!validDeliveryDate(deliveryDate)) return publicError(response, 'Please choose a valid delivery date within the next 180 days.');
    if (!prefix) return response.json({ success: true, pincode, routePrefix: null, deliveryDate, serviceable: false, acceptingOrders: false, status: 'register-interest', slots: [] });
    const routes = await dbAll(`SELECT route_capacity.delivery_slot, route_capacity.max_orders, route_capacity.max_units, COUNT(orders.id) AS booked_orders, COALESCE(SUM(orders.order_units), 0) AS booked_units FROM route_capacity LEFT JOIN orders ON orders.delivery_route_prefix = route_capacity.pincode_prefix AND orders.delivery_date = ? AND orders.delivery_slot = route_capacity.delivery_slot AND orders.status NOT IN ('Cancelled', 'Payment Failed') WHERE route_capacity.pincode_prefix = ? AND route_capacity.active = 1 GROUP BY route_capacity.delivery_slot, route_capacity.max_orders, route_capacity.max_units ORDER BY route_capacity.delivery_slot`, [deliveryDate, prefix]);
    const slots = await Promise.all(routes.map(async route => {
      const recurring = await subscriptionCommitments(deliveryDate, route.delivery_slot, prefix);
      const bookedOrders = route.booked_orders + recurring.orders;
      const bookedUnits = route.booked_units + recurring.units;
      return { deliverySlot: route.delivery_slot, available: bookedOrders < route.max_orders && bookedUnits < route.max_units, remainingOrders: Math.max(0, route.max_orders - bookedOrders), remainingUnits: Math.max(0, route.max_units - bookedUnits), scheduledSubscriptions: recurring.orders };
    }));
    const serviceable = slots.length > 0;
    const acceptingOrders = slots.some(slot => slot.available);
    response.json({ success: true, pincode, routePrefix: prefix, deliveryDate, serviceable, acceptingOrders, status: !serviceable ? 'register-interest' : acceptingOrders ? 'launch-area' : 'route-full', slots });
  } catch (error) {
    reportError('serviceability', error);
    response.status(500).json({ success: false, message: 'Unable to check route availability.' });
  }
});

app.get('/api/batches/:id', async (request, response) => {
  try {
    response.setHeader('Cache-Control', 'no-store');
    const batchId = clean(request.params.id).toUpperCase();
    if (!/^[A-Z0-9-]{5,32}$/.test(batchId)) return publicError(response, 'Invalid batch code format.');
    const batch = await dbGet('SELECT id, product_name, date, fat, snf, antibiotics, quality_score FROM batches WHERE id = ?', [batchId]);
    if (!batch) return response.status(404).json({ success: false, message: 'Batch quality record not found.' });
    response.json({ success: true, batch });
  } catch (error) {
    reportError('batch-quality', error);
    response.status(500).json({ success: false, message: 'Unable to retrieve the batch report.' });
  }
});

app.post('/api/orders', purchaseLimiter, async (request, response) => {
  try {
    const name = clean(request.body.name);
    const phone = clean(request.body.phone).replace(/\D/g, '');
    const pincode = clean(request.body.pincode);
    const address = clean(request.body.address);
    const slot = clean(request.body.slot);
    const paymentMethod = clean(request.body.payment_method);
    const utr = clean(request.body.utr);
    const items = request.body.items;
    const deliveryDate = clean(request.body.delivery_date) || indiaDate(1);
    const idempotencyKey = clean(request.get('Idempotency-Key'));

    if (!validName(name)) return publicError(response, 'Please enter a valid name.');
    if (!validPhone(phone)) return publicError(response, 'Please enter a valid 10-digit Indian mobile number.');
    if (!serviceablePincode(pincode)) return publicError(response, 'This PIN code is not currently in our delivery area.');
    if (!validAddress(address)) return publicError(response, 'Please enter a complete delivery address.');
    if (!DELIVERY_SLOTS.has(slot)) return publicError(response, 'Please choose a valid delivery slot.');
    if (!validDeliveryDate(deliveryDate)) return publicError(response, 'Please choose a valid delivery date within the next 180 days.');
    if (!PAYMENT_METHODS.has(paymentMethod)) return publicError(response, 'Please choose a valid payment method.');
    if (paymentMethod === 'UPI' && !/^\d{12}$/.test(utr)) return publicError(response, 'A valid 12-digit UPI transaction reference is required.');
    if (!items || typeof items !== 'object' || Array.isArray(items)) return publicError(response, 'Your cart is empty.');
    if (idempotencyKey && !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) return publicError(response, 'Invalid idempotency key.');

    let totalAmount = 0;
    const orderItems = [];
    for (const [itemName, item] of Object.entries(items)) {
      const product = productFor(itemName);
      const qty = Number(item?.qty);
      const delivery = clean(item?.delivery || 'one-time');
      if (!product || !validQty(qty) || !DELIVERY_SCHEDULES.has(delivery)) return publicError(response, 'Your cart contains an invalid product, quantity or schedule.');
      totalAmount += product.price * qty;
      orderItems.push({ name: itemName, qty, delivery, unit: product.unit, price: product.price, total: product.price * qty });
    }
    if (!orderItems.length || totalAmount <= 0) return publicError(response, 'Your cart is empty.');

    const transactionResult = await dbTransaction(async () => {
      if (idempotencyKey) {
        const existing = await dbGet('SELECT response_json FROM idempotency_keys WHERE scope = ? AND key = ?', ['order', idempotencyKey]);
        if (existing) return { replayed: true, payload: await restoreIdempotencyPayload('order', idempotencyKey, existing.response_json) };
      }

      const routePrefix = routePrefixFor(pincode);
      const capacity = await dbGet('SELECT max_orders, max_units FROM route_capacity WHERE pincode_prefix = ? AND delivery_slot = ? AND active = 1', [routePrefix, slot]);
      if (!capacity) throw operationalError('This delivery route is not accepting orders for the selected slot.', 'ROUTE_UNAVAILABLE');
      const booked = await dbGet(`SELECT COUNT(*) AS orders, COALESCE(SUM(order_units), 0) AS units FROM orders WHERE delivery_date = ? AND delivery_slot = ? AND delivery_route_prefix = ? AND status NOT IN ('Cancelled', 'Payment Failed')`, [deliveryDate, slot, routePrefix]);
      const recurring = await subscriptionCommitments(deliveryDate, slot, routePrefix);
      const orderUnits = orderItems.reduce((sum, item) => sum + item.qty, 0);
      if (booked.orders + recurring.orders + 1 > capacity.max_orders || booked.units + recurring.units + orderUnits > capacity.max_units) throw operationalError('The selected delivery route is full. Please choose another slot or date.', 'ROUTE_FULL');
      await reserveInventory(orderItems);

      let user = await dbGet('SELECT id FROM users WHERE phone = ?', [phone]);
      let userId;
      if (user) {
        userId = user.id;
        await dbRun('UPDATE users SET name = ?, pincode = ?, address = ? WHERE id = ?', [name, pincode, address, userId]);
      } else {
        const userResult = await dbRun('INSERT INTO users (name, phone, pincode, address) VALUES (?, ?, ?, ?)', [name, phone, pincode, address]);
        userId = userResult.lastID;
      }

      const status = paymentMethod === 'UPI' ? 'Awaiting Payment Verification' : 'Pending';
      const trackingToken = randomUUID();
      const orderResult = await dbRun('INSERT INTO orders (user_id, items, payment_method, utr, status, delivery_slot, delivery_date, customer_name, customer_phone, delivery_pincode, delivery_route_prefix, delivery_address, order_units, total_amount, tracking_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [userId, JSON.stringify(orderItems), paymentMethod, utr || null, status, slot, deliveryDate, name, phone, pincode, routePrefix, address, orderUnits, totalAmount, privateTokenDigest(trackingToken)]);
      const payload = { success: true, orderId: orderResult.lastID, trackingToken, deliveryDate, deliverySlot: slot, total: totalAmount, status, message: 'Order created successfully.' };
      if (idempotencyKey) await dbRun('INSERT INTO idempotency_keys (scope, key, response_json) VALUES (?, ?, ?)', ['order', idempotencyKey, protectIdempotencyPayload(payload)]);
      return { replayed: false, payload };
    });

    if (transactionResult.replayed) response.setHeader('Idempotent-Replayed', 'true');
    response.status(transactionResult.replayed ? 200 : 201).json(transactionResult.payload);
  } catch (error) {
    const duplicateUtr = error?.code === 'SQLITE_CONSTRAINT';
    const expected = duplicateUtr || error?.operational;
    if (!expected) reportError('order-create', error);
    response.status(expected ? 409 : 500).json({ success: false, code: error?.code, message: duplicateUtr ? 'This payment reference has already been used.' : error?.operational ? error.message : 'Unable to create the order.' });
  }
});

app.get('/api/orders/track/:token', customerPortalLimiter, async (request, response) => {
  try {
    const token = clean(request.params.token).toLowerCase();
    if (!validPrivateToken(token)) return publicError(response, 'Invalid tracking reference.');
    const [digest, legacy] = privateTokenCandidates(token);
    const order = await dbGet('SELECT id, items, payment_method, status, delivery_slot, delivery_date, total_amount, created_at, tracking_token AS stored_token FROM orders WHERE tracking_token IN (?, ?)', [digest, legacy]);
    if (!order) return response.status(404).json({ success: false, message: 'Order not found.' });
    await migratePrivateToken('orders', 'tracking_token', order.id, order.stored_token, token);
    delete order.stored_token;
    const items = JSON.parse(order.items).map(item => ({ name: item.name, qty: item.qty, unit: item.unit, delivery: item.delivery }));
    const paymentStatus = order.status === 'Cancelled' ? 'Cancelled — nothing due' : order.payment_method === 'COD' ? 'Pay on delivery' : order.status === 'Awaiting Payment Verification' ? 'Verification pending' : order.status === 'Payment Failed' ? 'Failed' : 'Confirmed';
    response.setHeader('Cache-Control', 'no-store, private');
    response.json({ success: true, order: { id: order.id, items, status: order.status, paymentStatus, deliverySlot: order.delivery_slot, deliveryDate: order.delivery_date, total: order.total_amount, createdAt: order.created_at } });
  } catch (error) {
    reportError('order-tracking', error);
    response.status(500).json({ success: false, message: 'Unable to retrieve this order.' });
  }
});

app.patch('/api/orders/track/:token/cancel', customerPortalLimiter, async (request, response) => {
  try {
    const token = clean(request.params.token).toLowerCase();
    if (!validPrivateToken(token)) return publicError(response, 'Invalid tracking reference.');
    const result = await dbTransaction(async () => {
      const [digest, legacy] = privateTokenCandidates(token);
      const order = await dbGet('SELECT id, items, status, tracking_token AS stored_token FROM orders WHERE tracking_token IN (?, ?)', [digest, legacy]);
      if (!order) return null;
      await migratePrivateToken('orders', 'tracking_token', order.id, order.stored_token, token);
      if (!['Pending', 'Awaiting Payment Verification'].includes(order.status)) throw operationalError(order.status === 'Cancelled' ? 'This order is already cancelled.' : 'This order can no longer be cancelled online. Please contact customer care.', 'CANCELLATION_CLOSED');
      await releaseInventory(JSON.parse(order.items));
      await dbRun('UPDATE orders SET status = ? WHERE id = ?', ['Cancelled', order.id]);
      request.auditActor = 'customer-tracking-link';
      await recordAudit(request, 'order.cancelled_by_customer', 'order', order.id, { previousStatus: order.status });
      return { id: order.id, status: 'Cancelled' };
    });
    if (!result) return response.status(404).json({ success: false, message: 'Order not found.' });
    response.setHeader('Cache-Control', 'no-store, private');
    response.json({ success: true, order: result, message: `Order #${result.id} was cancelled.` });
  } catch (error) {
    if (!error?.operational) reportError('customer-order-cancel', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to cancel this order.' });
  }
});

app.post('/api/subscriptions', purchaseLimiter, async (request, response) => {
  try {
    const name = clean(request.body.name);
    const phone = clean(request.body.phone).replace(/\D/g, '');
    const pincode = clean(request.body.pincode);
    const address = clean(request.body.address);
    const productName = clean(request.body.product_name);
    const qty = Number(request.body.qty);
    const schedule = clean(request.body.schedule);
    const deliverySlot = clean(request.body.delivery_slot);
    const startDate = clean(request.body.start_date);
    const requestedEndDate = clean(request.body.end_date);
    const customDates = Array.isArray(request.body.custom_dates) ? [...new Set(request.body.custom_dates.map(clean).filter(Boolean))].sort() : [];
    const effectiveStartDate = startDate || indiaDate(1);
    const idempotencyKey = clean(request.get('Idempotency-Key'));

    if (!validName(name) || !validPhone(phone) || !validAddress(address)) return publicError(response, 'Please provide valid customer and address details.');
    if (!serviceablePincode(pincode)) return publicError(response, 'This PIN code is not currently in our delivery area.');
    if (!productFor(productName) || !validQty(qty)) return publicError(response, 'Please choose a valid product and quantity.');
    if (!SUBSCRIPTION_SCHEDULES.has(schedule) || !DELIVERY_SLOTS.has(deliverySlot)) return publicError(response, 'Please choose a valid schedule and delivery slot.');
    if (!validDeliveryDate(effectiveStartDate)) return publicError(response, 'Please choose a valid start date within the next 180 days.');
    if (requestedEndDate && (!validDeliveryDate(requestedEndDate) || parseDateValue(requestedEndDate) < parseDateValue(effectiveStartDate))) return publicError(response, 'Please choose a valid plan end date on or after the start date.');
    if (schedule === 'custom' && (!customDates.length || customDates.length > 60 || customDates.some(date => !validDeliveryDate(date)))) return publicError(response, 'Please choose between 1 and 60 valid delivery dates within the next 180 days.');
    if (schedule === 'custom' && customDates.some(date => parseDateValue(date) < parseDateValue(effectiveStartDate))) return publicError(response, 'Custom delivery dates cannot be earlier than the subscription start date.');
    if (idempotencyKey && !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) return publicError(response, 'Invalid idempotency key.');

    const transactionResult = await dbTransaction(async () => {
      if (idempotencyKey) {
        const existing = await dbGet('SELECT response_json FROM idempotency_keys WHERE scope = ? AND key = ?', ['subscription', idempotencyKey]);
        if (existing) return { replayed: true, payload: await restoreIdempotencyPayload('subscription', idempotencyKey, existing.response_json) };
      }
      const routePrefix = routePrefixFor(pincode);
      const normalizedCustomDates = schedule === 'custom' ? customDates : [];
      const effectiveEndDate = schedule === 'custom' ? normalizedCustomDates.at(-1) : requestedEndDate || null;
      await ensureSubscriptionCapacity({ qty, schedule, delivery_slot: deliverySlot, delivery_route_prefix: routePrefix, start_date: effectiveStartDate, end_date: effectiveEndDate, custom_dates: normalizedCustomDates.length ? JSON.stringify(normalizedCustomDates) : null, skipped_dates: null, status: 'Active', created_at: `${effectiveStartDate} 00:00:00` });
      let user = await dbGet('SELECT id FROM users WHERE phone = ?', [phone]);
      let userId;
      if (user) {
        userId = user.id;
        await dbRun('UPDATE users SET name = ?, pincode = ?, address = ? WHERE id = ?', [name, pincode, address, userId]);
      } else {
        const userResult = await dbRun('INSERT INTO users (name, phone, pincode, address) VALUES (?, ?, ?, ?)', [name, phone, pincode, address]);
        userId = userResult.lastID;
      }
      const managementToken = randomUUID();
      const subscriptionResult = await dbRun('INSERT INTO subscriptions (user_id, product_name, qty, schedule, delivery_slot, customer_name, customer_phone, delivery_pincode, delivery_route_prefix, delivery_address, start_date, end_date, custom_dates, status, management_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [userId, productName, qty, schedule, deliverySlot, name, phone, pincode, routePrefix, address, effectiveStartDate, effectiveEndDate, normalizedCustomDates.length ? JSON.stringify(normalizedCustomDates) : null, 'Active', privateTokenDigest(managementToken)]);
      const payload = { success: true, subscriptionId: subscriptionResult.lastID, managementToken, managementUrl: `/manage-subscription.html?token=${managementToken}`, startDate: effectiveStartDate, endDate: effectiveEndDate, message: 'Subscription created successfully.' };
      if (idempotencyKey) await dbRun('INSERT INTO idempotency_keys (scope, key, response_json) VALUES (?, ?, ?)', ['subscription', idempotencyKey, protectIdempotencyPayload(payload)]);
      return { replayed: false, payload };
    });
    if (transactionResult.replayed) response.setHeader('Idempotent-Replayed', 'true');
    response.status(transactionResult.replayed ? 200 : 201).json(transactionResult.payload);
  } catch (error) {
    if (!error?.operational) reportError('subscription-create', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to create the subscription.' });
  }
});

app.get('/api/subscriptions/manage/:token', customerPortalLimiter, async (request, response) => {
  try {
    const token = clean(request.params.token).toLowerCase();
    if (!validPrivateToken(token)) return publicError(response, 'Invalid subscription link.');
    const [digest, legacy] = privateTokenCandidates(token);
    const subscription = await dbGet(`SELECT id, product_name, qty, schedule, delivery_slot, start_date, end_date, custom_dates, skipped_dates, status, management_token AS stored_token, customer_name AS name, customer_phone AS phone, delivery_pincode AS pincode, delivery_address AS address FROM subscriptions WHERE management_token IN (?, ?)`, [digest, legacy]);
    if (!subscription) return response.status(404).json({ success: false, message: 'Subscription not found.' });
    await migratePrivateToken('subscriptions', 'management_token', subscription.id, subscription.stored_token, token);
    delete subscription.stored_token;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ success: true, subscription: { ...subscription, status: subscriptionDisplayStatus(subscription), phone: `******${subscription.phone.slice(-4)}`, custom_dates: jsonDates(subscription.custom_dates), skipped_dates: jsonDates(subscription.skipped_dates) } });
  } catch (error) {
    reportError('subscription-lookup', error);
    response.status(500).json({ success: false, message: 'Unable to load this subscription.' });
  }
});

app.patch('/api/subscriptions/manage/:token', customerPortalLimiter, async (request, response) => {
  try {
    const token = clean(request.params.token).toLowerCase();
    const action = clean(request.body.action);
    if (!validPrivateToken(token)) return publicError(response, 'Invalid subscription link.');
    const [digest, legacy] = privateTokenCandidates(token);
    const result = await dbTransaction(async () => {
      const subscription = await dbGet('SELECT id, user_id, qty, schedule, delivery_slot, start_date, end_date, custom_dates, skipped_dates, status, created_at, management_token AS stored_token, delivery_pincode AS pincode, delivery_route_prefix FROM subscriptions WHERE management_token IN (?, ?)', [digest, legacy]);
      if (!subscription) return null;
      await migratePrivateToken('subscriptions', 'management_token', subscription.id, subscription.stored_token, token);
      if (subscriptionDisplayStatus(subscription) === 'Expired' && action !== 'cancel') throw operationalError('This subscription plan has ended. Please create a new plan to continue deliveries.', 'PLAN_ENDED');
      if (action === 'pause' || action === 'resume' || action === 'cancel') {
        const nextStatus = action === 'pause' ? 'Paused' : action === 'resume' ? 'Active' : 'Cancelled';
        if (subscription.status === 'Cancelled' && action !== 'cancel') throw operationalError('A cancelled subscription cannot be resumed online.', 'SUBSCRIPTION_CANCELLED');
        if (nextStatus === subscription.status) return { unchanged: true };
        if (action === 'resume') await ensureSubscriptionCapacity({ ...subscription, status: 'Active' }, subscription.id);
        await dbRun('UPDATE subscriptions SET status = ? WHERE id = ?', [nextStatus, subscription.id]);
      } else if (action === 'skip') {
        const date = clean(request.body.date);
        if (!validDeliveryDate(date)) throw operationalError('Choose a valid date within the next 180 days.', 'INVALID_SKIP_DATE');
        const currentSkippedDates = jsonDates(subscription.skipped_dates);
        if (currentSkippedDates.includes(date)) return { unchanged: true };
        if (!subscriptionDueOn({ ...subscription, status: 'Active', skipped_dates: null }, date)) throw operationalError('That date is not scheduled for this subscription.', 'INVALID_SKIP_DATE');
        const dates = [...currentSkippedDates, date].sort().slice(-60);
        await dbRun('UPDATE subscriptions SET skipped_dates = ? WHERE id = ?', [JSON.stringify(dates), subscription.id]);
      } else if (action === 'update') {
        const qty = Number(request.body.qty);
        const address = clean(request.body.address);
        const pincode = clean(request.body.pincode);
        if (!validQty(qty) || !validAddress(address) || !serviceablePincode(pincode)) throw operationalError('Provide a valid quantity and serviceable address.', 'INVALID_SUBSCRIPTION_UPDATE');
        const routePrefix = routePrefixFor(pincode);
        if (subscription.status === 'Active') await ensureSubscriptionCapacity({ ...subscription, qty, delivery_route_prefix: routePrefix, status: 'Active' }, subscription.id);
        await dbRun('UPDATE subscriptions SET delivery_address = ?, delivery_pincode = ?, delivery_route_prefix = ? WHERE id = ?', [address, pincode, routePrefix, subscription.id]);
        await dbRun('UPDATE subscriptions SET qty = ? WHERE id = ?', [qty, subscription.id]);
      } else throw operationalError('Unsupported subscription action.', 'UNSUPPORTED_ACTION');
      return { unchanged: false };
    });
    if (!result) return response.status(404).json({ success: false, message: 'Subscription not found.' });
    response.setHeader('Cache-Control', 'no-store');
    response.json({ success: true, unchanged: result.unchanged, message: result.unchanged ? 'Subscription was already in that state.' : 'Subscription updated.' });
  } catch (error) {
    if (!error?.operational) reportError('subscription-update', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to update this subscription.' });
  }
});

app.post('/api/support/tickets', customerPortalLimiter, async (request, response) => {
  try {
    const name = clean(request.body.name);
    const phone = clean(request.body.phone).replace(/\D/g, '');
    const email = clean(request.body.email).toLowerCase();
    const category = clean(request.body.category);
    const orderReference = clean(request.body.order_reference);
    const message = clean(request.body.message);
    const idempotencyKey = clean(request.get('Idempotency-Key'));
    if (!validName(name) || !validPhone(phone) || !validEmail(email)) return publicError(response, 'Provide valid contact details.');
    if (!SUPPORT_CATEGORIES.has(category)) return publicError(response, 'Choose a valid support category.');
    if (orderReference.length > 80 || message.length < 15 || message.length > 2000) return publicError(response, 'Describe the issue in 15 to 2,000 characters.');
    if (idempotencyKey && !/^[a-zA-Z0-9._:-]{8,128}$/.test(idempotencyKey)) return publicError(response, 'Invalid idempotency key.');
    const result = await dbTransaction(async () => {
      if (idempotencyKey) {
        const existing = await dbGet('SELECT response_json FROM idempotency_keys WHERE scope = ? AND key = ?', ['support', idempotencyKey]);
        if (existing) return { replayed: true, payload: await restoreIdempotencyPayload('support', idempotencyKey, existing.response_json) };
      }
      const publicReference = `SUP-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
      const statusToken = randomUUID();
      await dbRun('INSERT INTO support_tickets (public_reference, status_token, name, phone, email, category, order_reference, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [publicReference, privateTokenDigest(statusToken), name, phone, email || null, category, orderReference || null, message]);
      const payload = { success: true, reference: publicReference, statusToken, statusUrl: `/support.html?token=${statusToken}`, status: 'Received', message: 'Your request has been recorded.' };
      if (idempotencyKey) await dbRun('INSERT INTO idempotency_keys (scope, key, response_json) VALUES (?, ?, ?)', ['support', idempotencyKey, protectIdempotencyPayload(payload)]);
      return { replayed: false, payload };
    });
    if (result.replayed) response.setHeader('Idempotent-Replayed', 'true');
    response.status(result.replayed ? 200 : 201).json(result.payload);
  } catch (error) {
    reportError('support-ticket-create', error);
    response.status(500).json({ success: false, message: 'Unable to record the support request.' });
  }
});

app.get('/api/support/tickets/:token', customerPortalLimiter, async (request, response) => {
  try {
    const token = clean(request.params.token).toLowerCase();
    if (!validPrivateToken(token)) return publicError(response, 'Invalid support status link.');
    const [digest, legacy] = privateTokenCandidates(token);
    const ticket = await dbGet('SELECT id, public_reference, category, status, resolution_note, created_at, updated_at, status_token AS stored_token FROM support_tickets WHERE status_token IN (?, ?)', [digest, legacy]);
    if (!ticket) return response.status(404).json({ success: false, message: 'Support request not found.' });
    await migratePrivateToken('support_tickets', 'status_token', ticket.id, ticket.stored_token, token);
    delete ticket.id;
    delete ticket.stored_token;
    response.setHeader('Cache-Control', 'no-store');
    response.json({ success: true, ticket });
  } catch (error) {
    reportError('support-ticket-lookup', error);
    response.status(500).json({ success: false, message: 'Unable to load this support request.' });
  }
});

async function updatePaymentStatus(utr, status) {
  return dbTransaction(async () => {
    const order = await dbGet('SELECT id, items, status FROM orders WHERE utr = ?', [utr]);
    if (!order) return null;
    const newStatus = status === 'success' ? 'Confirmed' : 'Payment Failed';
    if (order.status === newStatus) return { id: order.id, status: newStatus };
    const allowed = status === 'success'
      ? ['Awaiting Payment Verification', 'Payment Failed'].includes(order.status)
      : order.status === 'Awaiting Payment Verification';
    if (!allowed) throw operationalError(`Payment event cannot move an order from ${order.status} to ${newStatus}.`, 'PAYMENT_STATE_CONFLICT');
    const items = JSON.parse(order.items);
    if (newStatus === 'Payment Failed' && !['Payment Failed', 'Cancelled'].includes(order.status)) await releaseInventory(items);
    if (newStatus === 'Confirmed' && order.status === 'Payment Failed') await reserveInventory(items);
    await dbRun('UPDATE orders SET status = ? WHERE id = ?', [newStatus, order.id]);
    return { id: order.id, status: newStatus };
  });
}

app.post('/api/webhooks/payment', verifyPaymentWebhook, async (request, response) => {
  try {
    const utr = clean(request.body.utr);
    const status = clean(request.body.status);
    if (!/^\d{12}$/.test(utr) || !['success', 'failed'].includes(status)) return publicError(response, 'Invalid payment event.');
    const order = await updatePaymentStatus(utr, status);
    if (!order) return response.status(404).json({ success: false, message: 'Payment reference not found.' });
    response.json({ success: true, orderId: order.id, status: order.status });
  } catch (error) {
    if (!error?.operational) reportError('payment-webhook', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Webhook processing error.' });
  }
});

app.use('/api/admin', adminLimiter, adminAuth, (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store, private');
  next();
});

app.get('/api/admin/dashboard', async (_request, response) => {
  try {
    const deliveryDate = indiaDate(1);
    const [orders, subscriptions, support, inventory, routes, value] = await Promise.all([
      dbAll('SELECT status, COUNT(*) AS count FROM orders GROUP BY status'),
      dbAll("SELECT CASE WHEN status IN ('Active', 'Paused') AND end_date IS NOT NULL AND end_date < ? THEN 'Expired' ELSE status END AS status, COUNT(*) AS count FROM subscriptions GROUP BY CASE WHEN status IN ('Active', 'Paused') AND end_date IS NOT NULL AND end_date < ? THEN 'Expired' ELSE status END", [indiaDate(), indiaDate()]),
      dbAll('SELECT status, COUNT(*) AS count FROM support_tickets GROUP BY status'),
      dbAll('SELECT product_name, available_qty, low_stock_threshold, available_qty <= low_stock_threshold AS low_stock FROM inventory ORDER BY product_name'),
      dbAll(`SELECT route_capacity.pincode_prefix, route_capacity.delivery_slot, route_capacity.max_orders, route_capacity.max_units, COUNT(orders.id) AS booked_orders, COALESCE(SUM(orders.order_units), 0) AS booked_units FROM route_capacity LEFT JOIN orders ON orders.delivery_route_prefix = route_capacity.pincode_prefix AND orders.delivery_date = ? AND orders.delivery_slot = route_capacity.delivery_slot AND orders.status NOT IN ('Cancelled', 'Payment Failed') WHERE route_capacity.active = 1 GROUP BY route_capacity.pincode_prefix, route_capacity.delivery_slot, route_capacity.max_orders, route_capacity.max_units ORDER BY route_capacity.pincode_prefix, route_capacity.delivery_slot`, [deliveryDate]),
      dbGet(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Payment Failed') THEN total_amount ELSE 0 END), 0) AS gross_order_value FROM orders`)
    ]);
    const routesWithSubscriptions = await Promise.all(routes.map(async route => {
      const recurring = await subscriptionCommitments(deliveryDate, route.delivery_slot, route.pincode_prefix);
      const bookedOrders = route.booked_orders + recurring.orders;
      const bookedUnits = route.booked_units + recurring.units;
      return { ...route, booked_orders: bookedOrders, booked_units: bookedUnits, scheduled_subscriptions: recurring.orders, orderUtilization: route.max_orders ? Math.round(bookedOrders / route.max_orders * 100) : 0, unitUtilization: route.max_units ? Math.round(bookedUnits / route.max_units * 100) : 0 };
    }));
    response.json({ success: true, generatedAt: new Date().toISOString(), deliveryDate, value, orders, subscriptions, support, inventory, routes: routesWithSubscriptions });
  } catch (error) {
    reportError('admin-dashboard', error);
    response.status(500).json({ success: false, message: 'Unable to load the operations dashboard.' });
  }
});

app.get('/api/admin/delivery-manifest', async (request, response) => {
  try {
    const deliveryDate = clean(request.query.date) || indiaDate(1);
    if (!validDeliveryDate(deliveryDate)) return publicError(response, 'Choose a valid manifest date within the next 180 days.');
    const [orders, subscriptions, inventory] = await Promise.all([
      dbAll(`SELECT id, items, delivery_slot, customer_name, customer_phone, delivery_pincode, delivery_route_prefix, delivery_address, order_units FROM orders WHERE delivery_date = ? AND status NOT IN ('Cancelled', 'Payment Failed') ORDER BY delivery_slot, delivery_pincode, id`, [deliveryDate]),
      dbAll(`SELECT id, product_name, qty, schedule, delivery_slot, customer_name, customer_phone, delivery_pincode, delivery_route_prefix, delivery_address, start_date, end_date, custom_dates, skipped_dates, status, created_at FROM subscriptions WHERE status = 'Active' ORDER BY delivery_slot, delivery_pincode, id`),
      dbAll('SELECT product_name, available_qty FROM inventory')
    ]);
    const dueSubscriptions = subscriptions.filter(subscription => subscriptionDueOn(subscription, deliveryDate));
    const entries = [
      ...orders.map(order => ({ type: 'order', reference: `ORD-${order.id}`, deliverySlot: order.delivery_slot, routePrefix: order.delivery_route_prefix, name: order.customer_name, phone: order.customer_phone, pincode: order.delivery_pincode, address: order.delivery_address, units: order.order_units, items: JSON.parse(order.items).map(item => ({ product: item.name, qty: item.qty, unit: item.unit })) })),
      ...dueSubscriptions.map(subscription => ({ type: 'subscription', reference: `SUB-${subscription.id}`, deliverySlot: subscription.delivery_slot, routePrefix: subscription.delivery_route_prefix, name: subscription.customer_name, phone: subscription.customer_phone, pincode: subscription.delivery_pincode, address: subscription.delivery_address, units: subscription.qty, items: [{ product: subscription.product_name, qty: subscription.qty, schedule: subscription.schedule }] }))
    ].sort((left, right) => left.deliverySlot.localeCompare(right.deliverySlot) || left.pincode.localeCompare(right.pincode) || left.reference.localeCompare(right.reference));
    const unreservedRequirements = new Map();
    for (const subscription of dueSubscriptions) unreservedRequirements.set(subscription.product_name, (unreservedRequirements.get(subscription.product_name) || 0) + subscription.qty);
    const availableByProduct = new Map(inventory.map(item => [item.product_name, item.available_qty]));
    const stock = [...unreservedRequirements.entries()].map(([productName, requiredSubscriptionUnits]) => {
      const availableUncommittedQty = availableByProduct.get(productName) || 0;
      return { productName, requiredSubscriptionUnits, availableUncommittedQty, shortageQty: Math.max(0, requiredSubscriptionUnits - availableUncommittedQty) };
    }).sort((left, right) => left.productName.localeCompare(right.productName));
    response.json({ success: true, deliveryDate, summary: { stops: entries.length, units: entries.reduce((sum, entry) => sum + entry.units, 0), orders: entries.filter(entry => entry.type === 'order').length, subscriptions: entries.filter(entry => entry.type === 'subscription').length }, stock, stockSufficient: stock.every(item => item.shortageQty === 0), entries });
  } catch (error) {
    reportError('admin-delivery-manifest', error);
    response.status(500).json({ success: false, message: 'Unable to build the delivery manifest.' });
  }
});

app.get('/api/admin/orders', async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 250);
    const orders = await dbAll(`SELECT id, user_id, items, payment_method, utr, status, delivery_slot, delivery_date, delivery_route_prefix AS route_prefix, order_units, total_amount, created_at, customer_name AS name, customer_phone AS phone, delivery_address AS address, delivery_pincode AS pincode FROM orders ORDER BY created_at DESC LIMIT ?`, [limit]);
    response.json({ success: true, orders: orders.map(order => ({ ...order, items: JSON.parse(order.items) })) });
  } catch (error) {
    reportError('admin-orders', error);
    response.status(500).json({ success: false, message: 'Unable to load orders.' });
  }
});

app.post('/api/admin/orders/:id/status', async (request, response) => {
  try {
    const orderId = Number(request.params.id);
    const status = clean(request.body.status);
    if (!Number.isInteger(orderId) || orderId < 1 || !ORDER_STATUSES.has(status)) return publicError(response, 'Invalid order or status.');
    const result = await dbTransaction(async () => {
      const order = await dbGet('SELECT items, status FROM orders WHERE id = ?', [orderId]);
      if (!order) return null;
      const changed = validateOrderTransition(order.status, status);
      if (!changed) return { ...order, unchanged: true };
      if (status === 'Cancelled' && !['Cancelled', 'Payment Failed'].includes(order.status)) await releaseInventory(JSON.parse(order.items));
      await dbRun('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
      return order;
    });
    if (!result) return response.status(404).json({ success: false, message: 'Order not found.' });
    if (!result.unchanged) await recordAudit(request, 'order.status_changed', 'order', orderId, { previousStatus: result.status, status });
    response.json({ success: true, unchanged: Boolean(result.unchanged), message: result.unchanged ? `Order #${orderId} is already ${status}.` : `Order #${orderId} status changed to ${status}.` });
  } catch (error) {
    if (!error?.operational) reportError('admin-order-update', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to update the order.' });
  }
});

app.get('/api/admin/subscriptions', async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 250);
    const subscriptions = await dbAll(`SELECT id, user_id, product_name, qty, schedule, delivery_slot, delivery_route_prefix AS route_prefix, start_date, end_date, custom_dates, skipped_dates, status, created_at, customer_name AS name, customer_phone AS phone, delivery_address AS address, delivery_pincode AS pincode FROM subscriptions ORDER BY created_at DESC LIMIT ?`, [limit]);
    response.json({ success: true, subscriptions: subscriptions.map(subscription => ({ ...subscription, status: subscriptionDisplayStatus(subscription) })) });
  } catch (error) {
    reportError('admin-subscriptions', error);
    response.status(500).json({ success: false, message: 'Unable to load subscriptions.' });
  }
});

app.get('/api/admin/operations', async (_request, response) => {
  try {
    const [inventory, routes, catalog] = await Promise.all([
      dbAll('SELECT product_name, available_qty, low_stock_threshold, updated_at FROM inventory ORDER BY product_name'),
      dbAll('SELECT pincode_prefix, delivery_slot, max_orders, max_units, active, updated_at FROM route_capacity ORDER BY pincode_prefix, delivery_slot'),
      dbAll('SELECT product_name, price, unit, active, sort_order, updated_at FROM catalog_products ORDER BY sort_order, product_name')
    ]);
    response.json({ success: true, inventory, routes, catalog });
  } catch (error) {
    reportError('admin-operations', error);
    response.status(500).json({ success: false, message: 'Unable to load operational capacity.' });
  }
});

app.get('/api/admin/security/portal-token-storage', async (_request, response) => {
  try {
    const [orders, subscriptions, support, idempotency] = await Promise.all([
      dbGet("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN length(tracking_token) = 64 AND tracking_token NOT GLOB '*[^0-9a-f]*' THEN 0 ELSE 1 END), 0) AS legacy FROM orders WHERE tracking_token IS NOT NULL"),
      dbGet("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN length(management_token) = 64 AND management_token NOT GLOB '*[^0-9a-f]*' THEN 0 ELSE 1 END), 0) AS legacy FROM subscriptions WHERE management_token IS NOT NULL"),
      dbGet("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN length(status_token) = 64 AND status_token NOT GLOB '*[^0-9a-f]*' THEN 0 ELSE 1 END), 0) AS legacy FROM support_tickets WHERE status_token IS NOT NULL"),
      dbGet("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN response_json LIKE 'enc:v1:%' THEN 0 ELSE 1 END), 0) AS unprotected FROM idempotency_keys")
    ]);
    response.json({ success: true, storage: { orders, subscriptions, support, idempotency }, rawTokensAtRest: orders.legacy + subscriptions.legacy + support.legacy + idempotency.unprotected });
  } catch (error) {
    reportError('admin-portal-token-storage', error);
    response.status(500).json({ success: false, message: 'Unable to inspect portal token storage.' });
  }
});

app.put('/api/admin/catalog/:product', async (request, response) => {
  try {
    const productName = clean(decodeURIComponent(request.params.product));
    const price = Number(request.body.price);
    const unit = clean(request.body.unit).toUpperCase();
    const active = request.body.active === false || request.body.active === 0 ? 0 : 1;
    const sortOrder = Number(request.body.sort_order);
    if (!productRecord(productName) || !Number.isInteger(price) || price < 1 || price > 100000 || unit.length < 1 || unit.length > 30 || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000) return publicError(response, 'Invalid catalog values.');
    await dbRun('UPDATE catalog_products SET price = ?, unit = ?, active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE product_name = ?', [price, unit, active, sortOrder, productName]);
    await refreshProductCatalog();
    await recordAudit(request, 'catalog.updated', 'catalog_product', productName, { price, unit, active: Boolean(active), sortOrder });
    response.json({ success: true, message: `${productName} catalog entry updated.` });
  } catch (error) {
    reportError('admin-catalog-update', error);
    response.status(500).json({ success: false, message: 'Unable to update the catalog.' });
  }
});

app.get('/api/admin/support-tickets', async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 250);
    const tickets = await dbAll('SELECT id, public_reference, name, phone, email, category, order_reference, message, status, resolution_note, created_at, updated_at FROM support_tickets ORDER BY created_at DESC LIMIT ?', [limit]);
    response.json({ success: true, tickets });
  } catch (error) {
    reportError('admin-support-list', error);
    response.status(500).json({ success: false, message: 'Unable to load support requests.' });
  }
});

app.put('/api/admin/support-tickets/:id', async (request, response) => {
  try {
    const id = Number(request.params.id);
    const status = clean(request.body.status);
    const resolutionNote = clean(request.body.resolution_note);
    if (!Number.isInteger(id) || id < 1 || !SUPPORT_STATUSES.has(status) || resolutionNote.length > 2000) return publicError(response, 'Invalid support-ticket update.');
    const result = await dbRun('UPDATE support_tickets SET status = ?, resolution_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, resolutionNote || null, id]);
    if (!result.changes) return response.status(404).json({ success: false, message: 'Support request not found.' });
    await recordAudit(request, 'support.status_changed', 'support_ticket', id, { status });
    response.json({ success: true, message: `Support request #${id} updated.` });
  } catch (error) {
    reportError('admin-support-update', error);
    response.status(500).json({ success: false, message: 'Unable to update the support request.' });
  }
});

app.put('/api/admin/inventory/:product', async (request, response) => {
  try {
    const productName = clean(decodeURIComponent(request.params.product));
    const availableQty = Number(request.body.available_qty);
    const threshold = Number(request.body.low_stock_threshold);
    if (!productRecord(productName) || !Number.isInteger(availableQty) || availableQty < 0 || availableQty > 100000 || !Number.isInteger(threshold) || threshold < 0 || threshold > 100000) return publicError(response, 'Invalid inventory values.');
    await dbRun('INSERT INTO inventory (product_name, available_qty, low_stock_threshold, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(product_name) DO UPDATE SET available_qty = excluded.available_qty, low_stock_threshold = excluded.low_stock_threshold, updated_at = CURRENT_TIMESTAMP', [productName, availableQty, threshold]);
    await recordAudit(request, 'inventory.updated', 'inventory', productName, { availableQty, threshold });
    response.json({ success: true, message: `${productName} inventory updated.` });
  } catch (error) {
    reportError('admin-inventory-update', error);
    response.status(500).json({ success: false, message: 'Unable to update inventory.' });
  }
});

app.post('/api/admin/inventory/:product/adjust', async (request, response) => {
  try {
    const productName = clean(decodeURIComponent(request.params.product));
    const delta = Number(request.body.delta);
    const note = clean(request.body.note);
    if (!productRecord(productName) || !Number.isInteger(delta) || delta === 0 || delta < -100000 || delta > 100000 || note.length > 200) return publicError(response, 'Enter a non-zero whole-number stock adjustment and an optional note under 200 characters.');
    const result = await dbTransaction(async () => {
      const current = await dbGet('SELECT available_qty, low_stock_threshold FROM inventory WHERE product_name = ?', [productName]);
      if (!current) return null;
      const nextQty = current.available_qty + delta;
      if (nextQty < 0) throw operationalError(`Cannot remove ${Math.abs(delta)} units; only ${current.available_qty} are available.`, 'INSUFFICIENT_STOCK');
      await dbRun('UPDATE inventory SET available_qty = ?, updated_at = CURRENT_TIMESTAMP WHERE product_name = ?', [nextQty, productName]);
      return { previousQty: current.available_qty, availableQty: nextQty, threshold: current.low_stock_threshold };
    });
    if (!result) return response.status(404).json({ success: false, message: 'Inventory product not found.' });
    await recordAudit(request, 'inventory.adjusted', 'inventory', productName, { delta, previousQty: result.previousQty, availableQty: result.availableQty, note: note || undefined });
    response.json({ success: true, inventory: { productName, availableQty: result.availableQty, lowStock: result.availableQty <= result.threshold }, message: `${productName} stock ${delta > 0 ? 'increased' : 'reduced'} by ${Math.abs(delta)}. New total: ${result.availableQty}.` });
  } catch (error) {
    if (!error?.operational) reportError('admin-inventory-adjustment', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to adjust inventory.' });
  }
});

app.put('/api/admin/routes/:prefix', async (request, response) => {
  try {
    const prefix = clean(request.params.prefix);
    const slot = clean(request.body.delivery_slot);
    const maxOrders = Number(request.body.max_orders);
    const maxUnits = Number(request.body.max_units);
    const active = request.body.active === false || request.body.active === 0 ? 0 : 1;
    if (!/^\d{2,6}$/.test(prefix) || !DELIVERY_SLOTS.has(slot) || !Number.isInteger(maxOrders) || maxOrders < 0 || maxOrders > 10000 || !Number.isInteger(maxUnits) || maxUnits < 0 || maxUnits > 100000) return publicError(response, 'Invalid route capacity values.');
    await dbRun('INSERT INTO route_capacity (pincode_prefix, delivery_slot, max_orders, max_units, active, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(pincode_prefix, delivery_slot) DO UPDATE SET max_orders = excluded.max_orders, max_units = excluded.max_units, active = excluded.active, updated_at = CURRENT_TIMESTAMP', [prefix, slot, maxOrders, maxUnits, active]);
    await recordAudit(request, 'route.updated', 'route', `${prefix}:${slot}`, { maxOrders, maxUnits, active: Boolean(active) });
    response.json({ success: true, message: `Route ${prefix} capacity updated.` });
  } catch (error) {
    reportError('admin-route-update', error);
    response.status(500).json({ success: false, message: 'Unable to update route capacity.' });
  }
});

app.post('/api/admin/batches', async (request, response) => {
  try {
    const id = clean(request.body.id).toUpperCase();
    const productName = clean(request.body.product_name);
    const date = clean(request.body.date);
    const fat = Number(request.body.fat);
    const snf = Number(request.body.snf);
    const qualityScore = Number(request.body.quality_score);
    const antibiotics = request.body.antibiotics === true || request.body.antibiotics === 1;
    if (!/^[A-Z0-9-]{5,32}$/.test(id) || !productRecord(productName) || !parseDateValue(date) || !Number.isFinite(fat) || fat < 0 || fat > 100 || !Number.isFinite(snf) || snf < 0 || snf > 100 || !Number.isInteger(qualityScore) || qualityScore < 0 || qualityScore > 100) return publicError(response, 'Invalid batch report values.');
    await dbRun('INSERT OR REPLACE INTO batches (id, product_name, date, fat, snf, antibiotics, quality_score) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, productName, date, fat, snf, antibiotics ? 1 : 0, qualityScore]);
    await recordAudit(request, 'batch.saved', 'batch', id, { productName, date, qualityScore });
    response.json({ success: true, message: `Batch ${id} saved successfully.` });
  } catch (error) {
    reportError('admin-batch-update', error);
    response.status(500).json({ success: false, message: 'Unable to save the batch report.' });
  }
});

app.post('/api/admin/payments/simulate', async (request, response) => {
  try {
    if (IS_PRODUCTION) return response.status(403).json({ success: false, message: 'Payment simulation is disabled in production.' });
    const utr = clean(request.body.utr);
    const status = clean(request.body.status);
    if (!/^\d{12}$/.test(utr) || !['success', 'failed'].includes(status)) return publicError(response, 'Invalid simulation values.');
    const order = await updatePaymentStatus(utr, status);
    if (!order) return response.status(404).json({ success: false, message: 'Payment reference not found.' });
    await recordAudit(request, 'payment.simulated', 'order', order.id, { status: order.status });
    response.json({ success: true, orderId: order.id, status: order.status });
  } catch (error) {
    if (!error?.operational) reportError('admin-payment-simulation', error);
    response.status(error?.operational ? 409 : 500).json({ success: false, code: error?.code, message: error?.operational ? error.message : 'Unable to simulate the payment event.' });
  }
});

app.get('/api/admin/audit-log', async (request, response) => {
  try {
    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 250);
    const entries = await dbAll('SELECT id, actor, action, entity_type, entity_id, details_json, request_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?', [limit]);
    response.json({ success: true, entries: entries.map(entry => ({ ...entry, details: JSON.parse(entry.details_json || '{}'), details_json: undefined })) });
  } catch (error) {
    reportError('admin-audit-log', error);
    response.status(500).json({ success: false, message: 'Unable to load the audit log.' });
  }
});

app.get('/admin.html', adminLimiter, adminAuth, (_request, response) => {
  response.setHeader('Cache-Control', 'no-store, private');
  response.sendFile(join(ROOT, 'admin.html'));
});

app.use('/api', (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.status(404).json({ success: false, message: 'API endpoint not found.' });
});

app.use((request, response, next) => {
  const blockedDirectories = /(^|\/)(?:node_modules|\.git|\.agents|scripts|tests|backups|data)(?:\/|$)/i;
  const blockedFiles = /(^|\/)(?:server\.js|database\.js|preview-server\.mjs|script\.js|page\.js|tracking\.js|commerce\.js|farm-tour\.js|subscription-booking\.js|support\.js|manage-subscription\.js|styles\.css|samara\.db(?:-(?:shm|wal))?|package(?:-lock)?\.json|dockerfile|compose\.ya?ml|readme\.md|\.env(?:\..*)?)$/i;
  const blocked = blockedDirectories.test(request.path) || blockedFiles.test(request.path);
  if (blocked) return response.status(404).send('Not found');
  next();
});

app.get(['/', '/index.html'], async (_request, response, next) => {
  try {
    await databaseReady;
    const inventory = await dbAll('SELECT product_name, available_qty FROM inventory');
    const structuredJson = JSON.stringify(siteStructuredData(inventory)).replaceAll('<', '\\u003c');
    const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const html = template.replace(/(<script\b[^>]*id="site-structured-data"[^>]*>)[\s\S]*?(<\/script>)/i, `$1${structuredJson}$2`);
    if (html === template) throw new Error('Structured-data marker is missing from index.html.');
    const structuredHash = `'sha256-${createHash('sha256').update(structuredJson).digest('base64')}'`;
    const currentPolicy = String(response.getHeader('Content-Security-Policy') || '');
    response.setHeader('Content-Security-Policy', currentPolicy.replace("script-src 'self'", `script-src 'self' ${structuredHash}`));
    response.setHeader('Cache-Control', 'no-cache');
    response.type('html').send(html);
  } catch (error) {
    reportError('render-homepage-metadata', error);
    next();
  }
});

app.use(express.static(ROOT, {
  dotfiles: 'deny',
  index: 'index.html',
  setHeaders(response, path) {
    if (/(?:track|support|manage-subscription|admin)\.html$/i.test(path)) response.setHeader('Cache-Control', 'no-store, private');
    else if (path.endsWith('.html') || path.endsWith('service-worker.js')) response.setHeader('Cache-Control', 'no-cache');
    else if (/[\\/]assets[\\/]build[\\/].+\.[a-f0-9]{10}\.min\.(?:css|js)$/i.test(path)) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(?:jpg|jpeg|png|webp|svg|woff2|css|js)$/i.test(path)) response.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

app.use((error, _request, response, next) => {
  if (response.headersSent) return next(error);
  if (error?.message === 'Origin is not allowed.') return response.status(403).json({ success: false, message: 'Origin is not allowed.' });
  if (error instanceof SyntaxError) return response.status(400).json({ success: false, message: 'Invalid JSON request.' });
  reportError('unhandled-server-error', error);
  response.status(500).json({ success: false, message: 'Unexpected server error.' });
});

try {
  await databaseReady;
  await refreshProductCatalog();
} catch (error) {
  reportError('database-startup', error);
  process.exit(1);
}

const server = app.listen(PORT, HOST, () => {
  console.log(`Samara server running at http://${HOST}:${PORT}`);
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) console.warn('Admin access is disabled. Set ADMIN_USERNAME and ADMIN_PASSWORD.');
  if (PAYMENT_PROVIDER_ENABLED && !WEBHOOK_SECRET) console.warn('Payment webhook is disabled. Set PAYMENT_WEBHOOK_SECRET.');
});
let shuttingDown = false;
// Keep a strong reference to the listener and detect silent listener loss.
// This is especially important for detached Windows launchers used locally.
const listenerWatchdog = setInterval(() => {
  if (server.listening || shuttingDown) return;
  reportError('listener-watchdog', new Error('HTTP listener stopped unexpectedly.'));
  shutdown('listener-watchdog', 1);
}, 30000);
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(listenerWatchdog);
  console.log(`${signal} received; closing the HTTP server and database.`);
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out.');
    process.exit(1);
  }, 10000);
  forceExit.unref();
  server.close(async error => {
    try {
      if (error) throw error;
      await closeDatabase();
      clearTimeout(forceExit);
      process.exit(exitCode);
    } catch (closeError) {
      reportError('shutdown', closeError);
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
  reportError('unhandled-rejection', reason instanceof Error ? reason : new Error(String(reason)));
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', error => {
  reportError('uncaught-exception', error);
  shutdown('uncaughtException', 1);
});
