import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// R2/F-SC1 regression tests — CWD .env must never override policy.
//
// mcp-server.ts previously fell back to a bare `config()` call (dotenv's
// default behavior: search the current working directory and its parents for
// a .env). An attacker-planted .env in an untrusted repo/CWD could override
// HANGPAY_MAX_DAILY, HANGPAY_REQUIRE_HUMAN_APPROVAL, or redirect HANGPAY_LLM_BASE_URL to
// an attacker-controlled endpoint.
//
// These tests spy on dotenv's `config()` to prove loadPopConfig() NEVER
// invokes it without an explicit `path` — i.e. the cwd-search code path is
// gone entirely, not just shadowed. `os.homedir()` is mocked so behavior is
// deterministic regardless of what actually exists on the machine running
// the tests (a real dev machine may legitimately have ~/.config/hangpay/.env
// already).
// ---------------------------------------------------------------------------

const configSpy = vi.hoisted(() => vi.fn());
const mockHome = vi.hoisted(() => ({ current: "" }));

vi.mock("dotenv", () => ({ config: configSpy }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHome.current };
});

const { loadPopConfig } = await import("../src/config-loader.js");

let tmpRoot: string;

beforeEach(() => {
  configSpy.mockClear();
  tmpRoot = mkdtempSync(join(tmpdir(), "hangpay-config-test-"));
  mockHome.current = join(tmpRoot, "fake-home");
  mkdirSync(mockHome.current, { recursive: true });
  delete process.env.HANGPAY_CONFIG;
});

afterEach(() => {
  delete process.env.HANGPAY_CONFIG;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("loadPopConfig — R2/F-SC1", () => {
  it("never calls dotenv config() when neither HANGPAY_CONFIG nor the default config dir exist (no CWD search)", () => {
    const loaded = loadPopConfig();

    expect(loaded).toBeNull();
    expect(configSpy).not.toHaveBeenCalled();
  });

  it("loads ~/.config/hangpay/.env when it exists, with no HANGPAY_CONFIG set", () => {
    const configDir = join(mockHome.current, ".config", "hangpay");
    mkdirSync(configDir, { recursive: true });
    const expectedPath = join(configDir, ".env");
    writeFileSync(expectedPath, "SOME_VAR=trusted_value\n");

    const loaded = loadPopConfig();

    expect(loaded).toBe(expectedPath);
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith({ path: expectedPath });
  });

  it("HANGPAY_CONFIG, when set, takes precedence over the default config dir", () => {
    const configDir = join(mockHome.current, ".config", "hangpay");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, ".env"), "SOME_VAR=default_dir_value\n");

    const explicitConfig = join(tmpRoot, "explicit.env");
    writeFileSync(explicitConfig, "SOME_VAR=explicit_value\n");
    process.env.HANGPAY_CONFIG = explicitConfig;

    const loaded = loadPopConfig();

    expect(loaded).toBe(explicitConfig);
    expect(configSpy).toHaveBeenCalledTimes(1);
    expect(configSpy).toHaveBeenCalledWith({ path: explicitConfig });
  });

  it("every dotenv config() call carries an explicit path -- never a bare/pathless call", () => {
    // A bare `config()` call is exactly dotenv's cwd-search behavior (the
    // F-SC1 bug). Exercise all three resolution branches and assert every
    // invocation recorded by the spy passed an explicit `path`.
    loadPopConfig(); // neither HANGPAY_CONFIG nor config dir -- expect 0 calls

    const configDir = join(mockHome.current, ".config", "hangpay");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, ".env"), "SOME_VAR=trusted_value\n");
    loadPopConfig(); // config dir only

    process.env.HANGPAY_CONFIG = join(tmpRoot, "explicit.env");
    writeFileSync(process.env.HANGPAY_CONFIG, "SOME_VAR=explicit_value\n");
    loadPopConfig(); // HANGPAY_CONFIG override

    expect(configSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of configSpy.mock.calls) {
      expect(call[0]).toBeTruthy();
      expect((call[0] as { path?: string }).path).toBeTruthy();
    }
  });
});