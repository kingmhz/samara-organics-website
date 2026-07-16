import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifiedBackup } from './backup-db.mjs';
import { maintainDatabase } from './maintain-db.mjs';

const MINUTE = 60_000;
const parseMinutes = (environment, name, fallback, minimum) => {
  const value = Number(environment[name] || fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be at least ${minimum} minutes.`);
  return Math.floor(value);
};
const parseFailureLimit = environment => {
  const value = Number(environment.OPERATIONS_MAX_CONSECUTIVE_FAILURES || 3);
  if (!Number.isInteger(value) || value < 1 || value > 10) throw new Error('OPERATIONS_MAX_CONSECUTIVE_FAILURES must be between 1 and 10.');
  return value;
};

export function parseOperationsConfiguration(environment = process.env) {
  const backupIntervalMinutes = parseMinutes(environment, 'BACKUP_INTERVAL_MINUTES', 360, 15);
  const maintenanceIntervalMinutes = parseMinutes(environment, 'MAINTENANCE_INTERVAL_MINUTES', 1440, 60);
  return {
    backupIntervalMinutes,
    maintenanceIntervalMinutes,
    backupInterval: backupIntervalMinutes * MINUTE,
    maintenanceInterval: maintenanceIntervalMinutes * MINUTE,
    maxConsecutiveFailures: parseFailureLimit(environment)
  };
}

const event = (logger, type, metadata = {}) => {
  logger.log(JSON.stringify({ type, service: 'samara-operations', ...metadata, timestamp: new Date().toISOString() }));
};
const eventError = (logger, metadata) => {
  const message = JSON.stringify({ type: 'operation-error', service: 'samara-operations', ...metadata, timestamp: new Date().toISOString() });
  (logger.error || logger.log).call(logger, message);
};

async function performOperation(operation, environment, logger) {
  const startedAt = Date.now();
  event(logger, 'operation-start', { operation });
  if (operation === 'database-backup') await createVerifiedBackup(environment, logger);
  else if (operation === 'database-maintenance') await maintainDatabase(environment, logger);
  else throw new Error(`Unsupported operation: ${operation}`);
  event(logger, 'operation-complete', { operation, durationMs: Date.now() - startedAt });
}

export async function runOperationsStartup(environment = process.env, logger = console) {
  const configuration = parseOperationsConfiguration(environment);
  event(logger, 'worker-start', {
    backupIntervalMinutes: configuration.backupIntervalMinutes,
    maintenanceIntervalMinutes: configuration.maintenanceIntervalMinutes,
    maxConsecutiveFailures: configuration.maxConsecutiveFailures
  });
  try {
    await performOperation('database-backup', environment, logger);
    await performOperation('database-maintenance', environment, logger);
    return configuration;
  } catch (error) {
    eventError(logger, {
      operation: 'startup-protection',
      consecutiveFailures: 1,
      maxConsecutiveFailures: configuration.maxConsecutiveFailures,
      message: String(error.message || error).slice(0, 500)
    });
    throw error;
  }
}

export async function runOperationsWorker(environment = process.env, logger = console) {
  const configuration = await runOperationsStartup(environment, logger);
  let stopping = false;
  let running = Promise.resolve();
  let consecutiveFailures = 0;

  const enqueue = operation => {
    const task = running.then(async () => {
      if (stopping) return;
      try {
        await performOperation(operation, environment, logger);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        eventError(logger, {
          operation,
          consecutiveFailures,
          maxConsecutiveFailures: configuration.maxConsecutiveFailures,
          message: String(error.message || error).slice(0, 500)
        });
        if (consecutiveFailures >= configuration.maxConsecutiveFailures) throw error;
      }
    });
    running = task.catch(() => {});
    return task;
  };

  let resolveStop;
  const stopped = new Promise(resolveStopPromise => { resolveStop = resolveStopPromise; });
  const shutdown = async (signal, exitCode = 0, error) => {
    if (stopping) return;
    stopping = true;
    clearInterval(backupTimer);
    clearInterval(maintenanceTimer);
    event(logger, 'worker-stop', { signal, exitCode, error: error ? String(error.message || error).slice(0, 300) : undefined });
    await running;
    resolveStop({ exitCode, error });
  };
  const restartAfterFailure = error => shutdown('operation-failure', 1, error);
  const backupTimer = setInterval(() => enqueue('database-backup').catch(restartAfterFailure), configuration.backupInterval);
  const maintenanceTimer = setInterval(() => enqueue('database-maintenance').catch(restartAfterFailure), configuration.maintenanceInterval);
  const onSigterm = () => shutdown('SIGTERM');
  const onSigint = () => shutdown('SIGINT');
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);
  const result = await stopped;
  process.removeListener('SIGTERM', onSigterm);
  process.removeListener('SIGINT', onSigint);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runOperationsWorker();
  process.exit(result.exitCode);
}
