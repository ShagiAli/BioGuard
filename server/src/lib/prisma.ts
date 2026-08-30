import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The database client.
 *
 * From Prisma 7 the connection no longer comes from a URL in
 * schema.prisma; the client is handed a driver adapter instead, and the
 * CLI reads its own URL from prisma.config.ts.
 *
 * DATABASE_URL is read straight from the environment rather than through
 * env.ts on purpose. The seed script and the integration tests import
 * this module, and neither should be forced to supply SESSION_SECRET or
 * APP_URL just to open a connection.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: ["warn", "error"],
});
