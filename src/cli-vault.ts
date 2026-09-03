#!/usr/bin/env node
/**
 * hangpay-init-vault: Interactive setup to encrypt card credentials.
 * hangpay-unlock: Unlock vault for passphrase mode sessions.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  saveVault,
  vaultExists,
  secureWipeEnv,
  deriveKeyFromPassphrase,
  storeKeyInKeyring,
  clearKeyring,
  loadKeyFromKeyring,
  decryptCredentials,
  wipeVaultArtifacts,
  OSS_WARNING,
} from "./vault.js";
import { handleCliError, VaultNotFound, VaultDecryptFailed } from "./errors.js";

const VAULT_DIR = join(homedir(), ".config", "hangpay");
const VAULT_PATH = join(VAULT_DIR, "vault.enc");

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();

    let input = "";
    const onData = (char: Buffer) => {
      const c = char.toString("utf8");
      if (c === "\n" || c === "\r" || c === "\u0004") {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input.trim());
      } else if (c === "\u0003") {
        process.exit(1);
      } else if (c === "\u007f" || c === "\b") {
        input = input.slice(0, -1);
      } else {
        input += c;
      }
    };
    stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------------------
// pop-init-vault
// ---------------------------------------------------------------------------
async function cmdInitVault(): Promise<void> {
  const usePassphrase = process.argv.includes("--passphrase");

  console.log("hangpay vault setup");
  console.log("=".repeat(40));
  console.log("Your card credentials will be encrypted and stored at:");
  console.log(`  ${VAULT_PATH}`);
  console.log();
  console.log(OSS_WARNING);

  if (vaultExists()) {
    const overwrite = await prompt("A vault already exists. Overwrite? [y/N]: ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // F3: OSS salt consent gate at init time. If not using passphrase AND the
  // native extension isn't hardened, require explicit consent — either
  // POP_ACCEPT_OSS_SALT=1 or interactive y/N when stdin is a TTY.
  if (!usePassphrase) {
    let hardened = false;
    try {
      const native = require("../native/hangpay-native.node");
      hardened = native.isHardened?.() ?? false;
    } catch {}
    if (!hardened) {
      if (process.env.HANGPAY_ACCEPT_OSS_SALT === "1") {
        // pre-acknowledged — proceed
      } else if (process.stdin.isTTY) {
        const ack = await prompt(
          "Proceed with OSS public salt? This offers weaker protection than --passphrase. [y/N]: ",
        );
        if (ack.toLowerCase() !== "y") {
          console.log("Aborted. Re-run with --passphrase, or set HANGPAY_ACCEPT_OSS_SALT=1.");
          process.exit(1);
        }
      } else {
        console.error(
          "hangpay-init-vault: OSS public salt requires consent. " +
          "Set HANGPAY_ACCEPT_OSS_SALT=1 or pass --passphrase.",
        );
        process.exit(1);
      }
    }
  }

  let keyOverride: Buffer | undefined;
  if (usePassphrase) {
    console.log("\nPassphrase mode: your vault will be encrypted with a passphrase.");
    console.log("You must run `pop-unlock` before each MCP server session.\n");
    while (true) {
      const p1 = await promptHidden("  Choose passphrase: ");
      const p2 = await promptHidden("  Confirm passphrase: ");
      if (p1 !== p2) {
        console.log("  Passphrases do not match. Try again.");
        continue;
      }
      if (p1.length < 8) {
        console.log("  Passphrase must be at least 8 characters.");
        continue;
      }
      keyOverride = deriveKeyFromPassphrase(p1);
      storeKeyInKeyring(keyOverride);
      console.log("  Passphrase set. Vault unlocked for this session.");
      break;
    }
  }

  console.log("Enter your card credentials (input is hidden):");
  const cardNumber = (await promptHidden("  Card number: "))
    .replace(/\s/g, "")
    .replace(/-/g, "");
  const expMonth = await promptHidden("  Expiry month (MM): ");
  const expYear = await promptHidden("  Expiry year (YY): ");
  const cvv = await promptHidden("  CVV: ");

  const creds: Record<string, string> = {
    card_number: cardNumber,
    cvv,
    exp_month: expMonth,
    exp_year: expYear,
    expiration_date: `${expMonth}/${expYear}`,
  };

  console.log("\nEncrypting and writing vault...");
  saveVault(creds, keyOverride);
  console.log(`Vault written to ${VAULT_PATH}`);

  // Handle policy .env
  const policyEnvPath = join(VAULT_DIR, ".env");
  const envCandidates = [policyEnvPath, join(process.cwd(), ".env")];

  let wipedPolicyEnv = false;
  for (const envPath of envCandidates) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      if (content.includes("HANGPAY_BYOC_NUMBER") || content.includes("HANGPAY_BYOC_CVV")) {
        const wipe = await prompt(
          `\n\x1b[1;31m${envPath} contains card credentials. Securely wipe it?\x1b[0m [y/N]: `
        );
        if (wipe.toLowerCase() === "y") {
          secureWipeEnv(envPath);
          console.log(`${envPath} wiped.`);
          if (envPath === policyEnvPath) wipedPolicyEnv = true;
        }
      }
    }
  }

  // Offer to create policy template
  if (!existsSync(policyEnvPath) || wipedPolicyEnv) {
    console.log(`\nNo policy config found at ${policyEnvPath}.`);
    const create = await prompt("Create a policy template .env? [y/N]: ");
    if (create.toLowerCase() === "y") {
      mkdirSync(VAULT_DIR, { recursive: true });
      writeFileSync(
        policyEnvPath,
        `# hangpay policy configuration
# Card credentials are stored in vault.enc — do not add them here.

# Vendors the agent is allowed to pay (JSON array)
HANGPAY_ALLOWED_CATEGORIES='["aws", "cloudflare", "openai", "github", "Wikipedia", "donation", "Wikimedia"]'

# Spending limits
HANGPAY_MAX_PER_TX=100.0
HANGPAY_MAX_DAILY=500.0
HANGPAY_BLOCK_LOOPS=true

# CDP injection (required for BYOC card filling)
HANGPAY_AUTO_INJECT=true
HANGPAY_CDP_URL=http://localhost:9222

# Guardrail engine: keyword (default, zero-cost) or llm
# HANGPAY_GUARDRAIL_ENGINE=keyword

# Billing info for auto-filling name/address fields on checkout pages
# HANGPAY_BILLING_FIRST_NAME=Bob
# HANGPAY_BILLING_LAST_NAME=Smith
# HANGPAY_BILLING_EMAIL=bob@example.com
# HANGPAY_BILLING_PHONE_COUNTRY_CODE=+1
# HANGPAY_BILLING_PHONE=+14155551234
# HANGPAY_BILLING_STREET="123 Main St"
# HANGPAY_BILLING_CITY="Redwood City"
# HANGPAY_BILLING_ZIP=94043
# HANGPAY_BILLING_STATE=CA
# HANGPAY_BILLING_COUNTRY=US
`,
        { mode: 0o600 }
      );
      console.log(`Template created at ${policyEnvPath} — edit to set your policy.`);
    }
  }

  if (usePassphrase) {
    console.log("\nSetup complete. This session is already unlocked.");
    console.log("Run `hangpay-unlock` before each new MCP server session.");
  } else {
    console.log("\nSetup complete. The MCP server will auto-decrypt the vault at startup.");
  }
}

// ---------------------------------------------------------------------------
// pop-unlock
// ---------------------------------------------------------------------------
async function cmdUnlock(): Promise<void> {
  const doLock = process.argv.includes("--lock");

  if (doLock) {
    await clearKeyring();
    console.log("Vault locked — key removed from keyring.");
    console.log("Restart the MCP server to apply.");
    return;
  }

  if (!vaultExists()) {
    throw new VaultNotFound();
  }

  const passphrase = await promptHidden("Vault passphrase: ");
  if (!passphrase) {
    throw new VaultDecryptFailed("Passphrase cannot be empty.");
  }

  const key = deriveKeyFromPassphrase(passphrase);
  const blob = readFileSync(VAULT_PATH);
  try {
    decryptCredentials(blob, undefined, key);
  } catch (e) {
    if (e instanceof VaultDecryptFailed) {
      throw new VaultDecryptFailed("Wrong passphrase — vault not unlocked.", {
        cause: e,
      });
    }
    throw e;
  }

  storeKeyInKeyring(key);
  console.log("Vault unlocked for this session.");
  console.log("Start (or restart) the MCP server — it will auto-decrypt using the stored key.");
  console.log("Run `pop-unlock --lock` to re-lock when done.");
}

// ---------------------------------------------------------------------------
// pop-init-vault --wipe (F8)
// ---------------------------------------------------------------------------
async function cmdWipe(): Promise<void> {
  if (!process.argv.includes("--yes") && process.stdin.isTTY) {
    const ack = await prompt(
      "Wipe ALL hangpay vault artifacts (vault.enc, .vault_mode, keyring, stale .tmp)? [y/N]: ",
    );
    if (ack.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }
  const wiped = await wipeVaultArtifacts();
  if (wiped.length === 0) {
    console.log("No vault artifacts found.");
  } else {
    for (const p of wiped) console.log(`wiped: ${p}`);
  }
  console.log("Keyring entry cleared.");
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------
const command = process.argv[1] ?? "";
if (process.argv.includes("--wipe")) {
  cmdWipe().catch((e) => handleCliError(e));
} else if (command.includes("hangpay-unlock") || process.argv.includes("unlock")) {
  cmdUnlock().catch((e) => handleCliError(e));
} else {
  cmdInitVault().catch((e) => handleCliError(e));
}
