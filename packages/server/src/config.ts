import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SPRITE_SET } from '@dash/shared';

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  projectsDir: string;
  dataDir: string;
  persist: boolean;
  /** Only transcripts modified within this window are loaded at startup. */
  maxAgeHours: number;
  spriteSet: string;
  locale: string;
  webDir: string | null;
  version: string;
}

export const APP_ID = 'clawd-base';
export const VERSION = '1.1.0';
export const DEFAULT_PORT = 4317;

/** Environment variable `CLAWD_BASE_<name>` (legacy `CLAUDE_DASH_<name>` still accepted). */
export function env(name: string): string | undefined {
  return process.env[`CLAWD_BASE_${name}`] ?? process.env[`CLAUDE_DASH_${name}`];
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function findWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'web'), resolve(here, '../../../dist/web'), resolve(process.cwd(), 'dist/web')];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? null;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): ServerConfig {
  // Not CLAUDE_PLUGIN_DATA: Claude Code sets it for hooks but not for the /dashboard command, so the
  // hook and the server would read different config.json files (and disagree on the port).
  const dataDir = arg(argv, 'data-dir') ?? env('DATA_DIR') ?? join(homedir(), '.clawd-base');
  let file: Record<string, unknown> = {};
  const cfgPath = join(dataDir, 'config.json');
  if (existsSync(cfgPath)) {
    try {
      file = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    } catch {
      file = {};
    }
  }
  const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const port = num(arg(argv, 'port')) ?? num(env('PORT')) ?? num(file['port']) ?? DEFAULT_PORT;
  return {
    host: '127.0.0.1',
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    projectsDir: arg(argv, 'projects-dir') ?? env('PROJECTS_DIR') ?? (typeof file['projectsDir'] === 'string' ? (file['projectsDir'] as string) : join(process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude'), 'projects')),
    dataDir,
    persist: !argv.includes('--no-persist') && file['persist'] !== false,
    maxAgeHours: num(arg(argv, 'max-age-hours')) ?? num(file['maxAgeHours']) ?? 24,
    spriteSet: typeof file['spriteSet'] === 'string' ? (file['spriteSet'] as string) : DEFAULT_SPRITE_SET,
    locale: typeof file['locale'] === 'string' ? (file['locale'] as string) : 'fr',
    webDir: arg(argv, 'web-dir') ?? findWebDir(),
    version: VERSION,
  };
}
