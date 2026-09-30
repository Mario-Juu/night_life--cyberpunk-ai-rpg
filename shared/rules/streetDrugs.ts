/**
 * Drogas de rua (Cyberpunk RED, "Street Drugs"). Cada dose tem um efeito primário com duração
 * e um efeito secundário: Resistir a Tortura/Drogas (VONTADE) contra o DV — falhou, viciou.
 * Viciado sofre a abstinência sempre que NÃO está sob efeito da droga. Cura: terapia de vício.
 */
import type { StatKey, StreetDrugKey } from '../types/game';

export interface StreetDrugDef {
  label: string;
  description: string;
  minutes: number;
  /** Modificadores enquanto dura (positivo = bônus). */
  mods: Partial<Record<StatKey | 'all', number>>;
  /** DV do teste de vício (Resistir a Tortura/Drogas). */
  addictionDv: number;
  /** Penalidade da abstinência (viciado e sóbrio). */
  withdrawal: Partial<Record<StatKey, number>>;
  price: number;
  aliases: string[];
}

export const STREET_DRUGS: Record<StreetDrugKey, StreetDrugDef> = {
  black_lace: {
    label: 'Black Lace',
    description: 'Estimulante de combate: por 24 h ignora a penalidade de Gravemente Ferido. Custa 2d6 de Humanidade.',
    minutes: 24 * 60,
    mods: {},
    addictionDv: 17,
    withdrawal: { REF: -2 },
    price: 50,
    aliases: ['black lace', 'lace', 'renda negra'],
  },
  blue_glass: {
    label: 'Blue Glass',
    description: 'Alucinógeno: 4 h de viagem; −2 em REF e INT enquanto dura.',
    minutes: 4 * 60,
    mods: { REF: -2, INT: -2 },
    addictionDv: 15,
    withdrawal: { INT: -2 },
    price: 20,
    aliases: ['blue glass', 'vidro azul', 'glass'],
  },
  boost: {
    label: 'Boost',
    description: 'Nootrópico de rua: +2 INT por 24 h.',
    minutes: 24 * 60,
    mods: { INT: 2 },
    addictionDv: 15,
    withdrawal: { INT: -2 },
    price: 50,
    aliases: ['boost'],
  },
  smash: {
    label: 'Smash',
    description: 'A "cerveja" da rua: 4 h de coragem líquida — +2 COOL, −2 REF.',
    minutes: 4 * 60,
    mods: { COOL: 2, REF: -2 },
    addictionDv: 13,
    withdrawal: { COOL: -2 },
    price: 10,
    aliases: ['smash'],
  },
  synthcoke: {
    label: 'Synthcoke',
    description: 'Estimulante barato: +1 REF por 1 h.',
    minutes: 60,
    mods: { REF: 1 },
    addictionDv: 15,
    withdrawal: { REF: -2 },
    price: 20,
    aliases: ['synthcoke', 'sintecoca', 'coca sintética', 'coca'],
  },
};

export const STREET_DRUG_KEYS = Object.keys(STREET_DRUGS) as StreetDrugKey[];

/** Tratamento de vício (clínica + desintoxicação): uma semana, limpa todos os vícios. */
export const ADDICTION_THERAPY_PRICE = 1000;

export function guessStreetDrug(name: string): StreetDrugKey | undefined {
  const n = name.toLowerCase();
  return STREET_DRUG_KEYS.find(k => STREET_DRUGS[k].aliases.some(a => n.includes(a)));
}

export const withdrawalName = (k: StreetDrugKey) => `Abstinência de ${STREET_DRUGS[k].label}`;
