import type { StatKey } from '../types/game';

export const STAT_KEYS: readonly StatKey[] = ['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP'];

export const STAT_INFO: Record<StatKey, { label: string; description: string }> = {
  INT: { label: 'Inteligência', description: 'Raciocínio, memória e dedução.' },
  REF: { label: 'Reflexos', description: 'Tempo de reação e pontaria com armas de fogo.' },
  DEX: { label: 'Destreza', description: 'Agilidade, equilíbrio e combate corpo a corpo.' },
  TECH: { label: 'Técnica', description: 'Habilidade com ferramentas, máquinas e implantes.' },
  COOL: { label: 'Autocontrole', description: 'Compostura sob pressão e presença social.' },
  WILL: { label: 'Vontade', description: 'Determinação e resistência mental.' },
  LUCK: { label: 'Sorte', description: 'Pontos gastáveis para somar em qualquer teste. Recarregam a cada dia.' },
  MOVE: { label: 'Movimento', description: 'Velocidade de deslocamento.' },
  BODY: { label: 'Corpo', description: 'Constituição, força e resistência a dano.' },
  EMP: { label: 'Empatia', description: 'Conexão humana. Cai junto com a Humanidade.' },
};

export function isStatKey(value: unknown): value is StatKey {
  return typeof value === 'string' && (STAT_KEYS as readonly string[]).includes(value);
}

/** Aceita apenas correspondência exata (após normalização), nunca substring. */
export function parseStat(value: unknown): StatKey | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toUpperCase();
  if (isStatKey(clean)) return clean;
  const aliases: Record<string, StatKey> = {
    INTELIGENCIA: 'INT',
    INTELIGÊNCIA: 'INT',
    REFLEXOS: 'REF',
    DESTREZA: 'DEX',
    TECNICA: 'TECH',
    TÉCNICA: 'TECH',
    AUTOCONTROLE: 'COOL',
    VONTADE: 'WILL',
    SORTE: 'LUCK',
    MOVIMENTO: 'MOVE',
    CORPO: 'BODY',
    EMPATIA: 'EMP',
  };
  return aliases[clean] ?? null;
}

/** HP máximo — Cyberpunk RED: 10 + 5 × ⌈(BODY + WILL) / 2⌉ */
export function computeMaxHp(body: number, will: number): number {
  return 10 + 5 * Math.ceil((body + will) / 2);
}

/** Humanidade máxima = EMP × 10 */
export function computeMaxHumanity(emp: number): number {
  return emp * 10;
}

/**
 * Humanidade depois de instalar cromo. O máximo cai junto com a instalação, então o atual tem de
 * ser preso ao novo teto — senão um personagem com Humanidade cheia fica com 60/56 e a ficha mente.
 */
export function humanityAfter(h: { current: number; max: number }, loss: number, maxPenalty: number): { current: number; max: number } {
  const max = Math.max(0, h.max - maxPenalty);
  return { current: Math.min(max, Math.max(0, h.current - loss)), max };
}

/** EMP efetivo cai conforme a Humanidade é perdida. */
export function effectiveEmp(humanityCurrent: number): number {
  return Math.max(0, Math.floor(humanityCurrent / 10));
}
