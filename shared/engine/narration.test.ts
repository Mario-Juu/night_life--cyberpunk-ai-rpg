import { describe, expect, it } from 'vitest';
import { fixSelfAddressedSpeakers, parseNarration } from './narration';

describe('parseNarration', () => {
  it('blocos bem formados', () => {
    expect(parseNarration('A porta range.\n\n[DIALOGUE: Rafa]\nAbre aí, choom.\n[/DIALOGUE]\n\nSilêncio.')).toEqual([
      { kind: 'text', text: 'A porta range.' },
      { kind: 'dialogue', speaker: 'Rafa', text: 'Abre aí, choom.' },
      { kind: 'text', text: 'Silêncio.' },
    ]);
  });

  it('fala aberta dentro de outra (caso real): nenhuma tag vaza para o texto', () => {
    const n =
      'Ele hesita.\n\n[DIALOGUE: Ganger da Maelstrom]\n“Olha só, mais um pedaço de lixo. O relé fritou o cérebro desse aqui [DIALOGUE: Lincoln Ferguson "Lindt"] (Gemidos ininteligíveis e espasmos)”\n[/DIALOGUE]';
    const segs = parseNarration(n);
    expect(segs.map(s => s.kind)).toEqual(['text', 'dialogue', 'dialogue']);
    expect(segs[1]).toMatchObject({ speaker: 'Ganger da Maelstrom', text: 'Olha só, mais um pedaço de lixo. O relé fritou o cérebro desse aqui' });
    expect(segs[2]).toMatchObject({ speaker: 'Lincoln Ferguson "Lindt"', text: '(Gemidos ininteligíveis e espasmos)' });
    expect(segs.some(s => s.text.includes('[DIALOGUE'))).toBe(false);
  });

  it('fala sem fechamento termina no fim do parágrafo; fechamento solto é ignorado', () => {
    expect(parseNarration('[DIALOGUE: Lina]\nBora.\n\nO carro arranca.')).toEqual([
      { kind: 'dialogue', speaker: 'Lina', text: 'Bora.' },
      { kind: 'text', text: 'O carro arranca.' },
    ]);
    expect(parseNarration('O carro arranca. [/DIALOGUE] A chuva cai.')).toEqual([
      { kind: 'text', text: 'O carro arranca.' },
      { kind: 'text', text: 'A chuva cai.' },
    ]);
  });
});

describe('fixSelfAddressedSpeakers', () => {
  it('fala do jogador rotulada com o nome de quem ouve (relato do T89) vira do jogador', () => {
    const n =
      'Você abre o canal de mensagens para\n\n[DIALOGUE: Rafa "Zero-Um"]\n“E aí, Rafa. Consegui dar uma respirada aqui no conapt. Tem mais algum corre?”\n[/DIALOGUE]\n\nSegundos depois, o comunicador vibra.';
    const res = fixSelfAddressedSpeakers(n, [{ speaker: 'Rafa "Zero-Um"', text: 'E aí, Rafa. Consegui dar uma respirada' }], 'The High');
    expect(res.fixed).toBe(1);
    expect(res.narration).toContain('[DIALOGUE: The High]');
    expect(res.dialogues[0].speaker).toBe('The High');
  });

  it('o NPC falando com o jogador (ou citando outro) fica como está', () => {
    const n = '[DIALOGUE: Rafa]\nE aí, choom. O Kiro, aquele, quer te ver.\n[/DIALOGUE]\n\n[DIALOGUE: Kiro]\nRafa, cala a boca.\n[/DIALOGUE]';
    const res = fixSelfAddressedSpeakers(n, [], 'The High');
    expect(res.fixed).toBe(0);
    expect(res.narration).toBe(n);
  });
});
