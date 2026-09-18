import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateId } from "@/lib/uuid";

describe("generateId()", () => {
  const originalCrypto = globalThis.crypto;
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    // Restore clean state
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      writable: true,
      configurable: true
    });
    vi.restoreAllMocks();
  });

  it("A. returns valid UUID v4 format under default environment", () => {
    const id = generateId();
    expect(id).toMatch(uuidV4Regex);
  });

  it("B. uses native crypto.randomUUID when available", () => {
    const mockRandomUUID = vi.fn().mockReturnValue("11111111-2222-4333-8444-555555555555");
    Object.defineProperty(globalThis, "crypto", {
      value: {
        ...originalCrypto,
        randomUUID: mockRandomUUID,
        getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
      },
      writable: true,
      configurable: true
    });

    const id = generateId();
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(id).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("C. fallback works when crypto.randomUUID is undefined (HTTP LAN origin simulation)", () => {
    // In plain HTTP LAN origins, crypto.randomUUID is undefined, but crypto.getRandomValues exists
    const cryptoWithoutRandomUUID = {
      getRandomValues: (arr: Uint8Array) => originalCrypto.getRandomValues(arr)
    };
    Object.defineProperty(globalThis, "crypto", {
      value: cryptoWithoutRandomUUID,
      writable: true,
      configurable: true
    });

    const id = generateId();
    expect(id).toMatch(uuidV4Regex);
    // Verify version 4 character at index 14
    expect(id.charAt(14)).toBe("4");
    // Verify variant character (8, 9, a, or b) at index 19
    expect(["8", "9", "a", "b"]).toContain(id.charAt(19).toLowerCase());
  });

  it("D. fallback produces different IDs across calls", () => {
    const cryptoWithoutRandomUUID = {
      getRandomValues: (arr: Uint8Array) => originalCrypto.getRandomValues(arr)
    };
    Object.defineProperty(globalThis, "crypto", {
      value: cryptoWithoutRandomUUID,
      writable: true,
      configurable: true
    });

    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = generateId();
      expect(id).toMatch(uuidV4Regex);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });

  it("E. fallback does not depend on Math.random and preserves cryptographic randomness", () => {
    const mathRandomSpy = vi.spyOn(Math, "random");
    const getRandomValuesSpy = vi.fn((arr: Uint8Array) => originalCrypto.getRandomValues(arr));

    const cryptoWithoutRandomUUID = {
      getRandomValues: getRandomValuesSpy
    };
    Object.defineProperty(globalThis, "crypto", {
      value: cryptoWithoutRandomUUID,
      writable: true,
      configurable: true
    });

    const id = generateId();
    expect(id).toMatch(uuidV4Regex);
    expect(getRandomValuesSpy).toHaveBeenCalledTimes(1);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it("throws when neither randomUUID nor getRandomValues is available", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      writable: true,
      configurable: true
    });

    expect(() => generateId()).toThrow("Web Cryptography API (crypto.getRandomValues) is not available");
  });
});
