/**
 * Bichos de estimação existem no mundo, mas não usam o Agent.
 * E a dívida/pressão imediata é do jogador — não do laço (o gato não deve dinheiro à Maelstrom).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { FAMILY_ID, RAFA_ID } from '../shared/engine/initialState';
import { deliverMessage } from '../shared/engine/world';
import { applyContactExchange, looksLikeAnimal, repairNpcs } from '../shared/engine/npcs';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';

const PET = { familyTie: 'Mingau, meu gato laranja que dorme no rack', debtReason: 'A Maelstrom quer o vídeo do ritual que eu filmei' };

describe('Pets e laços não humanos', () => {
  it('reconhece animal x pessoa', () => {
    expect(looksLikeAnimal(PET.familyTie)).toBe(true);
    expect(looksLikeAnimal('Rex, meu cachorro')).toBe(true);
    expect(looksLikeAnimal('Minha mãe, exausta de turnos dobrados')).toBe(false);
    expect(looksLikeAnimal('Minha irmã, Lu')).toBe(false);
    // Pessoa que tem um bicho continua sendo pessoa.
    expect(looksLikeAnimal('Minha avó e o gato dela')).toBe(false);
  });

  it('o gato do laço inicial não vira contato do Agent', () => {
    const sc = scenario(PET);
    const cat = sc.npc(FAMILY_ID)!;
    expect(cat.kind).toBe('animal');
    expect(cat.isContact).toBe(false);
    expect(cat.role).toBe('Bicho de estimação');
  });

  it('a dívida é do jogador: nem o gato nem a mãe ficam com ela como "pendente"', () => {
    expect(scenario(PET).npc(FAMILY_ID)!.pendingMatters).toBeUndefined();
    expect(scenario().npc(FAMILY_ID)!.pendingMatters).toBeUndefined();
    const mission = scenario(PET).state.missions.find(m => m.id === 'm_rent')!;
    expect(mission.title).toBe('Pressão imediata');
    expect(mission.objective).toBe(PET.debtReason);
  });

  it('o narrador não consegue mandar SMS do gato nem salvá-lo como contato', () => {
    const sc = scenario(PET).tool('narrator', 'send_message', { npcId: FAMILY_ID, text: 'miau, cadê a grana?' });
    expect(sc.last().ok).toBe(false);
    expect(sc.state.phone.some(t => t.npcId === FAMILY_ID)).toBe(false);

    sc.tool('narrator', 'upsert_npc', { id: FAMILY_ID, name: 'Mingau', isContact: true });
    expect(sc.npc(FAMILY_ID)!.isContact).toBe(false);

    const res = applyContactExchange(sc.state, 'Salvei o contato do Mingau no Agent');
    expect(res.saved).toEqual([]);
  });

  it('evento agendado também não entrega mensagem de animal', () => {
    const sc = scenario(PET);
    expect(deliverMessage(sc.state, FAMILY_ID, 'miau')).toBe(sc.state);
  });

  it('mensagem automática descarta as respostas rápidas antigas da conversa', () => {
    const sc = scenario();
    expect(sc.state.phone.find(t => t.npcId === RAFA_ID)!.suggestedReplies.length).toBeGreaterThan(0);
    sc.tool('narrator', 'send_message', { npcId: RAFA_ID, text: 'Esquece, passei a fita pra outro.' });
    const thread = sc.state.phone.find(t => t.npcId === RAFA_ID)!;
    expect(thread.messages.at(-1)!.text).toMatch(/passei a fita/);
    expect(thread.suggestedReplies).toEqual([]);
  });

  it('bicho novo apresentado em cena (kind: animal) nunca é contato', () => {
    const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Byte', role: 'Gato de rua', kind: 'animal', isContact: true, present: true });
    expect(sc.npc('Byte')?.kind).toBe('animal');
    expect(sc.npc('Byte')?.isContact).toBe(false);
  });

  it('o prompt deixa claro que a pressão é do jogador e que o gato é animal', () => {
    const sc = scenario(PET);
    const prompt = buildNarratePrompt(buildGameContext(sc.state, 'faço carinho no Mingau'), { kind: 'action', playerInput: 'faço carinho no Mingau', engineResult: null });
    expect(prompt).toMatch(/Pressão imediata \(é do PRÓPRIO jogador/);
    expect(prompt).toMatch(/Mingau.*ANIMAL/);
  });

  it('conserta saves antigos: gato sai do Agent e perde a dívida; missão ganha o título certo', () => {
    const fresh = scenario(PET).state;
    const old = {
      ...fresh,
      npcs: fresh.npcs.map(n => (n.id === FAMILY_ID ? { ...n, kind: undefined, isContact: true, role: 'Família', pendingMatters: PET.debtReason } : n)),
      missions: fresh.missions.map(m => (m.id === 'm_rent' ? { ...m, title: 'Sobreviver ao Aluguel' } : m)),
    };
    const fixed = repairNpcs(old);
    const cat = fixed.npcs.find(n => n.id === FAMILY_ID)!;
    expect(cat).toMatchObject({ kind: 'animal', isContact: false });
    expect(cat.pendingMatters).toBeUndefined();
    expect(fixed.missions.find(m => m.id === 'm_rent')!.title).toBe('Pressão imediata');
    expect(repairNpcs(fixed)).toBe(fixed); // idempotente
  });
});
