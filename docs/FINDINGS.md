# FINDINGS — formats vérifiés sur cette machine

Date: 2026-10-02 · Claude Code **2.1.288** · Node **24.21.0** · npm 11.19 · macOS (Darwin 25.6)

Every statement below was checked against the official docs (code.claude.com/docs/en/hooks), the plugins installed under `~/.claude/plugins`, and real transcripts under `~/.claude/projects`. Items marked **(to verify)** could not be observed yet and are handled defensively by the parser.

---

## 1. Hooks

### Common stdin fields (all events)

| field | notes |
|---|---|
| `session_id` | session UUID; matches the transcript file name |
| `prompt_id` | UUID of the current user prompt (absent before the first prompt) |
| `transcript_path` | absolute path of the **main** session `.jsonl` |
| `cwd` | working directory |
| `hook_event_name` | event name |
| `permission_mode` | `default\|plan\|acceptEdits\|auto\|dontAsk\|bypassPermissions` (tool events) |
| `effort` | `{level}` (tool events) |
| `agent_id`, `agent_type`, `agent_transcript_path` | **only when the hook fires inside a sub-agent** |

Hooks declared by plugins **also run inside sub-agents**, so tool events from sub-agents carry `agent_id`.

### Events we use

| Event | Event-specific fields |
|---|---|
| `SessionStart` | `source` (`startup\|resume\|clear\|compact\|fork`), `model?`, `session_title?` |
| `SessionEnd` | `reason?` — shared 1.5 s budget, so the hook must be very fast |
| `UserPromptSubmit` | `prompt`, `source` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_output` (docs) — older versions: `tool_response` (object). **Accept both.** |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `tool_use_id`, `error_message` |
| `PostToolBatch` | `tool_results[] {tool_name, tool_use_id, tool_input, tool_output?, error_message?}` |
| `SubagentStart` | `agent_id`, `agent_type`, `agent_transcript_path` |
| `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message` |
| `Stop` | `last_assistant_message` |
| `StopFailure` | `error_type`, `error_message` |
| `Notification` | `notification_type`, `message` |
| `PreCompact` / `PostCompact` | `compact_trigger`, token counts |
| `PostModelSwitch` | `from_model`, `to_model` |

### Configuration

```json
{ "hooks": { "PreToolUse": [ { "matcher": "*", "hooks": [
  { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/send-event.mjs\"", "timeout": 2, "async": true }
] } ] } }
```

- `timeout` is in **seconds**. `async: true` runs the hook in the background (it cannot block Claude).
- Matcher: `"*"`, `""` or omitted means match everything. `A|B` is an exact list. Anything else is an unanchored JS regex.
- Exit 0 with empty stdout has no effect. Exit 2 blocks on some events, so our script **always exits 0 and writes nothing**.
- Substituted placeholders: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}`.

### Real payloads captured (2.1.288, `CLAWD_BASE_CAPTURE`)

Captured by running `claude -p --plugin-dir .` against the server with `CLAWD_BASE_CAPTURE=capture.jsonl`:

- Common fields present: `session_id, transcript_path, cwd, hook_event_name, prompt_id, permission_mode, scratchpad_dir`.
- **`PostToolUse` carries `tool_response` (structured object) and `duration_ms`, not `tool_output` as the docs say.** Edit: `tool_response` = the same object as the transcript's `toolUseResult` (with `structuredPatch`). Agent: `{isAsync, status:"async_launched", agentId, ...}`.
- `SubagentStart`: `agent_id, agent_type` (**no** `agent_transcript_path`). `SubagentStop`: `agent_id, agent_type, agent_transcript_path, last_assistant_message, background_tasks, stop_hook_active`.
- Tool events inside a sub-agent carry `agent_id` + `agent_type`.
- **`UserPromptSubmit` also fires for `<task-notification>`** (background-agent completion), so these are filtered and turned into `agent.stop`.
- `Stop`: `last_assistant_message, background_tasks, session_crons, stop_hook_active`. `SessionEnd`: `reason` (e.g. `"other"`).
- Even without `run_in_background`, the Agent tool may launch asynchronously (`status:"async_launched"`); completion arrives via the notification or `SubagentStop`.


### Authoritative schemas (zod) extracted from the 2.1.288 binary

The Claude Code binary embeds the zod schemas for hook inputs. Extracted with a `re` scan of `hook_event_name:R("…")`, they take precedence over the docs:

| Event | Fields (besides the common ones) |
|---|---|
| common | `session_id, transcript_path, cwd, prompt_id?, permission_mode?, agent_id?` (sub-agent only, *"use this field, not agent_type"*), `agent_type?, effort?{level}` |
| `PreToolUse` | `tool_name, tool_input, tool_use_id, mcp_server?` |
| `PostToolUse` | `tool_name, tool_input, tool_response, tool_use_id, duration_ms?, mcp_server?` |
| `PostToolUseFailure` | `tool_name, tool_input, tool_use_id, **error**, **is_interrupt?**, duration_ms?` (the docs say `error_message`) |
| `PostToolBatch` | `tool_calls[] {tool_name, tool_input, tool_use_id, tool_response?}` |
| `UserPromptSubmit` | `prompt, source?: user\|sdk\|system\|loop_wakeup\|schedule_wakeup\|poll_event` (`system` = injected, e.g. task notifications) |
| `Notification` | `message, title?, notification_type` |
| `SessionStart` | `source, model?, agent_type?, session_title?, context_tokens?, seconds_since_last_response?, prompt_cache_likely_expired?` |
| `SessionEnd` | `reason` |
| `Stop` | `stop_hook_active, last_assistant_message?, background_tasks?, session_crons?` |
| `StopFailure` | `**error**, **error_details?**, last_assistant_message?` (the docs say `error_type/error_message`) |
| `SubagentStart` | `agent_id, agent_type` |
| `SubagentStop` | `stop_hook_active, agent_id, agent_transcript_path, agent_type, last_assistant_message?, background_tasks?, session_crons?` |
| `TaskCreated` / `TaskCompleted` | `task_id, **task_subject**, task_description?, teammate_name?` (the docs say `task_title`) |
| `PreCompact` / `PostCompact` | `trigger, custom_instructions?` / `trigger, compact_summary?` |
| `MessageDisplay` | `turn_id, message_id, index, final, delta`: **streams the assistant text in whole-line batches** |
| `CwdChanged` | `old_cwd, new_cwd` |

Consequences for the dashboard:
- **Streaming is possible** via `MessageDisplay` (complete lines). It is opt-in (`CLAWD_BASE_STREAM=1`) because each flush starts the hook process. A shell guard (`[ "$CLAWD_BASE_STREAM" = "1" ] && node …`) costs ~2 ms when the variable is unset.
- **Context indicator**: Claude Code computes `total_input_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the latest request, divided by `context_window_size`. The dashboard uses the same formula. The window size is not in the transcripts, so it is inferred: 200k, switching to 1M as soon as a context above 200k is seen (`[1m]` models).
- Permission prompts arrive as `Notification` with `notification_type: "permission_prompt"`, shown as a "waiting for you" state (yellow `?`, amber lamp, tab title prefixed with ⚠).

## 2. Plugins

Layout confirmed from installed plugins (`~/.claude/plugins/cache/ecc/ecc/2.2.2`, `marketplaces/*`):

```
.claude-plugin/plugin.json        {name, version, description, author{name,url}, ...}
.claude-plugin/marketplace.json   {name, owner{name}, plugins:[{name, source:"./", description}]}
hooks/hooks.json                  {"hooks": {...}}   (auto-discovered)
skills/<name>/SKILL.md            frontmatter name + description  → /<plugin>:<name>
```

Local install: `claude --plugin-dir <path>` (dev), or `/plugin marketplace add <path>` followed by `/plugin install <name>@<marketplace>`.

## 3. Transcripts

### Layout

```
~/.claude/projects/<cwd with / replaced by ->/
  <sessionId>.jsonl                              main conversation
  <sessionId>/custom-title.json                  {"customTitle": "..."}
  <sessionId>/subagents/agent-<agentId>.jsonl    sub-agent conversation
  <sessionId>/subagents/agent-<agentId>.meta.json
```

Real `meta.json`:
```json
{"agentType":"Explore","description":"Inspect Claude Code transcript JSONL formats",
 "toolUseId":"toolu_01AbCdEfGhIjKlMnOpQrStUv","spawnDepth":1,
 "requestShape":"background","requestNonInteractive":true}
```
→ **`toolUseId` is the id of the `Agent` tool_use in the parent transcript.** That gives the parent link and the assistant message the sub-agent was launched from, which drives step grouping.

### Line types observed (counts across 12 files)

`attachment` 228, `assistant` 72, `user` 71, `last-prompt` 24, `file-history-snapshot` 19, `atis-latch` 18, `queue-operation` 15, `mode` 15, `system` 14, `permission-mode` 14, `custom-title` 10, `cost-state` 10, `agent-name` 9, `ai-title` 3.

Common fields on user/assistant/system/attachment lines: `uuid`, `parentUuid`, `sessionId`, `timestamp` (ISO), `isSidechain`, `agentId` (sub-agent lines only), `cwd`, `gitBranch`, `version`, `slug`, `entrypoint`, `userType`.

Metadata lines: `custom-title {customTitle}`, `ai-title {aiTitle}`, `agent-name {agentName}`, `cost-state {totalCostUSD, totalLinesAdded, totalLinesRemoved, modelUsage, ...}`.

### Assistant messages and usage

```json
{"type":"assistant","requestId":"req_…","apiBlockIndex":1,"isSidechain":false,
 "message":{"id":"msg_…","model":"claude-opus-5-5","content":[{"type":"tool_use",…}],
  "usage":{"input_tokens":2,"cache_creation_input_tokens":51832,"cache_read_input_tokens":40868,
   "output_tokens":300,"output_tokens_details":{"thinking_tokens":137},
   "cache_creation":{"ephemeral_1h_input_tokens":51832,"ephemeral_5m_input_tokens":0},
   "service_tier":"standard","iterations":[…]}}}
```

**Duplication confirmed:** each content block (thinking, text, tool_use…) gets its own line, with the same `message.id` and `requestId` and **the same `usage` repeated**. Example from the main transcript: 23 assistant lines, 11 distinct `message.id`, 11 distinct `requestId`. `msg_01ExampleMessageId…` appears twice (`thinking`, then `tool_use`) with identical usage (out=300, in=2, cache_read=40868).

→ **Rule: usage is counted once per `message.id`; the last line wins** (in case a later line carries more complete usage). If `message.id` is missing, fall back to `requestId`.

Total = `input + output + cache_creation + cache_read`.

### User messages

- **Human prompt**: `message.content` is a **string**, with `promptId` and `origin.kind: "human"`. `isMeta: true` marks injected lines, which are ignored.
- **Tool result**: `message.content` is an array of `{type:"tool_result", tool_use_id, content, is_error?}`, plus a top-level `toolUseResult` (structured, tool-specific) and `sourceToolAssistantUUID`.

### Sub-agents

Parent tool_use (the tool is named **`Agent`**; accept `Task` for older versions):
```json
{"type":"tool_use","id":"toolu_01Ab…","name":"Agent",
 "input":{"subagent_type":"Explore","description":"…","prompt":"…","model?":"…","run_in_background?":true}}
```
Result (`toolUseResult`) for a background agent:
```json
{"isAsync":true,"status":"async_launched","agentId":"a1b2c3d4e5f6a7b8c",
 "description":"…","resolvedModel":"claude-opus-5-5","prompt":"…","outputFile":"…"}
```
In the sub-agent's file, the first line is a `user` with `parentUuid:null`, `isSidechain:true`, `agentId`, the same `sessionId`, and the full prompt as a string.

### Tool results (`toolUseResult`)

- Bash: `{stdout, stderr, interrupted, isImage, noOutputExpected}`
- MCP: array of `{type:"text", text}`
- Read (expected, not observed yet): `{type:"text", file:{filePath, content, numLines, startLine, totalLines}}`
- **Edit (verified)**: `{filePath, oldString, newString, originalFile, structuredPatch:[{oldStart, oldLines, newStart, newLines, lines:[" ctx","-old","+new"]}], userModified, replaceAll}`. Real example: `structuredPatch:[{"oldStart":70,"oldLines":15,"newStart":70,"newLines":9,...}]`.
- **Write create (verified)**: `{type:"create", filePath, content, structuredPatch:[], originalFile:null, userModified:false}` → all lines count as added.
- **Write update (verified)**: `{type:"update", filePath, content, structuredPatch:[{oldStart:1,oldLines:69,newStart:1,newLines:76,lines}], originalFile:null}`. Note that **`originalFile` is null even on update**, so the structuredPatch is the reference and the PreToolUse snapshot is only a fallback.
- MultiEdit: not available in this version (Edit only). The parser still handles `edits[]`.
- Strategy: `structuredPatch` → PreToolUse snapshot vs disk content → old/new strings located in the file.

### Async-agent completion

A `user` line with `origin.kind:"task-notification"` whose content holds `<task-notification><task-id>…</task-id><tool-use-id>…</tool-use-id><status>completed|failed|stopped</status><summary>…</summary></task-notification>`. These lines are **not** human prompts.

### End of turn

`message.stop_reason`: `"tool_use"` (more tool calls follow), `"end_turn"` (turn finished), `null` on intermediate lines.

### Native workflows

This version has a `Workflow` tool (multi-agent orchestration). Any `Workflow` tool_use is treated as an explicit workflow **(payload to verify)**. Otherwise the heuristic in the README applies.

## 4. Mascot

The binary contains the `claude: "rgb(215,119,87)"` palette, i.e. `#D77757`. The sprite is drawn by hand from the terminal glyph (rectangular body, two eye notches, two side nubs, four legs). No third-party code was copied.
