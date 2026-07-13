import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const environment = { ...process.env, NODE_ENV: 'production', DATABASE_PATH: ':memory:' };
delete environment.ADMIN_USERNAME;
delete environment.ADMIN_PASSWORD;
delete environment.PAYMENT_WEBHOOK_SECRET;
delete environment.ALLOWED_ORIGINS;
const result = spawnSync(process.execPath, ['server.js'], { cwd: process.cwd(), env: environment, encoding: 'utf8', timeout: 5000 });
assert.equal(result.status, 1, 'Production must fail closed when secrets and origins are missing.');
assert.match(`${result.stdout}\n${result.stderr}`, /Production configuration is invalid/);
console.log('Production configuration guard passed.');

const invalidMonitoring = spawnSync(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: ':memory:', ADMIN_USERNAME: 'production-admin', ADMIN_PASSWORD: 'A-long-production-password-42-secure', IDEMPOTENCY_ENCRYPTION_KEY: 'A-separate-long-encryption-key-42-secure', PAYMENT_PROVIDER_ENABLED: '0', ALLOWED_ORIGINS: 'https://samaraorganics.in', ERROR_MONITORING_WEBHOOK_URL: 'http://insecure.example/alerts' }, encoding: 'utf8', timeout: 5000 });
assert.equal(invalidMonitoring.status, 1);
assert.match(`${invalidMonitoring.stdout}\n${invalidMonitoring.stderr}`, /ERROR_MONITORING_WEBHOOK_URL must use HTTPS/);

const port = 4900 + Math.floor(Math.random() * 80);
const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: ':memory:', ADMIN_USERNAME: 'production-admin', ADMIN_PASSWORD: 'A-long-production-password-42-secure', IDEMPOTENCY_ENCRYPTION_KEY: 'A-separate-long-encryption-key-42-secure', PAYMENT_PROVIDER_ENABLED: '0', ALLOWED_ORIGINS: 'https://samaraorganics.in', ERROR_MONITORING_WEBHOOK_URL: '' }, stdio: 'ignore' });
try {
  let catalog;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/catalog`); if (response.ok) { catalog = await response.json(); break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(catalog?.paymentMethods, ['COD'], 'Production must remain COD-only until a provider is enabled.');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 2000))]);
}
console.log('Production COD-only guard passed.');
