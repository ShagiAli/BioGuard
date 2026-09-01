# Security

How BioGuard handles the parts that matter, and where the limits are.

## Authentication

**Passwords** use argon2id at the OWASP baseline — 19 MiB memory, 2
iterations, 1 lane. Failed logins are verified against a dummy hash so
that a missing account costs the same time as a wrong password;
otherwise response timing reveals which addresses exist.

**Sessions** are rows in the database, not JWTs. Stateless tokens cannot
be revoked, so a departed employee or a demoted account stays valid
until expiry — the wrong trade in a hospital. The cookie value is stored
only as a SHA-256 digest, so a database leak does not hand over live
sessions. Cookies are `httpOnly`, `Secure` in production, and
`SameSite=Strict`, which is also the primary CSRF defence. The cookie is
signed with `SESSION_SECRET`, so a forged or altered value is rejected in
middleware before it reaches a database lookup — the token is already
unguessable, and this is the belt to that pair of braces. Changing a
password sets `passwordChangedAt` and invalidates every session issued
before it.

**Brute force** is limited two ways: five failed attempts lock an
account for fifteen minutes, and the login limiter keys on IP *and*
submitted email. IP-only is defeated by a botnet; account-only lets one
attacker lock every user out of the hospital.

**Password reset** tokens are stored hashed, expire in 30 minutes, and
are single use. The endpoint returns an identical response whether or
not the address exists — otherwise it is a free enumeration oracle for
the entire staff directory.

## Authorisation

Role checks alone are insufficient. An `ENGINEER` passing a role check
can still request a device in another department, which is an IDOR.

`equipmentScope()` derives a `where` fragment from the session and is
spread into every equipment query in the service layer, so omitting it
is a visible mistake rather than a silent one. Records outside scope
return **404, not 403** — a 403 confirms the record exists, which is
itself a disclosure.

## Input handling

Every request body is parsed by a Zod schema with `.strict()`, so
unknown keys are rejected rather than ignored. This is what prevents
mass assignment: a ward user cannot send `{"role":"ADMIN"}` or reassign
an engineer by adding a field. Schemas are written per endpoint and
never derived from Prisma models.

Route parameters are validated too. A non-UUID id returns 404 instead of
reaching Prisma and raising a 500.

Prisma parameterises all queries. `$queryRawUnsafe` is not used.

## Data exposure

`publicToken` — the key to the unauthenticated QR scan endpoint — is
stripped from every list and detail payload and leaves the server only
as a QR image. QR codes encode this opaque random token rather than the
sequential asset tag, so a photographed label cannot be incremented to
walk the estate. The public scan endpoint is rate limited and returns
four fields: name, asset number, status, location.

Cost data is withheld from ward staff at the serialisation layer.

The audit writer accepts a **per-entity field allowlist**, never a whole
row. Handing it a User record would otherwise write `passwordHash` into
a widely readable table.

Logs redact `authorization`, `cookie`, and any field named `password`,
`passwordHash`, `token` or `tokenHash`.

## Transport and errors

Helmet sets a CSP, `nosniff`, `frame-ancestors 'none'`, and HSTS in
production. There is no CORS middleware, deliberately: every supported
deployment serves the frontend and the API from one origin, and the
session cookie is `SameSite=Strict`, so a frontend on another domain
could not hold a session in any case. Sending no
`Access-Control-Allow-Origin` is stricter than an allowlist — the
browser refuses every cross-origin read by default. Error responses
carry a correlation id and nothing else; stack traces stay in the logs.

## Secrets

Environment is validated by Zod at boot and the process exits if
anything required is missing. No secret has a fallback default — a
server running on a guessable session secret is worse than one that will
not start. `.env` is gitignored; only `.env.example` is committed. The
seed generates passwords and prints them once rather than shipping
credentials in source.

## Deployment settings that change the security posture

**`TRUST_PROXY_HOPS` must match the real number of proxies.** Express
derives `req.ip` by walking back through `X-Forwarded-For` by that many
hops. Set it too low and `req.ip` is the proxy's address, so every
client behind that proxy shares one rate-limit bucket — the limiter
still reports numbers and protects nobody. Set it too high and a client
can prepend its own value and choose its apparent address. On Render
behind Cloudflare the chain is three, so `TRUST_PROXY_HOPS=3`.

Because that value is a judgement about infrastructure rather than
something the app can verify, the protections that do not depend on it
carry the real weight: the per-account login limiter keys on the
submitted email, and account lockout after five failures is enforced in
the database. Neither can be evaded by forging a header.

**`NODE_ENV=development` exposes error details in responses.** The
error handler includes the exception message and a stack excerpt only
under that exact value, not merely "not production" — so a deployment
that loses its `NODE_ENV` variable fails closed and keeps quiet rather
than publishing internals.

## Known limits

This has not been penetration tested or reviewed by a security
professional.

Not implemented: two-factor authentication, virus scanning on uploads
(uploads themselves are not built yet), append-only enforcement on the
audit table at the database-grant level, paging or email alerts on sweep
failure, and backups.

Sweep failure is at least now *detectable*. Each nightly run is recorded,
and both `/api/health` and an in-app banner report a scheduler that has
stopped or gone quiet for more than a day — deliberately judged by the
absence of a recent run, since a crashed process cannot report itself.
That turns a silent failure into a visible one, which is the part that
mattered most: a maintenance system whose reminders silently stop is
worse than no system, because people trust it. Routing that signal to
somebody's phone is still an operator's job, and backups remain
unaddressed.

Personal data — staff names, email addresses, session records — falls
under KVKK/GDPR regardless of the equipment data being fictional. All
demo data in this repository is invented.
