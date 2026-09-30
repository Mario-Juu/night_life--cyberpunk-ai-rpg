/**
 * Habilidades de Papel (Cyberpunk RED, cap. Papéis).
 * Todo personagem começa com rank 4; máximo 10; subir custa 60 × o novo rank em PM.
 */
import type { CombatAwarenessKey, DrugKey, MakerKey, MedicineKey, RoleData, RoleId, StatKey } from '../types/game';

export const START_ROLE_RANK = 4;
export const MAX_ROLE_RANK = 10;

export function roleUpgradeCost(targetRank: number): number {
  return targetRank * 60;
}

export interface RoleAbilityInfo {
  name: string;
  summary: string;
}

export const ROLE_ABILITY: Record<RoleId, RoleAbilityInfo> = {
  solo: { name: 'Consciência de Combate', summary: 'Distribua pontos iguais ao rank entre Desvio de Dano, Recuperação de Falha, Reação de Iniciativa, Ataque Preciso, Ponto Fraco e Detecção de Ameaça.' },
  netrunner: { name: 'Interface', summary: 'Invadir arquiteturas da Rede: rank + 1d10 contra o DV. O rank define as Ações de Rede por turno.' },
  tech: { name: 'Fabricante', summary: 'Consertos em campo, aprimoramentos, fabricação e invenção. Cada rank dá +1 em duas especialidades.' },
  medtech: { name: 'Medicina', summary: 'Cada rank vira um ponto em Cirurgia (+2 na perícia), Farmacêutica (drogas médicas) ou Criossistemas.' },
  fixer: { name: 'Operador', summary: 'Pechincha, contatos e mercado: preços melhores e acesso a itens mais raros conforme o rank.' },
  nomad: { name: 'Moto', summary: 'Soma o rank em Pilotar Veículo e Tec. de Veículos; o clã cede um veículo da família conforme o rank.' },
};

// ---------------------------------------------------------------- Solo

export interface CombatAwarenessOption {
  key: CombatAwarenessKey;
  label: string;
  /** Passo de custo (pontos só entram em múltiplos dele). */
  step: number;
  max: number;
  describe: (points: number) => string;
}

export const COMBAT_AWARENESS: CombatAwarenessOption[] = [
  { key: 'deflection', label: 'Desvio de Dano', step: 2, max: 10, describe: p => `−${Math.floor(p / 2)} no primeiro dano sofrido a cada rodada` },
  { key: 'fumbleRecovery', label: 'Recuperação de Falha', step: 4, max: 4, describe: p => (p >= 4 ? 'ignora o 1 natural (falha crítica) em ataques' : 'custa 4 pontos') },
  { key: 'initiative', label: 'Reação de Iniciativa', step: 1, max: 10, describe: p => `+${p} na Iniciativa` },
  { key: 'precision', label: 'Ataque Preciso', step: 3, max: 9, describe: p => `+${Math.floor(p / 3)} nos ataques` },
  { key: 'spotWeakness', label: 'Ponto Fraco', step: 1, max: 10, describe: p => `+${p} de dano (antes da armadura) no primeiro acerto da rodada` },
  { key: 'threatDetection', label: 'Detecção de Ameaça', step: 1, max: 10, describe: p => `+${p} em Percepção` },
];

export function combatAwarenessValue(data: RoleData, key: CombatAwarenessKey): number {
  const p = data.combatAwareness?.[key] ?? 0;
  switch (key) {
    case 'deflection':
      return Math.min(5, Math.floor(p / 2));
    case 'fumbleRecovery':
      return p >= 4 ? 1 : 0;
    case 'precision':
      return Math.min(3, Math.floor(p / 3));
    default:
      return p;
  }
}

// ---------------------------------------------------------------- Técnico

export const MAKER_SPECIALTIES: Array<{ key: MakerKey; label: string; description: string }> = [
  { key: 'field', label: 'Especialista de Campo', description: 'Soma o rank em Tecnologia Básica, Cibertecnologia, Eletrônica/Segurança, Armeiro e Tec. de Veículos; gambiarras de emergência.' },
  { key: 'upgrade', label: 'Aprimoramento', description: 'Melhora um item (uma vez por item): arma mais letal, armadura mais resistente.' },
  { key: 'fabrication', label: 'Fabricação', description: 'Constrói itens com materiais de uma categoria de preço abaixo.' },
  { key: 'invention', label: 'Invenção', description: 'Cria algo novo (Caro ou acima), com a aprovação do Mestre.' },
];

/** Perícias que recebem o bônus de Especialista de Campo. */
export const FIELD_EXPERTISE_SKILLS = ['basic_tech', 'cybertech', 'electronics_security', 'weaponstech', 'vehicle_tech'];

/** Pontos de especialidade: 2 por rank; cada especialidade até o rank. */
export const makerPointsTotal = (rank: number) => rank * 2;

export type PriceCategory = 'cheap' | 'everyday' | 'costly' | 'premium' | 'expensive' | 'very_expensive' | 'luxury' | 'super_luxury';

export const PRICE_CATEGORIES: Array<{ key: PriceCategory; label: string; price: number; dv: number; hours: number }> = [
  { key: 'cheap', label: 'Barato', price: 10, dv: 9, hours: 1 },
  { key: 'everyday', label: 'Cotidiano', price: 20, dv: 9, hours: 1 },
  { key: 'costly', label: 'Custoso', price: 50, dv: 13, hours: 6 },
  { key: 'premium', label: 'Premium', price: 100, dv: 17, hours: 24 },
  { key: 'expensive', label: 'Caro', price: 500, dv: 21, hours: 24 * 7 },
  { key: 'very_expensive', label: 'Muito caro', price: 1000, dv: 24, hours: 24 * 14 },
  { key: 'luxury', label: 'Luxo', price: 5000, dv: 29, hours: 24 * 30 },
  { key: 'super_luxury', label: 'Superluxo', price: 10000, dv: 29, hours: 24 * 30 },
];

export function priceCategoryFor(price: number): (typeof PRICE_CATEGORIES)[number] {
  return [...PRICE_CATEGORIES].reverse().find(c => price >= c.price) ?? PRICE_CATEGORIES[0];
}

// ---------------------------------------------------------------- Medicânico

export const MEDICINE_SPECIALTIES: Array<{ key: MedicineKey; label: string; max: number; description: string }> = [
  { key: 'surgery', label: 'Cirurgia', max: 5, description: '+2 na perícia Cirurgia por ponto: tratar Ferimentos Críticos graves e instalar ciberware.' },
  { key: 'pharma', label: 'Farmacêutica', max: 5, description: 'Cada ponto libera uma droga médica para fabricar (DV 13, €$200 de insumos).' },
  { key: 'cryo', label: 'Criossistemas', max: 5, description: 'Operar criobombas e criotanques: manter pacientes em estase.' },
];

export const DRUGS: Record<DrugKey, { label: string; description: string }> = {
  antibiotic: { label: 'Antibiótico', description: '+2 PV em cada descanso durante uma semana.' },
  rapidetox: { label: 'Rapidetox', description: 'Elimina drogas, venenos e toxinas do organismo na hora.' },
  speedheal: { label: 'Speedheal', description: 'Recupera CORPO + VONTADE em PV. Uma vez por dia.' },
  stim: { label: 'Stim', description: 'Ignora a penalidade de Gravemente Ferido por 1 hora.' },
  surge: { label: 'Surge', description: 'Dispensa o sono por 24 horas.' },
};

export const DRUG_ORDER: DrugKey[] = ['speedheal', 'antibiotic', 'stim', 'rapidetox', 'surge'];

/** Valor da perícia Cirurgia (só Medicânicos). */
export function surgerySkill(data: RoleData): number {
  return Math.min(10, (data.medicine?.surgery ?? 0) * 2);
}

// ---------------------------------------------------------------- Canal

export function operatorPerks(rank: number) {
  return {
    discount: rank >= 9 ? 0.2 : 0.1,
    /** Leve 6, pague 5 em munição/consumíveis. */
    bulkBonus: rank >= 3,
    /** Trabalhos pagam +20%. */
    jobBonus: rank >= 5 ? 0.2 : 0,
    reach: rank >= 10 ? 'Superluxo' : rank >= 9 ? 'Luxo (Mercado da Meia-Noite)' : rank >= 7 ? 'Muito caro' : rank >= 5 ? 'Caro (Mercado Noturno mensal)' : rank >= 3 ? 'até Caro' : 'Barato e Cotidiano',
  };
}

// ---------------------------------------------------------------- Nômade

export const MOTO_SKILLS = ['drive', 'vehicle_tech'];

export function familyVehicle(rank: number): string {
  if (rank >= 9) return 'AV-9 do clã (veículo aéreo)';
  if (rank >= 7) return 'Superbike blindada do clã';
  if (rank >= 5) return 'Carro de alta performance do clã';
  return 'Moto de estrada do clã (ou carro compacto)';
}

// ---------------------------------------------------------------- bônus em testes

/** Bônus automáticos da habilidade de papel em uma perícia (fora de combate/Rede). */
export function roleSkillBonus(role: RoleId, rank: number, data: RoleData, skillId: string | null): { label: string; value: number } | null {
  if (!skillId) return null;
  if (role === 'solo' && skillId === 'perception') {
    const v = combatAwarenessValue(data, 'threatDetection');
    return v ? { label: 'Detecção de Ameaça', value: v } : null;
  }
  if (role === 'tech' && FIELD_EXPERTISE_SKILLS.includes(skillId)) {
    const v = data.maker?.field ?? 0;
    return v ? { label: 'Especialista de Campo', value: v } : null;
  }
  if (role === 'nomad' && MOTO_SKILLS.includes(skillId)) return { label: 'Moto', value: rank };
  return null;
}

/** Atributo usado pela perícia Cirurgia. */
export const SURGERY_STAT: StatKey = 'TECH';
