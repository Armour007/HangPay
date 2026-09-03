import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CLI_PATH = join(__dirname, "..", "dist", "cli-main.js");

function run(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("CLI", () => {
  it("--version returns a semver string", () => {
    const { stdout, exitCode } = run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help prints usage", () => {
    const { stdout, exitCode } = run("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("launch-mcp");
  });

  it("unknown subcommand exits non-zero", () => {
    const { exitCode } = run("nonexistent-command");
    expect(exitCode).not.toBe(0);
  });
});
