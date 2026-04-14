import {
  createHmac,
  timingSafeEqual as cryptoTimingSafeEqual,
} from "crypto";

const MAX_SKEW_SECONDS = 5 * 60; // 5 minutes

/**
 * Signs a payload string with HMAC-SHA256.
 * Returns a hex signature and the current Unix timestamp (seconds).
 * The signed message is `${ts}.${payload}`.
 */
export function signPayload(
  payload: string,
  secret: string
): { signature: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const signature = computeHmac(`${ts}.${payload}`, secret);
  return { signature, ts };
}

/**
 * Verifies a HMAC-signed payload.
 *
 * - Rejects if the timestamp skew exceeds 5 minutes (replay protection).
 * - Tries currentSecret first; if prevSecret is provided, also tries it
 *   to support the secret rotation grace window.
 * - Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPayload(
  payload: string,
  signature: string,
  ts: number,
  currentSecret: string,
  prevSecret?: string
): boolean {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return false;
  }

  const message = `${ts}.${payload}`;

  if (safeEqual(computeHmac(message, currentSecret), signature)) {
    return true;
  }

  if (prevSecret !== undefined) {
    if (safeEqual(computeHmac(message, prevSecret), signature)) {
      return true;
    }
  }

  return false;
}

function computeHmac(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Timing-safe hex string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return cryptoTimingSafeEqual(bufA, bufB);
}
