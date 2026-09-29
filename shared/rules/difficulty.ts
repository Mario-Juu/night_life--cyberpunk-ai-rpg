export const DV = {
  SIMPLE: 9,
  EVERYDAY: 13,
  DIFFICULT: 15,
  PROFESSIONAL: 17,
  HEROIC: 21,
  INCREDIBLE: 24,
  LEGENDARY: 29,
} as const;

export const DV_TABLE: Array<{ dv: number; label: string; description: string }> = [
  { dv: DV.SIMPLE, label: 'Simples', description: 'Quase qualquer um consegue sob leve pressão.' },
  { dv: DV.EVERYDAY, label: 'Cotidiano', description: 'Tarefa comum sob pressão real de rua.' },
  { dv: DV.DIFFICULT, label: 'Difícil', description: 'Exige treinamento de verdade.' },
  { dv: DV.PROFESSIONAL, label: 'Profissional', description: 'Nível de especialista veterano.' },
  { dv: DV.HEROIC, label: 'Heroico', description: 'Façanha cinematográfica e perigosa.' },
  { dv: DV.INCREDIBLE, label: 'Incrível', description: 'Quase impossível.' },
  { dv: DV.LEGENDARY, label: 'Lendário', description: 'Vira lenda nos bares de Night City.' },
];

export const MIN_DV = 6;
export const MAX_DV = 30;

export function clampDv(value: unknown, fallback: number = DV.EVERYDAY): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DV, Math.max(MIN_DV, n));
}

export function dvLabel(dv: number): string {
  let label = DV_TABLE[0].label;
  for (const row of DV_TABLE) if (dv >= row.dv) label = row.label;
  return label;
}
