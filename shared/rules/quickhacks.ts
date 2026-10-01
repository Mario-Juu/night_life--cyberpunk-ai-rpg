/**
 * Quickhacks (2077) para o Trilheiro: hacks rápidos no espaço físico, sem mergulhar numa arquitetura.
 * Árvore de 3 ramos × 4 níveis; nível 1 vem com o papel, os outros custam PM e pedem rank de Interface.
 * Teste: Interface + 1d10 contra a defesa do alvo; cada hack gasta RAM do ciberdeck.
 */
import type { Cyberdeck } from '../types/game';

export type QuickhackKey =
  | 'ping'
  | 'reboot_optics'
  | 'sonic_shock'
  | 'memory_wipe'
  | 'weapon_glitch'
  | 'cripple_movement'
  | 'cyberware_malfunction'
  | 'cyberpsychosis'
  | 'short_circuit'
  | 'overheat'
  | 'synapse_burnout'
  | 'system_collapse';

export type QuickhackBranch = 'controle' | 'hardware' | 'dano';
/** combatant = alvo em combate; none = sem alvo (área); npc = também serve num NPC fora de combate. */
export type QuickhackTarget = 'combatant' | 'none' | 'combatant_or_npc';

export interface QuickhackDef {
  key: QuickhackKey;
  name: string;
  branch: QuickhackBranch;
  tier: 1 | 2 | 3 | 4;
  ram: number;
  /** Rank mínimo de Interface. */
  minRank: number;
  /** PM para desbloquear (0 = vem com o papel). */
  ipCost: number;
  target: QuickhackTarget;
  effect: string;
}

export const BRANCH_LABEL: Record<QuickhackBranch, string> = { controle: 'Controle', hardware: 'Hardware', dano: 'Dano' };

const TIER = { 1: { minRank: 1, ipCost: 0 }, 2: { minRank: 4, ipCost: 20 }, 3: { minRank: 6, ipCost: 30 }, 4: { minRank: 8, ipCost: 50 } } as const;
const def = (key: QuickhackKey, name: string, branch: QuickhackBranch, tier: 1 | 2 | 3 | 4, ram: number, target: QuickhackTarget, effect: string): QuickhackDef => ({ key, name, branch, tier, ram, target, effect, ...TIER[tier] });

export const QUICKHACKS: Record<QuickhackKey, QuickhackDef> = {
  ping: def('ping', 'Ping', 'controle', 1, 1, 'none', 'Mapeia quem está conectado por perto: em combate, +1 para acertar todos os inimigos por 2 rodadas; fora dele, revela câmeras, dispositivos e gente escondida.'),
  reboot_optics: def('reboot_optics', 'Reiniciar Ótica', 'controle', 2, 3, 'combatant', 'O alvo fica cego: perde o próximo ataque e você tem +2 para acertá-lo por 1 rodada.'),
  sonic_shock: def('sonic_shock', 'Choque Sônico', 'controle', 3, 3, 'combatant', 'Ensurdece e desorienta: −2 nos ataques do alvo por 2 rodadas e ele não consegue pedir reforço.'),
  memory_wipe: def('memory_wipe', 'Apagar Memória', 'controle', 4, 5, 'combatant_or_npc', 'Capanga esquece o que fazia e vai embora; alvo mais duro perde o próximo ataque. Fora de combate, o NPC esquece o que sabia de você.'),
  weapon_glitch: def('weapon_glitch', 'Pane de Arma', 'hardware', 1, 2, 'combatant', 'A arma do alvo trava: ele perde o próximo ataque.'),
  cripple_movement: def('cripple_movement', 'Paralisar Movimento', 'hardware', 2, 2, 'combatant', 'Trava os membros do alvo: +2 para acertá-lo por 2 rodadas e ele não consegue fugir.'),
  cyberware_malfunction: def('cyberware_malfunction', 'Pane de Cromo', 'hardware', 3, 4, 'combatant', 'O cromo do alvo falha: −3 nos ataques dele por 3 rodadas e −2 de SP no corpo.'),
  cyberpsychosis: def('cyberpsychosis', 'Ciberpsicose', 'hardware', 4, 7, 'combatant', 'O alvo surta e ataca um aliado dele na hora; depois passa 2 rodadas fora de si.'),
  short_circuit: def('short_circuit', 'Curto-Circuito', 'dano', 1, 3, 'combatant', '2d6 de dano direto no cromo (ignora armadura).'),
  overheat: def('overheat', 'Superaquecimento', 'dano', 2, 4, 'combatant', '2d6 agora (ignora armadura) e 1d6 por rodada por 2 rodadas.'),
  synapse_burnout: def('synapse_burnout', 'Queima Sináptica', 'dano', 3, 5, 'combatant', '3d6 (ignora armadura); +2d6 se o alvo estiver com metade dos PV ou menos.'),
  system_collapse: def('system_collapse', 'Colapso do Sistema', 'dano', 4, 8, 'combatant', 'Capanga ou tenente apaga na hora (vivo); chefe leva 4d6 (ignora armadura).'),
};

export const QUICKHACK_KEYS = Object.keys(QUICKHACKS) as QuickhackKey[];
/** Nível 1 de cada ramo: vem com o papel. */
export const STARTER_QUICKHACKS: QuickhackKey[] = QUICKHACK_KEYS.filter(k => QUICKHACKS[k].tier === 1);

/** Defesa contra quickhack, pelo nível da ficha do alvo (+2 se for netrunner). */
export const QUICKHACK_DV = { mook: 8, lieutenant: 11, miniboss: 14, unknown: 10 } as const;

/** RAM do deck: base pela qualidade + metade do rank de Interface. */
export const RAM_BASE: Record<Cyberdeck['quality'], number> = { poor: 3, standard: 4, excellent: 5 };
/** RAM recuperada a cada rodada de combate (fora de combate, enche). */
export const RAM_REGEN_PER_ROUND = 2;
/** Alcance: até 50 m com linha de visão. */
export const QUICKHACK_MAX_RANGE = '26-50m';
