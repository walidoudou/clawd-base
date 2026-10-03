import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { APP_ID } from './config.ts';

/**
 * Runtime files in the data dir. `server.json` is the handshake between the running server and its
 * hook script: exact port + a per-run token. The data dir is owner-only, so only the user who started
 * the server can read the token; other local accounts can still reach 127.0.0.1 but not prove who they are.
 */
export const SERVER_INFO_FILE = 'server.json';
export const TOKEN_HEADER = 'x-clawd-token';

export interface ServerInfo {
  app: typeof APP_ID;
  port: number;
  pid: number;
  token: string;
  /** Absolute path of the running entry file (dist/server.mjs once packaged). */
  bundle: string;
  startedAt: string;
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** Constant-time comparison of a request header against this run's token. */
export function tokenMatches(header: unknown, token: string | null | undefined): boolean {
  if (!token || typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Create the data dir owner-only (0700). An existing one is tightened only if it is ours and dedicated
 * to Clawd Base (`.clawd-base`): a folder the user pointed CLAWD_BASE_DATA_DIR at keeps its permissions.
 */
export function ensurePrivateDir(dir: string): void {
  const existed = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existed && basename(dir) !== '.clawd-base') return;
  try {
    const st = statSync(dir);
    if (typeof process.getuid === 'function' && st.uid === process.getuid() && (st.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  } catch {
    /* best effort (Windows has no POSIX modes) */
  }
}

/** chmod 0600 if the file exists (files created by older versions kept the umask default). */
export function chmodPrivate(file: string): void {
  try {
    chmodSync(file, 0o600);
  } catch {
    /* missing, or not ours */
  }
}

/** Write server.json atomically, mode 0600 from the start (never readable by others, even briefly). */
export function writeServerInfo(dataDir: string, info: ServerInfo): void {
  const file = join(dataDir, SERVER_INFO_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const data = `${JSON.stringify(info, null, 2)}\n`;
  rmSync(tmp, { force: true });
  writeFileSync(tmp, data, { mode: 0o600, flag: 'wx' });
  try {
    renameSync(tmp, file);
  } catch {
    // Windows refuses to replace a file another process holds open: write in place instead.
    rmSync(tmp, { force: true });
    writeFileSync(file, data, { mode: 0o600 });
    chmodPrivate(file);
  }
}

/** Delete server.json, but only if it still describes this process (a newer server may own it now). */
export function removeServerInfo(dataDir: string, pid: number = process.pid): void {
  const file = join(dataDir, SERVER_INFO_FILE);
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerInfo>;
    if (info.pid === pid) unlinkSync(file);
  } catch {
    /* already gone */
  }
}
