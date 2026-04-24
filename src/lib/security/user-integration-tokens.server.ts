import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM envelope encryption for `user_integrations.api_key`.
 *
 * Envelope format is a version-prefixed base64url-ish scheme:
 *
 *     v1:<iv_b64>:<ciphertext_b64>:<auth_tag_b64>
 *
 * - `v1` — scheme version, lets us rotate later without flag-day migrations
 * - `iv` — 12 random bytes (GCM standard)
 * - `ciphertext` — AES-256-GCM ciphertext of the UTF-8 plaintext
 * - `auth_tag` — 16-byte GCM authentication tag
 *
 * The symmetric key comes from the `USER_INTEGRATIONS_ENCRYPTION_KEY`
 * environment variable as a 32-byte value in either base64 (preferred)
 * or 64-char hex form. Loaded lazily on first use so that the module
 * can be imported in environments where the key is not configured (e.g.
 * type-check tooling, unrelated tests).
 */

const ENVELOPE_PREFIX = "v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;
const ENV_VAR = "USER_INTEGRATIONS_ENCRYPTION_KEY";

export class UserIntegrationTokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserIntegrationTokenKeyError";
  }
}

export class UserIntegrationTokenDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserIntegrationTokenDecryptError";
  }
}

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UserIntegrationTokenKeyError(
      `${ENV_VAR} is empty. Generate one with \`openssl rand -base64 32\` and set it in Doppler.`
    );
  }

  // Hex form: exact length, hex chars only — deterministic.
  if (trimmed.length === KEY_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  // Base64 form: accept standard and url-safe variants, decode, require 32 bytes.
  if (/^[A-Za-z0-9+/_-]+=*$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === KEY_LENGTH) {
      return decoded;
    }
    throw new UserIntegrationTokenKeyError(
      `${ENV_VAR} must decode to exactly ${KEY_LENGTH} bytes (got ${decoded.length}). Regenerate with \`openssl rand -base64 32\`.`
    );
  }

  throw new UserIntegrationTokenKeyError(
    `${ENV_VAR} must be base64 or 64-char hex encoding a ${KEY_LENGTH}-byte key.`
  );
}

function getKey(): Buffer {
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new UserIntegrationTokenKeyError(
      `${ENV_VAR} is not set. Generate one with \`openssl rand -base64 32\` and add it to Doppler (ceo-dashboard/dev and /prd).`
    );
  }
  return decodeKey(raw);
}

/**
 * Return true if the provided value is formatted as an encrypted envelope.
 * Used by the migration script and defensive-read paths.
 */
export function isEncryptedToken(value: string): boolean {
  if (!value.startsWith(ENVELOPE_PREFIX)) return false;
  const parts = value.slice(ENVELOPE_PREFIX.length).split(":");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function encryptUserIntegrationToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new UserIntegrationTokenKeyError("Plaintext token must be a non-empty string.");
  }

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    `${ENVELOPE_PREFIX}${iv.toString("base64")}`,
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptUserIntegrationToken(envelope: string): string {
  if (typeof envelope !== "string" || !envelope.startsWith(ENVELOPE_PREFIX)) {
    throw new UserIntegrationTokenDecryptError(
      "Token envelope is missing the v1 prefix. Run the re-encrypt migration before deploying encrypted-read code paths."
    );
  }

  const body = envelope.slice(ENVELOPE_PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new UserIntegrationTokenDecryptError(
      `Token envelope has ${parts.length} segments; expected 3 (iv:ct:tag).`
    );
  }

  const [ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");

  if (iv.length !== IV_LENGTH) {
    throw new UserIntegrationTokenDecryptError(
      `Token envelope iv has wrong length (${iv.length}, expected ${IV_LENGTH}).`
    );
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new UserIntegrationTokenDecryptError(
      `Token envelope auth tag has wrong length (${authTag.length}, expected ${AUTH_TAG_LENGTH}).`
    );
  }

  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new UserIntegrationTokenDecryptError(
      `Token auth-tag verification failed: ${(err as Error).message}`
    );
  }
}

/**
 * Constant-time equality check for encrypted envelopes. Used by tests
 * only — production code paths never compare envelopes directly.
 */
export function envelopesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
