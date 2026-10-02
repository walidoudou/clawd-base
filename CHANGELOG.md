# Changelog

## 1.0.0 — first public release

- Real-time dashboard for Claude Code, delivered as a plugin (hooks + transcript watcher), 100 % local on `127.0.0.1`.
- Underground pixel-art base (PixiJS): rooms dug live, walking mascots, elevator, workflow wings with animated cables, minimap, follow mode, level of detail.
- Original default mascot "Taupi" (miner mole); optional Clawd sprite set. Unique deterministic look per agent.
- Views: Base, List, Timeline (Gantt), Files; side panels with full prompt, tool timeline, per-file diffs, token breakdown, context gauge, todo lists.
- Workflow detection: explicit `[workflow:name step:n]` markers, native `Workflow` tool, heuristic steps.
- Tokens deduplicated by message id; context gauge using Claude Code's formula; tokens/min sparkline; cost.
- Permission prompts ("waiting for you"), compactions, tasks, optional live streaming (`MessageDisplay`).
- Finished agents leave the base after a while ("Archived" toggle); resumed agents come back to life.
- Narrated guided demo (▶ Demo), English and French UI.
- Formats verified against Claude Code 2.1.288 (see `docs/FINDINGS.md`).
