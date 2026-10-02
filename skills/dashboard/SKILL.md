---
name: dashboard
description: Open the Clawd Base real-time dashboard (sessions, sub-agents, workflows, tokens, diffs) in the browser, starting the local server if needed. Use when the user asks for the dashboard / "tableau de bord" or wants to watch their agents live.
allowed-tools: Bash(node:*)
---

# /dashboard — open Clawd Base

1. Run the plugin's start script (it does nothing more if the server is already running):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/start.mjs"
   ```

   If `CLAUDE_PLUGIN_ROOT` is not set, the script is at `../../scripts/start.mjs` relative to this skill's directory.

2. Reply in one or two lines with the URL printed by the script (default http://127.0.0.1:4317/), in the user's language. The server only listens on 127.0.0.1; no data leaves the machine.

3. If the script fails because `dist/server.mjs` is missing, tell the user to run `npm install && npm run build` in the plugin directory.

Useful options: `--no-open` (don't open the browser), `--port <n>` (other port; then also set `CLAWD_BASE_PORT` for the hooks, or `"port"` in `~/.clawd-base/config.json`).
