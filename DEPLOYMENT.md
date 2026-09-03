# Deploying BioGuard

A public demo, at zero cost, on free tiers. Verified against platform
terms in August 2026 — check current limits before relying on any of
this.

Two shapes are supported, and they differ in more than the host. The
sections up to and including "Upgrading pg-boss" describe the container
deployment; "Deploying to Vercel and Supabase" describes the serverless
one, which has no long-lived process and therefore no in-process
scheduler. The last section applies to both.

## Shape of the deployment

One web service serving both the API and the built frontend, plus a
managed Postgres elsewhere.

The single-origin part is not a preference. The session cookie is
`SameSite=Strict`, so a frontend on `example.pages.dev` calling an API
on `example.onrender.com` would have the cookie silently dropped by the
browser on every request — login appears to succeed, everything after
it returns 401. The root `Dockerfile` builds both and serves the
frontend from the API's `public/` directory.

## Where to host it

**Database: Neon or Supabase, not the host's free Postgres.** Render's
free Postgres hard-expires 30 days after creation and is then deleted.
People have lost data assuming free meant permanent. Put the database
somewhere that persists.

### If you use Supabase

Two things to know.

**Free projects pause after 7 days of inactivity.** The data is kept,
but the project goes offline until you resume it from the dashboard —
about thirty seconds, but not something to discover five minutes before
showing the demo to someone. Visit the app once a week, or accept the
resume step.

**Use the Session pooler connection string.** The direct connection is
IPv6-only on the free tier; the poolers provide IPv4, which is what most
hosting platforms use. The transaction pooler interferes with prepared
statements unless Prisma is configured for it, so session mode is the
one to take.

**Do not enable Supabase Auth, Storage or RLS for this project.**
BioGuard has its own authentication and its own permission model, which
are among the things it exists to demonstrate. Use Supabase purely as a
Postgres host — that also keeps a future move to any other provider a
connection-string change rather than a rewrite.

**Application: Render's free web service.** It is the only mainstream
platform with a genuine free tier left — Railway and Fly.io both moved
to trial or usage-based models. Free web services get 750 instance-hours
a month and spin down after 15 minutes of inactivity, taking about a
minute to cold-start on the next request. Acceptable for a portfolio
demo; put a note on the README so a reviewer waits rather than assuming
it is broken.

## Environment

```
NODE_ENV=production
PORT=4000
APP_URL=https://your-app.onrender.com     # must match the real URL
DATABASE_URL=postgresql://...              # from Neon or Supabase
SESSION_SECRET=<48 random bytes, base64>
SERVE_WEB=true
MAIL_DRIVER=db
TRUST_PROXY_HOPS=3                         # Render behind Cloudflare
```

`TRUST_PROXY_HOPS` is not cosmetic. Left at the default of 1, `req.ip`
resolves to a Cloudflare address shared by many users, so every
IP-based rate limit buckets unrelated clients together and protects
nobody while still reporting healthy numbers.

**`MAIL_DRIVER=db` stores each message so recipients can read it in the
app, under Mail.** That is what makes the reminder engine visible on a
public demo without sending anything.

The alternative, `log`, discards messages after writing a line. What you
must not do is point real SMTP at this deployment: every seeded engineer
has an `@bioguard.local` address that does not exist. Pointing a real SMTP
provider at those and running the scheduler would send dozens of
messages to invalid recipients — a fast way to get an account
suspended for bounce rate. In `log` mode reminders are written to the
log and still appear in the in-app notification centre, so the feature
demonstrates fine.

## Steps

1. Create a Postgres database on Neon or Supabase. Copy the connection
   string; for Supabase use the **Session pooler** string, not the
   direct connection — the poolers are what provide IPv4, and most PaaS
   hosts connect over IPv4.
2. On Render, create a **Web Service** from the GitHub repository,
   environment **Docker**, using the root `Dockerfile`.
3. Set the environment variables above. Generate the secret with
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
4. Deploy. Migrations run automatically on start.
5. Seed once, from the platform's shell:
   `node dist/prisma/seed.js`. It prints the passwords — save them.
6. Open the URL and sign in.

## Upgrading pg-boss

pg-boss is held at 10 deliberately. Version 12 refuses to migrate an
existing schema — *"Cannot migrate pg-boss schema from version 24: the
oldest supported starting version is 25"* — and 11 fails from 24 as well.
Both were tested against a real database.

Version 12 works perfectly against a **fresh** schema, and for this
application that is a safe route: the `pgboss` schema holds only queue
machinery — `job`, `queue`, `schedule`, `archive` — all of which
`startScheduler()` recreates at boot. Reminder idempotency does not live
there; it lives in `NotificationDispatch`, which is ours and is
untouched. Nothing durable is lost.

So the upgrade is a schema drop plus a redeploy:

```sql
DROP SCHEMA pgboss CASCADE;
```

Do it during the redeploy, not before: whatever is running will recreate
the schema at its own version the moment it reconnects.

One thing to watch afterwards. A failed scheduler does **not** take the
API down — that is deliberate, and it means a botched upgrade looks like
a perfectly healthy site whose reminders have silently stopped. Check
`/api/health` (`scheduler.healthy`) or the Activity area's scheduler
banner after deploying, rather than assuming a 200 on the home page means
the job is running.

Also note the import style changes with the major: pg-boss 10 and 11
export the class as a default, 12 exports it by name.

## Deploying to Vercel and Supabase

The second supported shape, and a different one: there is no long-lived
process at all. The frontend is served from Vercel's CDN, the API is a
serverless function on the same domain, and the nightly sweep is driven
by Vercel Cron.

Single-origin still holds, which is the part that matters for the
session cookie. Vercel serves `web/dist` statically and rewrites
`/api/*` to the function, so the browser only ever sees one host and
`SameSite=Strict` behaves. The cookie sets no `domain` attribute, so it
binds to whatever host answered — nothing to configure.

### What is different, and why

**The scheduler cannot run here.** `scheduler/job.ts` holds a pg-boss
worker that polls Postgres; a serverless function is frozen the moment
it responds, so that worker would start, be suspended before its first
poll, and never fire again. Reminders — the thing this application
exists to do — would stop, and because `index.ts` deliberately keeps the
API serving when the scheduler dies, the deployment would look perfectly
healthy while doing nothing.

So on Vercel `SCHEDULER_MODE=cron`. Vercel Cron calls
`GET /api/cron/sweep` at 02:00, and that endpoint runs
`runScheduledSweep()` — the same function the pg-boss worker runs,
extracted so the two cannot drift. The route is mounted only in cron
mode: the Docker deployment does not carry an unauthenticated trigger it
has no use for.

The endpoint is protected by `CRON_SECRET`, compared in constant time.
The process refuses to boot in cron mode without one, because an open
endpoint that sends mail is not something to leave to a forgotten
variable.

**Rate limits need a shared store.** `express-rate-limit` defaults to
per-process memory, which is correct for one container and misleading
for many: a limit of ten login attempts becomes ten *per warm instance*,
so the control SECURITY.md documents would report healthy numbers while
protecting nobody. `RATE_LIMIT_STORE=postgres` moves the counters into
the `RateLimitHit` table, incremented by a single atomic upsert so
concurrent requests cannot lose a count between a read and a write.

If the store is unreachable it fails **open**, loudly. Closing would
lock everyone out of a working application, and it would save nothing:
every route behind these limiters needs the same database to check a
password or load a session, so a store that cannot be read guards
requests that were going to fail regardless.

**Connections.** Dozens of short-lived instances each opening a pool is
how a generous connection limit disappears. Set `DB_POOL_MAX=1` and use
Supabase's pooler.

### Supabase

Use it purely as a Postgres host. Do not enable Supabase Auth, Storage
or RLS — BioGuard has its own authentication and permission model, which
are among the things it exists to demonstrate, and keeping Supabase to
one job makes a future move a connection-string change.

Take the **Transaction pooler** string (port 6543), not the Session
pooler the container deployment uses. Session mode holds a server
connection for the life of the client connection, which is right for one
container and wrong for many short-lived functions. Both poolers give
you IPv4; the direct connection is IPv6-only on the free tier.

Two free-tier facts worth knowing before they surprise you:

- **Projects pause after 7 days of inactivity.** The data is kept, but
  the project goes offline until resumed from the dashboard.
- **Two active free projects per account.** Restoring a paused project
  fails while two others are running, and the error names the limit
  rather than the project you were trying to start.

### Environment

Set these in the Vercel project, for Production (and Preview if you use
it):

```
NODE_ENV=production
APP_URL=https://your-app.vercel.app     # must match the real URL
DATABASE_URL=postgresql://...            # Supabase transaction pooler, port 6543
SESSION_SECRET=<48 random bytes, base64>
CRON_SECRET=<32 random bytes, hex>
SCHEDULER_MODE=cron
RATE_LIMIT_STORE=postgres
DB_POOL_MAX=1
MAIL_DRIVER=db
TRUST_PROXY_HOPS=1
SERVE_WEB=false
```

`SERVE_WEB=false` because Vercel serves the frontend from its CDN; the
Express static handler would only ever see requests the platform had
already answered.

`TRUST_PROXY_HOPS=1` — Vercel is a single proxy in front of the
function. This is not cosmetic: too low and every client shares one
bucket behind the proxy's address, too high and a client can spoof its
own address through `X-Forwarded-For`.

**`MAIL_DRIVER=db`** stores each message so recipients read it in the
app, under Mail. Do not point real SMTP at this deployment: every seeded
engineer has an `@bioguard.local` address that does not exist, and
running the sweep against a real provider would send dozens of messages
to invalid recipients — a fast way to have an account suspended for
bounce rate.

### Migrations do not run in the build

They used to, and it was wrong three times over.

Prisma Migrate takes a session-scoped advisory lock. Through a
transaction pooler the statement after it can land on a different
backend, which never sees that lock, so `migrate deploy` waits rather
than failing — a build that hangs until the platform kills it. Prisma
handled this with `directUrl` before version 7; that config format no
longer accepts one, so `prisma.config.ts` reads `MIGRATE_DATABASE_URL`
when set and falls back to `DATABASE_URL`.

It also made every deploy depend on the database being awake. A free
Supabase project pauses after 7 days, so the first deploy after a quiet
week would fail in the build rather than in the part that needs a
database.

And preview deployments run the same build. Pointed at the one database
this project has, a preview branch would migrate production.

So migrations are a deliberate step you run, below, against a session-mode
or direct connection. `vercel-build` now only installs, generates,
compiles and bundles — no network, nothing to hang on.

### Steps

1. Create or resume a Supabase project. From Settings → Database you
   want **two** connection strings, and they are not interchangeable:
   - **Transaction pooler** (port 6543) — the application's
     `DATABASE_URL`. Right for many short-lived functions.
   - **Session pooler** (port 5432 on the pooler host) — for migrations
     and seeding. Session mode holds one backend for the connection,
     which is what the advisory lock needs. The direct connection works
     too but is IPv6-only on the free tier.
2. Import the repository on Vercel. Leave the Root Directory at the
   repository root — `vercel.json` drives the build.
3. Set the environment variables above. Generate the secrets with
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
   and
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. Deploy. `vercel-build` installs both packages, generates the Prisma
   client and builds the API and the frontend. It touches no database,
   so it either compiles or it does not.
5. Apply the schema, from your own machine, with `server/.env` pointing
   at the **session** connection:

   ```bash
   npm --prefix server run db:deploy
   ```

   Or set `MIGRATE_DATABASE_URL` to the session string and leave
   `DATABASE_URL` on the pooler, which is the arrangement that survives
   having both in one file.

6. Seed once, against the same connection:
   `npm --prefix server exec -- prisma db seed`. It prints the
   passwords — save them.
7. Open the URL and sign in.

Re-run step 5 after any deploy that carries a new migration. It is
idempotent: a schema already at the latest migration reports that it has
nothing to do.

### Verify the cron, once, by hand

This is the step not to skip. Until the first sweep has run there is no
`SweepRun` row, so `/api/health` reports the scheduler as `unknown`
rather than `stale` — which means a cron that was never wired up looks
exactly like one that is simply not due yet. The health check cannot
tell you; you have to look.

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/sweep
```

A `200` with a scan count means the endpoint, the secret and the
database all work. After that `/api/health` reports `scheduler.healthy`
from the freshness of the last recorded sweep, as it does everywhere
else. Vercel lists invocations under the project's Cron Jobs tab — check
it the morning after the first deploy.

### Known limits of this shape

**Function duration.** Vercel Hobby caps a function at 60 seconds, which
`vercel.json` requests. The sweep is one indexed range query plus a mail
send per due device, which is comfortable for the seeded estate and not
obviously comfortable for a large one. If it starts timing out, the
sweep needs to page rather than the timeout needing raising.

**`argon2` is a native module.** It should be traced and bundled with
the function, but native modules are the most likely thing to break a
first deploy. If it fails to load, `@node-rs/argon2` is a drop-in
alternative with prebuilt binaries — note that changing hashers
invalidates existing password hashes, so re-seed rather than migrate.

**No pg-boss retries.** The worker got retry and cross-instance
deduplication from the queue. A cron invocation is one attempt: if it
fails, the failure is recorded against `SweepRun`, `/api/health` goes
stale within 26 hours, and the next run is the following night. Reminder
idempotency is unaffected — that lives in `NotificationDispatch`, which
is ours, so a re-run sends nothing twice.

## Before you make it public

**Anyone with the demo admin account can change anything**, including
clearing notification history. That is fine for a demo and worth
knowing. If the data drifts, re-run the seed to reset it.

**No backups.** The demo database holds nothing irreplaceable — the
seed regenerates it — but do not put anything real in it.

**The data is fictional.** Northfield Teaching Hospital does not exist,
the staff are invented, and no real patient or device data is present.
Say so on the login screen and in the README, so nobody mistakes a
portfolio demo for a system in clinical use.

**Cold starts.** The first request after 15 minutes idle takes about a
minute. Note it in the README rather than letting a reviewer conclude
the app is broken.
