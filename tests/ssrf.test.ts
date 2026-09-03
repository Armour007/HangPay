import { describe, it, expect } from "vitest";
import { ssrfValidateUrl } from "../src/engine/injector.js";

// ---------------------------------------------------------------------------
// Comprehensive SSRF validation (mirrors Python test_x402.py SSRF tests)
// ---------------------------------------------------------------------------
describe("ssrfValidateUrl – comprehensive", () => {
  // Valid URLs
  it("accepts https://example.com", () => {
    expect(ssrfValidateUrl("https://example.com")).toBeNull();
  });

  it("accepts http://example.com", () => {
    expect(ssrfValidateUrl("http://example.com")).toBeNull();
  });

  it("accepts https with path and query", () => {
    expect(ssrfValidateUrl("https://api.stripe.com/v1/charges?limit=10")).toBeNull();
  });

  it("accepts https with port", () => {
    expect(ssrfValidateUrl("https://example.com:8443/api")).toBeNull();
  });

  // Protocol violations
  it("rejects ftp://", () => {
    expect(ssrfValidateUrl("ftp://example.com")).not.toBeNull();
  });

  it("rejects file://", () => {
    expect(ssrfValidateUrl("file:///etc/passwd")).not.toBeNull();
  });

  it("rejects javascript:", () => {
    expect(ssrfValidateUrl("javascript:alert(1)")).not.toBeNull();
  });

  it("rejects data:", () => {
    expect(ssrfValidateUrl("data:text/html,<h1>hi</h1>")).not.toBeNull();
  });

  // Loopback addresses
  it("rejects localhost", () => {
    expect(ssrfValidateUrl("http://localhost:3000")).not.toBeNull();
  });

  it("rejects 127.0.0.1", () => {
    expect(ssrfValidateUrl("http://127.0.0.1:8080")).not.toBeNull();
  });

  it("rejects 0.0.0.0", () => {
    expect(ssrfValidateUrl("http://0.0.0.0")).not.toBeNull();
  });

  it("rejects [::1]", () => {
    expect(ssrfValidateUrl("http://[::1]:8080")).not.toBeNull();
  });

  // Private IP ranges
  it("rejects 10.0.0.0/8", () => {
    expect(ssrfValidateUrl("http://10.0.0.1")).not.toBeNull();
    expect(ssrfValidateUrl("http://10.255.255.255")).not.toBeNull();
  });

  it("rejects 192.168.0.0/16", () => {
    expect(ssrfValidateUrl("http://192.168.1.1")).not.toBeNull();
    expect(ssrfValidateUrl("http://192.168.0.100")).not.toBeNull();
  });

  it("rejects 172.16.0.0/12", () => {
    expect(ssrfValidateUrl("http://172.16.0.1")).not.toBeNull();
    expect(ssrfValidateUrl("http://172.31.255.255")).not.toBeNull();
  });

  it("rejects .local domains", () => {
    expect(ssrfValidateUrl("http://myservice.local")).not.toBeNull();
  });

  // Invalid URLs
  it("rejects empty string", () => {
    expect(ssrfValidateUrl("")).not.toBeNull();
  });

  it("rejects plain text", () => {
    expect(ssrfValidateUrl("not-a-url")).not.toBeNull();
  });

  it("rejects missing protocol", () => {
    expect(ssrfValidateUrl("example.com")).not.toBeNull();
  });
});
