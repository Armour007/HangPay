# Cross-Process MCP Setup (S0.7 F6(A))

> **Status:** opt-in feature. Default behavior is unchanged — Claude Desktop and any other stdio-based MCP client continue to work without any config update.

## Why this exists

By default, hangpay's MCP server runs over a **stdio pipe** owned by the launcher process (Claude Desktop, Cursor, etc.). The launcher's policy context — `HANGPAY_ALLOWED_CATEGORIES`, `HANGPAY_MAX_PER_TX`, `HANGPAY_BLACKOUT_MODE` — is bound to that stdio session.

A sibling process on the same machine cannot attach to a stdio pipe, so the policy boundary holds for the default case.

For workflows where a **second process needs to attach** to a running hangpay server (e.g. a CLI tool, a test harness, a separate agent runtime), `--transport tcp` opens a **127.0.0.1-only** HTTP listener gated by a **256-bit Bearer token**. Without the token, no MCP frame is parsed — the request is rejected at the HTTP layer with `401 Unauthorized`.

## Architecture

```
┌─────────────────┐    stdio pipe     ┌──────────────────┐
│ Claude Desktop  │ ──────────────────│ hangpay (pipe)   │   default
│ (launcher)      │                   │ policy: launcher │
└─────────────────┘                   └──────────────────┘

┌─────────────────┐                   ┌──────────────────┐
│ launcher        │ ──── spawn ─────→ │ hangpay (tcp)    │
└─────────────────┘                   │ ┌──────────────┐ │
                                      │ │ token + port │ │
                                      │ │ → ~/.config/ │ │   opt-in
                                      │ │   hangpay/   │ │
                                      │ │   .attach_*  │ │
                                      │ └──────────────┘ │
┌─────────────────┐  HTTP+Bearer      │                  │
│ attacher        │ ──────────────────│ 127.0.0.1:<eph>  │
│ (CLI, test)     │ ←── 401 if no/   │                  │
└─────────────────┘     wrong token   └──────────────────┘
```

## Files written at server start

| Path | Mode | Contents |
|------|------|----------|
| `~/.config/hangpay/.attach_token` | 0600 | 64-char hex (256-bit) Bearer token |
| `~/.config/hangpay/.attach_port` | 0600 | Ephemeral TCP port chosen by the OS |

Both files are **rotated on every server restart** and **wiped on SIGTERM/SIGINT**.

## Step-by-step: opt-in TCP mode

### 1. Launch the server in TCP mode

```bash
# npm-installed package
hangpay --transport tcp

# or via npx
npx hangpay --transport tcp
```

You will see:

```
hangpay MCP server listening on http://127.0.0.1:61143/
  token: /Users/you/.config/hangpay/.attach_token
  port:  /Users/you/.config/hangpay/.attach_port
Attach with: Authorization: Bearer $(cat /Users/you/.config/hangpay/.attach_token)
```

### 2. From a second process, read the token + port

```bash
TOKEN=$(cat ~/.config/hangpay/.attach_token)
PORT=$(cat  ~/.config/hangpay/.attach_port)
```

### 3. Send a test MCP `initialize` frame

```bash
curl -X POST "http://127.0.0.1:$PORT/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "attacher-cli", "version": "0.1.0"}
    }
  }'
```

Expected: HTTP `200` with an MCP server-info JSON response.

### 4. Verify rejection without the token

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://127.0.0.1:$PORT/"
# → 401
```

### 5. Shut down

`Ctrl-C` or `kill -TERM <pid>`. Both `.attach_token` and `.attach_port` are securely wiped (overwrite-zero + unlink).

## Security boundary rationale

**Why local-only suffices:** the threat F6(A) closes is *post-launch attach by a sibling process on the same host*. An attacker with code execution on the host already has access to the user's home directory and could read `vault.enc` directly — adding remote-network attack-resistance would not raise the cost of the in-scope threat. Binding to `127.0.0.1` excludes accidental LAN exposure entirely.

**Why a token even though local-only:** without a token, *any* local process — including a sandboxed agent runtime that should not be able to issue seals — could connect to the listener. The token, written 0600, requires the attacher to either be the same UID as the launcher or have already breached file-system isolation (in which case it could read `vault.enc` directly anyway).

**What this does NOT defend against:** a process running as the same UID with full home-directory read can read the token. F6(A) is one of several layered defenses; vault-at-rest encryption (F3/F4/F7), env-redaction (F1), and Chrome flag-guard (F6b) cover other layers.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 unauthorized` with the right token | Stale token from previous server run | Re-read token: `cat ~/.config/hangpay/.attach_token` |
| `EADDRINUSE` on launch | Race with another listener (rare; ephemeral) | Restart — server picks a new port each time |
| `~/.config/hangpay/.attach_*` missing after `Ctrl-C` | Expected — files wipe on graceful shutdown | None |
| `~/.config/hangpay/.attach_*` missing after crash | Server died before signal handler ran | Restart server; files regenerate. If concerned about leftover stale tokens, run `pop-init-vault --wipe`. |
| Claude Desktop stops working after launching `--transport tcp` | You replaced the stdio launch; stdio is the default | Remove the `--transport tcp` flag from the Claude Desktop config; default is pipe |
| `403` instead of `401` | Auth passed but session policy denied — not an F6(A) issue | Check `HANGPAY_ALLOWED_CATEGORIES` |

## Backwards compatibility

`--transport pipe` is the default. The Claude Desktop config block:

```json
{
  "mcpServers": {
    "hangpay": {
      "command": "npx",
      "args": ["hangpay"]
    }
  }
}
```

continues to work unchanged. No config migration required.

