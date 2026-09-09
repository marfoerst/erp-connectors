# Deployment

The app had no deployment target at all until now: `application_url` pointed at
`https://localhost:3000`, the Dockerfile could not build, and the database was a
file inside the image. That combination fails App Store requirement 3.1.1 (a
valid TLS certificate) and would have lost data on every redeploy.

`fly.toml` is a working configuration. Adapt or replace it if Scopevisio hosts
this itself — the point is that the app is now deployable and verified, not that
Fly is the only option.

## Why this shape

**Frankfurt (`fra`).** A German ERP integration processes German merchants'
customer data. EU residency is effectively a customer requirement, and it is a
line the protected-customer-data declaration has to state
(`docs/PROTECTED-CUSTOMER-DATA.md`).

**A persistent volume, not a file in the image.** Losing the `OrderSync` table
loses the idempotency guard, which means orders get booked a second time — and
under GoBD a duplicate posting cannot be withdrawn, only corrected with a
credit note. The database must outlive the container.

**One machine.** SQLite on a single volume has exactly one writer, so
`auto_stop_machines` is off and `min_machines_running` is 1. **Do not scale past
one machine without moving to Postgres first** — see below.

## First deploy

```bash
fly launch --no-deploy            # or: fly apps create scopevisio-shopify-connector
fly volumes create connector_data --region fra --size 1

# Secrets, not env vars — these are credentials.
fly secrets set \
  SHOPIFY_API_KEY=...             \
  SHOPIFY_API_SECRET=...          \
  SCOPEVISIO_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  SUPPORT_URL=https://...         \
  PRIVACY_POLICY_URL=https://...

fly deploy
```

Then point Shopify at the host and push the config:

```bash
# In shopify.app.toml, set application_url and redirect_urls to the Fly host,
# then:
npm run shopify -- app deploy
```

⚠️ **`SCOPEVISIO_ENCRYPTION_KEY` must never change after merchants connect.**
Rotating it makes every stored Scopevisio credential undecryptable and every
merchant has to reconnect. Back it up somewhere durable before going live.

## Verified

Tested locally against the real image, not assumed:

| Check | Result |
|---|---|
| `docker build` | passes (it did not before — `remix vite:build` needs vite, which `npm ci --omit=dev` had removed) |
| Container boots and serves | `GET /healthz` → `200 {"ok":true}` |
| Migrations apply on boot | all 6 applied on first boot; no-op on the second |
| Runs unprivileged | process runs as `app`, not root |
| Volume ownership | `/data` and `prod.sqlite` owned by `app` — the entrypoint chowns as root then drops privileges, because a mounted volume arrives root-owned and Prisma otherwise dies with "unable to open database file" |
| **Data survives a redeploy** | wrote a row, destroyed and recreated the container against the same volume, row still present |

## Moving to Postgres

Needed if you ever want more than one machine, or prefer managed backups.
`prisma/schema.prisma` reads `DATABASE_URL` from the environment already, so:

1. Change the datasource `provider` to `postgresql`.
2. Delete `prisma/migrations` and regenerate — the existing migrations are
   SQLite DDL and will not apply to Postgres.
3. Point `DATABASE_URL` at the Postgres instance (`fly postgres create --region fra`).
4. Drop the `[[mounts]]` block and the single-machine constraints from `fly.toml`.

Do this before launch if multi-instance matters; the schema is small and there
is no production data to migrate yet.

## Health check

`/healthz` is unauthenticated and queries the database, because the failure that
matters is not "the process is up" but "the process is up **and its volume is
mounted**". A container that boots without its database would serve pages
happily while silently losing the double-booking guard.
