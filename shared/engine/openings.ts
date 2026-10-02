/**
 * Aberturas de campanha: cada uma é um lugar, uma hora e uma pessoa que puxa o jogador para a história,
 * coerente com o papel e com o que ele contou na criação (ofício, laço, pressão). Sempre há uma primeira
 * mensagem no Agent — mas de quem faz sentido naquela abertura, não sempre do Rafa.
 *
 * Rafa "Zero-Um" continua canônico: existe no mundo em toda campanha e pode surgir quando a história pedir.
 * Só na abertura clássica (cubículo + corre de €$600) ele manda a primeira mensagem.
 */
import type { Character, GameState, Npc, NpcProfile, RoleId } from '../types/game';
import { getDistrict } from '../rules/world';
import { makeId } from './ids';
import type { Rng } from './dice';

export const CLASSIC_OPENING = 'classic';
export const OPENING_SURPRISE = 'surprise';

interface SeedNpc {
  /** Chave interna (para os textos citarem pelo nome sorteado). */
  key: string;
  names: string[];
  role: string;
  description: string;
  profile: NpcProfile;
  trust?: number;
  fear?: number;
  currentGoal?: string;
  goalKnown?: boolean;
  pending?: string;
  /** Segredo (só o Mestre sabe no começo). */
  secret?: string;
}

type Names = Record<string, string>;

export interface OpeningDef {
  key: string;
  /** Rótulo curto (tela de criação). */
  label: string;
  /** Uma linha para a tela de criação. */
  blurb: string;
  /** 0 = não serve para este personagem; quanto maior, mais provável no sorteio. */
  weight: (c: Character) => number;
  /** Hora UTC do jogo (o dia é sempre 29/09/2077). */
  time: string;
  weather: string;
  place: (c: Character) => { district: string; subDistrict: string; spot: string };
  title: (c: Character) => string;
  situation: (c: Character, n: Names) => string;
  objective: (c: Character, n: Names) => string;
  scene: (c: Character, n: Names) => string;
  threat: 'low' | 'medium' | 'high';
  /** Quem está fisicamente na cena. */
  present: SeedNpc[];
  /** Quem manda a primeira mensagem no Agent: um NPC desta abertura ou o laço familiar. */
  messenger: {
    npc: SeedNpc | 'family';
    text: (c: Character, n: Names) => string;
    replies: string[];
    /** Sem laço humano (bicho ou ninguém): quem manda no lugar — a chave de alguém da cena — e o texto. */
    fallback?: { from: string; text: (c: Character, n: Names) => string; replies: string[] };
  };
  /** O jogador já conhece o Rafa (morador do bairro) ou ele é só alguém que pode surgir. */
  knowsRafa: boolean;
  /** Para o Mestre: o que é esta abertura (vai no prólogo). */
  hook: (c: Character, n: Names) => string;
  memory: (c: Character, n: Names) => string;
}

const has = (c: Character, re: RegExp) => re.test(`${c.bio.occupation} ${c.bio.debtReason} ${c.bio.personalAnchor} ${c.bio.familyTie}`.toLowerCase());
/** Só a ocupação declarada: aberturas de ofício (clínica, oficina, turno de segurança) não podem pegar carona
 * em palavras da dívida ou do laço ("convênio médico" não faz de ninguém Medicânico). */
const job = (c: Character, re: RegExp) => re.test(c.bio.occupation.toLowerCase());
const role = (c: Character, ...roles: RoleId[]) => roles.includes(c.bio.role);
const home = (c: Character) => getDistrict(c.bio.district);
const firstSub = (c: Character) => home(c).sub.split(',')[0].trim();
const family = (c: Character) => (c.bio.familyTie ? c.bio.familyTie.split(/[,;(]/)[0].trim() : '');
const pressure = (c: Character) => c.bio.debtReason?.trim() || 'as contas atrasadas';

/** Vida declarada importa tanto quanto Papel: estudante/programador não recebe, por sorteio, um corre de estrada sem vínculo com isso. */
const isDeskOrStudyLife = (c: Character) => /estud|alun|escola|univers|faculd|program|desenvolv|analista|suporte|operador|stream|computador|home.?office|passa.{0,30}(no computador|online|em casa|no quarto)|fica.{0,30}(no computador|online|em casa|no quarto)/i.test(`${c.bio.occupation} ${c.bio.appearance}`);
const hasRoadLife = (c: Character) => job(c, /nômade|nomade|caminhone|estrada|motorista|entreg|courier|mensageir|motoboy|delivery|contrabando/) || has(c, /clã|badlands|deserto|estrada/);

/** Roteiro pedagógico curto salvo com a abertura; o Mestre recebe isto como restrição, não como uma missão pronta. */
export function firstJobTutorial(c: Character) {
  const characterFit = isDeskOrStudyLife(c)
    ? `A vida declarada é ${c.bio.occupation}. Comece em ambiente compatível (campus, quarto, net café, trabalho ou bairro), com deslocamento e esforço físico opcionais; não transforme a pessoa em contrabandista/corredor sem ela escolher isso.`
    : hasRoadLife(c)
      ? `A vida declarada envolve rua, estrada ou entregas (${c.bio.occupation}); veículo, rota e risco de deslocamento podem aparecer, mas ainda há escolhas fora de combate.`
      : `A vida declarada é ${c.bio.occupation}; a cena deve partir desse cotidiano ou de um vínculo pessoal antes de escalar.`;
  switch (c.bio.role) {
    case 'netrunner':
      return { focus: 'Interface e hacking', roleLesson: 'Apresente uma pista digital e, quando houver um ponto de acesso plausível, ensine a reconhecer a arquitetura, entrar com Interface e escolher ações de Rede.', characterFit, suggestedApproaches: ['investigar o sinal ou dados pelo Agent', 'procurar um ponto de acesso antes de invadir', 'pedir contexto a um contato'] };
    case 'fixer':
      return { focus: 'Operador, contatos e negociação', roleLesson: 'Apresente duas partes com interesses diferentes; ensine a perguntar preço, prazo e risco, usar contatos e só então pechinchar uma proposta real.', characterFit, suggestedApproaches: ['mapear quem ganha e quem perde', 'negociar termos ou informação', 'acionar um contato pelo Agent'] };
    case 'tech':
      return { focus: 'Fabricante e diagnóstico', roleLesson: 'Apresente um defeito ou dispositivo cotidiano; ensine a examinar, reparar ou improvisar dentro do nível do personagem, sem pedir invenção milagrosa.', characterFit, suggestedApproaches: ['examinar a falha', 'usar ferramentas e sucata disponíveis', 'pedir peças ou tempo em vez de improvisar'] };
    case 'medtech':
      return { focus: 'Medicina sob pressão', roleLesson: 'Apresente uma necessidade médica crível; ensine a avaliar risco, estabilizar/tratar e decidir entre recursos, tempo e ética.', characterFit, suggestedApproaches: ['avaliar antes de agir', 'usar o kit médico ou pedir ajuda', 'negociar tempo e segurança para tratar'] };
    case 'nomad':
      return { focus: 'Moto, rota e família', roleLesson: 'Apresente uma decisão de rota, veículo ou família; ensine que pilotagem resolve obstáculos na estrada, mas informação e planejamento vêm antes.', characterFit, suggestedApproaches: ['checar rota e veículo', 'falar com o clã ou contato local', 'buscar um desvio sem confronto'] };
    default:
      return { focus: 'Consciência de Combate e leitura de ameaça', roleLesson: 'Apresente sinais de perigo antes de qualquer troca de tiros; ensine percepção, cobertura, retirada e que combate é a última opção, não a primeira.', characterFit, suggestedApproaches: ['ler a cena e procurar cobertura', 'conversar ou intimidar sem sacar arma', 'sair e buscar posição ou reforço'] };
  }
}

function openingFitsLife(c: Character, key: string) {
  if (!isDeskOrStudyLife(c) || hasRoadLife(c)) return true;
  // Papel ainda vale, mas papel não apaga a biografia: uma pessoa de vida acadêmica/digital não começa do nada no deserto ou escoltando VIP.
  return !['badlands_camp', 'border_checkpoint', 'bodyguard_shift'].includes(key);
}

// ---------------------------------------------------------------- catálogo

export const OPENINGS: OpeningDef[] = [
  {
    key: CLASSIC_OPENING,
    label: 'Cubículo e um corre do Rafa',
    blurb: 'Fim de noite no cubículo alugado; o Rafa "Zero-Um" oferece um corre de entrega por €$600.',
    weight: () => 1,
    time: '2077-09-29T23:41:00.000Z',
    weather: 'Garoa ácida',
    place: c => ({ district: home(c).id, subDistrict: firstSub(c), spot: 'Seu cubículo alugado por semana' }),
    title: c => `Sombra em ${home(c).name}`,
    situation: c => `Fim de noite. Você acaba de voltar de mais um dia como ${c.bio.occupation.toLowerCase()}.`,
    objective: () => 'Arranjar eddies antes que a dívida estoure.',
    scene: () => 'Cubículo apertado, garoa ácida na janela',
    threat: 'low',
    present: [],
    messenger: { npc: 'family', text: () => '', replies: [] }, // o clássico usa a mensagem do Rafa (initialState)
    knowsRafa: true,
    hook: () => '',
    memory: () => '',
  },
  {
    key: 'rooftop_party',
    label: 'Festa numa cobertura de Charter Hill',
    blurb: 'Você entrou de penetra numa festa corporativa — e alguém lá dentro sabe quem você é.',
    weight: c => (role(c, 'fixer') ? 4 : role(c, 'solo', 'netrunner') ? 2.5 : role(c, 'nomad') ? 0.5 : 1.5) + (job(c, /festa|club|bar|garç|bartend|dj|segurança|model/) ? 2 : 0),
    time: '2077-09-29T23:10:00.000Z',
    weather: 'Céu limpo e neon refletido nas nuvens baixas',
    place: () => ({ district: 'WESTBROOK', subDistrict: 'Charter Hill', spot: 'Cobertura da Torre Ilume, festa de lançamento' }),
    title: () => 'Champanhe sintético em Charter Hill',
    situation: (_c, n) => `Você entrou na festa pela cozinha, com a ajuda de ${n.inside}. Executivos, modelos e seguranças com olhos de cromo. ${n.host} acabou de te reconhecer.`,
    objective: (_c, n) => `Descobrir o que ${n.host} quer de você antes que a segurança perceba que você não está na lista.`,
    scene: () => 'Cobertura de vidro em dois níveis: pista e bar no andar de baixo, mezanino com sofás em volta, terraço externo sem parapeito no lado leste; elevador privativo e porta de serviço da cozinha são as saídas, cada uma com um segurança da Militech',
    threat: 'medium',
    present: [
      {
        key: 'host',
        names: ['Inês Valcárcel', 'Mara Ostrova', 'Teo Kalani', 'Lior Bastos'],
        role: 'Assessora de um executivo da Biotechnica',
        description: 'Sorriso de vitrine, olhos que calculam. Sabe o seu nome e não deveria.',
        profile: { traits: ['calculista', 'elegante', 'impaciente'], voice: 'educada, frases curtas, nunca diz o nome do chefe', motivation: 'salvar a própria carreira antes da festa acabar', fear: 'ser associada a um escândalo', lines: 'nunca suja as próprias mãos' },
        trust: 0,
        currentGoal: 'Tirar da festa, sem escândalo, um convidado que roubou um shard do chefe dela.',
        pending: 'Quer contratar você, ali mesmo, para um serviço discreto dentro da festa.',
        secret: 'O shard roubado prova que o chefe dela vende dados de pacientes.',
      },
    ],
    messenger: {
      npc: {
        key: 'inside',
        names: ['Duda Sato', 'Kiko Ferraz', 'Nina Ramires'],
        role: 'Bartender do buffet',
        description: 'Amiga antiga que trabalha nos eventos de luxo e te colocou pra dentro.',
        profile: { traits: ['leal', 'nervosa', 'fofoqueira'], voice: 'gíria rápida, muito emoji falado', motivation: 'pagar a faculdade do irmão', fear: 'perder o emprego' },
        trust: 40,
      },
      text: (_c, n) => `Tá dentro? Falei que tu é do buffet, NÃO me queima. E olha: a mulher de vermelho perguntou teu nome pra mim. ${n.host}. Não sei como ela sabe quem tu é.`,
      replies: ['Quem é ela?', 'Relaxa, sei me virar.'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: festa de lançamento numa cobertura em Charter Hill (Westbrook). ${c.bio.handle} entrou de penetra com a ajuda de ${n.inside} (bartender, por mensagem — não está ao lado do jogador agora). ${n.host} está NA CENA, reconheceu o jogador e vai propor um serviço discreto (há um segredo dela no contexto). Mostre o ofício de ${c.bio.occupation} sendo útil num lugar onde ele não pertence; a pressão (${pressure(c)}) pesa no bolso. Seguranças por toda parte: improviso social antes de violência.`,
    memory: (_c, n) => `${n.inside} colocou você na festa de Charter Hill; ${n.host} reconheceu você lá dentro.`,
  },
  {
    key: 'dive_bar',
    label: 'Um bar do bairro',
    blurb: 'No balcão de sempre, alguém que você não conhece está perguntando por você.',
    weight: c => (role(c, 'solo', 'fixer', 'nomad') ? 2.5 : 2) + (job(c, /bar|seguran|leão/) ? 1.5 : 0),
    time: '2077-09-29T22:20:00.000Z',
    weather: 'Garoa ácida',
    place: c => ({ district: home(c).id, subDistrict: firstSub(c), spot: `Bar ${['O Último Copo', 'Coyote Manco', 'Lua de Ferro', 'Sal Grosso'][c.bio.handle.length % 4]}` }),
    title: c => `Último copo em ${home(c).name}`,
    situation: (c, n) => `Você está no balcão de sempre em ${home(c).name}. Um estranho anda perguntando de você pelo bairro — e acabou de sentar duas banquetas à sua esquerda. Do outro lado do balcão, ${n.bartender} te encara como quem pergunta "conhece?".`,
    objective: (_c, n) => `Descobrir quem é ${n.stranger} e por que está atrás de você.`,
    scene: c => `Bar comprido e estreito em ${home(c).name}: balcão à direita da porta, mesas de fórmica no fundo perto do banheiro, saída dos fundos pela cozinha; braindance pirata na TV acima do balcão; ${home(c).localGang} ocupando a mesa do canto`,
    threat: 'medium',
    present: [
      {
        key: 'stranger',
        names: ['Ozzy Navarro', 'Rin Takeda', 'Salomé Duarte', 'Vik Halloran'],
        role: 'Estranho com casaco caro demais para o bairro',
        description: 'Fala baixo, paga a rodada, tem um implante óptico barato que pisca quando mente.',
        profile: { traits: ['educado', 'evasivo', 'desesperado por baixo'], voice: 'formal, chama todo mundo de "senhor(a)"', motivation: 'encontrar alguém que some há uma semana', fear: 'ser seguido' },
        currentGoal: 'Contratar alguém do bairro para achar uma pessoa desaparecida.',
        pending: 'Quer conversar a sós sobre um trabalho.',
        secret: 'A pessoa desaparecida devia dinheiro a uma gangue — e ele também.',
      },
      {
        key: 'bartender',
        names: ['Lupe Carrasco', 'Gil "Torneira"', 'Maeve Okonkwo'],
        role: 'Dona do bar',
        description: 'Conhece todo mundo do bairro e cobra em informação quando você está sem eddies.',
        profile: { traits: ['protetora', 'desconfiada', 'direta'], voice: 'seca, apelidos para todos', motivation: 'manter o bar neutro', fear: 'a gangue tomar o ponto' },
        trust: 35,
      },
    ],
    messenger: {
      npc: 'family',
      text: c => `${c.bio.handle}, cê vem pra casa hoje? Passou um cara de terno perguntando de você na porta. Não falei nada. Toma cuidado.`,
      replies: ['Que cara? Como ele era?', 'Tô de olho. Tranca a porta.'],
      fallback: { from: 'bartender', text: (_c, n) => `Tem um engomadinho aqui perguntando teu nome. ${n.stranger}, diz ele. Paguei pra ver: fiquei calada. Tô de olho.`, replies: ['Segura ele aí, tô chegando.', 'Ele disse o que quer?'] },
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: bar do bairro em ${home(c).name}. ${n.stranger} (NA CENA) procura o jogador para um trabalho e esconde algo; ${n.bartender} (NA CENA, dona do bar) é aliada cautelosa. A primeira mensagem do Agent veio do laço familiar (não está na cena) avisando que alguém perguntou por ele em casa. Ofício: ${c.bio.occupation}. Pressão: ${pressure(c)}. ${home(c).localGang} ao fundo como ameaça latente.`,
    memory: (_c, n) => `${n.stranger} apareceu no bar perguntando por você.`,
  },
  {
    key: 'badlands_camp',
    label: 'Acampamento nas Badlands',
    blurb: 'Amanhecer fora de Night City; o clã precisa que alguém leve uma carga para dentro da cidade.',
    weight: c => (role(c, 'nomad') ? 5 : 0) + (job(c, /nômade|nomade|caminhone|estrada/) || has(c, /clã|badlands|deserto/) ? 3 : 0),
    time: '2077-09-29T05:40:00.000Z',
    weather: 'Vento seco carregado de poeira',
    place: () => ({ district: 'BADLANDS', subDistrict: 'Rodovia 101, a leste de Night City', spot: 'Acampamento do clã, entre carcaças de caminhões' }),
    title: () => 'Poeira no horizonte',
    situation: (_c, n) => `Amanhece nas Badlands. ${n.elder} reuniu o clã: a carga precisa entrar em Night City antes do fim do dia, e você conhece o caminho.`,
    objective: () => 'Atravessar o posto da NCPD e levar a carga do clã para dentro de Night City.',
    scene: () => 'Acampamento em círculo de carcaças de caminhão num leito de rio seco: fogueira no centro, oficina sob lona a oeste, os veículos do clã alinhados na saída norte para a rodovia; Night City é uma mancha no horizonte',
    threat: 'low',
    present: [
      {
        key: 'elder',
        names: ['Abuela Rosário', 'Tio Wren', 'Mãe Corvina'],
        role: 'Matriarca/patriarca do clã',
        description: 'Voz rouca, olhos que já enterraram metade da família. A palavra final no acampamento.',
        profile: { traits: ['dura', 'justa', 'cansada'], voice: 'provérbios da estrada, nunca levanta a voz', motivation: 'manter o clã inteiro mais um inverno', fear: 'perder os jovens para a cidade', lines: 'nunca deixa um dos seus para trás' },
        trust: 55,
        currentGoal: 'Vender a carga em Night City para pagar o combustível do inverno.',
        goalKnown: true,
        pending: 'Confia a carga do clã a você.',
        secret: 'A carga são peças de cromo militar desviadas de um comboio Militech.',
      },
    ],
    messenger: {
      npc: {
        key: 'cousin',
        names: ['Jojo Reyes', 'Sam "Lixa"', 'Tavi Morrow'],
        role: 'Prima/primo que já mora em Night City',
        description: 'Trocou o clã pela cidade há dois anos; ainda manda notícias.',
        profile: { traits: ['animada', 'imprudente', 'saudosa'], voice: 'mistura gíria da estrada com gíria de Night City', motivation: 'provar que fez certo em ir para a cidade', fear: 'que o clã a esqueça' },
        trust: 45,
      },
      text: (_c, n) => `Bom dia, poeira! O posto da ponte de Santo Domingo tá com NCPD nova hoje, revista tudo. Se vier com a carga, vem pelo leito do rio. Te espero no Coronado. — ${n.cousin}`,
      replies: ['Valeu, prima. Leito do rio então.', 'Revista como? Scanner ou na mão?'],
    },
    knowsRafa: false,
    hook: (c, n) => `Abertura: amanhecer nas Badlands, FORA de Night City. ${n.elder} (NA CENA) entrega ao jogador a missão de levar a carga do clã para dentro da cidade (há segredo sobre a carga). ${n.cousin} (por mensagem, já mora em Santo Domingo) avisou do posto da NCPD. Mostre a vida nômade: motores, família, poeira. Night City ainda é horizonte — a chegada é a próxima cena, não esta. Pressão pessoal: ${pressure(c)}.`,
    memory: (_c, n) => `${n.elder} confiou a você a carga do clã; ${n.cousin} espera você em Santo Domingo.`,
  },
  {
    key: 'border_checkpoint',
    label: 'Fila do posto de entrada',
    blurb: 'Chegando a Night City pela ponte, com um fiscal da NCPD desconfiado demais.',
    weight: c => (role(c, 'nomad') ? 3 : 0) + (job(c, /contrabando|caminhone/) || has(c, /fronteira|imigra|acabou de chegar/) ? 2 : 0),
    time: '2077-09-29T21:05:00.000Z',
    weather: 'Garoa ácida e holofotes',
    place: () => ({ district: 'SANTO DOMINGO', subDistrict: 'Ponte de Rancho Coronado', spot: 'Fila do posto de controle da NCPD' }),
    title: () => 'Os portões de Night City',
    situation: (_c, n) => `Você está na fila do posto de controle na entrada de Santo Domingo. ${n.officer} já olhou duas vezes para o seu veículo.`,
    objective: () => 'Passar pelo posto sem perder a carga nem o veículo.',
    scene: () => 'Ponte de quatro faixas afunilando em duas cabines de concreto: fila de caminhões à frente e atrás, guarita com holofotes à direita, pátio de revista cercado à esquerda, drones de inspeção pairando sobre a pista',
    threat: 'medium',
    present: [
      {
        key: 'officer',
        names: ['Sargento Bruno Kael', 'Cabo Imani Rhodes', 'Agente Lourenço Pike'],
        role: 'Fiscal da NCPD no posto',
        description: 'Uniforme amassado, olhos cansados, um preço para tudo.',
        profile: { traits: ['corrupto', 'entediado', 'perigoso quando acuado'], voice: 'burocrático, repete o número da placa', motivation: 'fechar o turno com um extra no bolso', fear: 'a corregedoria' },
        currentGoal: 'Arrancar um suborno de alguém nesta fila.',
        secret: 'Está sendo vigiado pela corregedoria esta noite.',
      },
    ],
    messenger: {
      npc: {
        key: 'contact',
        names: ['Paz Montero', 'Ike "Graxa"', 'Lena Vos'],
        role: 'Contato do outro lado da ponte',
        description: 'Quem combinou de receber você em Night City.',
        profile: { traits: ['prática', 'ansiosa'], voice: 'mensagens curtas', motivation: 'fechar o negócio', fear: 'NCPD' },
        trust: 25,
      },
      text: () => 'Tô do outro lado da ponte. Se te pararem, não fala meu nome. Se demorar mais de uma hora, eu sumo.',
      replies: ['Tô na fila. Segura aí.', 'Se der ruim, plano B?'],
    },
    knowsRafa: false,
    hook: (c, n) => `Abertura: fila do posto da NCPD na entrada de Santo Domingo. ${n.officer} (NA CENA) quer um suborno e está sendo vigiado (segredo). ${n.contact} espera do outro lado da ponte (só por mensagem). Mostre a tensão de entrar em Night City; o jogador decide: subornar, enganar, esperar ou desviar. Ofício: ${c.bio.occupation}. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.contact} espera você do outro lado da ponte de Santo Domingo.`,
  },
  {
    key: 'back_alley_clinic',
    label: 'Clínica de beco depois do expediente',
    blurb: 'Alguém sangrando esmurra a porta da clínica — e quem atirou nele ainda está na rua.',
    weight: c => (role(c, 'medtech') ? 5 : 0) + (job(c, /médic|medic|clínic|clinic|enferm|cirurg|paramédic/) ? 3 : 0),
    time: '2077-09-30T01:50:00.000Z',
    weather: 'Chuva forte',
    place: c => ({ district: home(c).id, subDistrict: firstSub(c), spot: 'Clínica de beco onde você trabalha' }),
    title: c => `Sangue na porta em ${home(c).name}`,
    situation: (_c, n) => `A clínica já fechou. ${n.patient} está caído na sua porta com um tiro no abdômen, e ${n.boss} mandou mensagem dizendo para não abrir para ninguém.`,
    objective: (_c, n) => `Decidir se salva ${n.patient} — e lidar com quem atirou nele.`,
    scene: () => 'Sala única e comprida: maca e lâmpada cirúrgica no centro, armário de remédios com cadeado ao fundo, porta de aço para o beco na frente e porta interna para o depósito; uma trilha de sangue vai da grade até a porta',
    threat: 'high',
    present: [
      {
        key: 'patient',
        names: ['Kai Mendoza', 'Rook Adeyemi', 'Pia Lancaster'],
        role: 'Ferido desconhecido',
        description: 'Jaqueta de mensageiro rasgada, um case trancado algemado ao pulso.',
        profile: { traits: ['assustado', 'teimoso', 'grato'], voice: 'ofegante, pede desculpas demais', motivation: 'entregar o case a qualquer custo', fear: 'quem atirou nele' },
        fear: 30,
        currentGoal: 'Sobreviver e entregar o case.',
        secret: 'O case tem amostras de uma droga experimental roubada.',
      },
    ],
    messenger: {
      npc: {
        key: 'boss',
        names: ['Doc Halvorsen', 'Dra. Amara Silveira', 'Velho Takumi'],
        role: 'Dono(a) da clínica',
        description: 'Ripperdoc veterano(a) que te ensinou o ofício e paga pouco.',
        profile: { traits: ['ranzinza', 'competente', 'paranoico'], voice: 'termos médicos e palavrões', motivation: 'manter a clínica longe das gangues', fear: 'ser fechado(a) pela NCPD' },
        trust: 40,
      },
      text: () => 'Ouvi tiro perto da clínica. NÃO abre pra ninguém hoje, tô falando sério. Amanhã a gente conversa.',
      replies: ['Tarde demais. Tem um ferido aqui.', 'Ok, não abro.'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: clínica de beco depois do expediente, em ${home(c).name}. ${n.patient} (NA CENA, ferido grave) bate na porta; há perseguidores na rua (decida quem). ${n.boss} (só por mensagem) mandou não abrir. Mostre o ofício de Medicânico sob pressão: o jogador escolhe salvar, negociar ou fechar a porta. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.patient} apareceu ferido na porta da clínica com um case algemado ao pulso.`,
  },
  {
    key: 'garage_night',
    label: 'Oficina de madrugada',
    blurb: 'O cliente não voltou para buscar o carro — e o porta-malas começou a apitar.',
    weight: c => (role(c, 'tech') ? 5 : role(c, 'nomad') ? 1.5 : 0) + (job(c, /mecân|mecan|oficina|garag|conserto|funil/) ? 3 : 0),
    time: '2077-09-30T00:30:00.000Z',
    weather: 'Garoa e fumaça das fábricas',
    place: c => ({ district: role(c, 'tech', 'nomad') ? 'SANTO DOMINGO' : home(c).id, subDistrict: role(c, 'tech', 'nomad') ? 'Arroyo' : firstSub(c), spot: 'Oficina de garagem onde você trabalha' }),
    title: () => 'Um porta-malas que apita',
    situation: (_c, n) => `Madrugada na oficina. O carro de ${n.client} está pronto há dois dias e ninguém veio buscar. Agora alguma coisa no porta-malas começou a apitar.`,
    objective: () => 'Descobrir o que está no porta-malas antes que alguém venha buscar.',
    scene: () => 'Galpão de pé-direito alto: elevador hidráulico no centro com um sedã corporativo prateado, bancada de ferramentas na parede esquerda, portão de enrolar para a rua na frente, escritório envidraçado no mezanino',
    threat: 'medium',
    present: [],
    messenger: {
      npc: {
        key: 'client',
        names: ['Sr. Holt', 'Dana Kurosawa', 'Mateus Varga'],
        role: 'Cliente que deixou o carro',
        description: 'Pagou adiantado em dinheiro vivo e pediu "nada de perguntas".',
        profile: { traits: ['frio', 'apressado', 'mentiroso'], voice: 'formal, nunca responde o que perguntam', motivation: 'recuperar o que está no carro sem testemunhas', fear: 'o empregador dele' },
        trust: 5,
        currentGoal: 'Recuperar o carro sem que ninguém abra o porta-malas.',
        secret: 'O porta-malas tem um drone de vigilância da Arasaka gravando tudo.',
      },
      text: () => 'Mudança de planos. Alguém vai buscar o carro às três. Não abra o porta-malas. O pagamento extra já está a caminho.',
      replies: ['O porta-malas tá apitando. Que porra é essa?', 'Quem vem buscar?'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: oficina de madrugada. O carro de ${n.client} (só por mensagem) tem algo no porta-malas que começou a apitar (segredo no contexto). Alguém vem buscar às 03:00. Mostre o ofício de ${c.bio.occupation} (ferramentas, diagnóstico, gambiarra). Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `O carro de ${n.client} ficou na oficina com algo apitando no porta-malas.`,
  },
  {
    key: 'net_cafe',
    label: 'Net café em Kabuki',
    blurb: 'Num fórum fantasma da Rede, alguém oferece um serviço que só você pode fazer.',
    weight: c => (role(c, 'netrunner') ? 5 : 0) + (job(c, /hack|program|dados|cripto|stream|trilheir/) ? 3 : 0),
    time: '2077-09-29T23:55:00.000Z',
    weather: 'Garoa ácida',
    place: () => ({ district: 'WATSON', subDistrict: 'Kabuki', spot: 'Net café "Fio Desencapado", cabine 7' }),
    title: () => 'Um sussurro na Rede',
    situation: (_c, n) => `Cabine alugada no Fio Desencapado. Um handle que ninguém conhece — ${n.ghost} — te chamou num fórum fantasma com uma proposta e um prazo curto.`,
    objective: (_c, n) => `Decidir se aceita o serviço de ${n.ghost} e descobrir quem está por trás.`,
    scene: () => 'Corredor comprido de cabines de plástico dos dois lados: balcão do dono na entrada, sua cabine no meio, sala dos servidores atrás de uma porta trancada no fundo, saída de emergência ao lado do banheiro',
    threat: 'low',
    present: [
      {
        key: 'owner',
        names: ['Wen "Pixel"', 'Bá Luong', 'Dory Kask'],
        role: 'Dono(a) do net café',
        description: 'Aluga cabines sem pedir documento e sabe quem está conectado a quê.',
        profile: { traits: ['desconfiado', 'curioso', 'mercenário'], voice: 'resmunga, fala em preços', motivation: 'pagar a proteção dos Tyger Claws', fear: 'NetWatch' },
        trust: 20,
      },
    ],
    messenger: {
      npc: {
        key: 'ghost',
        names: ['ghost.0x', 'n1ghtjar', 'velvet_null', 'S1LT'],
        role: 'Handle anônimo da Rede',
        description: 'Ninguém sabe quem é. Paga bem e some.',
        profile: { traits: ['enigmático', 'preciso', 'impaciente'], voice: 'minúsculas, sem pontuação, links quebrados', motivation: 'apagar um registro antes que alguém o leia', fear: 'ser rastreado' },
        trust: 0,
        currentGoal: 'Apagar um arquivo num servidor de uma clínica corporativa.',
        secret: 'O registro a apagar é o próprio prontuário: ghost é uma pessoa em fuga.',
      },
      text: (_c, n) => `${n.ghost}: vi teu trampo no fórum. servidor de clínica, um arquivo, 40 min. pago bem e adiantado metade. sim ou não`,
      replies: ['Quanto? E qual clínica?', 'Não trabalho pra quem não tem rosto.'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: net café em Kabuki, cabine alugada. ${n.ghost} (handle anônimo, só pela Rede/mensagem; há segredo) oferece um serviço de invasão. ${n.owner} (NA CENA) é o dono do café. Mostre o ofício de Trilheiro: interface, ruído, a cidade inteira passando pelos cabos. Se houver um ponto de acesso plausível, crie a net_architecture quando o jogador for em frente. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.ghost} ofereceu um serviço de invasão num fórum fantasma.`,
  },
  {
    key: 'bodyguard_shift',
    label: 'Fim de turno como segurança',
    blurb: 'Porta de clube em Japantown; seu cliente quer uma escolta que não está no contrato.',
    weight: c => (role(c, 'solo') ? 5 : 0) + (job(c, /seguran|guarda|leão de chácara|militar|merc/) ? 3 : 0),
    time: '2077-09-29T23:30:00.000Z',
    weather: 'Neon e chuva fina',
    place: () => ({ district: 'WESTBROOK', subDistrict: 'Japantown', spot: 'Porta do clube Kiseki, saída dos fundos' }),
    title: () => 'Hora extra em Japantown',
    situation: (_c, n) => `Seu turno como segurança terminou, mas ${n.client} — o cliente VIP da noite — quer que você o escolte até em casa. Agora. Por fora do contrato.`,
    objective: (_c, n) => `Decidir se leva ${n.client} para casa, e por que ele está com tanto medo.`,
    scene: () => 'Beco estreito atrás do clube: porta de serviço às suas costas, caçambas à esquerda, saída para a avenida à direita; do outro lado da avenida, um carro preto parado com o motor ligado',
    threat: 'medium',
    present: [
      {
        key: 'client',
        names: ['Hideo Mori', 'Caspian Reyes', 'Yuki Sandoval'],
        role: 'Cliente VIP do clube',
        description: 'Terno caro amassado, suor frio, olha para o carro preto a cada dez segundos.',
        profile: { traits: ['arrogante', 'apavorado', 'generoso quando com medo'], voice: 'mistura japonês e inglês, ordens disfarçadas de pedido', motivation: 'chegar vivo em casa', fear: 'o carro preto' },
        currentGoal: 'Chegar em casa sem cruzar com quem está no carro preto.',
        pending: 'Oferece pagar em dobro pela escolta.',
        secret: 'Ele deve uma fortuna aos Tyger Claws, e o carro é deles.',
      },
    ],
    messenger: {
      npc: {
        key: 'agency',
        names: ['Agência Kestrel', 'Escritório Ōkami', 'Segurança Halcyon'],
        role: 'Agência de segurança que te contrata',
        description: 'Te paga por turno e nunca atende depois da meia-noite.',
        profile: { traits: ['burocrática', 'fria'], voice: 'mensagens automáticas', motivation: 'evitar processo', fear: 'responsabilidade' },
        trust: 10,
      },
      text: () => 'AVISO AUTOMÁTICO: seu turno no Kiseki terminou às 23:30. Serviços fora do contrato não são cobertos pela agência nem pelo seguro.',
      replies: ['Entendido.', 'Quem paga o hospital se der ruim?'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: saída dos fundos de um clube em Japantown, fim do turno de segurança. ${n.client} (NA CENA) quer escolta por fora do contrato; um carro preto espera do outro lado da rua (segredo: Tyger Claws). A agência ${n.agency} (só mensagem) lavou as mãos. Mostre o Solo lendo a ameaça antes de qualquer tiro. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.client} pediu escolta por fora do contrato na saída do clube Kiseki.`,
  },
  {
    key: 'night_market_deal',
    label: 'Negócio no Mercado Noturno',
    blurb: 'Seu fornecedor não apareceu, e o comprador já está com a mão no bolso — ou na arma.',
    weight: c => (role(c, 'fixer') ? 5 : 0) + (job(c, /comerc|vende|negoc|camel|contrabando|atravess/) ? 3 : 0),
    time: '2077-09-29T22:45:00.000Z',
    weather: 'Abafado, cheiro de fritura e chuva',
    place: () => ({ district: 'WATSON', subDistrict: 'Kabuki', spot: 'Mercado Noturno de Kabuki, banca de eletrônicos' }),
    title: () => 'Ninguém fura com um Canal',
    situation: (_c, n) => `Você marcou de entregar um lote a ${n.buyer} no Mercado Noturno. O fornecedor, ${n.supplier}, sumiu e não responde. ${n.buyer} chegou na hora.`,
    objective: (_c, n) => `Segurar ${n.buyer} e descobrir por que ${n.supplier} sumiu.`,
    scene: () => 'Labirinto de bancas de lona sob um viaduto: sua banca de eletrônicos fica num cruzamento de corredores, com a escada para a passarela de um lado e o pedágio dos Tyger Claws na entrada principal',
    threat: 'medium',
    present: [
      {
        key: 'buyer',
        names: ['Bettina "Faca" Ruiz', 'Mr. Okoro', 'Jun Park'],
        role: 'Comprador(a) do lote',
        description: 'Pontual, educado(a), dois capangas encostados na banca ao lado.',
        profile: { traits: ['paciente até não ser', 'vingativo', 'formal'], voice: 'baixo, sorri ao ameaçar', motivation: 'reputação', fear: 'parecer fraco na frente dos homens' },
        currentGoal: 'Receber o lote combinado esta noite.',
        pending: 'Espera o lote que você prometeu.',
      },
    ],
    messenger: {
      npc: {
        key: 'supplier',
        names: ['Zezé Pinto', 'Moss', 'Tanaka-san'],
        role: 'Fornecedor do lote',
        description: 'Fornecedor de confiança. Até hoje.',
        profile: { traits: ['nervoso', 'ganancioso'], voice: 'áudios longos', motivation: 'sair da cidade', fear: 'Maelstrom' },
        trust: 30,
        secret: 'Vendeu o lote duas vezes e fugiu com o adiantamento da Maelstrom.',
      },
      text: () => 'mano desculpa. surgiu um problema. não vai ter lote hoje. NÃO conta pra ninguém que eu te liguei',
      replies: ['Que problema? Cadê você?', 'Você me deve, e vai pagar.'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: Mercado Noturno de Kabuki. ${n.buyer} (NA CENA, com capangas) espera um lote que não vai chegar; ${n.supplier} (só mensagem) sumiu (segredo no contexto). Mostre o Canal negociando com a lábia, os contatos e o relógio contra. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.supplier} furou o lote prometido a ${n.buyer} no Mercado Noturno.`,
  },
  {
    key: 'noodle_stall',
    label: 'Barraca de lámen na chuva',
    blurb: 'Uma tigela quente depois do trabalho, até alguém sentar ao seu lado com uma proposta.',
    weight: c => 1.8 + (role(c, 'medtech', 'tech') ? 0.5 : 0),
    time: '2077-09-29T21:30:00.000Z',
    weather: 'Chuva constante',
    place: c => ({ district: home(c).id, subDistrict: firstSub(c), spot: 'Barraca de lámen sob o viaduto' }),
    title: c => `Lámen e chuva em ${home(c).name}`,
    situation: (c, n) => `Fim do dia como ${c.bio.occupation.toLowerCase()}. Você come lámen sob o viaduto quando ${n.visitor} senta ao seu lado e pede a mesma coisa que você.`,
    objective: (_c, n) => `Ouvir o que ${n.visitor} quer — ou terminar o lámen em paz.`,
    scene: c => `Barraca estreita encostada num pilar do viaduto em ${home(c).name}: balcão em L com seis banquetas, o cozinheiro atrás do vapor, lona aberta para a rua dos dois lados`,
    threat: 'low',
    present: [
      {
        key: 'visitor',
        names: ['Irmã Celeste', 'Anton Grieg', 'Mika Sol', 'Dex Moreau'],
        role: 'Desconhecido(a) com uma proposta',
        description: 'Sabe demais sobre a sua vida para alguém que você nunca viu.',
        profile: { traits: ['gentil', 'insistente', 'misterioso'], voice: 'calmo, faz perguntas em vez de responder', motivation: 'recrutar alguém de confiança do bairro', fear: 'ser traído de novo' },
        currentGoal: 'Convencer o jogador a ajudar alguém do bairro em perigo.',
        pending: 'Tem uma proposta que paga pouco e importa muito.',
        secret: 'Trabalha para uma rede clandestina que tira gente das mãos das gangues.',
      },
    ],
    messenger: {
      npc: 'family',
      text: () => 'Comeu alguma coisa hoje? Tô preocupada com você e com essas contas. Me liga quando der.',
      replies: ['Comi. Tô bem, relaxa.', 'Tô resolvendo. Te ligo amanhã.'],
      fallback: { from: 'visitor', text: (c, n) => `Você não me conhece, mas eu conheço você, ${c.bio.handle}. Estou na barraca de lámen do viaduto. — ${n.visitor}`, replies: ['Quem é você?', 'Já estou aqui. Senta.'] },
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura calma: barraca de lámen sob o viaduto em ${home(c).name}, depois do trabalho. ${n.visitor} (NA CENA) traz uma proposta e sabe coisas sobre o jogador (segredo). A primeira mensagem do Agent é do laço familiar (fora da cena). Comece pequeno e humano; deixe o perigo crescer da conversa. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.visitor} sentou ao seu lado na barraca de lámen com uma proposta.`,
  },
  {
    key: 'delivery_run',
    label: 'No meio de uma entrega',
    blurb: 'O pacote que você carrega começou a vibrar, e o destinatário não atende.',
    weight: c => (job(c, /entreg|courier|mensageir|motoboy|delivery|encomend/) ? 5 : 0),
    time: '2077-09-29T22:10:00.000Z',
    weather: 'Garoa ácida',
    place: c => ({ district: home(c).id, subDistrict: firstSub(c), spot: 'Escadaria de um conjunto habitacional, 14º andar' }),
    title: () => 'Encomenda sem destinatário',
    situation: (_c, n) => `Última entrega da noite. O pacote para ${n.recipient} começou a vibrar na sua mochila, e ninguém abre a porta do apartamento 14-C.`,
    objective: () => 'Decidir o que fazer com um pacote que ninguém quer receber.',
    scene: () => 'Corredor comprido do 14º andar: elevador quebrado atrás de você, escada de incêndio na outra ponta, portas dos dois lados; no fim do corredor, a porta do 14-C arrombada, e a vizinha espiando pela fresta da porta ao lado',
    threat: 'medium',
    present: [
      {
        key: 'neighbor',
        names: ['Dona Fátima', 'Seu Arturo', 'Lin "Vó" Chao'],
        role: 'Vizinha(o) curiosa(o) do 14º andar',
        description: 'Espia pela fresta da porta e sabe tudo que acontece no andar.',
        profile: { traits: ['fofoqueira', 'corajosa', 'solitária'], voice: 'fala sem parar, mistura conselhos e reclamações', motivation: 'ter com quem conversar', fear: 'a gangue do térreo' },
        trust: 15,
      },
    ],
    messenger: {
      npc: {
        key: 'recipient',
        names: ['M. Castell', 'R. Vance', 'J. Oduya'],
        role: 'Destinatário(a) do pacote',
        description: 'Só um nome numa etiqueta. Pagou o frete expresso em cripto.',
        profile: { traits: ['fugitivo', 'desesperado'], voice: 'mensagens truncadas', motivation: 'pegar o pacote sem ser visto', fear: 'quem arrombou a porta' },
        trust: 0,
        secret: 'Fugiu do apartamento minutos antes de alguém arrombar a porta.',
      },
      text: () => 'NÃO deixa o pacote no 14-C. Me encontra no terraço. Rápido. Por favor.',
      replies: ['Quem é você? O que tem no pacote?', 'Subindo. Mas a taxa dobrou.'],
    },
    knowsRafa: true,
    hook: (c, n) => `Abertura: no meio de uma entrega, 14º andar de um conjunto habitacional em ${home(c).name}. O pacote vibra; ${n.recipient} (só mensagem; há segredo) pede encontro no terraço; ${n.neighbor} (NA CENA) espia e sabe de algo. Uma porta arrombada no fim do corredor. Ofício: ${c.bio.occupation}. Pressão: ${pressure(c)}.`,
    memory: (_c, n) => `${n.recipient} pediu para não deixar o pacote no 14-C e marcou no terraço.`,
  },
];

export const findOpening = (key: string | undefined) => OPENINGS.find(o => o.key === key);

/** Aberturas que servem para este personagem, da mais provável para a menos (tela de criação). */
export function openingsFor(c: Character): OpeningDef[] {
  return OPENINGS.filter(o => o.weight(c) > 0 && openingFitsLife(c, o.key)).sort((a, b) => b.weight(c) - a.weight(c));
}

/** Sorteia uma abertura coerente (peso pelo papel e pela história). O clássico entra com peso baixo. */
export function pickOpening(c: Character, rng: Rng): OpeningDef {
  const pool = openingsFor(c);
  const total = pool.reduce((n, o) => n + o.weight(c), 0);
  let roll = (rng(10_000) / 10_000) * total;
  for (const o of pool) {
    roll -= o.weight(c);
    if (roll <= 0) return o;
  }
  return pool[pool.length - 1];
}

// ---------------------------------------------------------------- aplicação

function npcFrom(seed: SeedNpc, name: string, location: string, extra: Partial<Npc>): Npc {
  return {
    id: `npc_${seed.key}_${makeId('o').slice(-5)}`,
    name,
    role: seed.role,
    description: seed.description,
    trust: seed.trust ?? 0,
    respect: 30,
    fear: seed.fear ?? 0,
    anger: 0,
    knowledge: seed.secret ? [{ id: makeId('fact'), fact: seed.secret, secret: true, playerKnows: 'no', weight: 2 }] : [],
    status: 'alive',
    isContact: false,
    profile: { ...seed.profile, traits: [...seed.profile.traits] },
    currentGoal: seed.currentGoal,
    currentGoalKnown: seed.goalKnown,
    pendingMatters: seed.pending,
    location,
    importance: 'recurring',
    ...extra,
  };
}

/** Missão-guia: dá à abertura um objetivo rastreável sem inventar recompensa nem duplicar o corre real. */
function firstJobMission(state: GameState, title: string, objective: string) {
  if (state.missions.some(m => m.id === 'm_first_job')) return state.missions;
  return [
    {
      id: 'm_first_job',
      title: `Primeiro corre: ${title}`,
      description: 'Seu primeiro corre em Night City.',
      objective,
      status: 'ACTIVE' as const,
      rewardEddies: 0,
      // Papel, perfil e instruções ficam no contexto do Mestre e no modal opcional; o Diário só mostra a missão do personagem.
      notes: [],
      startedTurn: 0,
    },
    ...state.missions,
  ];
}

/**
 * Transforma a campanha clássica (initialState) na abertura escolhida: lugar, hora, cena, gente nova e a
 * primeira mensagem de quem faz sentido. O Rafa fica no elenco, sem mensagem e sem corre pendente.
 */
export function applyOpening(state: GameState, opening: OpeningDef, rng: Rng, rafaId: string, familyId: string): GameState {
  if (opening.key === CLASSIC_OPENING) {
    const objective = 'Responder a Rafa pelo Agent e decidir o que vale o risco de aceitar o corre.';
    const tutorial = firstJobTutorial(state.character);
    return {
      ...state,
      world: { ...state.world, objective, opening: { key: opening.key, title: opening.label, hook: '', tutorial } },
      missions: firstJobMission(state, 'a proposta do Rafa', objective),
    };
  }
  const c = state.character;
  const pick = (names: string[]) => names[rng(names.length) - 1];
  const place = opening.place(c);
  const names: Names = {};
  for (const seed of opening.present) names[seed.key] = pick(seed.names);
  const messengerSeed = opening.messenger.npc === 'family' ? null : opening.messenger.npc;
  if (messengerSeed) names[messengerSeed.key] = pick(messengerSeed.names);
  const familyNpc = state.npcs.find(n => n.id === familyId && n.kind !== 'animal');

  const present = opening.present.map(seed => npcFrom(seed, names[seed.key], place.district, { lastInteraction: undefined }));
  // Sem laço humano para mandar a mensagem, quem manda é alguém da própria cena (via Agent).
  const messengerNpc = messengerSeed ? npcFrom(messengerSeed, names[messengerSeed.key], place.district, { isContact: true }) : null;
  const fallback = !messengerNpc && !familyNpc ? opening.messenger.fallback : undefined;
  const fallbackIdx = fallback ? opening.present.findIndex(p => p.key === fallback.from) : -1;
  const fromId = messengerNpc?.id ?? familyNpc?.id ?? (fallbackIdx >= 0 ? present[fallbackIdx].id : present[0]?.id);
  if (fallbackIdx >= 0) present[fallbackIdx] = { ...present[fallbackIdx], isContact: true };

  const rafa = state.npcs.find(n => n.id === rafaId);
  const quietRafa: Npc | undefined = rafa && {
    ...rafa,
    // Canônico e sempre possível, mas sem corre pendente nem mensagem: ele surge quando a história pedir.
    pendingMatters: undefined,
    currentGoal: 'Ganhar nome como canal de rua com clientela própria.',
    currentGoalKnown: false,
    isContact: opening.knowsRafa,
    trust: opening.knowsRafa ? 10 : 0,
    lastInteraction: undefined,
    knowledge: rafa.knowledge.filter(k => !/corre|chip roubado/i.test(k.fact)),
  };
  const others = state.npcs.filter(n => n.id !== rafaId);
  const npcs = [...(quietRafa ? [quietRafa] : []), ...others, ...present, ...(messengerNpc ? [messengerNpc] : [])];

  const clock = new Date(opening.time);
  const time = clock.toISOString();
  const hhmm = `${String(clock.getUTCHours()).padStart(2, '0')}:${String(clock.getUTCMinutes()).padStart(2, '0')}`;
  const text = (fallback ?? opening.messenger).text(c, names);
  const phone = fromId ? [{ npcId: fromId, unread: 1, suggestedReplies: (fallback ?? opening.messenger).replies, messages: [{ id: makeId('pm'), from: 'npc' as const, time: hhmm, text }] }] : [];

  const rafaLine = opening.knowsRafa
    ? `Rafa "Zero-Um" (canal de rua do bairro, [${rafaId}]) é conhecido do jogador e faz parte do elenco: pode surgir mais adiante, quando fizer sentido — não o traga no prólogo nem o faça mandar mensagem sem motivo.`
    : `Rafa "Zero-Um" ([${rafaId}], canal de rua de Night City) existe no mundo, mas o jogador ainda NÃO o conhece: pode cruzar o caminho dele mais adiante, quando a história pedir. Não o use no prólogo.`;
  const hook = `${opening.hook(c, names)}\nPresentes na cena: ${present.map(n => `[${n.id}] ${n.name}`).join(', ') || 'ninguém além do jogador'}. Primeira mensagem do Agent: ${fromId ? `[${fromId}] ${npcs.find(n => n.id === fromId)?.name}` : '—'} ("${text}").\n${rafaLine}`;
  const objective = opening.objective(c, names);
  const tutorial = firstJobTutorial(c);

  return {
    ...state,
    title: opening.title(c),
    world: {
      ...state.world,
      time,
      location: place,
      weather: opening.weather,
      situation: opening.situation(c, names),
      objective,
      opening: { key: opening.key, title: opening.label, hook, tutorial },
    },
    scene: { ...state.scene, description: opening.scene(c, names), presentNpcIds: present.map(n => n.id), threat: opening.threat },
    npcs,
    phone,
    missions: firstJobMission(state, opening.label, objective),
    // A insistência agendada do Rafa só faz sentido na abertura clássica.
    scheduled: state.scheduled.filter(e => !('npcId' in e.action && e.action.npcId === rafaId)),
    memories: [...state.memories.filter(m => m.subject !== rafaId), { id: makeId('mem'), type: 'NPC_MEMORY', subject: present[0]?.id ?? fromId ?? 'player', content: opening.memory(c, names), importance: 7, confidence: 1, createdTurn: 0, lastRelevantTurn: 0, tags: ['abertura'] }],
    events: state.events.map((e, i) => (i === 0 ? { ...e, time, summary: `Campanha iniciada: ${c.bio.handle} — ${opening.label}.` } : e)),
  };
}
