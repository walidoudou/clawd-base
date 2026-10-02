import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/send-event.mjs', import.meta.url));

function run(payload: string, port: number): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn(process.execPath, [script], { env: { ...process.env, CLAWD_BASE_PORT: String(port) } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - start }));
    p.stdin.end(payload);
  });
}

describe('scripts/send-event.mjs (hook)', () => {
  it('exits 0 quickly and silently when the server is down', async () => {
    const r = await run('{"session_id":"x","hook_event_name":"Stop"}', 9); // nothing listens on port 9
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.ms).toBeLessThan(1600);
  });

  it('exits 0 on empty or invalid input', async () => {
    expect((await run('', 9)).code).toBe(0);
    expect((await run('not json', 9)).code).toBe(0);
  });

  it('forwards the payload unchanged to POST /api/hook', async () => {
    let received = '';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        if (req.url === '/api/hook' && req.method === 'POST') received = body;
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const payload = '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash"}';
    const r = await run(payload, port);
    server.close();
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(received).toBe(payload);
  });
});
