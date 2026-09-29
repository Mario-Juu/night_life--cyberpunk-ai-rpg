import { STATE_VERSION, type Character, type GameState, type Npc } from '../types/game';
import { CAMPAIGN_START_TIME, advanceGameTime, formatGameTime, getDistrict } from '../rules/world';
import { makeId } from './ids';

export const RAFA_ID = 'npc_rafa';
export const FAMILY_ID = 'npc_family';
export const MAIN_BRANCH = 'main';

export function makeNpc(partial: Pick<Npc, 'id' | 'name' | 'role'> & Partial<Npc>): Npc {
  return {
    description: '',
    trust: 0,
    respect: 30,
    fear: 0,
    anger: 0,
    knowledge: [],
    status: 'alive',
    isContact: false,
    ...partial,
  };
}

/** ÚNICO conjunto de defaults da campanha. */
export function createInitialState(character: Character): GameState {
  const district = getDistrict(character.bio.district);
  const time = CAMPAIGN_START_TIME;
  const clock = formatGameTime(time).time;
  const familyName = character.bio.familyTie ? character.bio.familyTie.split(/[,;(]/)[0].trim().slice(0, 60) : '';
  const id = makeId('camp');

  return {
    version: STATE_VERSION,
    id,
    title: `Sombra em ${district.name}`,
    createdAt: new Date().toISOString(),
    turn: 0,
    session: { version: 0, branchId: MAIN_BRANCH, parentBranchId: null, branchedFromTurn: null },
    character,
    world: {
      time,
      location: { district: district.id, subDistrict: district.sub.split(',')[0].trim(), spot: 'Seu cubículo alugado por semana' },
      weather: 'Garoa ácida',
      heat: 0,
      situation: `Fim de noite. Você acaba de voltar de mais um dia como ${character.bio.occupation.toLowerCase()}.`,
      objective: 'Arranjar eddies antes que a dívida estoure.',
    },
    scene: { id: makeId('scene'), description: 'Cubículo apertado, garoa ácida na janela', presentNpcIds: [], threat: 'low', startedTurn: 0 },
    flags: {},
    activeEffects: [],
    scheduled: [
      {
        id: makeId('sched'),
        at: advanceGameTime(time, 50),
        description: 'Rafa insiste no corre se não tiver resposta',
        status: 'scheduled',
        action: { kind: 'message', npcId: RAFA_ID, text: 'Última chamada, choom. Em meia hora passo a fita pra outro. Tá dentro ou não?' },
        condition: { flag: 'rafa_job_answered', equals: false },
        createdTurn: 0,
      },
    ],
    history: { summaries: [], summarizedUpToTurn: 0 },
    npcs: [
      makeNpc({
        id: RAFA_ID,
        name: 'Rafa "Zero-Um"',
        role: 'Canal de rua',
        description: 'Intermediário cético do térreo. Só fala de eddies, prazos e discrição.',
        trust: 10,
        respect: 20,
        currentGoal: 'Fechar o corre de entrega antes da meia-noite e meia.',
        location: district.id,
        isContact: true,
        pendingMatters: 'Ofereceu um corre de entrega que paga €$600.',
        lastInteraction: clock,
        knowledge: [{ id: makeId('fact'), fact: 'A carga do corre é um chip roubado da Militech.', secret: true }],
      }),
      ...(familyName
        ? [
            makeNpc({
              id: FAMILY_ID,
              name: familyName,
              role: 'Família',
              description: character.bio.familyTie,
              trust: 60,
              respect: 50,
              currentGoal: 'Manter a família de pé.',
              isContact: true,
              pendingMatters: character.bio.debtReason || undefined,
              lastInteraction: clock,
            }),
          ]
        : []),
    ],
    missions: [
      {
        id: 'm_rent',
        title: 'Sobreviver ao Aluguel',
        description: 'Manter a cabeça fora d’água antes que o síndico chame a segurança.',
        objective: character.bio.debtReason || 'Juntar eddies para o aluguel da semana.',
        status: 'ACTIVE',
        reward: 'Teto sobre a cabeça',
        rewardEddies: 0,
        notes: [],
        startedTurn: 0,
      },
    ],
    factions: [
      { id: 'fac_ncpd', name: 'NCPD', category: 'Polícia', standing: 0, description: 'Polícia terceirizada, corrupta e sobrecarregada.' },
      { id: 'fac_local_gang', name: district.localGang, category: 'Gang', standing: 0, description: `Controla as esquinas de ${district.name}.` },
      { id: 'fac_trauma', name: 'Equipe de Trauma', category: 'Megacorp', standing: 0, description: 'Resgate armado — só para clientes com plano.' },
    ],
    combat: { active: false, round: 0, playerInitiative: null, combatants: [], log: [] },
    phone: [
      {
        npcId: RAFA_ID,
        unread: 1,
        suggestedReplies: ['Passa os detalhes. Tô precisando da grana.', 'Quem paga e qual o risco da carga?'],
        messages: [
          {
            id: makeId('pm'),
            from: 'npc',
            time: clock,
            text: `Ouvi dizer que você tá precisando levantar uns eddies pra ontem, choom. Tenho um corre de entrega discreta em ${district.name} que paga €$600 na mão. Se tiver interesse, responde antes que eu passe a fita pra outro.`,
          },
        ],
      },
    ],
    chat: [],
    discoveries: [],
    memories: [
      { id: makeId('mem'), type: 'CHARACTER_MEMORY', subject: 'player', content: character.bio.debtReason || 'Contas atrasadas ameaçam o teto do protagonista.', importance: 8, confidence: 1, createdTurn: 0, lastRelevantTurn: 0, tags: ['dívida'] },
      { id: makeId('mem'), type: 'NPC_MEMORY', subject: RAFA_ID, content: `Rafa ofereceu por mensagem um corre de entrega em ${district.name} por €$600.`, importance: 7, confidence: 1, createdTurn: 0, lastRelevantTurn: 0, tags: ['corre'] },
    ],
    events: [{ id: `${id}:${MAIN_BRANCH}:t0:e0`, turnId: `${id}:${MAIN_BRANCH}:t0`, turn: 0, time, type: 'SYSTEM', summary: `Campanha iniciada: ${character.bio.handle} em ${district.name}.` }],
    pendingRoll: null,
    suggestedActions: [],
  };
}
