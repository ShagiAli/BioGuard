[![CI](https://github.com/ShagiAli/BioGuard/actions/workflows/ci.yml/badge.svg)](https://github.com/ShagiAli/BioGuard/actions/workflows/ci.yml)

# BioGuard

**Preventive maintenance management for hospital biomedical engineering departments.**

**[Live demo](https://bio-guard-pink.vercel.app)** — credentials
available on request.

> The first request after a quiet period takes a few seconds: the API
> is a serverless function that scales to zero, so it boots Express and
> connects to Postgres before answering. All data is fictional —
> Northfield Teaching Hospital does not exist, and no real patient or
> device information is present.

Hospitals run thousands of medical devices, each needing scheduled
servicing on its own cycle. Tracking that in spreadsheets works until it
doesn't: a ventilator's service slips by three weeks, nobody notices,
and there is no record of when the schedule started drifting. BioGuard
is an equipment inventory with a preventive maintenance engine that
escalates on its own and keeps an auditable trail of every schedule
change.

Built with TypeScript, Express 5, PostgreSQL, Prisma and React 19.

![Dashboard](docs/dashboard.png)

*Every figure on the dashboard opens the equipment behind it, filtered by
the same predicate the count was computed from — so a headline number
and the list under it cannot disagree.*

---

## The interesting problem

Most of this application is ordinary CRUD. One part is not, and it is
where the design effort went.

**When maintenance is completed late, what happens to the schedule?**

Two obvious answers are both wrong:

- *Always re-base onto the completion date.* A 90-day device serviced
  two weeks late every cycle drifts forward eight weeks a year. After
  three years "quarterly" means nothing, and no signal was ever raised.
- *Always keep the original anchor.* Service a device 25 days late and
  its next service falls 65 days later instead of 90 — punishing the
  technician for the delay and servicing the device before it needs it.

BioGuard uses a **grace window**, defaulting to 20% of the interval.
Work completed inside the window keeps the original anchor, so the
schedule stays stable through ordinary delays. Work completed outside it
re-bases onto the completion date **and records that a re-base
happened** — because a re-base is the signal that the programme is
slipping, and it should be visible in reporting rather than quietly
absorbed. Devices governed by an external certificate can be set to a
hard anchor that never re-bases.

That rule lives in [`server/src/scheduler/rules.ts`](server/src/scheduler/rules.ts)
as pure functions taking the reference date as an argument. Nothing in
it reads the clock or touches the database, which is what lets the same
code run as a nightly job, as a test, and as a demo control that jumps
forward in time — with no test-only branches.

![Device detail](docs/device.png)

*A device whose service ran past the grace window. The re-base is
recorded on the maintenance record and badged in the history, rather
than the schedule quietly shifting.*

![Equipment filtered to overdue](docs/equipment.png)

*Filters live in the URL, so a drill-down is a plain link, the back
button behaves, and a filtered view can be sent to a colleague.*

## Architecture

```
web/                 React 19 · Vite · Tailwind v4 · TanStack Query
  └── /api proxied to the server, so the session cookie is first-party

server/
  src/app.ts         Express assembly — mountable by tests
  src/index.ts       process bootstrap: socket, scheduler, shutdown
  src/middleware/    session loading, role checks, query scoping
  src/modules/       auth · equipment · maintenance · admin
                     notifications · audit · users · views
                     alerts · work-orders · cron
web/ pages           dashboard · equipment · alerts · work orders
                     notifications · activity · people · public scan
  src/scheduler/
      rules.ts       pure scheduling logic, no I/O
      job.ts         pg-boss wiring for the nightly sweep
  src/lib/           prisma · logger · email · audit · security
  prisma/schema.prisma

PostgreSQL           UUIDv7 primary keys, pg-boss queue in its own schema
Mailpit              catches outgoing mail in development
```

**Notifications and mail are different things, deliberately.** A
notification is what somebody sees when they open BioGuard. Mail is what
reaches them when they do not. For a while they were the same list on two
pages, because mail was being written to a table the application then
rendered as a mailbox — so the thing that was supposed to reach a person
who was not looking only reached a person who was.

Now every message is recorded in `SentEmail` as an outbox — proof of what
was sent, to whom and when, with nothing rendering it — and delivered as
well when `MAIL_DRIVER=smtp` and a server is configured. Anything else
records and stops, which is what a deployment whose addresses do not
exist wants: seeded accounts default to `@bioguard.local`, and sending
there would produce nothing but bounces. Real addresses come from
`SEED_EMAIL_BASE` rather than from the seed file, because this
repository is public and an address committed to it gets scraped.

Who gets what follows from who can act on it:

| Message | Goes to |
| --- | --- |
| A fault is reported | Head of alerts, administrators — plus managers when it is an emergency |
| A fault is assigned | The engineer, with its priority and how long they have to acknowledge |
| Preventive maintenance falls due | The device's engineer, with days remaining and the device's criticality |
| A repair needs a part | Administrators and managers, who are the ones who can order it |
| A fault is acknowledged or resolved | Whoever reported it |

Managers are copied on emergencies rather than on everything: a person
copied on every routine fault learns to filter the sender, and then
misses the one that mattered.

**One message per person per sweep, not one per device.** The
notification feed gets a row for every rung, because there each is a
thing to click. A mailbox gets a list, because there five separate
emails are five things to open before you know what your day looks like.
A device that crosses several thresholds as the sweep advances appears
once, at its most urgent rung, and the subject names it:

```
URGENT: Ventilator (A1000) and 2 more need maintenance
```

**People are managed in the application, not in the database.** An
address is only useful while the person behind it is still there, so
administrators and managers can correct one, invite a colleague, and
close an account. A leaver is never edited into being their replacement:
that account signed the services in the history, and pointing it at
somebody new would say they serviced devices before they were hired.
Their live work — devices watched, alerts open, repairs under way —
hands over in one transaction; their completed work stays theirs; then
the account closes. Deactivation is refused while any of it is
outstanding, and says how much.

### Decisions worth explaining

**UUIDv7 primary keys, generated by the application.** Time-ordered
identifiers keep inserts at the right-hand edge of the index instead of
scattering them, which is the main cost of UUIDv4 as a primary key.
Postgres only gained a built-in `uuidv7()` in version 18 and hosted
platforms lag behind, so Prisma generates them instead — the benefit
comes from the bit layout, not from where the value is produced, and
this runs on any Postgres version.

**`nextDueAt` is a stored, indexed column, not derived on read.** The
nightly sweep must be one indexed range scan rather than a computation
across the whole estate. Storing it also preserves historical due dates:
deriving them from the current interval would silently rewrite history
whenever an interval changed.

**Reminder idempotency is a database constraint, not application
logic.** A unique index on `(equipmentId, dueDate, threshold)` is what
guarantees a reminder sends once. The sweep inserts with
`skipDuplicates`, so a day already processed is an ordinary no-op and
two workers racing produce one email, not two.

**Operational status and maintenance state are separate.** A device can
be under repair *and* overdue for preventive maintenance at the same
time — those are two independent facts. A single status enum would force
one to overwrite the other.

**Sessions are database-backed, not JWTs.** Stateless tokens cannot be
revoked, which means a departed employee stays authenticated until
expiry. Wrong trade for a hospital.

**QR codes encode an opaque token, not the asset tag.** Asset tags are
sequential; a QR carrying one would let anyone who photographs a single
label enumerate the entire estate through the public scan endpoint.
Scanning a label opens `/e/:token`, an unauthenticated page showing four
fields — name, asset number, status and location — because the person
reading it is standing at a bedside with a phone and no session.

**Corrective work does not reset the preventive clock.** Fixing a broken
sensor is not the scheduled service and must not buy the device another
cycle.

**Corrective work is a separate pipeline from preventive work.** A nurse
reports a fault, the head of alerts confirms receipt and assigns it, an
engineer opens a work order, and closing it returns the device to service.
The two pipelines meet at exactly one point: closing a work order writes a
`CORRECTIVE` maintenance record, so the repair joins the device's history
— but because only `PREVENTIVE` work resets the schedule, a repair never
buys the device another maintenance cycle. Work-order status also drives
`operationalStatus`, so a device under repair says so on the equipment
list without anyone remembering to set it.

**Every dashboard figure opens the rows it counted.** The corrective
figures follow the same rule as the preventive ones: each is a link to
the list filtered by the predicate the count came from, and both are
scoped identically on the server. A count produced by a different
predicate from the list behind it is worse than no count, because it
looks authoritative and disagrees. The archive is that same work-order
list with one filter, not a second screen reading a second table.

**A part climbs its ladder one rung at a time.** Required, requested,
ordered, received, installed — each with its own timestamp, because "when
did we order it?" is the question a stalled repair always raises. Skipping
is refused, and a work order cannot close while any part is unfitted: a
device must not go back to the ward with a component still on order.
Cancelling exists so a line raised in error can be retired honestly rather
than deleted or, worse, marked installed.

**Status transitions live in one pure function, not in the handlers.**
`modules/alerts/workflow.ts` decides which moves are legal and for which
role; routes ask it and are told. A status column any endpoint can write
becomes untraceable within a month, and the permission rules end up
restated slightly differently in a dozen places.

**A scheduler that stops is louder than one that fails.** The API stays
up when the scheduler dies — engineers can still record work — which
means the dangerous failure is the quiet one: reminders stop and the site
looks perfectly healthy. Liveness is therefore judged by the *absence* of
a recent sweep rather than by error reporting, because a process that has
crashed cannot report its own failure. `/api/health` still returns 200 so
the container is not restart-looped for a degradation it can serve
through, and the warning is raised in the body and in the UI instead.

**The audit trail is readable, not just written.** Every status change
and every maintenance record goes through a per-entity field allowlist
into `AuditLog`, and both a per-device history and an estate-wide feed
read it back. Filtering that feed to schedule re-bases is the slippage
report the grace-window design argues for: a re-base is recorded exactly
when work landed outside the window.

## Testing

```bash
npm test                   # pure — no database needed

# The integration suite truncates every table, so it insists on a
# database with "test" in the name and refuses anything else.
docker exec bioguard-db psql -U bioguard -d bioguard -c "CREATE DATABASE bioguard_test;"
export DATABASE_URL="postgresql://bioguard:bioguard_dev_only@localhost:5432/bioguard_test?schema=public"
npm run db:deploy
npm run test:integration
```

**96 unit tests** cover the grace window in both directions, the
reminder ladder firing on its rungs and staying silent between them,
calendar arithmetic across DST boundaries, SLA response windows, and the
guard that decides which database the integration suite may destroy.

**87 integration tests** run against a real database rather than mocks,
because the design leans on database constraints and mocking them would
verify nothing. They assert properties, not just outputs:

- an engineer sees one department, an administrator sees the estate
- an out-of-scope device returns 404, not 403 — a 403 confirms it exists
- a wrong password and an unknown account produce identical responses
- the QR token never appears in a list or detail payload
- unknown request keys are rejected outright
- running the scheduler twice over the same dates sends nothing the
  second time
- a manager cannot edit an administrator, nor grant the role — otherwise
  the escalation is two steps and needs no password
- an engineer cannot be deactivated while they still hold live work
- the sweep writes nothing to somebody who has left
- one email per engineer, however many rungs they crossed

CI runs lint, typecheck, format check, both suites against a PostgreSQL
service container, and a frontend build.

## Running it

Requires **Node 22+** and **Docker**.

```bash
docker compose up -d               # PostgreSQL 18 + Mailpit

cd server
cp .env.example .env               # then set SESSION_SECRET
npm install
npm run db:migrate                 # name it "init"
npm run db:seed                    # 20 devices; prints logins once
npm run dev                        # API on :4000

cd ../web
npm install
npm run dev                        # UI on :5173
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

The server refuses to start without one — no secret gets a fallback
default. The seed generates passwords rather than shipping any, so there
is no default account in this repository.

| Command | |
| --- | --- |
| `npm run db:studio` | browse the data in a UI |
| `npm run lint` / `typecheck` / `format` | quality gates |
| `docker compose down -v` | wipe the database |

Mailpit's inbox is at **http://localhost:8025**.

### Seeing the reminder engine work

A maintenance reminder system does its work once a month at 02:00, which
makes it nearly impossible to demonstrate. Signing in as an
administrator exposes a control that replays the real nightly sweep a
week forward, against real data — the same `runSweep()` the cron job
calls, not a mock. Reminders appear in the notification centre, and the
email goes wherever the engineer's address points. Press it twice and
the second run sends nothing, which is the idempotency constraint
working; **Reset** clears the dispatch history so the same dates can be
replayed.

One week, rather than the ninety it once offered. While a reminder was a
row in a table, sweeping a quarter in one press was harmless. It is real
email now, and a quarter of it arriving at once is how a sending account
earns a rate limit.

Each sweep is four queries per day regardless of fleet size: read the
candidates, read what has already been sent, one transaction for the
dispatches and notifications, one batched insert for the outbox.

## Deploying

[DEPLOYMENT.md](DEPLOYMENT.md) covers two zero-cost public
deployments. The live one is Vercel for the application and Supabase for
Postgres. The other is a single container built from the root
`Dockerfile`, which serves the frontend from the API and runs anywhere
that takes a Dockerfile.

That single-origin arrangement is not tidiness. The session cookie is
`SameSite=Strict`, so a frontend on one domain calling an API on another
would have the cookie silently dropped by the browser — login appears to
succeed and everything after it returns 401.

## Security

Detailed in [SECURITY.md](SECURITY.md). In brief: argon2id password
hashing at the OWASP baseline, revocable database-backed sessions in
`SameSite=Strict` cookies, hashed reset tokens with single use,
account lockout, strict Zod schemas that reject unknown keys, a
centralised query scope that makes IDOR structurally difficult, an audit
writer with a per-entity field allowlist so password hashes cannot reach
the log, and helmet with a real CSP.

This is a defensible posture for a project of this scope. Deployment
into a hospital would additionally need penetration testing, monitoring
and alerting on sweep failure, backups, and sign-off from someone
accountable for it.

## Not built

Calibration records, document upload, MTBF and MTTR analytics,
criticality scoring and replacement recommendations. Parts are tracked as
line items on a work order, not as an inventory: there are no stock
levels, suppliers or reorder points.

On MTBF specifically: it needs per-device operating hours, which
hospitals rarely record. Computing it from calendar time produces a
number that looks authoritative and misleads. Failure rate per
device-year is the honest metric for the data available.
