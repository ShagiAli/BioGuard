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
 * APP_URL just to open a connection. DB_POOL_MAX is read the same way
 * and for the same reason.
 */

/**
 * How many connections this process may hold.
 *
 * One long-lived container wants a real pool, and pg's default of 10
 * is that. A serverless deployment is the opposite shape: dozens of
 * short-lived instances, each opening its own pool against the same
 * database, which is how a generous-looking connection limit gets
 * exhausted by a handful of concurrent visitors. Set DB_POOL_MAX=1
 * there and let the platform's pooler do the multiplexing it exists for.
 */
const poolMax = Number(process.env.DB_POOL_MAX);

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  }),
  log: ["warn", "error"],
});
