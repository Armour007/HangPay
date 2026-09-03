#!/usr/bin/env node
import { main } from "./dashboard.js";
import path from "path";
import os from "os";
import { handleCliError } from "./errors.js";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".config", "hangpay", "pop_state.db");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    port: 8860,
    dbPath: DEFAULT_DB_PATH
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--db" && args[i + 1]) {
      options.dbPath = args[i + 1];
      i++;
    }
  }

  return options;
}

const options = parseArgs();
main(options).catch(err => handleCliError(err));
