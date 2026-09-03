#!/usr/bin/env node

/**
 * hangpay CLI dispatcher.
 * Routes subcommands to the appropriate module.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleCliError } from "./errors.js";

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function showHelp() {
  console.log(`hangpay v${getVersion()} — Runtime Security Layer for AI Agent Commerce

Usage: hangpay <command> [options]

Commands:
  launch-mcp      Start the MCP server (stdio transport)
  launch          Launch Chrome with CDP remote debugging
  init-vault      Initialize the encrypted credential vault
  unlock          Unlock the vault for the current session
  dashboard       Start the monitoring dashboard
  doctor          Diagnose environment and configuration

Options:
  -v, --version   Show version
  -h, --help      Show this help message`);
}

async function main() {
  const subcommand = process.argv[2];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    showHelp();
    return;
  }

  if (subcommand === "--version" || subcommand === "-v") {
    console.log(getVersion());
    return;
  }

  switch (subcommand) {
    case "launch-mcp":
      process.argv.splice(2, 1);
      await import("./mcp-server.js");
      break;

    case "launch":
    case "pop-launch":
      process.argv.splice(2, 1);
      await import("./cli.js");
      break;

    case "init-vault":
    case "pop-init-vault":
      process.argv.splice(2, 1);
      await import("./cli-vault.js");
      break;

    case "unlock":
    case "pop-unlock":
      // Keep "unlock" in argv — cli-vault.ts detects it via process.argv.includes("unlock")
      process.argv[2] = "unlock";
      await import("./cli-vault.js");
      break;

    case "dashboard":
      process.argv.splice(2, 1);
      await import("./cli-dashboard.js");
      break;

    case "doctor": {
      process.argv.splice(2, 1);
      const { runDoctor } = await import("./doctor.js");
      const json = process.argv.includes("--json");
      const checks = await runDoctor({ json });
      const hasBlocker = checks.some((c) => c.status === "fail" && c.blocker);
      process.exit(hasBlocker ? 1 : 0);
    }

    default:
      process.stderr.write(`Unknown command: ${subcommand}\n\n`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => handleCliError(err));
