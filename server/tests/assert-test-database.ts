/**
 * Refuses to run against anything that is not obviously a test database.
 *
 * `beforeAll` truncates every table. DATABASE_URL normally comes from
 * .env, which points at the developer's working database — so running
 * this suite out of habit destroys the seeded estate, silently and
 * completely. That is not hypothetical; it is why this check exists.
 *
 * The gate is the database name rather than an opt-in flag, because a
 * flag has to be remembered at exactly the moment you are not thinking
 * about it. Set BIOGUARD_ALLOW_DESTRUCTIVE_TESTS=1 to override
 * deliberately.
 */
export function assertTestDatabase(url: string | undefined): void {
  if (process.env.BIOGUARD_ALLOW_DESTRUCTIVE_TESTS === "1") return;

  if (!url) {
    throw new Error("DATABASE_URL is not set. Point it at a dedicated test database.");
  }

  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL, so it cannot be checked: ${url}`);
  }

  const looksLikeATestDatabase = name
    .split(/[^a-zA-Z0-9]+/)
    .some((segment) => segment.toLowerCase() === "test");

  if (!looksLikeATestDatabase) {
    throw new Error(
      `Refusing to run the integration suite against database "${name}".\n\n` +
        `This suite truncates every table. Its name must contain "test" as a\n` +
        `separate word, so a working database cannot be wiped by accident.\n\n` +
        `Create one and point the suite at it:\n` +
        `  docker exec bioguard-db psql -U bioguard -d bioguard -c "CREATE DATABASE bioguard_test;"\n` +
        `  DATABASE_URL=".../bioguard_test?schema=public" npm run db:deploy\n` +
        `  DATABASE_URL=".../bioguard_test?schema=public" npm run test:integration\n\n` +
        `Set BIOGUARD_ALLOW_DESTRUCTIVE_TESTS=1 to override this deliberately.`
    );
  }
}
