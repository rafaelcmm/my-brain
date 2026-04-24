import { describe, expect, it } from "vitest";
import { shouldUseSecureSessionCookie } from "@/lib/application/session-cookie-security";

describe("shouldUseSecureSessionCookie", () => {
  it("keeps secure true in production for non-loopback even with spoofed http proto", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: "http",
        requestProtocol: "https",
        requestHost: "example.com",
        publicBaseUrl: "https://example.com",
        nodeEnv: "production",
      }),
    ).toBe(true);
  });

  it("returns true for explicit https forwarded proto", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: "https",
        requestProtocol: "http",
        requestHost: "example.com",
        publicBaseUrl: "https://example.com",
        nodeEnv: "production",
      }),
    ).toBe(true);
  });

  it("falls back to request protocol when forwarded proto is missing", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: "http",
        requestHost: "example.com",
        publicBaseUrl: "https://example.com",
        nodeEnv: "development",
      }),
    ).toBe(false);
  });

  it("uses public base url when header and request protocol are ambiguous", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: null,
        requestHost: "example.com",
        publicBaseUrl: "https://example.com",
        nodeEnv: "production",
      }),
    ).toBe(true);
  });

  it("falls back to node env when public base url is invalid", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: null,
        requestHost: "example.com",
        publicBaseUrl: "not-a-url",
        nodeEnv: "production",
      }),
    ).toBe(true);

    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: null,
        requestHost: "example.com",
        publicBaseUrl: "not-a-url",
        nodeEnv: "development",
      }),
    ).toBe(false);
  });

  it("forces non-secure for localhost request host", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: "https",
        requestProtocol: "https",
        requestHost: "localhost",
        publicBaseUrl: "https://example.com",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("forces non-secure when public base url host is loopback", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: null,
        requestHost: null,
        publicBaseUrl: "http://127.0.0.1:3000",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("handles bracketed ipv6 loopback host", () => {
    expect(
      shouldUseSecureSessionCookie({
        forwardedProtoHeader: null,
        requestProtocol: null,
        requestHost: "[::1]",
        publicBaseUrl: "https://example.com",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });
});
