/**
 * Humanidade e Ciberpsicose (Cyberpunk RED).
 * Humanidade máx. = EMP × 10; cada 10 pontos perdidos baixam 1 de EMP; em 0 o personagem
 * vira um ciberpsicopata (no livro, o Mestre assume o controle). Aqui: o jogador perde o
 * teclado e só escolhe entre impulsos — o fator narrativo que o usuário pediu.
 */
import type { Character } from '../types/game';

export type HumanityBand = 'stable' | 'detached' | 'fraying' | 'edge' | 'cyberpsycho';

export interface BandInfo {
  band: HumanityBand;
  label: string;
  /** Instrução para o narrador (efeitos narrativos). */
  narrator: string;
}

export const HUMANITY_BANDS: Array<BandInfo & { min: number }> = [
  { band: 'stable', min: 41, label: 'Estável', narrator: '' },
  {
    band: 'detached',
    min: 21,
    label: 'Dissociação',
    narrator: 'Humanidade baixa: o personagem sente as emoções "com atraso", como se viessem por cabo. Descreva frieza, gente virando obstáculo, prazer menor nas coisas humanas.',
  },
  {
    band: 'fraying',
    min: 11,
    label: 'Desgaste',
    narrator:
      'Humanidade muito baixa: pensamentos intrusivos violentos, o cromo "sussurra", pequenas alucinações (HUD piscando, rostos em pixel). Insira 1 intrusão curta por cena. Uma sugestão de ação deve ser um impulso cruel/impaciente.',
  },
  {
    band: 'edge',
    min: 1,
    label: 'À beira',
    narrator:
      'Humanidade CRÍTICA: surtos de raiva, desconexão do próprio corpo, vozes de estática. A narração vem entrecortada. Duas das sugestões de ação devem ser impulsos violentos; pessoas próximas notam e se afastam.',
  },
  {
    band: 'cyberpsycho',
    min: -Infinity,
    label: 'CIBERPSICOSE',
    narrator:
      'CIBERPSICOSE: o personagem perdeu o controle. Narre em frases quebradas, sensoriais, predatórias. As suggestedActions (3 a 4) são SEMPRE impulsos de um ciberpsicopata (violência, fuga, destruição, paranoia) — o jogador NÃO pode digitar, só escolher entre elas. O mundo reage: pânico, NCPD, e em algum momento a MaxTac.',
  },
];

export function humanityBand(c: Pick<Character, 'humanity' | 'dead'>): BandInfo {
  const h = c.humanity.current;
  return HUMANITY_BANDS.find(b => h >= b.min) ?? HUMANITY_BANDS[HUMANITY_BANDS.length - 1];
}

export const isCyberpsycho = (c: Pick<Character, 'humanity' | 'dead'>) => !c.dead && c.humanity.current <= 0;

/** Impulsos padrão (se o narrador não mandar sugestões). */
export const CYBERPSYCHO_ACTIONS = [
  'ATACAR quem estiver mais perto',
  'Arrancar o cromo que está gritando dentro de mim',
  'Fugir pelos telhados — eles estão vindo',
  'Destruir tudo que brilha',
];
