/**
 * Client-side E2E encryption for Synapse.
 *
 * Content is encrypted in the browser using AES-256-GCM before being sent to
 * the server. The host never sees plaintext. Key is derived from a user
 * passphrase via PBKDF2.
 *
 * Encrypted format: enc:v1:<iv_hex>:<ciphertext_base64>
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 100_000;
const PREFIX = "enc:v1:";

let cachedKey: CryptoKey | null = null;

function hexEncode(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function isEncrypted(text: string): boolean {
  return text.startsWith(PREFIX);
}

export function hasPassphrase(): boolean {
  return typeof sessionStorage !== "undefined" && !!sessionStorage.getItem("synapse_passphrase");
}

export function getPassphrase(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem("synapse_passphrase");
}

export function setPassphrase(passphrase: string): void {
  sessionStorage.setItem("synapse_passphrase", passphrase);
  cachedKey = null; // force re-derive
}

export function clearPassphrase(): void {
  sessionStorage.removeItem("synapse_passphrase");
  cachedKey = null;
}

async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getKey(salt: string): Promise<CryptoKey> {
  const passphrase = getPassphrase();
  if (!passphrase) throw new Error("No encryption passphrase set");
  if (cachedKey) return cachedKey;
  cachedKey = await deriveKey(passphrase, salt);
  return cachedKey;
}

export async function encrypt(plaintext: string, userEmail: string): Promise<string> {
  const key = await getKey(userEmail);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  const ivHex = hexEncode(iv);
  const ctBase64 = btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
  return `${PREFIX}${ivHex}:${ctBase64}`;
}

export async function decrypt(encrypted: string, userEmail: string): Promise<string> {
  if (!isEncrypted(encrypted)) return encrypted;

  const key = await getKey(userEmail);
  const payload = encrypted.slice(PREFIX.length);
  const colonIdx = payload.indexOf(":");
  const ivHex = payload.slice(0, colonIdx);
  const ctBase64 = payload.slice(colonIdx + 1);

  const iv = hexDecode(ivHex);
  const ciphertext = Uint8Array.from(atob(ctBase64), (c) => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
