/**
 * Netrunning (Cyberpunk RED): arquitetura, Ações de Rede, ICE Negro, programas e desconexão.
 * Funções puras com RNG injetável — o motor decide tudo; o narrador só descreve.
 */
import type { Cyberdeck, DeckProgram, GameState, IceInstance, NetArchitecture, NetDaemon, NetDifficulty, NetFloor, NetRun, ProgramKey, StatKey } from '../types/game';
import { ANTI_ICE_PROGRAMS, DECKS, FLOOR_TABLE, ICE, LOBBY_TABLE, NET_DV, PROGRAMS, netActionsFor, type FloorSpec } from '../rules/net';
import { advanceGameTime } from '../rules/world';
import { rollD10, rollDamage, type Rng } from './dice';
import { checkPenalties, effectPenalties } from './health';
import { emit } from './events';
import { makeId } from './ids';
import { hasCyber, hasNetrunLink } from './cyberBonus';

export type NetActionKind =
  | 'pathfinder'
  | 'backdoor'
  | 'eye_dee'
  | 'control'
  | 'cloak'
  | 'virus'
  | 'slide'
  | 'zap'
  | 'program'
  | 'activate'
  | 'down'
  | 'up'
  | 'jack_out'
  | 'extinguish'
  | 'daemon';

export const NET_ACTION_KINDS: NetActionKind[] = ['pathfinder', 'backdoor', 'eye_dee', 'control', 'cloak', 'virus', 'slide', 'zap', 'program', 'activate', 'down', 'up', 'jack_out', 'extinguish', 'daemon'];

export interface NetActionInput {
  kind: NetActionKind;
  iceId?: string;
  programId?: string;
  /** Virus: o que o vírus faz (efeito duradouro). */
  virus?: string;
  dv?: number;
}

export interface NetResult {
  state: GameState;
  ok: boolean;
  lines: string[];
  error?: string;
}

const FIRE_EFFECT = 'Deck em chamas';

// ---------------------------------------------------------------- deck

export function makeProgram(key: ProgramKey): DeckProgram {
  const p = PROGRAMS[key];
  return { id: makeId('prg'), key, rez: p.rez, maxRez: p.rez };
}

/** Deck inicial do Trilheiro (RED: kit padrão). */
export function starterDeck(): Cyberdeck {
  return {
    name: DECKS.standard.name,
    quality: 'standard',
    slots: DECKS.standard.slots,
    programs: (['sword', 'banhammer', 'armor', 'worm', 'see_ya', 'eraser'] as ProgramKey[]).map(makeProgram),
  };
}

/** Trilheiro + deck + Plugues de Interface (ou deck embutido no braço). */
export const canNetrun = (s: GameState) =>
  s.character.bio.role === 'netrunner' && !!s.character.deck && (hasNetrunLink(s.character) || hasCyber(s.character, 'hardwired_deck'));
export const interfaceRank = (s: GameState) => (s.character.bio.role === 'netrunner' ? s.character.roleRank : 0);

// ---------------------------------------------------------------- arquitetura

function floorFrom(spec: FloorSpec, index: number): NetFloor {
  return spec.kind === 'ice'
    ? { index, kind: 'ice', ice: [...spec.ice], cleared: false, revealed: false }
    : { index, kind: spec.kind, dv: spec.dv, cleared: false, revealed: false };
}

export interface ArchitectureInput {
  name: string;
  accessPoint: string;
  difficulty: NetDifficulty;
  floors?: number;
  files?: string[];
  controls?: string[];
  daemon?: Pick<NetDaemon, 'name' | 'directive'>;
}

/** Gera uma arquitetura pelas tabelas do RED (3d6 andares; lobby 1d6; demais 3d6 pela dificuldade). */
export function generateArchitecture(input: ArchitectureInput, turn: number, rng: Rng): NetArchitecture {
  const count = Math.max(3, Math.min(18, Math.round(input.floors ?? rng(6) + rng(6) + rng(6))));
  const floors: NetFloor[] = [];
  for (let i = 0; i < count; i++) {
    const spec = i < 2 ? LOBBY_TABLE[rng(6)] : FLOOR_TABLE[input.difficulty][rng(6) + rng(6) + rng(6)];
    floors.push(floorFrom(spec, i));
  }
  // Alvos definidos pelo narrador (o arquivo que o jogador procura, as câmeras do prédio) ficam fundo na arquitetura.
  const place = (kind: 'file' | 'control', label: string) => {
    const free = [...floors].reverse();
    const target = free.find(f => f.kind === kind && !f.label) ?? free.find(f => f.kind !== 'ice' && !f.label && f.index >= 2) ?? free.find(f => !f.label && f.index >= 2) ?? free[0];
    floors[target.index] = { index: target.index, kind, dv: NET_DV[input.difficulty], label, cleared: false, revealed: false };
  };
  for (const label of (input.files ?? []).slice(0, 4)) place('file', label);
  for (const label of (input.controls ?? []).slice(0, 4)) place('control', label);
  return {
    id: makeId('arch'), name: input.name, accessPoint: input.accessPoint, difficulty: input.difficulty, dv: NET_DV[input.difficulty], floors, createdTurn: turn,
    daemon: input.daemon ? { ...input.daemon, alert: 0, controlledNodes: [...(input.controls ?? [])], owner: 'system' } : undefined,
  };
}

/** Rótulo curto do andar (o que o runner vê depois de revelado). */
export function describeFloor(f: NetFloor): string {
  if (!f.revealed) return '???';
  switch (f.kind) {
    case 'password':
      return `Senha${f.cleared ? ' (aberta)' : ''}`;
    case 'file':
      return `Arquivo${f.cleared ? `: ${f.label ?? 'dados'}` : ''}`;
    case 'control':
      return `Nó de controle${f.cleared ? `: ${f.label ?? 'sistemas'} (seu)` : ''}`;
    case 'ice':
      return f.cleared ? 'ICE derrotado' : `ICE Negro: ${(f.ice ?? []).map(k => ICE[k].name).join(', ')}`;
    default:
      return 'Vazio';
  }
}

// ---------------------------------------------------------------- auxiliares

function arch(s: GameState): NetArchitecture {
  return s.net.architecture!;
}
function run(s: GameState): NetRun {
  return s.net.run!;
}
function withRun(s: GameState, patch: Partial<NetRun>): GameState {
  return { ...s, net: { ...s.net, run: { ...run(s), ...patch } } };
}
function withArch(s: GameState, patch: Partial<NetArchitecture>): GameState {
  return { ...s, net: { ...s.net, architecture: { ...arch(s), ...patch } } };
}

/** Registra uma trilha de rede sem transformar automaticamente todo hack em alerta policial. */
export function addTrace(s0: GameState, amount: number, source: string): GameState {
  const prev = s0.net.trace?.level ?? 0;
  const level = Math.max(0, Math.min(5, prev + amount));
  if (level === prev) return s0;
  const s = { ...s0, net: { ...s0.net, trace: level ? { level, source, lastTurn: s0.turn } : undefined } };
  return emit(s, 'NET_ACTION', `Rastro de rede ${prev} → ${level} (${source})`, { value: level, data: { trace: true, source } });
}

function daemonReact(s0: GameState, reason: string, lines: string[]): GameState {
  const d = arch(s0).daemon;
  if (!d || d.owner !== 'system') return s0;
  const alert = Math.min(5, d.alert + 1);
  let s = withArch(s0, { daemon: { ...d, alert } });
  s = addTrace(s, 1, d.name);
  lines.push(`${d.name} detecta ${reason}: alerta ${alert}/5, rastro sobe.`);
  return s;
}
function withFloor(s: GameState, index: number, patch: Partial<NetFloor>): GameState {
  return withArch(s, { floors: arch(s).floors.map(f => (f.index === index ? { ...f, ...patch } : f)) });
}
function withPrograms(s: GameState, fn: (p: DeckProgram) => DeckProgram): GameState {
  const deck = s.character.deck;
  if (!deck) return s;
  return { ...s, character: { ...s.character, deck: { ...deck, programs: deck.programs.map(fn) } } };
}
const activeProgram = (s: GameState, key: ProgramKey) => (s.character.deck?.programs ?? []).find(p => p.key === key && p.active && !p.destroyed && p.rez > 0);

/** Interface + 1d10 + bônus, com penalidades (ferimentos, Liche…). Vale o 10/1 explosivo do RED. */
function interfaceRoll(s: GameState, bonus: number, rng: Rng): { total: number; text: string } {
  const d = rollD10(rng);
  const rank = interfaceRank(s);
  const pen = [...checkPenalties(s.character, 'INT'), ...effectPenalties(s.activeEffects, 'INT')].reduce((n, m) => n + m.value, 0);
  const total = rank + d.total + bonus + pen;
  const parts = [`Interface ${rank}`, `d10 ${d.rolls.join('/')}`, bonus ? `${bonus > 0 ? '+' : ''}${bonus}` : '', pen ? `${pen}` : ''].filter(Boolean);
  return { total, text: `${parts.join(' + ').replace(/\+ -/g, '− ')} = ${total}` };
}

function addEffect(s: GameState, name: string, penalties: Partial<Record<StatKey | 'all', number>>, minutes: number | null, description: string): GameState {
  const effect = { id: makeId('eff'), name, source: 'net', description, penalties, expiresAt: minutes ? advanceGameTime(s.world.time, minutes) : null };
  return emit({ ...s, activeEffects: [...s.activeEffects.filter(e => e.name !== name), effect] }, 'EFFECT_ADDED', name, { target: effect.id, data: penalties });
}

/** Dano cerebral: direto nos PV, ignora armadura, não causa Ferimento Crítico. Armor (defensor) reduz 4 uma vez. */
function brainDamage(s0: GameState, amount: number, source: string, lines: string[]): GameState {
  let s = s0;
  let dmg = amount;
  const armor = (s.character.deck?.programs ?? []).find(p => p.key === 'armor' && p.active && !p.spent && !p.destroyed);
  if (armor && dmg > 0) {
    dmg = Math.max(0, dmg - 4);
    s = withPrograms(s, p => (p.id === armor.id ? { ...p, spent: true } : p));
    lines.push(`Armor absorve 4.`);
  }
  if (dmg <= 0) return s;
  const c = s.character;
  const hp = Math.max(0, c.hp.current - dmg);
  const character = { ...c, hp: { ...c.hp, current: hp }, stabilized: hp > 0 ? c.stabilized : false, deathSavePenalty: c.hp.current <= 0 ? c.deathSavePenalty + 1 : c.deathSavePenalty };
  lines.push(`Dano cerebral: −${dmg} PV (${c.hp.current} → ${hp}).`);
  return emit({ ...s, character }, 'DAMAGE_TAKEN', `−${dmg} PV (dano cerebral: ${source})`, { source, target: 'player', value: dmg, data: { brain: true } });
}

function randomIndex(n: number, rng: Rng): number {
  return rng(n) - 1;
}

/** Efeito de um ICE que acertou o runner (ou que foi deixado para trás numa desconexão insegura). */
function iceEffect(s0: GameState, inst: IceInstance, rng: Rng, lines: string[], allowForcedJackOut = true): GameState {
  let s = s0;
  const ice = ICE[inst.key];
  const deck = s.character.deck;
  const alive = (deck?.programs ?? []).filter(p => !p.destroyed);
  switch (inst.key) {
    case 'asp': {
      if (!alive.length) break;
      const p = alive[randomIndex(alive.length, rng)];
      s = withPrograms(s, x => (x.id === p.id ? { ...x, destroyed: true, active: false, rez: 0 } : x));
      lines.push(`${ice.name} destrói ${PROGRAMS[p.key].name}.`);
      break;
    }
    case 'giant':
      s = brainDamage(s, rollDamage('3d6', rng).total, ice.name, lines);
      if (allowForcedJackOut && s.net.run) {
        lines.push(`${ice.name} arranca você da Rede à força!`);
        s = unsafeJackOut(s, rng, lines, inst.id);
      }
      break;
    case 'hellhound':
      s = brainDamage(s, rollDamage('2d6', rng).total, ice.name, lines);
      s = addEffect(s, FIRE_EFFECT, {}, null, 'O deck e a roupa pegam fogo: 2 PV no fim de cada turno até apagar (Ação de Carne).');
      lines.push('O deck pega fogo!');
      break;
    case 'kraken':
      s = brainDamage(s, rollDamage('3d6', rng).total, ice.name, lines);
      if (s.net.run) s = withRun(s, { lockedUntil: run(s).netTurn + 1 });
      lines.push('Kraken te prende: sem descer nem sair com segurança até o fim do próximo turno.');
      break;
    case 'liche': {
      const [i, r, d] = [rng(6), rng(6), rng(6)];
      s = addEffect(s, 'Liche', { INT: -i, REF: -r, DEX: -d }, 60, 'Neurotoxina digital: INT, REF e DEX reduzidos por 1 hora.');
      lines.push(`Liche: INT −${i}, REF −${r}, DEX −${d} por 1 hora.`);
      break;
    }
    case 'raven': {
      const def = alive.find(p => PROGRAMS[p.key].class === 'defender' && p.active);
      if (def) {
        s = withPrograms(s, x => (x.id === def.id ? { ...x, active: false, rez: 0 } : x));
        lines.push(`Raven derreza ${PROGRAMS[def.key].name}.`);
      }
      s = brainDamage(s, rng(6), ice.name, lines);
      break;
    }
    case 'scorpion': {
      const m = rng(6);
      s = addEffect(s, 'Scorpion', { MOVE: -m }, 60, 'MOVE reduzido por 1 hora.');
      lines.push(`Scorpion: MOVE −${m} por 1 hora.`);
      break;
    }
    case 'skunk':
      if (s.net.run) s = withRun(s, { ice: run(s).ice.map(x => (x.id === inst.id ? { ...x, hitPlayer: true } : x)) });
      lines.push('Skunk: −2 em Slide enquanto ele existir.');
      break;
    case 'wisp':
      s = brainDamage(s, rng(6), ice.name, lines);
      if (s.net.run) s = withRun(s, { actionPenalty: run(s).actionPenalty + 1 });
      lines.push('Wisp: −1 Ação de Rede no próximo turno.');
      break;
    case 'dragon':
    case 'killer':
    case 'sabertooth': {
      const targets = alive.filter(p => p.active && p.rez > 0);
      if (!targets.length) {
        lines.push(`${ice.name} não encontra programas rezzados para atacar.`);
        break;
      }
      const p = targets[randomIndex(targets.length, rng)];
      const dmg = rollDamage(inst.key === 'killer' ? '4d6' : '6d6', rng).total;
      const destroyed = p.rez - dmg <= 0;
      s = withPrograms(s, x => (x.id === p.id ? { ...x, rez: Math.max(0, x.rez - dmg), destroyed: destroyed || x.destroyed, active: destroyed ? false : x.active } : x));
      lines.push(`${ice.name} causa ${dmg} em ${PROGRAMS[p.key].name}${destroyed ? ' — DESTRUÍDO' : ''}.`);
      break;
    }
  }
  return s;
}

/** Ataque de um ICE: ATK + 1d10 contra Interface + 1d10 do runner. */
function iceAttack(s0: GameState, inst: IceInstance, rng: Rng, lines: string[]): GameState {
  const ice = ICE[inst.key];
  const atk = ice.atk + rng(10);
  const def = interfaceRoll(s0, 0, rng);
  if (atk <= def.total) {
    lines.push(`${ice.name} ataca (${atk}) e você defende (${def.text}).`);
    return s0;
  }
  lines.push(`${ice.name} ataca (${atk}) e passa pela sua defesa (${def.text}).`);
  return iceEffect(s0, inst, rng, lines);
}

function syncIceFloor(s: GameState, floorIndex: number): GameState {
  const floor = arch(s).floors[floorIndex];
  if (floor?.kind !== 'ice' || floor.cleared) return s;
  const spawned = run(s).ice.filter(i => i.id.startsWith(`ice_${floorIndex}_`));
  if (spawned.length && spawned.every(i => i.rez <= 0)) return withFloor(s, floorIndex, { cleared: true });
  return s;
}

/** Entra num andar: revela; ICE Negro rezza e faz o teste de velocidade (se vencer, ataca na hora). */
function enterFloor(s0: GameState, index: number, rng: Rng, lines: string[]): GameState {
  let s = withFloor(s0, index, { revealed: true });
  s = withRun(s, { position: index, ice: run(s).ice.map(i => (i.following && i.rez > 0 ? { ...i, floor: index } : i)) });
  const floor = arch(s).floors[index];
  lines.push(`Andar ${index + 1}: ${describeFloor(floor)}.`);
  if (floor.kind !== 'ice' || floor.cleared) return s;
  const existing = run(s).ice.filter(i => i.id.startsWith(`ice_${index}_`));
  if (existing.length) return s;
  const fresh: IceInstance[] = (floor.ice ?? []).map((key, n) => ({ id: `ice_${index}_${n}`, key, floor: index, rez: ICE[key].rez, maxRez: ICE[key].rez, following: true }));
  s = withRun(s, { ice: [...run(s).ice, ...fresh] });
  s = emit(s, 'NET_ACTION', `ICE Negro rezza: ${fresh.map(i => ICE[i.key].name).join(', ')}`, { data: { floor: index } });
  for (const inst of fresh) {
    const speedy = activeProgram(s, 'speedy_gonzalvez') ? 2 : 0;
    const me = interfaceRoll(s, speedy, rng);
    const it = ICE[inst.key].spd + rng(10);
    if (it > me.total) {
      lines.push(`${ICE[inst.key].name} é mais rápido (${it} × ${me.total}) e ataca primeiro!`);
      s = iceAttack(s, inst, rng, lines);
      if (!s.net.run) return s;
    } else {
      lines.push(`Você reage antes de ${ICE[inst.key].name} (${me.total} × ${it}).`);
    }
  }
  return s;
}

// ---------------------------------------------------------------- conexão

export function jackIn(s0: GameState, rng: Rng): NetResult {
  if (!canNetrun(s0))
    return {
      state: s0,
      ok: false,
      lines: [],
      error:
        s0.character.bio.role !== 'netrunner'
          ? 'Só um Trilheiro entra na Rede (Interface é a Habilidade de Papel do Trilheiro).'
          : !s0.character.deck
            ? 'Sem ciberdeck.'
            : 'Sem Plugues de Interface (Neural Link + Plugues) não há como conectar o deck.',
    };
  if (!s0.net.architecture) return { state: s0, ok: false, lines: [], error: 'Não há ponto de acesso/arquitetura ao alcance (≤6 m). O Mestre ainda não revelou uma rede aqui.' };
  if (s0.net.run) return { state: s0, ok: false, lines: [], error: 'Você já está conectado.' };
  if (s0.character.dead) return { state: s0, ok: false, lines: [], error: 'O personagem está morto.' };
  const lines: string[] = [`Conexão (1 Ação de Rede) em ${s0.net.architecture.name}.`];
  // Programas derrezados voltam; destruídos não.
  let s = withPrograms(s0, p => (p.destroyed ? p : { ...p, rez: p.maxRez, active: false, spent: false }));
  const max = netActionsFor(s.character.roleRank);
  const newRun: NetRun = { architectureId: s.net.architecture!.id, position: 0, actionsLeft: max - 1, netTurn: 1, ice: [], slideUsed: false, skunkPenalty: 0, actionPenalty: 0, cloaked: false, log: [] };
  s = { ...s, net: { ...s.net, run: newRun } };
  s = emit(s, 'NET_JACK_IN', `Conectou em ${s.net.architecture!.name}`, { data: { architectureId: newRun.architectureId } });
  s = enterFloor(s, 0, rng, lines);
  return { state: s, ok: true, lines };
}

function endRun(s0: GameState, reason: string, lines: string[], reset: boolean): GameState {
  let s: GameState = { ...s0, net: { ...s0.net, run: null } };
  if (reset && s.net.architecture) {
    // A arquitetura se recompõe (senhas e ICE voltam); o que foi baixado continua com você.
    s = withArch(s, { floors: arch(s).floors.map(f => ({ ...f, cleared: f.kind === 'file' ? f.cleared : false })) });
  }
  lines.push(reason);
  return emit(s, 'NET_JACK_OUT', reason);
}

/**
 * O jogador se afastou do ponto de acesso (foi embora, mudou de lugar): a arquitetura some do painel.
 * Ainda conectado? Sair do alcance derruba a conexão — desconexão INSEGURA (o ICE rezzado cobra).
 */
export function leaveAccessPoint(s0: GameState, rng: Rng, reason = 'Afastou-se do ponto de acesso'): GameState {
  if (!s0.net.architecture) return s0;
  const lines: string[] = [];
  let s = s0.net.run ? unsafeJackOut(s0, rng, lines) : s0;
  const name = s0.net.architecture.name;
  s = { ...s, net: { ...s.net, run: null, architecture: null } };
  return emit(s, 'SCENE_CHANGED', `${reason}: ${name} fora de alcance${lines.length ? ` (${lines.join(' ')})` : ''}`, { data: { architectureId: s0.net.architecture.id } });
}

/** Desconexão insegura: todo ICE rezzado encontrado aplica o efeito. */
export function unsafeJackOut(s0: GameState, rng: Rng, lines: string[], skipIceId?: string): GameState {
  if (!s0.net.run) return s0;
  let s = s0;
  const rezzed = run(s).ice.filter(i => i.rez > 0 && i.id !== skipIceId);
  s = endRun(s, 'Desconexão INSEGURA.', lines, true);
  for (const inst of rezzed) {
    lines.push(`${ICE[inst.key].name} te atinge na saída.`);
    s = iceEffect(s, inst, rng, lines, false);
  }
  return s;
}

// ---------------------------------------------------------------- ações

function spend(s: GameState, n = 1): GameState {
  return withRun(s, { actionsLeft: run(s).actionsLeft - n });
}

function targetIce(s: GameState, iceId?: string): IceInstance | undefined {
  const r = run(s);
  const here = r.ice.filter(i => i.rez > 0 && (i.following || i.floor === r.position));
  return (iceId ? here.find(i => i.id === iceId) : undefined) ?? here[0];
}

/** Executa uma Ação de Rede. Não encerra o turno (use endNetTurn). */
export function netAction(s0: GameState, input: NetActionInput, rng: Rng): NetResult {
  const fail = (error: string): NetResult => ({ state: s0, ok: false, lines: [], error });
  if (!s0.net.run || !s0.net.architecture) return fail('Você não está conectado à Rede — conecte-se primeiro.');
  const r = run(s0);
  const a = arch(s0);
  const floor = a.floors[r.position];
  const lines: string[] = [];
  const meat = input.kind === 'extinguish';
  if (!meat && r.actionsLeft <= 0) return fail('Sem Ações de Rede neste turno — encerre o turno.');
  let s = s0;

  switch (input.kind) {
    case 'pathfinder': {
      const roll = interfaceRoll(s, activeProgram(s, 'see_ya') ? 2 : 0, rng);
      let revealed = 0;
      for (let i = r.position + 1; i < a.floors.length; i++) {
        const f = arch(s).floors[i];
        if (f.dv !== undefined && f.dv > roll.total && !f.revealed) break;
        s = withFloor(s, i, { revealed: true });
        revealed++;
      }
      lines.push(`Pathfinder (${roll.text}): ${revealed ? `${revealed} andar(es) mapeado(s)` : 'nada além daqui'}.`);
      break;
    }
    case 'backdoor': {
      if (floor.kind !== 'password' || floor.cleared) return fail('Não há senha fechada neste andar.');
      const roll = interfaceRoll(s, activeProgram(s, 'worm') ? 2 : 0, rng);
      const ok = roll.total > (floor.dv ?? a.dv);
      if (ok) s = withFloor(s, floor.index, { cleared: true });
      if (!ok || arch(s).daemon?.controlledNodes.includes(`senha:${floor.index + 1}`)) s = daemonReact(s, 'a tentativa de Backdoor', lines);
      lines.push(`Backdoor (${roll.text}): ${ok ? 'senha quebrada' : 'a senha resiste'}.`);
      break;
    }
    case 'eye_dee': {
      if (floor.kind !== 'file' || floor.cleared) return fail('Não há arquivo a identificar neste andar.');
      const roll = interfaceRoll(s, 0, rng);
      const ok = roll.total > (floor.dv ?? a.dv);
      if (ok) {
        const label = floor.label ?? 'dados corporativos';
        s = withFloor(s, floor.index, { cleared: true, downloaded: true });
        const shard = { id: makeId('item'), name: `Arquivo: ${label}`, category: 'datashard' as const, quantity: 1, description: `Baixado de ${a.name}.` };
        s = { ...s, character: { ...s.character, inventory: [...s.character.inventory, shard] } };
        s = emit(s, 'ITEM_ACQUIRED', `Arquivo baixado: ${label}`, { target: shard.id });
      }
      lines.push(`Eye-Dee (${roll.text}): ${ok ? `arquivo identificado e baixado — ${floor.label ?? 'dados corporativos'}` : 'o arquivo não se deixa ler'}.`);
      break;
    }
    case 'control': {
      if (floor.kind !== 'control' || floor.cleared) return fail('Não há nó de controle livre neste andar.');
      const roll = interfaceRoll(s, 0, rng);
      const ok = roll.total > (floor.dv ?? a.dv);
      if (ok) s = withFloor(s, floor.index, { cleared: true });
      if (!ok || arch(s).daemon?.controlledNodes.includes(floor.label ?? '')) s = daemonReact(s, `a disputa por ${floor.label ?? 'um nó'}`, lines);
      lines.push(`Controle (${roll.text}): ${ok ? `você controla ${floor.label ?? 'os sistemas deste nó'}` : 'o nó rejeita o comando'}.`);
      break;
    }
    case 'cloak': {
      const roll = interfaceRoll(s, activeProgram(s, 'eraser') ? 2 : 0, rng);
      const ok = roll.total > a.dv;
      if (ok) {
        s = withRun(s, { cloaked: true });
        s = addTrace(s, -2, 'Cloak');
      }
      lines.push(`Cloak (${roll.text}): ${ok ? 'rastros apagados' : 'rastros continuam expostos'}.`);
      break;
    }
    case 'virus': {
      if (r.position !== a.floors.length - 1) return fail('Vírus só pode ser plantado no andar mais fundo.');
      const dv = Math.max(6, Math.min(24, Math.round(input.dv ?? a.dv + 4)));
      const roll = interfaceRoll(s, 0, rng);
      const ok = roll.total > dv;
      if (ok) s = withArch(s, { virus: input.virus ?? 'vírus plantado' });
      lines.push(`Vírus (${roll.text}): ${ok ? `plantado — ${input.virus ?? 'efeito duradouro'}` : 'o sistema rejeita o vírus'}.`);
      break;
    }
    case 'daemon': {
      if (r.position !== a.floors.length - 1) return fail('Um daemon persistente só pode ser plantado no andar mais fundo.');
      const directive = input.virus?.trim();
      if (!directive) return fail('Diga em uma frase o que o daemon deve proteger, vigiar ou sabotar.');
      const roll = interfaceRoll(s, 0, rng);
      const ok = roll.total > Math.max(10, a.dv + 2);
      if (ok) s = withArch(s, { daemon: { name: 'Daemon do runner', directive, alert: 0, controlledNodes: arch(s).floors.filter(f => f.kind === 'control' && f.cleared).map(f => f.label ?? `nó ${f.index + 1}`), owner: 'player' } });
      lines.push(`Daemon (${roll.text}): ${ok ? 'agente persistente instalado' : 'o sistema rejeita o agente'}.`);
      break;
    }
    case 'slide': {
      const followers = r.ice.filter(i => i.rez > 0 && i.following);
      if (!followers.length) return fail('Nenhum ICE te perseguindo.');
      if (r.slideUsed) return fail('Slide só uma vez por turno.');
      const skunk = r.ice.filter(i => i.key === 'skunk' && i.rez > 0 && i.hitPlayer).length * 2;
      const roll = interfaceRoll(s, -skunk, rng);
      const best = Math.max(...followers.map(i => ICE[i.key].per + rng(10)));
      const ok = roll.total > best;
      const dest = r.position > 0 ? r.position - 1 : arch(s).floors[r.position].kind === 'password' && !arch(s).floors[r.position].cleared ? null : r.position + 1 < a.floors.length ? r.position + 1 : null;
      s = withRun(s, { slideUsed: true });
      if (ok && dest !== null) {
        s = withRun(s, { ice: run(s).ice.map(i => (i.following ? { ...i, following: false } : i)) });
        lines.push(`Slide (${roll.text} × ${best}): você escorrega para o andar ${dest + 1} e o ICE perde seu rastro.`);
        s = spend(s);
        s = enterFloor(s, dest, rng, lines);
        return { state: s, ok: true, lines };
      }
      lines.push(`Slide (${roll.text} × ${best}): ${dest === null ? 'sem andar adjacente livre' : 'o ICE continua colado em você'}.`);
      break;
    }
    case 'zap': {
      const ice = targetIce(s, input.iceId);
      if (!ice) return fail('Nenhum ICE ao alcance para Zap.');
      const roll = interfaceRoll(s, 0, rng);
      const def = ICE[ice.key].def + rng(10);
      if (roll.total > def) {
        const dmg = rng(6);
        s = damageIce(s, ice.id, dmg, lines);
        lines.push(`Zap (${roll.text} × ${def}): ${dmg} de REZ em ${ICE[ice.key].name}.`);
      } else lines.push(`Zap (${roll.text} × ${def}): ${ICE[ice.key].name} desvia.`);
      break;
    }
    case 'program': {
      const prog = (s.character.deck?.programs ?? []).find(p => p.id === input.programId || p.key === input.programId);
      if (!prog || prog.destroyed) return fail('Programa indisponível no deck.');
      const prof = PROGRAMS[prog.key];
      if (prof.class !== 'attacker') return fail(`${prof.name} não é um programa de ataque (rezze-o em vez de atacar).`);
      if (!ANTI_ICE_PROGRAMS.includes(prog.key)) return fail(`${prof.name} só funciona contra runners inimigos, não contra ICE Negro.`);
      const ice = targetIce(s, input.iceId);
      if (!ice) return fail('Nenhum ICE ao alcance.');
      const roll = interfaceRoll(s, prof.atk, rng);
      const def = ICE[ice.key].def + rng(10);
      if (roll.total > def) {
        const dmg = rollDamage(prog.key === 'sword' ? '3d6' : '2d6', rng).total;
        s = damageIce(s, ice.id, dmg, lines);
        lines.push(`${prof.name} (${roll.text} × ${def}): ${dmg} de REZ em ${ICE[ice.key].name}.`);
      } else lines.push(`${prof.name} (${roll.text} × ${def}): ${ICE[ice.key].name} resiste.`);
      break;
    }
    case 'activate': {
      const prog = (s.character.deck?.programs ?? []).find(p => p.id === input.programId || p.key === input.programId);
      if (!prog || prog.destroyed || prog.rez <= 0) return fail('Programa indisponível.');
      const prof = PROGRAMS[prog.key];
      if (prof.class === 'attacker') return fail(`${prof.name} é de ataque: use-o contra o ICE.`);
      if (prog.active) return fail(`${prof.name} já está rodando.`);
      if (prof.class === 'defender' && (s.character.deck?.programs ?? []).some(p => p.key === prog.key && p.active)) return fail(`Só uma cópia de ${prof.name} por vez.`);
      s = withPrograms(s, p => (p.id === prog.id ? { ...p, active: true } : p));
      lines.push(`${prof.name} rezzado: ${prof.effect}`);
      break;
    }
    case 'down': {
      if (r.lockedUntil !== undefined && r.netTurn <= r.lockedUntil) return fail('Você está preso (Kraken/Superglue): não dá para descer agora.');
      if (floor.kind === 'password' && !floor.cleared) return fail('A senha deste andar bloqueia a descida — use Backdoor.');
      if (r.position + 1 >= a.floors.length) return fail('Este é o andar mais fundo.');
      s = spend(s);
      s = enterFloor(s, r.position + 1, rng, lines);
      return { state: s, ok: true, lines };
    }
    case 'up': {
      if (r.position === 0) return fail('Você já está no primeiro andar.');
      s = spend(s);
      s = enterFloor(s, r.position - 1, rng, lines);
      return { state: s, ok: true, lines };
    }
    case 'jack_out': {
      if (r.lockedUntil !== undefined && r.netTurn <= r.lockedUntil) return fail('Preso pelo Kraken/Superglue: sair agora seria uma desconexão insegura.');
      s = spend(s);
      s = endRun(s, 'Desconexão segura.', lines, true);
      return { state: s, ok: true, lines };
    }
    case 'extinguish': {
      if (!s.activeEffects.some(e => e.name === FIRE_EFFECT)) return fail('Nada pegando fogo.');
      s = { ...s, activeEffects: s.activeEffects.filter(e => e.name !== FIRE_EFFECT) };
      s = withRun(s, { actionsLeft: 0 });
      lines.push('Você gasta o turno (Ação de Carne) apagando o fogo do deck.');
      return { state: s, ok: true, lines };
    }
  }
  s = spend(s);
  return { state: s, ok: true, lines };
}

function damageIce(s0: GameState, iceId: string, dmg: number, lines: string[]): GameState {
  const inst = run(s0).ice.find(i => i.id === iceId)!;
  const rez = Math.max(0, inst.rez - dmg);
  let s = withRun(s0, { ice: run(s0).ice.map(i => (i.id === iceId ? { ...i, rez, following: rez > 0 && i.following } : i)) });
  if (rez <= 0) {
    lines.push(`${ICE[inst.key].name} DERREZADO.`);
    s = emit(s, 'NET_ACTION', `${ICE[inst.key].name} derrezado`, { target: iceId });
    s = syncIceFloor(s, inst.floor);
    // O ICE derrezado pode ter vindo de outro andar.
    s = syncIceFloor(s, Number(iceId.split('_')[1]));
  }
  return s;
}

/**
 * Fim do turno na Rede: fogo queima, ICE ativo ataca, novo turno com Ações de Rede renovadas.
 */
export function endNetTurn(s0: GameState, rng: Rng): { state: GameState; lines: string[] } {
  if (!s0.net.run) return { state: s0, lines: [] };
  const lines: string[] = [];
  let s = s0;
  const daemon = s.net.architecture?.daemon;
  if (daemon?.owner === 'system' && daemon.alert >= 2) {
    s = addTrace(s, 1, daemon.name);
    lines.push(`${daemon.name} varre a intrusão: rastro ${s.net.trace?.level ?? 0}/5.`);
  }
  if (s.activeEffects.some(e => e.name === FIRE_EFFECT)) {
    const c = s.character;
    const hp = Math.max(0, c.hp.current - 2);
    s = emit({ ...s, character: { ...c, hp: { ...c.hp, current: hp } } }, 'DAMAGE_TAKEN', '−2 PV (deck em chamas)', { target: 'player', value: 2 });
    lines.push(`O fogo do deck queima: −2 PV (${c.hp.current} → ${hp}).`);
  }
  for (const inst of run(s).ice) {
    if (!s.net.run) break;
    const cur = run(s).ice.find(i => i.id === inst.id)!;
    if (cur.rez <= 0 || !(cur.following || cur.floor === run(s).position)) continue;
    s = iceAttack(s, cur, rng, lines);
  }
  if (s.net.run) {
    const base = netActionsFor(s.character.roleRank);
    const actions = Math.max(Math.min(base, 2), base - run(s).actionPenalty);
    s = withRun(s, { netTurn: run(s).netTurn + 1, actionsLeft: actions, actionPenalty: 0, slideUsed: false, log: [] });
  }
  return { state: s, lines };
}

/** Resumo para o narrador e para a UI. */
export function describeNet(s: Pick<GameState, 'net'>): string[] {
  const a = s.net.architecture;
  if (!a) return [];
  const r = s.net.run;
  const out = [`REDE: ${a.name} (${a.accessPoint}) · dificuldade ${a.difficulty} · ${a.floors.length} andares${a.virus ? ` · vírus: ${a.virus}` : ''}${a.daemon ? ` · daemon ${a.daemon.name} (${a.daemon.owner}, alerta ${a.daemon.alert}/5)` : ''}${s.net.trace ? ` · rastro ${s.net.trace.level}/5` : ''}`];
  if (!r) {
    out.push('  (jogador desconectado)');
    return out;
  }
  out.push(`  CONECTADO · andar ${r.position + 1}/${a.floors.length} · Ações de Rede ${r.actionsLeft} · turno de Rede ${r.netTurn}${r.cloaked ? ' · rastros apagados' : ''}`);
  out.push(`  Andares: ${a.floors.map(f => `${f.index + 1}:${describeFloor(f)}`).join(' | ')}`);
  const ice = r.ice.filter(i => i.rez > 0);
  if (ice.length) out.push(`  ICE ativo: ${ice.map(i => `[${i.id}] ${ICE[i.key].name} REZ ${i.rez}/${i.maxRez}${i.following ? ' (perseguindo)' : ''}`).join(', ')}`);
  return out;
}
