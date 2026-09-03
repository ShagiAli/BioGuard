/**
 * Vercel serverless entry point.
 *
 * The equivalent of server/src/index.ts for a platform that owns the
 * socket. Everything that file does beyond `app.listen` — starting the
 * pg-boss scheduler, installing signal handlers — is meaningless here:
 * the function is frozen the moment a response is sent, so a background
 * worker would never get to poll. The nightly sweep is driven by Vercel
 * Cron instead, through /api/cron/sweep.
 *
 * It imports the *built* output rather than src/. The server is compiled
 * with module: NodeNext, so its imports carry .js extensions that only
 * resolve against real emitted JavaScript; pointing this at src/app.ts
 * would fail to resolve every one of them. `vercel-build` runs tsc
 * before the functions are bundled, so dist/ is present by then.
 *
 * Bare imports inside dist/ resolve from server/node_modules, since
 * resolution walks up from the importing file — which is why this
 * project needs no dependencies of its own at the repository root.
 */
import { createApp } from "../server/dist/src/app.js";

export default createApp();
