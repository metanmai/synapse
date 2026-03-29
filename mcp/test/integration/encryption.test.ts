import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

// Recreate the encryption logic from src/index.ts to verify the algorithm works.
// These functions are not exported, so we re-implement them identically for testing.

const ENC_PREFIX = "enc:v1:";
const PBKDF2_ITERATIONS = 100_000;

async function deriveKey(passphrase: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(passphrase, salt, PBKDF2_ITERATIONS, 32, "sha256", (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function encrypt(plaintext: string, key: Buffer): Promise<string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([encrypted, authTag]);
  return `${ENC_PREFIX}${iv.toString("hex")}:${combined.toString("base64")}`;
}

async function decrypt(text: string, key: Buffer): Promise<string> {
  if (!text.startsWith(ENC_PREFIX)) return text;
  const payload = text.slice(ENC_PREFIX.length);
  const colonIdx = payload.indexOf(":");
  const ivHex = payload.slice(0, colonIdx);
  const ctBase64 = payload.slice(colonIdx + 1);
  const iv = Buffer.from(ivHex, "hex");
  const combined = Buffer.from(ctBase64, "base64");
  const authTag = combined.slice(-16);
  const ciphertext = combined.slice(0, -16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

describe("encryption round-trip", () => {
  it("encrypt then decrypt returns original text", async () => {
    const key = await deriveKey("my-passphrase", "user@example.com");
    const original = "Hello, this is a secret message!";
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it("works with short text", async () => {
    const key = await deriveKey("pass", "salt");
    const original = "a";
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it("works with long text", async () => {
    const key = await deriveKey("pass", "salt");
    const original = "x".repeat(100_000);
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it("works with unicode text", async () => {
    const key = await deriveKey("pass", "salt");
    const original =
      "Hello \u4E16\u754C! \uD83D\uDE80 Caf\u00E9 \u00FC\u00F6\u00E4 \u2603\uFE0F \u2764\uFE0F \u03B1\u03B2\u03B3\u03B4";
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it("works with empty string", async () => {
    const key = await deriveKey("pass", "salt");
    const original = "";
    const encrypted = await encrypt(original, key);
    const decrypted = await decrypt(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it("encrypted output starts with enc:v1: prefix", async () => {
    const key = await deriveKey("pass", "salt");
    const encrypted = await encrypt("test", key);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
  });

  it("encrypted output contains IV and ciphertext separated by colon", async () => {
    const key = await deriveKey("pass", "salt");
    const encrypted = await encrypt("test", key);
    const payload = encrypted.slice("enc:v1:".length);
    const colonIdx = payload.indexOf(":");
    expect(colonIdx).toBeGreaterThan(0);

    const ivHex = payload.slice(0, colonIdx);
    // IV should be 12 bytes = 24 hex chars
    expect(ivHex.length).toBe(24);
    expect(/^[0-9a-f]+$/.test(ivHex)).toBe(true);

    const ctBase64 = payload.slice(colonIdx + 1);
    expect(ctBase64.length).toBeGreaterThan(0);
  });
});

describe("non-encrypted text passthrough", () => {
  it("non-encrypted text passes through decrypt unchanged", async () => {
    const key = await deriveKey("pass", "salt");
    const plaintext = "This is just a regular string, not encrypted";
    const result = await decrypt(plaintext, key);
    expect(result).toBe(plaintext);
  });

  it("empty string passes through decrypt unchanged", async () => {
    const key = await deriveKey("pass", "salt");
    const result = await decrypt("", key);
    expect(result).toBe("");
  });

  it("text starting with different prefix passes through unchanged", async () => {
    const key = await deriveKey("pass", "salt");
    const result = await decrypt("enc:v2:something", key);
    expect(result).toBe("enc:v2:something");
  });
});

describe("different passphrases", () => {
  it("different passphrases produce different ciphertexts", async () => {
    const key1 = await deriveKey("passphrase-one", "same-salt");
    const key2 = await deriveKey("passphrase-two", "same-salt");
    const plaintext = "identical message";

    const encrypted1 = await encrypt(plaintext, key1);
    const encrypted2 = await encrypt(plaintext, key2);

    // The ciphertexts should differ (different keys + different random IVs)
    expect(encrypted1).not.toBe(encrypted2);

    // Each should decrypt with its own key
    expect(await decrypt(encrypted1, key1)).toBe(plaintext);
    expect(await decrypt(encrypted2, key2)).toBe(plaintext);
  });

  it("same plaintext encrypted twice produces different ciphertexts (random IV)", async () => {
    const key = await deriveKey("pass", "salt");
    const plaintext = "same text";
    const encrypted1 = await encrypt(plaintext, key);
    const encrypted2 = await encrypt(plaintext, key);

    // Random IV means different output each time
    expect(encrypted1).not.toBe(encrypted2);

    // Both should decrypt to the same value
    expect(await decrypt(encrypted1, key)).toBe(plaintext);
    expect(await decrypt(encrypted2, key)).toBe(plaintext);
  });
});

describe("key derivation", () => {
  it("same passphrase + salt produces same derived key (deterministic)", async () => {
    const key1 = await deriveKey("my-passphrase", "user@example.com");
    const key2 = await deriveKey("my-passphrase", "user@example.com");
    expect(key1.equals(key2)).toBe(true);
  });

  it("different salts produce different keys", async () => {
    const key1 = await deriveKey("same-passphrase", "salt-one");
    const key2 = await deriveKey("same-passphrase", "salt-two");
    expect(key1.equals(key2)).toBe(false);
  });

  it("different passphrases with same salt produce different keys", async () => {
    const key1 = await deriveKey("passphrase-a", "same-salt");
    const key2 = await deriveKey("passphrase-b", "same-salt");
    expect(key1.equals(key2)).toBe(false);
  });

  it("derived key is 32 bytes (256 bits)", async () => {
    const key = await deriveKey("pass", "salt");
    expect(key.length).toBe(32);
  });
});

describe("wrong key fails decryption", () => {
  it("throws when decrypting with wrong key", async () => {
    const correctKey = await deriveKey("correct-passphrase", "salt");
    const wrongKey = await deriveKey("wrong-passphrase", "salt");

    const encrypted = await encrypt("secret data", correctKey);

    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it("throws a specific GCM auth tag error with wrong key", async () => {
    const correctKey = await deriveKey("correct", "salt");
    const wrongKey = await deriveKey("wrong", "salt");

    const encrypted = await encrypt("message", correctKey);

    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow(/Unsupported state or unable to authenticate data/);
  });
});

describe("tampered ciphertext fails decryption", () => {
  it("throws when ciphertext is tampered", async () => {
    const key = await deriveKey("pass", "salt");
    const encrypted = await encrypt("sensitive data", key);

    // Tamper with the base64 payload
    const payload = encrypted.slice("enc:v1:".length);
    const colonIdx = payload.indexOf(":");
    const ivHex = payload.slice(0, colonIdx);
    const ctBase64 = payload.slice(colonIdx + 1);

    // Decode, tamper, re-encode
    const ctBuffer = Buffer.from(ctBase64, "base64");
    if (ctBuffer.length > 0) {
      ctBuffer[0] = ctBuffer[0] ^ 0xff; // flip bits in first byte
    }
    const tamperedBase64 = ctBuffer.toString("base64");
    const tampered = `enc:v1:${ivHex}:${tamperedBase64}`;

    await expect(decrypt(tampered, key)).rejects.toThrow();
  });

  it("throws when IV is tampered", async () => {
    const key = await deriveKey("pass", "salt");
    const encrypted = await encrypt("sensitive data", key);

    const payload = encrypted.slice("enc:v1:".length);
    const colonIdx = payload.indexOf(":");
    const ivHex = payload.slice(0, colonIdx);
    const ctBase64 = payload.slice(colonIdx + 1);

    // Tamper with IV
    const ivChars = ivHex.split("");
    ivChars[0] = ivChars[0] === "a" ? "b" : "a";
    const tamperedIv = ivChars.join("");
    const tampered = `enc:v1:${tamperedIv}:${ctBase64}`;

    await expect(decrypt(tampered, key)).rejects.toThrow();
  });

  it("throws when auth tag is tampered", async () => {
    const key = await deriveKey("pass", "salt");
    const encrypted = await encrypt("data", key);

    const payload = encrypted.slice("enc:v1:".length);
    const colonIdx = payload.indexOf(":");
    const ivHex = payload.slice(0, colonIdx);
    const ctBase64 = payload.slice(colonIdx + 1);

    // Tamper with auth tag (last 16 bytes of combined buffer)
    const combined = Buffer.from(ctBase64, "base64");
    if (combined.length >= 16) {
      combined[combined.length - 1] = combined[combined.length - 1] ^ 0xff;
    }
    const tampered = `enc:v1:${ivHex}:${combined.toString("base64")}`;

    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
});
