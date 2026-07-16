export function productionConfigurationErrors(environment = process.env) {
  if (environment.NODE_ENV !== 'production') return [];

  const adminUsername = environment.ADMIN_USERNAME;
  const adminPassword = environment.ADMIN_PASSWORD;
  const encryptionSecret = environment.IDEMPOTENCY_ENCRYPTION_KEY;
  const paymentProviderEnabled = environment.PAYMENT_PROVIDER_ENABLED === '1';
  const webhookSecret = environment.PAYMENT_WEBHOOK_SECRET;
  const monitoringUrl = environment.ERROR_MONITORING_WEBHOOK_URL;
  const origins = String(environment.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const errors = [];

  if (!adminUsername || adminUsername.length < 4 || /replace-with/i.test(adminUsername)) errors.push('ADMIN_USERNAME must be configured.');
  if (!adminPassword || adminPassword.length < 24 || /replace-with/i.test(adminPassword)) errors.push('ADMIN_PASSWORD must contain at least 24 non-placeholder characters.');
  if (!encryptionSecret || encryptionSecret.length < 32 || /replace-with/i.test(encryptionSecret)) errors.push('IDEMPOTENCY_ENCRYPTION_KEY must contain at least 32 non-placeholder characters.');
  if (paymentProviderEnabled && (!webhookSecret || webhookSecret.length < 32 || /replace-with/i.test(webhookSecret))) errors.push('PAYMENT_WEBHOOK_SECRET must contain at least 32 non-placeholder characters when online payments are enabled.');
  if (!origins.length || origins.some(origin => !/^https:\/\/[^/]+$/i.test(origin))) errors.push('ALLOWED_ORIGINS must contain exact HTTPS origins.');
  if (monitoringUrl && !/^https:\/\//i.test(monitoringUrl)) errors.push('ERROR_MONITORING_WEBHOOK_URL must use HTTPS.');
  return errors;
}

export function paymentMethodsFor(environment = process.env) {
  const isProduction = environment.NODE_ENV === 'production';
  const paymentProviderEnabled = environment.PAYMENT_PROVIDER_ENABLED === '1';
  return ['COD', ...(!isProduction || paymentProviderEnabled ? ['UPI'] : [])];
}
