import sqlite3 from 'sqlite3';
import { join, resolve } from 'node:path';

const databasePath = resolve(process.env.DATABASE_PATH || join(process.cwd(), 'samara.db'));
const days = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 36500) throw new Error(`${name} must be between 1 and 36500 days.`);
  return value;
};
const policies = {
  idempotency: days('IDEMPOTENCY_RETENTION_DAYS', 2),
  audit: days('AUDIT_RETENTION_DAYS', 730),
  closedSupport: days('CLOSED_SUPPORT_RETENTION_DAYS', 730)
};
const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READWRITE);
database.configure('busyTimeout', 5000);
const run = (sql, params = []) => new Promise((accept, reject) => database.run(sql, params, function(error) { error ? reject(error) : accept(this.changes); }));
try {
  await run('BEGIN IMMEDIATE');
  const idempotency = await run("DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)", [`-${policies.idempotency} days`]);
  const audit = await run("DELETE FROM audit_log WHERE created_at < datetime('now', ?)", [`-${policies.audit} days`]);
  const support = await run("DELETE FROM support_tickets WHERE status = 'Closed' AND updated_at < datetime('now', ?)", [`-${policies.closedSupport} days`]);
  await run('COMMIT');
  await run('PRAGMA optimize');
  console.log(JSON.stringify({ success: true, removed: { idempotency, audit, closedSupport: support }, retentionDays: policies }));
} catch (error) {
  await run('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await new Promise((accept, reject) => database.close(error => error ? reject(error) : accept()));
}
