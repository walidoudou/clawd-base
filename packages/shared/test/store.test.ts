import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/store.ts';
import { hookToEvents } from '../src/hooks.ts';
import { TranscriptParser, eventsFromAgentMeta } from '../src/transcript.ts';
import { SID, assistantLines, promptLine, subagentFirstLine, taskNotificationLine, text, toolResultLine, toolUse } from './fixtures.ts';

const hook = (p: Record<string, unknown>, at = 1000) => hookToEvents({ session_id: SID, ...p }, at);

describe('hookToEvents', () => {
  it('maps tool events with agent attribution', () => {
    const evs = hook({ hook_event_name: 'PreToolUse', agent_id: 'sub1', agent_type: 'Explore', tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'ls' } });
    expect(evs[0]).toMatchObject({ kind: 'tool.start', agentId: 'sub1', name: 'Bash' });
  });
  it('reads tool_response (real field) and tool_output (documented field)', () => {
    const a = hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't', tool_response: { stdout: 'hi', stderr: '' } });
    const b = hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 't', tool_output: 'hi' });
    expect(a[0]).toMatchObject({ kind: 'tool.end', output: 'hi' });
    expect(b[0]).toMatchObject({ kind: 'tool.end', output: 'hi' });
  });
  it('turns task-notification prompts into agent.stop', () => {
    const evs = hook({ hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n</task-notification>' });
    expect(evs).toEqual([expect.objectContaining({ kind: 'agent.stop', agentId: 'abc', status: 'done' })]);
  });
  it('ignores payloads without session or event', () => {
    expect(hookToEvents({ hook_event_name: 'Stop' })).toEqual([]);
    expect(hookToEvents('nope')).toEqual([]);
  });
});

describe('StateStore', () => {
  it('hooks: spawn shows a pending room, SubagentStart re-keys it to the real id', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu', tool_input: { subagent_type: 'Explore', description: 'cherche', prompt: 'trouve X' } }));
    expect(s.agents.has('t:tu')).toBe(true);
    s.flush();
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }, 1100));
    const batch = s.flush();
    expect(s.agents.has('t:tu')).toBe(false);
    expect(s.agents.get('ag1')).toMatchObject({ type: 'Explore', description: 'cherche', prompt: 'trouve X', spawnToolUseId: 'tu', status: 'running', parentId: SID });
    expect(batch?.changes).toContainEqual({ op: 'remove', kind: 'agent', id: 't:tu' });
  });

  it('a wrong FIFO match is corrected by an authoritative link', () => {
    const s = new StateStore();
    const spawn = (id: string, desc: string) =>
      s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: id, tool_input: { subagent_type: 'Explore', description: desc, prompt: desc } }));
    spawn('tu1', 'premier');
    spawn('tu2', 'second');
    // Agent for tu2 starts first: FIFO wrongly gives it tu1.
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'B', agent_type: 'Explore' }));
    expect(s.agents.get('B')?.spawnToolUseId).toBe('tu1');
    s.applyAll(hook({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu2', tool_response: { status: 'async_launched', agentId: 'B' } }));
    expect(s.agents.get('B')?.spawnToolUseId).toBe('tu2');
    expect(s.agents.get('B')?.description).toBe('second');
    // tu1 is pending again, waiting for its real agent.
    expect(s.agents.get('t:tu1')?.description).toBe('premier');
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'A', agent_type: 'Explore' }));
    expect(s.agents.get('A')).toMatchObject({ spawnToolUseId: 'tu1', description: 'premier' });
  });

  it('merges the same facts from hooks and transcript without duplicates', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'Lance deux agents', prompt_id: 'p-1' }, 500));
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tA', tool_input: { subagent_type: 'Explore', description: 'A', prompt: 'a' } }, 1000));
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tB', tool_input: { subagent_type: 'Explore', description: 'B', prompt: 'b' } }, 1001));
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'agA', agent_type: 'Explore' }, 1002));
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'agB', agent_type: 'Explore' }, 1003));

    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    const lines = [
      promptLine(0, 'Lance deux agents', 'p-1'),
      ...assistantLines(1, 'msg_1', [toolUse('tA', 'Agent', { subagent_type: 'Explore', description: 'A', prompt: 'a' }), toolUse('tB', 'Agent', { subagent_type: 'Explore', description: 'B', prompt: 'b' })]),
      toolResultLine(2, 'tA', 'ok', { status: 'async_launched', agentId: 'agA' }),
      toolResultLine(2, 'tB', 'ok', { status: 'async_launched', agentId: 'agB' }),
    ];
    for (const l of lines) s.applyAll(p.parseLine(l));
    s.applyAll(eventsFromAgentMeta(SID, 'agA', { agentType: 'Explore', toolUseId: 'tA' }, 3));

    const main = s.agents.get(SID);
    expect(main?.turns).toBe(1);
    expect(main?.toolCount).toBe(2);
    const subs = [...s.agents.values()].filter((a) => a.kind === 'sub');
    expect(subs.map((a) => a.id).sort()).toEqual(['agA', 'agB']);
    expect(subs.every((a) => a.parentMessageId === 'msg_1')).toBe(true);
  });

  it('detects a 2-step workflow and assigns agents to steps', () => {
    const s = new StateStore();
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    const lines = [
      promptLine(0, 'Go'),
      ...assistantLines(1, 'm1', [toolUse('t1', 'Agent', { subagent_type: 'Explore', description: 'x', prompt: 'x' }), toolUse('t2', 'Agent', { subagent_type: 'Explore', description: 'y', prompt: 'y' })]),
      toolResultLine(2, 't1', 'ok', { status: 'completed', agentId: 'a1' }),
      toolResultLine(2, 't2', 'ok', { status: 'completed', agentId: 'a2' }),
      ...assistantLines(30, 'm2', [toolUse('t3', 'Agent', { subagent_type: 'Plan', description: 'z', prompt: 'z' })]),
      toolResultLine(40, 't3', 'ok', { status: 'completed', agentId: 'a3' }),
    ];
    for (const l of lines) s.applyAll(p.parseLine(l));
    s.flush();
    expect(s.workflows.size).toBe(1);
    const wf = [...s.workflows.values()][0];
    expect(wf?.steps.map((x) => x.agentIds)).toEqual([['a1', 'a2'], ['a3']]);
    expect(s.agents.get('a3')).toMatchObject({ workflowId: wf?.id, stepIndex: 2, status: 'done' });
  });

  it('tracks current tool, errors and file summaries', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' } }));
    expect(s.agents.get(SID)).toMatchObject({ currentTool: 'Bash', currentToolInputPreview: 'npm test', status: 'running' });
    s.applyAll(hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b1', error_message: 'boom' }));
    s.applyAll(hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b1', error_message: 'boom' }));
    expect(s.agents.get(SID)).toMatchObject({ currentTool: null, errorCount: 1 });
    s.apply({
      kind: 'file.change',
      sessionId: SID,
      at: 1,
      source: 'transcript',
      change: { id: 'e1', sessionId: SID, agentId: SID, path: '/a.ts', operation: 'edit', at: 1, hunks: [], added: 3, removed: 1, truncated: false, diffSource: 'strings' },
    });
    // Better diff for the same tool call replaces the first one without double counting.
    s.apply({
      kind: 'file.change',
      sessionId: SID,
      at: 2,
      source: 'hook',
      change: { id: 'e1', sessionId: SID, agentId: SID, path: '/a.ts', operation: 'edit', at: 2, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 4, lines: ['-a', '+b', '+c', '+d'] }], added: 3, removed: 1, truncated: false, diffSource: 'structuredPatch' },
    });
    expect(s.agents.get(SID)).toMatchObject({ added: 3, removed: 1 });
    expect(s.agents.get(SID)?.files['/a.ts']).toMatchObject({ edits: 1, added: 3, removed: 1 });
    expect(s.files.get('e1')?.diffSource).toBe('structuredPatch');
  });

  it('forgets simulated sessions after 15 idle minutes', () => {
    let now = 1_000_000;
    const s = new StateStore({ now: () => now });
    s.applyAll(hookToEvents({ session_id: 'sim-x', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, now));
    s.applyAll(hookToEvents({ session_id: 'real', hook_event_name: 'UserPromptSubmit', prompt: 'x' }, now));
    now += 16 * 60 * 1000;
    s.tick(now);
    expect(s.sessions.has('sim-x')).toBe(false);
    expect([...s.agents.values()].some((a) => a.sessionId === 'sim-x')).toBe(false);
    expect(s.sessions.has('real')).toBe(true);
  });

  it('marks stale sessions idle on tick', () => {
    let now = 1_000_000;
    const s = new StateStore({ now: () => now });
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }, now));
    now += 11 * 60 * 1000;
    s.tick(now);
    expect(s.sessions.get(SID)?.status).toBe('idle');
  });
});

describe('real 2.1.288 hook schema fields', () => {
  it('PostToolUseFailure uses `error`, `is_interrupt` and `duration_ms`', () => {
    const evs = hook({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 't', error: 'Interrupted by user', is_interrupt: true, duration_ms: 1234 });
    expect(evs[0]).toMatchObject({ kind: 'tool.end', ok: false, error: 'Interrupted by user', interrupted: true, durationMs: 1234 });
  });
  it('StopFailure uses `error` + `error_details`', () => {
    expect(hook({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429' })[0]).toMatchObject({ kind: 'error', message: 'rate_limit: 429' });
  });
  it('UserPromptSubmit with source "system" is never a human prompt', () => {
    expect(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'wake up', source: 'system' })).toEqual([]);
  });
  it('permission prompts become attention events', () => {
    expect(hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude a besoin de votre permission' })[0]).toMatchObject({ kind: 'attention' });
    expect(hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'idle' })[0]).toMatchObject({ kind: 'notification' });
  });
  it('TaskCreated / TaskCompleted use task_subject', () => {
    expect(hook({ hook_event_name: 'TaskCreated', task_id: '1', task_subject: 'Écrire les tests' })[0]).toMatchObject({ kind: 'task', subject: 'Écrire les tests', status: 'pending' });
    expect(hook({ hook_event_name: 'TaskCompleted', task_id: '1', task_subject: 'Écrire les tests' })[0]).toMatchObject({ status: 'completed' });
  });
  it('MessageDisplay streams whole-line deltas', () => {
    expect(hook({ hook_event_name: 'MessageDisplay', turn_id: 'u', message_id: 'm1', index: 0, final: false, delta: 'Bonjour\n' })[0]).toMatchObject({ kind: 'live.text', messageId: 'm1', delta: 'Bonjour\n' });
  });
  it('TodoWrite PreToolUse yields the todo list', () => {
    const evs = hook({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_use_id: 'td', tool_input: { todos: [{ content: 'Lire', status: 'completed', activeForm: 'Lecture' }, { content: 'Coder', status: 'in_progress', activeForm: 'Codage' }] } });
    expect(evs.find((e) => e.kind === 'todos')).toMatchObject({ todos: [{ content: 'Lire', status: 'completed' }, { content: 'Coder', status: 'in_progress', activeForm: 'Codage' }] });
  });
});

describe('StateStore — context, timeline, live state', () => {
  const usageEv = (at: number, messageId: string, input: number, cacheRead: number, output = 10, model = 'claude-haiku-4-5-20251001') => ({
    kind: 'usage' as const,
    sessionId: SID,
    at,
    source: 'transcript' as const,
    agentId: SID,
    messageId,
    model,
    usage: { input, output, cacheCreate: 0, cacheRead, total: input + output + cacheRead },
  });

  it('context = input + cache of the latest message; window grows to 1M above 200k', () => {
    const s = new StateStore();
    s.apply(usageEv(1000, 'm1', 10, 50_000));
    s.apply(usageEv(5000, 'm2', 10, 120_000));
    s.apply(usageEv(3000, 'm0', 10, 1)); // older message arriving late must not win
    expect(s.agents.get(SID)?.contextTokens).toBe(120_010);
    expect(s.sessions.get(SID)?.contextWindow).toBe(200_000);
    s.apply(usageEv(9000, 'm3', 10, 250_000));
    expect(s.sessions.get(SID)?.contextWindow).toBe(1_000_000);
  });

  it('the window follows the model: Opus 5.5 is natively 1M, even at 189k', () => {
    const s = new StateStore();
    s.apply(usageEv(1000, 'm1', 10, 189_000, 10, 'claude-opus-5-5'));
    expect(s.sessions.get(SID)?.contextWindow).toBe(1_000_000);
    expect(s.agents.get(SID)?.contextWindow).toBe(1_000_000);
    // /context (or the model identity) is authoritative, e.g. with 1M disabled
    s.apply({ kind: 'context.window', sessionId: SID, at: 2000, source: 'transcript', agentId: SID, window: 200_000 });
    expect(s.sessions.get(SID)?.contextWindow).toBe(200_000);
  });

  it('tokens are bucketed per minute without double counting', () => {
    const s = new StateStore();
    const t0 = 1_700_000_000_000 - (1_700_000_000_000 % 60_000);
    s.apply(usageEv(t0 + 1000, 'a', 100, 0, 0));
    s.apply(usageEv(t0 + 2000, 'a', 100, 0, 0)); // duplicate line
    s.apply(usageEv(t0 + 61_000, 'b', 50, 0, 0));
    s.apply(usageEv(t0 - 59_000, 'c', 7, 0, 0)); // late, previous minute
    const tl = s.sessions.get(SID)?.usageTimeline;
    expect(tl?.start).toBe(t0 - 60_000);
    expect(tl?.buckets).toEqual([7, 100, 50]);
  });

  it('compaction resets the context gauge', () => {
    const s = new StateStore();
    s.apply(usageEv(1000, 'm1', 10, 150_000));
    s.apply({ kind: 'compact', sessionId: SID, at: 2000, source: 'transcript', agentId: SID, trigger: 'auto', preTokens: 150_000 });
    expect(s.agents.get(SID)).toMatchObject({ contextTokens: 0, compactions: 1 });
  });

  it('live text accumulates per message and restarts on a new message', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'MessageDisplay', message_id: 'm1', index: 0, final: false, delta: 'Ligne 1\n' }));
    s.applyAll(hook({ hook_event_name: 'MessageDisplay', message_id: 'm1', index: 1, final: true, delta: 'Ligne 2' }));
    expect(s.agents.get(SID)).toMatchObject({ liveText: 'Ligne 1\nLigne 2', liveTextFinal: true });
    s.applyAll(hook({ hook_event_name: 'MessageDisplay', message_id: 'm2', index: 0, final: false, delta: 'Nouveau\n' }));
    expect(s.agents.get(SID)?.liveText).toBe('Nouveau\n');
  });

  it('waiting flag is set by permission prompts and cleared by the next tool call', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Autoriser Bash ?' }));
    expect(s.agents.get(SID)?.waiting).toBe('Autoriser Bash ?');
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b', tool_input: { command: 'ls' } }));
    expect(s.agents.get(SID)?.waiting).toBeNull();
  });

  it('tasks are tracked per session', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'TaskCreated', task_id: '7', task_subject: 'Migrer' }));
    s.applyAll(hook({ hook_event_name: 'TaskCompleted', task_id: '7', task_subject: 'Migrer' }));
    expect(s.sessions.get(SID)?.tasks).toEqual([expect.objectContaining({ id: '7', subject: 'Migrer', status: 'completed' })]);
  });

  it('tool duration comes from the hook, else from timestamps', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'x', tool_input: {} }, 1000));
    s.applyAll(hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'x', tool_response: {}, duration_ms: 420 }, 5000));
    expect(s.tools.get('x')?.durationMs).toBe(420);
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'y', tool_input: {} }, 1000));
    s.applyAll(hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'y', tool_response: {} }, 1600));
    expect(s.tools.get('y')?.durationMs).toBe(600);
  });
});

describe('regressions from the code review', () => {
  it('a compaction or API error reported by hook AND transcript counts once', () => {
    const s = new StateStore();
    s.apply({ kind: 'compact', sessionId: SID, at: 10_000, source: 'hook', agentId: SID, trigger: 'auto', preTokens: null });
    s.apply({ kind: 'compact', sessionId: SID, at: 12_000, source: 'transcript', agentId: SID, trigger: 'auto', preTokens: 150_000 });
    s.apply({ kind: 'compact', sessionId: SID, at: 12_000, source: 'transcript', agentId: SID, trigger: 'auto', preTokens: 150_000 }); // replay
    expect(s.agents.get(SID)?.compactions).toBe(1);
    s.apply({ kind: 'error', sessionId: SID, at: 20_000, source: 'hook', agentId: SID, message: 'rate_limit' });
    s.apply({ kind: 'error', sessionId: SID, at: 21_000, source: 'transcript', agentId: SID, message: 'API Error: 429' });
    expect(s.agents.get(SID)?.errorCount).toBe(1);
    // a later, distinct compaction still counts
    s.apply({ kind: 'compact', sessionId: SID, at: 500_000, source: 'hook', agentId: SID, trigger: 'manual', preTokens: null });
    expect(s.agents.get(SID)?.compactions).toBe(2);
  });

  it('the same prompt typed twice (different ids) is counted twice', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue', prompt_id: 'p1' }, 1000));
    s.applyAll(hook({ hook_event_name: 'Stop' }, 2000));
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'continue', prompt_id: 'p2' }, 5000));
    expect(s.agents.get(SID)).toMatchObject({ turns: 2, status: 'running' });
    // transcript copy of p2 is still deduped by id
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    s.applyAll(p.parseLine(promptLine(5, 'continue', 'p2')));
    expect(s.agents.get(SID)?.turns).toBe(2);
  });

  it('a session created at capacity never evicts itself and leaves no orphan agents', () => {
    const s = new StateStore({ maxSessions: 2 });
    s.applyAll(hookToEvents({ session_id: 'A', hook_event_name: 'UserPromptSubmit', prompt: 'a' }, 5000));
    s.applyAll(hookToEvents({ session_id: 'B', hook_event_name: 'UserPromptSubmit', prompt: 'b' }, 6000));
    s.applyAll(hookToEvents({ session_id: 'C', hook_event_name: 'UserPromptSubmit', prompt: 'old' }, 1000)); // older than A and B
    expect(s.sessions.has('C')).toBe(true);
    expect(s.sessions.size).toBe(2);
    for (const a of s.agents.values()) expect(s.sessions.has(a.sessionId)).toBe(true);
    expect(s.agents.get('C')?.kind).toBe('main');
  });

  it('a sub-agent idled by tick() is revived by new activity, but not one with a running tool', () => {
    let now = 1_000_000;
    const s = new StateStore({ now: () => now });
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'sub', agent_type: 'Explore' }, now));
    now += 11 * 60_000;
    s.tick(now);
    expect(s.agents.get('sub')?.status).toBe('done');
    s.applyAll(hook({ hook_event_name: 'PreToolUse', agent_id: 'sub', tool_name: 'Read', tool_use_id: 'r1', tool_input: {} }, now));
    expect(s.agents.get('sub')).toMatchObject({ status: 'running', endedAt: null, currentTool: 'Read' });
    // long-running tool: tick must not end it
    now += 11 * 60_000;
    s.tick(now);
    expect(s.agents.get('sub')?.status).toBe('running');
    // a real stop ends it… until the agent is resumed (SendMessage / coordinator): new activity revives it
    s.applyAll(hook({ hook_event_name: 'SubagentStop', agent_id: 'sub', agent_type: 'Explore' }, now));
    expect(s.agents.get('sub')?.status).toBe('done');
    s.applyAll(hook({ hook_event_name: 'PreToolUse', agent_id: 'sub', tool_name: 'Read', tool_use_id: 'r2', tool_input: {} }, now + 1000));
    expect(s.agents.get('sub')).toMatchObject({ status: 'running', endedAt: null });
  });

  it('a sub-agent given a new job after its end_turn is running again (real robloxclaude case)', () => {
    const s = new StateStore();
    const p = new TranscriptParser({ sessionId: SID, agentId: 'blender' });
    const lines = [
      subagentFirstLine(1, 'blender', 'Produis des assets Blender'),
      ...assistantLines(2, 'm1', [toolUse('t1', 'Bash', { command: 'blender' })], { agentId: 'blender' }),
      toolResultLine(3, 't1', 'ok', { stdout: 'ok' }, { agentId: 'blender' }),
      ...assistantLines(4, 'm2', [text('Rapport terminé.')], { agentId: 'blender', stop: 'end_turn' }),
    ];
    for (const l of lines) s.applyAll(p.parseLine(l));
    expect(s.agents.get('blender')?.status).toBe('done');
    // 18 minutes later the coordinator sends a new job (isMeta line) and the agent works again
    const later = [...assistantLines(1100, 'm3', [toolUse('t2', 'Write', { file_path: '/tmp/city_gen_v2.py', content: 'x' })], { agentId: 'blender' })];
    for (const l of later) s.applyAll(p.parseLine(l));
    expect(s.agents.get('blender')).toMatchObject({ status: 'running', currentTool: 'Write', endedAt: null });
  });

  it('undated metadata lines do not make an old session look active', () => {
    const s = new StateStore();
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    s.applyAll(p.parseLine(promptLine(1, 'vieux prompt')));
    const before = s.sessions.get(SID)?.lastActivityAt;
    s.applyAll(p.parseLine(JSON.stringify({ type: 'custom-title', customTitle: 'Titre', sessionId: SID })));
    s.applyAll(p.parseLine(JSON.stringify({ type: 'cost-state', totalCostUSD: 2, sessionId: SID })));
    expect(s.sessions.get(SID)?.lastActivityAt).toBe(before);
    expect(s.sessions.get(SID)?.title).toBe('Titre');
  });

  it('task notifications for unknown ids do not create phantom agents', () => {
    const s = new StateStore();
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    s.applyAll(p.parseLine(taskNotificationLine(1, 'bash-task-9', 'toolu_bash')));
    expect([...s.agents.values()].filter((a) => a.kind === 'sub')).toEqual([]);
    // SubagentStop for an agent we never saw (dashboard started late) still creates it
    s.applyAll(hook({ hook_event_name: 'SubagentStop', agent_id: 'late', agent_type: 'Plan' }));
    expect(s.agents.get('late')).toMatchObject({ type: 'Plan', status: 'done' });
  });

  it('a human prompt that merely mentions <task-notification> is kept', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'Pourquoi le tag <task-notification> est filtré ?', prompt_id: 'h1', source: 'user' }));
    expect(s.agents.get(SID)?.turns).toBe(1);
  });

  it('duplicate start/stop facts do not duplicate log entries', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'SessionStart', source: 'startup' }));
    s.apply({ kind: 'session.start', sessionId: SID, at: 1, source: 'transcript', cwd: '/x' });
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'z', agent_type: 'Explore' }));
    s.apply({ kind: 'agent.start', sessionId: SID, at: 2, source: 'transcript', agentId: 'z', prompt: 'p' });
    s.applyAll(hook({ hook_event_name: 'SubagentStop', agent_id: 'z', agent_type: 'Explore' }));
    s.apply({ kind: 'agent.stop', sessionId: SID, at: 3, source: 'transcript', agentId: 'z', status: 'done' });
    const logs = s.flush()?.logs ?? [];
    expect(logs.filter((l) => l.kind === 'session.start')).toHaveLength(1);
    expect(logs.filter((l) => l.kind === 'agent.start')).toHaveLength(1);
    expect(logs.filter((l) => l.kind === 'agent.stop')).toHaveLength(1);
  });

  it('agent file summary is capped while totals stay exact; dropSession clears side tables', () => {
    const s = new StateStore();
    for (let i = 0; i < 60; i++) {
      s.apply({
        kind: 'file.change',
        sessionId: SID,
        at: i,
        source: 'transcript',
        change: { id: `f${i}`, sessionId: SID, agentId: SID, path: `/p/${i}.ts`, operation: 'edit', at: i, hunks: [], added: 1, removed: 0, truncated: false, diffSource: 'strings' },
      });
    }
    const main = s.agents.get(SID);
    expect(Object.keys(main?.files ?? {})).toHaveLength(40);
    expect(main?.added).toBe(60);
    expect(main?.files['/p/59.ts']).toBeDefined();
    s.dropSession(SID);
    expect(s.agents.size).toBe(0);
    expect(s.files.size).toBe(0);
  });
});

describe('StateStore — lifecycle edge cases', () => {
  const spawnSub = (s: StateStore, at: number) => {
    s.applyAll(hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'tu', tool_input: { subagent_type: 'Explore', description: 'x', prompt: 'x' } }, at));
    s.applyAll(hook({ hook_event_name: 'SubagentStart', agent_id: 'sub', agent_type: 'Explore' }, at + 1));
  };

  it('the main agent is never dated to 1970', () => {
    const s = new StateStore();
    s.apply({ kind: 'session.title', sessionId: SID, at: 0, source: 'transcript', title: 't', priority: 2 });
    expect(s.agents.get(SID)?.startedAt).toBeGreaterThan(0);
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', prompt_id: 'p1' }, 5000));
    expect(s.agents.get(SID)?.startedAt).toBeLessThanOrEqual(5000);
  });

  it('ending the session stops its sub-agents, even one stuck in a tool', () => {
    const s = new StateStore();
    spawnSub(s, 1000);
    s.applyAll(hook({ hook_event_name: 'PreToolUse', agent_id: 'sub', agent_type: 'Explore', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'sleep 999' } }, 1500));
    s.applyAll(hook({ hook_event_name: 'SessionEnd', reason: 'other' }, 2000));
    expect(s.agents.get('sub')).toMatchObject({ status: 'done', currentTool: null });
    expect(s.agents.get('sub')?.endedAt).toBe(2000);
    expect(s.agents.get(SID)?.status).toBe('done');
  });

  it('older lines replayed after the end do not reopen the session', () => {
    const s = new StateStore();
    s.applyAll(hook({ hook_event_name: 'SessionEnd', reason: 'other' }, 5000));
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'old', prompt_id: 'p-old' }, 3000));
    s.applyAll(hook({ hook_event_name: 'Stop', last_assistant_message: 'old answer' }, 4000));
    expect(s.sessions.get(SID)?.status).toBe('ended');
    expect(s.agents.get(SID)?.status).toBe('done');
    // A genuinely newer prompt (resumed session) does.
    s.applyAll(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'new', prompt_id: 'p-new' }, 9000));
    expect(s.sessions.get(SID)?.status).toBe('active');
    expect(s.agents.get(SID)?.status).toBe('running');
  });

  it('a busy sub-agent silent for over an hour is finished by tick', () => {
    const s = new StateStore();
    spawnSub(s, 1000);
    s.applyAll(hook({ hook_event_name: 'PreToolUse', agent_id: 'sub', agent_type: 'Explore', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'make' } }, 1500));
    s.tick(1500 + 30 * 60_000);
    expect(s.agents.get('sub')?.status).toBe('running'); // a long command is fine…
    s.tick(1500 + 61 * 60_000);
    expect(s.agents.get('sub')?.status).toBe('done'); // …but not forever
  });

  it('meta.json read before the parent transcript does not merge different turns into a workflow', () => {
    const s = new StateStore();
    // Cold start: the small meta files are read first…
    s.applyAll(eventsFromAgentMeta(SID, 'agA', { agentType: 'Explore', toolUseId: 'tA' }, 1));
    s.applyAll(eventsFromAgentMeta(SID, 'agB', { agentType: 'Explore', toolUseId: 'tB' }, 1));
    // …then the main transcript: one agent in turn 1, another in turn 2.
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    const lines = [
      promptLine(0, 'premier tour', 'p-1'),
      ...assistantLines(1, 'm1', [toolUse('tA', 'Agent', { subagent_type: 'Explore', description: 'A', prompt: 'a' })]),
      toolResultLine(2, 'tA', 'ok', { status: 'completed', agentId: 'agA' }),
      promptLine(40, 'second tour', 'p-2'),
      ...assistantLines(41, 'm2', [toolUse('tB', 'Agent', { subagent_type: 'Explore', description: 'B', prompt: 'b' })]),
      toolResultLine(42, 'tB', 'ok', { status: 'completed', agentId: 'agB' }),
    ];
    for (const l of lines) s.applyAll(p.parseLine(l));
    s.flush();
    expect(s.agents.get('agA')?.parentTurn).toBe(1);
    expect(s.agents.get('agB')?.parentTurn).toBe(2);
    expect([...s.workflows.values()].filter((w) => w.sessionId === SID)).toEqual([]);
  });
});

describe('StateStore — live conversation', () => {
  const prompt = (text: string, at: number, id = `p-${at}`) => hook({ hook_event_name: 'UserPromptSubmit', prompt: text, prompt_id: id }, at);
  const queue = (op: 'enqueue' | 'dequeue' | 'remove', text: string | null, at: number) => ({ kind: 'message.queue' as const, sessionId: SID, at, source: 'transcript' as const, agentId: SID, op, text });
  const msgs = (s: StateStore) => [...s.messages.values()].filter((m) => m.sessionId === SID).sort((a, b) => a.at - b.at);

  it('records sent prompts and Claude replies in order', () => {
    const s = new StateStore();
    s.applyAll(prompt('bonjour', 1000));
    s.apply({ kind: 'assistant.text', sessionId: SID, at: 2000, source: 'transcript', agentId: SID, text: 'Salut !' });
    s.apply({ kind: 'assistant.text', sessionId: SID, at: 2000, source: 'transcript', agentId: SID, text: 'Salut !' }); // replayed line
    expect(msgs(s).map((m) => [m.role, m.text, m.state])).toEqual([
      ['user', 'bonjour', 'sent'],
      ['assistant', 'Salut !', 'sent'],
    ]);
  });

  it('a message typed while Claude works shows as queued, then delivered inside the running turn', () => {
    const s = new StateStore();
    s.applyAll(prompt('fais X', 1000));
    s.apply(queue('enqueue', 'et ajoute Y', 5000));
    expect(msgs(s)[1]).toMatchObject({ text: 'et ajoute Y', state: 'queued' });
    s.apply(queue('remove', 'et ajoute Y', 9000));
    s.apply({ kind: 'message.inject', sessionId: SID, at: 9001, source: 'transcript', agentId: SID, text: 'et ajoute Y' });
    expect(msgs(s)[1]).toMatchObject({ state: 'delivered', midTurn: true });
    expect(msgs(s)).toHaveLength(2);
    expect(s.sessions.get(SID)?.lastPrompt).toBe('et ajoute Y');
  });

  it('a queued message answered after the turn becomes a normal prompt, without a duplicate', () => {
    const s = new StateStore();
    s.apply(queue('enqueue', 'question', 1000));
    s.apply(queue('dequeue', null, 1005));
    s.applyAll(prompt('question', 1016));
    expect(msgs(s).map((m) => m.state)).toEqual(['sent']); // delivered at once: it never waited
    s.apply(queue('enqueue', 'suite', 3000));
    s.applyAll(prompt('suite', 20_000));
    expect(msgs(s).map((m) => m.state)).toEqual(['sent', 'delivered']);
  });

  it('a slash command goes through the queue and never comes back as a prompt: dequeue delivers it', () => {
    const s = new StateStore();
    s.apply(queue('enqueue', '/context', 1000));
    s.apply(queue('dequeue', null, 1030));
    expect(msgs(s).map((m) => [m.text, m.state])).toEqual([['/context', 'sent']]);
    // a prompt line that does follow a dequeue is merged, not duplicated
    s.apply(queue('enqueue', 'et ensuite ?', 5000));
    s.apply(queue('dequeue', null, 9000));
    s.applyAll(prompt('et ensuite ?', 9010));
    expect(msgs(s).map((m) => [m.text, m.state])).toEqual([['/context', 'sent'], ['et ensuite ?', 'delivered']]);
  });

  it('background notifications in the queue are not user messages; completed todos and tasks are', () => {
    const s = new StateStore();
    s.apply(queue('enqueue', '<task-notification>\n<task-id>x</task-id>\n</task-notification>', 1000));
    expect(msgs(s)).toEqual([]);
    const todos = (status: 'pending' | 'completed', at: number) => s.apply({ kind: 'todos', sessionId: SID, at, source: 'hook', agentId: SID, todos: [{ content: 'Écrire les tests', status, activeForm: null }] });
    todos('pending', 2000);
    todos('completed', 3000);
    todos('completed', 4000);
    expect(msgs(s).map((m) => [m.role, m.text])).toEqual([['task', 'Écrire les tests']]);
  });
});
