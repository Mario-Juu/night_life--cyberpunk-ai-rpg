/**
 * Gírias de Night City (streetslang de Cyberpunk, em PT-BR).
 * Usadas pelo Mestre para a fala soar orgânica — e listadas nas Regras para o jogador.
 */

export interface SlangTerm {
  term: string;
  meaning: string;
  /** Quem costuma falar assim (ajuda o Mestre a variar pela voz do NPC). */
  who?: string;
}

export const SLANG: SlangTerm[] = [
  { term: 'Choom / Choomba / Choombette', meaning: 'amigo, parceiro, irmão (tratamento amigável)', who: 'todo mundo na rua' },
  { term: 'Biz', meaning: 'trabalho, negócio (quase sempre ilegal)' },
  { term: 'Ganger', meaning: 'membro de gangue' },
  { term: 'Input / Output', meaning: 'caso casual com uma mulher / com um homem' },
  { term: 'Rimbo', meaning: 'mulher encrenqueira e agressiva ("Rambo" + "bimbo")', who: 'rua, ofensivo' },
  { term: 'Scop', meaning: 'proteína sintética; a comida barata de todo dia' },
  { term: 'Haze', meaning: 'armação, emboscada, golpe ("aquele trampo era um haze")' },
  { term: 'Holo', meaning: 'ligação pelo Agent ou neuroport' },
  { term: 'Flick', meaning: 'arquivo, vídeo' },
  { term: 'Draga', meaning: 'caro demais, sem justificativa' },
  { term: 'Eddies / Eddinhos', meaning: 'eurodólares (€$)' },
  { term: 'Edge / Edgerunner', meaning: 'a margem da sociedade / quem vive nela (mercenários, criminosos)' },
  { term: 'Cromo / Cromado', meaning: 'implantes / alguém cheio deles' },
  { term: 'Ganic', meaning: 'alguém com pouco ou nenhum cromo ("orgânico")' },
  { term: 'Borg', meaning: 'alguém de corpo quase todo artificial (Linear Frame, conversão total)' },
  { term: 'Enferrujado', meaning: 'quem usa cromo barato e velho' },
  { term: 'Distintivo', meaning: 'policial' },
  { term: 'Flatline / Zerar', meaning: 'matar; "flatlinado" = morto' },
  { term: 'Preem', meaning: 'ótimo, de primeira ("supreme"/"premium")' },
  { term: 'Hard', meaning: 'irado, descolado' },
  { term: 'Dar o delta', meaning: 'sair correndo, dar o fora' },
  { term: 'Fantasmar', meaning: 'sumir ("vai fantasmar")' },
  { term: 'Giri', meaning: 'dívida de honra, obrigação', who: 'Tyger Claws, gente de Japantown' },
  { term: 'Gomi', meaning: 'lixo, escória', who: 'Tyger Claws, Japantown' },
  { term: 'Neh', meaning: 'né? — fecha pergunta', who: 'Japantown' },
  { term: 'Detes', meaning: 'detalhes' },
  { term: 'Gato', meaning: 'pessoa legal, gente boa', who: 'Heywood, Valentinos' },
  { term: 'Passar o Gibson', meaning: 'dar a letra, orientar alguém' },
  { term: 'Boneca', meaning: 'quem tem implante de boneca (programada para trabalhar)' },
  { term: 'Hexed', meaning: 'pirado, à beira da ciberpsicose ("você tá hexed")' },
  { term: 'Ferro', meaning: 'arma' },
  { term: 'Jack', meaning: 'dinheiro' },
  { term: 'No ar', meaning: 'a caminho ("seus eddies tão no ar")' },
  { term: 'Joytoy', meaning: 'profissional do sexo' },
  { term: 'Klepar / Klepado', meaning: 'roubar / roubado' },
  { term: 'Deckhead', meaning: 'netrunner, trilheiro' },
  { term: 'Corporato', meaning: 'corporativo, engravatado' },
  { term: 'Abutre', meaning: 'repórter, gente da mídia' },
  { term: 'C-ya', meaning: 'tchau (por mensagem)', who: 'SMS no Agent' },
  { term: 'Conapt', meaning: 'apartamento caro' },
  { term: 'Stim', meaning: 'droga, estimulante' },
  { term: 'Booster', meaning: 'viciado; gangue que vive de cromo e droga' },
  { term: 'Sitch', meaning: 'situação ("qual é a sitch?")' },
  { term: 'Svolouch', meaning: 'desgraçado, sem honra', who: 'gente de origem russa/leste europeu' },
  { term: 'Yono', meaning: 'vagabundo', who: 'gente de origem coreana' },
  { term: 'Ronin', meaning: 'mercenário solto, sem patrão' },
  { term: 'Samurai / Ninja', meaning: 'assassino ou guarda-costas corporativo / o de elite, cheio de cromo' },
  { term: 'Caco', meaning: 'datashard' },
  { term: 'Who', meaning: 'o chefe que não se nomeia em vão', who: 'corporatos' },
  { term: 'Medicânico', meaning: 'médico de implante, clandestino (ripperdoc)' },
  { term: 'Gritador', meaning: 'jornal, screamsheet' },
  { term: 'Huscle', meaning: 'guarda-costas contratado ("hired muscle")' },
  { term: 'Gonk', meaning: 'idiota, burro' },
];

/** Bloco para o prompt: termo = sentido (quem fala). */
export function slangForPrompt(): string {
  return SLANG.map(s => `${s.term} = ${s.meaning}${s.who ? ` [${s.who}]` : ''}`).join('; ');
}
