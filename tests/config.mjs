import assert from 'node:assert/strict';
import { paymentMethodsFor, productionConfigurationErrors } from '../production-config.js';

const environment = { ...process.env, NODE_ENV: 'production', DATABASE_PATH: ':memory:' };
delete environment.ADMIN_USERNAME;
delete environment.ADMIN_PASSWORD;
delete environment.PAYMENT_WEBHOOK_SECRET;
delete environment.IDEMPOTENCY_ENCRYPTION_KEY;
delete environment.ALLOWED_ORIGINS;
const errors = productionConfigurationErrors(environment);
assert.ok(errors.some(error => /ADMIN_USERNAME/.test(error)));
assert.ok(errors.some(error => /ADMIN_PASSWORD/.test(error)));
assert.ok(errors.some(error => /IDEMPOTENCY_ENCRYPTION_KEY/.test(error)));
assert.ok(errors.some(error => /ALLOWED_ORIGINS/.test(error)));
console.log('Production configuration guard passed.');

const invalidMonitoring = productionConfigurationErrors({ ...process.env, NODE_ENV: 'production', ADMIN_USERNAME: 'production-admin', ADMIN_PASSWORD: 'A-long-production-password-42-secure', IDEMPOTENCY_ENCRYPTION_KEY: 'A-separate-long-encryption-key-42-secure', PAYMENT_PROVIDER_ENABLED: '0', ALLOWED_ORIGINS: 'https://samaraorganics.in', ERROR_MONITORING_WEBHOOK_URL: 'http://insecure.example/alerts' });
assert.ok(invalidMonitoring.some(error => /ERROR_MONITORING_WEBHOOK_URL must use HTTPS/.test(error)));

assert.deepEqual(paymentMethodsFor({ NODE_ENV: 'production', PAYMENT_PROVIDER_ENABLED: '0' }), ['COD'], 'Production must remain COD-only until a provider is enabled.');
assert.deepEqual(paymentMethodsFor({ NODE_ENV: 'production', PAYMENT_PROVIDER_ENABLED: '1' }), ['COD', 'UPI']);
console.log('Production COD-only guard passed.');
