/**
 * Equipe (C2/C3): aliados controlados pelo motor na ordem de iniciativa; o jogador PEDE e o aliado decide;
 * PV persistem entre lutas; cada membro leva sua parte do pagamento.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { runEnemyPhase } from '../shared/engine/initiative';
import { askAlly, members, withPartyInCombat } from '../shared/engine/party';
import { resolveCombatantAttack } from '../shared/engine/combat';
import { sequenceRng } from '../shared/engine/dice';
import type { GameState } from '../shared/types/game';

/** Jax confia no jogador e está na cena. */
const withJax = (trust = 40) =>
  scenario()
    .tool('narrator', 'upsert_npc', { name: 'Jax', role: 'Solo de aluguel', present: true })
    .tool('narrator', 'modify_relationship', { npcId: 'Jax', trust: Math.min(25, trust) })
    .tool('narrator', 'modify_relationship', { npcId: 'Jax', trust: Math.max(0, trust - 25) });
const jaxId = (s: GameState) => s.npcs.find(n => n.name === 'Jax')!.id;
const inParty = () => withJax().tool('narrator', 'recruit_npc', { npcId: 'Jax', template: 'bodyguard' });
const fight = () => inParty().tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
const ally = (s: GameState) => s.combat.combatants.find(t => t.side === 'ally');

describe('Recrutar', () => {
  it('amigo precisa confiar; mercenário entra pela parte; animal nunca', () => {
    const cold = withJax(0).tool('narrator', 'recruit_npc', { npcId: 'Jax' });
    expect(cold.last().ok).toBe(false);
    expect(cold.last().summary).toMatch(/não confia o bastante/);
    const merc = withJax(0).tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 20 });
    expect(merc.last().ok).toBe(true);
    expect(members(merc.state)[0]).toMatchObject({ share: 20, stance: 'aggressive' });
    const pet = scenario().tool('narrator', 'upsert_npc', { name: 'Mingau', kind: 'animal' }).tool('narrator', 'recruit_npc', { npcId: 'Mingau', share: 30 });
    expect(pet.last().ok).toBe(false);
  });

  it('ganha ficha de combate, vira NPC central e fica na cena', () => {
    const sc = inParty();
    const jax = sc.npc('Jax')!;
    expect(jax.combat?.template).toBe('bodyguard');
    expect(jax.importance).toBe('core');
    expect(sc.state.scene.presentNpcIds).toContain(jax.id);
  });

  it('a equipe segue o jogador e se cura no descanso; dispensar tira da equipe', () => {
    const sc = inParty();
    sc.edit(s => ({ ...s, npcs: s.npcs.map(n => (n.id === jaxId(s) ? { ...n, combat: { ...n.combat!, hp: { ...n.combat!.hp, current: 5 } } } : n)) }));
    sc.tool('interpreter', 'move_location', { spot: 'Bar do Afterlife' });
    expect(sc.state.scene.presentNpcIds).toEqual([jaxId(sc.state)]);
    sc.tool('interpreter', 'rest', { hours: 8 });
    expect(sc.npc('Jax')!.combat!.hp.current).toBeGreaterThan(5);
    sc.tool('narrator', 'dismiss_npc', { npcId: 'Jax', reason: 'brigaram' });
    expect(members(sc.state)).toEqual([]);
  });
});

describe('Na luta', () => {
  it('membro presente entra como aliado (com iniciativa); ausente fica de fora', () => {
    const sc = fight();
    const s = runEnemyPhase(sc.state, sequenceRng([5])).state;
    expect(ally(s)).toMatchObject({ npcId: jaxId(s), side: 'ally' });
    expect(ally(s)!.initiative).not.toBeNull();
    // Fora da cena quando a luta começa: não entra.
    const away = inParty().edit(st => ({ ...st, scene: { ...st.scene, presentNpcIds: [] } })).tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
    expect(ally(withPartyInCombat(away.state))).toBeUndefined();
  });

  it('o aliado ataca o inimigo mais ferido; o jogador não mira nele; Ping não marca aliado', () => {
    const sc = fight();
    sc.edit(s => withPartyInCombat(s));
    sc.edit(s => ({ ...s, combat: { ...s.combat, combatants: s.combat.combatants.map((t, i) => (i === 1 ? { ...t, hp: { ...t.hp, current: 3 } } : t)) } }));
    const weak = sc.state.combat.combatants[1];
    const res = resolveCombatantAttack(sc.state, ally(sc.state)!.id, weak.id, sequenceRng([10, 6, 6, 6]))!;
    expect(res.result.hit).toBe(true);
    sc.tool('interpreter', 'attack', { targetId: ally(sc.state)!.id });
    expect(sc.last().ok).toBe(false);
    expect(sc.last().summary).toMatch(/é seu aliado/);
    sc.tool('interpreter', 'quickhack', { hack: 'ping' });
    expect(ally(sc.state)!.hacks ?? []).toEqual([]);
  });

  it('inimigos também miram nos aliados; o PV do aliado volta para a ficha', () => {
    const sc = fight();
    let hitAlly = false;
    for (let i = 1; i <= 8 && !hitAlly; i++) {
      const s = runEnemyPhase(sc.state, sequenceRng([i, 9, 6, 6, 6])).state;
      const a = ally(s)!;
      if (a.hp.current < a.hp.max) {
        hitAlly = true;
        expect(s.npcs.find(n => n.id === jaxId(s))!.combat!.hp.current).toBe(a.hp.current);
      }
    }
    expect(hitAlly).toBe(true);
  });

  it('segurar posição: não ataca e vai para a cobertura', () => {
    const sc = inParty()
      .edit(s => ({ ...s, party: { members: members(s).map(m => ({ ...m, stance: 'hold' as const })) } }))
      .tool('narrator', 'start_combat', { combatants: [{ template: 'maelstrom_ganger', count: 2 }] });
    const phase = runEnemyPhase(sc.state, sequenceRng([5]));
    expect(ally(phase.state)!.cover).toBe('partial');
    expect(phase.lines.some(l => /segura posição/.test(l))).toBe(true);
  });
});

describe('Pedir (o aliado decide)', () => {
  it('aceita, faz do jeito dele ou recusa, pela rolagem contra a chance', () => {
    const s = withPartyInCombat(fight().state);
    const id = jaxId(s);
    expect(askAlly(s, id, { stance: 'hold' }, sequenceRng([1]))).toMatchObject({ outcome: 'accept' });
    const adapt = askAlly(s, id, { stance: 'retreat' }, sequenceRng([95]));
    expect('outcome' in adapt && adapt.outcome).toMatch(/adapt|refuse/);
    const foe = s.combat.combatants.find(t => t.side !== 'ally')!.id;
    const refuse = askAlly(s, id, { stance: 'focus', targetId: foe, againstPrinciples: true }, sequenceRng([100]));
    expect(refuse).toMatchObject({ outcome: 'refuse' });
    if ('state' in refuse) expect(members(refuse.state)[0].loyalty).toBeLessThan(members(s)[0].loyalty);
  });

  it('pelo intérprete: focar um alvo muda a postura do aliado na luta', () => {
    const sc = fight();
    sc.edit(s => withPartyInCombat(s));
    const foe = sc.state.combat.combatants.find(t => t.side !== 'ally')!;
    sc.tool('interpreter', 'ask_ally', { npcId: 'Jax', request: 'focus', targetId: foe.id }, [1]);
    expect(sc.last().ok).toBe(true);
    expect(ally(sc.state)).toMatchObject({ stance: 'focus', focusId: foe.id });
  });
});

describe('Depois da luta e no pagamento', () => {
  it('aliado caído: Teste de Morte no fim da luta (passa = 1 PV; falha = morre e sai da equipe)', () => {
    const down = (sc: ReturnType<typeof fight>) => sc.edit(s => ({ ...withPartyInCombat(s), combat: { ...withPartyInCombat(s).combat, combatants: withPartyInCombat(s).combat.combatants.map(t => (t.side === 'ally' ? { ...t, hp: { ...t.hp, current: 0 }, status: 'down' as const } : t)) } }));
    const lucky = fight();
    down(lucky);
    lucky.tool('narrator', 'end_combat', {}, [1]);
    expect(lucky.npc('Jax')!.combat!.hp.current).toBe(1);
    expect(members(lucky.state)).toHaveLength(1);
    const unlucky = fight();
    down(unlucky);
    unlucky.tool('narrator', 'end_combat', {}, [10]);
    expect(unlucky.npc('Jax')!.status).toBe('dead');
    expect(members(unlucky.state)).toEqual([]);
  });

  it('missão concluída: o motor repassa a parte do membro e ele fica mais leal', () => {
    const sc = withJax(0).tool('narrator', 'recruit_npc', { npcId: 'Jax', share: 25 });
    sc.tool('narrator', 'start_quest', { id: 'm_job', title: 'Serviço no porto', objective: 'Pegar a carga', rewardEddies: 800 });
    const money = sc.state.character.money;
    const loyalty = members(sc.state)[0].loyalty;
    sc.tool('narrator', 'complete_quest', { questId: 'm_job' });
    expect(sc.state.character.money).toBe(money + 800 - 200);
    expect(members(sc.state)[0].loyalty).toBe(loyalty + 5);
    expect(sc.state.events.some(e => /parte dele: 25%/.test(e.summary))).toBe(true);
  });
});
