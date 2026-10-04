import { describe, expect, it } from 'vitest';
import { detectDomain, type DomainSignals } from '../src/domain.ts';

const sig = (p: Partial<DomainSignals>): DomainSignals => ({ texts: [], files: [], tools: [], commands: [], skills: [], mcpServers: [], ...p });

describe('detectDomain', () => {
  it('recognises typical sessions', () => {
    expect(detectDomain(sig({ project: 'BOTKAITOUEFN', files: ['/x/Game/player.verse', '/x/Game/hud.verse'], texts: ['Ajoute un leaderboard au jeu UEFN'] })).domain).toBe('game');
    expect(detectDomain(sig({ tools: ['mcp__Roblox_Studio__execute_luau'], mcpServers: ['Roblox_Studio'], shares: { Roblox_Studio: 0.75 }, title: 'robloxclaude' })).domain).toBe('game');
    expect(detectDomain(sig({ project: 'WCorpBOT', texts: ['Discord bot recreation'], files: ['/x/commands/ping.js'] })).domain).toBe('bot');
    expect(detectDomain(sig({ skills: ['anthropic-skills:motion-design-video'], commands: ['npx remotion render'], texts: ['Vidéo motion design du projet'] })).domain).toBe('video');
    expect(detectDomain(sig({ skills: ['marketing:seo-audit'], texts: ['Plan de campagne et newsletter pour le lancement'] })).domain).toBe('marketing');
    expect(detectDomain(sig({ files: ['/x/Dockerfile', '/x/.github/workflows/ci.yml'], commands: ['docker compose up -d', 'kubectl get pods'] })).domain).toBe('devops');
    expect(detectDomain(sig({ agentType: 'ecc:security-reviewer', texts: ['Audit des failles XSS'] })).domain).toBe('security');
  });

  it('stays on the default room without real evidence, and explains its choice', () => {
    expect(detectDomain(sig({ texts: ['Corrige le bug dans le parser'], files: ['/x/src/parser.ts'] })).domain).toBe('code');
    const g = detectDomain(sig({ tools: ['mcp__blender__execute_blender_code'], files: ['/x/scene.blend'] }));
    expect(g.domain).toBe('design');
    expect(g.reasons[0]).toMatchObject({ kind: 'mcp', value: 'blender' });
  });

  it('does not flicker: a lone clue does not move a room away from its domain', () => {
    const game = sig({ tools: ['mcp__Roblox_Studio__execute_luau'], files: ['/x/a.luau'] });
    expect(detectDomain({ ...game, texts: ['ajoute un son quand le joueur gagne', 'musique'] }, 'game').domain).toBe('game');
    // …but a clear switch does.
    expect(detectDomain(sig({ skills: ['marketing:copywriting', 'marketing:social'], texts: ['campagne instagram et tiktok'] }), 'game').domain).toBe('marketing');
  });

  it('sub-agents follow their session unless they clearly do something else', () => {
    expect(detectDomain(sig({ texts: ['Lis les fichiers et résume'], prior: 'game' })).domain).toBe('game');
    expect(detectDomain(sig({ skills: ['marketing:copywriting'], texts: ['Écris la newsletter de la campagne'], prior: 'game' })).domain).toBe('marketing');
    expect(detectDomain(sig({ texts: ['Explore le gameplay du joueur'], prior: 'game' })).domain).toBe('game');
    expect(detectDomain(sig({ agentType: 'ecc:security-reviewer', texts: ['Audit sécurité'], prior: 'game' })).domain).toBe('security');
  });
});
