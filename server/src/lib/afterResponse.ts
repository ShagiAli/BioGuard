/**
 * Work that has to finish after the response has already gone.
 *
 * Some replies must not wait for the work behind them. A password reset
 * is the case this exists for: it answers identically whether or not an
 * address is registered, but it used to send the email first and answer
 * second, so a registered address took a full round trip to the mail
 * server longer than an unknown one. The body kept the secret and the
 * stopwatch gave it away.
 *
 * Answering first and doing the work afterwards is the fix, and on a
 * long-running server it would be enough on its own. On a serverless
 * platform it is not: the function is frozen the moment its response is
 * sent, so anything still running simply stops. The platform provides
 * waitUntil to keep it alive, and this hands the work to it when it is
 * there.
 *
 * Read from the request context directly rather than through
 * @vercel/functions. That package does exactly this and nothing more,
 * but brings nineteen packages with it — a poor trade for a security fix,
 * which should shrink what the application trusts rather than grow it.
 * The symbol is the contract that package itself relies on, so it is no
 * more fragile to read it here.
 *
 * Off the platform the context is absent and the work simply runs, which
 * is correct for the Docker deployment: that process is not frozen, it
 * stays up and finishes what it started.
 */
import { logger } from "./logger.js";

interface RequestContext {
  waitUntil?: (promise: Promise<unknown>) => void;
}

const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

/** Everything started and not yet finished, so tests can wait for it. */
const pending = new Set<Promise<void>>();

export function afterResponse(task: () => Promise<unknown>): void {
  const run: Promise<void> = Promise.resolve()
    .then(task)
    .then(
      () => undefined,
      // Nobody is waiting on this to report a failure to, so the log is
      // the only place it can go. It must not become an unhandled
      // rejection, which would take a long-running process down with it.
      (err: unknown) => logger.error({ err }, "work after the response failed")
    )
    .finally(() => pending.delete(run));

  pending.add(run);

  const holder = (globalThis as Record<symbol, { get?: () => RequestContext } | undefined>)[
    REQUEST_CONTEXT
  ];
  holder?.get?.()?.waitUntil?.(run);
}

/**
 * Resolves once every piece of deferred work has finished.
 *
 * For tests, which otherwise race the work they are checking. Loops
 * because finishing one task can start another.
 */
export async function settled(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
