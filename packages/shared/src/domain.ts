import type { Agent, Session, ToolEvent } from './types.ts';

/**
 * Which field a session, agent or workflow is working in (game dev, marketing, video…), guessed
 * locally from what the dashboard already sees: MCP servers and skills used, files touched, shell
 * commands, project folder, prompt and title keywords. Pure: the web picks a room theme from it.
 */

export const DOMAINS = ['code', 'game', 'marketing', 'business', 'video', 'design', 'audio', 'bot', 'data', 'devops', 'security', 'web'] as const;
export type Domain = (typeof DOMAINS)[number];

export interface DomainSignals {
  /** Session title, agent description or workflow name: its keywords count double. */
  title?: string | null;
  /** Prompts and messages (weak). */
  texts: string[];
  /** Project folder name (medium). */
  project?: string | null;
  /** Paths of files read or edited (medium, by extension / path). */
  files: string[];
  /** Tool names used (MCP servers among them are strong). */
  tools: string[];
  /** Shell commands run (medium). */
  commands: string[];
  /** Skills invoked or attributed (strong). */
  skills: string[];
  /** MCP servers usage was attributed to (strong). */
  mcpServers: string[];
  /** Share of the room's usage per MCP server or skill (0–1): the more it is used, the more it counts. */
  shares?: Record<string, number>;
  /** Sub-agent type, e.g. `ecc:security-reviewer` (strong when it names a field). */
  agentType?: string | null;
  /** Domain of the parent (session for an agent): a weak prior, so agents follow their session unless they clearly do something else. */
  prior?: Domain | null;
}

export interface DomainReason {
  kind: 'mcp' | 'skill' | 'agent' | 'files' | 'project' | 'command' | 'keyword' | 'prior';
  /** What matched: server, skill, extension (with count), keyword… */
  value: string;
  points: number;
}

interface Rule {
  /** MCP server or tool name (`mcp__<server>__…`). */
  mcp?: RegExp;
  /** Skill or sub-agent type. */
  skill?: RegExp;
  /** File path (extension or folder). */
  file?: RegExp;
  project?: RegExp;
  command?: RegExp;
  /** Whole words, FR + EN, matched case-insensitively. */
  words: string[];
}

const RULES: Record<Exclude<Domain, 'code'>, Rule> = {
  game: {
    mcp: /roblox|unity|unreal|godot|uefn|fortnite/i,
    skill: /roblox|uefn|unity|godot|unreal|game/i,
    file: /\.(verse|luau|rbxl|rbxlx|rbxm|rbxmx|uasset|umap|uplugin|uproject|unity|prefab|gd|tscn|tres)$/i,
    project: /uefn|fortnite|roblox|unity|godot|unreal|game|jeu/i,
    command: /\b(rojo|wally|godot|unityhub|UnrealEditor)\b/i,
    words: ['uefn', 'verse', 'fortnite', 'roblox', 'luau', 'unity', 'godot', 'unreal', 'gameplay', 'jeu vidéo', 'jeux vidéo', 'jeu', 'game', 'gamer', 'level design', 'npc', 'pnj', 'joueur', 'joueurs', 'player', 'players', 'obby', 'tycoon', 'leaderboard'],
  },
  marketing: {
    mcp: /klaviyo|ahrefs|semrush|mailchimp|similarweb|supermetrics|amplitude|postiz|buffer|meta.?ads|google.?ads|tiktok/i,
    skill: /^marketing:|seo|copywriting|copy-editing|\bads?\b|ad-creative|campaign|social|emails?\b|launch|cro\b|brand|postiz|content|influencer|newsletter/i,
    project: /marketing|growth|seo|brand|campagne|campaign/i,
    words: ['marketing', 'seo', 'campagne', 'campagnes', 'campaign', 'campaigns', 'publicité', 'pub', 'pubs', 'ads', 'newsletter', 'emailing', 'copywriting', 'réseaux sociaux', 'social media', 'instagram', 'tiktok', 'linkedin', 'tweet', 'audience', 'funnel', 'leads', 'branding', 'influenceur', 'influencer', 'growth', 'engagement', 'persona'],
  },
  business: {
    mcp: /stripe|quickbooks|salesforce|hubspot|xero|zoho|pipedrive|shopify|paypal|square|gusto|ramp|expensify|docusign|systeme/i,
    skill: /^sales:|^small-business:|finance|invoice|pricing|payroll|tax|offers|revops|prospect/i,
    file: /\.(xlsx|xls|ods)$/i,
    project: /business|finance|compta|invoice|facture|crm|shop|boutique|store/i,
    words: ['business', 'finance', 'facture', 'factures', 'invoice', 'invoices', 'devis', 'comptabilité', 'crm', 'ventes', 'sales', "chiffre d'affaires", 'revenue', 'pricing', 'tarif', 'tarifs', 'prospect', 'prospects', 'budget', 'paie', 'payroll', 'impôts', 'tax', 'boutique', 'e-commerce', 'ecommerce', 'shopify', 'stripe', 'abonnement', 'subscription'],
  },
  video: {
    mcp: /remotion|videodb|youtube|runway|heygen/i,
    skill: /video|film|remotion|motion|manim|tasteforge/i,
    file: /\.(mp4|mov|webm|mkv|prproj|aep|fcpxml|drp)$/i,
    project: /video|vidéo|film|motion|remotion|clip|youtube|trailer/i,
    command: /\b(ffmpeg|ffprobe|remotion|manim)\b/i,
    words: ['vidéo', 'vidéos', 'video', 'videos', 'film', 'remotion', 'motion design', 'montage', 'clip', 'trailer', 'teaser', 'storyboard', 'youtube', 'keyframe', 'keyframes', 'cinématique', 'cinematic', 'reel'],
  },
  design: {
    mcp: /figma|canva|blender|penpot|sketch|tripo|hyper3d|hunyuan/i,
    skill: /design|canvas|figma|brand-guidelines|theme-factory|liquid-glass|taste|interfaces/i,
    file: /\.(fig|sketch|psd|ai|blend|xd|kra|procreate|glb|gltf|fbx|obj)$/i,
    project: /design|figma|blender|3d|ui-?kit|mockup/i,
    command: /\b(blender|inkscape|magick|convert)\b/i,
    words: ['design', 'maquette', 'maquettes', 'mockup', 'figma', 'blender', '3d', 'logo', 'typographie', 'typography', 'illustration', 'wireframe', 'charte graphique', 'modèle 3d', 'texture', 'textures', 'rendu 3d'],
  },
  audio: {
    mcp: /elevenlabs|spotify|suno|audio|soundcloud/i,
    skill: /audio|music|voice|sound|tts/i,
    file: /\.(wav|mp3|flac|ogg|aiff|aif|mid|midi|als|flp|m4a)$/i,
    project: /audio|music|musique|sound|podcast|beat/i,
    command: /\b(sox|afplay|lame)\b/i,
    words: ['musique', 'music', 'sound', 'sounds', 'audio', 'voix', 'voice', 'voix off', 'voiceover', 'podcast', 'beat', 'mixage', 'mastering', 'sfx', 'bruitage', 'tts', 'elevenlabs', 'chanson', 'mélodie', 'melody', 'bpm', 'synthé'],
  },
  bot: {
    mcp: /discord|telegram/i,
    skill: /discord|bot/i,
    project: /bot|discord|telegram/i,
    words: ['discord', 'discord.js', 'bot', 'bots', 'slash command', 'slash commands', 'commande slash', 'commandes slash', 'guild', 'guilds', 'serveur discord', 'telegram', 'embed', 'embeds', 'intents'],
  },
  data: {
    mcp: /jupyter|bigquery|snowflake|databricks|huggingface|kaggle|clickhouse/i,
    skill: /\bdata\b|pytorch|\bml\b|rag-|llm|scientific|eval|recsys|mle/i,
    file: /\.(ipynb|parquet|pkl|pt|pth|onnx|h5|safetensors|csv|tsv)$/i,
    project: /data|\bml\b|\bai\b|\bia\b|llm|analytics|notebook/i,
    command: /\b(jupyter|nvidia-smi|ollama)\b|pip3? install .*(torch|tensorflow|pandas|scikit|transformers)/i,
    words: ['données', 'data', 'dataset', 'datasets', 'machine learning', 'ml', 'ia', 'llm', 'pandas', 'numpy', 'pytorch', 'tensorflow', 'entraînement', 'training', 'embedding', 'embeddings', 'rag', 'notebook', 'statistiques', 'statistics', 'régression', 'regression', 'classification', 'fine-tuning', 'inference', 'inférence'],
  },
  devops: {
    mcp: /docker|kubernetes|aws|gcp|azure|vercel|cloudflare|terraform|sentry|netlify|railway|fly/i,
    skill: /deploy|docker|kubernetes|devops|infra|terraform|pm2|canary|uncloud/i,
    file: /(dockerfile|docker-compose\.ya?ml|compose\.ya?ml|\.tf|\.github\/workflows\/[^/]+\.ya?ml|nginx\.conf|\.service|k8s\/[^/]+\.ya?ml|helm\/)/i,
    project: /infra|devops|deploy|server|k8s|docker|ops/i,
    command: /\b(docker|kubectl|helm|terraform|systemctl|pm2|nginx|vercel|flyctl|ssh|scp)\b|\bgh (run|workflow)\b|\baws /i,
    words: ['déploiement', 'déployer', 'deploy', 'deployment', 'docker', 'kubernetes', 'k8s', 'ci/cd', 'vps', 'nginx', 'infra', 'infrastructure', 'monitoring', 'uptime', 'ssl', 'dns', 'terraform', 'conteneur', 'container', 'cluster'],
  },
  security: {
    mcp: /burp|nmap|shodan|semgrep|snyk|virustotal/i,
    skill: /security|pentest|bounty|safety|sanitiz|hipaa|gateguard/i,
    file: /\.(pem|key|crt|p12)$/i,
    project: /secu|pentest|ctf|hack|vuln/i,
    command: /\b(nmap|sqlmap|hydra|nikto|semgrep|trivy|gitleaks)\b|npm audit/i,
    words: ['sécurité', 'security', 'vulnérabilité', 'vulnérabilités', 'vulnerability', 'vulnerabilities', 'cve', 'pentest', 'faille', 'failles', 'xss', 'injection', 'csrf', 'ctf', 'exploit', 'chiffrement', 'encryption', 'malware', 'phishing', 'owasp'],
  },
  web: {
    skill: /frontend|react|vue|next|vite|css|tailwind|\bweb\b|angular|nuxt|a11y/i,
    file: /\.(tsx|jsx|vue|svelte|astro|css|scss|sass|less|html)$/i,
    project: /web|site|front|landing|portfolio/i,
    command: /\b(vite|next (dev|build)|npm run dev|astro)\b/i,
    words: ['site web', 'website', 'frontend', 'front-end', 'react', 'next.js', 'nextjs', 'css', 'tailwind', 'html', 'landing page', 'page web', 'composant', 'composants', 'component', 'components', 'responsive', 'navigateur', 'browser'],
  },
};

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_RE = Object.fromEntries(
  Object.entries(RULES).map(([d, r]) => [d, new RegExp(`(?<![\\p{L}\\p{N}_])(?:${r.words.map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu')]),
) as Record<Exclude<Domain, 'code'>, RegExp>;

/** Scores per domain, and why. */
export function scoreDomains(sig: DomainSignals): { scores: Record<Domain, number>; reasons: Record<Domain, DomainReason[]> } {
  const scores = Object.fromEntries(DOMAINS.map((d) => [d, 0])) as Record<Domain, number>;
  const reasons = Object.fromEntries(DOMAINS.map((d) => [d, [] as DomainReason[]])) as Record<Domain, DomainReason[]>;
  const add = (d: Domain, r: DomainReason): void => {
    scores[d] += r.points;
    reasons[d].push(r);
  };
  // `plugin:ecc:github` (usage) and `plugin_ecc_github` (tool names) are the same server.
  const norm = (s: string): string => s.replace(/[:\s]/g, '_');
  const servers = new Set(sig.mcpServers.map(norm));
  for (const t of sig.tools) if (t.startsWith('mcp__')) servers.add(norm(t.split('__')[1] ?? ''));
  const shares = Object.fromEntries(Object.entries(sig.shares ?? {}).map(([k, v]) => [norm(k), v]));
  /** 4, up to 12 for what takes most of the usage. */
  const strong = (name: string): number => Math.min(12, 4 + Math.round((shares[norm(name)] ?? 0) * 10));
  const skills = new Set(sig.skills);
  const text = sig.texts.filter(Boolean).join('\n');

  for (const [key, r] of Object.entries(RULES) as Array<[Exclude<Domain, 'code'>, Rule]>) {
    for (const s of servers) if (s && r.mcp?.test(s)) add(key, { kind: 'mcp', value: s, points: strong(s) });
    for (const s of skills) if (r.skill?.test(s)) add(key, { kind: 'skill', value: s, points: strong(s) });
    if (sig.agentType && r.skill?.test(sig.agentType)) add(key, { kind: 'agent', value: sig.agentType, points: 5 });
    if (r.file) {
      const hits = sig.files.filter((f) => r.file?.test(f));
      if (hits.length) {
        const ext = /\.[a-z0-9]+$/i.exec(hits[0] ?? '')?.[0] ?? hits[0]?.split('/').pop() ?? '';
        add(key, { kind: 'files', value: `${hits.length} × ${ext}`, points: Math.min(6, 2 * hits.length) });
      }
    }
    if (sig.project && r.project?.test(sig.project)) add(key, { kind: 'project', value: sig.project, points: 3 });
    if (r.command) {
      const hits = sig.commands.filter((c) => r.command?.test(c));
      // Often incidental (one ffprobe in a web project): light.
      if (hits.length) add(key, { kind: 'command', value: (r.command.exec(hits[0] ?? '')?.[0] ?? '').trim(), points: Math.min(3, hits.length) });
    }
    const inTitle = new Set(sig.title ? [...sig.title.matchAll(WORD_RE[key])].map((m) => m[0].toLowerCase()) : []);
    const words = new Set([...inTitle, ...(text ? [...text.matchAll(WORD_RE[key])].map((m) => m[0].toLowerCase()) : [])]);
    if (words.size) add(key, { kind: 'keyword', value: [...words].slice(0, 3).join(', '), points: Math.min(8, words.size + inTitle.size) });
  }
  if (sig.prior && sig.prior !== 'code') add(sig.prior, { kind: 'prior', value: sig.prior, points: 5 });
  for (const d of DOMAINS) reasons[d].sort((a, b) => b.points - a.points);
  return { scores, reasons };
}

/** Minimum score before a room changes from the default look. */
const THRESHOLD = 5;
/** A new domain must beat the current one by this much (no flickering between themes). */
const MARGIN = 3;

/** The domain to show, keeping `current` unless another one clearly wins. */
export function pickDomain(scores: Record<Domain, number>, current: Domain | null = null): Domain {
  let best: Domain = 'code';
  for (const d of DOMAINS) if (d !== 'code' && scores[d] > (best === 'code' ? 0 : scores[best])) best = d;
  if (scores[best] < THRESHOLD) best = 'code';
  if (!current || current === 'code' || best === current) return best;
  return scores[best] >= scores[current] + MARGIN ? best : current;
}

export interface DomainGuess {
  domain: Domain;
  reasons: DomainReason[];
}

/** Score + pick in one go; `current` is the domain shown so far (hysteresis). */
export function detectDomain(sig: DomainSignals, current: Domain | null = null): DomainGuess {
  const { scores, reasons } = scoreDomains(sig);
  const domain = pickDomain(scores, current);
  return { domain, reasons: reasons[domain].slice(0, 3) };
}

/** What the dashboard knows about one room, gathered into signals (pure, from store data). */
export function roomSignals(input: {
  agent: Pick<Agent, 'kind' | 'type' | 'description' | 'prompt' | 'files'>;
  session?: Pick<Session, 'title' | 'project' | 'lastPrompt' | 'usageShares'> | null;
  tools: Array<Pick<ToolEvent, 'name' | 'input'>>;
  /** User messages of the room (prompts typed, newest last). */
  asked?: string[];
  prior?: Domain | null;
}): DomainSignals {
  const { agent, session, tools } = input;
  const main = agent.kind === 'main';
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    title: main ? (session?.title ?? null) : agent.description,
    texts: [
      ...(main ? [session?.lastPrompt ?? ''] : [agent.type]),
      agent.prompt.slice(0, 2000),
      ...(input.asked ?? []).slice(-10).map((t) => t.slice(0, 1000)),
    ],
    project: main ? (session?.project ?? null) : null,
    files: Object.keys(agent.files),
    tools: [...new Set(tools.map((t) => t.name))],
    commands: tools.filter((t) => t.name === 'Bash').map((t) => str(t.input['command']) ?? '').filter(Boolean).slice(-200),
    skills: [
      ...tools.filter((t) => t.name === 'Skill').map((t) => str(t.input['skill']) ?? '').filter(Boolean),
      ...(main && session ? Object.keys(session.usageShares.skills) : []),
    ],
    mcpServers: main && session ? Object.keys(session.usageShares.mcpServers) : [],
    shares: main && session && session.usageShares.total > 0
      ? Object.fromEntries([...Object.entries(session.usageShares.mcpServers), ...Object.entries(session.usageShares.skills)].map(([k, v]) => [k, v / session.usageShares.total]))
      : {},
    agentType: main ? null : agent.type,
    prior: input.prior ?? null,
  };
}
