/**
 * Generates a cryptographically-random UUID v4.
 *
 * Uses `globalThis.crypto.randomUUID()` when available (secure contexts: HTTPS / localhost, and Node.js).
 * Falls back to `globalThis.crypto.getRandomValues()` which is available in all environments
 * including plain-HTTP LAN origins and Node.js runtimes.
 *
 * Strictly adheres to RFC 4122 v4 format without Math.random.
 */
export function generateId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    // Set version 4 bits (bits 12-15 of byte 6 -> 0100)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant bits (bits 6-7 of byte 8 -> 10)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error("Web Cryptography API (crypto.getRandomValues) is not available");
}
