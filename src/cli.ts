#!/usr/bin/env node
/**
 * hangpay-launch: Launch Chrome with CDP + start MCP server.
 */

import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { platform } from "node:os";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

function findChrome(): string | null {
  const system = platform();

  if (system === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  } else if (system === "linux") {
    const { execSync } = require("node:child_process");
    const candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    for (const name of candidates) {
      try {
        const found = execSync(`which ${name}`, { encoding: "utf8" }).trim();
        if (found) return found;
      } catch {}
    }
  } else if (system === "win32") {
    const candidates = [
      String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
      String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function waitForChrome(port: number, timeout: number = 10000): Promise<any | null> {
  const url = `http://localhost:${port}/json/version`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(1000) });
      return await resp.json();
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

function printMcpInstructions(port: number): void {
  const cdpEndpoint = `http://localhost:${port}`;
  console.log();
  console.log("HangPay is ready. Add it to Claude Code with:");
  console.log();
  console.log(`  claude mcp add hangpay -- npx hangpay launch-mcp`);
  console.log(
    `  claude mcp add playwright -- npx @playwright/mcp@latest --cdp-endpoint ${cdpEndpoint}`
  );
  console.log();
  console.log("Then start Claude Code and you're set.");
}

function parseArgs(argv: string[]): {
  port: number;
  profileDir: string;
  url: string | null;
  printMcp: boolean;
  headless: boolean;
  help: boolean;
} {
  const opts = {
    port: 9222,
    profileDir: join(homedir(), ".hangpay", "chrome-profile"),
    url: null as string | null,
    printMcp: false,
    headless: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1]) {
      opts.port = parseInt(argv[++i], 10);
    } else if (arg === "--profile-dir" && argv[i + 1]) {
      opts.profileDir = argv[++i];
    } else if (arg === "--url" && argv[i + 1]) {
      opts.url = argv[++i];
    } else if (arg === "--print-mcp") {
      opts.printMcp = true;
    } else if (arg === "--headless") {
      opts.headless = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    }
  }
  return opts;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`hangpay-launch: Launch Chrome with CDP remote debugging for HangPay.

Usage: hangpay-launch [options]

Options:
  --port <number>       Chrome remote debugging port (default: 9222)
  --profile-dir <path>  Chrome user-data-dir (default: ~/.hangpay/chrome-profile)
  --url <url>           Optional URL to open in Chrome on launch
  --print-mcp           Print the claude mcp add commands after Chrome is ready
  --headless            Launch headless Chromium (for Docker/CI)
  -h, --help            Show this help message`);
    return 0;
  }

  // Resolve profile directory
  const profileDir = resolve(args.profileDir.replace(/^~/, homedir()));
  mkdirSync(profileDir, { recursive: true });

  const chrome = findChrome();
  if (!chrome) {
    process.stderr.write(
      "ERROR: Could not find Chrome or Chromium. Please install Google Chrome and try again.\n"
    );
    return 1;
  }

  const cmd = [
    `--remote-debugging-port=${args.port}`,
    `--user-data-dir=${profileDir}`,
  ];
  if (args.url) cmd.push(args.url);

  console.log(`Launching Chrome: ${chrome}`);
  console.log(`  --remote-debugging-port=${args.port}`);
  console.log(`  --user-data-dir=${profileDir}`);
  if (args.url) console.log(`  Opening URL: ${args.url}`);

  // Launch Chrome as a detached background process
  spawn(chrome, cmd, {
    detached: true,
    stdio: "ignore",
  }).unref();

  console.log(`\nWaiting for Chrome to be ready on port ${args.port}...`);
  const info = await waitForChrome(args.port);
  if (!info) {
    process.stderr.write(
      `ERROR: Chrome did not become ready within 10 seconds on port ${args.port}.\n`
    );
    return 1;
  }

  const browserVersion = info.Browser ?? "unknown";
  console.log(`Chrome is ready. Browser: ${browserVersion}`);

  if (args.printMcp) {
    printMcpInstructions(args.port);
  }

  return 0;
}

main().then((code) => process.exit(code));
