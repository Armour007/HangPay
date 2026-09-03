# hangpay Error Codes

Shared spec for **both repos** (`hangpay-npm` / TypeScript, `project-aegis` / Python). Error class names and codes MUST stay in parity; messages may be localized but structure stays aligned so cross-language debugging is clean.

## Shape

Every `PopPayError` carries:

| Field | Required | Description |
|---|---|---|
| `code` | yes | Stable machine-readable identifier (e.g. `VAULT_NOT_FOUND`). Never changes once released. |
| `message` | yes | Human-readable summary. May localize. |
| `remediation` | optional | One-line actionable fix (e.g. `"Run: hangpay init-vault"`). |
| `cause` | optional | Wrapped underlying error (`Error` in TS, `BaseException` in Py). Use it — do not swallow causes. |

## Hierarchy

```
PopPayError (base)
├── PopPayVaultError
│   ├── VaultNotFound              VAULT_NOT_FOUND
│   ├── VaultDecryptFailed         VAULT_DECRYPT_FAILED
│   └── VaultLocked                VAULT_LOCKED
├── PopPayConfigError
│   ├── MissingEnvVar              CONFIG_MISSING_ENV_VAR
│   ├── InvalidPolicyJSON          CONFIG_INVALID_POLICY_JSON
│   └── CategoryParseError         CONFIG_CATEGORY_PARSE_ERROR
├── PopPayGuardrailError
│   ├── Layer1Reject               GUARDRAIL_LAYER1_REJECT
│   ├── Layer2Reject               GUARDRAIL_LAYER2_REJECT
│   └── ProbeTimeout               GUARDRAIL_PROBE_TIMEOUT
├── PopPayInjectorError
│   ├── CDPConnectFailed           INJECTOR_CDP_CONNECT_FAILED
│   ├── ChromiumNotFound           INJECTOR_CHROMIUM_NOT_FOUND
│   ├── FrameNotFound              INJECTOR_FRAME_NOT_FOUND
│   └── ShadowDOMSkipped           INJECTOR_SHADOW_DOM_SKIPPED
├── PopPayLLMError
│   ├── ProviderUnreachable        LLM_PROVIDER_UNREACHABLE
│   ├── InvalidResponse            LLM_INVALID_RESPONSE
│   └── RetryExhausted             LLM_RETRY_EXHAUSTED
└── PopPayUnknownError             UNKNOWN
```

## Code Table

| Code | Class | Typical cause | Remediation hint |
|---|---|---|---|
| `VAULT_NOT_FOUND` | `VaultNotFound` | `~/.config/hangpay/vault.enc` missing | `Run: hangpay init-vault` |
| `VAULT_DECRYPT_FAILED` | `VaultDecryptFailed` | Wrong key, corrupted blob, machine changed | `Re-run: hangpay init-vault` |
| `VAULT_LOCKED` | `VaultLocked` | Passphrase-mode vault, keyring empty | `Run: pop-unlock` |
| `CONFIG_MISSING_ENV_VAR` | `MissingEnvVar` | Required env var not set | Check `docs/ENV_REFERENCE.md` |
| `CONFIG_INVALID_POLICY_JSON` | `InvalidPolicyJSON` | `HANGPAY_ALLOWED_CATEGORIES` not valid JSON | Fix the env value |
| `CONFIG_CATEGORY_PARSE_ERROR` | `CategoryParseError` | Category string parses to unexpected shape | Check `docs/CATEGORIES_COOKBOOK.md` |
| `GUARDRAIL_LAYER1_REJECT` | `Layer1Reject` | Keyword/rule layer rejected intent | Not an error — expected outcome, raise only when unexpected |
| `GUARDRAIL_LAYER2_REJECT` | `Layer2Reject` | LLM semantic layer rejected intent | Same as above |
| `GUARDRAIL_PROBE_TIMEOUT` | `ProbeTimeout` | Guardrail probe exceeded deadline | Check LLM provider latency |
| `INJECTOR_CDP_CONNECT_FAILED` | `CDPConnectFailed` | Chrome DevTools Protocol unreachable | Start Chrome with `pop-launch` |
| `INJECTOR_CHROMIUM_NOT_FOUND` | `ChromiumNotFound` | No Chromium-family browser found | Install Chrome |
| `INJECTOR_FRAME_NOT_FOUND` | `FrameNotFound` | Target iframe not present on page | Vendor changed DOM; file issue |
| `INJECTOR_SHADOW_DOM_SKIPPED` | `ShadowDOMSkipped` | Shadow DOM detected; skipped for safety | Not an error — expected outcome |
| `LLM_PROVIDER_UNREACHABLE` | `ProviderUnreachable` | Network / auth / provider down | Check provider status + API key |
| `LLM_INVALID_RESPONSE` | `InvalidResponse` | Provider returned malformed JSON | Raise model quality or add stricter prompt |
| `LLM_RETRY_EXHAUSTED` | `RetryExhausted` | All tenacity retries failed | Investigate provider health |
| `UNKNOWN` | `PopPayUnknownError` | Any non-hangpay exception that reached top-level | File issue with `cause` stack |

## Rules

1. **Raise typed, catch typed.** At library boundaries raise a `PopPayError` subclass. At CLI entry points catch `PopPayError` and render `{code, message, remediation}` to the user; catch bare `Error`/`Exception` as `PopPayUnknownError`.
2. **Never swallow.** `except Exception: logger.error(...)` without re-raise or typed wrap is forbidden. If the suppression is intentional, log with a typed marker (e.g. `ShadowDOMSkipped` as a log event, not an exception) and comment why.
3. **No bare `except:` in Python.** No `catch (e) { console.error(e); process.exit(1) }` ad-hoc in TS — always go through the central CLI handler.
4. **Always set `cause`.** When wrapping, pass the original error so stack traces survive.
5. **Codes are stable.** Adding a code is fine; renaming one is a breaking change.

## CLI handler contract

- Entry points (`cli-main.ts`, `cli-vault.ts`, `cli-dashboard.ts`, `cli_main.py`, `cli_vault.py`, `cli_doctor.py`) share a single handler: `handleCliError(err)` (TS) / `handle_cli_error(err)` (Py).
- Handler output (human mode):
  ```
  hangpay: <code>
    <message>
    → <remediation>
  ```
- JSON mode: `{code, message, remediation, cause}` to stderr; exit code 1 for all `PopPayError`, exit 2 for `PopPayUnknownError`.

