import type { CriticalInjury, HitLocation } from '../types/game';

export type CriticalInjuryTemplate = Omit<CriticalInjury, 'id'>;

export const CRITICAL_INJURIES: readonly CriticalInjuryTemplate[] = [
  // Corpo
  { key: 'broken_arm', name: 'Braço Quebrado', location: 'body', effect: '−2 em ações com o braço (REF e DEX).', penalties: { REF: -2, DEX: -2 }, quickFixDv: 13, treatmentDv: 15 },
  { key: 'broken_leg', name: 'Perna Quebrada', location: 'body', effect: '−4 em MOVE e −2 em DEX.', penalties: { MOVE: -4, DEX: -2 }, quickFixDv: 13, treatmentDv: 15 },
  { key: 'broken_ribs', name: 'Costelas Quebradas', location: 'body', effect: '−2 em BODY e em testes físicos.', penalties: { BODY: -2, DEX: -1 }, quickFixDv: 13, treatmentDv: 15 },
  { key: 'collapsed_lung', name: 'Pulmão Perfurado', location: 'body', effect: '−2 em MOVE e fôlego curto: −1 em tudo.', penalties: { MOVE: -2, all: -1 }, quickFixDv: 15, treatmentDv: 15 },
  { key: 'foreign_object', name: 'Objeto Estranho', location: 'body', effect: 'Estilhaço alojado: −1 em tudo até ser removido.', penalties: { all: -1 }, quickFixDv: 13, treatmentDv: 15 },
  { key: 'torn_muscle', name: 'Músculo Rompido', location: 'body', effect: '−2 em ataques corpo a corpo e atletismo.', penalties: { DEX: -2 }, quickFixDv: 13, treatmentDv: 15 },
  // Cabeça
  { key: 'concussion', name: 'Concussão', location: 'head', effect: '−2 em INT e em testes de percepção.', penalties: { INT: -2 }, quickFixDv: 13, treatmentDv: 15 },
  { key: 'damaged_eye', name: 'Olho Danificado', location: 'head', effect: '−2 em ataques à distância e percepção visual.', penalties: { REF: -2, INT: -1 }, quickFixDv: 15, treatmentDv: 17 },
  { key: 'broken_jaw', name: 'Mandíbula Quebrada', location: 'head', effect: '−4 em testes sociais que dependem da fala.', penalties: { COOL: -4, EMP: -2 }, quickFixDv: 13, treatmentDv: 13 },
  { key: 'cracked_skull', name: 'Crânio Rachado', location: 'head', effect: 'Visão turva: −2 em tudo.', penalties: { all: -2 }, quickFixDv: 15, treatmentDv: 17 },
];

export function randomCriticalInjury(location: HitLocation, rng: (sides: number) => number): CriticalInjuryTemplate {
  const pool = CRITICAL_INJURIES.filter(i => i.location === location);
  return pool[rng(pool.length) - 1] ?? pool[0];
}

export function findCriticalInjuryTemplate(keyOrName: string): CriticalInjuryTemplate | undefined {
  const needle = keyOrName.trim().toLowerCase();
  return CRITICAL_INJURIES.find(i => i.key === needle || i.name.toLowerCase() === needle);
}
