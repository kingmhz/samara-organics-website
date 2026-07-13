import sqlite3 from 'sqlite3';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.env.DATABASE_PATH || join(ROOT, 'samara.db'));
const backupDir = resolve(process.env.BACKUP_DIR || join(ROOT, 'backups'));
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14));
await mkdir(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(backupDir, `samara-${stamp}.db`);
const database = new sqlite3.Database(source, sqlite3.OPEN_READWRITE);
await new Promise((accept, reject) => database.run('VACUUM INTO ?', [destination], error => error ? reject(error) : accept()));
await new Promise((accept, reject) => database.close(error => error ? reject(error) : accept()));

const verification = new sqlite3.Database(destination, sqlite3.OPEN_READONLY);
const integrity = await new Promise((accept, reject) => verification.get('PRAGMA quick_check', (error, row) => error ? reject(error) : accept(row)));
const foreignKeyErrors = await new Promise((accept, reject) => verification.all('PRAGMA foreign_key_check', (error, rows) => error ? reject(error) : accept(rows)));
await new Promise((accept, reject) => verification.close(error => error ? reject(error) : accept()));
if (Object.values(integrity || {})[0] !== 'ok' || foreignKeyErrors.length) {
  await unlink(destination).catch(() => {});
  throw new Error('Backup integrity verification failed.');
}

const checksum = await new Promise((accept, reject) => {
  const hash = createHash('sha256');
  createReadStream(destination).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => accept(hash.digest('hex')));
});
await writeFile(`${destination}.sha256`, `${checksum}  ${basename(destination)}\n`, { encoding: 'utf8', mode: 0o600 });

const cutoff = Date.now() - retentionDays * 86400000;
for (const name of await readdir(backupDir)) {
  if (!/^samara-.*\.db$/.test(name)) continue;
  const path = join(backupDir, name);
  const file = await stat(path);
  if (file.size === 0 || file.mtimeMs < cutoff) {
    await unlink(path);
    await unlink(`${path}.sha256`).catch(() => {});
  }
}
console.log(`Verified database backup created: ${destination}`);
console.log(`SHA-256: ${checksum}`);
