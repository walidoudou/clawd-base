# Changelog

## 1.4.0

- Themed rooms: the main room, each agent room and each workflow room takes the look of the field it works in — game dev (UEFN, Roblox, Unity…), marketing, business, video, design, audio, Discord bots, data/AI, DevOps, security, web. Each field has its own walls, floor and furniture, an animated desk screen (mini game, rising bars, timeline, waveform, radar…) and an animated object (arcade cabinet, REC light, server LEDs…); mascots wear a matching accessory (gamer headset, beret, hard hat, headphones…) and hold the field's tool while they edit (gamepad, clapperboard, microphone…). A room that changes field is refitted in a cloud of dust.
- The field is guessed on the machine, from what the dashboard already sees: MCP servers and skills (weighted by their share of the usage), plugin agent types, files touched, shell commands, project folder and prompt words; it only switches when another field clearly wins. Sub-agents start from their session's field; workflows take most of their agents' field. The panel shows the field and its clues; `?theme=<field>` previews a look on every room.
- Guided demo: a launch page / SEO agent gets a marketing room.

## 1.3.0

- Usage like Claude Code's `/usage`, per session: the share of the session's usage that went to each skill, sub-agent, plugin and MCP server, from the attribution Claude Code writes in transcripts and with the same weighting (token prices × model tier); also the share spent above 150k context, by sub-agents, on cache misses, and the latest `/context` breakdown (system prompt, MCP tools, skills, agents, messages…). Shown in the main room's panel; the room's board shows the top consumers.
- Agents of the native `Workflow` tool (`subagents/workflows/<run>/`) are now read: their rooms, tools and tokens were missing.

## 1.2.0

- Context window per model, like Claude Code's catalog: Opus 4.7+, Sonnet 5+ and Fable are 1M (the gauge said 200k on 1M sessions); `/context` and the model identity in the transcript are used when present; sub-agents get their own window.
- Live conversation: every message sent and received, messages typed while Claude works (shown queued ⏳, then delivered mid-turn), slash commands, and tasks/todos completed — in the room board and a new "Conversation" section of the agent panel.
- Background agents finishing through Claude Code's queue are now detected.
- Bigger rooms (main and workflow rooms 448 px, agents 352 px, taller walls) with larger boards (9–10 lines): current activity, todo, queued message, your last message, Claude's last reply, last task done, files; footer adds tool and message counts; subtitle shows `ctx 25%/1M`.
- Guided demo shows a queued message delivered mid-turn and Claude's replies; its context fill matches the 1M window.

## 1.1.0

- Guided demo, smoother camera: it now keeps framing its subject (a room, a group of new agents, a workflow step) while rooms appear, shrink or move, instead of aiming once at a fixed point. Moves and zooms glide on a spring, the framing avoids the caption box and the side panel, and half zoom steps are used on 2× screens.
- Guided demo, captions in sync: each step stays up long enough to be read, the action starts once the camera has arrived, texts are shorter, typing follows the ×0.5/×1/×2 speed and pause, and the caption box no longer grows while typing.
- No agent leaves the base during the tour (they leave about a minute after it ends, one by one); stopping the demo closes its caption.
- Zooming never reshuffles the rooms any more; the main room and three agents share one row.

### Data accuracy (found by replaying real transcripts)

- Sessions read from transcripts only (e.g. after a server restart) are no longer dated to 1970, which broke the timeline and durations.
- Local commands (`/model`, `/exit`…), the `/compact` summary and shell-mode input no longer count as prompts (a real prompt could be dropped, and sessions with only `/exit` stayed "running").
- Pressing Esc ends the turn (the agent no longer stays "running" for 10 minutes).
- "No response requested." messages no longer reset the context gauge to 0.
- Ending a session stops its sub-agents, even one stuck in a tool; replaying history after the end no longer reopens it; a busy sub-agent silent for over an hour is considered finished.
- No more bogus workflow spanning several turns depending on the order files are read; a wrong guess between parallel agents no longer swaps their descriptions.
- `[workflow:name step:n]`: placeholders quoted in docs or deep in a prompt are ignored, and running the same named workflow again later creates a new workflow instead of merging into the first.

### Install and robustness

- Hooks can no longer show "hook error" in Claude Code, even when Node.js is not on the PATH (common with the native installer).
- A custom port set in `~/.clawd-base/config.json` is now seen by the hooks too (they used to read another folder).
- `CLAUDE_CONFIG_DIR` is honoured: transcripts are read from `$CLAUDE_CONFIG_DIR/projects`.
- `/dashboard` explains right away when the port belongs to another application (HTTP or not), and when Node.js is older than 22.13.
- After a plugin update, `/dashboard` replaces the old server instead of reusing it (authenticated `POST /api/shutdown`; servers from 1.0.0 cannot be replaced automatically).
- Hooks authenticate with a per-run token from `~/.clawd-base/server.json`; only authenticated hooks make the server read files (closes a hole on shared multi-user machines). The data dir is owner-only.
- Starting several servers at once no longer disables persistence; large `~/.claude/projects` trees no longer keep one watcher per old transcript (they are picked up when resumed) and are read 8 files at a time, in a fixed order; a missing projects folder is waited for.
- Windows: no console window pops up when the server starts.
- The dashboard reconnects by itself when the browser gives up on the live stream.
- Base view: trackpad zoom is smooth instead of jumping from min to max; a room that was leaving can come back; no blank canvas without WebGL (falls back to the list view).
- Timeline fills the window and follows resizes; the FR/EN toggle works on `?lang=` links; the agent panel shows the right duration for an ended session; a panel no longer shows an agent from another session after an automatic switch.
- Accessibility: keyboard focus moves into the side panel and back; Escape in a text field no longer closes the panel; the first toast is announced by screen readers; zoom buttons have labels.
- English UI: no more French punctuation or words ("Échap", "compaction !"); "2 edits" plurals.

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
