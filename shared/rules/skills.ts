import type { StatKey } from '../types/game';

export type SkillCategory = 'Combate' | 'Ação' | 'Percepção' | 'Técnica' | 'Social' | 'Conhecimento';

export interface SkillDefinition {
  id: string;
  label: string;
  stat: StatKey;
  category: SkillCategory;
  description: string;
  /** Todo personagem começa com nível 2 nas perícias básicas (Cyberpunk RED). */
  basic?: boolean;
  aliases: string[];
}

/** Lista CANÔNICA de perícias. Criação, sanitizer, prompt e motor usam apenas estes ids. */
export const SKILLS: readonly SkillDefinition[] = [
  // Combate
  { id: 'handgun', label: 'Pistolas', stat: 'REF', category: 'Combate', description: 'Pistolas, revólveres e submetralhadoras.', aliases: ['handgun', 'pistola', 'pistolas', 'revolver', 'revólver', 'armas de fogo de mão', 'armas de fogo', 'smg', 'submetralhadora'] },
  { id: 'shoulder_arms', label: 'Armas Longas', stat: 'REF', category: 'Combate', description: 'Fuzis, escopetas e rifles de precisão.', aliases: ['shoulder arms', 'fuzil', 'fuzis', 'rifle', 'rifles', 'escopeta', 'espingarda', 'armas de ombro', 'armas longas', 'sniper'] },
  { id: 'archery', label: 'Arquearia', stat: 'REF', category: 'Combate', description: 'Arcos e bestas.', aliases: ['archery', 'arco', 'besta', 'arquearia'] },
  { id: 'melee_weapon', label: 'Armas Brancas', stat: 'DEX', category: 'Combate', description: 'Facas, lâminas, tacos e katanas.', aliases: ['melee weapon', 'melee', 'arma branca', 'armas brancas', 'faca', 'lâmina', 'katana'] },
  { id: 'brawling', label: 'Briga', stat: 'DEX', category: 'Combate', description: 'Socos, chutes e agarrões.', basic: true, aliases: ['brawling', 'briga', 'luta', 'luta desarmada', 'soco', 'desarmado'] },
  { id: 'evasion', label: 'Evasão', stat: 'DEX', category: 'Combate', description: 'Esquivar de golpes e, com REF 8+, de projéteis.', basic: true, aliases: ['evasion', 'evasão', 'esquiva', 'esquivar'] },

  // Ação
  { id: 'athletics', label: 'Atletismo', stat: 'DEX', category: 'Ação', description: 'Correr, saltar, escalar e arremessar.', basic: true, aliases: ['athletics', 'atletismo', 'escalar', 'saltar', 'correr'] },
  { id: 'stealth', label: 'Furtividade', stat: 'DEX', category: 'Ação', description: 'Mover-se sem ser visto ou ouvido.', basic: true, aliases: ['stealth', 'furtividade', 'esconder', 'se esconder', 'furtivo'] },
  { id: 'drive', label: 'Pilotar Veículo', stat: 'REF', category: 'Ação', description: 'Carros e motos em perseguições.', aliases: ['drive', 'dirigir', 'pilotar', 'pilotagem', 'veículo'] },
  { id: 'endurance', label: 'Resistência', stat: 'WILL', category: 'Ação', description: 'Aguentar fadiga, fome e ambientes hostis.', aliases: ['endurance', 'resistência', 'resistencia', 'fôlego'] },
  { id: 'resist_torture', label: 'Resistir a Tortura/Drogas', stat: 'WILL', category: 'Ação', description: 'Resistir a interrogatórios e substâncias.', aliases: ['resist torture', 'resist torture/drugs', 'resistir a tortura', 'drogas', 'toxinas'] },

  // Percepção
  { id: 'perception', label: 'Percepção', stat: 'INT', category: 'Percepção', description: 'Notar emboscadas, pistas e detalhes.', basic: true, aliases: ['perception', 'percepção', 'percepcao', 'notar', 'observar'] },
  { id: 'concentration', label: 'Concentração', stat: 'WILL', category: 'Percepção', description: 'Manter o foco sob estresse.', basic: true, aliases: ['concentration', 'concentração', 'foco'] },
  { id: 'conceal_reveal', label: 'Ocultar/Revelar Objeto', stat: 'INT', category: 'Percepção', description: 'Esconder ou encontrar objetos.', aliases: ['conceal', 'reveal', 'ocultar', 'revelar', 'procurar', 'revistar'] },
  { id: 'tracking', label: 'Rastreamento', stat: 'INT', category: 'Percepção', description: 'Seguir rastros e pessoas.', aliases: ['tracking', 'rastrear', 'rastreamento', 'seguir'] },
  { id: 'human_perception', label: 'Percepção Humana', stat: 'EMP', category: 'Percepção', description: 'Detectar mentiras, medo e intenções.', basic: true, aliases: ['human perception', 'percepção humana', 'psicologia', 'ler pessoas', 'intuição', 'detectar mentira'] },

  // Técnica
  { id: 'basic_tech', label: 'Tecnologia Básica', stat: 'TECH', category: 'Técnica', description: 'Consertar aparelhos, veículos e máquinas.', aliases: ['basic tech', 'tecnologia básica', 'consertar', 'reparo', 'mecânica'] },
  { id: 'cybertech', label: 'Cibertecnologia', stat: 'TECH', category: 'Técnica', description: 'Manutenção e reparo de ciberware.', aliases: ['cybertech', 'cibertecnologia', 'ciberware', 'implante'] },
  { id: 'electronics_security', label: 'Eletrônica/Segurança', stat: 'TECH', category: 'Técnica', description: 'Burlar fechaduras eletrônicas, câmeras e alarmes.', aliases: ['electronics', 'security tech', 'eletrônica', 'eletronica', 'segurança eletrônica', 'alarme', 'câmera', 'fechadura eletrônica'] },
  { id: 'first_aid', label: 'Primeiros Socorros', stat: 'TECH', category: 'Técnica', description: 'Estabilizar e tratar ferimentos.', basic: true, aliases: ['first aid', 'primeiros socorros', 'curar', 'estabilizar', 'medicina'] },
  { id: 'weaponstech', label: 'Armeiro', stat: 'TECH', category: 'Técnica', description: 'Manutenção e modificação de armas.', aliases: ['weaponstech', 'armeiro', 'consertar arma'] },
  { id: 'pick_lock', label: 'Arrombamento', stat: 'TECH', category: 'Técnica', description: 'Abrir fechaduras mecânicas.', aliases: ['pick lock', 'arrombar', 'arrombamento', 'gazua', 'lockpick'] },
  { id: 'interface', label: 'Interface (Netrunning)', stat: 'INT', category: 'Técnica', description: 'Invadir sistemas e navegar a Rede.', aliases: ['interface', 'hacking', 'hack', 'netrunning', 'trilha', 'trilheiro', 'invadir sistema'] },

  // Social
  { id: 'conversation', label: 'Conversação', stat: 'EMP', category: 'Social', description: 'Extrair informação em conversa casual.', basic: true, aliases: ['conversation', 'conversação', 'conversa', 'lábia', 'blefe', 'blefar'] },
  { id: 'persuasion', label: 'Persuasão', stat: 'COOL', category: 'Social', description: 'Convencer, negociar e enganar.', basic: true, aliases: ['persuasion', 'persuasão', 'persuadir', 'convencer', 'mentir', 'enganar'] },
  { id: 'interrogation', label: 'Intimidação/Interrogatório', stat: 'COOL', category: 'Social', description: 'Arrancar informação pela ameaça.', aliases: ['interrogation', 'intimidation', 'intimidação', 'intimidar', 'interrogatório', 'ameaçar'] },
  { id: 'streetwise', label: 'Manha das Ruas', stat: 'COOL', category: 'Social', description: 'Contatos, gírias e mercado negro.', aliases: ['streetwise', 'manha das ruas', 'manha', 'submundo', 'mercado negro'] },
  { id: 'trading', label: 'Comércio', stat: 'COOL', category: 'Social', description: 'Comprar, vender e barganhar.', aliases: ['trading', 'comércio', 'negociação', 'negociar', 'barganhar', 'pechinchar'] },
  { id: 'bribery', label: 'Suborno', stat: 'COOL', category: 'Social', description: 'Saber quem, quanto e como pagar.', aliases: ['bribery', 'suborno', 'subornar', 'propina'] },
  { id: 'personal_grooming', label: 'Estilo Pessoal', stat: 'COOL', category: 'Social', description: 'Aparência e atitude que abrem portas.', aliases: ['personal grooming', 'estilo', 'sedução', 'aparência'] },

  // Conhecimento
  { id: 'local_expert', label: 'Especialista Local', stat: 'INT', category: 'Conhecimento', description: 'Ruas, rotas de fuga e zonas de Night City.', basic: true, aliases: ['local expert', 'especialista local', 'conhecimento local', 'geografia', 'rotas'] },
  { id: 'education', label: 'Educação', stat: 'INT', category: 'Conhecimento', description: 'Conhecimento geral e leitura.', basic: true, aliases: ['education', 'educação', 'conhecimento geral'] },
  { id: 'deduction', label: 'Dedução', stat: 'INT', category: 'Conhecimento', description: 'Juntar pistas e tirar conclusões.', aliases: ['deduction', 'dedução', 'deduzir', 'investigar', 'investigação'] },
  { id: 'library_search', label: 'Pesquisa', stat: 'INT', category: 'Conhecimento', description: 'Pesquisar na Rede e em arquivos.', aliases: ['library search', 'pesquisa', 'pesquisar', 'buscar dados'] },
];

const SKILL_BY_ID = new Map(SKILLS.map(s => [s.id, s]));

export function getSkill(id: string | null | undefined): SkillDefinition | undefined {
  return id ? SKILL_BY_ID.get(id) : undefined;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX: Array<{ alias: string; id: string }> = SKILLS.flatMap(s =>
  [s.id.replace(/_/g, ' '), s.label, ...s.aliases].map(a => ({ alias: normalize(a), id: s.id })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Resolve texto livre (vindo do LLM) para um id canônico.
 * Ordem: id exato → alias exato → alias como palavra inteira dentro do texto (mais longo primeiro).
 */
export function resolveSkillId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  if (SKILL_BY_ID.has(raw.trim())) return raw.trim();

  const candidates = [normalize(raw)];
  const inParens = raw.match(/\(([^)]+)\)/);
  if (inParens) candidates.push(normalize(inParens[1]));

  for (const text of candidates) {
    const exact = ALIAS_INDEX.find(a => a.alias === text);
    if (exact) return exact.id;
  }
  for (const text of candidates) {
    const padded = ` ${text} `;
    const partial = ALIAS_INDEX.find(a => a.alias.length >= 4 && padded.includes(` ${a.alias} `));
    if (partial) return partial.id;
  }
  return null;
}

/** Custo em PM (pontos de melhoria) para subir uma perícia ao nível alvo. */
export function skillUpgradeCost(targetLevel: number): number {
  return targetLevel * 20;
}

export const MAX_SKILL_LEVEL = 10;
