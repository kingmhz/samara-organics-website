import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const child = spawn(process.execPath, ['scripts/operations-worker.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, BACKUP_INTERVAL_MINUTES: '1', MAINTENANCE_INTERVAL_MINUTES: '60' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const code = await new Promise(resolve => child.once('exit', resolve));
assert.notEqual(code, 0);
assert.match(output, /BACKUP_INTERVAL_MINUTES must be at least 15 minutes/);

const tempRoot = await mkdtemp(join(tmpdir(), 'samara-operations-test-'));
const databasePath = join(tempRoot, 'samara.db');
const backupDir = join(tempRoot, 'backups');
const unavailableWorker = spawn(process.execPath, ['scripts/operations-worker.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, BACKUP_DIR: backupDir, BACKUP_INTERVAL_MINUTES: '15', MAINTENANCE_INTERVAL_MINUTES: '60' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let unavailableOutput = '';
unavailableWorker.stdout.on('data', chunk => { unavailableOutput += chunk; });
unavailableWorker.stderr.on('data', chunk => { unavailableOutput += chunk; });
const unavailableCode = await Promise.race([
  new Promise(resolve => unavailableWorker.once('exit', resolve)),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Worker did not fail fast when its database was unavailable.')), 5_000))
]);
assert.notEqual(unavailableCode, 0);
assert.match(unavailableOutput, /operation-error/);
const previousDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = databasePath;
const databaseModule = await import(`../database.js?operations-test=${Date.now()}`);
await databaseModule.databaseReady;
await databaseModule.closeDatabase();
if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
else process.env.DATABASE_PATH = previousDatabasePath;
const worker = spawn(process.execPath, ['scripts/operations-worker.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, BACKUP_DIR: backupDir, BACKUP_INTERVAL_MINUTES: '15', MAINTENANCE_INTERVAL_MINUTES: '60' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let workerOutput = '';
const startupComplete = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Operations worker did not complete startup tasks.\n${workerOutput}`)), 15_000);
  const inspect = chunk => {
    workerOutput += chunk;
    if ((workerOutput.match(/"type":"operation-complete"/g) || []).length >= 2) {
      clearTimeout(timeout);
      resolve();
    }
  };
  worker.stdout.on('data', chunk => inspect(String(chunk)));
  worker.stderr.on('data', chunk => inspect(String(chunk)));
  worker.once('exit', exitCode => reject(new Error(`Operations worker exited early with ${exitCode}.\n${workerOutput}`)));
});
try {
  await startupComplete;
  assert.ok((await readdir(backupDir)).some(file => file.endsWith('.db')));
} finally {
  worker.kill('SIGTERM');
  await Promise.race([new Promise(resolve => worker.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3_000))]);
  await rm(tempRoot, { recursive: true, force: true });
}
console.log('Operations worker configuration guard passed.');
