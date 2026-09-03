# @akshay/mcp-server-hangpay

MCP-convention alias for [`hangpay`](https://www.npmjs.com/package/hangpay). Identical functionality — this package exists only to match the `@scope/mcp-server-<name>` naming convention used by Anthropic's official MCP servers (e.g. `@modelcontextprotocol/server-filesystem`).

## Install

```bash
npm install -g @akshay/mcp-server-hangpay
```

Exposes the same binaries as `hangpay`: `hangpay`, `pop-launch`, `pop-init-vault`, `pop-unlock`.

## Which should I use?

- **`hangpay`** — primary package, recommended for most users
- **`@akshay/mcp-server-hangpay`** — same code, scoped alias for MCP directory / convention alignment

Both track the same version and are published together on every release.

See the [main README](https://github.com/akshay/hangpay#readme) for full documentation.

## License

MIT

