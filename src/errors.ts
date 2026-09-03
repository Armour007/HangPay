/**
 * hangpay centralized error model.
 * Spec: docs/ERROR_CODES.md (shared with project-aegis Python repo).
 */

export type PopPayErrorOptions = {
  remediation?: string;
  cause?: unknown;
};

export class PopPayError extends Error {
  readonly code: string;
  readonly remediation?: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, opts: PopPayErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.remediation = opts.remediation;
    this.cause = opts.cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      remediation: this.remediation,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

// Vault ----------------------------------------------------------------------
export class PopPayVaultError extends PopPayError {}

export class VaultNotFound extends PopPayVaultError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("VAULT_NOT_FOUND", "No vault found.", {
      remediation: "Run: hangpay init-vault",
      ...opts,
    });
  }
}

export class VaultDecryptFailed extends PopPayVaultError {
  constructor(
    message = "Failed to decrypt vault \u2014 wrong key or corrupted vault.",
    opts: PopPayErrorOptions = {},
  ) {
    super("VAULT_DECRYPT_FAILED", message, {
      remediation: "Re-run: hangpay init-vault",
      ...opts,
    });
  }
}

export class VaultLocked extends PopPayVaultError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("VAULT_LOCKED", "Vault is locked (passphrase mode, no key in keyring).", {
      remediation: "Run: hangpay-unlock",
      ...opts,
    });
  }
}

// Config ---------------------------------------------------------------------
export class PopPayConfigError extends PopPayError {}

export class MissingEnvVar extends PopPayConfigError {
  constructor(name: string, opts: PopPayErrorOptions = {}) {
    super("CONFIG_MISSING_ENV_VAR", `Required env var not set: ${name}`, {
      remediation: "See docs/ENV_REFERENCE.md",
      ...opts,
    });
  }
}

export class InvalidPolicyJSON extends PopPayConfigError {
  constructor(name: string, opts: PopPayErrorOptions = {}) {
    super("CONFIG_INVALID_POLICY_JSON", `Invalid JSON in env var: ${name}`, {
      remediation: "Fix the JSON value in your policy .env",
      ...opts,
    });
  }
}

export class CategoryParseError extends PopPayConfigError {
  constructor(message: string, opts: PopPayErrorOptions = {}) {
    super("CONFIG_CATEGORY_PARSE_ERROR", message, {
      remediation: "See docs/CATEGORIES_COOKBOOK.md",
      ...opts,
    });
  }
}

// Guardrail ------------------------------------------------------------------
export class PopPayGuardrailError extends PopPayError {}

export class Layer1Reject extends PopPayGuardrailError {
  constructor(reason: string, opts: PopPayErrorOptions = {}) {
    super("GUARDRAIL_LAYER1_REJECT", `Layer 1 rejected intent: ${reason}`, opts);
  }
}

export class Layer2Reject extends PopPayGuardrailError {
  constructor(reason: string, opts: PopPayErrorOptions = {}) {
    super("GUARDRAIL_LAYER2_REJECT", `Layer 2 rejected intent: ${reason}`, opts);
  }
}

export class ProbeTimeout extends PopPayGuardrailError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("GUARDRAIL_PROBE_TIMEOUT", "Guardrail probe exceeded deadline.", opts);
  }
}

// Injector -------------------------------------------------------------------
export class PopPayInjectorError extends PopPayError {}

export class CDPConnectFailed extends PopPayInjectorError {
  constructor(url: string, opts: PopPayErrorOptions = {}) {
    super("INJECTOR_CDP_CONNECT_FAILED", `CDP connect failed: ${url}`, {
      remediation: "Start Chrome with: pop-launch",
      ...opts,
    });
  }
}

export class ChromiumNotFound extends PopPayInjectorError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("INJECTOR_CHROMIUM_NOT_FOUND", "No Chromium-family browser found.", {
      remediation: "Install Chrome or set CHROME_PATH",
      ...opts,
    });
  }
}

export class FrameNotFound extends PopPayInjectorError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("INJECTOR_FRAME_NOT_FOUND", "Target iframe not present on page.", opts);
  }
}

export class ShadowDOMSkipped extends PopPayInjectorError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("INJECTOR_SHADOW_DOM_SKIPPED", "Shadow DOM detected; skipped for safety.", opts);
  }
}

// LLM ------------------------------------------------------------------------
export class PopPayLLMError extends PopPayError {}

export class ProviderUnreachable extends PopPayLLMError {
  constructor(provider: string, opts: PopPayErrorOptions = {}) {
    super("LLM_PROVIDER_UNREACHABLE", `LLM provider unreachable: ${provider}`, {
      remediation: "Check network + API key",
      ...opts,
    });
  }
}

export class InvalidResponse extends PopPayLLMError {
  constructor(detail: string, opts: PopPayErrorOptions = {}) {
    super("LLM_INVALID_RESPONSE", `LLM returned malformed response: ${detail}`, opts);
  }
}

export class RetryExhausted extends PopPayLLMError {
  constructor(opts: PopPayErrorOptions = {}) {
    super("LLM_RETRY_EXHAUSTED", "All LLM retries failed.", opts);
  }
}

// Unknown --------------------------------------------------------------------
export class PopPayUnknownError extends PopPayError {
  constructor(cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super("UNKNOWN", msg || "Unknown error", { cause });
  }
}

// CLI handler ----------------------------------------------------------------
/**
 * Central CLI error handler. Use in entry-point `.catch(...)` blocks.
 * Renders human or JSON output, exits 1 for PopPayError, 2 for unknown.
 */
export function handleCliError(err: unknown, opts: { json?: boolean } = {}): never {
  const typed =
    err instanceof PopPayError ? err : new PopPayUnknownError(err);

  if (opts.json) {
    process.stderr.write(JSON.stringify(typed.toJSON()) + "\n");
  } else {
    process.stderr.write(`hangpay: ${typed.code}\n`);
    process.stderr.write(`  ${typed.message}\n`);
    if (typed.remediation) process.stderr.write(`  → ${typed.remediation}\n`);
  }
  process.exit(typed instanceof PopPayUnknownError ? 2 : 1);
}
