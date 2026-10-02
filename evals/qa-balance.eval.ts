/**
 * QA-BAL: sanidade de balanceamento (dificuldade e economia) por Monte Carlo no motor real, sem LLM.
 *
 * Não é uma suíte de "design aprovado": as faixas são folgadas e DOCUMENTAM o comportamento medido na
 * auditoria de balanceamento (seed fixa, números no relatório). Se uma mudança de regras mexer de
 * verdade no equilíbrio, estes testes falham de propósito para obrigar a reler os números.
 * Os `it.skip` descrevem o comportamento DESEJADO de problemas conhecidos (ligue-os ao corrigir).
 */
import { describe, expect, it } from 'vitest';
import { scenario } from './harness';
import { STAT_PRESETS, buildCharacter, ROLES } from '../shared/rules/creation';
import { createInitialState } from '../shared/engine/initialState';
import { REGISTRY, runToolCalls } from '../shared/engine/tools';
import { rollD10, rollDamage, seededRng, type Rng } from '../shared/engine/dice';
import { resolveCheck } from '../shared/engine/checks';
import { buildAttackRequest, attackBlocker, getPlayerWeapon, activeEnemies } from '../shared/engine/combat';
import { resolveRoll } from '../shared/engine/rolls';
import { gameReducer } from '../shared/engine/reducer';
import { runEnemyPhase } from '../shared/engine/initiative';
import { computeDamage } from '../shared/engine/health';
import { getSkill } from '../shared/rules/skills';
import { NPC_TEMPLATES } from '../shared/rules/npcTemplates';
import { WEAPONS } from '../shared/rules/weapons';
import { MERCHANT_CATALOG } from '../shared/rules/merchantCatalog';
import { CYBERWARE, surgeryFee, averageLoss } from '../shared/rules/cyberware';
import { marketCyberPrice, startChase } from '../shared/engine/citySystems';
import { QUICKHACK_DV, RAM_REGEN_PER_ROUND } from '../shared/rules/quickhacks';
import { ramMax } from '../shared/engine/quickhacks';
import { NET_MIN_INTERFACE } from '../shared/rules/net';
import { generateArchitecture, jackIn, netAction, endNetTurn } from '../shared/engine/net';
import { advanceTime } from '../shared/engine/world';
import { buildCombatant } from '../shared/engine/tools/helpers';
import { skillUpgradeCost } from '../shared/rules/skills';
import { roleUpgradeCost } from '../shared/rules/roles';
import type { Character, Combatant, GameState, RoleId } from '../shared/types/game';

const stats = (id: string) => ({ ...STAT_PRESETS.find(p => p.id === id)!.stats });
const make = (role: RoleId, preset: string, weapon = 'revolver'): Character =>
  buildCharacter({ name: 'QA', handle: 'QA', age: 25, role, occupation: 'x', district: 'HEYWOOD', familyTie: 'x', debtReason: 'x', personalAnchor: 'x', appearance: '', stats: stats(preset), starterWeaponId: weapon });
const withJacket = (c: Character, sp: number): Character => ({ ...c, inventory: c.inventory.map(i => (i.id === 'item_starter_jacket' ? { ...i, armor: { slot: 'body' as const, sp, maxSp: sp } } : i)) });

// ---------------------------------------------------------------- testes de perícia
const chance = (c: Character, skillId: string, dv: number, luck: number, seed: string, n = 20000) => {
  const rng = seededRng(seed);
  const sk = getSkill(skillId)!;
  let ok = 0;
  for (let i = 0; i < n; i++) if (resolveCheck(c, { stat: sk.stat, skillId, dv, luckSpent: luck }, rng).success) ok++;
  return ok / n;
};

describe('QA-BAL 1: testes de perícia (RED: STAT + perícia + 1d10 explosivo > DV)', () => {
  it('a melhor perícia de cada papel recém-criado passa o DV 13 (cotidiano) com folga; o DV 21 continua sendo façanha', () => {
    for (const role of ROLES.map(r => r.id as RoleId)) {
      const c = make(role, role === 'medtech' ? 'balanced' : role === 'fixer' ? 'social' : role === 'solo' || role === 'nomad' ? 'reflex' : 'brains');
      const pack = Object.entries(ROLES.find(r => r.id === role)!.skills);
      const best = pack.map(([id, lv]) => ({ id, base: c.stats[getSkill(id)!.stat] + lv })).sort((a, b) => b.base - a.base)[0];
      expect(chance(c, best.id, 13, 0, `p13:${role}`, 6000), `${role}/${best.id}`).toBeGreaterThan(0.75);
      expect(chance(c, best.id, 21, 0, `p21:${role}`, 6000), `${role}/${best.id}`).toBeLessThan(0.75);
    }
  });

  it('perícia básica sem treino de especialista (base ~7-9) falha mais do que acerta no DV 15', () => {
    const c = make('fixer', 'social');
    // brawling: DEX5 + 2
    expect(chance(c, 'brawling', 15, 0, 'basic15', 8000)).toBeLessThan(0.3);
    expect(chance(c, 'brawling', 9, 0, 'basic9', 8000)).toBeGreaterThan(0.7);
  });

  it('cada ponto de Sorte vale ~+10 pontos percentuais no meio da curva', () => {
    const c = make('solo', 'reflex');
    const base = { ...c, skills: { ...c.skills, handgun: 2 } }; // REF8 + 2 = 10
    const p0 = chance(base, 'handgun', 15, 0, 'luck0', 12000);
    const p3 = chance(base, 'handgun', 15, 3, 'luck3', 12000);
    expect(p3 - p0).toBeGreaterThan(0.22);
    expect(p3 - p0).toBeLessThan(0.38);
  });
});

// ---------------------------------------------------------------- combate
const FOE_SEED = 'qa-bal-fight';
function fight(c: Character, foes: Array<{ template: string; count?: number }>, rng: Rng, opts: { ally?: string; allies?: number; playerInit?: number } = {}): { win: boolean; dead: boolean; hpLostFrac: number } {
  let s: GameState = createInitialState(c);
  s = runToolCalls(REGISTRY, s, [{ tool: 'start_combat', args: { combatants: foes.map(f => ({ template: f.template, count: f.count ?? 1, distance: '7-12m' })) } }], { rng, origin: 'narrator' }).state;
  if (opts.ally) {
    const mk = (i: number): Combatant => ({ ...buildCombatant({ name: `Merc ${i + 1}`, template: opts.ally!, side: 'ally' } as never, s.combat.combatants), id: `ally_${i}`, distance: '0-6m' as const });
    s = { ...s, combat: { ...s.combat, combatants: [...s.combat.combatants, ...Array.from({ length: opts.allies ?? 1 }, (_, i) => mk(i))] } };
  }
  if (opts.playerInit !== undefined) s = { ...s, combat: { ...s.combat, playerInitiative: opts.playerInit } };
  const hp0 = s.character.hp.current;
  for (let round = 0; round < 25 && !s.character.dead; round++) {
    const enemies = activeEnemies(s.combat);
    if (!enemies.length) break;
    if (s.character.hp.current > 0) {
      const w = getPlayerWeapon(s.character, null);
      const target = [...enemies].sort((a, b) => a.hp.current - b.hp.current)[0];
      const blocker = attackBlocker(s.character, w, target, {});
      if (blocker && /descarregada|TRAVADA/.test(blocker)) s = gameReducer(s, { type: 'reload', weaponId: w.id });
      else if (!blocker) s = gameReducer(s, { type: 'rollResolved', outcome: resolveRoll(s, buildAttackRequest(s.character, w, target, {}, 'player'), 0, rng) });
      if (!activeEnemies(s.combat).length) break;
    }
    s = runEnemyPhase(s, rng).state;
    while (s.pendingRoll?.kind === 'deathSave' && !s.character.dead) {
      s = gameReducer(s, { type: 'rollResolved', outcome: resolveRoll(s, s.pendingRoll, 0, rng) });
      break;
    }
  }
  return { win: !s.character.dead && !activeEnemies(s.combat).length, dead: s.character.dead, hpLostFrac: Math.max(0, hp0 - s.character.hp.current) / hp0 };
}
const winRate = (c: Character, foes: Array<{ template: string; count?: number }>, n: number, tag: string, opts: Parameters<typeof fight>[3] = {}) => {
  const rng = seededRng(`${FOE_SEED}:${tag}`);
  let w = 0;
  for (let i = 0; i < n; i++) if (fight(c, foes, rng, opts).win) w++;
  return w / n;
};

describe('QA-BAL 2: combate do personagem inicial (revólver 3d6, Kevlar SP7) contra fichas oficiais', () => {
  it('Solo (REF 8) vence 1 ganger quase sempre, perde para 3 quase sempre: a escada de dificuldade é íngreme', () => {
    const solo = make('solo', 'reflex');
    const g = (n: number) => [{ template: 'maelstrom_ganger', count: n }];
    expect(winRate(solo, g(1), 500, 's1')).toBeGreaterThan(0.75);
    const two = winRate(solo, g(2), 500, 's2');
    expect(two).toBeGreaterThan(0.1);
    expect(two).toBeLessThan(0.45);
    expect(winRate(solo, g(3), 500, 's3')).toBeLessThan(0.15);
  });

  it('papel sem REF 8 (sem esquiva de balas) e sem perícia de arma é carne: letalidade alta contra UM ganger', () => {
    expect(winRate(make('fixer', 'social'), [{ template: 'maelstrom_ganger' }], 400, 'fixer1')).toBeLessThan(0.15);
    expect(winRate(make('netrunner', 'brains'), [{ template: 'maelstrom_ganger' }], 400, 'nr1')).toBeLessThan(0.15);
  });

  it('armadura leve SP11 (€$100) melhora muito a sobrevivência; as de SP12/13 (REF/DEX −2) não superam a SP11', () => {
    const solo = make('solo', 'reflex');
    const two = [{ template: 'maelstrom_ganger', count: 2 }];
    const kevlar = winRate(withJacket(solo, 7), two, 600, 'arm7');
    const lite = winRate(withJacket(solo, 11), two, 600, 'arm11');
    const heavy = winRate(withJacket(solo, 13), two, 600, 'arm13');
    expect(lite - kevlar).toBeGreaterThan(0.1);
    expect(heavy).toBeLessThan(lite);
  });

  it('a iniciativa aplicada não altera o resultado (o jogador sempre abre; os inimigos agem uma vez por ciclo)', () => {
    const solo = make('solo', 'reflex');
    const two = [{ template: 'maelstrom_ganger', count: 2 }];
    const slow = winRate(solo, two, 800, 'init', { playerInit: 0 });
    const fast = winRate(solo, two, 800, 'init', { playerInit: 99 });
    expect(Math.abs(slow - fast)).toBeLessThan(0.08);
  });

  it('um mercenário (bodyguard) por uma fatia do corre vale mais que +10 pontos de vitória contra 2 gangers', () => {
    const fixer = make('fixer', 'social');
    const two = [{ template: 'maelstrom_ganger', count: 2 }];
    const alone = winRate(fixer, two, 400, 'merc0');
    const withMerc = winRate(fixer, two, 400, 'merc1', { ally: 'bodyguard', allies: 1 });
    expect(withMerc - alone).toBeGreaterThan(0.2);
  });

  it('nenhum tiro/golpe de ficha oficial mata do nada um personagem com 40+ PV (dano pós-SP7)', () => {
    const rng = seededRng('qa-bal-lethal');
    let max = 0;
    for (const tpl of Object.values(NPC_TEMPLATES)) {
      const w = tpl.weapons[0];
      for (let i = 0; i < 4000; i++) {
        const d = rollDamage(w.damage, rng);
        max = Math.max(max, computeDamage({ raw: d.total, sp: 7, location: 'body', halfArmor: WEAPONS[w.weaponClass].halfArmor, critical: d.critical }).hpDamage);
      }
    }
    expect(max).toBeLessThan(40);
  });
});

// ---------------------------------------------------------------- quickhacks e rede
describe('QA-BAL 3: quickhacks (Interface + 1d10 > defesa) e RAM', () => {
  const p = (rank: number, dv: number, seed: string, n = 30000) => {
    const rng = seededRng(seed);
    let ok = 0;
    for (let i = 0; i < n; i++) if (rank + rollD10(rng).total > dv) ok++;
    return ok / n;
  };
  it('rank 4 (inicial) vs capanga ~60%, vs tenente ~30%, vs chefe ~10%; o teto é ~90% (1 natural falha)', () => {
    expect(p(4, QUICKHACK_DV.mook, 'qh1')).toBeGreaterThan(0.52);
    expect(p(4, QUICKHACK_DV.mook, 'qh1')).toBeLessThan(0.68);
    expect(p(4, QUICKHACK_DV.lieutenant, 'qh2')).toBeGreaterThan(0.22);
    expect(p(4, QUICKHACK_DV.lieutenant, 'qh2')).toBeLessThan(0.38);
    expect(p(4, QUICKHACK_DV.miniboss, 'qh3')).toBeLessThan(0.18);
    expect(p(10, QUICKHACK_DV.mook, 'qh4')).toBeLessThan(0.95);
  });
  it('RAM: o deck padrão no rank 4 tem 6; recupera 2/rodada; T4 (8 RAM) só cabe com rank 8+', () => {
    const base = make('netrunner', 'brains');
    expect(ramMax(base)).toBe(6);
    expect(ramMax({ ...base, roleRank: 8 })).toBe(8);
    expect(RAM_REGEN_PER_ROUND).toBe(2);
  });
});

describe('QA-BAL 4: Rede (Trilheiro rank 4 em arquiteturas básica/padrão)', () => {
  it('rank 4 não acessa incomum/avançada (portas de progressão); em básica/padrão a run é segura (baixo risco de morte)', () => {
    expect(NET_MIN_INTERFACE.uncommon).toBeGreaterThan(4);
    expect(NET_MIN_INTERFACE.advanced).toBeGreaterThan(4);
    const rng = seededRng('qa-bal-net');
    const N = 300;
    let done = 0, dead = 0;
    for (let i = 0; i < N; i++) {
      let s: GameState = createInitialState(make('netrunner', 'brains'));
      const arch = generateArchitecture({ name: 'A', accessPoint: 't', difficulty: 'standard', files: ['Dados'] }, 1, rng);
      s = { ...s, net: { ...s.net, architecture: arch } };
      const j = jackIn(s, rng);
      if (!j.ok) continue;
      s = j.state;
      let got = false;
      for (let turn = 0; turn < 40 && s.net.run && s.character.hp.current > 0 && !got; turn++) {
        for (let k = 0; k < 6 && s.net.run && s.net.run.actionsLeft > 0 && !got; k++) {
          const run = s.net.run;
          const floor = s.net.architecture!.floors[run.position];
          let r = floor.kind === 'file' && !floor.cleared ? netAction(s, { kind: 'eye_dee' }, rng) : floor.kind === 'password' && !floor.cleared ? netAction(s, { kind: 'backdoor' }, rng) : netAction(s, { kind: run.position + 1 < arch.floors.length ? 'down' : 'jack_out' }, rng);
          if (!r.ok) r = netAction(s, { kind: 'jack_out' }, rng);
          s = r.state;
          if (s.net.architecture?.floors.some(f => f.downloaded)) got = true;
        }
        if (s.net.run && !got) s = endNetTurn(s, rng).state;
      }
      if (got) done++;
      if (s.character.hp.current <= 0) dead++;
    }
    expect(done / N).toBeGreaterThan(0.7);
    expect(dead / N).toBeLessThan(0.2); // bot ingênuo (sem Armor, sem recuar com PV baixo): ~11%; com recuo/Armor a sonda mediu ~1%
  });
});

// ---------------------------------------------------------------- perseguição
describe('QA-BAL 7: perseguição (DV 13 + max(0, pressão − 2))', () => {
  const chase = (drive: number, ref: number, pressure: number, n: number, seed: string) => {
    const rng = seededRng(seed);
    let escaped = 0;
    for (let i = 0; i < n; i++) {
      const base = make('fixer', 'balanced');
      let s: GameState = createInitialState({ ...base, stats: { ...base.stats, REF: ref }, skills: { ...base.skills, drive } });
      s = startChase(s, { opponent: 'X', reason: 'y', pressure, vehicleIntegrity: 4, opponentIntegrity: 4 });
      for (let step = 0; step < 60 && s.world.chase; step++) s = runToolCalls(REGISTRY, s, [{ tool: 'chase_action', args: { action: 'escape' } }], { rng, origin: 'player' }).state;
      if (!s.world.chase && s.events.filter(e => e.type === 'SCENE_CHANGED').at(-1)?.summary.includes('escapou')) escaped++;
    }
    return escaped / n;
  };
  it('piloto leigo (REF 7, Pilotar 0) escapa ~metade das vezes; o Nômade inicial (REF 8 + Pilotar 6 + Moto 4 → modelado como drive 10) quase sempre', () => {
    const leigo = chase(0, 7, 2, 600, 'ch0');
    expect(leigo).toBeGreaterThan(0.4);
    expect(leigo).toBeLessThan(0.75);
    expect(chase(10, 8, 2, 400, 'ch1')).toBeGreaterThan(0.95);
  });
});

// ---------------------------------------------------------------- economia
describe('QA-BAL 5: economia (invariantes que devem continuar valendo)', () => {
  const rich = () => scenario().edit(s => ({ ...s, character: { ...s.character, money: 100_000 } }));
  it('comprar 1 unidade de qualquer mercadoria do catálogo e revender nunca dá lucro (venda = 50%)', () => {
    for (const key of Object.keys(MERCHANT_CATALOG)) {
      // sem a pilha inicial de munição/consumíveis (a munição inicial vale 10/un: ver BAL-2)
      const sc = rich().edit(s => ({ ...s, character: { ...s.character, inventory: s.character.inventory.filter(i => i.category !== 'ammo' && i.category !== 'consumable') } }));
      const m0 = sc.state.character.money;
      sc.tool('narrator', 'propose_trade', { seller: 'V', catalogKey: key, quantity: 1 });
      const offer = sc.state.world.tradeOffer;
      expect(offer, key).toBeTruthy();
      sc.tool('player', 'settle_trade', { offerId: offer!.id });
      const item = sc.state.character.inventory.find(i => i.name === offer!.item.name || i.id === offer!.item.id)!;
      expect(item, key).toBeTruthy();
      sc.tool('player', 'sell_item', { itemId: item.id, buyer: 'Fence' });
      expect(sc.state.character.money, key).toBeLessThanOrEqual(m0);
    }
  });

  it('Mercado Noturno e encomenda do Canal nunca saem mais baratos que o ripperdoc (peça + cirurgia ≥ preço cheio): valem só pelo acesso', () => {
    for (const d of Object.values(CYBERWARE).filter(x => x.grade !== 'prototype')) {
      const viaMarket = marketCyberPrice({} as Character, d.key) + surgeryFee(d);
      expect(viaMarket, d.key).toBeGreaterThanOrEqual(d.price * (d.paired ? 2 : 1));
    }
  });

  it('PM: perícia custa 20 × nível (×2 em perícia difícil); rank de papel 60 × rank; quickhacks T2/T3/T4 20/30/50', () => {
    expect(skillUpgradeCost(5)).toBe(100);
    expect(skillUpgradeCost(5, true)).toBe(200);
    expect(roleUpgradeCost(5)).toBe(300);
  });

  it('Humanidade: com perda média ~5 por peça, ~8-17 peças aleatórias T1-3 levam EMP 6 à ciberpsicose', () => {
    const rng = seededRng('qa-bal-hum');
    const pool = Object.values(CYBERWARE).filter(d => d.grade === 'civil' && d.tier <= 3 && d.hl !== '0' && !d.foundation);
    let total = 0;
    const N = 800;
    for (let t = 0; t < N; t++) {
      let cur = 60;
      let n = 0;
      while (cur > 0 && n < 80) {
        const d = pool[rng(pool.length) - 1];
        cur -= Array.from({ length: Number(d.hl[0]) }, () => rng(Number(d.hl[2]))).reduce((a, b) => a + b, 0);
        n++;
      }
      total += n;
    }
    const avg = total / N;
    expect(avg).toBeGreaterThan(8);
    expect(avg).toBeLessThan(17);
    expect(averageLoss('2d6')).toBe(7);
  });

  it('HP não regenera sozinho (hoje: só o Mestre cura) — documenta a premissa de que consumíveis/Medicânico importam', () => {
    let s = scenario().state;
    s = { ...s, character: { ...s.character, hp: { ...s.character.hp, current: 5 } } };
    expect(advanceTime(s, 7 * 24 * 60).character.hp.current).toBe(5);
  });
});

// ---------------------------------------------------------------- problemas conhecidos (comportamento DESEJADO)
describe('QA-BAL: problemas conhecidos (desligados; ligue ao corrigir)', () => {
  const rich = () => scenario().edit(s => ({ ...s, character: { ...s.character, money: 100_000 } }));
  const buy = (sc: ReturnType<typeof scenario>, key: string, quantity: number) => {
    sc.state = { ...sc.state, world: { ...sc.state.world, tradeOffer: undefined } };
    sc.tool('narrator', 'propose_trade', { seller: 'V', catalogKey: key, quantity });
    const offer = sc.state.world.tradeOffer!;
    sc.tool('player', 'settle_trade', { offerId: offer.id });
    return offer;
  };

  it('[BAL-1] granadas: o preço escala com a quantidade (hoje 50 granadas custam €$100 e a pilha revende a €$100/un)', () => {
    const sc = rich();
    const offer = buy(sc, 'weapon_grenade', 50);
    expect(offer.price).toBe(50 * 100);
  });

  it('[BAL-2] munição comprada não herda value 10/un da pilha inicial (comprar a 1 e vender a 5)', () => {
    const sc = scenario({ starterWeaponId: 'pistol' }).edit(s => ({ ...s, character: { ...s.character, money: 1000 } }));
    const m0 = sc.state.character.money;
    buy(sc, 'ammo_M_PISTOL', 50);
    const stack = sc.state.character.inventory.find(i => i.category === 'ammo')!;
    sc.tool('player', 'sell_item', { itemId: stack.id, buyer: 'Fence', quantity: stack.quantity - 1 });
    expect(sc.state.character.money).toBeLessThanOrEqual(m0);
  });

  it('[BAL-3] give_item: valor total (valor × quantidade) respeita MAX_GIFT_VALUE (hoje 30 × €$1000 vende por €$15000)', () => {
    const sc = scenario();
    sc.tool('narrator', 'give_item', { name: 'Sucata valiosa', category: 'gear', estimatedValue: 1000, quantity: 30, source: 'cena' });
    const it = sc.state.character.inventory.find(i => /Sucata/.test(i.name));
    const m0 = sc.state.character.money;
    if (it) sc.tool('player', 'sell_item', { itemId: it.id, buyer: 'Fence' });
    expect(sc.state.character.money - m0).toBeLessThanOrEqual(1000);
  });

  it.skip('[BAL-4] Calor policial decai com o tempo (hoje fica em 5 para sempre sem o Mestre chamar modify_heat)', () => {
    const sc = scenario().edit(s => ({ ...s, world: { ...s.world, heat: 5 } }));
    expect(advanceTime(sc.state, 30 * 24 * 60).world.heat).toBeLessThan(5);
  });

  it.skip('[BAL-5] "atirar na perseguição" falhando aumenta a pressão (hoje shoot não tem risco algum: vence 100%)', () => {
    const rng = seededRng('qa-bal-shoot');
    let cornered = 0;
    for (let i = 0; i < 200; i++) {
      const base = make('fixer', 'balanced');
      let s: GameState = createInitialState({ ...base, skills: { ...base.skills, handgun: 0 }, stats: { ...base.stats, REF: 4 } });
      s = startChase(s, { opponent: 'X', reason: 'y', pressure: 2, vehicleIntegrity: 4, opponentIntegrity: 4 });
      for (let step = 0; step < 60 && s.world.chase; step++) s = runToolCalls(REGISTRY, s, [{ tool: 'chase_action', args: { action: 'shoot' } }], { rng, origin: 'player' }).state;
      if (s.events.filter(e => e.type === 'SCENE_CHANGED').at(-1)?.summary.includes('encurralado')) cornered++;
    }
    expect(cornered).toBeGreaterThan(0);
  });
});
