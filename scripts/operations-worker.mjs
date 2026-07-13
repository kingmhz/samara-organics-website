import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MINUTE = 60_000;
const parseMinutes = (name, fallback, minimum) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum} minutes.`);
  return Math.floor(value);
};
const parseFailureLimit = () => {
  const value = Number(process.env.OPERATIONS_MAX_CONSECUTIVE_FAILURES || 3);
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error('OPERATIONS_MAX_CONSECUTIVE_FAILURES must be between 1 and 10.');
  return value;
};

const backupInterval = parseMinutes('BACKUP_INTERVAL_MINUTES', 360, 15) * MINUTE;
const maintenanceInterval = parseMinutes('MAINTENANCE_INTERVAL_MINUTES', 1440, 60) * MINUTE;
const maxConsecutiveFailures = parseFailureLimit();
let stopping = false;
let running = Promise.resolve();
let consecutiveFailures = 0;

function log(type, metadata = {}) {
  console.log(JSON.stringify({ type, service: 'samara-operations', ...metadata, timestamp: new Date().toISOString() }));
}

function runScript(filename, operation) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [join(ROOT, 'scripts', filename)], { cwd: ROOT, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        log('operation-complete', { operation, durationMs: Date.now() - startedAt });
        resolve();
      } else reject(new Error(`${operation} exited with ${signal || `code ${code}`}.`));
    });
  });
}

function enqueue(filename, operation, { fatal = false } = {}) {
  const task = running.then(async () => {
    if (stopping) return;
    log('operation-start', { operation });
    try {
      await runScript(filename, operation);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error(JSON.stringify({ type: 'operation-error', service: 'samara-operations', operation, consecutiveFailures, maxConsecutiveFailures, message: String(error.message || error).slice(0, 500), timestamp: new Date().toISOString() }));
      if (fatal || consecutiveFailures >= maxConsecutiveFailures) throw error;
    }
  });
  running = task.catch(() => {});
  return task;
}

log('worker-start', { backupIntervalMinutes: backupInterval / MINUTE, maintenanceIntervalMinutes: maintenanceInterval / MINUTE, maxConsecutiveFailures });
await enqueue('backup-db.mjs', 'database-backup', { fatal: true });
await enqueue('maintain-db.mjs', 'database-maintenance', { fatal: true });

const restartAfterFailure = error => shutdown('operation-failure', 1, error);
const backupTimer = setInterval(() => enqueue('backup-db.mjs', 'database-backup').catch(restartAfterFailure), backupInterval);
const maintenanceTimer = setInterval(() => enqueue('maintain-db.mjs', 'database-maintenance').catch(restartAfterFailure), maintenanceInterval);

async function shutdown(signal, exitCode = 0, error) {
  if (stopping) return;
  stopping = true;
  clearInterval(backupTimer);
  clearInterval(maintenanceTimer);
  log('worker-stop', { signal, exitCode, error: error ? String(error.message || error).slice(0, 300) : undefined });
  await running;
  process.exit(exitCode);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
await new Promise(() => {});
