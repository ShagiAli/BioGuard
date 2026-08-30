# Deploying BioGuard

A public demo, at zero cost, on free tiers. Verified against platform
terms in August 2026 — check current limits before relying on any of
this.

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
