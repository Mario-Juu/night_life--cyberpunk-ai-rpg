/**
 * Personagens apresentados em cena passam a existir no mundo (diário/contatos),
 * mesmo que o narrador esqueça de registrá-los.
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { applyNarration, beginTurn } from '../shared/engine/turn';
import { backfillNpcsFromChat, findNpcLoose, isGenericSpeaker } from '../shared/engine/npcs';
import { appendChat } from '../shared/engine/reducer';
import type { NarrateResponse } from '../shared/types/gm';

const narr = (narration: string, over: Partial<NarrateResponse> = {}): NarrateResponse => ({
  narration,
  dialogues: [],
  toolCalls: [],
  discoveries: [],
  suggestedActions: [],
  enemyActions: [],
  ...over,
});

const SUB_LEVEL = `O ar lá dentro bate como um soco no peito.

[DIALOGUE: Jax 'Kettle']
Chegamos inteiros e com os pedais intactos.
[/DIALOGUE]

[DIALOGUE: Lina]
Vou direto na mesa de som ver quem é o carniceiro pilotando os canais hoje.
[/DIALOGUE]`;

describe('Registro automático de personagens', () => {
  it('quem fala na cena entra no diário e fica presente, sem o narrador chamar upsert_npc', () => {
    const sc = scenario();
    const step = applyNarration(beginTurn(sc.state, 'Entro no Sub-Level 03'), narr(SUB_LEVEL));
    const jax = findNpcLoose(step.state, "Jax 'Kettle'");
    const lina = findNpcLoose(step.state, 'Lina');
    expect(jax).toBeDefined();
    expect(lina).toBeDefined();
    expect(step.state.scene.presentNpcIds).toEqual(expect.arrayContaining([jax!.id, lina!.id]));
    expect(step.state.events.filter(e => e.type === 'NPC_MET').map(e => e.target)).toEqual(expect.arrayContaining([jax!.id, lina!.id]));
  });

  it('não duplica: "Jax" e "Jax \'Kettle\'" são a mesma pessoa; upsert_npc enriquece o registro', () => {
    const sc = scenario();
    let step = applyNarration(beginTurn(sc.state, 'a'), narr(SUB_LEVEL));
    step = applyNarration(
      beginTurn(step.state, 'b'),
      narr('[DIALOGUE: Jax]\nBora, Matt.\n[/DIALOGUE]', { toolCalls: [{ tool: 'upsert_npc', args: { name: 'Jax', role: 'Baterista da banda', isContact: true } }] }),
    );
    const jaxes = step.state.npcs.filter(n => n.name.toLowerCase().startsWith('jax'));
    expect(jaxes).toHaveLength(1);
    expect(jaxes[0]).toMatchObject({ role: 'Baterista da banda', isContact: true });
  });

  it('vozes genéricas e o próprio jogador não viram NPC', () => {
    const sc = scenario();
    expect(isGenericSpeaker('Voz Rouca no Corredor', sc.state)).toBe(true);
    expect(isGenericSpeaker('Anúncio holográfico', sc.state)).toBe(true);
    expect(isGenericSpeaker('Você', sc.state)).toBe(true);
    expect(isGenericSpeaker('Matt', sc.state)).toBe(true);
    expect(isGenericSpeaker('Lina', sc.state)).toBe(false);
  });

  it('SMS de alguém novo cria o contato (a mensagem não se perde)', () => {
    const sc = scenario().tool('narrator', 'send_message', { npcId: 'Seu Chen', text: 'A garagem fecha às 3, garoto.' });
    expect(sc.last().ok).toBe(true);
    const chen = sc.npc('Seu Chen')!;
    expect(chen.isContact).toBe(true);
    expect(sc.state.phone.find(t => t.npcId === chen.id)?.messages.at(-1)?.text).toMatch(/garagem/);
  });

  it('saves antigos: quem já falou no histórico é cadastrado ao carregar', () => {
    const sc = scenario();
    const old = appendChat(sc.state, { kind: 'narration', text: SUB_LEVEL });
    const fixed = backfillNpcsFromChat(old);
    expect(findNpcLoose(fixed, 'Lina')).toBeDefined();
    expect(findNpcLoose(fixed, 'Jax')).toBeDefined();
    expect(backfillNpcsFromChat(fixed).npcs).toHaveLength(fixed.npcs.length); // idempotente
  });
});
