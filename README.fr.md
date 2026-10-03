# Clawd Base — tableau de bord temps réel pour Claude Code

🇬🇧 [English version](README.md)

> **Projet indépendant, non affilié à Anthropic ni approuvé par Anthropic.** « Claude », « Claude Code » et « Clawd » sont des marques d'Anthropic. La mascotte par défaut est un personnage original ; le sprite Clawd, optionnel, est une interprétation pixel faite par un fan.

Plugin Claude Code **100 % local** qui affiche en direct tout ce qui se passe dans vos sessions : la session courante, chaque sous-agent dès son lancement, les workflows (agents organisés en étapes), les fichiers lus et modifiés avec leurs diffs, et les tokens (entrée, sortie, cache écrit, cache lu, total) par session, par agent et par workflow.

L'interface prend la forme d'une **base souterraine pixel-art**, vue en coupe façon Fallout Shelter. En surface, une cabane « CLAWD BASE » avec son antenne qui clignote à chaque événement. Sous terre, des étages creusés dans la roche, reliés par un ascenseur qui descend vers l'activité. Chaque session, agent et workflow a sa propre salle, avec une mascotte unique : par défaut **Taupi**, une taupe mineuse originale (Clawd, la mascotte de Claude Code, est disponible en option). Chaque mascotte se déplace selon son travail : étagère pour lire, bureau pour éditer, terminal pour les commandes, tableau pour réfléchir.

![Base avec workflow](docs/screenshots/base-workflow.png)
![Chronologie](docs/screenshots/chronologie.png)
![Attente et streaming](docs/screenshots/attente-streaming.png)
![Fichiers](docs/screenshots/fichiers.png)
![Panneau agent](docs/screenshots/panneau-agent.png)

*(Les captures montrent le simulateur, pas de données réelles.)*

---

## Démo guidée (à voir en premier)

Cliquez sur **▶ Démo** dans le HUD (l'interface est en français ou en anglais selon votre navigateur ; bouton FR/EN). Une session fictive se déroule en temps réel (≈ 3 min), avec des sous-titres qui expliquent chaque étape et une caméra qui se place d'elle-même au bon endroit. Les 18 étapes :

1. création de la session (la salle principale est creusée sous vos yeux) ;
2. prompt de l'utilisateur ;
3. todo-list ;
4. lecture de fichiers (étagère et parchemin) ;
5. édition (clavier, particules `+N/−N`, diff exact) ;
6. tests en échec (la salle tremble, étincelles, notification) ;
7. **demande de permission** (`?`, lampe ambre, `⚠` dans l'onglet) ;
8. correction et succès ;
9. **trois agents en parallèle** (une salle creusée pour chacun, mascottes uniques) ;
10. fin de leur travail (confettis, puis sommeil) ;
11. **un workflow apparaît** (salle du chef, câbles, paquets de données) ;
12. un agent qui délègue à son tour (lien violet) ;
13. étape de relecture ;
14. **compaction du contexte** (tourbillon, la jauge redescend) ;
15. **un agent qui plante** (alarme rouge tournante) ;
16. workflow explicite par marqueurs ;
17. réponse en streaming (bulle) ;
18. fin de session (**feu d'artifice** au-dessus de la base).

Le panneau des sous-titres propose pause, vitesse (×0,5 / ×1 / ×2), arrêt et « Rejouer ». En ligne de commande, `npm run simulate` joue la même démo par HTTP.

## Installation

Prérequis : **Claude Code ≥ 2.1** et **Node ≥ 22.13** (la persistance utilise le module natif `node:sqlite`). Le dépôt contient déjà la version construite (`dist/`), donc **aucun `npm install` n'est nécessaire**.

Dans Claude Code :

```
/plugin marketplace add walidoudou/clawd-base
/plugin install clawd-base@clawd-base
```

Redémarrez Claude Code, puis tapez **`/dashboard`** (ou `/clawd-base:dashboard`). Le navigateur s'ouvre sur **http://127.0.0.1:4317/**. Mises à jour : `/plugin marketplace update clawd-base`.

Pour développer, chargez directement une copie locale :

```bash
claude --plugin-dir /chemin/vers/clawd-base
```

## Utilisation

- Dans Claude Code : **`/dashboard`** (ou `/clawd-base:dashboard`) démarre le serveur si nécessaire et ouvre le navigateur.
- Hors de Claude Code : `npm run dashboard`, ou `node scripts/start.mjs [--no-open] [--port N]`.
- Adresse : **http://127.0.0.1:4317/**. Une page de debug en texte brut est disponible sur `/debug`.

Dans l'interface :

| Élément | Rôle |
|---|---|
| HUD (haut) | session (sélecteur), durée, tokens entrée/sortie/cache/total, coût estimé, **débit tokens/min** (sparkline sur 30 min), **jauge de contexte** de la session principale, agents actifs, workflows actifs, état de la connexion |
| Vue base | scène PixiJS : base souterraine avec la salle principale (Clawd orange), une salle par sous-agent, un bloc par workflow (salle du chef + une colonne par étape, reliées par des câbles animés), salles de décor (serveurs, serre, réserve…) |
| Vue liste | mise en page simple et accessible, avec les mêmes informations sous forme de cartes |
| Vue chronologie | diagramme de Gantt : une ligne par agent (groupée par workflow), un rectangle par appel d'outil, coloré par type (lecture, édition, commande, agent, erreur), avec les marqueurs d'étapes et un trait « maintenant » ; zoom et suivi en direct |
| Vue fichiers | tous les fichiers touchés dans la session : compteurs `+/-`, agents impliqués, diffs dépliables, filtre et tri |
| Journal | fil d'événements en direct (prompts, lancements, éditions, erreurs, attentes…), cliquable |
| Notifications | nouvel agent (regroupées par rafale), workflow détecté, erreur, **Claude attend votre permission** |
| Onglet du navigateur | `▶3 · Clawd Base` (agents au travail), préfixé de `⚠` quand Claude attend une réponse |
| Clic sur une salle | panneau latéral : prompt complet, modèle, statut, chronologie des outils, fichiers touchés, diffs par fichier (numéros de ligne, coloration syntaxique), détail des tokens |
| Clic sur un chef de workflow | étapes et agents de chaque étape, tokens et diffs agrégés ; un clic sur un agent ouvre son panneau |
| Molette / glisser | zoom (entier, pour rester pixel-perfect) et déplacement ; au zoom minimal, les salles n'affichent plus que de grandes étiquettes |
| Suivre l'activité | la caméra glisse vers la salle de l'agent le plus récemment actif |
| Mini-carte | vue d'ensemble de la base (couleur = statut) ; un clic recentre la caméra |
| Clavier | `Tab` parcourt les salles, `Entrée` ouvre, `Échap` ferme |
| Mode compact | réduit toutes les salles (activé automatiquement au-delà de 12 sous-agents) |

Ce que montre chaque salle : mascotte, modèle, statut (lampe colorée), pourcentage de contexte, outil en cours, tâche en cours de la todo-list (`☐ 2/5 …`), fichiers lus (`R`) ou écrits (`W`) récemment (`•` = moins de 30 s), début du prompt (~100 caractères), compteurs `+ajoutées/-supprimées`, mini-compteurs de tokens. L'écran du bureau fait défiler du code tant que l'agent travaille.

Animations qualitatives :
- **construction** : chaque nouvelle salle est creusée avec un échafaudage en pointillés, puis révélée de bas en haut dans la poussière ; ensuite les lumières s'allument en clignotant et la mascotte entre en scintillant ;
- **départ** : un agent terminé depuis 1 min 30 (5 min en cas d'erreur) quitte la base. Sa mascotte sort par la porte, puis la salle est rebouchée. Le bouton **Archivés (N)** les réaffiche, et ils restent toujours dans la chronologie, les fichiers et la vue liste. Un workflow dont tous les agents sont partis disparaît avec sa salle du chef ;
- **effets** : confettis à la fin d'un agent, grand confetti et câbles qui flashent à la fin d'un workflow, **feu d'artifice** à la fin d'une session ; étincelles et tremblement sur erreur, alarme rouge tournante tant qu'un agent est en erreur ; tourbillon de « compaction » ; particules `+12k tok` quand les tokens montent ; nom de l'outil qui s'envole à chaque nouvel appel ; paquets lumineux qui descendent les câbles quand une étape reçoit un agent ; « ding » de l'ascenseur à l'arrivée ;
- **vie** : une mascotte au repos flâne d'une station à l'autre et cligne des yeux naturellement ; petit balancement quand elle marche ; contour au survol et sélection en pointillés animés ;
- **ambiance** : ciel selon l'heure, lucioles et étoiles filantes la nuit.

Animations : la mascotte marche jusqu'à la bonne station. Lecture (Read, Grep, Glob, WebFetch…) → étagère + parchemin. Edit/Write → bureau + clavier, avec des particules `+N/-N`. Bash et outils MCP → terminal. Agent ou aucun outil → tableau + bulle de réflexion. Fin → célébration puis sommeil (`Z`). Erreur → mascotte surprise et flash rouge. Attente de permission → `?` jaune clignotant. Les nouvelles salles apparaissent avec un effet « pop », leurs lumières s'allument en clignotant et la mascotte entre par la porte. Les salles terminées passent en compact et s'éteignent.

## Streaming du texte (optionnel)

Claude Code 2.1 expose un hook `MessageDisplay` qui transmet la réponse par lignes complètes pendant qu'elle s'écrit. Le plugin le déclare, mais il ne fait rien tant que la variable `CLAWD_BASE_STREAM` ne vaut pas `1`. La garde shell coûte ~2 ms et Node n'est lancé que si le streaming est activé. Pour l'activer, ajoutez dans `~/.claude/settings.json` :

```json
{ "env": { "CLAWD_BASE_STREAM": "1" } }
```

Le texte apparaît alors dans une bulle au-dessus de la mascotte et dans le panneau de l'agent (« En train d'écrire »).

## Simulateur

Pour développer ou tester l'interface sans session réelle (le serveur doit tourner, via `npm run dev:server` ou `npm start`) :

```bash
npm run simulate
```

```bash
npm run simulate -- --speed 3 --loop
```

```bash
npm run simulate -- --replay ~/.claude/projects/<projet>/<session>.jsonl --speed 20
```

Le scénario scripté joue une session de démonstration : todo-list qui avance, demande de permission, édition, test qui échoue puis passe, workflow heuristique en 3 étapes (3 → 2 → 1 agents), 7 agents isolés, un agent en erreur, compaction du contexte, workflow explicite par marqueurs (`audit-sécurité`), réponse finale en streaming et tâches de session, soit plus de 20 salles. Les sessions simulées sont oubliées après 15 minutes d'inactivité. Le mode `--replay` rejoue un vrai transcript avec ses sous-agents, sous un nouvel identifiant de session. Les sessions simulées (`sim-…`) ne sont jamais persistées.

## Architecture

```
Claude Code ──hooks──▶ scripts/send-event.mjs ──POST /api/hook──▶ serveur Node (127.0.0.1:4317)
                         (non bloquant, exit 0)                      │   ▲
~/.claude/projects/**/*.jsonl ──────── chokidar (suivi incrémental) ─┘   │
                                                                        │
                         normalisation ─▶ StateStore (mémoire, idempotent) ─▶ SSE /api/stream ─▶ navigateur
                                              │                                    (React + PixiJS)
                                              └▶ node:sqlite (événements des hooks, optionnel)
```

- `packages/shared` : types, parseur de transcripts, adaptateur de hooks, diffs, détection des workflows, store (réducteur idempotent), sprites et générateur de mascottes. Tout ce code est pur et testé.
- `packages/server` : Fastify, watcher, snapshots de fichiers, persistance, SSE avec relecture (`Last-Event-ID`), page `/debug`.
- `packages/web` : Vite + React (HUD, panneaux, diffs avec highlight.js) + PixiJS v8 (scène). Toutes les chaînes d'interface sont dans `src/i18n/fr.ts`.
- `scripts/` : hook (`send-event.mjs`), démarrage (`start.mjs`), simulateur, build du serveur (esbuild).
- `docs/FINDINGS.md` : formats vérifiés sur cette machine (hooks, transcripts, résultats d'outils).

**Deux sources fusionnées en un flux unique.** Les hooks apportent la réactivité : outil en cours, lancement d'agents, snapshots pour les diffs. Les transcripts apportent les tokens, les modèles, l'activité des sous-agents et le regroupement par message, et servent de solution de repli. Chaque fait est normalisé en `NormalizedEvent`, puis réduit de façon idempotente : le même fait reçu des deux sources, ou rejoué, ne compte qu'une fois. **Sans hooks, le tableau de bord fonctionne quand même**, simplement avec un peu de latence, à partir des seuls transcripts.

## Règles

### Tokens

Claude Code écrit **une ligne de transcript par bloc de contenu** d'un message assistant, en répétant le même `usage` sur chaque ligne. L'usage est donc **dédupliqué par `message.id`** (la dernière ligne l'emporte ; `requestId` sert de repli). Total = entrée + sortie + cache écrit + cache lu. Le total d'une session est la somme de ses agents ; celui d'un workflow, la somme des agents de ses étapes.

### Diffs

1. `structuredPatch` du résultat d'outil (Edit et Write « update », reçu via `tool_response` du hook ou `toolUseResult` du transcript) : la source exacte, avec numéros de ligne.
2. Sinon, comparaison entre le snapshot pris au `PreToolUse` (fichiers ≤ 512 Ko) et le contenu sur disque après l'outil.
3. Sinon, reconstruction depuis `old_string`/`new_string`, en localisant la position dans le fichier si possible ; les lignes sont marquées « inconnues » sinon.

Un Write de création (`type: "create"`) compte toutes ses lignes comme ajoutées. Chaque modification affiche `+N/-M` et les plages touchées (`L12-18`).

### Workflows

Claude Code n'a pas de notion native de « workflow » pour les sous-agents. Règles appliquées, par ordre de priorité :

1. **Marqueurs explicites** `[workflow:<nom> step:<n>]` dans la description ou le prompt d'un sous-agent : ils forment le workflow `<nom>`, étape `n`, même s'il n'y a qu'une étape. Voir le skill `workflow-markers`.
2. **Outil natif `Workflow`** : les agents rattachés à cet appel (via `toolUseId` du `meta.json`) forment ce workflow ; les étapes correspondent à des regroupements par heure de lancement.
3. **Heuristique** : les appels Agent émis dans le **même message assistant** forment une étape parallèle ; le message suivant contenant des appels Agent, dans le **même tour utilisateur** et pour le même parent, forme l'étape suivante. **Deux étapes ou plus = un workflow.** Une étape unique n'en est pas un : ses agents restent des salles isolées.

Tant que seul le hook est connu (pas encore d'identifiant de message), les lancements à moins de 1,5 s d'intervalle sont regroupés ; le transcript corrige ensuite le regroupement. L'identifiant du workflow repose sur le `tool_use_id` du premier agent, ce qui le rend stable.

### Mascottes

Les sprites (`packages/shared/src/sprites/`) sont des grilles de caractères avec palette : `mole.ts` (Taupi, personnage original, par défaut) et `clawd.ts` (Clawd, dessiné d'après le glyphe terminal de Claude Code, `#D77757`). Il comporte 8 animations : idle, walk, type, read, think, celebrate, sleep, error. Chaque agent et chaque workflow reçoit une mascotte **unique et déterministe** : un hash FNV-1a de son identifiant alimente un générateur mulberry32, qui choisit la couleur du corps, un accessoire (chapeau, bonnet, casquette, lunettes, casque audio, cape, nœud, fleur, écharpe) et un détail (joues, taches de rousseur, antenne…). Les chefs de workflow portent toujours une couronne ou une toque. La session principale garde la couleur signature du personnage (taupe pour Taupi, orange pour Clawd).

**Remplacer le personnage** : ajoutez un `SpriteSet` dans `packages/shared/src/sprites/` (mêmes animations, palette et ancres), enregistrez-le dans `SPRITE_SETS`, puis choisissez-le avec `"spriteSet": "<id>"` dans `~/.clawd-base/config.json`.

## Configuration

`~/.clawd-base/config.json` (facultatif) :

```json
{ "port": 4317, "spriteSet": "mole", "persist": true, "maxAgeHours": 24 }
```

`spriteSet` : `"mole"` (par défaut, la taupe Taupi) ou `"clawd"`. Variables d'environnement (les anciennes `CLAUDE_DASH_*` restent acceptées) : `CLAWD_BASE_PORT` (serveur **et** hooks), `CLAWD_BASE_DATA_DIR`, `CLAWD_BASE_PROJECTS_DIR`, `CLAWD_BASE_STREAM`, et `CLAWD_BASE_CAPTURE=<fichier.jsonl>` pour enregistrer les payloads bruts des hooks (debug) ; placez-les dans le bloc `env` de `~/.claude/settings.json` pour que les hooks et `/dashboard` les voient tous les deux. Les transcripts sont lus dans `~/.claude/projects`, ou `$CLAUDE_CONFIG_DIR/projects` si `CLAUDE_CONFIG_DIR` est défini. Options du serveur : `--port`, `--projects-dir`, `--data-dir`, `--no-persist`, `--max-age-hours`.

## Confidentialité et sécurité

- Le serveur écoute **uniquement sur 127.0.0.1**. Il rejette les en-têtes `Host` et `Origin` non locaux (protection contre le DNS rebinding et le CSRF).
- Aucune requête externe, aucune télémétrie, aucun CDN : polices système, sprites et tuiles générés dans le code, dépendances empaquetées.
- Le hook ne bloque jamais Claude Code : il se termine toujours avec le code 0, n'écrit rien, s'arrête au bout de 0,8 s de requête (1,5 s au maximum) et se termine en ~40 ms si le serveur est arrêté. Seul le `PreToolUse` des outils Write/Edit est synchrone (timeout 2 s), pour capturer le fichier avant modification.
- Limites mémoire : sorties d'outils tronquées à 4 000 caractères, snapshots ≤ 512 Ko (32 Mo au total), 600 lignes de diff par modification, 2 000 outils par agent, 40 sessions.
- `~/.clawd-base` n'est lisible que par vous (0700, fichiers en 0600). À chaque démarrage, le serveur y écrit `server.json` (port + jeton aléatoire) ; le hook envoie ce jeton, et seuls les hooks authentifiés amènent le serveur à lire des fichiers (snapshots pour les diffs). Sur une machine partagée, les autres comptes locaux peuvent toujours joindre `127.0.0.1` et ouvrir le tableau de bord, mais pas lui faire lire vos fichiers.
- Après une mise à jour du plugin, `/dashboard` arrête l'ancien serveur (`POST /api/shutdown` authentifié) et démarre le nouveau.

## Hypothèses

- Formats vérifiés sur Claude Code **2.1.288** (voir `docs/FINDINGS.md`) : sur des payloads réels capturés, et via les schémas zod embarqués dans le binaire, qui font foi face à la doc. Écarts constatés et gérés : `PostToolUse` envoie `tool_response` (la doc dit `tool_output`) ; `PostToolUseFailure` envoie `error` et `is_interrupt` ; `StopFailure` envoie `error` et `error_details` ; `TaskCreated` envoie `task_subject`.
- Contexte : même formule que l'indicateur de Claude Code (`input + cache_creation + cache_read` de la dernière requête). La taille de fenêtre ne figurant pas dans les transcripts, elle est déduite : 200k, puis 1M dès qu'un contexte dépasse 200k.
- `SubagentStart` ne fournit pas le `tool_use_id` du lancement. L'agent est d'abord rattaché au plus ancien lancement en attente du même type, puis corrigé par l'`agentId` du résultat de l'outil Agent ou par le `meta.json` du sous-agent.
- `UserPromptSubmit` se déclenche aussi pour les `<task-notification>` (fin d'agents en arrière-plan). Ces notifications ne comptent pas comme des prompts : elles marquent la fin d'un agent.
- Au démarrage, seuls les transcripts modifiés dans les dernières 24 h sont chargés. Les plus anciens sont lus en entier s'ils redeviennent actifs. Si le serveur était arrêté, les transcripts permettent de rattraper l'historique.
- Une session sans activité depuis 10 minutes passe « inactive » ; les sessions vides (ni prompt, ni outil, ni token) sont masquées.
- Par défaut, l'interface suit la session la plus récemment active. Choisir une session dans le sélecteur la fige.

## Limites connues

- **Pas de streaming token par token** : les événements apparaissent au moment où Claude Code les émet (hooks aux frontières d'outils, lignes de transcript à la fin de chaque bloc). Le streaming optionnel (`MessageDisplay`) avance par lignes complètes, pas par token.
- **Le raisonnement interne peut ne pas être exposé** : les blocs de réflexion sont souvent masqués ou résumés et ne sont pas affichés.
- Les tokens ne viennent que des transcripts (les hooks n'en transportent pas), d'où un léger décalage.
- La détection heuristique des workflows reste une approximation ; utilisez les marqueurs pour un regroupement exact.
- Le payload exact de l'outil natif `Workflow` n'a pas pu être observé ; son rattachement est géré de façon défensive.
- Les numéros de ligne restent inconnus s'il n'y a ni `structuredPatch` ni snapshot (fichier > 512 Ko, ou hooks absents et outil sans patch).
- Le tableau de bord ne couvre qu'une seule machine et un seul utilisateur (`~/.claude/projects` local).

## Développement

```bash
npm run dev:server
```

```bash
npm run dev:web
```

```bash
npm test
```

```bash
npm run typecheck
```

`dev:server` lance le serveur avec rechargement à chaud (tsx). `dev:web` lance Vite sur http://127.0.0.1:5173, qui redirige `/api` vers le serveur. `npm test` exécute les tests Vitest : parsing des transcripts, déduplication des tokens, diffs, détection des workflows, mascottes déterministes, store (contexte, timeline, streaming, attente, tâches), adaptateur de hooks (schémas réels), **intégration du serveur** (watcher avec lignes coupées, sous-agents et `meta.json`, snapshots et diffs via les hooks, SSE avec relecture `Last-Event-ID`, protections Host/Origin, persistance `node:sqlite`), script de hook (serveur arrêté, entrée invalide, transfert intact) et mise en page de la base (aucun chevauchement, colonnes d'étapes, salles de décor, liens imbriqués). `npm run build` produit `dist/web` et `dist/server.mjs`.

Performances mesurées : 60 fps avec 22 salles animées sur GPU (Apple M5, Metal). Seules les salles visibles sont animées (culling), et les écrans, l'éclairage et les câbles ne sont redessinés que lorsqu'ils changent. Les onglets en arrière-plan ferment leur flux SSE après 20 s, pour ne pas épuiser la limite de 6 connexions HTTP par hôte.

## Licence

[MIT](LICENSE) © walidoudou. Dépendances embarquées : voir [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
