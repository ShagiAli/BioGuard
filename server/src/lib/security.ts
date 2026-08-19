/**
 * Password hashing and token handling.
 *
 * argon2id with the OWASP baseline (19 MiB, 2 iterations, 1 lane).
 * Raise memoryCost as far as the host tolerates while a single hash
 * stays under about 500ms.
 *
 * Session and reset tokens are stored only as SHA-256 digests, so a
 * database leak does not hand over live sessions or working reset
 * links. Lookups compare digests, which is constant time in practice
 * because the digest is the indexed unique column.
 */
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** URL-safe opaque token. Used for sessions, resets and QR payloads. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A real argon2 hash of a random value, used to keep a login for an
 * unknown account as expensive as one for a real account.
 *
 * This must be a genuine hash. A hand-written placeholder fails to
 * parse and argon2.verify rejects it in microseconds, while a real
 * verification takes tens of milliseconds — which is exactly the timing
 * difference the defence exists to remove. Computed once, on first use.
 */
let dummy: Promise<string> | null = null;

export function dummyHash(): Promise<string> {
  if (!dummy) dummy = hashPassword(generateToken(24));
  return dummy;
}
