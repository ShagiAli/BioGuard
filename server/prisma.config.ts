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
    url: process.env.DATABASE_URL,
  },
});
