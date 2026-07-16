# Samara Organics production deployment

The application is packaged as a production Docker service with a separate operations worker for verified backups and retention maintenance.

## Required infrastructure

- A container host that supports Docker Compose or two services built from the included `Dockerfile`.
- One persistent volume mounted at `/data` and shared by the web and operations services.
- An HTTPS reverse proxy or managed HTTPS endpoint.
- Independent encrypted off-site storage for copies of `/data/backups`.
- DNS records for `samaraorganics.in` and `www.samaraorganics.in`.

## Required secrets

Create production values from `.env.example`. Never commit the resulting `.env` file.

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` with at least 24 characters
- `IDEMPOTENCY_ENCRYPTION_KEY` with at least 32 characters
- `ALLOWED_ORIGINS` containing only the exact HTTPS website origins

Keep `PAYMENT_PROVIDER_ENABLED=0` until a real payment gateway and signed webhook have been integrated. Cash on delivery is the only production checkout method while it remains disabled.

## Release procedure

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm test`.
4. Run `npm run test:browser`.
5. Run `docker compose build`.
6. Start with `docker compose up -d`.
7. Confirm `/api/health` and `/api/ready` both return HTTP 200.
8. Confirm the public HTTPS response includes HSTS, CSP, `X-Content-Type-Options`, and `X-Frame-Options`.
9. Place a cash-on-delivery test order, verify tracking, then cancel it from the protected admin portal.
10. Confirm a verified `.db` backup and matching `.sha256` file appear in `/data/backups`.

## Launch controls

- Keep inventory and route capacity current in the protected admin portal.
- Validate every A2, organic, pasture, hormone, nutrition and batch-testing claim against current records and packaging approvals.
- Configure external uptime monitoring against `/api/ready`.
- Configure `ERROR_MONITORING_WEBHOOK_URL` to an HTTPS monitoring endpoint.
- Copy backups to independent encrypted storage and perform a restore drill before accepting live orders.
- Do not horizontally scale the SQLite deployment. Migrate to managed PostgreSQL before running multiple web instances.
