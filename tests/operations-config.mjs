import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOperationsConfiguration, runOperationsStartup } from '../scripts/operations-worker.mjs';

assert.throws(
  () => parseOperationsConfiguration({ ...process.env, BACKUP_INTERVAL_MINUTES: '1', MAINTENANCE_INTERVAL_MINUTES: '60' }),
  /BACKUP_INTERVAL_MINUTES must be at least 15 minutes/
);

const tempRoot = await mkdtemp(join(tmpdir(), 'samara-operations-test-'));
const databasePath = join(tempRoot, 'samara.db');
const backupDir = join(tempRoot, 'backups');
let unavailableOutput = '';
const captureUnavailable = {
  log(message) { unavailableOutput += `${message}\n`; },
  error(message) { unavailableOutput += `${message}\n`; }
};
await assert.rejects(
  runOperationsStartup({ ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, BACKUP_DIR: backupDir, BACKUP_INTERVAL_MINUTES: '15', MAINTENANCE_INTERVAL_MINUTES: '60' }, captureUnavailable)
);
assert.match(unavailableOutput, /operation-error/);
const previousDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = databasePath;
const databaseModule = await import(`../database.js?operations-test=${Date.now()}`);
await databaseModule.databaseReady;
await databaseModule.closeDatabase();
if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
else process.env.DATABASE_PATH = previousDatabasePath;
let workerOutput = '';
const captureWorker = {
  log(message) { workerOutput += `${message}\n`; },
  error(message) { workerOutput += `${message}\n`; }
};
try {
  await runOperationsStartup({ ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, BACKUP_DIR: backupDir, BACKUP_INTERVAL_MINUTES: '15', MAINTENANCE_INTERVAL_MINUTES: '60' }, captureWorker);
  assert.equal((workerOutput.match(/"type":"operation-complete"/g) || []).length, 2);
  assert.ok((await readdir(backupDir)).some(file => file.endsWith('.db')));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
console.log('Operations worker configuration guard passed.');
