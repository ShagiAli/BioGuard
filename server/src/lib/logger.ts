import { pino } from "pino";
import { isProd } from "../env.js";

/**
 * Redaction is not optional. Passwords and session cookies reach the
 * logger through request bodies and headers by default.
 */
export const logger = pino({
  level: isProd ? "info" : "debug",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.tokenHash",
    ],
    censor: "[redacted]",
  },
});
