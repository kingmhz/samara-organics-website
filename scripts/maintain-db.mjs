import sqlite3 from 'sqlite3';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const days = (environment, name, fallback) => {
  const value = Number(environment[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 36500) throw new Error(`${name} must be between 1 and 36500 days.`);
  return value;
};
const openDatabase = (path, mode) => new Promise((accept, reject) => {
  const database = new sqlite3.Database(path, mode, error => error ? reject(error) : accept(database));
});

export async function maintainDatabase(environment = process.env, logger = console) {
  const databasePath = resolve(environment.DATABASE_PATH || join(process.cwd(), 'samara.db'));
  const policies = {
    idempotency: days(environment, 'IDEMPOTENCY_RETENTION_DAYS', 2),
    audit: days(environment, 'AUDIT_RETENTION_DAYS', 730),
    closedSupport: days(environment, 'CLOSED_SUPPORT_RETENTION_DAYS', 730)
  };
  const database = await openDatabase(databasePath, sqlite3.OPEN_READWRITE);
  database.configure('busyTimeout', 5000);
  const run = (sql, params = []) => new Promise((accept, reject) => database.run(sql, params, function(error) { error ? reject(error) : accept(this.changes); }));
  try {
    await run('BEGIN IMMEDIATE');
    const idempotency = await run("DELETE FROM idempotency_keys WHERE created_at < datetime('now', ?)", [`-${policies.idempotency} days`]);
    const audit = await run("DELETE FROM audit_log WHERE created_at < datetime('now', ?)", [`-${policies.audit} days`]);
    const support = await run("DELETE FROM support_tickets WHERE status = 'Closed' AND updated_at < datetime('now', ?)", [`-${policies.closedSupport} days`]);
    await run('COMMIT');
    await run('PRAGMA optimize');
    const result = { success: true, removed: { idempotency, audit, closedSupport: support }, retentionDays: policies };
    logger.log(JSON.stringify(result));
    return result;
  } catch (error) {
    await run('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await new Promise((accept, reject) => database.close(error => error ? reject(error) : accept()));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await maintainDatabase();
}
