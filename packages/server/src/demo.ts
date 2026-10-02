/**
 * Guided demo: a scripted, narrated Claude Code session played in real time.
 *
 * It drives the exact same paths as a real session — hook payloads (as the plugin
 * would send them) and normalized events for what real sessions only expose
 * through transcripts (token usage). Used by the "▶ Démo" button (in-process
 * transport) and by `npm run simulate` (HTTP transport).
 */
import { randomUUID } from 'node:crypto';
import { makeUsage, type Narration, type NormalizedEvent } from '@dash/shared';

export interface DemoTransport {
  hook(payload: Record<string, unknown>): Promise<void>;
  events(events: NormalizedEvent[]): Promise<void>;
}

export interface DemoControl {
  speed: number;
  paused: boolean;
  aborted: boolean;
}

export class DemoAborted extends Error {
  constructor() {
    super('demo aborted');
  }
}

const CWD = '/home/dev/projets/boutique-en-ligne';
const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5-20251001' } as const;
const FILES = ['src/payment/stripe.ts', 'src/payment/index.ts', 'src/cart/Cart.tsx', 'src/api/orders.ts', 'src/lib/money.ts', 'tests/payment.test.ts', 'src/auth/session.ts', 'README.md', 'src/ui/Button.tsx', 'src/db/schema.sql'];
const WORDS = ['const', 'total', 'amount', 'await', 'return', 'order', 'cart', 'price', 'currency', 'user', 'items', 'export', 'function'];

const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;

function codeLine(): string {
  return `${' '.repeat(rnd(0, 3) * 2)}${Array.from({ length: rnd(2, 6) }, () => pick(WORDS)).join(' ')};`;
}

/** Scriptable fake session. All waits honour speed / pause / abort. */
export class Sim {
  readonly sessionId: string;
  private readonly tag = randomUUID().slice(0, 8);
  private tool = 0;
  private msg = 0;
  /** Main thread context, grows with the session (for the gauge and the compaction). */
  private context = 18_000;

  constructor(
    private readonly t: DemoTransport,
    private readonly ctl: DemoControl,
    prefix = 'sim',
    private readonly cwd = CWD,
    private readonly texts: { done: string; failed: string } = { done: 'Done: changes applied and verified.', failed: 'Failed: the migration crashed' },
  ) {
    this.sessionId = `${prefix}-${randomUUID()}`;
  }

  async sleep(ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      if (this.ctl.aborted) throw new DemoAborted();
      const step = Math.min(100, left);
      await new Promise((r) => setTimeout(r, step / Math.max(0.1, this.ctl.speed)));
      if (!this.ctl.paused) left -= step;
    }
    if (this.ctl.aborted) throw new DemoAborted();
  }

  private base(agentId: string | null, agentType = 'sim') {
    return {
      session_id: this.sessionId,
      transcript_path: `/tmp/${this.sessionId}.jsonl`,
      cwd: this.cwd,
      permission_mode: 'default',
      ...(agentId ? { agent_id: agentId, agent_type: agentType } : {}),
    };
  }

  hook(event: string, agentId: string | null, extra: Record<string, unknown>): Promise<void> {
    if (this.ctl.aborted) throw new DemoAborted();
    return this.t.hook({ ...this.base(agentId), hook_event_name: event, ...extra });
  }

  events(evs: NormalizedEvent[]): Promise<void> {
    return this.t.events(evs);
  }

  narrate(step: number, total: number, title: string, text: string, focus: Narration['focus'] = null, done = false): Promise<void> {
    return this.events([{ kind: 'narration', sessionId: this.sessionId, at: Date.now(), source: 'sim', narration: { step, total, title, text, at: Date.now(), focus, done } }]);
  }

  /** One assistant message worth of token usage. */
  usage(agentId: string | null, model: string, scale = 1): Promise<void> {
    const main = agentId === null;
    const cacheRead = main ? (this.context += rnd(2500, 7000)) : Math.round(rnd(12_000, 60_000) * scale);
    return this.events([
      {
        kind: 'usage',
        sessionId: this.sessionId,
        at: Date.now(),
        source: 'sim',
        agentId: agentId ?? this.sessionId,
        messageId: `msg_sim_${this.tag}_${++this.msg}`,
        model,
        usage: makeUsage(rnd(1, 40), Math.round(rnd(120, 900) * scale), rnd(0, 1) ? rnd(2000, 12000) : 0, cacheRead),
      },
    ]);
  }

  /** Push the main context near the limit, for the compaction step. */
  async inflateContext(target: number): Promise<void> {
    while (this.context < target) {
      this.context = Math.min(target, this.context + rnd(18_000, 30_000));
      await this.events([
        {
          kind: 'usage',
          sessionId: this.sessionId,
          at: Date.now(),
          source: 'sim',
          agentId: this.sessionId,
          messageId: `msg_sim_${this.tag}_${++this.msg}`,
          model: MODELS.opus,
          usage: makeUsage(4, rnd(300, 800), 0, this.context),
        },
      ]);
      await this.sleep(500);
    }
  }

  resetContext(value: number): void {
    this.context = value;
  }

  async toolCall(agentId: string | null, name: string, input: Record<string, unknown>, opts: { ms?: number; response?: unknown; fail?: string } = {}): Promise<string> {
    const id = `toolu_sim_${this.tag}_${++this.tool}`;
    const started = Date.now();
    await this.hook('PreToolUse', agentId, { tool_name: name, tool_input: input, tool_use_id: id });
    await this.sleep(opts.ms ?? rnd(900, 2200));
    const duration_ms = Date.now() - started;
    if (opts.fail) await this.hook('PostToolUseFailure', agentId, { tool_name: name, tool_input: input, tool_use_id: id, error: opts.fail, duration_ms });
    else await this.hook('PostToolUse', agentId, { tool_name: name, tool_input: input, tool_use_id: id, tool_response: opts.response ?? { stdout: 'ok', stderr: '' }, duration_ms });
    return id;
  }

  async todos(agentId: string | null, items: Array<[string, 'pending' | 'in_progress' | 'completed']>): Promise<void> {
    await this.toolCall(agentId, 'TodoWrite', { todos: items.map(([content, status]) => ({ content, status, activeForm: `${content}…` })) }, { ms: 300 });
  }

  async edit(agentId: string | null, file: string, size: 'small' | 'big' = 'small'): Promise<void> {
    const removed = size === 'big' ? rnd(3, 9) : rnd(0, 4);
    const added = size === 'big' ? rnd(8, 20) : rnd(1, 8);
    const start = rnd(5, 220);
    const lines = [` ${codeLine()}`, ...Array.from({ length: removed }, () => `-${codeLine()}`), ...Array.from({ length: added }, () => `+${codeLine()}`), ` ${codeLine()}`];
    const path = `${this.cwd}/${file}`;
    await this.toolCall(agentId, 'Edit', { file_path: path, old_string: 'x', new_string: 'y' }, {
      ms: rnd(1400, 2400),
      response: { filePath: path, structuredPatch: [{ oldStart: start, oldLines: removed + 2, newStart: start, newLines: added + 2, lines }], userModified: false, replaceAll: false },
    });
  }

  async write(agentId: string | null, file: string): Promise<void> {
    const path = `${this.cwd}/${file}`;
    const content = Array.from({ length: rnd(12, 40) }, codeLine).join('\n');
    await this.toolCall(agentId, 'Write', { file_path: path, content }, { ms: rnd(1400, 2200), response: { type: 'create', filePath: path, content, structuredPatch: [], originalFile: null } });
  }

  async read(agentId: string | null, file: string): Promise<void> {
    await this.toolCall(agentId, 'Read', { file_path: `${this.cwd}/${file}` }, { ms: rnd(900, 1600), response: { type: 'text', file: { filePath: `${this.cwd}/${file}`, numLines: rnd(20, 300) } } });
  }

  async bash(agentId: string | null, command: string, fail?: string): Promise<void> {
    await this.toolCall(agentId, 'Bash', { command }, { ms: rnd(1800, 3200), ...(fail ? { fail } : {}) });
  }

  /** Spawn a sub-agent from `parent` (main thread when null). */
  async spawn(parent: string | null, type: string, description: string, prompt: string, model: string): Promise<{ agentId: string; toolUseId: string }> {
    const toolUseId = `toolu_sim_${this.tag}_${++this.tool}`;
    const agentId = `a${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await this.hook('PreToolUse', parent, { tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { subagent_type: type, description, prompt, model } });
    await this.sleep(rnd(200, 500));
    await this.hook('SubagentStart', null, { agent_id: agentId, agent_type: type });
    await this.hook('PostToolUse', parent, {
      tool_name: 'Agent',
      tool_use_id: toolUseId,
      tool_input: { subagent_type: type, description, prompt },
      tool_response: { isAsync: true, status: 'async_launched', agentId, resolvedModel: model, description, prompt },
    });
    return { agentId, toolUseId };
  }

  async finish(agentId: string, msg: string, error = false): Promise<void> {
    if (error) await this.events([{ kind: 'agent.stop', sessionId: this.sessionId, at: Date.now(), source: 'sim', agentId, status: 'error', lastMessage: msg }]);
    else await this.hook('SubagentStop', null, { agent_id: agentId, agent_type: 'sim', last_assistant_message: msg });
  }

  /** A sub-agent doing realistic work. */
  async work(agentId: string, model: string, plan: { reads?: number; edits?: number; writes?: number; bash?: number; fail?: string; done?: string }): Promise<void> {
    for (let i = 0; i < (plan.reads ?? 2); i++) {
      await this.read(agentId, pick(FILES));
      await this.usage(agentId, model, 0.5);
    }
    if (Math.random() < 0.5) await this.toolCall(agentId, 'Grep', { pattern: pick(WORDS), path: this.cwd }, { ms: rnd(700, 1300) });
    for (let i = 0; i < (plan.edits ?? 0); i++) {
      await this.edit(agentId, pick(FILES));
      await this.usage(agentId, model);
    }
    for (let i = 0; i < (plan.writes ?? 0); i++) {
      await this.write(agentId, `src/generated/${pick(WORDS)}-${rnd(1, 99)}.ts`);
      await this.usage(agentId, model);
    }
    for (let i = 0; i < (plan.bash ?? 0); i++) {
      await this.bash(agentId, pick(['npm test', 'npx tsc --noEmit', 'git diff --stat', 'npm run lint']));
      await this.usage(agentId, model, 0.4);
    }
    await this.sleep(rnd(600, 1400));
    await this.usage(agentId, model, 0.6);
    if (plan.fail) {
      await this.bash(agentId, 'npm run migrate', plan.fail);
      await this.finish(agentId, this.texts.failed, true);
    } else await this.finish(agentId, plan.done ?? this.texts.done);
  }

  /** Stream an assistant message line by line (MessageDisplay hook). */
  async stream(agentId: string | null, text: string): Promise<void> {
    const messageId = randomUUID();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      await this.hook('MessageDisplay', agentId, { turn_id: 'turn', message_id: messageId, index: i, final: i === lines.length - 1, delta: `${lines[i]}${i === lines.length - 1 ? '' : '\n'}` });
      await this.sleep(rnd(700, 1100));
    }
  }
}

export const DEMO_STEPS = 18;
export type DemoLocale = 'fr' | 'en';

type Plan = Array<[string, 'pending' | 'in_progress' | 'completed']>;

/** Every human-readable string of the guided tour, per language. */
const TEXT = {
  fr: {
    cwd: '/home/dev/projets/boutique-en-ligne',
    title: 'Démo guidée — refonte du paiement',
    steps: [
      ['Une nouvelle session démarre', 'Claude Code vient d’être lancé dans le projet « boutique-en-ligne ». La base creuse la salle de la session principale et sa mascotte s’installe (une taupe mineuse par défaut, Clawd en option).'],
      ['Le prompt de l’utilisateur', 'L’utilisateur demande une refonte du module de paiement. Le prompt s’affiche sur le tableau, la mascotte se met au travail et la jauge de contexte se remplit.'],
      ['Claude planifie', 'Claude écrit sa todo-list. La tâche en cours apparaît sur le tableau (☐ 0/5), la liste complète est dans le panneau de l’agent : cliquez sur la salle pour l’ouvrir.'],
      ['Lecture du code', 'Pour lire, la mascotte va à l’étagère avec un parchemin. Chaque fichier lu apparaît en bleu (R) sur le tableau.'],
      ['Première modification', 'Pour éditer, elle passe au bureau : elle tape au clavier et les lignes ajoutées ou supprimées s’envolent. Le diff exact, avec ses numéros de ligne, est dans l’onglet Fichiers.'],
      ['Les tests échouent', 'La mascotte lance les tests au terminal… qui échouent. La salle tremble, des étincelles jaillissent et une notification d’erreur apparaît : rien n’est caché.'],
      ['Claude demande la permission', 'Claude veut exécuter une commande sensible et attend votre accord : point d’interrogation au-dessus de la mascotte, lampe ambre et ⚠ dans le titre de l’onglet.'],
      ['Correction et succès', 'Accord donné : la mascotte corrige l’arrondi, relance les tests, qui passent, et la todo-list avance.'],
      ['Trois agents en parallèle', 'Claude délègue : trois sous-agents Explore sont lancés dans le même message. Chaque salle est creusée en direct et chaque mascotte est unique, générée à partir de l’identifiant de l’agent.'],
      ['Les explorateurs travaillent', 'Ils lisent en parallèle, l’ascenseur suit l’étage actif. Quand un agent termine, il célèbre sous les confettis puis s’endort : sa salle s’éteint et se compacte.'],
      ['Étape 2 : un workflow apparaît', 'Un deuxième lot d’agents dans le même tour, et c’est désormais un workflow. La salle du chef (couronne ou toque) est construite, et des câbles s’illuminent vers l’étape active.'],
      ['Un agent délègue à son tour', 'Un sous-agent peut lancer ses propres agents : un câble violet en pointillés relie le parent à l’enfant.'],
      ['Étape 3 : relecture', 'Dernière étape : un agent Plan relit l’ensemble. Sur son tableau, le chef suit la progression des étapes (■ terminée, ▶ en cours).'],
      ['Le contexte se compacte', 'La jauge de contexte approche de la limite. Claude compacte la conversation : un tourbillon aspire les vieux messages et la jauge redescend.'],
      ['Un agent plante', 'Un agent chargé de la migration rencontre une erreur fatale : salle secouée, alarme rouge, notification. Il reste visible pour l’analyse.'],
      ['Workflow explicite', 'Avec la convention [workflow:nom step:n], on regroupe explicitement des agents. Voici l’audit de sécurité en deux étapes : quatre audits en parallèle, puis correctifs et rapport.'],
      ['Réponse en streaming', 'Avec le streaming activé (CLAWD_BASE_STREAM=1), la réponse s’écrit en direct dans une bulle au-dessus de la mascotte et dans son panneau.'],
      ['Fin de session', 'Session terminée : feu d’artifice au-dessus de la base ! Explorez maintenant la Chronologie (touche 3) et les Fichiers (touche 4) pour revoir tout ce qui s’est passé.'],
    ],
    end: ['Fin de la démo', 'Merci d’avoir suivi la visite ! Dans une minute, les agents terminés quitteront la base un par un (la mascotte sort, la salle est rebouchée) ; le bouton « Archivés » les réaffiche. Relancez la visite avec ▶ Démo.'],
    prompt: 'Refactorise le module de paiement, ajoute des tests et audite la sécurité du checkout.',
    plan: ['Lire le module de paiement', 'Corriger les arrondis', 'Explorer et tester en parallèle', 'Auditer la sécurité', 'Rédiger le bilan'],
    task: 'Refonte du paiement',
    permission: 'Claude a besoin de votre permission pour utiliser Bash',
    explorers: [
      ['Cartographier le module paiement', 'Explore src/payment et liste toutes les fonctions qui manipulent des montants. Rapporte les risques d’arrondi.'],
      ['Inventorier les tests existants', 'Trouve tous les tests liés au checkout et au paiement, puis résume leur couverture.'],
      ['Lire la doc Stripe locale', 'Lis docs/stripe.md et extrais les contraintes sur les clés d’idempotence.'],
    ],
    implementers: [
      ['Refactoriser money.ts', 'Remplace les flottants par des centimes entiers dans src/lib/money.ts et mets à jour les appelants.'],
      ['Écrire les tests de paiement', 'Ajoute des tests unitaires pour chargeCard, refund et les arrondis.'],
    ],
    nested: ['Chercher les appels à toFixed', 'Trouve tous les appels à toFixed() dans le dépôt et liste-les.'],
    reviewer: ['Relecture finale', 'Relis tout le diff du paiement, vérifie la cohérence et propose les derniers ajustements.'],
    reviewDone: 'Relecture terminée : tout est cohérent.',
    reportDone: 'Rapport livré.',
    migratePrompt: 'Lance aussi la migration de la base.',
    migrate: ['Migrer la base de données', 'Applique la migration 042 sur la base de développement.'],
    auditPrompt: 'Lance l’audit de sécurité du checkout.',
    auditName: 'audit-sécurité',
    auditTopics: ['XSS', 'CSRF', 'injection SQL', 'secrets'],
    auditTask: (topic: string) => `Audite le checkout pour : ${topic}. Liste les failles avec fichier et ligne.`,
    fixes: ['Correctifs', 'Applique les correctifs prioritaires identifiés à l’étape 1.'],
    report: ['Rapport', 'Rédige le rapport d’audit final en français.'],
    stream: 'Voici le bilan de la refonte :\n- money.ts utilise des centimes entiers\n- 12 nouveaux tests passent\n- audit de sécurité : 2 failles corrigées\nTout est prêt pour la revue.',
    stop: 'Refonte du paiement terminée, tests verts, audit livré.',
    workDone: 'Terminé : modifications appliquées et vérifiées.',
    workFailed: 'Échec : la migration a planté',
  },
  en: {
    cwd: '/home/dev/projects/online-shop',
    title: 'Guided demo — payment refactor',
    steps: [
      ['A new session starts', 'Claude Code was just launched in the “online-shop” project. The base digs the main session’s room and its mascot moves in (a miner mole by default, Clawd optionally).'],
      ['The user’s prompt', 'The user asks for a payment module refactor. The prompt shows on the board, the mascot gets to work and the context gauge fills up.'],
      ['Claude plans', 'Claude writes its todo list. The current task shows on the board (☐ 0/5); the full list is in the agent panel: click the room to open it.'],
      ['Reading code', 'To read, the mascot walks to the bookshelf with a scroll. Every file read shows in blue (R) on the board.'],
      ['First edit', 'To edit, it goes to the desk: it types and the added/removed lines fly away. The exact diff, with line numbers, is in the Files view.'],
      ['Tests fail', 'The mascot runs the tests at the terminal… and they fail. The room shakes, sparks fly and an error toast pops up: nothing is hidden.'],
      ['Claude asks for permission', 'Claude wants to run a sensitive command and waits for your approval: a question mark above the mascot, an amber lamp and ⚠ in the tab title.'],
      ['Fix and success', 'Approved: the mascot fixes the rounding, re-runs the tests, which pass, and the todo list moves on.'],
      ['Three agents in parallel', 'Claude delegates: three Explore sub-agents are launched in the same message. Each room is dug live and every mascot is unique, generated from the agent id.'],
      ['The explorers at work', 'They read in parallel; the elevator follows the active level. When an agent finishes it celebrates under confetti, then falls asleep: its room dims and compacts.'],
      ['Step 2: a workflow appears', 'A second batch of agents in the same turn makes it a workflow. The chief’s room (crown or chef hat) is built and cables light up towards the active step.'],
      ['An agent delegates too', 'A sub-agent can launch its own agents: a purple dotted cable links the parent to the child.'],
      ['Step 3: review', 'Last step: a Plan agent reviews everything. On its board, the chief tracks the steps (■ done, ▶ running).'],
      ['Context compaction', 'The context gauge nears the limit. Claude compacts the conversation: a whirlwind sucks old messages away and the gauge drops.'],
      ['An agent crashes', 'An agent running a migration hits a fatal error: shaking room, red alarm, toast. It stays visible for analysis.'],
      ['Explicit workflow', 'With the [workflow:name step:n] convention you group agents explicitly. Here is a two-step security audit: four parallel audits, then fixes and a report.'],
      ['Streaming answer', 'With streaming enabled (CLAWD_BASE_STREAM=1), the answer is written live in a bubble above the mascot and in its panel.'],
      ['Session over', 'Session ended: fireworks above the base! Now explore the Timeline (key 3) and Files (key 4) to replay everything that happened.'],
    ],
    end: ['End of the demo', 'Thanks for taking the tour! In a minute, finished agents will leave the base one by one (the mascot walks out, the room is filled in); the “Archived” button shows them again. Replay with ▶ Demo.'],
    prompt: 'Refactor the payment module, add tests and audit the checkout security.',
    plan: ['Read the payment module', 'Fix rounding errors', 'Explore and test in parallel', 'Audit security', 'Write the summary'],
    task: 'Payment refactor',
    permission: 'Claude needs your permission to use Bash',
    explorers: [
      ['Map the payment module', 'Explore src/payment and list every function that handles amounts. Report rounding risks.'],
      ['Inventory existing tests', 'Find all checkout and payment tests and summarize their coverage.'],
      ['Read the local Stripe docs', 'Read docs/stripe.md and extract the constraints on idempotency keys.'],
    ],
    implementers: [
      ['Refactor money.ts', 'Replace floats with integer cents in src/lib/money.ts and update the callers.'],
      ['Write payment tests', 'Add unit tests for chargeCard, refund and rounding.'],
    ],
    nested: ['Find toFixed calls', 'Find every toFixed() call in the repo and list them.'],
    reviewer: ['Final review', 'Review the whole payment diff, check consistency and suggest final tweaks.'],
    reviewDone: 'Review done: everything is consistent.',
    reportDone: 'Report delivered.',
    migratePrompt: 'Also run the database migration.',
    migrate: ['Migrate the database', 'Apply migration 042 to the development database.'],
    auditPrompt: 'Run the checkout security audit.',
    auditName: 'security-audit',
    auditTopics: ['XSS', 'CSRF', 'SQL injection', 'secrets'],
    auditTask: (topic: string) => `Audit the checkout for: ${topic}. List the issues with file and line.`,
    fixes: ['Fixes', 'Apply the priority fixes found in step 1.'],
    report: ['Report', 'Write the final audit report.'],
    stream: 'Here is the refactor summary:\n- money.ts now uses integer cents\n- 12 new tests pass\n- security audit: 2 issues fixed\nEverything is ready for review.',
    stop: 'Payment refactor done, tests green, audit delivered.',
    workDone: 'Done: changes applied and verified.',
    workFailed: 'Failed: the migration crashed',
  },
} as const;

/** The full guided tour, A to Z (≈ 3 minutes at speed 1). */
export async function runGuidedDemo(t: DemoTransport, ctl: DemoControl, onSession?: (sessionId: string) => void, locale: DemoLocale = 'fr'): Promise<string> {
  const L = TEXT[locale] ?? TEXT.fr;
  const s = new Sim(t, ctl, 'sim-demo', L.cwd, { done: L.workDone, failed: L.workFailed });
  onSession?.(s.sessionId);
  const N = DEMO_STEPS;
  const { opus, sonnet, haiku } = MODELS;
  const pause = (ms = 2500) => s.sleep(ms);
  const say = (step: number, focus: Narration['focus']) => {
    const [title, text] = L.steps[step - 1] as readonly [string, string];
    return s.narrate(step, N, title, text, focus);
  };
  const plan: Plan = L.plan.map((p, i) => [p, i === 0 ? 'in_progress' : 'pending']);
  const mark = (i: number, st: 'in_progress' | 'completed') => {
    plan[i] = [L.plan[i] as string, st];
  };

  // 1 — session
  await say(1, { kind: 'main' });
  await s.hook('SessionStart', null, { source: 'startup', model: opus });
  await s.events([{ kind: 'session.title', sessionId: s.sessionId, at: Date.now(), source: 'sim', title: L.title, priority: 3 }]);
  await pause(5000);

  // 2 — prompt
  await say(2, { kind: 'main' });
  await s.hook('UserPromptSubmit', null, { prompt: L.prompt, prompt_id: randomUUID(), source: 'user' });
  await s.sleep(1200);
  await s.usage(null, opus);
  await pause(3500);

  // 3 — todo list
  await say(3, { kind: 'main' });
  await s.todos(null, plan);
  await s.hook('TaskCreated', null, { task_id: 'demo-task', task_subject: L.task });
  await pause(4500);

  // 4 — reading
  await say(4, { kind: 'main' });
  await s.read(null, 'src/payment/stripe.ts');
  await s.usage(null, opus);
  await s.read(null, 'src/lib/money.ts');
  await s.toolCall(null, 'Grep', { pattern: 'chargeCard', path: L.cwd }, { ms: 1500 });
  await s.usage(null, opus);
  await pause(1500);

  // 5 — editing
  await say(5, { kind: 'main' });
  mark(0, 'completed');
  mark(1, 'in_progress');
  await s.todos(null, plan);
  await s.edit(null, 'src/payment/stripe.ts', 'big');
  await s.usage(null, opus);
  await pause(2500);

  // 6 — failing tests
  await say(6, { kind: 'main' });
  await s.bash(null, 'npm test -- payment', 'FAIL tests/payment.test.ts — expected 1999 to be 2000');
  await s.usage(null, opus);
  await pause(4000);

  // 7 — permission
  await say(7, { kind: 'main' });
  await s.hook('Notification', null, { notification_type: 'permission_prompt', message: L.permission });
  await pause(6500);

  // 8 — fix and success
  await say(8, { kind: 'main' });
  await s.edit(null, 'src/lib/money.ts');
  await s.bash(null, 'npm test -- payment');
  await s.usage(null, opus);
  mark(1, 'completed');
  mark(2, 'in_progress');
  await s.todos(null, plan);
  await pause(2500);

  // 9 — three parallel agents
  await say(9, { kind: 'overview' });
  const step1 = await Promise.all(L.explorers.map(([d, p]) => s.spawn(null, 'Explore', d, p, haiku)));
  await pause(3000);

  // 10 — explorers work and finish
  await say(10, { kind: 'overview' });
  await Promise.all(step1.map((a, i) => s.work(a.agentId, haiku, { reads: 2 + i, done: L.reportDone })));
  await s.usage(null, opus);
  await pause(3000);

  // 11 — second step → workflow
  await say(11, { kind: 'workflow', index: 0 });
  const step2 = await Promise.all(L.implementers.map(([d, p]) => s.spawn(null, 'general-purpose', d, p, sonnet)));
  await pause(2500);

  // 12 — nested agent
  await say(12, { kind: 'agent', toolUseId: step2[0]?.toolUseId ?? '' });
  const nested = await s.spawn(step2[0]?.agentId ?? null, 'Explore', L.nested[0], L.nested[1], haiku);
  await Promise.all([
    s.work(step2[0]?.agentId ?? '', sonnet, { reads: 2, edits: 3, bash: 1 }),
    s.work(step2[1]?.agentId ?? '', sonnet, { reads: 1, writes: 2, bash: 1 }),
    s.work(nested.agentId, haiku, { reads: 2 }),
  ]);
  await pause(1500);

  // 13 — third step
  await say(13, { kind: 'workflow', index: 0 });
  const step3 = await s.spawn(null, 'Plan', L.reviewer[0], L.reviewer[1], opus);
  await s.work(step3.agentId, opus, { reads: 3, edits: 1, done: L.reviewDone });
  mark(2, 'completed');
  mark(3, 'in_progress');
  await s.todos(null, plan);
  await pause(3000);

  // 14 — compaction
  await say(14, { kind: 'main' });
  await s.inflateContext(185_000);
  await s.sleep(1500);
  await s.hook('PostCompact', null, { trigger: 'auto' });
  s.resetContext(32_000);
  await s.usage(null, opus);
  await pause(3500);

  // 15 — crash
  await say(15, { kind: 'overview' });
  await s.hook('UserPromptSubmit', null, { prompt: L.migratePrompt, prompt_id: randomUUID(), source: 'user' });
  const crash = await s.spawn(null, 'general-purpose', L.migrate[0], L.migrate[1], sonnet);
  await s.work(crash.agentId, sonnet, { reads: 1, fail: 'Error: relation "orders" does not exist' });
  await pause(4000);

  // 16 — explicit workflow
  await say(16, { kind: 'workflow', index: 1 });
  await s.hook('UserPromptSubmit', null, { prompt: L.auditPrompt, prompt_id: randomUUID(), source: 'user' });
  await s.sleep(800);
  const tag = (n: number) => `[workflow:${L.auditName} step:${n}]`;
  const audit1 = await Promise.all(L.auditTopics.map((topic) => s.spawn(null, 'general-purpose', `${tag(1)} ${topic}`, `${tag(1)} ${L.auditTask(topic)}`, sonnet)));
  await Promise.all(audit1.map((a) => s.work(a.agentId, sonnet, { reads: rnd(1, 3), edits: rnd(0, 1) })));
  const audit2 = await Promise.all([
    s.spawn(null, 'general-purpose', `${tag(2)} ${L.fixes[0]}`, `${tag(2)} ${L.fixes[1]}`, opus),
    s.spawn(null, 'Plan', `${tag(2)} ${L.report[0]}`, `${tag(2)} ${L.report[1]}`, opus),
  ]);
  await Promise.all([s.work(audit2[0]?.agentId ?? '', opus, { reads: 1, edits: 4, bash: 1 }), s.work(audit2[1]?.agentId ?? '', opus, { reads: 2, writes: 1 })]);
  mark(3, 'completed');
  mark(4, 'in_progress');
  await s.todos(null, plan);
  await pause(2500);

  // 17 — streaming
  await say(17, { kind: 'main' });
  await s.stream(null, L.stream);
  mark(4, 'completed');
  await s.todos(null, plan);
  await s.hook('TaskCompleted', null, { task_id: 'demo-task', task_subject: L.task });
  await s.hook('Stop', null, { last_assistant_message: L.stop });
  await pause(3500);

  // 18 — end
  await say(18, { kind: 'surface' });
  await s.hook('SessionEnd', null, { reason: 'other' });
  await pause(9000);
  await s.narrate(18, N, L.end[0], L.end[1], { kind: 'overview' }, true);
  return s.sessionId;
}

/** Runs one demo at a time inside the server process. */
export class DemoRunner {
  private ctl: DemoControl | null = null;
  private current: string | null = null;

  constructor(private readonly transport: DemoTransport, private readonly onError: (m: string) => void = () => {}) {}

  get status(): { running: boolean; paused: boolean; sessionId: string | null; speed: number } {
    return { running: !!this.ctl, paused: this.ctl?.paused ?? false, sessionId: this.current, speed: this.ctl?.speed ?? 1 };
  }

  /** Start (or restart) the demo; resolves with the new session id as soon as it exists. */
  start(speed = 1, locale: DemoLocale = 'fr'): Promise<string> {
    this.stop();
    const ctl: DemoControl = { speed: Math.min(10, Math.max(0.25, speed)), paused: false, aborted: false };
    this.ctl = ctl;
    return new Promise((resolve) => {
      runGuidedDemo(
        this.transport,
        ctl,
        (id) => {
          this.current = id;
          resolve(id);
        },
        locale,
      )
        .catch((e: unknown) => {
          if (!(e instanceof DemoAborted)) this.onError(`demo: ${String(e)}`);
        })
        .finally(() => {
          if (this.ctl === ctl) this.ctl = null;
        });
    });
  }

  stop(): void {
    if (this.ctl) this.ctl.aborted = true;
    this.ctl = null;
  }

  setPaused(paused: boolean): void {
    if (this.ctl) this.ctl.paused = paused;
  }

  setSpeed(speed: number): void {
    if (this.ctl) this.ctl.speed = Math.min(10, Math.max(0.25, speed));
  }
}
