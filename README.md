# Samara Organics website

Premium multi-page dairy storefront with ordering, subscriptions, batch traceability, farm-tour enquiries, SQLite persistence and a protected administration dashboard.

## Local setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Configure environment variables. Node 20.6+ can load a local file with `node --env-file=.env server.js`.
4. Open `http://127.0.0.1:4173`.

The admin dashboard is at `/admin.html`. It is disabled until `ADMIN_USERNAME` and `ADMIN_PASSWORD` are configured. Browsers will show a secure Basic Authentication prompt.

## Required production configuration

- Set `NODE_ENV=production`.
- Use strong, unique admin, idempotency-encryption and webhook secrets. Keep the encryption key stable across deployments so recent retries remain readable.
- Set exact HTTPS origins in `ALLOWED_ORIGINS`.
- Run behind an HTTPS reverse proxy and set `TRUST_PROXY=1` only when the proxy is trusted.
- Optionally set an HTTPS `ERROR_MONITORING_WEBHOOK_URL` for structured error alerts. Request bodies, customer contacts and private portal tokens are excluded.
- Persist and back up `samara.db`, or migrate to a managed relational database before scaling.
- Production checkout is COD-only by default. Set `PAYMENT_PROVIDER_ENABLED=1` only after integrating and verifying a supported payment gateway; production payment simulation remains disabled.
- Review all organic, A2, hormone, pasture and lab-testing claims before publication.

See `.env.example` for the complete configuration list.

## Commands

- `npm start` — run the full application server.
- `npm run preview` — static visual preview only; APIs will not work.
- `npm run check` — parse-check application scripts.
- `npm run build` — generate minified, content-fingerprinted production assets.
- `npm run backup` — create a consistent SQLite backup and remove expired backup files.
- `npm run maintain` — apply configured retention to idempotency keys, old audit entries and long-closed support tickets.
- `npm run operations` — continuously schedule backups and maintenance using the configured intervals.
- `npm test` — launch an isolated in-memory server and verify security, checkout idempotency, signed webhooks, tracking, serviceability, subscriptions and protected admin access.

## Docker deployment

1. Copy `.env.example` to `.env` and replace every placeholder with a real secret or production origin.
2. Run `docker compose up --build -d`.
3. Confirm readiness at `http://127.0.0.1:4173/api/ready`.
4. Put the container behind an HTTPS reverse proxy or managed container platform.

The `samara-data` volume persists the SQLite database across container replacements. The Compose deployment also starts a separate `samara-operations` worker, which creates a verified backup on startup, repeats backups every six hours and runs retention maintenance daily. It fails fast when startup protection cannot run and restarts after the configured number of consecutive operational failures. For multi-instance or high-volume deployments, migrate persistence to a managed PostgreSQL service before horizontal scaling.

Both containers run without root privileges, drop Linux capabilities, use a read-only application filesystem and write only database/backup data to `/data`. A same-volume backup protects against database corruption and accidental deletion, but not host or account loss: configure the hosting provider to copy `/data/backups` to encrypted, independent object storage and test a restore at least quarterly.

Schedule `npm run maintain` during a quiet period. It does not delete order, subscription or accounting records; those require an approved legal retention policy.

Inventory and delivery-route limits are maintained from the protected **Inventory & Routes** admin tab. Keep these limits current before opening new PIN-code routes.
