# Deployment

Self-hosted Docker. One container, SQLite on a named volume, a reverse proxy in
front holding the certificate.

The app had no deployment target at all until recently: `application_url`
pointed at `https://localhost:3000`, the Dockerfile could not build, and the
database was a file inside the image — which would have lost the double-booking
guard on every redeploy.

## Shape, and why

**One container.** SQLite on a single volume has exactly one writer. **Do not
run a second replica, and do not put this behind a load balancer with more than
one backend, without moving to Postgres first** (see below). This is the single
easiest way to corrupt the data.

**A named volume, not a path in the image.** Losing the `OrderSync` table loses
the idempotency guard, which means orders get booked a second time — and under
GoBD a duplicate posting cannot be withdrawn, only corrected with a credit note.

**EU hosting.** A German ERP integration processes German merchants' customer
data. EU residency is effectively a customer requirement and it is a line the
protected-customer-data declaration has to state
(`docs/PROTECTED-CUSTOMER-DATA.md`). Host it accordingly.

**TLS is the proxy's job.** `docker-compose.yml` binds the app to
`127.0.0.1:3000` and nothing else. Shopify requires a valid certificate on the
app's public origin and will not talk to it over plain HTTP, so put it behind
whatever proxy you already run.

## First deploy

```bash
git clone https://github.com/marfoerst/scopevisio_shopify_app.git
cd scopevisio_shopify_app

cp .env.example .env
openssl rand -base64 32          # → SCOPEVISIO_ENCRYPTION_KEY
$EDITOR .env                     # fill in every blank

docker compose up -d --build
curl -s http://127.0.0.1:3000/healthz     # → {"ok":true}
```

⚠️ **`SCOPEVISIO_ENCRYPTION_KEY` is generated once and must never change.**
Rotating it makes every stored Scopevisio credential undecryptable and every
merchant has to reconnect. Back it up somewhere durable — a password manager,
not a shell history — **before** the first merchant connects.

⚠️ **`docker compose down -v` destroys the volume**, and with it every merchant
connection and the double-booking guard. Plain `down` is safe.

### Reverse proxy

Any proxy works. Caddy needs the least configuration because it obtains the
certificate itself:

```
connector.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx or Traefik are equally fine. Three requirements, whatever you use:

- Valid TLS on the public origin. Shopify rejects anything else.
- Forward the `Host` header unchanged. Shopify's HMAC verification and the
  embedded-iframe headers are computed against the public origin.
- Do not buffer or rewrite `/webhooks/*` request bodies. The raw body is what
  the HMAC is verified against.

### Point Shopify at it

`SHOPIFY_APP_URL` in `.env` and `application_url` in `shopify.app.toml` must be
the same origin, or OAuth and the embedded iframe both break. Set both, then:

```bash
npm run shopify -- app deploy
```

That pushes `application_url`, `redirect_urls`, scopes and the webhook
subscriptions to the Partner app. `shopify.app.toml` is the source of truth —
editing the dashboard by hand does not stick.

## Updating

```bash
git pull
docker compose up -d --build
```

`docker-start` runs `prisma migrate deploy` before serving, so a new revision
applies its migrations on boot. Verified: six migrations applied on first boot,
no-op on the second.

## Backups

SQLite is one file, which makes this easy and makes forgetting it expensive.
The database holds merchant credentials (encrypted) and the `OrderSync` table
that prevents double-booking.

```bash
docker compose exec app sh -c \
  'apk add --no-cache sqlite >/dev/null && sqlite3 /data/prod.sqlite ".backup /data/backup.sqlite"'
docker compose cp app:/data/backup.sqlite ./backup-$(date +%F).sqlite
```

Use `.backup`, not `cp` — copying a live SQLite file can capture a torn write.
Back up `SCOPEVISIO_ENCRYPTION_KEY` separately; a database backup without the
key is undecryptable, and a key without a backup is useless.

For continuous replication, Litestream streams SQLite to object storage and is
a better answer than a nightly dump if the merchant count grows.

## Verified

Tested against a clean `git` export and the real image, not assumed:

| Check | Result |
|---|---|
| `docker build` **from a clean clone** | passes. It did not before: `package-lock.json` was gitignored, so `npm ci` failed with "can only install with an existing package-lock.json". The image only ever built on a machine that happened to have the lockfile lying around |
| Container boots and serves | `GET /healthz` → `200 {"ok":true}` |
| Migrations apply on boot | all 6 applied on first boot; "No pending migrations" on the second |
| Runs unprivileged | PID 1 and the server process are `app`, not root (`docker exec` lands as root — that is exec's default, not the app's) |
| Volume ownership | `/data` and `prod.sqlite` owned by `app` — the entrypoint chowns as root then drops privileges, because a mounted volume arrives root-owned and Prisma otherwise dies with "unable to open database file" |
| **Data survives container replacement** | wrote a row, destroyed the container, recreated it against the same volume, row still present |

## Moving to Postgres

Needed if you ever want more than one container, or prefer managed backups.
`prisma/schema.prisma` reads `DATABASE_URL` from the environment already, so:

1. Change the datasource `provider` to `postgresql`.
2. Delete `prisma/migrations` and regenerate — the existing migrations are
   SQLite DDL and will not apply to Postgres.
3. Point `DATABASE_URL` at the Postgres instance.
4. Drop the volume and the single-container constraint from
   `docker-compose.yml`.

Do this before launch if multi-instance ever matters; the schema is small and
there is no production data to migrate yet. Afterwards it is a migration, not an
edit.

## Before the first production deploy

`app/routes/screenshots.$view.tsx` is a screenshot harness. It already returns
404 when `NODE_ENV=production`, and `docker-compose.yml` sets that — but confirm
it holds in your environment. It renders app-like screens with no
authentication and must never be reachable in production.

## Health check

`/healthz` is unauthenticated and queries the database, because the failure that
matters is not "the process is up" but "the process is up **and its volume is
mounted**". A container that boots without its database would serve pages
happily while silently losing the double-booking guard. `docker-compose.yml`
wires it to Docker's own healthcheck; point your monitoring at it too.
