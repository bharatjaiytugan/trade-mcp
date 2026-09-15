# TradingView MCP

MCP server that drives a live TradingView Desktop chart over CDP:

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

## Gotchas

- Tool selection, context-management rules, and output-size guidance live in the server's own `instructions` string in `src/server.js`. That string is served to every MCP client automatically, so it is the single source of truth — don't mirror it into this file, or the two copies drift.
- Pine graphics are reached through `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`.
