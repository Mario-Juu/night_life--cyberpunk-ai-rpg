import { describe, expect, it } from 'vitest';
import { parseNarration } from './narration';

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
