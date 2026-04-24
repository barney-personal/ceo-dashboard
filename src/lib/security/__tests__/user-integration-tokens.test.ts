import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  UserIntegrationTokenDecryptError,
  UserIntegrationTokenKeyError,
  decryptUserIntegrationToken,
  encryptUserIntegrationToken,
  isEncryptedToken,
} from "../user-integration-tokens.server";

const VALID_BASE64_KEY = randomBytes(32).toString("base64");
const VALID_HEX_KEY = randomBytes(32).toString("hex");

function withKey(key: string | undefined, run: () => void) {
  const previous = process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  if (key === undefined) {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  } else {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = key;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
    } else {
      process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = previous;
    }
  }
}

describe("encrypt/decryptUserIntegrationToken", () => {
  beforeEach(() => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_BASE64_KEY;
  });

  afterEach(() => {
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  });

  it("round-trips a plaintext token through the envelope", () => {
    const plaintext = "grn_abc.def.123_very_secret";
    const envelope = encryptUserIntegrationToken(plaintext);

    expect(envelope).toMatch(/^v1:/);
    expect(envelope).not.toContain(plaintext);
    expect(isEncryptedToken(envelope)).toBe(true);
    expect(decryptUserIntegrationToken(envelope)).toBe(plaintext);
  });

  it("produces a fresh IV each call (ciphertext varies even for identical input)", () => {
    const plaintext = "same-token";
    const a = encryptUserIntegrationToken(plaintext);
    const b = encryptUserIntegrationToken(plaintext);
    expect(a).not.toBe(b);
    expect(decryptUserIntegrationToken(a)).toBe(plaintext);
    expect(decryptUserIntegrationToken(b)).toBe(plaintext);
  });

  it("accepts hex-encoded keys as an alternative to base64", () => {
    withKey(VALID_HEX_KEY, () => {
      const envelope = encryptUserIntegrationToken("hello");
      expect(decryptUserIntegrationToken(envelope)).toBe("hello");
    });
  });

  it("rejects envelopes that were tampered with after encryption", () => {
    const envelope = encryptUserIntegrationToken("do-not-tamper");
    // Flip one byte in the ciphertext segment.
    const [prefix, iv, ct, tag] = envelope.split(":");
    expect(prefix).toBe("v1");
    const ctBuf = Buffer.from(ct, "base64");
    ctBuf[0] = ctBuf[0] ^ 0x01;
    const tampered = [prefix, iv, ctBuf.toString("base64"), tag].join(":");

    expect(() => decryptUserIntegrationToken(tampered)).toThrow(
      UserIntegrationTokenDecryptError
    );
  });

  it("rejects envelopes with a tampered auth tag", () => {
    const envelope = encryptUserIntegrationToken("do-not-tamper");
    const [prefix, iv, ct, tag] = envelope.split(":");
    const tagBuf = Buffer.from(tag, "base64");
    tagBuf[0] = tagBuf[0] ^ 0x01;
    const tampered = [prefix, iv, ct, tagBuf.toString("base64")].join(":");

    expect(() => decryptUserIntegrationToken(tampered)).toThrow(
      UserIntegrationTokenDecryptError
    );
  });

  it("throws UserIntegrationTokenDecryptError (not a raw crash) for malformed envelopes", () => {
    expect(() => decryptUserIntegrationToken("")).toThrow(
      UserIntegrationTokenDecryptError
    );
    expect(() => decryptUserIntegrationToken("plaintext-token")).toThrow(
      UserIntegrationTokenDecryptError
    );
    expect(() => decryptUserIntegrationToken("v1:onlyonepart")).toThrow(
      UserIntegrationTokenDecryptError
    );
    expect(() => decryptUserIntegrationToken("v2:aa:bb:cc")).toThrow(
      UserIntegrationTokenDecryptError
    );
  });

  it("throws UserIntegrationTokenKeyError when the key env var is missing", () => {
    withKey(undefined, () => {
      expect(() => encryptUserIntegrationToken("x")).toThrow(
        UserIntegrationTokenKeyError
      );
    });
  });

  it("throws UserIntegrationTokenKeyError when the key decodes to the wrong length", () => {
    withKey("aGVsbG8=" /* base64 for "hello", 5 bytes */, () => {
      expect(() => encryptUserIntegrationToken("x")).toThrow(
        UserIntegrationTokenKeyError
      );
    });
  });

  it("throws UserIntegrationTokenKeyError for garbage key input", () => {
    withKey("!!!not-valid!!!", () => {
      expect(() => encryptUserIntegrationToken("x")).toThrow(
        UserIntegrationTokenKeyError
      );
    });
  });

  it("throws UserIntegrationTokenKeyError for empty plaintext", () => {
    expect(() => encryptUserIntegrationToken("")).toThrow(
      UserIntegrationTokenKeyError
    );
  });
});

describe("isEncryptedToken", () => {
  it("returns true for v1 envelopes", () => {
    process.env.USER_INTEGRATIONS_ENCRYPTION_KEY = VALID_BASE64_KEY;
    const envelope = encryptUserIntegrationToken("x");
    expect(isEncryptedToken(envelope)).toBe(true);
    delete process.env.USER_INTEGRATIONS_ENCRYPTION_KEY;
  });

  it("returns false for plaintext tokens", () => {
    expect(isEncryptedToken("grn_abcdef123")).toBe(false);
    expect(isEncryptedToken("")).toBe(false);
    expect(isEncryptedToken("v1:")).toBe(false);
    expect(isEncryptedToken("v1:one:two")).toBe(false);
    expect(isEncryptedToken("v2:aa:bb:cc")).toBe(false);
  });
});
