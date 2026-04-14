import {
  createHmac,
  timingSafeEqual as cryptoTimingSafeEqual,
} from "crypto";

const MAX_SKEW_SECONDS = 5 * 60; // 5 minutes

const SIGNATURE_PREFIX = "sha256=";

export function signPayload(
  payload: string,
  secret: string
): { signature: string; ts: number } {
  const ts = Math.floor(Date.now() / 1000);
  const hex = computeHmac(`${ts}.${payload}`, secret);
  return { signature: `${SIGNATURE_PREFIX}${hex}`, ts };
}

export function verifyPayload(
  payload: string,
  signature: string,
  ts: number,
  currentSecret: string,
  prevSecret?: string
): boolean {
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const hex = signature.slice(SIGNATURE_PREFIX.length);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    return false;
  }

  const message = `${ts}.${payload}`;

  if (safeEqual(computeHmac(message, currentSecret), hex)) {
    return true;
  }

  if (prevSecret !== undefined) {
    if (safeEqual(computeHmac(message, prevSecret), hex)) {
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
