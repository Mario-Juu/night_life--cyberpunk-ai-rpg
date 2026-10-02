/**
 * Gestão de informação: o que entra no contexto do Mestre, rotulado de onde veio.
 * Queixa de origem: jack in no servidor de UM hotel trouxe "dados" de uma gravadora de OUTRA trama
 * (uma trama tinha lugar num hotel-cápsula; memória e trama de outro lugar pareciam ser daqui).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { buildNarratePrompt, buildPhonePrompt, describeMemories } from '../server/gamemaster/promptBuilder';
import { generateFronts } from '../shared/engine/fronts';
import { frontSceneLink, relevantNpcs } from '../shared/engine/context';
import { findNpcLoose } from '../shared/engine/npcs';
import { mentionsName } from '../shared/engine/memory';
import { buildProfileRequest } from '../shared/engine/npcProfile';
import { appendChat } from '../shared/engine/reducer';
import { applyNarration, beginTurn } from '../shared/engine/turn';
import type { GameState, Npc } from '../shared/types/game';
import type { NarrateResponse } from '../shared/types/gm';

const npc = (id: string, name: string, extra: Partial<Npc> = {}): Npc => ({ id, name, role: 'Morador', description: '', trust: 0, respect: 30, fear: 0, anger: 0, knowledge: [], status: 'alive', isContact: false, ...extra });
const addNpc = (n: Npc) => (s: GameState): GameState => ({ ...s, npcs: [...s.npcs, n] });
const section = (prompt: string, name: string) => prompt.split(`# ${name}`)[1]?.split('\n# ')[0] ?? '';

/** Netrunner num hotel-cápsula, com memória de OUTRO hotel e de uma gravadora. */
function hotelScenario() {
  const sc = scenario({ role: 'netrunner' });
  sc.tool('narrator', 'move_location', { district: 'WATSON', subDistrict: 'Kabuki', spot: 'Hotel Cápsula Sakura' });
  sc.tool('narrator', 'create_memory', { type: 'WORLD_MEMORY', subject: 'Hotel Neon Lux', content: 'O hotel Neon Lux em Heywood esconde um estúdio de braindance no 9º andar.', importance: 7 });
  sc.tool('narrator', 'create_memory', { type: 'WORLD_MEMORY', subject: 'US Cracks', content: 'A gravadora das US Cracks está brigando com a Arasaka.', importance: 6 });
  sc.tool('narrator', 'net_architecture', { name: 'Servidor do Hotel Cápsula Sakura', difficulty: 'basic' });
  return sc;
}

describe('Nomes casam por palavra inteira', () => {
  it('"Rafael" não é a Rafa, "banana" não é a Ana', () => {
    expect(mentionsName('falo com o Rafael', 'Rafa')).toBe(false);
    expect(mentionsName('falo com a Rafa', 'Rafa')).toBe(true);
    expect(mentionsName('compro uma banana', 'Ana')).toBe(false);
    expect(mentionsName('Chamo a Ána.', 'Ana')).toBe(true);
  });

  it('NPC fora da cena só entra no contexto quando é citado de verdade', () => {
    const sc = scenario().edit(addNpc(npc('npc_ana', 'Ana Souza')));
    expect(relevantNpcs(sc.state, 'compro uma banana na banca').map(n => n.id)).not.toContain('npc_ana');
    expect(relevantNpcs(sc.state, 'pergunto da Ana para o dono da banca').map(n => n.id)).toContain('npc_ana');
  });
});

describe('Homônimos não são fundidos', () => {
  it('"Rafa Lima" é outra pessoa; "Rafa (holo)" e "Rafa, o canal" continuam sendo a Rafa', () => {
    const sc = scenario();
    expect(sc.npc('npc_rafa')).toBeDefined();
    expect(findNpcLoose(sc.state, 'Rafa Lima')).toBeUndefined();
    expect(findNpcLoose(sc.state, 'Rafa (holo)')?.id).toBe('npc_rafa');
    expect(findNpcLoose(sc.state, 'Rafa, o canal')?.id).toBe('npc_rafa');
    expect(findNpcLoose(sc.state, 'Rafa')?.id).toBe('npc_rafa');
  });

  it('upsert_npc de "Rafa Lima" cria um NPC novo em vez de reescrever a Rafa do Agent', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Rafa Lima', role: 'Policial da NCPD' });
    expect(sc.npc('npc_rafa')?.role).not.toBe('Policial da NCPD');
    expect(sc.state.npcs.find(n => n.name === 'Rafa Lima')?.role).toBe('Policial da NCPD');
  });

  it('o perfil da Rafa não usa como evidência as cenas do Rafael', () => {
    const sc = scenario().edit(s => appendChat(s, { kind: 'narration', text: 'Rafael, o recepcionista, esconde um shard da Arasaka no balcão.' }));
    const req = buildProfileRequest(sc.state, 'npc_rafa')!;
    expect(req.evidence).not.toContain('Rafael');
  });
});

describe('Memórias: desta cena x pano de fundo', () => {
  it('memória de OUTRO hotel não aparece como se fosse do hotel atual', () => {
    const sc = hotelScenario();
    const q = 'faço jack in no port do hotel e baixo os arquivos';
    const ctx = sc.context(q);
    const other = ctx.memories.find(m => m.subject === 'Hotel Neon Lux');
    expect(other?.linked).toBe(false);
    const mem = section(buildNarratePrompt(ctx, { kind: 'action', playerInput: q, engineResult: null }), 'MEMÓRIAS RELEVANTES');
    const [, background] = mem.split('Pano de fundo');
    expect(background).toContain('Hotel Neon Lux');
    expect(background).toContain('US Cracks');
  });

  it('memória do NPC presente ou do lugar atual fica ligada à cena, com o nome e o turno de origem', () => {
    const sc = hotelScenario()
      .edit(addNpc(npc('npc_mei', 'Mei', { role: 'Recepcionista' })))
      .edit(s => ({ ...s, scene: { ...s.scene, presentNpcIds: ['npc_mei'] } }))
      .tool('narrator', 'create_memory', { type: 'NPC_MEMORY', subject: 'npc_mei', content: 'Mei deixa o jogador usar o terminal da recepção.', importance: 6 })
      .tool('narrator', 'create_memory', { type: 'WORLD_MEMORY', subject: 'Sakura', content: 'O Hotel Cápsula Sakura troca as senhas toda segunda.', importance: 5 });
    const ctx = sc.context('olho o terminal');
    expect(ctx.memories.find(m => m.subject === 'npc_mei')?.linked).toBe(true);
    expect(ctx.memories.find(m => m.subject === 'Sakura')?.linked).toBe(true);
    const text = describeMemories(ctx);
    expect(text.split('Pano de fundo')[0]).toContain(`t${sc.state.turn}) Mei: Mei deixa`);
  });

  it('a palavra "hotel" na ação não liga a memória do outro hotel; citar o nome dele liga', () => {
    const sc = hotelScenario();
    expect(sc.context('invado o servidor do hotel').memories.find(m => m.subject === 'Hotel Neon Lux')?.linked).toBe(false);
    expect(sc.context('vou até o Hotel Neon Lux').memories.find(m => m.subject === 'Hotel Neon Lux')?.linked).toBe(true);
  });
});

describe('Tramas: ligadas à cena só com motivo concreto', () => {
  it('no hotel qualquer, toda trama vem marcada "fora desta cena" com o aviso de lugar parecido', () => {
    const sc = hotelScenario();
    sc.state = generateFronts(sc.state, { seed: 'teste' });
    const ctx = sc.context('faço jack in no port do hotel');
    expect(ctx.fronts!.every(f => !f.sceneLink)).toBe(true);
    const city = section(buildNarratePrompt(ctx, { kind: 'action', playerInput: 'x', engineResult: null }), 'NA CIDADE');
    expect(city).toContain('Lugar parecido com o de agora não é o dela');
    expect(city.match(/fora desta cena/g)?.length).toBeGreaterThanOrEqual(ctx.fronts!.length);
  });

  it('rosto da trama presente, grupo dela no servidor ou citado pelo jogador → LIGADA À CENA', () => {
    const sc = scenario();
    sc.state = generateFronts(sc.state, { seed: 'teste' });
    const f = sc.state.fronts![0];
    const face = sc.state.npcs.find(n => n.id === f.seedNpcId)!;
    expect(frontSceneLink(sc.state, f)).toBeUndefined();
    const withFace = { ...sc.state, scene: { ...sc.state.scene, presentNpcIds: [face.id] } };
    expect(frontSceneLink(withFace, f)).toContain(face.name);
    sc.tool('narrator', 'net_architecture', { name: `Servidor da ${f.who}`, difficulty: 'basic' });
    expect(frontSceneLink(sc.state, f)).toContain(f.who);
    expect(frontSceneLink(scenario().edit(() => sc.state).state, f, `pergunto sobre ${face.name}`)).toBeDefined();
  });
});

describe('Segredos não vazam para o contato', () => {
  it('no Agent, flag oculta vem separada e rotulada, não junto das conhecidas', () => {
    const sc = scenario()
      .tool('narrator', 'set_flag', { key: 'rafa_trai_o_jogador', visibility: 'hidden' })
      .tool('narrator', 'set_flag', { key: 'porta_arrombada', visibility: 'public' });
    const lines = buildPhonePrompt(sc.context('oi'), 'npc_rafa', 'oi').split('\n');
    const known = lines.find(l => l.startsWith('Flags conhecidas'))!;
    const hidden = lines.find(l => l.startsWith('Flags ocultas'))!;
    expect(known).toContain('porta_arrombada');
    expect(known).not.toContain('rafa_trai');
    expect(hidden).toContain('rafa_trai_o_jogador');
  });
});

describe('Shards guardam conteúdo e origem', () => {
  it('shard entregue por NPC registra a origem; ler devolve o conteúdo; o Mestre vê no inventário', () => {
    const sc = scenario()
      .tool('narrator', 'give_item', { name: 'Shard da recepcionista', category: 'datashard', source: 'Mei, recepcionista do Sakura', description: 'Lista de hóspedes do 3º andar' })
      .tool('player', 'use_item', { itemId: 'Shard da recepcionista' });
    expect(sc.last().ok).toBe(true);
    expect(sc.last().summary).toContain('Lista de hóspedes do 3º andar');
    expect(sc.last().summary).toContain('Origem: Mei, recepcionista do Sakura');
    const who = section(buildNarratePrompt(sc.context(''), { kind: 'action', playerInput: 'x', engineResult: null }), 'PERSONAGEM');
    expect(who).toMatch(/Shard da recepcionista ×1 — Lista de hóspedes do 3º andar\. Origem: Mei/);
  });

  it('usar algo que não é shard nem consumível continua recusado', () => {
    const sc = scenario().tool('player', 'use_item', { itemId: 'Agent de Bolso' });
    expect(sc.last().ok).toBe(false);
  });
});

describe('Descobertas', () => {
  const narr = (discoveries: NarrateResponse['discoveries']): NarrateResponse => ({ narration: 'Ok.', dialogues: [], toolCalls: [], discoveries, suggestedActions: [], enemyActions: [] });

  it('a mesma descoberta com caixa/acento diferente não se repete em "O jogador sabe"', () => {
    const sc = scenario();
    let step = applyNarration(beginTurn(sc.state, 'a'), narr([{ title: 'Senha do Sakura', description: 'A senha é 0451.' }]));
    step = applyNarration(beginTurn(step.state, 'b'), narr([{ title: 'senha do sakura', description: 'A senha é 0451' }]));
    expect(step.state.discoveries).toHaveLength(1);
  });
});
