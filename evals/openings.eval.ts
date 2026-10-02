/**
 * Aberturas de campanha: cada papel/história começa num lugar diferente, com a primeira mensagem de quem
 * faz sentido; o Rafa continua no mundo (canônico) sem ser, por padrão, quem puxa a história.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacter, STAT_PRESETS, type CreationInput } from '../shared/rules/creation';
import { createInitialState, RAFA_ID } from '../shared/engine/initialState';
import { CLASSIC_OPENING, OPENINGS, openingsFor, pickOpening } from '../shared/engine/openings';
import { seededRng } from '../shared/engine/dice';
import { migrateState } from '../shared/engine/migrate';
import { buildGameContext } from '../shared/engine/context';
import { buildNarratePrompt } from '../server/gamemaster/promptBuilder';
import { ContextSchema } from '../server/validation';
import { fallbackNarrate } from '../server/gamemaster/fallbacks';
import { validateSave } from '../src/services/saves';
import type { RoleId } from '../shared/types/game';

const ROLES: RoleId[] = ['solo', 'netrunner', 'tech', 'medtech', 'fixer', 'nomad'];
const make = (role: RoleId, over: Partial<CreationInput> = {}) =>
  buildCharacter({
    name: 'Ren', handle: 'Sparks', age: 24, role, occupation: 'Entregador de encomendas noturnas', district: 'HEYWOOD',
    familyTie: 'Minha mãe, exausta de turnos dobrados', debtReason: '€$2.400 de aluguel atrasado', personalAnchor: 'Sair da cidade', appearance: '',
    stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol', ...over,
  });

describe('Cada abertura gera uma campanha válida', () => {
  for (const opening of OPENINGS) {
    it(`${opening.key}: estado válido, cena coerente, primeira mensagem e o Rafa no elenco`, () => {
      for (const family of ['Minha mãe, exausta de turnos dobrados', 'Meu gato, Mingau', '']) {
        const c = make('solo', { familyTie: family });
        const s = createInitialState(c, { opening: opening.key, seed: `t-${opening.key}` });
        expect(() => validateSave(JSON.parse(JSON.stringify(s)))).not.toThrow();
        expect(ContextSchema.safeParse(buildGameContext(s)).success).toBe(true);
        expect(s.world.opening?.key).toBe(opening.key);
        const firstJob = s.missions.find(m => m.id === 'm_first_job');
        expect(firstJob).toMatchObject({ status: 'ACTIVE', objective: s.world.objective, rewardEddies: 0 });
        expect(firstJob?.notes).toEqual([]);
        // Presentes existem e estão vivos.
        for (const id of s.scene.presentNpcIds) expect(s.npcs.find(n => n.id === id)?.status).toBe('alive');
        // Sempre há a primeira interação de mensagem, de um NPC que existe.
        expect(s.phone).toHaveLength(1);
        expect(s.phone[0].unread).toBe(1);
        const from = s.npcs.find(n => n.id === s.phone[0].npcId);
        expect(from, `${opening.key} com laço "${family}"`).toBeDefined();
        expect(from!.kind).not.toBe('animal');
        // O Rafa existe sempre.
        const rafa = s.npcs.find(n => n.id === RAFA_ID)!;
        expect(rafa.status).toBe('alive');
        if (opening.key === CLASSIC_OPENING) {
          expect(s.phone[0].npcId).toBe(RAFA_ID);
        } else {
          // Não é quem manda a primeira mensagem, nem tem corre pendente ou insistência agendada.
          expect(s.phone[0].npcId).not.toBe(RAFA_ID);
          expect(rafa.pendingMatters).toBeUndefined();
          expect(s.scheduled.some(e => 'npcId' in e.action && e.action.npcId === RAFA_ID)).toBe(false);
          expect(s.memories.some(m => m.subject === RAFA_ID)).toBe(false);
        }
      }
    });
  }
});

describe('Sorteio coerente com papel e história', () => {
  it('salva uma lição inicial específica para cada Papel', () => {
    const focus: Record<RoleId, RegExp> = {
      solo: /Consciência de Combate/,
      netrunner: /Interface e hacking/,
      tech: /Fabricante e diagnóstico/,
      medtech: /Medicina sob pressão/,
      fixer: /Operador, contatos e negociação/,
      nomad: /Moto, rota e família/,
    };
    for (const role of ROLES) {
      const s = createInitialState(make(role), { opening: pickOpening(make(role), seededRng(`lesson-${role}`)).key, seed: `lesson-${role}` });
      expect(s.world.opening?.tutorial?.focus).toMatch(focus[role]);
      expect(s.missions.find(m => m.id === 'm_first_job')?.notes).toEqual([]);
    }
  });

  it('vida de estudante/digital impede aberturas de estrada ou escolta sem esse vínculo', () => {
    const c = make('solo', { occupation: 'Estudante de programação que passa a noite no computador' });
    const keys = openingsFor(c).map(o => o.key);
    expect(keys).not.toContain('badlands_camp');
    expect(keys).not.toContain('border_checkpoint');
    expect(keys).not.toContain('bodyguard_shift');
    expect(keys).toContain('noodle_stall');
    const s = createInitialState(c, { opening: 'dive_bar', seed: 'student' });
    expect(s.world.opening?.tutorial?.characterFit).toMatch(/Estudante de programação/);
  });

  it('cada papel tem várias aberturas possíveis e o clássico é minoria', () => {
    for (const role of ROLES) {
      const c = make(role, { occupation: 'Faz-tudo', debtReason: 'contas', personalAnchor: 'viver', familyTie: 'Minha irmã' });
      const seen = new Map<string, number>();
      for (let i = 0; i < 400; i++) {
        const k = pickOpening(c, seededRng(`${role}-${i}`)).key;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      expect(seen.size, role).toBeGreaterThanOrEqual(4);
      expect((seen.get(CLASSIC_OPENING) ?? 0) / 400, role).toBeLessThan(0.15);
    }
  });

  it('Badlands só para nômade (ou história de estrada); clínica para Medicânico; net café para Trilheiro', () => {
    const keys = (role: RoleId, over: Partial<CreationInput> = {}) => openingsFor(make(role, { occupation: 'Faz-tudo', debtReason: 'contas', personalAnchor: 'viver', ...over })).map(o => o.key);
    for (const role of ['solo', 'netrunner', 'tech', 'medtech', 'fixer'] as RoleId[]) {
      expect(keys(role)).not.toContain('badlands_camp');
    }
    expect(keys('nomad')[0]).toBe('badlands_camp');
    expect(keys('medtech')[0]).toBe('back_alley_clinic');
    expect(keys('netrunner')[0]).toBe('net_cafe');
    expect(keys('tech')).toContain('garage_night');
    // A história pesa: um Solo entregador tende à entrega.
    expect(keys('solo', { occupation: 'Entregador de encomendas noturnas' }).slice(0, 2)).toContain('delivery_run');
  });

  it('abertura de ofício exige o papel ou a OCUPAÇÃO (palavras da dívida/laço não contam)', () => {
    // Bio padrão da criação: entregador, "convênio médico da família" na dívida.
    const c = make('netrunner', { debtReason: '€$2.400 de aluguel atrasado e o convênio médico da família' });
    const keys = openingsFor(c).map(o => o.key);
    for (const k of ['back_alley_clinic', 'bodyguard_shift', 'garage_night', 'night_market_deal', 'badlands_camp']) expect(keys).not.toContain(k);
    expect(keys).toContain('net_cafe');
    expect(keys).toContain('delivery_run'); // a ocupação é entregador
    expect(openingsFor(make('solo', { occupation: 'Paramédico da Trauma Team' })).map(o => o.key)).toContain('back_alley_clinic');
  });

  it('nômade nas Badlands começa FORA de Night City, ao amanhecer, e não conhece o Rafa ainda', () => {
    const s = createInitialState(make('nomad'), { opening: 'badlands_camp', seed: 'nomad' });
    expect(s.world.location.district).toBe('BADLANDS');
    expect(s.world.time.slice(11, 16)).toBe('05:40');
    expect(s.npcs.find(n => n.id === RAFA_ID)!.isContact).toBe(false);
    expect(s.world.opening!.hook).toMatch(/ainda NÃO o conhece/);
  });
});

describe('Prólogo', () => {
  it('abertura nova: o prompt segue a abertura e não diz que o Rafa mandou SMS', () => {
    const s = createInitialState(make('medtech'), { opening: 'back_alley_clinic', seed: 'p' });
    const prompt = buildNarratePrompt(buildGameContext(s), { kind: 'prologue', engineResult: null });
    expect(prompt).toMatch(/ABERTURA DESTA CAMPANHA/);
    expect(prompt).toMatch(/PRIMEIRO CORRE = TUTORIAL DIEGÉTICO/);
    expect(prompt).toMatch(/m_first_job/);
    expect(prompt).toMatch(/FOCO DESTE PERSONAGEM.*Medicina sob pressão/);
    expect(prompt).toMatch(/clínica de beco/i);
    expect(prompt).not.toMatch(/Rafa "Zero-Um" já mandou SMS/);
  });

  it('abertura clássica: continua o texto de sempre', () => {
    const s = createInitialState(make('solo'), { opening: CLASSIC_OPENING });
    const prompt = buildNarratePrompt(buildGameContext(s), { kind: 'prologue', engineResult: null });
    expect(prompt).toMatch(/Rafa "Zero-Um" já mandou SMS/);
  });

  it('sem opção (saves e testes antigos): idêntico ao clássico', () => {
    const s = createInitialState(make('solo'));
    expect(s.phone[0].npcId).toBe(RAFA_ID);
    expect(s.world.opening).toBeUndefined();
  });
});

describe('Limpeza de tutorial antigo', () => {
  it('remove instruções internas da missão inicial já gravada em um save', () => {
    const fresh = createInitialState(make('solo'), { opening: 'rooftop_party', seed: 'old-tutorial' });
    const dirty = {
      ...fresh,
      missions: fresh.missions.map(m => m.id === 'm_first_job' ? { ...m, reward: 'Um contato, informação e um rumo', notes: ['Tutorial: instrução interna', 'Perfil: instrução interna'] } : m),
    };
    const repaired = migrateState(dirty);
    const firstJob = repaired.missions.find(m => m.id === 'm_first_job')!;
    expect(firstJob.reward).toBeUndefined();
    expect(firstJob.notes).toEqual([]);
  });
});

describe('Prólogo de reserva (Mestre fora do ar) segue a abertura', () => {
  it('fala do lugar e de quem mandou a 1ª mensagem — não do cubículo e do Rafa', () => {
    const s = createInitialState(make('nomad'), { opening: 'badlands_camp', seed: 'fb' });
    const r = fallbackNarrate(buildGameContext(s), 'prologue', null);
    expect(r.narration).toMatch(/Acampamento do clã/);
    expect(r.narration).not.toMatch(/Rafa|administração/);
    const sender = s.npcs.find(n => n.id === s.phone[0].npcId)!.name;
    expect(r.narration).toContain(sender);
    for (const a of r.suggestedActions) expect(a.length).toBeLessThanOrEqual(62);
  });
});
