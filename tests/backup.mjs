import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'samara-backup-test-'));
const source = join(directory, 'source.db');
const backupDirectory = join(directory, 'backups');
try {
  const database = new sqlite3.Database(source);
  await new Promise((accept, reject) => database.exec("CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE idempotency_keys (created_at DATETIME); CREATE TABLE audit_log (created_at DATETIME); CREATE TABLE support_tickets (status TEXT, updated_at DATETIME); INSERT INTO idempotency_keys VALUES (datetime('now','-10 days')); INSERT INTO audit_log VALUES (datetime('now','-10 days')); INSERT INTO support_tickets VALUES ('Closed', datetime('now','-10 days'));", error => error ? reject(error) : accept()));
  await new Promise((accept, reject) => database.run('INSERT INTO proof (value) VALUES (?)', ['verified'], error => error ? reject(error) : accept()));
  await new Promise((accept, reject) => database.close(error => error ? reject(error) : accept()));
  const result = spawnSync(process.execPath, ['scripts/backup-db.mjs'], { cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: source, BACKUP_DIR: backupDirectory }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified database backup created/);
  const names = await readdir(backupDirectory);
  const backupName = names.find(name => name.endsWith('.db'));
  assert.ok(backupName);
  const content = await readFile(join(backupDirectory, backupName));
  const expected = createHash('sha256').update(content).digest('hex');
  const manifest = await readFile(join(backupDirectory, `${backupName}.sha256`), 'utf8');
  assert.equal(manifest.trim(), `${expected}  ${backupName}`);
  const restored = new sqlite3.Database(join(backupDirectory, backupName), sqlite3.OPEN_READONLY);
  const row = await new Promise((accept, reject) => restored.get('SELECT value FROM proof', (error, value) => error ? reject(error) : accept(value)));
  assert.equal(row.value, 'verified');
  await new Promise((accept, reject) => restored.close(error => error ? reject(error) : accept()));
  const maintenance = spawnSync(process.execPath, ['scripts/maintain-db.mjs'], { cwd: process.cwd(), env: { ...process.env, DATABASE_PATH: source, IDEMPOTENCY_RETENTION_DAYS: '1', AUDIT_RETENTION_DAYS: '1', CLOSED_SUPPORT_RETENTION_DAYS: '1' }, encoding: 'utf8' });
  assert.equal(maintenance.status, 0, maintenance.stderr);
  const maintained = new sqlite3.Database(source, sqlite3.OPEN_READONLY);
  for (const table of ['idempotency_keys', 'audit_log', 'support_tickets']) {
    const count = await new Promise((accept, reject) => maintained.get(`SELECT COUNT(*) AS count FROM ${table}`, (error, value) => error ? reject(error) : accept(value)));
    assert.equal(count.count, 0);
  }
  await new Promise((accept, reject) => maintained.close(error => error ? reject(error) : accept()));
  console.log('Verified backup and restore test passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
