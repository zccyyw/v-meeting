import { describe, it, expect, vi, afterEach } from "vitest";
import { assertProductionCryptoKey } from "../src/crypto-guard.js";

describe("assertProductionCryptoKey", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws in production when key is missing", () => {
    expect(() =>
      assertProductionCryptoKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
    ).toThrow(/MEETING_CRYPTO_KEY/);
  });

  it("throws in production when key is placeholder", () => {
    expect(() =>
      assertProductionCryptoKey({
        NODE_ENV: "production",
        MEETING_CRYPTO_KEY: "change-me-crypto-key",
      } as NodeJS.ProcessEnv)
    ).toThrow(/MEETING_CRYPTO_KEY/);
  });

  it("warns but allows short key in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertProductionCryptoKey({
        NODE_ENV: "production",
        MEETING_CRYPTO_KEY: "short-key",
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("passes with a valid key in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      assertProductionCryptoKey({
        NODE_ENV: "production",
        MEETING_CRYPTO_KEY: "a".repeat(32),
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips the check outside production", () => {
    expect(() =>
      assertProductionCryptoKey({ NODE_ENV: "development" } as NodeJS.ProcessEnv)
    ).not.toThrow();
    expect(() => assertProductionCryptoKey({} as NodeJS.ProcessEnv)).not.toThrow();
  });
});