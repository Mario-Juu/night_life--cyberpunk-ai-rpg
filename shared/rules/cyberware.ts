/**
 * Catálogo de ciberware de NIGHT//LIFE (2077). Base: Cyberpunk RED (2045, livro básico p.358–367,
 * números do Foundry VTT) + o cromo que surgiu/evoluiu até 2077 (Kiroshi, Sandevistans Dynalar,
 * Zetatech e Militech, Berserk, Louva-a-deus Arasaka, Segundo Coração…). Preço já inclui a cirurgia.
 *
 * Regras de RED mantidas: perda de Humanidade rolada na instalação; cada peça baixa a Humanidade
 * MÁXIMA em 2 (Borgware 4; perda 0 não baixa). Opções precisam de uma fundação com slots livres.
 *
 * Camada de 2077 (senso de mundo):
 * - TIER 1–5 (Comum → Lendário): qualidade/raridade. Um ripperdoc só instala até o nível da clínica.
 * - GRAU: civil (qualquer um vende), militar (só mercado negro, e só para quem ele confia),
 *   protótipo (não se compra: só achando/recebendo a peça — o ripperdoc só faz a cirurgia).
 */
import type { CyberwareCategory, StatKey, WeaponClass } from '../types/game';

export type InstallPlace = 'mall' | 'clinic' | 'hospital' | 'none';
export type CyberTier = 1 | 2 | 3 | 4 | 5;
export type CyberGrade = 'civil' | 'military' | 'prototype';

/**
 * Sistema operacional ativável (Sandevistan / Berserk). Adaptação dos modelos de 2077 para o turno
 * do RED: dura RODADAS de combate; uma ativação por luta (a recarga corre no relógio do jogo).
 */
export interface OsSpec {
  kind: 'sandevistan' | 'berserk';
  rounds: number;
  initiative: number;
  /** Tempo dilatado: um ataque extra por Ação (vale para qualquer arma, até Cadência 1). */
  extraAttack: boolean;
  /** O ataque extra também pode ser mirado (Apogee). */
  aimedFollowUp?: boolean;
  toHit: number;
  /** Pode esquivar de balas (como REF 8+) com este bônus. */
  dodgeBullets?: boolean;
  evade: number;
  /** Penalidade nos ataques dos inimigos contra você. */
  enemyPenalty: number;
  /** Dano extra corpo a corpo (Berserk). */
  meleeDamage: number;
  /** Reduz cada dano sofrido (Berserk). */
  damageReduction: number;
  /** Estresse neural: VONTADE + Resistência vs DV ao ativar; falhou, sangra por dentro. */
  strainDv: number;
  strainDamage: string;
  /** Falhar no estresse também custa Humanidade (militares, o caminho do David Martinez). */
  strainHumanity?: string;
  cooldownMin: number;
}
export type FoundationKind = 'neural_link' | 'cybereye' | 'cyberaudio' | 'cyberarm' | 'cyberleg' | 'chip_socket';

/** Efeito mecânico que o motor aplica. */
export type CyberEffect =
  | { kind: 'initiative'; value: number }
  | { kind: 'skill'; skills: string[]; value: number; note?: string }
  | { kind: 'aimed'; value: number }
  | { kind: 'long_range'; value: number }
  | { kind: 'body'; value: number; max: number }
  | { kind: 'body_set'; value: number; minBody: number }
  | { kind: 'armor'; sp: number }
  | { kind: 'weapon'; name: string; weaponClass: WeaponClass; damage: string }
  | { kind: 'pain_editor' }
  | { kind: 'double_healing' }
  | { kind: 'skill_chip'; value: number }
  | { kind: 'netrun_link' }
  | { kind: 'second_heart' }
  | { kind: 'dodge_bullets' }
  | { kind: 'damage_reduction'; value: number }
  | { kind: 'slots'; foundation: FoundationKind; value: number }
  | { kind: 'narrative' };

export interface CyberwareDef {
  key: string;
  name: string;
  category: CyberwareCategory;
  price: number;
  /** Dados de perda de Humanidade ('0' = nenhuma). */
  hl: string;
  install: InstallPlace;
  /** Se é uma fundação: que tipo e quantos slots oferece. */
  foundation?: { kind: FoundationKind; slots: number; max: number };
  /** Se é opção: em que fundação encaixa e quantos slots ocupa. */
  requires?: FoundationKind;
  slots?: number;
  /** Instalado nos dois olhos/pernas (paga e perde Humanidade duas vezes). */
  paired?: boolean;
  speedware?: boolean;
  borgware?: boolean;
  effect: string;
  effects: CyberEffect[];
  /** Preenchidos pelo catálogo (padrão pelo preço/civil) — ver applyEra. */
  tier: CyberTier;
  grade: CyberGrade;
  /** Fabricante (Kiroshi, Militech, Arasaka…). */
  brand?: string;
  /** Sistema operacional ativável. */
  os?: OsSpec;
}

type Def = Omit<CyberwareDef, 'tier' | 'grade'> & Partial<Pick<CyberwareDef, 'tier' | 'grade'>>;

const narrative: CyberEffect[] = [{ kind: 'narrative' }];

const sandy = (o: Partial<OsSpec>): OsSpec => ({ kind: 'sandevistan', rounds: 1, initiative: 2, extraAttack: false, toHit: 0, dodgeBullets: true, evade: 0, enemyPenalty: 0, meleeDamage: 0, damageReduction: 0, strainDv: 9, strainDamage: '1d6', cooldownMin: 10, ...o });
const berserk = (o: Partial<OsSpec>): OsSpec => ({ kind: 'berserk', rounds: 3, initiative: 0, extraAttack: false, toHit: 0, evade: 0, enemyPenalty: 0, meleeDamage: 2, damageReduction: 2, strainDv: 11, strainDamage: '1d6', cooldownMin: 10, ...o });

function osEffect(o: OsSpec): string {
  const parts = [`${o.rounds} rodada${o.rounds > 1 ? 's' : ''}`];
  if (o.initiative) parts.push(`+${o.initiative} Iniciativa`);
  if (o.extraAttack) parts.push(o.aimedFollowUp ? 'ataque extra (até mirado)' : 'ataque extra por ação');
  if (o.toHit) parts.push(`+${o.toHit} para acertar`);
  if (o.dodgeBullets) parts.push(`esquiva de balas${o.evade ? ` +${o.evade}` : ''}`);
  if (o.enemyPenalty) parts.push(`inimigos −${o.enemyPenalty}`);
  if (o.meleeDamage) parts.push(`+${o.meleeDamage} dano corpo a corpo`);
  if (o.damageReduction) parts.push(`−${o.damageReduction} em cada dano sofrido`);
  parts.push(`estresse DV ${o.strainDv} (${o.strainDamage}${o.strainHumanity ? ` + ${o.strainHumanity} HUM` : ''})`);
  return parts.join(', ');
}

/** Cromo de 2077: evolução do que existia em 2045 e o que surgiu depois. */
const ERA_DEFS: Def[] = [
  // ---------------- Sistemas operacionais (um por corpo; Sandevistan também é speedware)
  { key: 'sandevistan', name: 'Sandevistan Mk.1', brand: 'Dynalar', tier: 1, category: 'Neuralware', price: 500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, os: sandy({}), effect: '', effects: [] },
  { key: 'sandevistan_zetatech', name: 'Sandevistan Mk.2', brand: 'Zetatech', tier: 2, category: 'Neuralware', price: 1500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, os: sandy({ rounds: 2, initiative: 3, extraAttack: true, strainDv: 11 }), effect: '', effects: [] },
  { key: 'sandevistan_dynalar_mk3', name: 'Sandevistan Mk.3', brand: 'Dynalar', tier: 3, category: 'Neuralware', price: 3500, hl: '3d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, os: sandy({ rounds: 3, initiative: 3, extraAttack: true, toHit: 1, strainDv: 13, strainDamage: '2d6' }), effect: '', effects: [] },
  { key: 'sandevistan_falcon', name: 'Sandevistan "Falcon"', brand: 'Militech', tier: 4, grade: 'military', category: 'Neuralware', price: 9000, hl: '3d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, os: sandy({ rounds: 3, initiative: 4, extraAttack: true, toHit: 2, evade: 2, strainDv: 15, strainDamage: '2d6', cooldownMin: 15 }), effect: '', effects: [] },
  { key: 'sandevistan_apogee', name: 'Sandevistan "Apogee"', brand: 'Militech', tier: 5, grade: 'military', category: 'Neuralware', price: 18000, hl: '4d6', install: 'hospital', requires: 'neural_link', slots: 1, speedware: true, os: sandy({ rounds: 2, initiative: 5, extraAttack: true, aimedFollowUp: true, toHit: 2, evade: 2, strainDv: 17, strainDamage: '2d6', strainHumanity: '1d6', cooldownMin: 15 }), effect: '', effects: [] },
  { key: 'sandevistan_warp_dancer', name: 'Sandevistan "Warp Dancer"', brand: 'Qiant', tier: 5, grade: 'prototype', category: 'Neuralware', price: 25000, hl: '4d6', install: 'hospital', requires: 'neural_link', slots: 1, speedware: true, os: sandy({ rounds: 3, initiative: 4, extraAttack: true, evade: 4, enemyPenalty: 2, strainDv: 15, strainDamage: '2d6', cooldownMin: 20 }), effect: '', effects: [] },
  { key: 'berserk_moore', name: 'Berserk Mk.2', brand: 'Moore Tech', tier: 2, category: 'Neuralware', price: 1500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, os: berserk({}), effect: '', effects: [] },
  { key: 'berserk_militech', name: 'Berserk Mk.5', brand: 'Militech', tier: 4, grade: 'military', category: 'Neuralware', price: 8000, hl: '3d6', install: 'clinic', requires: 'neural_link', slots: 1, os: berserk({ meleeDamage: 5, damageReduction: 4, toHit: 1, strainDv: 15, strainDamage: '2d6', cooldownMin: 15 }), effect: '', effects: [] },
  { key: 'kerenzikov_boost', name: 'Kerenzikov Boost', brand: 'Militech', tier: 4, grade: 'military', category: 'Neuralware', price: 7000, hl: '4d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, effect: 'Speedware militar sempre ligada: +3 de Iniciativa e esquiva de balas mesmo com REF baixo.', effects: [{ kind: 'initiative', value: 3 }, { kind: 'dodge_bullets' }] },
  { key: 'skill_chip_pro', name: 'Chip de Perícia Profissional', brand: 'Zetatech', tier: 3, category: 'Neuralware', price: 3000, hl: '2d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Uma perícia vale 5 enquanto o chip estiver encaixado (se for menor).', effects: [{ kind: 'skill_chip', value: 5 }] },
  { key: 'skill_chip_military', name: 'Chip de Treinamento Militar', brand: 'Militech', tier: 5, grade: 'military', category: 'Neuralware', price: 12000, hl: '3d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Doutrina de combate gravada: uma perícia vale 7 enquanto o chip estiver encaixado.', effects: [{ kind: 'skill_chip', value: 7 }] },
  { key: 'pain_editor_mk2', name: 'Editor de Dor Mk.2', brand: 'Biotechnica', tier: 4, category: 'Neuralware', price: 6000, hl: '3d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Ignora Gravemente Ferido e reduz em 2 cada dano sofrido (a dor não chega ao cérebro).', effects: [{ kind: 'pain_editor' }, { kind: 'damage_reduction', value: 2 }] },
  { key: 'synaptic_accelerator', name: 'Acelerador Sináptico', brand: 'Zetatech', tier: 1, category: 'Neuralware', price: 500, hl: '1d6', install: 'clinic', requires: 'neural_link', slots: 1, effect: 'Reflexos afiados: +1 de Iniciativa (soma com speedware).', effects: [{ kind: 'initiative', value: 1 }] },

  // ---------------- Ciberóticos e ciberáudio de 2077
  { key: 'kiroshi_clairvoyant', name: 'Óptica "Clairvoyant"', brand: 'Kiroshi', tier: 4, category: 'Ciberóptico', price: 5000, hl: '1d6', install: 'clinic', requires: 'cybereye', slots: 2, effect: 'Análise de ameaças em tempo real: +3 Percepção e Ocultar/Revelar, +1 em tiros mirados.', effects: [{ kind: 'skill', skills: ['perception', 'conceal_reveal'], value: 3 }, { kind: 'aimed', value: 1 }] },

  { key: 'kiroshi_sentry', name: 'Óptica "Sentry"', brand: 'Kiroshi', tier: 3, category: 'Ciberóptico', price: 2500, hl: '1d6', install: 'clinic', requires: 'cybereye', slots: 1, paired: true, effect: 'Destaca ameaças e armas escondidas: +2 Percepção e Ocultar/Revelar, +1 em tiros a mais de 50 m.', effects: [{ kind: 'skill', skills: ['perception', 'conceal_reveal'], value: 2 }, { kind: 'long_range', value: 1 }] },
  { key: 'militech_targeting', name: 'Sistema de Mira Militar', brand: 'Militech', tier: 4, grade: 'military', category: 'Ciberóptico', price: 6000, hl: '2d6', install: 'clinic', requires: 'cybereye', slots: 2, effect: 'Balística assistida: +2 em tiros mirados e +1 em tiros a mais de 50 m.', effects: [{ kind: 'aimed', value: 2 }, { kind: 'long_range', value: 1 }] },
  { key: 'voice_stress_pro', name: 'Analisador de Microexpressões', brand: 'Kiroshi', tier: 3, category: 'Ciberáudio', price: 2500, hl: '1d6', install: 'clinic', requires: 'cyberaudio', slots: 1, effect: '+3 Percepção Humana e Interrogatório: voz e rosto entregam a mentira.', effects: [{ kind: 'skill', skills: ['human_perception', 'interrogation'], value: 3 }] },

  // ---------------- Internos
  { key: 'bionic_lungs', name: 'Pulmões Biônicos', brand: 'Biotechnica', tier: 2, category: 'Implante Interno', price: 1000, hl: '1d6', install: 'hospital', effect: '+2 Resistência e Atletismo.', effects: [{ kind: 'skill', skills: ['endurance', 'athletics'], value: 2 }] },
  { key: 'second_heart', name: 'Segundo Coração', brand: 'Biotechnica', tier: 5, grade: 'military', category: 'Implante Interno', price: 20000, hl: '4d6', install: 'hospital', effect: 'Ao cair a 0 PV, o segundo coração assume: volta com metade dos PV (uma vez por dia).', effects: [{ kind: 'second_heart' }] },

  { key: 'blood_pump', name: 'Bomba de Sangue', brand: 'Biotechnica', tier: 3, category: 'Implante Interno', price: 2500, hl: '2d6', install: 'hospital', effect: 'Coagulação e reposição acelerada: cura natural em dobro ao descansar; +2 Resistência.', effects: [{ kind: 'double_healing' }, { kind: 'skill', skills: ['endurance'], value: 2 }] },
  { key: 'grafted_muscle_mk2', name: 'Fibras Musculares Sintéticas', brand: 'Biotechnica', tier: 4, category: 'Implante Interno', price: 7500, hl: '4d6', install: 'hospital', effect: '+3 CORPO (até 11); PV recalculados. Não soma com Músculo Enxertado.', effects: [{ kind: 'body', value: 3, max: 11 }] },

  // ---------------- Dérmicos
  { key: 'subdermal_armor_mk2', name: 'Armadura Subdérmica Mk.2', brand: 'Kang Tao', tier: 3, category: 'Implante Dérmico', price: 4000, hl: '3d6', install: 'hospital', effect: 'SP 12 na cabeça e no corpo (não soma com outra armadura).', effects: [{ kind: 'armor', sp: 12 }] },
  { key: 'militech_plating', name: 'Blindagem Dérmica', brand: 'Militech', tier: 4, grade: 'military', category: 'Implante Dérmico', price: 8000, hl: '3d6', install: 'hospital', effect: 'Placas balísticas sob a pele: SP 13 na cabeça e no corpo (não soma).', effects: [{ kind: 'armor', sp: 13 }] },
  { key: 'optical_camo', name: 'Camuflagem Óptica', brand: 'Arasaka', tier: 5, grade: 'military', category: 'Implante Dérmico', price: 15000, hl: '3d6', install: 'hospital', effect: 'Fica quase invisível por instantes: +4 Furtividade.', effects: [{ kind: 'skill', skills: ['stealth'], value: 4 }] },

  // ---------------- Membros
  { key: 'gorilla_arms', name: 'Braços Gorila', brand: 'Kang Tao', tier: 2, category: 'Membro Cibernético', price: 1500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: 'Punhos hidráulicos: arma branca pesada (3d6); +2 Atletismo para arrombar e erguer.', effects: [{ kind: 'weapon', name: 'Braços Gorila', weaponClass: 'melee_heavy', damage: '3d6' }, { kind: 'skill', skills: ['athletics'], value: 2 }] },
  { key: 'mantis_arasaka', name: 'Lâminas Louva-a-deus Mk.5', brand: 'Arasaka', tier: 4, grade: 'military', category: 'Membro Cibernético', price: 8000, hl: '3d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: 'Lâminas militares de nanocarbono: arma branca (4d6), escondida.', effects: [{ kind: 'weapon', name: 'Louva-a-deus Arasaka', weaponClass: 'melee_heavy', damage: '4d6' }] },
  { key: 'monowire_militech', name: 'Monofio Mk.4', brand: 'Militech', tier: 4, grade: 'military', category: 'Membro Cibernético', price: 6000, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Monofilamento militar: arma branca (3d6) que alcança 2 m.', effects: [{ kind: 'weapon', name: 'Monofio Militech', weaponClass: 'melee_heavy', damage: '3d6' }] },
  { key: 'projectile_launcher', name: 'Sistema de Lançamento de Projéteis', brand: 'Militech', tier: 3, grade: 'military', category: 'Membro Cibernético', price: 5000, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 3, effect: 'Lança-granadas no antebraço (2 cargas, munição de granada).', effects: [{ kind: 'weapon', name: 'Lançador de Projéteis', weaponClass: 'grenade_launcher', damage: '6d6' }] },
  { key: 'cyberarm_mk2', name: 'Ciberbraço de Combate', brand: 'Kang Tao', tier: 3, category: 'Membro Cibernético', price: 3000, hl: '2d6', install: 'hospital', foundation: { kind: 'cyberarm', slots: 5, max: 2 }, effect: 'Braço reforçado (5 slots). Soco mínimo 2d6; +1 Atletismo.', effects: [{ kind: 'skill', skills: ['athletics'], value: 1 }] },
  { key: 'cyberleg_mk2', name: 'Ciberperna de Alto Desempenho', brand: 'Kang Tao', tier: 3, category: 'Membro Cibernético', price: 2500, hl: '1d6', install: 'hospital', foundation: { kind: 'cyberleg', slots: 4, max: 2 }, effect: 'Perna reforçada (4 slots). +1 Atletismo.', effects: [{ kind: 'skill', skills: ['athletics'], value: 1 }] },
  { key: 'lynx_paws', name: 'Patas de Lince', brand: 'Moore Tech', tier: 2, category: 'Membro Cibernético', price: 750, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, paired: true, effect: 'Passos amortecidos: +2 Furtividade.', effects: [{ kind: 'skill', skills: ['stealth'], value: 2 }] },
  { key: 'fortified_ankles', name: 'Tornozelos Fortificados', tier: 2, category: 'Membro Cibernético', price: 750, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, paired: true, effect: 'Saltos carregados e quedas sem dano até 10 m.', effects: narrative },
];

/**
 * Tier/grau/fabricante do cromo "clássico" de 2045 em 2077. O que não está aqui: tier pelo
 * preço (≤500 T1, ≤1000 T2, ≤5000 T3, ≤10000 T4, acima T5) e grau civil.
 */
const ERA_TAGS: Record<string, Partial<Pick<CyberwareDef, 'tier' | 'grade' | 'brand' | 'name'>>> = {
  neural_link: { brand: 'Biotechnica' },
  cybereye: { name: 'Ciberolho', brand: 'Kiroshi' },
  cyberaudio_suite: { brand: 'Zetatech' },
  cyberarm: { brand: 'Militech (civil)' },
  cyberleg: { brand: 'Militech (civil)' },
  interface_plugs: { tier: 1, brand: 'Biotechnica' },
  biomonitor: { name: 'Biomonitor (Trauma Team)', brand: 'Trauma Team' },
  internal_agent: { brand: 'Zetatech' },
  radio_communicator: { brand: 'Zetatech' },
  skin_weave: { tier: 2, brand: 'Biotechnica' },
  subdermal_armor: { tier: 3, brand: 'Militech (civil)' },
  grafted_muscle: { tier: 3, brand: 'Biotechnica' },
  low_light: { brand: 'Kiroshi' },
  microoptics: { brand: 'Kiroshi' },
  enhanced_antibodies: { brand: 'Biotechnica' },
  toxin_binders: { brand: 'Biotechnica' },
  skill_chip: { tier: 2, brand: 'Zetatech' },
  big_knucks: { brand: 'Kang Tao' },
  rippers: { brand: 'Kang Tao' },
  pain_editor: { tier: 3 },
  targeting_scope: { tier: 2 },
  teleoptics: { tier: 2 },
  dartgun: { tier: 2 },
  image_enhance: { tier: 2 },
  voice_stress: { tier: 2 },
  radar_sonar: { tier: 3 },
  cybersnake: { tier: 3, grade: 'military' },
  vampyres: { tier: 2 },
  wolvers: { tier: 2 },
  popup_ranged: { tier: 2 },
  popup_melee: { name: 'Lâminas Louva-a-deus', tier: 2 },
  slice_n_dice: { name: 'Monofio', tier: 2 },
  subdermal_grip: { name: 'Smartlink (mão)' },
  jump_booster: { name: 'Tendões Reforçados' },
  medscanner: { tier: 2 },
  techscanner: { tier: 2 },
  hardwired_deck: { tier: 2 },
  hardened_shielding: { tier: 3 },
  shoulder_mount: { tier: 4, grade: 'military' },
  multioptic_mount: { tier: 4, grade: 'military' },
  sensor_array: { tier: 3, grade: 'military' },
  linear_frame_sigma: { tier: 4, grade: 'military' },
  linear_frame_beta: { tier: 5, grade: 'military' },
};

function tierByPrice(price: number): CyberTier {
  return price <= 500 ? 1 : price <= 1000 ? 2 : price <= 5000 ? 3 : price <= 10000 ? 4 : 5;
}

function applyEra(d: Def): CyberwareDef {
  const tags = ERA_TAGS[d.key] ?? {};
  const full: CyberwareDef = { ...d, ...tags, tier: tags.tier ?? d.tier ?? tierByPrice(d.price), grade: tags.grade ?? d.grade ?? 'civil' };
  if (full.os) {
    full.effect = `${full.os.kind === 'sandevistan' ? 'Sandevistan (tempo dilatado)' : 'Berserk (fúria controlada)'}: ${osEffect(full.os)}. Uma ativação por luta.`;
    full.effects = [];
  }
  return full;
}

const RED_DEFS: Def[] = [
  // ------------------------------------------------ Estético (fashionware)
  { key: 'biomonitor', name: 'Biomonitor', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'LED sob a pele mostra seus sinais vitais; liga no Agent.', effects: narrative },
  { key: 'chemskin', name: 'Chemskin', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'Muda o tom da pele. Com Techhair: +2 Estilo Pessoal.', effects: narrative },
  { key: 'emp_threading', name: 'EMP Threading', category: 'Estético', price: 10, hl: '0', install: 'mall', effect: 'Padrão de circuito impresso na pele.', effects: narrative },
  { key: 'light_tattoo', name: 'Tatuagem de luz', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'Tatuagem que brilha.', effects: narrative },
  { key: 'shift_tacts', name: 'Shift Tacts', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'Troca a cor dos olhos à vontade.', effects: narrative },
  { key: 'skinwatch', name: 'Skinwatch', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'Relógio de LED sob a pele.', effects: narrative },
  { key: 'techhair', name: 'Techhair', category: 'Estético', price: 100, hl: '0', install: 'mall', effect: 'Cabelo que muda de cor. Com Chemskin: +2 Estilo Pessoal.', effects: narrative },

  // ------------------------------------------------ Neuralware
  { key: 'neural_link', name: 'Neural Link', category: 'Neuralware', price: 500, hl: '2d6', install: 'clinic', foundation: { kind: 'neural_link', slots: 5, max: 1 }, effect: 'Fundação da neuralware (5 slots). Liga o cérebro às máquinas.', effects: narrative },
  { key: 'interface_plugs', name: 'Plugues de Interface', category: 'Neuralware', price: 500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, effect: 'Conexão direta com máquinas, smartguns e ciberdeck (necessário para a Rede).', effects: [{ kind: 'netrun_link' }] },
  { key: 'braindance_recorder', name: 'Gravador de Braindance', category: 'Neuralware', price: 500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, effect: 'Grava experiências como braindance.', effects: narrative },
  { key: 'chipware_socket', name: 'Soquete de Chip', category: 'Neuralware', price: 500, hl: '2d6', install: 'clinic', requires: 'neural_link', slots: 1, foundation: { kind: 'chip_socket', slots: 1, max: 5 }, effect: 'Encaixe para um chip trocável.', effects: narrative },
  { key: 'kerenzikov', name: 'Kerenzikov', brand: 'Kerenzikov', category: 'Neuralware', price: 1000, hl: '4d6', install: 'clinic', requires: 'neural_link', slots: 1, speedware: true, effect: 'Speedware sempre ligada: +2 de Iniciativa.', effects: [{ kind: 'initiative', value: 2 }] },
  { key: 'chemical_analyzer', name: 'Analisador Químico (chip)', category: 'Neuralware', price: 500, hl: '1d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Testa a composição química de uma substância.', effects: narrative },
  { key: 'memory_chip', name: 'Chip de Memória', category: 'Neuralware', price: 10, hl: '0', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Armazenamento de dados.', effects: narrative },
  { key: 'olfactory_boost', name: 'Olfato Ampliado (chip)', category: 'Neuralware', price: 100, hl: '2d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Rastrear pelo cheiro: +2 Rastreamento.', effects: [{ kind: 'skill', skills: ['tracking'], value: 2 }] },
  { key: 'pain_editor', name: 'Editor de Dor (chip)', category: 'Neuralware', price: 1000, hl: '4d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Ignora a penalidade de Gravemente Ferido.', effects: [{ kind: 'pain_editor' }] },
  { key: 'skill_chip', name: 'Chip de Perícia', category: 'Neuralware', price: 500, hl: '2d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Uma perícia vale 3 enquanto o chip estiver encaixado (se for menor).', effects: [{ kind: 'skill_chip', value: 3 }] },
  { key: 'tactile_boost', name: 'Tato Ampliado (chip)', category: 'Neuralware', price: 100, hl: '2d6', install: 'none', requires: 'chip_socket', slots: 1, effect: 'Sente movimento a até 20 m pelas superfícies.', effects: narrative },

  // ------------------------------------------------ Ciberóticos
  { key: 'cybereye', name: 'Ciberolho', category: 'Ciberóptico', price: 100, hl: '2d6', install: 'clinic', foundation: { kind: 'cybereye', slots: 3, max: 2 }, effect: 'Olho cibernético (3 slots). Um por olho.', effects: narrative },
  { key: 'anti_dazzle', name: 'Anti-ofuscamento', category: 'Ciberóptico', price: 100, hl: '1d3', install: 'mall', requires: 'cybereye', slots: 1, paired: true, effect: 'Imune a clarões e granadas de luz.', effects: narrative },
  { key: 'chyron', name: 'Chyron', category: 'Ciberóptico', price: 100, hl: '1d3', install: 'mall', requires: 'cybereye', slots: 1, effect: 'Tela sobreposta (imagem na imagem) no olho.', effects: narrative },
  { key: 'color_shift', name: 'Color Shift', category: 'Ciberóptico', price: 100, hl: '1d3', install: 'mall', requires: 'cybereye', slots: 1, effect: 'Qualquer cor ou padrão no olho.', effects: narrative },
  { key: 'dartgun', name: 'Dardeira ocular', category: 'Ciberóptico', price: 500, hl: '1d3', install: 'clinic', requires: 'cybereye', slots: 3, effect: 'Arma de um tiro escondida no olho (4d6).', effects: [{ kind: 'weapon', name: 'Dardeira ocular', weaponClass: 'pistol_vheavy', damage: '4d6' }] },
  { key: 'image_enhance', name: 'Realce de Imagem', category: 'Ciberóptico', price: 500, hl: '1d6', install: 'mall', requires: 'cybereye', slots: 1, paired: true, effect: '+2 em Percepção visual e Ocultar/Revelar.', effects: [{ kind: 'skill', skills: ['perception', 'conceal_reveal'], value: 2 }] },
  { key: 'low_light', name: 'Visão Noturna/IR/UV', category: 'Ciberóptico', price: 500, hl: '1d6', install: 'mall', requires: 'cybereye', slots: 2, paired: true, effect: 'Ignora penalidades de escuridão, fumaça e neblina.', effects: narrative },
  { key: 'microoptics', name: 'MicroÓptica', category: 'Ciberóptico', price: 100, hl: '1d3', install: 'clinic', requires: 'cybereye', slots: 1, effect: 'Ampliação de até 400×.', effects: narrative },
  { key: 'microvideo', name: 'MicroVídeo', category: 'Ciberóptico', price: 500, hl: '1d3', install: 'clinic', requires: 'cybereye', slots: 2, effect: 'Câmera no olho; grava em chip ou Agent.', effects: narrative },
  { key: 'radiation_detector', name: 'Detector de Radiação', category: 'Ciberóptico', price: 1000, hl: '1d6', install: 'clinic', requires: 'cybereye', slots: 1, effect: 'Radiação aparece como brilho azul (100 m).', effects: narrative },
  { key: 'targeting_scope', name: 'Mira Telescópica', category: 'Ciberóptico', price: 500, hl: '1d6', install: 'clinic', requires: 'cybereye', slots: 1, effect: '+1 em tiros mirados.', effects: [{ kind: 'aimed', value: 1 }] },
  { key: 'teleoptics', name: 'TeleÓptica', category: 'Ciberóptico', price: 500, hl: '1d6', install: 'clinic', requires: 'cybereye', slots: 1, effect: 'Visão até 800 m; +1 em tiros contra alvos a mais de 50 m.', effects: [{ kind: 'long_range', value: 1 }] },
  { key: 'virtuality', name: 'Virtualidade', category: 'Ciberóptico', price: 100, hl: '1d3', install: 'mall', requires: 'cybereye', slots: 1, paired: true, effect: 'Óculos de virtualidade embutidos.', effects: narrative },

  // ------------------------------------------------ Ciberáudio
  { key: 'cyberaudio_suite', name: 'Suíte de Ciberáudio', category: 'Ciberáudio', price: 500, hl: '2d6', install: 'clinic', foundation: { kind: 'cyberaudio', slots: 3, max: 1 }, effect: 'Fundação de ciberáudio (3 slots).', effects: narrative },
  { key: 'amplified_hearing', name: 'Audição Ampliada', category: 'Ciberáudio', price: 100, hl: '1d6', install: 'mall', requires: 'cyberaudio', slots: 1, effect: '+2 em Percepção auditiva.', effects: [{ kind: 'skill', skills: ['perception'], value: 2 }] },
  { key: 'audio_recorder', name: 'Gravador de Áudio', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'clinic', requires: 'cyberaudio', slots: 1, effect: 'Grava som em chip ou Agent.', effects: narrative },
  { key: 'bug_detector', name: 'Detector de Escutas', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'mall', requires: 'cyberaudio', slots: 1, effect: 'Avisa de escutas e grampos a 2 m.', effects: narrative },
  { key: 'homing_tracer', name: 'Rastreador Sonoro', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'clinic', requires: 'cyberaudio', slots: 1, effect: 'Segue um rastreador pelo som até 1,6 km.', effects: narrative },
  { key: 'internal_agent', name: 'Agent Interno', category: 'Ciberáudio', price: 100, hl: '1d6', install: 'mall', requires: 'cyberaudio', slots: 1, effect: 'Agent embutido (só áudio): +2 Pesquisa.', effects: [{ kind: 'skill', skills: ['library_search'], value: 2 }] },
  { key: 'level_damper', name: 'Amortecedor de Som', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'mall', requires: 'cyberaudio', slots: 1, effect: 'Imune a ruídos ensurdecedores.', effects: narrative },
  { key: 'radar_detector', name: 'Detector de Radar', category: 'Ciberáudio', price: 500, hl: '1d3', install: 'clinic', requires: 'cyberaudio', slots: 1, effect: 'Detecta radar ativo a 1,6 km.', effects: narrative },
  { key: 'radio_communicator', name: 'Rádio Comunicador', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'mall', requires: 'cyberaudio', slots: 1, effect: 'Rádio embutido (1,6 km).', effects: narrative },
  { key: 'radio_scanner', name: 'Scanner de Rádio / Tocador', category: 'Ciberáudio', price: 50, hl: '1d3', install: 'clinic', requires: 'cyberaudio', slots: 1, effect: 'Rádio e música na cabeça.', effects: narrative },
  { key: 'scrambler', name: 'Embaralhador', category: 'Ciberáudio', price: 100, hl: '1d3', install: 'mall', requires: 'cyberaudio', slots: 1, effect: 'Codifica e decodifica transmissões.', effects: narrative },
  { key: 'voice_stress', name: 'Analisador de Estresse Vocal', category: 'Ciberáudio', price: 100, hl: '1d6', install: 'mall', requires: 'cyberaudio', slots: 1, effect: '+2 Percepção Humana e Interrogatório; detecta mentira.', effects: [{ kind: 'skill', skills: ['human_perception', 'interrogation'], value: 2 }] },

  // ------------------------------------------------ Implantes internos
  { key: 'audiovox', name: 'AudioVox', category: 'Implante Interno', price: 500, hl: '1d6', install: 'clinic', effect: 'Sintetizador vocal: +2 em atuação e música.', effects: narrative },
  { key: 'contraceptive', name: 'Implante Contraceptivo', category: 'Implante Interno', price: 10, hl: '0', install: 'mall', effect: 'Evita gravidez.', effects: narrative },
  { key: 'cybersnake', name: 'Cybersnake', category: 'Implante Interno', price: 1000, hl: '4d6', install: 'hospital', effect: 'Serpente na garganta: arma branca muito pesada (4d6).', effects: [{ kind: 'weapon', name: 'Cybersnake', weaponClass: 'melee_heavy', damage: '4d6' }] },
  { key: 'enhanced_antibodies', name: 'Anticorpos Aprimorados', category: 'Implante Interno', price: 500, hl: '1d3', install: 'mall', effect: 'Dobra a cura natural ao descansar.', effects: [{ kind: 'double_healing' }] },
  { key: 'gills', name: 'Guelras', category: 'Implante Interno', price: 1000, hl: '2d6', install: 'hospital', effect: 'Respira debaixo d’água.', effects: narrative },
  { key: 'grafted_muscle', name: 'Músculo Enxertado & Osso Reforçado', category: 'Implante Interno', price: 1000, hl: '4d6', install: 'hospital', effect: '+2 CORPO (até 10); PV recalculados.', effects: [{ kind: 'body', value: 2, max: 10 }] },
  { key: 'air_supply', name: 'Suprimento de Ar', category: 'Implante Interno', price: 1000, hl: '1d3', install: 'hospital', effect: '30 minutos de ar; recarregável.', effects: narrative },
  { key: 'midnight_lady', name: 'Midnight Lady / Mr. Studd', category: 'Implante Interno', price: 100, hl: '2d6', install: 'clinic', effect: 'Implante sexual.', effects: narrative },
  { key: 'nasal_filters', name: 'Filtros Nasais', category: 'Implante Interno', price: 100, hl: '1d3', install: 'clinic', effect: 'Imune a gases e fumaças inalados.', effects: narrative },
  { key: 'radar_sonar', name: 'Radar/Sonar', category: 'Implante Interno', price: 1000, hl: '2d6', install: 'clinic', effect: 'Varre 50 m ao redor (não atravessa cobertura).', effects: narrative },
  { key: 'toxin_binders', name: 'Ligantes de Toxina', category: 'Implante Interno', price: 100, hl: '1d3', install: 'clinic', effect: '+2 Resistir a Tortura/Drogas.', effects: [{ kind: 'skill', skills: ['resist_torture'], value: 2 }] },
  { key: 'vampyres', name: 'Vampyres', category: 'Implante Interno', price: 500, hl: '4d6', install: 'clinic', effect: 'Presas: arma branca leve (1d6); podem injetar veneno.', effects: [{ kind: 'weapon', name: 'Vampyres', weaponClass: 'melee_light', damage: '1d6' }] },

  // ------------------------------------------------ Implantes dérmicos (externos)
  { key: 'hidden_holster', name: 'Coldre Oculto', category: 'Implante Dérmico', price: 500, hl: '2d6', install: 'clinic', effect: 'Coldre escondido no corpo para uma pistola.', effects: narrative },
  { key: 'skin_weave', name: 'Pele Tecida', category: 'Implante Dérmico', price: 500, hl: '2d6', install: 'hospital', effect: 'SP 7 na cabeça e no corpo (não soma com outra armadura).', effects: [{ kind: 'armor', sp: 7 }] },
  { key: 'subdermal_armor', name: 'Armadura Subdérmica', category: 'Implante Dérmico', price: 1000, hl: '4d6', install: 'hospital', effect: 'SP 11 na cabeça e no corpo (não soma com outra armadura).', effects: [{ kind: 'armor', sp: 11 }] },
  { key: 'subdermal_pocket', name: 'Bolso Subdérmico', category: 'Implante Dérmico', price: 100, hl: '1d6', install: 'clinic', effect: 'Bolso de 5×10 cm sob a pele.', effects: narrative },

  // ------------------------------------------------ Membros cibernéticos
  { key: 'cyberarm', name: 'Ciberbraço', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'hospital', foundation: { kind: 'cyberarm', slots: 4, max: 2 }, effect: 'Braço cibernético (4 slots) com mão padrão. Soco mínimo 2d6.', effects: narrative },
  { key: 'cyberleg', name: 'Ciberperna', category: 'Membro Cibernético', price: 100, hl: '1d6', install: 'hospital', foundation: { kind: 'cyberleg', slots: 3, max: 2 }, effect: 'Perna cibernética (3 slots) com pé padrão.', effects: narrative },
  { key: 'big_knucks', name: 'Big Knucks', category: 'Membro Cibernético', price: 100, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Soco-inglês embutido: arma branca média (2d6).', effects: [{ kind: 'weapon', name: 'Big Knucks', weaponClass: 'melee_medium', damage: '2d6' }] },
  { key: 'scratchers', name: 'Scratchers', category: 'Membro Cibernético', price: 100, hl: '1d3', install: 'mall', requires: 'cyberarm', slots: 1, effect: 'Garras nas unhas: arma branca leve (1d6), escondida.', effects: [{ kind: 'weapon', name: 'Scratchers', weaponClass: 'melee_light', damage: '1d6' }] },
  { key: 'rippers', name: 'Rippers', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Garras de carbono: arma branca média (2d6), escondida.', effects: [{ kind: 'weapon', name: 'Rippers', weaponClass: 'melee_medium', damage: '2d6' }] },
  { key: 'wolvers', name: 'Wolvers', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Lâminas nos nós dos dedos: arma branca pesada (3d6), escondida.', effects: [{ kind: 'weapon', name: 'Wolvers', weaponClass: 'melee_heavy', damage: '3d6' }] },
  { key: 'slice_n_dice', name: "Slice 'n Dice", category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Chicote monofilamento: arma branca média (2d6).', effects: [{ kind: 'weapon', name: "Slice 'n Dice", weaponClass: 'melee_medium', damage: '2d6' }] },
  { key: 'grapple_hand', name: 'Mão-Gancho', category: 'Membro Cibernético', price: 100, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Gancho de escalada na mão.', effects: narrative },
  { key: 'tool_hand', name: 'Mão-Ferramenta', category: 'Membro Cibernético', price: 100, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Uma ferramenta em cada dedo.', effects: narrative },
  { key: 'subdermal_grip', name: 'Pegada Subdérmica', category: 'Membro Cibernético', price: 100, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'Link de smartgun pela mão (precisa de Neural Link).', effects: narrative },
  { key: 'quick_change', name: 'Encaixe de Troca Rápida', category: 'Membro Cibernético', price: 100, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'O braço pode ser trocado.', effects: narrative },
  { key: 'medscanner', name: 'Medscanner', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: '+2 Primeiros Socorros e Paramédico.', effects: [{ kind: 'skill', skills: ['first_aid', 'paramedic'], value: 2 }] },
  { key: 'techscanner', name: 'Techscanner', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: '+2 em Tecnologia Básica, Cibertecnologia, Eletrônica/Segurança, Armeiro e Tec. de Veículos.', effects: [{ kind: 'skill', skills: ['basic_tech', 'cybertech', 'electronics_security', 'weaponstech', 'vehicle_tech'], value: 2 }] },
  { key: 'shoulder_cam', name: 'Câmera de Ombro', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: 'Câmera retrátil.', effects: narrative },
  { key: 'popup_melee', name: 'Lâmina Popup', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: 'Arma branca escondida no braço (lâmina louva-a-deus, 3d6).', effects: [{ kind: 'weapon', name: 'Lâmina Popup', weaponClass: 'melee_heavy', damage: '3d6' }] },
  { key: 'popup_ranged', name: 'Pistola Popup', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 2, effect: 'Pistola média escondida no braço (2d6).', effects: [{ kind: 'weapon', name: 'Pistola Popup', weaponClass: 'pistol_medium', damage: '2d6' }] },
  { key: 'popup_shield', name: 'Escudo Popup', category: 'Membro Cibernético', price: 500, hl: '2d6', install: 'clinic', requires: 'cyberarm', slots: 3, effect: 'Escudo à prova de balas no braço (10 PV).', effects: narrative },
  { key: 'hardwired_deck', name: 'Ciberdeck Embutido', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 3, effect: 'Ciberdeck dentro do braço, sempre à mão.', effects: narrative },
  { key: 'grip_foot', name: 'Pé Aderente', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, paired: true, effect: 'Tração para escalar paredes.', effects: narrative },
  { key: 'jump_booster', name: 'Impulsor de Salto', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 2, paired: true, effect: 'Sem penalidades para saltar.', effects: narrative },
  { key: 'skate_foot', name: 'Pé-Patins', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, paired: true, effect: '+6 m de deslocamento correndo.', effects: narrative },
  { key: 'talon_foot', name: 'Pé-Garra', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, effect: 'Lâmina no pé: arma branca leve (1d6).', effects: [{ kind: 'weapon', name: 'Pé-Garra', weaponClass: 'melee_light', damage: '1d6' }] },
  { key: 'web_foot', name: 'Pé Palmado', category: 'Membro Cibernético', price: 500, hl: '1d6', install: 'clinic', requires: 'cyberleg', slots: 1, paired: true, effect: 'Nadar com facilidade.', effects: narrative },
  { key: 'superchrome', name: 'Revestimento SuperChrome', category: 'Membro Cibernético', price: 1000, hl: '0', install: 'mall', requires: 'cyberarm', slots: 0, effect: 'Cromo espelhado: +2 em estilo (não soma entre membros).', effects: [{ kind: 'skill', skills: ['personal_grooming'], value: 2 }] },
  { key: 'realskinn', name: 'Revestimento RealSkinn', category: 'Membro Cibernético', price: 500, hl: '0', install: 'mall', requires: 'cyberarm', slots: 0, effect: 'Parece pele de verdade.', effects: narrative },
  { key: 'hardened_shielding', name: 'Blindagem contra EMP', category: 'Membro Cibernético', price: 1000, hl: '1d6', install: 'clinic', requires: 'cyberarm', slots: 1, effect: 'O membro e suas opções ficam imunes a EMP.', effects: narrative },

  // ------------------------------------------------ Borgware
  { key: 'shoulder_mount', name: 'Montagem de Ombro Artificial', category: 'Borgware', price: 1000, hl: '4d6', install: 'hospital', borgware: true, effect: 'Um segundo par de ciberbraços (comprados à parte).', effects: [{ kind: 'slots', foundation: 'cyberarm', value: 2 }] },
  { key: 'multioptic_mount', name: 'Montagem MultiÓptica', category: 'Borgware', price: 1000, hl: '4d6', install: 'hospital', borgware: true, effect: 'Até 5 ciberolhos extras.', effects: [{ kind: 'slots', foundation: 'cybereye', value: 5 }] },
  { key: 'sensor_array', name: 'Conjunto de Sensores', category: 'Borgware', price: 1000, hl: '4d6', install: 'clinic', borgware: true, effect: '+5 slots de ciberáudio.', effects: [{ kind: 'slots', foundation: 'cyberaudio', value: 5 }] },
  { key: 'linear_frame_sigma', name: 'Estrutura Linear Σ', category: 'Borgware', price: 1000, hl: '4d6', install: 'hospital', borgware: true, effect: 'CORPO vira 12 (exige CORPO 6 e Músculo Enxertado).', effects: [{ kind: 'body_set', value: 12, minBody: 6 }] },
  { key: 'linear_frame_beta', name: 'Estrutura Linear β', category: 'Borgware', price: 5000, hl: '4d6', install: 'hospital', borgware: true, effect: 'CORPO vira 14 (exige CORPO 8 e Músculo Enxertado).', effects: [{ kind: 'body_set', value: 14, minBody: 8 }] },
];

const DEFS: CyberwareDef[] = [...RED_DEFS, ...ERA_DEFS].map(applyEra);

export const CYBERWARE: Record<string, CyberwareDef> = Object.fromEntries(DEFS.map(d => [d.key, d]));
export const CYBERWARE_KEYS = DEFS.map(d => d.key);

export const TIER_LABEL: Record<CyberTier, string> = { 1: 'Comum', 2: 'Incomum', 3: 'Raro', 4: 'Épico', 5: 'Lendário' };
export const GRADE_LABEL: Record<CyberGrade, string> = { civil: 'Civil', military: 'Militar', prototype: 'Protótipo' };

/** Níveis de ripperdoc: quem é quem na rua de 2077. */
export const RIPPERDOC_TIER_LABEL: Record<CyberTier, string> = {
  1: 'Açougueiro de beco / bio-mod de shopping',
  2: 'Ripperdoc de bairro',
  3: 'Clínica estabelecida',
  4: 'Clínica corporativa / de elite',
  5: 'Lenda do bisturi',
};

/** Confiança (ou reputação) mínima para um mercado negro vender hardware militar. */
export const MILITARY_TRUST = 40;
export const MILITARY_REPUTATION = 5;

/** Cirurgia de uma peça que você já tem (achada, recebida): cobra só o procedimento. */
export function surgeryFee(def: CyberwareDef): number {
  return 250 * def.tier * (def.install === 'hospital' ? 2 : 1);
}

export const INSTALL_LABEL: Record<InstallPlace, string> = { mall: 'Shopping (bio-mod)', clinic: 'Clínica (ripperdoc)', hospital: 'Hospital', none: 'Encaixe (chip)' };

export const FOUNDATION_LABEL: Record<FoundationKind, string> = {
  neural_link: 'Neural Link',
  cybereye: 'Ciberolho',
  cyberaudio: 'Suíte de Ciberáudio',
  cyberarm: 'Ciberbraço',
  cyberleg: 'Ciberperna',
  chip_socket: 'Soquete de Chip',
};

/** Média usada por NPCs e na criação (1d3=2, 1d6=3, 2d6=7, 4d6=14). */
export function averageLoss(hl: string): number {
  return { '0': 0, '1d3': 2, '1d6': 3, '2d6': 7, '3d6': 10, '4d6': 14 }[hl] ?? 0;
}

/** Quanto o implante baixa a Humanidade MÁXIMA (2; Borgware 4; perda 0 não baixa). */
export function maxHumanityPenalty(def: Pick<CyberwareDef, 'hl' | 'borgware'>): number {
  if (def.hl === '0') return 0;
  return def.borgware ? 4 : 2;
}

/** Busca por chave ou nome (o LLM às vezes manda o nome). */
export function findCyberware(q: string | undefined): CyberwareDef | undefined {
  if (!q) return undefined;
  const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return CYBERWARE[q] ?? DEFS.find(d => d.key === n || d.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') === n) ?? DEFS.find(d => d.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n) && n.length >= 5);
}

export const STAT_FOR_BODY: StatKey = 'BODY';
