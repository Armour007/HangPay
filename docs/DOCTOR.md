# `hangpay doctor`

Diagnose your hangpay installation: environment, vault, policy config, guardrail reachability.

## Usage

```
$ hangpay doctor
$ hangpay doctor --json   # machine-readable
```

Exit codes:
- `0` — no blocking failures (may include warnings / non-blocking errors)
- `1` — at least one **blocker** failed (hangpay cannot start)
- `2` — doctor itself crashed

## Checks (10 total)

| id | What it verifies | Blocker? |
|---|---|---|
| `node_version` | Node.js ≥ 18 | yes |
| `chromium` | Chrome / Chromium executable present (or `HANGPAY_CHROME_PATH`) | yes |
| `cdp_port` | CDP port (default 9222 or `HANGPAY_CDP_URL`) is free | no |
| `config_dir` | `~/.config/hangpay/` exists | no |
| `vault` | `vault.enc` present & non-trivial size (or `HANGPAY_VAULT_PATH`) | no |
| `env_vars` | All known `HANGPAY_*` env vars **parse correctly** (format-only; values never read) | no |
| `policy_config` | `HANGPAY_ALLOWED_CATEGORIES` / `HANGPAY_ALLOWED_PAYMENT_PROCESSORS` are valid JSON arrays | no |
| `layer1_probe` | Layer 1 guardrail module loads | yes |
| `layer2_probe` | LLM API host reachable (TCP only; **no request sent**, no quota burned) | no |
| `injector_smoke` | `chrome --version` succeeds | no |

## Privacy & safety

- **`env_vars` is format-only.** doctor checks *presence* and, for JSON-array envs, *parseability*. It never prints or otherwise exposes any env var's value. `HANGPAY_LLM_API_KEY` set → reported as `set`, nothing more.
- **`layer2_probe` does not authenticate.** It opens a TCP connection to the LLM host and closes it. Your API key is never transmitted. This catches network / DNS problems without burning quota.

## Remediation catalog

Text messages live in `config/doctor-remediation.yaml` — editable without a code change. Flat schema:

```yaml
<check_id>:
  remediation: "<one-line action>"
  blocker: true|false
```

## KNOWN LIMITATIONS

- **Typed-engine-failure classification is deferred — this is intentional, not oversight.** doctor ships with its own local error handler and does **not** depend on the engine's `errors.ts`. When Layer 1 / Layer 2 / injector fail, doctor reports a generic `fail` rather than a typed engine error code. This gap exists because doctor was shipped in parallel with (and independent of) the **Error Model Refactor** track (currently paused, pending founder decision — see `workspace/projects/hangpay/redteam-plan-2026-04-13.md`). Once that refactor lands, a post-refactor round 2 will upgrade doctor to map typed engine failures → specific remediation entries.
- **`cdp_port` is a TCP probe.** A port that accepts a connection is reported as `in use`, but doctor cannot distinguish "existing hangpay Chrome" from "unrelated process." Treat warnings accordingly.
- **`injector_smoke` does not launch a page.** It invokes `chrome --version`. Full headless boot coverage lives in the integration test suite.
- **No CATEGORIES-specific checks yet.** Per red-team plan S0.3, CATEGORIES policy checks are gated on the S0.2 B-class bypass-rate decision (shipped in S1.1).

## Output shape (JSON)

```json
[
  {
    "id": "node_version",
    "name": "Node.js v20.11.0 (≥18 required)",
    "status": "pass",
    "blocker": false
  }
]
```

`status` ∈ `"pass" | "warn" | "fail"`. `blocker` is `true` only when `status === "fail"` AND the check is marked blocker in the remediation catalog.

