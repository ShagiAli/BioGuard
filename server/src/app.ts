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
import cors from "cors";
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
import { loadSession, requireAuth } from "./middleware/auth.js";
import { authRouter } from "./modules/auth/routes.js";
import { equipmentRouter } from "./modules/equipment/routes.js";
import { maintenanceRouter } from "./modules/maintenance/routes.js";
import { adminRouter } from "./modules/admin/routes.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

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

  app.use(cors({ origin: env.APP_URL, credentials: true }));
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

  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/equipment", equipmentRouter);
  app.use("/api/maintenance", maintenanceRouter);
  app.use("/api/admin", adminRouter);

  app.get("/api/notifications", requireAuth, async (req, res) => {
    // Reminders are addressed to the engineer responsible for the
    // device. Administrators and managers hold no equipment of their
    // own, so scoping them to their own inbox would show them an empty
    // list while the estate fills with overdue work. They oversee the
    // programme, so they see the whole stream and who each item is for.
    const oversees = req.user!.role === "ADMIN" || req.user!.role === "MANAGER";

    const rows = await prisma.notification.findMany({
      where: oversees ? {} : { recipientId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        equipment: { select: { id: true, name: true, assetNo: true } },
        recipient: { select: { id: true, fullName: true } },
      },
    });

    res.json({
      rows,
      unread: rows.filter((r) => !r.readAt).length,
      scope: oversees ? "all" : "own",
    });
  });

  app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    const oversees = req.user!.role === "ADMIN" || req.user!.role === "MANAGER";
    await prisma.notification.updateMany({
      where: oversees ? { readAt: null } : { recipientId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  });

  // Public demo credentials, if this deployment advertises them.
  app.get("/api/demo-credentials", (_req, res) => {
    res.json(
      env.DEMO_EMAIL && env.DEMO_PASSWORD
        ? { email: env.DEMO_EMAIL, password: env.DEMO_PASSWORD }
        : {}
    );
  });

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
        ...(isProd
          ? {}
          : {
              detail: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack?.split("\n").slice(0, 6) : undefined,
            }),
      });
    }
  );

  return app;
}
