import sqlite3 from 'sqlite3';
import { join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

const configuredPath = process.env.DATABASE_PATH;
const dbPath = configuredPath === ':memory:' ? ':memory:' : resolve(configuredPath || join(process.cwd(), 'samara.db'));
const configuredRoutePrefixes = [...new Set((process.env.SERVICEABLE_PIN_PREFIXES || '202,203')
  .split(',')
  .map(value => value.trim())
  .filter(value => /^\d{2,6}$/.test(value)))]
  .sort((left, right) => right.length - left.length || left.localeCompare(right));
let db;
let resolveReady;
let rejectReady;

export const databaseReady = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

function run(query, params = []) {
  return new Promise((resolvePromise, reject) => {
    db.run(query, params, function(error) {
      if (error) reject(error);
      else resolvePromise(this);
    });
  });
}

function get(query, params = []) {
  return new Promise((resolvePromise, reject) => {
    db.get(query, params, (error, row) => error ? reject(error) : resolvePromise(row));
  });
}

function all(query, params = []) {
  return new Promise((resolvePromise, reject) => {
    db.all(query, params, (error, rows) => error ? reject(error) : resolvePromise(rows));
  });
}

function isoDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

async function initializeDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');
  await run('PRAGMA synchronous = NORMAL');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    pincode TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    items TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    utr TEXT,
    status TEXT DEFAULT 'Pending',
    delivery_slot TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    delivery_pincode TEXT,
    delivery_route_prefix TEXT,
    delivery_address TEXT,
    total_amount REAL NOT NULL,
    tracking_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    schedule TEXT NOT NULL,
    delivery_slot TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    delivery_pincode TEXT,
    delivery_route_prefix TEXT,
    delivery_address TEXT,
    start_date TEXT,
    end_date TEXT,
    custom_dates TEXT,
    status TEXT DEFAULT 'Active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    date TEXT NOT NULL,
    fat REAL NOT NULL,
    snf REAL NOT NULL,
    antibiotics INTEGER DEFAULT 0,
    quality_score INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, key)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    request_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS inventory (
    product_name TEXT PRIMARY KEY,
    available_qty INTEGER NOT NULL CHECK(available_qty >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 20,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS catalog_products (
    product_name TEXT PRIMARY KEY,
    price INTEGER NOT NULL CHECK(price > 0),
    unit TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS route_capacity (
    pincode_prefix TEXT NOT NULL,
    delivery_slot TEXT NOT NULL,
    max_orders INTEGER NOT NULL,
    max_units INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (pincode_prefix, delivery_slot)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_reference TEXT UNIQUE NOT NULL,
    status_token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    category TEXT NOT NULL,
    order_reference TEXT,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Received',
    resolution_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const orderColumns = await all('PRAGMA table_info(orders)');
  if (!orderColumns.some(column => column.name === 'tracking_token')) await run('ALTER TABLE orders ADD COLUMN tracking_token TEXT');
  if (!orderColumns.some(column => column.name === 'delivery_date')) await run('ALTER TABLE orders ADD COLUMN delivery_date TEXT');
  if (!orderColumns.some(column => column.name === 'order_units')) await run('ALTER TABLE orders ADD COLUMN order_units INTEGER NOT NULL DEFAULT 0');
  if (!orderColumns.some(column => column.name === 'customer_name')) await run('ALTER TABLE orders ADD COLUMN customer_name TEXT');
  if (!orderColumns.some(column => column.name === 'customer_phone')) await run('ALTER TABLE orders ADD COLUMN customer_phone TEXT');
  if (!orderColumns.some(column => column.name === 'delivery_pincode')) await run('ALTER TABLE orders ADD COLUMN delivery_pincode TEXT');
  if (!orderColumns.some(column => column.name === 'delivery_route_prefix')) await run('ALTER TABLE orders ADD COLUMN delivery_route_prefix TEXT');
  if (!orderColumns.some(column => column.name === 'delivery_address')) await run('ALTER TABLE orders ADD COLUMN delivery_address TEXT');
  await run(`UPDATE orders SET
    customer_name = COALESCE(customer_name, (SELECT name FROM users WHERE users.id = orders.user_id)),
    customer_phone = COALESCE(customer_phone, (SELECT phone FROM users WHERE users.id = orders.user_id)),
    delivery_pincode = COALESCE(delivery_pincode, (SELECT pincode FROM users WHERE users.id = orders.user_id)),
    delivery_address = COALESCE(delivery_address, (SELECT address FROM users WHERE users.id = orders.user_id))
    WHERE customer_name IS NULL OR customer_phone IS NULL OR delivery_pincode IS NULL OR delivery_address IS NULL`);
  const subscriptionColumns = await all('PRAGMA table_info(subscriptions)');
  if (!subscriptionColumns.some(column => column.name === 'management_token')) await run('ALTER TABLE subscriptions ADD COLUMN management_token TEXT');
  if (!subscriptionColumns.some(column => column.name === 'skipped_dates')) await run('ALTER TABLE subscriptions ADD COLUMN skipped_dates TEXT');
  if (!subscriptionColumns.some(column => column.name === 'end_date')) await run('ALTER TABLE subscriptions ADD COLUMN end_date TEXT');
  if (!subscriptionColumns.some(column => column.name === 'customer_name')) await run('ALTER TABLE subscriptions ADD COLUMN customer_name TEXT');
  if (!subscriptionColumns.some(column => column.name === 'customer_phone')) await run('ALTER TABLE subscriptions ADD COLUMN customer_phone TEXT');
  if (!subscriptionColumns.some(column => column.name === 'delivery_pincode')) await run('ALTER TABLE subscriptions ADD COLUMN delivery_pincode TEXT');
  if (!subscriptionColumns.some(column => column.name === 'delivery_route_prefix')) await run('ALTER TABLE subscriptions ADD COLUMN delivery_route_prefix TEXT');
  if (!subscriptionColumns.some(column => column.name === 'delivery_address')) await run('ALTER TABLE subscriptions ADD COLUMN delivery_address TEXT');
  await run(`UPDATE subscriptions SET
    customer_name = COALESCE(customer_name, (SELECT name FROM users WHERE users.id = subscriptions.user_id)),
    customer_phone = COALESCE(customer_phone, (SELECT phone FROM users WHERE users.id = subscriptions.user_id)),
    delivery_pincode = COALESCE(delivery_pincode, (SELECT pincode FROM users WHERE users.id = subscriptions.user_id)),
    delivery_address = COALESCE(delivery_address, (SELECT address FROM users WHERE users.id = subscriptions.user_id))
    WHERE customer_name IS NULL OR customer_phone IS NULL OR delivery_pincode IS NULL OR delivery_address IS NULL`);

  // Assign each historical delivery to one exact route. Longest prefixes run first,
  // so an address in 202 never consumes capacity from a broader 20 route.
  if (configuredRoutePrefixes.length) {
    const placeholders = configuredRoutePrefixes.map(() => '?').join(', ');
    await run(`UPDATE orders SET delivery_route_prefix = NULL WHERE delivery_route_prefix IS NOT NULL AND delivery_route_prefix NOT IN (${placeholders})`, configuredRoutePrefixes);
    await run(`UPDATE subscriptions SET delivery_route_prefix = NULL WHERE delivery_route_prefix IS NOT NULL AND delivery_route_prefix NOT IN (${placeholders})`, configuredRoutePrefixes);
    for (const prefix of configuredRoutePrefixes) {
      await run('UPDATE orders SET delivery_route_prefix = ? WHERE delivery_route_prefix IS NULL AND delivery_pincode LIKE ?', [prefix, `${prefix}%`]);
      await run('UPDATE subscriptions SET delivery_route_prefix = ? WHERE delivery_route_prefix IS NULL AND delivery_pincode LIKE ?', [prefix, `${prefix}%`]);
    }
  }

  await run('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_orders_route_capacity ON orders(delivery_date, delivery_slot, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_orders_route_snapshot ON orders(delivery_date, delivery_slot, delivery_route_prefix, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_orders_exact_route_capacity ON orders(delivery_date, delivery_slot, delivery_route_prefix, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_route_snapshot ON subscriptions(delivery_slot, delivery_route_prefix, status)');
  await run('CREATE INDEX IF NOT EXISTS idx_subscriptions_exact_route_capacity ON subscriptions(delivery_slot, delivery_route_prefix, status)');
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_management_token ON subscriptions(management_token) WHERE management_token IS NOT NULL');
  await run('CREATE INDEX IF NOT EXISTS idx_users_pincode ON users(pincode)');
  await run('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_support_status_created ON support_tickets(status, created_at DESC)');
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_utr_unique ON orders(utr) WHERE utr IS NOT NULL AND utr <> ''").catch(error => console.warn('Could not enforce unique payment references:', error.message));
  await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_token ON orders(tracking_token) WHERE tracking_token IS NOT NULL');
  const idempotencyRetention = Math.min(Math.max(Number(process.env.IDEMPOTENCY_RETENTION_DAYS || 2), 1), 30);
  await run("DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)", [`-${idempotencyRetention} days`]);

  // Remove early design-demo certificates. Public batch records must now be
  // created deliberately in the authenticated admin portal from real results.
  await run("DELETE FROM batches WHERE id IN ('B2026-0712', 'B2026-0711', 'G2026-0701')");
  await run('INSERT OR IGNORE INTO inventory (product_name, available_qty, low_stock_threshold) VALUES (?, ?, ?)', ['Organic A2 Milk', 500, 50]);
  await run('INSERT OR IGNORE INTO inventory (product_name, available_qty, low_stock_threshold) VALUES (?, ?, ?)', ['Bilona Desi Ghee', 100, 10]);
  await run('INSERT OR IGNORE INTO inventory (product_name, available_qty, low_stock_threshold) VALUES (?, ?, ?)', ['Traditional Dahi', 250, 25]);
  await run('INSERT OR IGNORE INTO catalog_products (product_name, price, unit, sort_order) VALUES (?, ?, ?, ?)', ['Organic A2 Milk', 110, '1 L', 1]);
  await run('INSERT OR IGNORE INTO catalog_products (product_name, price, unit, sort_order) VALUES (?, ?, ?, ?)', ['Bilona Desi Ghee', 749, '500 ML', 2]);
  await run('INSERT OR IGNORE INTO catalog_products (product_name, price, unit, sort_order) VALUES (?, ?, ?, ?)', ['Traditional Dahi', 89, '500 G', 3]);
  await run("UPDATE catalog_products SET unit = '500 G' WHERE product_name = 'Traditional Dahi' AND unit = '500 ML'");
  for (const prefix of configuredRoutePrefixes) {
    for (const slot of ['Morning (6:00 AM - 9:00 AM)', 'Evening (6:00 PM - 9:00 PM)']) {
      await run('INSERT OR IGNORE INTO route_capacity (pincode_prefix, delivery_slot, max_orders, max_units) VALUES (?, ?, ?, ?)', [prefix, slot, 80, 200]);
    }
  }
}

db = new sqlite3.Database(dbPath, async error => {
  if (error) {
    console.error('Error opening SQLite database:', error);
    rejectReady(error);
    return;
  }
  console.log('Connected to SQLite database at:', dbPath);
  db.configure('busyTimeout', 5000);
  try {
    await initializeDatabase();
    console.log('Database tables successfully initialized.');
    resolveReady();
  } catch (initializationError) {
    console.error('Database initialization failed:', initializationError);
    rejectReady(initializationError);
  }
});

let operationQueue = Promise.resolve();
const transactionContext = new AsyncLocalStorage();
const enqueueExclusive = work => {
  const result = operationQueue.then(work, work);
  operationQueue = result.catch(() => {});
  return result;
};
const inTransaction = () => transactionContext.getStore() === true;
export const dbRun = (query, params = []) => inTransaction() ? run(query, params) : enqueueExclusive(() => run(query, params));
export const dbGet = (query, params = []) => inTransaction() ? get(query, params) : enqueueExclusive(() => get(query, params));
export const dbAll = (query, params = []) => inTransaction() ? all(query, params) : enqueueExclusive(() => all(query, params));
export const dbExclusive = work => inTransaction() ? work() : enqueueExclusive(work);
export const dbTransaction = work => enqueueExclusive(() => transactionContext.run(true, async () => {
  await run('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await run('COMMIT');
    return result;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  }
}));

export const closeDatabase = () => dbExclusive(() => new Promise((resolvePromise, reject) => {
  db.close(error => error ? reject(error) : resolvePromise());
}));
