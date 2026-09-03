/**
 * Prisma 7 configuration.
 *
 * Prisma 7 no longer accepts a connection URL inside schema.prisma; the
 * CLI reads it from here instead, and the client gets one through a
 * driver adapter. dotenv is imported first because the CLI does not load
 * .env by itself any more — without this, migrate and seed run against
 * an undefined URL.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read directly rather than through Prisma's `env()` helper, which
    // throws when the variable is absent. `prisma generate` runs during
    // the Docker build, where there is deliberately no database URL —
    // baking one into an image would be worse than the inconvenience.
    // The commands that genuinely need it (migrate, seed) run at
    // container start, where it is set.
    //
    // MIGRATE_DATABASE_URL exists because the CLI and the application
    // want different connections on a serverless deployment. Migrate
    // takes a session-scoped advisory lock; through a transaction
    // pooler the statement after it can land on a different backend, so
    // the lock is never seen again and the command hangs rather than
    // failing. Point this at a session-mode or direct connection and
    // leave DATABASE_URL on the pooler the application wants. Prisma
    // solved this with `directUrl` before 7, which this config format
    // no longer accepts.
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
