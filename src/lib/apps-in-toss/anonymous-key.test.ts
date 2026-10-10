import { describe, expect, it, vi } from "vitest";
import { captureTossAnonymousKey } from "./anonymous-key.ts";

function sdkReturning(result: () => Promise<unknown>) {
  return vi.fn(async () => ({
    User: { getAnonymousKey: result },
  }));
}

describe("captureTossAnonymousKey", () => {
  it("does not load the SDK outside the Apps in Toss surface", async () => {
    const loadSdk = sdkReturning(async () => ({ type: "HASH", hash: "abc" }));

    await expect(captureTossAnonymousKey("web", loadSdk)).resolves.toBeNull();
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("returns the hash on the Apps in Toss surface", async () => {
    const loadSdk = sdkReturning(async () => ({
      type: "HASH",
      hash: "anon-key-123",
    }));

    await expect(captureTossAnonymousKey("ait", loadSdk)).resolves.toBe(
      "anon-key-123",
    );
  });

  it("returns null when the SDK throws", async () => {
    const loadSdk = sdkReturning(async () => {
      throw new Error("UNSUPPORTED_APP_VERSION");
    });

    await expect(captureTossAnonymousKey("ait", loadSdk)).resolves.toBeNull();
  });

  it("returns null when the SDK cannot be loaded", async () => {
    const loadSdk = vi.fn(async () => {
      throw new Error("chunk failed");
    });

    await expect(captureTossAnonymousKey("ait", loadSdk)).resolves.toBeNull();
  });

  it("returns null when the SDK never answers", async () => {
    vi.useFakeTimers();
    try {
      const loadSdk = sdkReturning(() => new Promise<never>(() => undefined));
      const capture = captureTossAnonymousKey("ait", loadSdk);

      await vi.advanceTimersByTimeAsync(2_000);

      await expect(capture).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call an unsupported SDK function", async () => {
    const getAnonymousKey = Object.assign(
      vi.fn(async () => ({ type: "HASH", hash: "abc" })),
      { isSupported: () => false },
    );
    const loadSdk = vi.fn(async () => ({ User: { getAnonymousKey } }));

    await expect(captureTossAnonymousKey("ait", loadSdk)).resolves.toBeNull();
    expect(getAnonymousKey).not.toHaveBeenCalled();
  });

  it("returns null for a malformed hash", async () => {
    const loadSdk = sdkReturning(async () => ({
      type: "HASH",
      hash: "has space",
    }));

    await expect(captureTossAnonymousKey("ait", loadSdk)).resolves.toBeNull();
  });
});
