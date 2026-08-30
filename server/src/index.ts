/**
 * Process bootstrap. Owns the socket, the scheduler and shutdown.
 * Everything about the application itself lives in app.ts.
 */
import { createApp } from "./app.js";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { startScheduler } from "./scheduler/job.js";
import { markSchedulerFailed, markSchedulerStarted } from "./scheduler/status.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`BioGuard API listening on http://localhost:${env.PORT}`);
});

// A scheduler that fails to start must not take the API down with it.
// Engineers can still record maintenance; only the reminders stop, and
// the failure is loud in the logs.
// The state is published either way, so the failure reaches the health
// endpoint and the UI rather than living only in a log nobody is reading.
let boss: Awaited<ReturnType<typeof startScheduler>> | null = null;
try {
  boss = await startScheduler();
  markSchedulerStarted();
} catch (err) {
  markSchedulerFailed(err);
  logger.error({ err }, "scheduler failed to start — reminders are not running");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info("shutting down");
    server.close();
    await boss?.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}

// An unhandled rejection leaves the process in an unknown state. Log it
// loudly and exit so the supervisor restarts cleanly, rather than
// limping on with a half-broken connection pool.
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "unhandled promise rejection");
  process.exit(1);
});
