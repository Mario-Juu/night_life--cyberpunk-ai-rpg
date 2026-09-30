/**
 * Netrunning (Cyberpunk RED): arquitetura, Ações de Rede, ICE Negro, programas e desconexão.
 * Arquiteturas montadas à mão + dados em sequência = resultados exatos.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { endNetTurn, generateArchitecture } from '../shared/engine/net';
import { seededRng, sequenceRng } from '../shared/engine/dice';
import { applyInterpretation, beginTurn, buildEngineResult } from '../shared/engine/turn';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import type { GameState, IceInstance, NetArchitecture, NetFloor, NetRun } from '../shared/types/game';

const floor = (index: number, kind: NetFloor['kind'], extra: Partial<NetFloor> = {}): NetFloor => ({ index, kind, cleared: false, revealed: false, ...extra });
const arch = (floors: NetFloor[]): NetArchitecture => ({ id: 'arch_t', name: 'Servidor da Maelstrom', accessPoint: 'terminal do porão', difficulty: 'standard', dv: 8, floors, createdTurn: 0 });
const ice = (key: IceInstance['key'], rez: number, floorIndex = 0): IceInstance => ({ id: `ice_${floorIndex}_${key}`, key, floor: floorIndex, rez, maxRez: rez, following: true });

function runner(floors: NetFloor[]) {
  return scenario({ role: 'netrunner' }).edit(s => ({ ...s, net: { architecture: arch(floors), run: null } }));
}
const patchRun = (patch: Partial<NetRun>) => (s: GameState): GameState => ({ ...s, net: { ...s.net, run: { ...s.net.run!, ...patch } } });

describe('Arquitetura', () => {
  it('gerada pelas tabelas do RED: 3–18 andares, determinística pela seed, alvos do narrador no fundo', () => {
    const a = generateArchitecture({ name: 'Arasaka', accessPoint: 'lobby', difficulty: 'advanced', files: ['Contratos da Arasaka'], controls: ['Torretas'] }, 1, seededRng('x'));
    const b = generateArchitecture({ name: 'Arasaka', accessPoint: 'lobby', difficulty: 'advanced', files: ['Contratos da Arasaka'], controls: ['Torretas'] }, 1, seededRng('x'));
    expect(a.floors.map(f => f.kind)).toEqual(b.floors.map(f => f.kind));
    expect(a.floors.length).toBeGreaterThanOrEqual(3);
    expect(a.floors.length).toBeLessThanOrEqual(18);
    expect(a.dv).toBe(12);
    expect(a.floors.find(f => f.label === 'Contratos da Arasaka')?.kind).toBe('file');
    expect(a.floors.find(f => f.label === 'Torretas')?.kind).toBe('control');
  });

  it('o narrador revela a arquitetura com net_architecture', () => {
    const sc = scenario({ role: 'netrunner' }).tool('narrator', 'net_architecture', { name: 'Rede do galpão', difficulty: 'basic', floors: 4, files: 'Lista de compradores' });
    expect(sc.last().ok).toBe(true);
    expect(sc.state.net.architecture?.floors).toHaveLength(4);
  });
});

describe('Conexão e ações', () => {
  it('só Trilheiro entra; sem arquitetura, nada feito', () => {
    expect(scenario({ role: 'solo' }).edit(s => ({ ...s, net: { architecture: arch([floor(0, 'empty')]), run: null } })).tool('interpreter', 'jack_in').last().ok).toBe(false);
    expect(scenario({ role: 'netrunner' }).tool('interpreter', 'jack_in').last().ok).toBe(false);
  });

  it('jack_in custa 1 Ação de Rede (rank 4 = 3 ações); senha bloqueia a descida até o Backdoor', () => {
    const sc = runner([floor(0, 'password', { dv: 6 }), floor(1, 'file', { dv: 6, label: 'Lista de compradores' })]).tool('interpreter', 'jack_in');
    expect(sc.state.net.run?.actionsLeft).toBe(2);
    expect(sc.tool('interpreter', 'net_action', { action: 'down' }).last().ok).toBe(false);
    sc.tool('interpreter', 'net_action', { action: 'backdoor' }, [5]); // 4 + 5 = 9 > 6
    expect(sc.state.net.architecture?.floors[0].cleared).toBe(true);
    sc.tool('interpreter', 'net_action', { action: 'down' });
    expect(sc.state.net.run?.position).toBe(1);
    expect(sc.state.net.run?.actionsLeft).toBe(0);
    expect(sc.tool('interpreter', 'net_action', { action: 'eye_dee' }).last().ok).toBe(false); // sem ações
  });

  it('Eye-Dee identifica e baixa o arquivo para o inventário', () => {
    const sc = runner([floor(0, 'file', { dv: 6, label: 'Lista de compradores' })]).tool('interpreter', 'jack_in');
    sc.tool('interpreter', 'net_action', { action: 'eye_dee' }, [7]);
    expect(sc.item('Arquivo: Lista de compradores')?.category).toBe('datashard');
  });

  it('desconexão segura reseta a arquitetura (senhas voltam), mas o que foi baixado fica', () => {
    const sc = runner([floor(0, 'password', { dv: 6 }), floor(1, 'empty')]).tool('interpreter', 'jack_in');
    sc.tool('interpreter', 'net_action', { action: 'backdoor' }, [5]).tool('interpreter', 'net_action', { action: 'jack_out' });
    expect(sc.state.net.run).toBeNull();
    expect(sc.state.net.architecture?.floors[0].cleared).toBe(false);
  });
});

describe('ICE Negro', () => {
  it('Hellhound: teste de velocidade ao entrar; no fim do turno ataca com dano cerebral (ignora armadura) e põe fogo', () => {
    const sc = runner([floor(0, 'empty'), floor(1, 'ice', { ice: ['hellhound'] })]).tool('interpreter', 'jack_in');
    sc.tool('interpreter', 'net_action', { action: 'down' }, [9, 1]); // você 13 × ICE 7: reage primeiro
    expect(sc.state.net.run?.ice).toHaveLength(1);
    const hp = sc.state.character.hp.current;
    sc.edit(s => endNetTurn(s, sequenceRng([9, 2, 3, 3])).state); // ATK 15 × defesa 6 → 2d6 = 6
    expect(sc.state.character.hp.current).toBe(hp - 6);
    expect(sc.state.activeEffects.some(e => e.name === 'Deck em chamas')).toBe(true);
    expect(sc.state.net.run?.actionsLeft).toBe(3); // turno novo
  });

  it('Armor (defensor) absorve 4 do dano cerebral', () => {
    const sc = runner([floor(0, 'empty')]).tool('interpreter', 'jack_in');
    const armor = sc.state.character.deck!.programs.find(p => p.key === 'armor')!;
    sc.tool('interpreter', 'net_action', { action: 'activate', programId: armor.id });
    sc.edit(patchRun({ ice: [ice('hellhound', 20)] }));
    const hp = sc.state.character.hp.current;
    sc.edit(s => endNetTurn(s, sequenceRng([9, 2, 3, 3])).state);
    expect(sc.state.character.hp.current).toBe(hp - 2);
  });

  it('Sword derreza o ICE; o andar fica limpo', () => {
    const sc = runner([floor(0, 'ice', { ice: ['hellhound'] })]).tool('interpreter', 'jack_in', {}, [9, 1]).edit(patchRun({ actionsLeft: 5 }));
    const id = sc.state.net.run!.ice[0].id;
    sc.tool('interpreter', 'net_action', { action: 'program', programId: 'sword', iceId: id }, [9, 1, 6, 6, 6]); // 14 × 3 → 18
    expect(sc.state.net.run!.ice[0].rez).toBe(2);
    sc.tool('interpreter', 'net_action', { action: 'program', programId: 'sword', iceId: id }, [9, 1, 6, 6, 6]);
    expect(sc.state.net.run!.ice[0].rez).toBe(0);
    expect(sc.state.net.architecture!.floors[0].cleared).toBe(true);
  });

  it('Slide: escapa para o andar de cima e o ICE perde o rastro', () => {
    const sc = runner([floor(0, 'empty'), floor(1, 'empty')]).tool('interpreter', 'jack_in').edit(patchRun({ position: 1, actionsLeft: 3, ice: [ice('hellhound', 20, 1)] }));
    sc.tool('interpreter', 'net_action', { action: 'slide' }, [9, 1]); // 13 × PER 6 + 1
    expect(sc.state.net.run?.position).toBe(0);
    expect(sc.state.net.run?.ice[0].following).toBe(false);
  });

  it('Giant: dano e desconexão insegura — todo ICE rezzado encontrado te atinge na saída', () => {
    const sc = runner([floor(0, 'empty')]).tool('interpreter', 'jack_in').edit(patchRun({ ice: [ice('giant', 25), ice('hellhound', 20)] }));
    const hp = sc.state.character.hp.current;
    // Giant: ATK 17 × 6 → 3d6 = 3; saída insegura: Hellhound 2d6 = 2 + fogo. O Hellhound não chega a atacar (conexão caiu).
    sc.edit(s => endNetTurn(s, sequenceRng([9, 2, 1, 1, 1, 1, 1])).state);
    expect(sc.state.net.run).toBeNull();
    expect(sc.state.character.hp.current).toBe(hp - 5);
    expect(sc.state.activeEffects.some(e => e.name === 'Deck em chamas')).toBe(true);
  });

  it('Kraken prende: sem desconexão segura até o fim do próximo turno', () => {
    const sc = runner([floor(0, 'empty')]).tool('interpreter', 'jack_in').edit(patchRun({ lockedUntil: 2 }));
    expect(sc.tool('interpreter', 'net_action', { action: 'jack_out' }).last().ok).toBe(false);
  });
});

describe('Pelo texto (intérprete)', () => {
  it('ações de Rede no mesmo turno + o motor fecha o turno (ICE age) antes da narração', () => {
    const sc = runner([floor(0, 'password', { dv: 6 }), floor(1, 'empty')]);
    const step = applyInterpretation(beginTurn(sc.state, 'Me conecto e forço a senha'), {
      intent: { type: 'netrun', summary: 'invadir', confidence: 1 },
      toolCalls: [
        { tool: 'jack_in', args: {} },
        { tool: 'net_action', args: { action: 'backdoor' } },
      ],
    }, sequenceRng([5]));
    const tools = buildEngineResult(step, null).tools.map(t => t.tool);
    expect(tools).toEqual(['jack_in', 'net_action', 'net_end_turn']);
    expect(step.state.net.run?.netTurn).toBe(2);
    expect(step.state.chat.some(e => e.kind === 'net')).toBe(true);
  });

  it('o Mestre recebe o mapa da Rede no contexto', () => {
    const sc = runner([floor(0, 'password', { dv: 6 })]).tool('interpreter', 'jack_in');
    const prompt = buildNarratePrompt(buildGameContext(sc.state, ''), { kind: 'action', playerInput: 'olho', engineResult: null });
    expect(prompt).toMatch(/REDE: Servidor da Maelstrom/);
    expect(prompt).toMatch(/CONECTADO · andar 1\/1/);
  });
});
