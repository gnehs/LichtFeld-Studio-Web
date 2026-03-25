import { describe, expect, it } from "vitest";
import { getSessionCookieSecure, getSessionTrustProxy } from "../src/lib/sessionConfig.js";

describe("session config", () => {
  it("keeps direct HTTP login usable in production", () => {
    expect(getSessionTrustProxy("production")).toBe(1);
    expect(getSessionCookieSecure("production")).toBe("auto");
  });

  it("does not trust proxies or mark secure cookies in development", () => {
    expect(getSessionTrustProxy("development")).toBe(false);
    expect(getSessionCookieSecure("development")).toBe(false);
  });
});
