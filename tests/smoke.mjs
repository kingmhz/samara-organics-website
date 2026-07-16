import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const port = 4400 + Math.floor(Math.random() * 300);
const externalBase = String(process.env.SAMARA_TEST_BASE_URL || '').replace(/\/$/, '');
const externalLogPath = process.env.SAMARA_TEST_LOG_PATH;
const base = externalBase || `http://127.0.0.1:${port}`;
const adminUsername = 'smoke-admin';
const adminPassword = 'Smoke-Test:Password-42!';
const webhookSecret = 'smoke-webhook-secret';
const idempotencyEncryptionKey = 'smoke-idempotency-encryption-key-42-secure';
const basicAuth = `Basic ${Buffer.from(`${adminUsername}:${adminPassword}`).toString('base64')}`;
let output = '';

const child = externalBase ? null : spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', DATABASE_PATH: ':memory:', ADMIN_USERNAME: adminUsername, ADMIN_PASSWORD: adminPassword, PAYMENT_WEBHOOK_SECRET: webhookSecret, IDEMPOTENCY_ENCRYPTION_KEY: idempotencyEncryptionKey, SERVICEABLE_PIN_PREFIXES: '20,202,203' },
  stdio: ['ignore', 'pipe', 'pipe']
});
child?.stdout.on('data', chunk => { output += chunk; });
child?.stderr.on('data', chunk => { output += chunk; });

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/ready`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not become ready.\n${output}`);
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function structuredDataFrom(html) {
  const match = html.match(/<script\b[^>]*id="site-structured-data"[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Rendered homepage must include live structured data.');
  return JSON.parse(match[1]);
}

try {
  await waitForReady();

  const health = await jsonRequest('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.response.headers.get('x-frame-options'), 'DENY');
  assert.match(health.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(health.response.headers.get('content-security-policy'), /object-src 'none'/);
  assert.match(health.response.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.doesNotMatch(health.response.headers.get('content-security-policy'), /script-src[^;]*'unsafe-inline'/);
  const home = await fetch(`${base}/`);
  const homeHtml = await home.text();
  const initialStructuredData = structuredDataFrom(homeHtml);
  assert.equal(initialStructuredData['@graph'].filter(entry => entry['@type'] === 'Product').length, 3);
  assert.match(home.headers.get('cache-control'), /no-cache/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self' 'sha256-/);
  assert.doesNotMatch(homeHtml, /fonts\.(?:googleapis|gstatic)\.com/);
  const localFont = await fetch(`${base}/assets/fonts/manrope-latin.woff2`);
  assert.equal(localFont.status, 200);
  assert.match(localFont.headers.get('content-type'), /font\/woff2/);
  assert.match(localFont.headers.get('cache-control'), /max-age=86400/);
  const builtAsset = homeHtml.match(/assets\/build\/app\.[a-f0-9]{10}\.min\.js/)?.[0];
  assert.ok(builtAsset, 'Home page should reference a fingerprinted application bundle.');
  assert.match((await fetch(`${base}/${builtAsset}`)).headers.get('cache-control'), /immutable/);
  const builtStyle = homeHtml.match(/assets\/build\/styles\.[a-f0-9]{10}\.min\.css/)?.[0];
  assert.ok(builtStyle, 'Home page should reference a fingerprinted stylesheet.');
  const compressedStyle = await fetch(`${base}/${builtStyle}`, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(compressedStyle.headers.get('content-encoding'), 'br');
  assert.match(compressedStyle.headers.get('vary'), /Accept-Encoding/i);
  for (const privatePage of ['/track.html', '/support.html', '/manage-subscription.html']) {
    assert.match((await fetch(`${base}${privatePage}`)).headers.get('cache-control'), /no-store/);
  }
  const workerText = await (await fetch(`${base}/service-worker.js`)).text();
  assert.doesNotMatch(workerText, /'\.\/(?:track|support|manage-subscription)\.html'/);
  const catalog = await jsonRequest('/api/catalog');
  assert.equal(catalog.data.products.length, 3);
  const serviceable = await jsonRequest('/api/serviceability/202001');
  assert.equal(serviceable.data.serviceable, true);
  assert.equal(serviceable.data.routePrefix, '202');
  assert.equal(serviceable.data.acceptingOrders, true);
  assert.equal(serviceable.data.slots.length, 2);
  const unsupported = await jsonRequest('/api/serviceability/999999');
  assert.equal(unsupported.data.serviceable, false);
  for (const privatePath of ['/api/orders/track/not-a-token', '/api/subscriptions/manage/not-a-token', '/api/support/tickets/not-a-token']) {
    const invalidPrivateLink = await jsonRequest(privatePath);
    assert.equal(invalidPrivateLink.response.status, 400, `${privatePath} must reject malformed private references.`);
    assert.equal(invalidPrivateLink.data.success, false);
  }
  const unknownApi = await jsonRequest('/api/route-that-does-not-exist');
  assert.equal(unknownApi.response.status, 404);
  assert.match(unknownApi.response.headers.get('content-type'), /application\/json/);
  assert.match(unknownApi.response.headers.get('cache-control'), /no-store/);
  assert.equal(unknownApi.data.message, 'API endpoint not found.');

  assert.equal((await fetch(`${base}/admin.html`)).status, 401);
  for (const sensitivePath of ['/server.js', '/database.js', '/commerce.js', '/styles.css', '/scripts/backup-db.mjs', '/tests/smoke.mjs', '/backups/latest.db', '/data/samara.db', '/samara.db']) {
    assert.equal((await fetch(`${base}${sensitivePath}`)).status, 404, `${sensitivePath} must not be publicly served.`);
  }
  const protectedAdminPage = await fetch(`${base}/admin.html`, { headers: { Authorization: basicAuth } });
  assert.equal(protectedAdminPage.status, 200);
  assert.match(protectedAdminPage.headers.get('cache-control'), /no-store/);
  assert.equal((await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } })).status, 403);

  const invalidProduct = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad Product', phone: '9876543210', pincode: '202001', address: '123 Civil Lines, Aligarh', slot: 'Morning (6:00 AM - 9:00 AM)', items: { toString: { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(invalidProduct.response.status, 400);
  const legacyRecurringCart = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Legacy Cart', phone: '9876543219', pincode: '202001', address: '123 Civil Lines, Aligarh', slot: 'Morning (6:00 AM - 9:00 AM)', items: { 'Organic A2 Milk': { qty: 1, delivery: 'daily' } }, payment_method: 'COD' }) });
  assert.equal(legacyRecurringCart.response.status, 400, 'Recurring schedules must use the dedicated subscription API, not create duplicate order and subscription records.');

  const orderBody = JSON.stringify({ name: 'Smoke Customer', phone: '9876543210', pincode: '202001', address: '123 Civil Lines, Aligarh, Uttar Pradesh', slot: 'Morning (6:00 AM - 9:00 AM)', items: { 'Organic A2 Milk': { qty: 2, delivery: 'one-time' } }, payment_method: 'UPI', utr: '123456789012' });
  const orderHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': 'order:smoke-test-12345' };
  const order = await jsonRequest('/api/orders', { method: 'POST', headers: orderHeaders, body: orderBody });
  assert.equal(order.response.status, 201);
  assert.equal(order.data.total, 220);
  assert.match(order.data.trackingToken, /^[0-9a-f-]{36}$/);
  const replay = await jsonRequest('/api/orders', { method: 'POST', headers: orderHeaders, body: orderBody });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.response.headers.get('idempotent-replayed'), 'true');
  assert.equal(replay.data.orderId, order.data.orderId);

  const tracking = await jsonRequest(`/api/orders/track/${order.data.trackingToken}`);
  assert.equal(tracking.response.status, 200);
  assert.match(tracking.response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Object.keys(tracking.data.order).sort(), ['createdAt', 'deliveryDate', 'deliverySlot', 'id', 'items', 'paymentStatus', 'status', 'total'].sort());
  assert.match(tracking.data.order.deliveryDate, /^\d{4}-\d{2}-\d{2}$/);
  const broadRouteAfterSpecificOrder = await jsonRequest(`/api/serviceability/201001?date=${tracking.data.order.deliveryDate}`);
  assert.equal(broadRouteAfterSpecificOrder.data.routePrefix, '20');
  assert.equal(broadRouteAfterSpecificOrder.data.slots.find(slot => slot.deliverySlot.startsWith('Morning')).remainingOrders, 80, 'A 202 order must not consume capacity from the broader 20 route.');

  const webhookBody = JSON.stringify({ utr: '123456789012', status: 'success' });
  assert.equal((await jsonRequest('/api/webhooks/payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: webhookBody })).response.status, 401);
  const signature = createHmac('sha256', webhookSecret).update(webhookBody).digest('hex');
  const webhook = await jsonRequest('/api/webhooks/payment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-samara-signature': signature }, body: webhookBody });
  assert.equal(webhook.data.status, 'Confirmed');
  assert.equal((await jsonRequest('/api/webhooks/payment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-samara-signature': signature }, body: webhookBody })).response.status, 200);
  const staleFailureBody = JSON.stringify({ utr: '123456789012', status: 'failed' });
  const staleFailureSignature = createHmac('sha256', webhookSecret).update(staleFailureBody).digest('hex');
  const staleFailure = await jsonRequest('/api/webhooks/payment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-samara-signature': staleFailureSignature }, body: staleFailureBody });
  assert.equal(staleFailure.response.status, 409);
  assert.equal(staleFailure.data.code, 'PAYMENT_STATE_CONFLICT');
  const lateCancellation = await jsonRequest(`/api/orders/track/${order.data.trackingToken}/cancel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(lateCancellation.response.status, 409);
  assert.equal(lateCancellation.data.code, 'CANCELLATION_CLOSED');

  const tomorrow = tracking.data.order.deliveryDate;
  const followingDateValue = new Date(`${tomorrow}T00:00:00Z`);
  followingDateValue.setUTCDate(followingDateValue.getUTCDate() + 1);
  const followingDate = followingDateValue.toISOString().slice(0, 10);
  const afterPlanDateValue = new Date(followingDateValue);
  afterPlanDateValue.setUTCDate(afterPlanDateValue.getUTCDate() + 1);
  const afterPlanDate = afterPlanDateValue.toISOString().slice(0, 10);
  const subscriptionBody = JSON.stringify({ name: 'Smoke Subscriber', phone: '9876543211', pincode: '202001', address: '456 Medical Road, Aligarh, Uttar Pradesh', product_name: 'Traditional Dahi', qty: 1, schedule: 'custom', delivery_slot: 'Evening (6:00 PM - 9:00 PM)', start_date: tomorrow, custom_dates: [tomorrow] });
  const subscriptionHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': 'subscription:smoke-test-12345' };
  const subscription = await jsonRequest('/api/subscriptions', { method: 'POST', headers: subscriptionHeaders, body: subscriptionBody });
  assert.equal(subscription.response.status, 201);
  assert.match(subscription.data.managementToken, /^[0-9a-f-]{36}$/);
  assert.equal((await jsonRequest('/api/subscriptions', { method: 'POST', headers: subscriptionHeaders, body: subscriptionBody })).response.status, 200);
  const secondSubscription = await jsonRequest('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Subscriber', phone: '9876543211', pincode: '203001', address: '22 Independent Route, Bulandshahr, Uttar Pradesh', product_name: 'Traditional Dahi', qty: 1, schedule: 'daily', delivery_slot: 'Evening (6:00 PM - 9:00 PM)', start_date: tomorrow, end_date: followingDate }) });
  assert.equal(secondSubscription.response.status, 201);

  const managementPath = `/api/subscriptions/manage/${subscription.data.managementToken}`;
  const managed = await jsonRequest(managementPath);
  assert.equal(managed.response.status, 200);
  assert.equal((await jsonRequest(`/api/subscriptions/manage/${subscription.data.managementToken.toUpperCase()}`)).response.status, 200, 'Private subscription links must remain valid if a browser or messaging app changes UUID letter case.');
  assert.equal(managed.data.subscription.phone, '******3211');
  assert.equal(managed.data.subscription.pincode, '202001');
  assert.equal(managed.data.subscription.address, '456 Medical Road, Aligarh, Uttar Pradesh');
  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) })).response.status, 200);
  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'skip', date: tomorrow }) })).response.status, 200);
  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', qty: 2, address: '789 Updated Road, Aligarh, Uttar Pradesh', pincode: '202001' }) })).response.status, 200);
  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })).response.status, 200);
  const untouchedSecondSubscription = await jsonRequest(`/api/subscriptions/manage/${secondSubscription.data.managementToken}`);
  assert.equal(untouchedSecondSubscription.data.subscription.pincode, '203001');
  assert.equal(untouchedSecondSubscription.data.subscription.address, '22 Independent Route, Bulandshahr, Uttar Pradesh');
  assert.equal(untouchedSecondSubscription.data.subscription.end_date, followingDate);
  const manifest = await jsonRequest(`/api/admin/delivery-manifest?date=${tomorrow}`, { headers: { Authorization: basicAuth } });
  assert.equal(manifest.response.status, 200);
  assert.deepEqual(manifest.data.summary, { stops: 2, units: 3, orders: 1, subscriptions: 1 });
  assert.ok(manifest.data.entries.some(entry => entry.reference === `SUB-${secondSubscription.data.subscriptionId}` && entry.pincode === '203001'));
  assert.ok(manifest.data.entries.some(entry => entry.reference === `ORD-${order.data.orderId}` && entry.routePrefix === '202'));
  assert.ok(manifest.data.entries.some(entry => entry.reference === `SUB-${secondSubscription.data.subscriptionId}` && entry.routePrefix === '203'));
  assert.equal(manifest.data.entries.some(entry => entry.reference === `SUB-${subscription.data.subscriptionId}`), false, 'Skipped subscription dates must not enter the manifest.');
  assert.equal(manifest.data.stockSufficient, true);
  assert.deepEqual(manifest.data.stock, [{ productName: 'Traditional Dahi', requiredSubscriptionUnits: 1, availableUncommittedQty: 250, shortageQty: 0 }]);
  const subscriptionCapacity = await jsonRequest(`/api/serviceability/203001?date=${tomorrow}`);
  assert.equal(subscriptionCapacity.data.slots.find(slot => slot.deliverySlot.startsWith('Evening')).scheduledSubscriptions, 1);
  assert.equal(subscriptionCapacity.data.slots.find(slot => slot.deliverySlot.startsWith('Evening')).remainingOrders, 79);
  const afterLimitedPlan = await jsonRequest(`/api/serviceability/203001?date=${afterPlanDate}`);
  assert.equal(afterLimitedPlan.data.slots.find(slot => slot.deliverySlot.startsWith('Evening')).scheduledSubscriptions, 0, 'A fixed-duration plan must stop after its end date.');
  const broadRouteAfterSpecificSubscription = await jsonRequest(`/api/serviceability/201001?date=${tomorrow}`);
  assert.equal(broadRouteAfterSpecificSubscription.data.slots.find(slot => slot.deliverySlot.startsWith('Evening')).remainingOrders, 80, 'A 203 subscription must not consume capacity from the broader 20 route.');
  assert.equal((await jsonRequest('/api/admin/routes/203', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot: 'Evening (6:00 PM - 9:00 PM)', max_orders: 1, max_units: 400, active: true }) })).response.status, 200);
  const subscriptionReservedRoute = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Reserved Route Customer', phone: '9876543299', pincode: '203001', address: '99 Reserved Route, Bulandshahr, Uttar Pradesh', slot: 'Evening (6:00 PM - 9:00 PM)', delivery_date: tomorrow, items: { 'Traditional Dahi': { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(subscriptionReservedRoute.response.status, 409);
  assert.equal(subscriptionReservedRoute.data.code, 'ROUTE_FULL');
  assert.equal((await jsonRequest('/api/admin/routes/203', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot: 'Evening (6:00 PM - 9:00 PM)', max_orders: 80, max_units: 200, active: true }) })).response.status, 200);

  const supportBody = JSON.stringify({ name: 'Smoke Customer', phone: '9876543210', email: 'customer@example.com', category: 'Delivery', order_reference: String(order.data.orderId), message: 'The scheduled delivery information needs clarification.' });
  const supportHeaders = { 'Content-Type': 'application/json', 'Idempotency-Key': 'support:smoke-test-12345' };
  const support = await jsonRequest('/api/support/tickets', { method: 'POST', headers: supportHeaders, body: supportBody });
  assert.equal(support.response.status, 201);
  assert.match(support.data.reference, /^SUP-[A-F0-9]{10}$/);
  assert.equal((await jsonRequest('/api/support/tickets', { method: 'POST', headers: supportHeaders, body: supportBody })).response.status, 200);
  const supportStatus = await jsonRequest(`/api/support/tickets/${support.data.statusToken}`);
  assert.equal(supportStatus.data.ticket.status, 'Received');

  const adminOrders = await jsonRequest('/api/admin/orders', { headers: { Authorization: basicAuth } });
  assert.equal(adminOrders.response.status, 200);
  assert.match(adminOrders.response.headers.get('cache-control'), /no-store/);
  assert.equal(adminOrders.data.orders.length, 1);
  assert.equal(adminOrders.data.orders[0].status, 'Confirmed');
  assert.equal(Object.hasOwn(adminOrders.data.orders[0], 'tracking_token'), false);
  const dashboard = await jsonRequest('/api/admin/dashboard', { headers: { Authorization: basicAuth } });
  assert.equal(dashboard.response.status, 200);
  assert.match(dashboard.response.headers.get('cache-control'), /no-store/);
  assert.equal(dashboard.data.value.total_orders, 1);
  assert.equal(dashboard.data.inventory.length, 3);
  assert.equal(dashboard.data.routes.length, 6);
  assert.ok(dashboard.data.routes.filter(route => route.pincode_prefix === '20').every(route => route.booked_orders === 0 && route.booked_units === 0), 'Specific 202/203 deliveries must not be double-counted on the broader 20 dashboard route.');
  assert.ok(dashboard.data.routes.every(route => Number.isInteger(route.orderUtilization) && Number.isInteger(route.unitUtilization)));
  assert.equal(JSON.stringify(dashboard.data).includes('9876543210'), false, 'Dashboard aggregates must not expose customer data.');
  const adminTickets = await jsonRequest('/api/admin/support-tickets', { headers: { Authorization: basicAuth } });
  assert.equal(adminTickets.response.status, 200);
  assert.equal(adminTickets.data.tickets.length, 1);
  const supportUpdate = await jsonRequest(`/api/admin/support-tickets/${adminTickets.data.tickets[0].id}`, { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'In Review', resolution_note: 'The routing team is checking the scheduled slot.' }) });
  assert.equal(supportUpdate.response.status, 200);
  assert.equal((await jsonRequest(`/api/support/tickets/${support.data.statusToken}`)).data.ticket.status, 'In Review');
  const adminSubscriptions = await jsonRequest('/api/admin/subscriptions', { headers: { Authorization: basicAuth } });
  assert.equal(adminSubscriptions.response.status, 200);
  assert.equal(Object.hasOwn(adminSubscriptions.data.subscriptions[0], 'management_token'), false);
  const portalTokenStorage = await jsonRequest('/api/admin/security/portal-token-storage', { headers: { Authorization: basicAuth } });
  assert.equal(portalTokenStorage.response.status, 200);
  assert.equal(portalTokenStorage.data.rawTokensAtRest, 0);
  assert.deepEqual(Object.fromEntries(Object.entries(portalTokenStorage.data.storage).map(([name, value]) => [name, value.total])), { orders: 1, subscriptions: 2, support: 1, idempotency: 3 });

  assert.equal((await jsonRequest('/api/admin/routes/20', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot: 'Morning (6:00 AM - 9:00 AM)', max_orders: 1, max_units: 20, active: true }) })).response.status, 200);
  const customSubscription = details => jsonRequest('/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: details.name, phone: details.phone, pincode: '201001', address: '20 Schedule Test Road, Service Area', product_name: 'Traditional Dahi', qty: 1, schedule: 'custom', delivery_slot: 'Morning (6:00 AM - 9:00 AM)', start_date: tomorrow, custom_dates: details.dates }) });
  const firstCustom = await customSubscription({ name: 'First Schedule', phone: '9876543251', dates: [` ${tomorrow} `] });
  assert.equal(firstCustom.response.status, 201);
  const firstCustomPortal = await jsonRequest(`/api/subscriptions/manage/${firstCustom.data.managementToken}`);
  assert.deepEqual(firstCustomPortal.data.subscription.custom_dates, [tomorrow], 'Custom dates must be normalized before storage.');
  const nonOverlappingCustom = await customSubscription({ name: 'Second Schedule', phone: '9876543252', dates: [followingDate] });
  assert.equal(nonOverlappingCustom.response.status, 201, 'Non-overlapping custom schedules must not block each other.');
  const overlappingCustom = await customSubscription({ name: 'Third Schedule', phone: '9876543253', dates: [tomorrow] });
  assert.equal(overlappingCustom.response.status, 409);
  assert.equal(overlappingCustom.data.code, 'ROUTE_FULL');
  const firstCustomManage = `/api/subscriptions/manage/${firstCustom.data.managementToken}`;
  assert.equal((await jsonRequest(firstCustomManage, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) })).response.status, 200);
  const replacementCustom = await customSubscription({ name: 'Replacement Schedule', phone: '9876543254', dates: [tomorrow] });
  assert.equal(replacementCustom.response.status, 201, 'Pausing a subscription must release its scheduled route capacity.');
  const blockedResume = await jsonRequest(firstCustomManage, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) });
  assert.equal(blockedResume.response.status, 409);
  assert.equal(blockedResume.data.code, 'ROUTE_FULL');
  const replacementManage = `/api/subscriptions/manage/${replacementCustom.data.managementToken}`;
  assert.equal((await jsonRequest(replacementManage, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })).response.status, 200);
  assert.equal((await jsonRequest(firstCustomManage, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })).response.status, 200);

  const movedCustomerOrder = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Customer', phone: '9876543210', pincode: '203001', address: '88 New Delivery Road, Bulandshahr, Uttar Pradesh', slot: 'Evening (6:00 PM - 9:00 PM)', delivery_date: tracking.data.order.deliveryDate, items: { 'Traditional Dahi': { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(movedCustomerOrder.response.status, 201);
  const originalRouteAfterMove = await jsonRequest(`/api/serviceability/202001?date=${tracking.data.order.deliveryDate}`);
  assert.equal(originalRouteAfterMove.data.slots.find(slot => slot.deliverySlot.startsWith('Morning')).remainingOrders, 79, 'Changing a customer profile must not move an existing order to another route.');
  const movedAdminOrders = await jsonRequest('/api/admin/orders', { headers: { Authorization: basicAuth } });
  assert.equal(movedAdminOrders.data.orders.find(entry => entry.id === order.data.orderId).address, '123 Civil Lines, Aligarh, Uttar Pradesh');
  assert.equal(movedAdminOrders.data.orders.find(entry => entry.id === movedCustomerOrder.data.orderId).address, '88 New Delivery Road, Bulandshahr, Uttar Pradesh');

  const setStatus = status => jsonRequest(`/api/admin/orders/${order.data.orderId}/status`, { method: 'POST', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  assert.equal((await setStatus('Out for Delivery')).response.status, 200);
  assert.equal((await setStatus('Delivered')).response.status, 200);
  const reverseDelivered = await setStatus('Pending');
  assert.equal(reverseDelivered.response.status, 409);
  assert.equal(reverseDelivered.data.code, 'INVALID_STATUS_TRANSITION');

  const operations = await jsonRequest('/api/admin/operations', { headers: { Authorization: basicAuth } });
  assert.equal(operations.response.status, 200);
  assert.equal(operations.data.inventory.length, 3);
  assert.equal(operations.data.catalog.length, 3);
  const catalogUpdate = await jsonRequest('/api/admin/catalog/Organic%20A2%20Milk', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ price: 125, unit: '1 L', active: true, sort_order: 1 }) });
  assert.equal(catalogUpdate.response.status, 200);
  const updatedCatalog = await jsonRequest('/api/catalog');
  assert.equal(updatedCatalog.data.products.find(product => product.name === 'Organic A2 Milk').price, 125);
  const updatedHomeHtml = await (await fetch(`${base}/`)).text();
  const updatedStructuredProducts = structuredDataFrom(updatedHomeHtml)['@graph'].filter(entry => entry['@type'] === 'Product');
  assert.equal(updatedStructuredProducts.find(product => product.name === 'Farm Fresh Milk').offers.price, 125);
  const disableDahi = await jsonRequest('/api/admin/catalog/Traditional%20Dahi', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ price: 89, unit: '500 G', active: false, sort_order: 3 }) });
  assert.equal(disableDahi.response.status, 200);
  const unavailableStructuredProducts = structuredDataFrom(await (await fetch(`${base}/`)).text())['@graph'].filter(entry => entry['@type'] === 'Product');
  assert.equal(unavailableStructuredProducts.find(product => product.name === 'Traditional Dahi').offers.availability, 'https://schema.org/OutOfStock');
  const inactiveOrder = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Inactive Product', phone: '9876543214', pincode: '202001', address: '14 Catalog Road, Aligarh', slot: 'Evening (6:00 PM - 9:00 PM)', items: { 'Traditional Dahi': { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(inactiveOrder.response.status, 400);
  await jsonRequest('/api/admin/catalog/Traditional%20Dahi', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ price: 89, unit: '500 G', active: true, sort_order: 3 }) });
  const routeUpdate = await jsonRequest('/api/admin/routes/202', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot: 'Morning (6:00 AM - 9:00 AM)', max_orders: 1, max_units: 200, active: true }) });
  assert.equal(routeUpdate.response.status, 200);
  const fullMorning = await jsonRequest(`/api/serviceability/202001?date=${tracking.data.order.deliveryDate}`);
  assert.equal(fullMorning.data.serviceable, true);
  assert.equal(fullMorning.data.acceptingOrders, true);
  assert.equal(fullMorning.data.slots.find(slot => slot.deliverySlot.startsWith('Morning')).available, false);
  assert.equal(fullMorning.data.slots.find(slot => slot.deliverySlot.startsWith('Evening')).available, true);
  const capacityOrder = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Capacity Customer', phone: '9876543212', pincode: '202001', address: '10 Capacity Road, Aligarh', slot: 'Morning (6:00 AM - 9:00 AM)', items: { 'Organic A2 Milk': { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(capacityOrder.response.status, 409);
  assert.equal(capacityOrder.data.code, 'ROUTE_FULL');
  for (const delivery_slot of ['Morning (6:00 AM - 9:00 AM)', 'Evening (6:00 PM - 9:00 PM)']) {
    const active = false;
    const max_orders = delivery_slot.startsWith('Morning') ? 1 : 80;
    const max_units = delivery_slot.startsWith('Morning') ? 200 : 400;
    assert.equal((await jsonRequest('/api/admin/routes/202', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot, max_orders, max_units, active }) })).response.status, 200);
  }
  const inactiveRoute = await jsonRequest(`/api/serviceability/202001?date=${tracking.data.order.deliveryDate}`);
  assert.equal(inactiveRoute.data.serviceable, false);
  assert.equal(inactiveRoute.data.acceptingOrders, false);
  assert.deepEqual(inactiveRoute.data.slots, []);
  for (const delivery_slot of ['Morning (6:00 AM - 9:00 AM)', 'Evening (6:00 PM - 9:00 PM)']) {
    const active = true;
    const max_orders = delivery_slot.startsWith('Morning') ? 1 : 80;
    const max_units = delivery_slot.startsWith('Morning') ? 200 : 400;
    assert.equal((await jsonRequest('/api/admin/routes/202', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delivery_slot, max_orders, max_units, active }) })).response.status, 200);
  }
  const stockAdjustment = await jsonRequest('/api/admin/inventory/Traditional%20Dahi/adjust', { method: 'POST', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: 25, note: 'Smoke-test replenishment' }) });
  assert.equal(stockAdjustment.response.status, 200);
  assert.equal(stockAdjustment.data.inventory.availableQty, 274);
  const excessiveReduction = await jsonRequest('/api/admin/inventory/Traditional%20Dahi/adjust', { method: 'POST', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ delta: -100000 }) });
  assert.equal(excessiveReduction.response.status, 409);
  assert.equal(excessiveReduction.data.code, 'INSUFFICIENT_STOCK');
  const emptyInventory = await jsonRequest('/api/admin/inventory/Bilona%20Desi%20Ghee', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ available_qty: 0, low_stock_threshold: 10 }) });
  assert.equal(emptyInventory.response.status, 200);
  const lowStockDashboard = await jsonRequest('/api/admin/dashboard', { headers: { Authorization: basicAuth } });
  assert.equal(lowStockDashboard.data.inventory.find(item => item.product_name === 'Bilona Desi Ghee').low_stock, 1);
  const stockOrder = await jsonRequest('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Stock Customer', phone: '9876543213', pincode: '202001', address: '11 Stock Road, Aligarh', slot: 'Evening (6:00 PM - 9:00 PM)', items: { 'Bilona Desi Ghee': { qty: 1, delivery: 'one-time' } }, payment_method: 'COD' }) });
  assert.equal(stockOrder.response.status, 409);
  assert.equal(stockOrder.data.code, 'OUT_OF_STOCK');

  const setConcurrentStock = await jsonRequest('/api/admin/inventory/Organic%20A2%20Milk', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ available_qty: 50, low_stock_threshold: 10 }) });
  assert.equal(setConcurrentStock.response.status, 200);
  const concurrentOrders = await Promise.all(Array.from({ length: 5 }, (_, index) => jsonRequest('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Concurrent ${index}`, phone: `98765432${20 + index}`, pincode: '202001', address: `${20 + index} Concurrent Road, Aligarh`, slot: 'Evening (6:00 PM - 9:00 PM)', delivery_date: tomorrow, items: { 'Organic A2 Milk': { qty: 20, delivery: 'one-time' } }, payment_method: 'COD' })
  })));
  assert.equal(concurrentOrders.filter(result => result.response.status === 201).length, 2);
  assert.ok(concurrentOrders.filter(result => result.response.status === 201).every(result => result.data.total === 2500));
  assert.equal(concurrentOrders.filter(result => result.data?.code === 'OUT_OF_STOCK').length, 3);
  const inventoryAfterConcurrency = await jsonRequest('/api/admin/operations', { headers: { Authorization: basicAuth } });
  assert.equal(inventoryAfterConcurrency.data.inventory.find(item => item.product_name === 'Organic A2 Milk').available_qty, 10);
  const cancellableOrder = concurrentOrders.find(result => result.response.status === 201);
  const cancellationPath = `/api/orders/track/${cancellableOrder.data.trackingToken}/cancel`;
  const cancellation = await jsonRequest(cancellationPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(cancellation.response.status, 200);
  assert.equal(cancellation.data.order.status, 'Cancelled');
  assert.equal((await jsonRequest(cancellationPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 409);
  const inventoryAfterCancellation = await jsonRequest('/api/admin/operations', { headers: { Authorization: basicAuth } });
  assert.equal(inventoryAfterCancellation.data.inventory.find(item => item.product_name === 'Organic A2 Milk').available_qty, 30);

  const auditLog = await jsonRequest('/api/admin/audit-log', { headers: { Authorization: basicAuth } });
  assert.equal(auditLog.response.status, 200);
  assert.ok(auditLog.data.entries.some(entry => entry.action === 'inventory.updated'));
  assert.ok(auditLog.data.entries.some(entry => entry.action === 'inventory.adjusted'));
  assert.ok(auditLog.data.entries.some(entry => entry.action === 'catalog.updated'));
  assert.ok(auditLog.data.entries.some(entry => entry.action === 'order.cancelled_by_customer'));

  const secondSubscriptionManage = `/api/subscriptions/manage/${secondSubscription.data.managementToken}`;
  const concurrentSkips = await Promise.all([tomorrow, followingDate].map(date => jsonRequest(secondSubscriptionManage, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'skip', date }) })));
  assert.ok(concurrentSkips.every(result => result.response.status === 200));
  const afterConcurrentSkips = await jsonRequest(secondSubscriptionManage);
  assert.ok(afterConcurrentSkips.data.subscription.skipped_dates.includes(tomorrow));
  assert.ok(afterConcurrentSkips.data.subscription.skipped_dates.includes(followingDate), 'Concurrent skip requests must not overwrite each other.');
  assert.equal((await jsonRequest('/api/admin/inventory/Traditional%20Dahi', { method: 'PUT', headers: { Authorization: basicAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ available_qty: 0, low_stock_threshold: 25 }) })).response.status, 200);
  const shortageManifest = await jsonRequest(`/api/admin/delivery-manifest?date=${tomorrow}`, { headers: { Authorization: basicAuth } });
  assert.equal(shortageManifest.data.stockSufficient, false);
  assert.deepEqual(shortageManifest.data.stock, [{ productName: 'Traditional Dahi', requiredSubscriptionUnits: 1, availableUncommittedQty: 0, shortageQty: 1 }]);

  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })).response.status, 200);
  assert.equal((await jsonRequest(managementPath, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })).response.status, 409);

  await new Promise(resolve => setTimeout(resolve, 50));
  if (externalBase) {
    assert.ok(externalLogPath, 'SAMARA_TEST_LOG_PATH is required with an external smoke-test server.');
    output = await readFile(externalLogPath, 'utf8');
  }
  for (const privateReference of [order.data.trackingToken, subscription.data.managementToken, support.data.statusToken]) {
    assert.equal(output.includes(privateReference), false, 'Private bearer references must be redacted from logs.');
  }
  assert.match(output, /\/api\/orders\/track\/:private-reference/);
  assert.match(output, /\/api\/subscriptions\/manage\/:private-reference/);
  assert.match(output, /\/api\/support\/tickets\/:private-reference/);

  console.log('Samara smoke tests passed.');
} catch (error) {
  console.error(error);
  console.error(output);
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  }
}
