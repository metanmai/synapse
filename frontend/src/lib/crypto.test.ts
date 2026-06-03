import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  encrypt,
  decrypt,
  isEncrypted,
  hasPassphrase,
  getPassphrase,
  setPassphrase,
  clearPassphrase,
} from "./crypto";

// ---------- sessionStorage mock ----------
const store: Record<string, string> = {};

const sessionStorageMock: Storage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
  get length() {
    return Object.keys(store).length;
  },
  key: (index: number) => Object.keys(store)[index] ?? null,
};

beforeEach(() => {
  sessionStorageMock.clear();
  vi.stubGlobal("sessionStorage", sessionStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- helpers ----------
const EMAIL = "test@example.com";
const PASSPHRASE = "my-secret-passphrase";
const OTHER_EMAIL = "other@example.com";
const WRONG_PASSPHRASE = "wrong-passphrase";

function setKey(passphrase: string) {
  setPassphrase(passphrase);
}

// ---------- tests ----------

describe("isEncrypted", () => {
  it("returns true for enc:v1: prefixed strings", () => {
    expect(isEncrypted("enc:v1:abcdef:payload")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isEncrypted("hello world")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("enc:v2:something")).toBe(false);
  });
});

describe("passphrase management", () => {
  it("hasPassphrase() returns false when no passphrase is set", () => {
    expect(hasPassphrase()).toBe(false);
  });

  it("setPassphrase() stores and getPassphrase() retrieves", () => {
    setPassphrase("secret");
    expect(getPassphrase()).toBe("secret");
    expect(hasPassphrase()).toBe(true);
  });

  it("clearPassphrase() removes the passphrase", () => {
    setPassphrase("secret");
    expect(hasPassphrase()).toBe(true);
    clearPassphrase();
    expect(hasPassphrase()).toBe(false);
    expect(getPassphrase()).toBeNull();
  });

  it("setPassphrase() overwrites previous passphrase", () => {
    setPassphrase("first");
    setPassphrase("second");
    expect(getPassphrase()).toBe("second");
  });
});

describe("encrypt", () => {
  it("returns a string with enc:v1: prefix", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("hello", EMAIL);
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
  });

  it("contains iv and ciphertext separated by colons", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("hello", EMAIL);
    // Format: enc:v1:<iv_hex>:<ciphertext_base64>
    const parts = encrypted.split(":");
    // enc, v1, iv_hex, ciphertext_base64
    expect(parts.length).toBe(4);
    // IV is 12 bytes = 24 hex characters
    expect(parts[2]).toHaveLength(24);
  });

  it("produces different ciphertext on each call (random IV)", async () => {
    setKey(PASSPHRASE);
    const a = await encrypt("hello", EMAIL);
    const b = await encrypt("hello", EMAIL);
    expect(a).not.toBe(b);
  });

  it("throws when no passphrase is set", async () => {
    await expect(encrypt("hello", EMAIL)).rejects.toThrow("No encryption passphrase set");
  });
});

describe("decrypt", () => {
  it("returns original plaintext with matching passphrase", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("hello world", EMAIL);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe("hello world");
  });

  it("returns non-encrypted string as-is (passthrough)", async () => {
    setKey(PASSPHRASE);
    const plain = "just plain text";
    const result = await decrypt(plain, EMAIL);
    expect(result).toBe(plain);
  });

  it("fails with wrong passphrase", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("secret data", EMAIL);

    // Clear cached key and set wrong passphrase
    clearPassphrase();
    setKey(WRONG_PASSPHRASE);

    await expect(decrypt(encrypted, EMAIL)).rejects.toThrow();
  });

  it("fails with wrong email (different salt)", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("secret data", EMAIL);

    // Clear cached key so it re-derives with different salt
    clearPassphrase();
    setKey(PASSPHRASE);

    await expect(decrypt(encrypted, OTHER_EMAIL)).rejects.toThrow();
  });

  it("throws when no passphrase is set", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("hello", EMAIL);
    clearPassphrase();
    await expect(decrypt(encrypted, EMAIL)).rejects.toThrow("No encryption passphrase set");
  });
});

describe("roundtrip", () => {
  it("handles empty plaintext", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("", EMAIL);
    expect(isEncrypted(encrypted)).toBe(true);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe("");
  });

  it("handles unicode characters", async () => {
    setKey(PASSPHRASE);
    const text = "Hello \u00e4\u00f6\u00fc\u00df \u4e16\u754c \ud83c\udf1f";
    const encrypted = await encrypt(text, EMAIL);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe(text);
  });

  it("handles emoji-heavy content", async () => {
    setKey(PASSPHRASE);
    const text = "\ud83d\ude80\ud83c\udf1f\ud83d\udd25\ud83d\udca1\ud83c\udfaf\ud83d\udc4d\ud83c\udf89\ud83e\udd16";
    const encrypted = await encrypt(text, EMAIL);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe(text);
  });

  it("handles multi-line markdown content", async () => {
    setKey(PASSPHRASE);
    const text = "# Heading\n\n- item 1\n- item 2\n\n```js\nconsole.log('hello');\n```\n";
    const encrypted = await encrypt(text, EMAIL);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe(text);
  });

  it("handles large content", async () => {
    setKey(PASSPHRASE);
    const text = "x".repeat(100_000);
    const encrypted = await encrypt(text, EMAIL);
    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe(text);
  });
});

describe("key derivation", () => {
  it("same passphrase + email produces consistent encryption/decryption", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("data", EMAIL);

    // Clear and re-set the same passphrase to force re-derivation
    clearPassphrase();
    setKey(PASSPHRASE);

    const decrypted = await decrypt(encrypted, EMAIL);
    expect(decrypted).toBe("data");
  });

  it("different emails produce incompatible keys", async () => {
    setKey(PASSPHRASE);
    const encrypted = await encrypt("data", EMAIL);

    // Re-derive key with different email (salt)
    clearPassphrase();
    setKey(PASSPHRASE);

    await expect(decrypt(encrypted, OTHER_EMAIL)).rejects.toThrow();
  });
});
