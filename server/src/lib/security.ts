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
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A dummy hash used to keep failed logins the same cost as successful
 * ones. Without it, response timing tells an attacker which email
 * addresses exist.
 */
export const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000";
