/** Base de lore consultável pela ferramenta lookup_lore (fatos fixos do cenário). */
export interface LoreEntry {
  id: string;
  title: string;
  tags: string[];
  text: string;
}

export const LORE: readonly LoreEntry[] = [
  { id: 'arasaka', title: 'Arasaka', tags: ['megacorp', 'corporação', 'segurança', 'japão'], text: 'Megacorporação japonesa de segurança e bancos. Domina City Center e mantém um exército privado. Rancorosa, paciente e implacável.' },
  { id: 'militech', title: 'Militech', tags: ['megacorp', 'armas', 'corporação', 'eua'], text: 'Fabricante de armas ligada ao governo dos NUSA. Rival histórica da Arasaka. Protege carga com equipes de resposta rápida.' },
  { id: 'maelstrom', title: 'Maelstrom', tags: ['gangue', 'watson', 'cromo', 'northside'], text: 'Gangue de Northside obcecada por implantes extremos. Violenta, imprevisível, beira a ciberpsicose.' },
  { id: 'tyger_claws', title: 'Tyger Claws', tags: ['gangue', 'watson', 'japantown', 'kabuki'], text: 'Gangue de origem japonesa que controla cassinos, bordéis e extorsão em Kabuki e Japantown.' },
  { id: 'valentinos', title: 'Valentinos', tags: ['gangue', 'heywood', 'família'], text: 'Gangue latina de Heywood. Honra, família e fé. Protegem o bairro, mas não perdoam traição.' },
  { id: 'sixth_street', title: '6th Street', tags: ['gangue', 'santo domingo', 'veteranos'], text: 'Veteranos de guerra que se tornaram gangue. Patriotas armados até os dentes em Santo Domingo.' },
  { id: 'voodoo_boys', title: 'Voodoo Boys', tags: ['gangue', 'pacifica', 'netrunner', 'trilheiro'], text: 'Trilheiros haitianos de Pacifica. Buscam o que existe além da Muralha Negra. Não confiam em estranhos.' },
  { id: 'ncpd', title: 'NCPD', tags: ['polícia', 'lei', 'max-tac'], text: 'Polícia de Night City, terceirizada, corrupta e sobrecarregada. A MAX-TAC cuida dos ciberpsicopatas — sem prisioneiros.' },
  { id: 'trauma_team', title: 'Equipe de Trauma', tags: ['medicina', 'resgate', 'corporação'], text: 'Resgate médico armado por assinatura. Chega em AV em minutos para clientes do plano — e ignora quem não paga.' },
  { id: 'afterlife', title: 'Afterlife', tags: ['bar', 'mercenários', 'canais', 'watson'], text: 'Bar de mercenários num antigo necrotério. Onde lendas bebem e canais fecham contratos.' },
  { id: 'eddies', title: 'Eurodólares (eddies)', tags: ['dinheiro', 'economia', 'eddies'], text: 'A moeda de Night City. Um pente de munição básica custa ~10 €$; uma pistola, 50–100 €$; um aluguel de cubículo, algumas centenas por semana.' },
  { id: 'cyberpsychosis', title: 'Ciberpsicose', tags: ['humanidade', 'implantes', 'cromo'], text: 'Perda de empatia causada por excesso de implantes. Quando a Humanidade cai demais, a pessoa vira ameaça — e a MAX-TAC aparece.' },
  { id: 'netwatch', title: 'NetWatch', tags: ['rede', 'net', 'trilheiro', 'muralha negra'], text: 'Polícia da Rede. Guarda a Muralha Negra que separa a Net das IAs renegadas.' },
  { id: 'watson', title: 'Watson', tags: ['distrito', 'kabuki', 'little china', 'northside'], text: 'Distrito denso e decadente após a saída da Arasaka. Mercados pretos, Maelstrom ao norte e Tyger Claws em Kabuki.' },
  { id: 'heywood', title: 'Heywood', tags: ['distrito', 'valentinos', 'glen'], text: 'Distrito residencial de maioria latina. Do luxo do Glen às vielas de Vista del Rey.' },
  { id: 'pacifica', title: 'Pacifica', tags: ['distrito', 'voodoo boys', 'dogtown'], text: 'Resort abandonado pelos investidores. Terra sem lei entregue a gangues e refugiados.' },
];

export function searchLore(query: string, max = 3): LoreEntry[] {
  const q = query.toLowerCase();
  const words = q.split(/\W+/).filter(w => w.length > 2);
  return LORE.map(e => {
    const hay = `${e.title} ${e.tags.join(' ')} ${e.text}`.toLowerCase();
    let score = 0;
    if (q.includes(e.title.toLowerCase())) score += 10;
    for (const w of words) if (hay.includes(w)) score += e.tags.some(t => t.includes(w)) ? 3 : 1;
    return { e, score };
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(x => x.e);
}
