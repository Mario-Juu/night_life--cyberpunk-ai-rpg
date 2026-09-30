/**
 * Entrada de combatentes SEM duplicatas.
 * O narrador costuma "relembrar" os inimigos da cena a cada turno (start_combat de novo) e o
 * intérprete cita alvos por apelido ("o ganger"): tudo isso tem de cair no MESMO combatente.
 */
import type { Combatant, GameState } from '../types/game';
import type { CombatantArg } from './tools/registry';
import { normalizeName } from './npcs';

const alive = (c: Combatant) => c.status !== 'dead' && c.status !== 'fled';

/**
 * Busca tolerante: id → nome exato → nome normalizado → nome contido (se único).
 * "ganger" encontra "Ganger da Maelstrom" quando só há um.
 */
export function findCombatantLoose(combatants: Combatant[], idOrName: string | undefined, opts: { includeDown?: boolean } = {}): Combatant | undefined {
  if (!idOrName) return undefined;
  const pool = combatants.filter(c => (opts.includeDown ? c.status !== 'dead' : alive(c)));
  const byId = combatants.find(c => c.id === idOrName);
  if (byId) return byId;
  const norm = normalizeName(idOrName);
  if (!norm) return undefined;
  const exact = pool.filter(c => normalizeName(c.name) === norm);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact.find(c => c.status === 'active') ?? exact[0];
  const words = norm.split(' ').filter(w => w.length >= 3);
  const partial = pool.filter(c => {
    const name = normalizeName(c.name);
    return name.includes(norm) || (words.length > 0 && words.every(w => name.includes(w)));
  });
  return partial.length === 1 ? partial[0] : undefined;
}

/** Nomes numerados para grupos ("Boosterganger 1", "Boosterganger 2"…), continuando os que já existem. */
export function numberedNames(existing: Combatant[], base: string, count: number): string[] {
  const norm = normalizeName(base);
  const used = existing
    .map(c => normalizeName(c.name))
    .filter(n => n === norm || n.startsWith(`${norm} `))
    .map(n => Number(n.slice(norm.length).trim()) || 1);
  const start = used.length ? Math.max(...used) + 1 : 1;
  if (count === 1 && !used.length) return [base];
  return Array.from({ length: count }, (_, i) => `${base} ${start + i}`);
}

/** "Ganger da Maelstrom" e "Ganger da Maelstrom 3" são do mesmo grupo. */
function inGroup(name: string, base: string): boolean {
  const n = normalizeName(name);
  const b = normalizeName(base);
  return n === b || (n.startsWith(`${b} `) && /^\d+$/.test(n.slice(b.length).trim()));
}

export interface MergeResult {
  combatants: Combatant[];
  added: Combatant[];
  /** Specs que já estavam no combate (o narrador repetiu): não duplicam. */
  reused: Combatant[];
}

/**
 * Junta novos inimigos à luta. Quem já está (mesmo id ou nome) NÃO é recriado:
 * posição/cobertura podem ser atualizadas, PV/SP nunca (só o motor mexe).
 */
export function mergeCombatants(
  current: Combatant[],
  specs: Array<CombatantArg & { count?: number }>,
  build: (spec: CombatantArg, existing: Combatant[]) => Combatant,
): MergeResult {
  let combatants = [...current];
  const added: Combatant[] = [];
  const reused: Combatant[] = [];
  const touch = (match: Combatant, spec: CombatantArg) => {
    const next = { ...match, distance: (spec.distance as Combatant['distance']) ?? match.distance, cover: (spec.cover as Combatant['cover']) ?? match.cover };
    combatants = combatants.map(c => (c.id === match.id ? next : c));
    reused.push(next);
  };
  for (const spec of specs) {
    const count = Math.max(1, Math.min(6, Math.round(spec.count ?? 1)));
    if (count === 1) {
      const same = spec.id ? combatants.find(c => c.id === spec.id) : undefined;
      const match = same ?? combatants.find(c => c.status !== 'dead' && normalizeName(c.name) === normalizeName(spec.name));
      if (match) {
        touch(match, spec);
        continue;
      }
    }
    // Grupo já na luta ("Ganger da Maelstrom 1, 2…"): o narrador repetindo "2 gangers" descreve os MESMOS.
    // Os que já existem contam para o total pedido — só entra quem faltar. Reforço de verdade = outro nome.
    const group = combatants.filter(c => !reused.some(r => r.id === c.id) && inGroup(c.name, spec.name));
    for (const member of group.slice(0, count)) if (member.status !== 'dead') touch(member, spec);
    const missing = count - group.length;
    if (missing <= 0) continue;
    for (const name of numberedNames(combatants, spec.name, missing)) {
      const c = build({ ...spec, id: count > 1 ? undefined : spec.id, name }, combatants);
      combatants.push(c);
      added.push(c);
    }
  }
  return { combatants, added, reused };
}

export const activeCount = (s: GameState) => s.combat.combatants.filter(c => c.status === 'active').length;
