/**
 * Application assembly, separated from process bootstrap.
 *
 * index.ts owns the listening socket, the scheduler and signal
 * handling. This file owns only the Express app, which means tests can
 * mount it in-process with supertest — no port, no scheduler, no
 * lifecycle to tear down.
 */

import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import fs from "node:fs";

import { env, isProd } from "./env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { loadSession } from "./middleware/auth.js";
import { schedulerState, sweepFreshness } from "./scheduler/status.js";
import { authRouter } from "./modules/auth/routes.js";
import { equipmentRouter } from "./modules/equipment/routes.js";
import { maintenanceRouter } from "./modules/maintenance/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { mailRouter } from "./modules/mail/routes.js";
import { auditRouter } from "./modules/audit/routes.js";
import { alertsRouter } from "./modules/alerts/routes.js";
import { workOrdersRouter } from "./modules/work-orders/routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Must match the real number of proxies, or req.ip is not the client
  // and every IP-based limit buckets unrelated users together.
  app.set("trust proxy", env.TRUST_PROXY_HOPS);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    })
  );

  // No CORS middleware: every supported deployment is single-origin.
  // The session cookie is SameSite=Strict, so a frontend on another
  // domain could not hold a session anyway. Sending no
  // Access-Control-Allow-Origin at all is stricter than an allowlist —
  // the browser refuses every cross-origin read by default.
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Request logging is noise in a test run.
  if (env.NODE_ENV !== "test") {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req: IncomingMessage) => (req.headers["x-request-id"] as string) ?? randomUUID(),
      })
    );
  }

  // Global ceiling. Login and password reset carry their own tighter
  // limits inside the auth module.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: env.NODE_ENV === "test" ? 100_000 : 300,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(loadSession);

  /**
   * Liveness for the container and for external monitoring.
   *
   * A database failure still fails this check, as it always has. A dead
   * scheduler deliberately does not: the Dockerfile HEALTHCHECK exits
   * non-zero on a non-2xx, and index.ts keeps the API serving when the
   * scheduler dies on purpose — engineers can still record maintenance.
   * Failing here would turn a degraded but usable system into a restart
   * loop. The degradation is reported in the body instead.
   *
   * The scheduler block is coarse because this route is unauthenticated.
   * Timestamps and error text live behind /api/admin/scheduler.
   */
  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;

    const { running, startedAt } = schedulerState();
    const lastSweep = await prisma.sweepRun.findFirst({
      where: { trigger: "SCHEDULED", error: null },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    const freshness = sweepFreshness(lastSweep?.startedAt ?? null, startedAt);

    res.json({
      status: "ok",
      time: new Date().toISOString(),
      scheduler: { healthy: running && freshness !== "stale" },
    });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/equipment", equipmentRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/mail", mailRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/work-orders", workOrdersRouter);

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  /**
   * Single-origin mode. Serving the built frontend from the API keeps
   * the session cookie first-party, which is what SameSite=Strict
   * requires — hosting the two on separate domains would make the
   * browser drop the cookie on every request.
   */
  if (env.SERVE_WEB) {
    const webRoot = path.resolve(process.cwd(), "public");
    const indexHtml = path.join(webRoot, "index.html");

    app.use(
      express.static(webRoot, {
        // Hashed asset filenames can be cached hard; index.html cannot,
        // or clients pin themselves to a stale build.
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
          else res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      })
    );

    // Client-side routing: any unmatched GET is React Router's problem.
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (!fs.existsSync(indexHtml)) return next();
      res.sendFile(indexHtml);
    });
  }

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // Errors are logged in full and reported in outline. A stack trace in
  // a response body is a map of the application for anyone probing it.
  app.use(
    (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const id = (req as { id?: string }).id ?? randomUUID();
      logger.error({ err, reqId: id }, "unhandled error");

      // In production the client gets a reference and nothing else — a
      // stack trace is a map of the application. In development the
      // cause goes in the response, because hunting it through a log is
      // wasted time.
      res.status(500).json({
        error: `Something went wrong. Quote reference ${id} if you report it.`,
        ...(env.NODE_ENV === "development"
          ? {
              detail: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
            }
          : {}),
      });
    }
  );

  return app;
}
