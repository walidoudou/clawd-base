import { describe, expect, it } from 'vitest';
import { TranscriptParser, eventsFromAgentMeta, identifyTranscript, parseTaskNotifications } from '../src/transcript.ts';
import type { NormalizedEvent } from '../src/events.ts';
import { SID, assistantLines, promptLine, subagentFirstLine, taskNotificationLine, text, thinking, toolResultLine, toolUse } from './fixtures.ts';

function parseAll(lines: string[], agentId: string | null = null): NormalizedEvent[] {
  const p = new TranscriptParser({ sessionId: SID, agentId, path: `/x/${SID}.jsonl` });
  return lines.flatMap((l) => p.parseLine(l));
}
const kinds = (evs: NormalizedEvent[]) => evs.map((e) => e.kind);

describe('identifyTranscript', () => {
  it('recognizes main, sub-agent and meta files', () => {
    expect(identifyTranscript(`/h/.claude/projects/-Users-x/${SID}.jsonl`)).toEqual({ sessionId: SID, agentId: null, kind: 'main' });
    expect(identifyTranscript(`/h/p/-x/${SID}/subagents/agent-a1b2c3d4e5f6a7b8c.jsonl`)).toEqual({ sessionId: SID, agentId: 'a1b2c3d4e5f6a7b8c', kind: 'subagent' });
    expect(identifyTranscript(`/h/p/-x/${SID}/subagents/agent-a1b2c3d4e5f6a7b8c.meta.json`)).toEqual({ sessionId: SID, agentId: 'a1b2c3d4e5f6a7b8c', kind: 'meta' });
    expect(identifyTranscript('/h/p/-x/notes.txt')).toBeNull();
  });
});

describe('TranscriptParser', () => {
  it('emits session.start once, then prompt', () => {
    const evs = parseAll([promptLine(1, 'Bonjour'), promptLine(2, 'Encore')]);
    expect(kinds(evs)).toEqual(['session.start', 'prompt', 'prompt']);
    const start = evs[0];
    expect(start?.kind === 'session.start' && start.cwd).toBe('/home/dev/projects/demo-app');
  });

  it('ignores meta lines, local command output and malformed JSON', () => {
    const meta = JSON.stringify({ type: 'user', isMeta: true, sessionId: SID, timestamp: new Date().toISOString(), message: { role: 'user', content: 'caveat' } });
    const local = promptLine(3, '<local-command-stdout>ok</local-command-stdout>');
    const evs = parseAll([meta, local, '{not json', '']);
    expect(kinds(evs).filter((k) => k === 'prompt')).toEqual([]);
  });

  it('emits one usage event per line but with the same message id', () => {
    const lines = assistantLines(4, 'msg_A', [thinking, text('hello'), toolUse('toolu_1', 'Bash', { command: 'ls' })], { out: 498 });
    const usage = parseAll(lines).filter((e) => e.kind === 'usage');
    expect(usage).toHaveLength(3);
    expect(new Set(usage.map((u) => (u.kind === 'usage' ? u.messageId : '')))).toEqual(new Set(['msg_A']));
    const u = usage[0];
    expect(u?.kind === 'usage' && u.usage).toEqual({ input: 2, output: 498, cacheCreate: 51832, cacheRead: 40868, total: 2 + 498 + 51832 + 40868 });
  });

  it('parses tool_use / tool_result and Bash output', () => {
    const evs = parseAll([
      ...assistantLines(5, 'msg_B', [toolUse('toolu_b', 'Bash', { command: 'ls -la' })], { stop: 'tool_use' }),
      toolResultLine(6, 'toolu_b', 'total 0', { stdout: 'total 0', stderr: '', interrupted: false, isImage: false }),
    ]);
    const start = evs.find((e) => e.kind === 'tool.start');
    const end = evs.find((e) => e.kind === 'tool.end');
    expect(start?.kind === 'tool.start' && start.parentMessageId).toBe('msg_B');
    expect(end?.kind === 'tool.end' && end.ok && end.name).toBe('Bash');
    expect(end?.kind === 'tool.end' && end.output).toBe('total 0');
  });

  it('marks errored tool results', () => {
    const evs = parseAll([
      ...assistantLines(5, 'msg_E', [toolUse('toolu_e', 'Bash', { command: 'false' })]),
      toolResultLine(6, 'toolu_e', 'Exit code 1', 'Error: Exit code 1', { isError: true }),
    ]);
    const end = evs.find((e) => e.kind === 'tool.end');
    expect(end?.kind === 'tool.end' && !end.ok && end.error).toBe('Exit code 1');
  });

  it('turns Agent tool calls into spawn + link events', () => {
    const evs = parseAll([
      ...assistantLines(7, 'msg_C', [
        toolUse('toolu_x', 'Agent', { subagent_type: 'Explore', description: 'Inspect', prompt: 'Read-only research' }),
        toolUse('toolu_y', 'Agent', { subagent_type: 'Plan', description: 'Plan it', prompt: 'Design' }),
      ]),
      toolResultLine(8, 'toolu_x', [{ type: 'text', text: 'launched' }], { isAsync: true, status: 'async_launched', agentId: 'aaa', resolvedModel: 'claude-opus-5-5' }),
    ]);
    const spawns = evs.filter((e) => e.kind === 'agent.spawn');
    expect(spawns).toHaveLength(2);
    expect(spawns.every((s) => s.kind === 'agent.spawn' && s.parentMessageId === 'msg_C' && s.parentAgentId === SID)).toBe(true);
    const link = evs.find((e) => e.kind === 'agent.link');
    expect(link).toMatchObject({ agentId: 'aaa', toolUseId: 'toolu_x', model: 'claude-opus-5-5' });
    expect(evs.some((e) => e.kind === 'agent.stop')).toBe(false); // async launch is not completion
  });

  it('treats task notifications as agent completion, not prompts', () => {
    const evs = parseAll([taskNotificationLine(9, 'aaa', 'toolu_x'), taskNotificationLine(10, 'bbb', 'toolu_y', 'failed')]);
    expect(kinds(evs).filter((k) => k !== 'session.start')).toEqual(['agent.stop', 'agent.stop']);
    expect(evs.filter((e) => e.kind === 'agent.stop').map((e) => (e.kind === 'agent.stop' ? e.status : ''))).toEqual(['done', 'error']);
  });

  it('parses a sub-agent transcript: first line is the prompt, events carry agentId', () => {
    const evs = parseAll(
      [
        subagentFirstLine(1, 'aaa', 'Full prompt here'),
        ...assistantLines(2, 'msg_S', [toolUse('toolu_s', 'Read', { file_path: '/a/b.ts' })], { agentId: 'aaa' }),
      ],
      'aaa',
    );
    expect(evs[0]).toMatchObject({ kind: 'agent.start', agentId: 'aaa', prompt: 'Full prompt here' });
    expect(evs.some((e) => e.kind === 'session.start')).toBe(false);
    const read = evs.find((e) => e.kind === 'file.change');
    expect(read?.kind === 'file.change' && read.change).toMatchObject({ operation: 'read', path: '/a/b.ts', agentId: 'aaa' });
  });

  it('builds file changes from real Edit / Write toolUseResult shapes', () => {
    const editResult = {
      filePath: '/r/diff.ts',
      oldString: 'a',
      newString: 'b',
      originalFile: 'x',
      structuredPatch: [{ oldStart: 70, oldLines: 3, newStart: 70, newLines: 2, lines: [' ctx', '-old1', '-old2', '+new'] }],
      userModified: false,
      replaceAll: false,
    };
    const writeCreate = { type: 'create', filePath: '/r/new.ts', content: 'l1\nl2\nl3\n', structuredPatch: [], originalFile: null, userModified: false };
    const writeUpdate = {
      type: 'update',
      filePath: '/r/plan.md',
      content: 'new',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['-# Old', '+# New', '+more'] }],
      originalFile: null,
      userModified: false,
    };
    const evs = parseAll([
      ...assistantLines(1, 'm1', [toolUse('t_e', 'Edit', { file_path: '/r/diff.ts', old_string: 'a', new_string: 'b' })]),
      toolResultLine(2, 't_e', 'ok', editResult),
      ...assistantLines(3, 'm2', [toolUse('t_c', 'Write', { file_path: '/r/new.ts', content: 'l1\nl2\nl3\n' })]),
      toolResultLine(4, 't_c', 'ok', writeCreate),
      ...assistantLines(5, 'm3', [toolUse('t_u', 'Write', { file_path: '/r/plan.md', content: 'new' })]),
      toolResultLine(6, 't_u', 'ok', writeUpdate),
    ]);
    const changes = evs.flatMap((e) => (e.kind === 'file.change' ? [e.change] : []));
    expect(changes.map((c) => [c.operation, c.diffSource, c.added, c.removed])).toEqual([
      ['edit', 'structuredPatch', 1, 2],
      ['create', 'snapshot', 3, 0],
      ['write', 'structuredPatch', 2, 1],
    ]);
    expect(changes[0]?.hunks[0]?.newStart).toBe(70);
  });

  it('emits titles, cost and end of turn', () => {
    const evs = parseAll([
      JSON.stringify({ type: 'custom-title', customTitle: 'Remote control', sessionId: SID }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Dashboard', sessionId: SID }),
      JSON.stringify({ type: 'cost-state', totalCostUSD: 1.23, sessionId: SID }),
      ...assistantLines(1, 'm9', [text('Fini !')], { stop: 'end_turn' }),
    ]);
    expect(evs.find((e) => e.kind === 'session.title')).toMatchObject({ title: 'Remote control', priority: 3 });
    expect(evs.find((e) => e.kind === 'session.cost')).toMatchObject({ totalCostUSD: 1.23 });
    expect(evs.find((e) => e.kind === 'turn.end')).toMatchObject({ lastMessage: 'Fini !' });
  });
});

describe('meta.json and notifications', () => {
  it('links a sub-agent to its spawning tool_use', () => {
    const evs = eventsFromAgentMeta(SID, 'aaa', { agentType: 'Explore', description: 'Inspect', toolUseId: 'toolu_x', spawnDepth: 1 }, 1);
    expect(evs.map((e) => e.kind)).toEqual(['agent.start', 'agent.link']);
    expect(evs[1]).toMatchObject({ agentId: 'aaa', toolUseId: 'toolu_x' });
  });

  it('parses multi-id notifications', () => {
    const n = parseTaskNotifications('<task-notification>\n<task-id>a</task-id>\n<task-id>b</task-id>\n<status>stopped</status>\n</task-notification>');
    expect(n).toEqual([{ taskIds: ['a', 'b'], toolUseId: null, status: 'stopped', summary: null }]);
  });
});

describe('TranscriptParser — real-world lines', () => {
  const at = (sec: number) => Date.UTC(2026, 9, 2, 20, 52, sec);
  const user = (sec: number, content: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'user', sessionId: SID, uuid: `x-${sec}`, parentUuid: 'p', timestamp: new Date(at(sec)).toISOString(), message: { role: 'user', content }, ...extra });
  const parse = (lines: string[]) => {
    const p = new TranscriptParser({ sessionId: SID, agentId: null });
    return lines.flatMap((l) => p.parseLine(l));
  };

  it('a file starting with an undated title is dated by its first timestamp, not 1970', () => {
    const evs = parse([JSON.stringify({ type: 'ai-title', aiTitle: 'Titre', sessionId: SID }), promptLine(5, 'bonjour')]);
    expect(evs.find((e) => e.kind === 'session.title')).toMatchObject({ title: 'Titre', at: at(5) });
    expect(evs.every((e) => e.at > 0)).toBe(true);
  });

  it('local commands, the /compact summary and shell input are not prompts', () => {
    const evs = parse([
      user(1, '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>', { promptId: 'shared' }),
      user(2, '<local-command-stdout>Set model to Opus</local-command-stdout>'),
      user(3, 'This session is being continued from a previous conversation…', { isCompactSummary: true }),
      user(4, '<bash-input>ls</bash-input>'),
      promptLine(5, 'la vraie question', 'shared'),
    ]);
    expect(evs.filter((e) => e.kind === 'prompt').map((e) => (e as { text: string }).text)).toEqual(['la vraie question']);
  });

  it('pressing Esc ends the turn', () => {
    const evs = parse([promptLine(1, 'go'), user(2, [{ type: 'text', text: '[Request interrupted by user]' }])]);
    expect(evs.filter((e) => e.kind === 'turn.end')).toHaveLength(1);
    expect(evs.filter((e) => e.kind === 'prompt')).toHaveLength(1);
  });

  it('synthetic all-zero usage does not reset the context', () => {
    const synthetic = JSON.stringify({
      type: 'assistant',
      sessionId: SID,
      uuid: 's1',
      timestamp: new Date(at(9)).toISOString(),
      message: { id: 'msg_syn', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }], stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    });
    expect(parse([synthetic]).filter((e) => e.kind === 'usage')).toEqual([]);
  });
});
