/**
 * Catálogo de átomos de história (conteúdo). Formato e regras em ./storyAtoms.ts.
 * Inspirações (só a ideia, reescrita): gigs do Cyberpunk 2077, DLCs gratuitos e screamsheets do RED,
 * Cyberpunk: Edgerunners, Neuromancer, Blade Runner, Johnny Mnemonic, Strange Days, Dredd, Chinatown,
 * Fogo contra Fogo, Yojimbo, Os Sete Samurais, The Wire, RoboCop, Ghost in the Shell, Akira.
 */
import type { StoryCatalog } from './storyAtoms';

export const STORY_CATALOG: StoryCatalog = {
  premises: [
    { key: 'compra_de_dividas', text: '{who} está comprando dívidas de rua por uma fração do valor e cobrando os devedores através de {place}; quem não paga trabalha de graça para eles.', needs: ['money'], needsAny: ['street', 'corp'], tags: ['money', 'street'], hooks: ['divida'], arcs: ['escalada_de_cobranca', 'guerra_de_territorio'], places: ['cassino_pachinko', 'escritorio_microcredito', 'casa_penhores'] },
    { key: 'recrutamento_descartavel', text: '{who} recruta mercenários de primeira viagem em {place}, perdoando dívidas como pagamento; quem aceita some depois do primeiro serviço.', needs: ['violence'], needsAny: ['money', 'corp'], tags: ['violence', 'money', 'street'], hooks: ['divida', 'trabalho'], arcs: ['contagem_do_golpe', 'desaparecimentos_em_serie', 'escalada_de_cobranca'], places: ['barraca_lamen', 'oficina_garagem', 'boate_vip', 'ringue_estacionamento'] },
    { key: 'lote_ciberpsicose', text: 'Os ciberpsicopatas recentes de {district} instalaram implantes do mesmo lote barato vendido em {place}; {who} está queimando os registros.', needs: ['cyber'], needsAny: ['corp', 'street', 'smuggling'], tags: ['cyber', 'medical', 'violence'], hooks: ['familia', 'trabalho'], arcs: ['desaparecimentos_em_serie', 'apagao_de_testemunhas'], places: ['clinica_ripper_porao', 'mercado_noturno', 'casa_penhores'] },
    { key: 'prototipo_na_entrega', text: 'Um protótipo de {who} foi roubado e escondido dentro de uma entrega comum que passou pela mão do personagem; os dois lados acham que ele sabe de algo.', needs: [], needsAny: ['corp', 'net'], tags: ['corp', 'cyber', 'smuggling'], hooks: ['trabalho'], arcs: ['vazamento_e_cacada', 'apagao_de_testemunhas'] },
    { key: 'clinica_cobaia', text: '{place} oferece tratamento grátis para quem não tem seguro; os pacientes são cobaias de {who} e alguns voltam "diferentes".', needs: [], needsAny: ['medical', 'chem'], tags: ['medical', 'corp', 'chem'], hooks: ['familia', 'divida'], arcs: ['desaparecimentos_em_serie', 'epidemia_quimica'], places: ['clinica_caridade', 'clinica_ripper_porao'] },
    { key: 'droga_obediencia', text: 'Uma droga nova distribuída por {who} em {place} deixa os usuários dóceis e obedientes a um sinal de áudio escondido nos anúncios de rua.', needs: ['chem'], needsAny: ['street', 'corp'], tags: ['chem', 'street', 'media'], hooks: ['familia'], arcs: ['epidemia_quimica'], places: ['boate_vip', 'mercado_noturno', 'barraca_lamen'] },
    { key: 'bd_morte_real', text: 'Braindances com mortes reais de {victim} circulam no mercado clandestino; a produção é de {who} e a próxima gravação já está marcada.', needs: [], needsAny: ['media', 'net'], tags: ['media', 'net', 'violence'], hooks: ['familia'], arcs: ['desaparecimentos_em_serie', 'apagao_de_testemunhas'] },
    { key: 'courier_cabeca_cheia', text: 'Um courier com dados no próprio implante de memória precisa atravessar {district} antes que o dado o mate; {who} quer o dado.', needs: [], needsAny: ['net', 'corp', 'smuggling'], tags: ['net', 'smuggling', 'cyber'], hooks: ['trabalho'], arcs: ['vazamento_e_cacada'] },
    { key: 'esvaziar_quarteirao', text: '{who} provoca incêndios, cortes de água e despejos "acidentais" para esvaziar um quarteirão de {district} que alguém quer comprar barato.', needs: [], needsAny: ['money', 'corp', 'politics'], tags: ['politics', 'money', 'corp'], hooks: ['familia', 'divida'], arcs: ['tomada_do_quarteirao'] },
    { key: 'dois_senhores', text: '{who} e um rival travam uma guerra fria em {district}; os dois querem informantes e pagam bem, até descobrirem quem joga dos dois lados.', needs: ['violence', 'street'], tags: ['violence', 'street'], hooks: ['trabalho', 'divida'], arcs: ['guerra_de_territorio'] },
    { key: 'bloco_sitiado', text: 'Os moradores de {place} pagam pedágio semanal a {who}; juntaram dinheiro para contratar defensores e precisam de alguém que conheça todo mundo.', needs: ['violence'], needsAny: ['street', 'smuggling'], tags: ['violence', 'street', 'money'], hooks: ['familia'], arcs: ['escalada_de_cobranca', 'guerra_de_territorio'], places: ['megapredio', 'mercado_noturno'] },
    { key: 'culpados_sob_encomenda', text: 'A estatística de crimes de {district} precisa cair antes da eleição; {who} fornece "culpados" sequestrando {victim}.', needs: ['politics'], needsAny: ['violence', 'money'], tags: ['politics', 'violence', 'street', 'police'], hooks: ['familia', 'trabalho'], arcs: ['operacao_policial_suja'] },
    { key: 'fantasma_na_rede_local', text: 'Algo vindo de trás da Muralha Negra usa {place} como nó; máquinas, portas e drones do bairro agem sozinhos, e {who} quer capturar — ou adorar — a coisa.', needs: ['net'], tags: ['net', 'occult'], hooks: ['trabalho'], arcs: ['culto_ascensao', 'vazamento_e_cacada'], places: ['santuario_japantown', 'capela_comunitaria', 'estudio_bd', 'megapredio', 'central_despacho'] },
    { key: 'memorias_plantadas', text: 'Pessoas em {district} acordam com memórias de crimes que não cometeram e se entregam à polícia; {who} vende confissões prontas para quem precisa de bode expiatório.', needs: ['net'], needsAny: ['politics', 'money'], tags: ['net', 'politics', 'cyber'], hooks: ['familia'], arcs: ['operacao_policial_suja', 'vazamento_e_cacada'] },
    { key: 'assalto_comboio', text: '{who} planeja roubar uma carga corporativa em trânsito por {district} e precisa de motoristas e entregadores que conheçam as rotas e os horários.', needs: ['smuggling'], needsAny: ['violence', 'money'], tags: ['smuggling', 'violence', 'corp'], hooks: ['trabalho', 'divida'], arcs: ['contagem_do_golpe'] },
    { key: 'refem_para_porta', text: '{who} sequestrou {victim} para obrigar um parente a abrir a porta, o cofre ou o sistema da empresa onde trabalha.', needs: ['violence'], needsAny: ['money', 'corp', 'smuggling'], tags: ['violence', 'corp'], hooks: ['familia'], arcs: ['contagem_do_golpe', 'apagao_de_testemunhas'] },
    { key: 'greve_quebrada', text: 'Os trabalhadores de {place} tentam formar um sindicato; {who} contrata fura-greves e o líder do movimento desaparece.', needs: [], needsAny: ['corp', 'money', 'violence'], tags: ['politics', 'corp', 'violence'], hooks: ['trabalho', 'familia'], arcs: ['tomada_do_quarteirao', 'apagao_de_testemunhas'], places: ['fabrica_turno', 'central_despacho', 'armazem_porto'] },
    { key: 'desmanche_de_gente', text: 'Corpos sem implantes aparecem em {district}; {who} desmonta gente viva e revende o cromo em {place}.', needs: ['cyber'], needsAny: ['medical', 'smuggling'], tags: ['cyber', 'medical', 'violence', 'smuggling'], hooks: ['familia'], arcs: ['desaparecimentos_em_serie'], places: ['clinica_ripper_porao', 'casa_penhores', 'mercado_noturno', 'ferro_velho'] },
    { key: 'chantagem_vereador', text: '{who} tem material comprometedor de um vereador de {district} e o usa para aprovar uma licença; o cartão com o material está circulando de mão em mão.', needs: [], needsAny: ['politics', 'media'], tags: ['politics', 'media', 'money'], hooks: ['trabalho'], arcs: ['vazamento_e_cacada', 'apagao_de_testemunhas'] },
    { key: 'desertora_cacada', text: 'Uma netrunner fugiu de {who} levando algo na cabeça e se esconde em {district}; todo mundo quer achá-la antes da NetWatch.', needs: [], needsAny: ['corp', 'net'], tags: ['net', 'corp'], hooks: ['trabalho'], arcs: ['vazamento_e_cacada'] },
    { key: 'ringue_endividado', text: '{place} promove lutas até a morte com lutadores endividados; {who} manipula resultados e apostas e procura carne nova para o ringue.', needs: ['money', 'violence'], tags: ['violence', 'money', 'street'], hooks: ['divida'], arcs: ['escalada_de_cobranca', 'desaparecimentos_em_serie'], places: ['ringue_estacionamento', 'armazem_porto', 'ferro_velho'] },
    { key: 'drones_contra_runners', text: '{who} testa entregas por drone em {district} e sabota os entregadores humanos — acidentes, assaltos encomendados — para provar que a mão de obra de carne está obsoleta.', needs: [], needsAny: ['corp', 'cyber'], tags: ['corp', 'cyber', 'street'], hooks: ['trabalho', 'divida'], arcs: ['apagao_de_testemunhas', 'guerra_de_territorio'] },
    { key: 'reliquia_profanada', text: 'Um santuário de {district} foi profanado e um objeto sagrado sumiu; {who} leva a culpa, mas foi armado para começar uma guerra.', needs: [], needsAny: ['occult', 'street'], tags: ['occult', 'street', 'violence'], hooks: ['familia'], arcs: ['guerra_de_territorio', 'culto_ascensao'] },
    { key: 'bonecas_chip_adulterado', text: 'As bonecas de {place} trabalham com chips de personalidade que apagam a memória do expediente; {who} adultera os chips para gravar os segredos dos clientes — e algumas bonecas começaram a lembrar.', needs: ['vice'], needsAny: ['money', 'net', 'street'], tags: ['vice', 'net', 'money'], hooks: ['trabalho', 'divida'], arcs: ['vazamento_e_cacada', 'desaparecimentos_em_serie'], places: ['clube_bonecas'], victims: ['bonecas_contrato'] },
    { key: 'mox_contra_cafetao', text: '{who} quer tomar o ponto das trabalhadoras independentes de {district} e cobrar "proteção"; as Mox prometeram defendê-las e procuram gente de fora para virar o jogo.', needs: ['violence'], needsAny: ['money', 'smuggling'], tags: ['vice', 'violence', 'street'], hooks: ['divida', 'trabalho'], arcs: ['guerra_de_territorio'], victims: ['trabalhadoras_independentes'] },
    { key: 'anuncio_bd_isca', text: 'Um anúncio de braindance erótico que passa em todas as telas de {district} esconde um pacote de dados; quem compra o BD vira alvo de {who}.', needs: [], needsAny: ['net', 'media'], tags: ['vice', 'media', 'net'], hooks: ['trabalho'], arcs: ['vazamento_e_cacada', 'apagao_de_testemunhas'], places: ['outdoor_holografico', 'estudio_bd'], victims: ['clientes_bd'] },
    { key: 'clinica_recondiciona', text: '{place} "recondiciona" bonecas endividadas com cirurgias e chips novos; quem tenta sair do contrato some, e {who} lucra com cada assinatura.', needs: ['money'], needsAny: ['medical', 'cyber'], tags: ['vice', 'medical', 'cyber', 'money'], hooks: ['divida'], arcs: ['desaparecimentos_em_serie'], places: ['clinica_ripper_porao', 'clube_bonecas'], victims: ['bonecas_contrato'] },
    { key: 'cacador_fora_da_lista', text: 'Um esquadrão ligado a {who} "aposenta" ciberpsicopatas que não constam em registro nenhum; quem decide quem é psicopata é uma pessoa só.', needs: ['violence', 'cyber'], tags: ['violence', 'cyber', 'politics'], hooks: ['familia', 'trabalho'], arcs: ['operacao_policial_suja', 'apagao_de_testemunhas'] },
  ],

  who: [
    { key: 'tyger_claws', name: 'Tyger Claws', kind: 'gang', tags: ['money', 'violence', 'street', 'cyber', 'smuggling', 'vice'], district: 'WESTBROOK' },
    { key: 'valentinos', name: 'Valentinos', kind: 'gang', tags: ['violence', 'street', 'money', 'smuggling', 'occult'], district: 'HEYWOOD' },
    { key: 'maelstrom', name: 'Maelstrom', kind: 'gang', tags: ['violence', 'cyber', 'occult', 'smuggling', 'net'], district: 'WATSON' },
    { key: 'sixth_street', name: '6th Street', kind: 'gang', tags: ['violence', 'politics', 'street', 'smuggling'], district: 'SANTO DOMINGO' },
    { key: 'voodoo_boys', name: 'Voodoo Boys', kind: 'gang', tags: ['net', 'occult', 'street'], district: 'PACIFICA' },
    { key: 'animals', name: 'Animals', kind: 'gang', tags: ['violence', 'chem', 'street'], district: 'PACIFICA' },
    { key: 'mox', name: 'Mox', kind: 'gang', tags: ['street', 'media', 'violence'], district: 'WATSON' },
    { key: 'scavengers', name: 'Scavengers', kind: 'gang', tags: ['violence', 'medical', 'cyber', 'smuggling'], district: null },
    { key: 'arasaka', name: 'Arasaka', kind: 'corp', tags: ['corp', 'money', 'politics', 'net', 'violence'], district: 'CITY CENTER' },
    { key: 'militech', name: 'Militech', kind: 'corp', tags: ['corp', 'violence', 'cyber', 'politics'], district: null },
    { key: 'biotechnica', name: 'Biotechnica', kind: 'corp', tags: ['corp', 'medical', 'chem', 'money'], district: null },
    { key: 'kang_tao', name: 'Kang Tao', kind: 'corp', tags: ['corp', 'cyber', 'net', 'smuggling'], district: null },
    { key: 'zetatech', name: 'Zetatech', kind: 'corp', tags: ['corp', 'net', 'cyber', 'media'], district: null },
    { key: 'ncpd_corrupta', name: 'NCPD', kind: 'police', tags: ['violence', 'politics', 'money', 'street', 'police'], district: null },
    { key: 'max_tac', name: 'MAX-TAC', kind: 'police', tags: ['violence', 'cyber', 'politics', 'police'], district: null },
    { key: 'trauma_team', name: 'Equipe de Trauma', kind: 'corp', tags: ['medical', 'money', 'corp', 'violence'], district: null },
    { key: 'netwatch', name: 'NetWatch', kind: 'police', tags: ['net', 'politics', 'corp', 'police'], district: null },
    { key: 'canal_independente', name: 'um canal independente', kind: 'fixer', tags: ['money', 'street', 'smuggling', 'media'], district: null },
    { key: 'aldecaldos', name: 'os Aldecaldos', kind: 'other', tags: ['smuggling', 'street', 'violence'], district: null },
  ],

  places: [
    { key: 'cassino_pachinko', text: 'um salão de pachinko com cassino nos fundos e uma cabine de "renegociação"', tags: ['money', 'street'], districts: ['WESTBROOK', 'CITY CENTER', 'HEYWOOD'] },
    { key: 'clinica_ripper_porao', text: 'uma clínica de ripperdoc no porão de uma lavanderia', tags: ['cyber', 'medical', 'street'], districts: 'any' },
    { key: 'barraca_lamen', text: 'uma barraca de lámen 24h que serve de ponto de recado', tags: ['street', 'smuggling'], districts: 'any' },
    { key: 'estudio_bd', text: 'um estúdio de braindance pirata num andar de hotel-cápsula', tags: ['media', 'net'], districts: ['WATSON', 'WESTBROOK', 'PACIFICA'] },
    { key: 'ringue_estacionamento', text: 'um ringue clandestino no subsolo de um estacionamento', tags: ['violence', 'money'], districts: ['WATSON', 'HEYWOOD', 'SANTO DOMINGO', 'PACIFICA'] },
    { key: 'mercado_noturno', text: 'o mercado noturno de peças, comida e cromo de segunda mão', tags: ['street', 'cyber', 'smuggling'], districts: ['WATSON', 'WESTBROOK', 'HEYWOOD'] },
    { key: 'armazem_porto', text: 'um armazém de contêineres no porto, com guindaste desativado', tags: ['smuggling', 'violence'], districts: ['WATSON', 'PACIFICA', 'SANTO DOMINGO'] },
    { key: 'santuario_japantown', text: 'um santuário de bairro espremido entre letreiros em Japantown', tags: ['occult', 'street'], districts: ['WESTBROOK'] },
    { key: 'capela_comunitaria', text: 'a capela comunitária com altar improvisado e sopa aos domingos', tags: ['occult', 'street', 'politics'], districts: ['HEYWOOD', 'SANTO DOMINGO'] },
    { key: 'oficina_garagem', text: 'uma oficina que recondiciona motos de entrega', tags: ['street', 'smuggling'], districts: 'any' },
    { key: 'megapredio', text: 'um megaprédio com elevador quebrado e síndico comprado', tags: ['street', 'politics'], districts: 'any' },
    { key: 'casa_penhores', text: 'uma casa de penhores que aceita implantes como garantia', tags: ['money', 'cyber', 'street'], districts: 'any' },
    { key: 'central_despacho', text: 'a central de despacho de um app de entregas', tags: ['corp', 'street', 'money'], districts: 'any' },
    { key: 'boate_vip', text: 'uma boate com camarote corporativo e saída pelos fundos', tags: ['money', 'media', 'chem'], districts: ['CITY CENTER', 'WESTBROOK', 'WATSON'] },
    { key: 'ferro_velho', text: 'um ferro-velho com prensa industrial', tags: ['smuggling', 'violence', 'cyber'], districts: ['SANTO DOMINGO', 'PACIFICA', 'WATSON'] },
    { key: 'clinica_caridade', text: 'uma clínica gratuita patrocinada por uma "fundação"', tags: ['medical', 'corp'], districts: ['HEYWOOD', 'SANTO DOMINGO', 'WATSON', 'PACIFICA'] },
    { key: 'escritorio_microcredito', text: 'um escritório de microcrédito instantâneo num shopping de rua', tags: ['money', 'corp'], districts: ['CITY CENTER', 'WESTBROOK', 'HEYWOOD'] },
    { key: 'clube_bonecas', text: 'uma casa de bonecas com quartos alugados por hora e seguranças cromados na porta', tags: ['vice', 'money', 'street'], districts: ['WESTBROOK', 'WATSON', 'CITY CENTER'] },
    { key: 'outdoor_holografico', text: 'um painel holográfico gigante de anúncios em cima do viaduto', tags: ['media', 'vice'], districts: 'any' },
    { key: 'fabrica_turno', text: 'uma fábrica de montagem com turno de 14 horas e dormitório anexo', tags: ['corp', 'politics'], districts: ['SANTO DOMINGO'] },
  ],

  motives: [
    { key: 'pagar_patrao_maior', text: 'eles também devem a alguém maior e repassam a pressão para baixo', tags: ['money'] },
    { key: 'limpar_terreno', text: 'preparar o bairro para uma compra corporativa a preço de banana', tags: ['corp', 'politics', 'money'] },
    { key: 'vinganca_antiga', text: 'vingança por uma traição de anos atrás que só um dos lados lembra', tags: ['violence', 'street'] },
    { key: 'teste_de_campo', text: 'testar um produto em gente que ninguém vai procurar', tags: ['corp', 'medical', 'chem', 'cyber'] },
    { key: 'carne_para_guerra', text: 'juntar soldados para uma guerra de território que está por vir', tags: ['violence'] },
    { key: 'apagar_testemunha', text: 'alguém viu o que não devia, e o resto é limpeza', tags: ['violence', 'politics'] },
    { key: 'comprar_eleicao', text: 'garantir votos ou silêncio antes de uma votação na Câmara', tags: ['politics', 'media'] },
    { key: 'transcendencia', text: 'a crença de que cromo, rede ou ritual levam além da carne', tags: ['occult', 'net', 'cyber'] },
    { key: 'orfaos_de_chefe', text: 'o chefe morreu e o tenente quer provar seu valor fazendo barulho', tags: ['street', 'violence'] },
    { key: 'meta_de_numeros', text: 'bater uma meta (prisões, entregas, lucro) que alguém de cima exigiu', tags: ['politics', 'corp', 'money', 'police'] },
    { key: 'colecao_memorias', text: 'colecionar memórias e gravações que valem mais que dinheiro', tags: ['media', 'net'] },
    { key: 'nova_rota', text: 'abrir uma rota de contrabando nova pelo quarteirão', tags: ['smuggling', 'money'] },
    { key: 'esconder_fracasso', text: 'enterrar as provas de um projeto que deu errado antes da auditoria', tags: ['corp', 'medical', 'net'] },
  ],

  victims: [
    // Só para premissas 'vice' (pedidas por nome): todas adultas.
    { key: 'bonecas_contrato', text: 'bonecas adultas presas a contratos de chip e dívida de cirurgia', role: 'Boneca (doll)', vice: true },
    { key: 'trabalhadoras_independentes', text: 'trabalhadoras do sexo adultas e independentes que se recusam a pagar proteção', role: 'Trabalhadora independente', vice: true },
    { key: 'clientes_bd', text: 'clientes adultos de braindance erótico', role: 'Cliente de BD', vice: true },
    { key: 'runners_endividados', text: 'entregadores de app com moto financiada e dívida atrasada', role: 'Entregador endividado' },
    { key: 'ripperdocs_bairro', text: 'ripperdocs de bairro que operam sem licença', role: 'Ripperdoc sem licença' },
    { key: 'ambulantes', text: 'vendedores ambulantes e donos de barraca', role: 'Ambulante' },
    { key: 'desertores_gangue', text: 'ex-membros de gangue tentando sair limpos', role: 'Ex-ganger' },
    { key: 'jovens_bico', text: 'jovens de 18 a 20 anos que fazem bico de vigia e recado', role: 'Jovem de recado' },
    { key: 'moradores_bloco', text: 'moradores antigos de um megaprédio', role: 'Morador antigo do bloco' },
    { key: 'veteranos_cromo', text: 'veteranos da Guerra Unificadora com cromo militar ultrapassado', role: 'Veterano cromado' },
    { key: 'netrunners_free', text: 'netrunners freelancers que aceitam qualquer trampo', role: 'Netrunner freelancer' },
    { key: 'estivadores', text: 'estivadores e sindicalistas do porto', role: 'Estivador' },
    { key: 'pacientes_sem_seguro', text: 'pacientes sem seguro de clínicas gratuitas', role: 'Paciente sem seguro' },
    { key: 'nomades_transito', text: 'nômades de passagem pela cidade para vender carga', role: 'Nômade de passagem' },
    { key: 'operarios_turno', text: 'operários do turno da noite', role: 'Operário do turno da noite' },
  ],

  twists: [
    { key: 'contratante_e_vitima', text: 'Quem contrata gente para resolver o caso é a próxima vítima da lista — e sabe disso.' },
    { key: 'divida_comprada_cedo', text: 'A dívida do próprio jogador foi comprada por {who} antes da campanha começar: ele é alvo desde o primeiro dia.', needs: ['money'] },
    { key: 'rivais_mesmo_dono', text: 'Os dois lados do conflito são financiados pela mesma corp, que lucra com a guerra.', needs: ['corp', 'politics'] },
    { key: 'veneno_e_cura', text: 'O produto "perigoso" é a cura de algo; os efeitos colaterais foram plantados.', needs: ['medical', 'chem'] },
    { key: 'informante_policia', text: 'O contato mais confiável dessa história passa tudo para a NCPD.', needs: ['street', 'police', 'politics'] },
    { key: 'seed_ja_morto', text: '{seed} morreu antes de tudo começar; quem fala por ele é um construto ou um impostor.', needs: ['net'] },
    { key: 'dinheiro_marcado', text: 'Os eddies pagos nesta história são rastreados e servem de isca.', needs: ['money', 'corp'] },
    { key: 'gangue_protege', text: 'A gangue acusada está protegendo o bairro de uma corp — e não o contrário.', needs: ['street'] },
    { key: 'desaparecido_fugiu', text: 'A pessoa desaparecida fugiu por vontade própria e não quer ser encontrada.' },
    { key: 'apolice_vale_ouro', text: 'A apólice da Equipe de Trauma de alguém envolvido vale mais com ele morto do que vivo.', needs: ['medical'] },
    { key: 'jornalista_comprada', text: 'A jornalista que expõe o caso trabalha para a concorrente de {who}.', needs: ['media', 'corp'] },
    { key: 'memoria_familiar', text: 'O dado disputado contém memórias de um parente do jogador.', needs: ['net', 'media'] },
    { key: 'crise_para_verba', text: 'A polícia precisa que o caso exploda para justificar verba e armamento novo.', needs: ['politics', 'violence'] },
    { key: 'fachada_limpa', text: 'A fachada é legítima: o crime acontece no prédio ao lado, com o dono da fachada como refém.' },
    { key: 'armado_pelo_rival', text: '{who} foi incriminado por um terceiro que quer os dois lados se matando.', needs: ['violence'] },
    { key: 'patrao_do_app', text: 'O app de entregas vende os dados de rota dos entregadores para {who}.', needs: ['corp', 'net', 'smuggling'] },
  ],

  arcs: [
    {
      key: 'escalada_de_cobranca',
      fits: ['money', 'street'],
      stages: [
        {
          title: 'Cobradores de {who} começam a visitar {victim}',
          hours: [6, 14],
          effects: [
            { kind: 'rumor', headline: 'Cobradores batendo de porta em porta', body: 'Gente de {who} anda visitando {victim} em {district}. Educados demais. Ninguém gosta.' },
            { kind: 'scene_hook', text: 'Um vizinho ou conhecido comenta, nervoso, que recebeu a visita de cobradores de {who}.' },
          ],
          block: 'pagar ou renegociar a dívida de um vizinho antes da visita',
        },
        {
          title: '{seed} lembra o jogador do vencimento',
          hours: [10, 24],
          effects: [
            { kind: 'seed_message', text: 'Oi, querido. Só passando pra lembrar que tudo tem vencimento nessa cidade. Inclusive o seu. Sem pressão. Ainda.' },
            { kind: 'flag', key: 'cobranca_pessoal' },
          ],
          block: 'quitar uma parcela ou oferecer um serviço em troca',
        },
        {
          title: 'Um devedor some em {district}',
          hours: [12, 30],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Morador de {district} desaparece após "renegociar dívida"', body: 'A família diz que ele foi a {place} e não voltou. A NCPD registrou como "saída voluntária".' },
            { kind: 'victim_missing' },
          ],
          block: 'esconder o devedor ou entregar a {who} um alvo maior',
        },
        {
          title: '{who} toma conta de {place}',
          hours: [18, 36],
          effects: [
            { kind: 'faction_shift', delta: 1 },
            { kind: 'rumor', headline: 'Novo dono no pedaço', body: '{place} agora é de {who}. Quem deve lá, trabalha lá.' },
          ],
          block: 'avisar um rival de {who} ou sabotar o caixa',
        },
        {
          title: 'A cobrança chega à família do jogador',
          hours: [18, 40],
          effects: [
            { kind: 'seed_message', text: 'Passei pra conhecer sua família hoje. Gente boa. Seria uma pena eles carregarem o que é seu, né?' },
            { kind: 'scene_hook', text: 'Alguém próximo do jogador (o laço da ficha) recebeu a visita de {seed}. Mostre o medo, não o desfecho.' },
          ],
          block: 'confronto, acordo com um canal ou tirar a família do distrito',
        },
      ],
    },
    {
      key: 'desaparecimentos_em_serie',
      fits: ['medical', 'cyber', 'chem', 'media'],
      stages: [
        {
          title: 'Gente some perto de {place}',
          hours: [6, 16],
          effects: [{ kind: 'rumor', headline: 'Ninguém volta de lá', body: 'Tem {victim} sumindo perto de {place}. A NCPD diz que é "migração".' }],
          block: 'avisar a comunidade ou vigiar o local',
        },
        {
          title: '{seed} pede ajuda para achar alguém',
          hours: [10, 24],
          effects: [
            { kind: 'victim_missing' },
            { kind: 'seed_message', text: 'Desculpa mandar do nada. Você conhece a área. Alguém que eu conheço sumiu ontem perto de {place}. Ninguém me escuta.' },
          ],
          block: 'seguir o último rastro em até um dia',
        },
        {
          title: 'Um corpo aparece; a NCPD arquiva',
          hours: [12, 30],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'news', source: '54 News', headline: 'Corpo com "cirurgia amadora" é achado em {district}', body: 'Sem implantes, sem identificação. Caso arquivado em menos de uma hora.' },
          ],
          block: 'roubar o laudo ou levar o corpo a um ripperdoc de confiança',
        },
        {
          title: '{who} acelera',
          hours: [18, 36],
          effects: [
            { kind: 'news', source: 'NCNet', headline: 'Onda de desaparecimentos em {district} já passa de dez', body: 'Moradores organizam vigílias. Ninguém sabe dizer quem leva.' },
            { kind: 'flag', key: 'onda_de_sumicos' },
          ],
          block: 'expor o caso num screamsheet ou atacar a logística',
        },
        {
          title: 'A operação muda de endereço levando prisioneiros',
          hours: [18, 40],
          effects: [
            { kind: 'scene_hook', text: 'Um caminhão sem placa sai de {place} de madrugada. Quem viu jura ter ouvido batidas lá dentro.' },
            { kind: 'faction_shift', delta: 1 },
          ],
          block: 'invasão ou troca de reféns',
        },
      ],
    },
    {
      key: 'guerra_de_territorio',
      fits: ['violence', 'street', 'smuggling'],
      stages: [
        {
          title: 'Provocações de {who} em território rival',
          hours: [6, 14],
          effects: [
            { kind: 'rumor', headline: 'Tinta fresca no muro errado', body: '{who} pichou território rival em {district}. Alguém vai responder.' },
            { kind: 'scene_hook', text: 'Pichações novas de {who} no caminho do jogador; gente olhando de canto.' },
          ],
          block: 'apagar a provocação ou mediar com o canal do bairro',
        },
        {
          title: 'Toque de recolher informal; rotas bloqueadas',
          hours: [10, 24],
          effects: [
            { kind: 'flag', key: 'rotas_bloqueadas' },
            { kind: 'faction_shift', delta: 1 },
            { kind: 'seed_message', text: 'Recado amigo: depois das dez, fica longe de {place}. Não é ameaça. É previsão do tempo.' },
          ],
          block: 'negociar passagem ou abrir uma rota alternativa',
        },
        {
          title: 'Tiroteio em {place}',
          hours: [12, 30],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Tiroteio em {district} deixa feridos; NCPD chega 40 minutos depois', body: 'Testemunhas falam em disputa de território. A polícia fala em "briga de bar".' },
            { kind: 'victim_missing' },
          ],
          block: 'evacuar o local ou avisar antes',
        },
        {
          title: 'Um nome conhecido cai',
          hours: [12, 30],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'rumor', headline: 'Acharam ele no beco', body: 'Encontraram {victim} — um deles, pelo menos. Recado de {who}.' },
          ],
          block: 'proteger quem está marcado ou provar quem foi',
        },
        {
          title: '{who} vence e cobra lealdade do bairro',
          hours: [18, 40],
          effects: [
            { kind: 'faction_shift', delta: 2 },
            { kind: 'seed_message', text: 'Acabou. Agora o bairro é nosso e a gente lembra quem ficou do nosso lado. Você lembra de que lado ficou?' },
          ],
          block: 'ter escolhido um lado cedo ou derrubar os dois',
        },
      ],
    },
    {
      key: 'vazamento_e_cacada',
      fits: ['net', 'corp', 'media', 'politics'],
      stages: [
        {
          title: 'Um dado de {who} vaza',
          hours: [6, 14],
          effects: [
            { kind: 'rumor', headline: 'Pacote perdido', body: 'Dizem que {who} perdeu alguma coisa em {district} e está pagando bem por informação.' },
            { kind: 'flag', key: 'pacote_perdido' },
          ],
          block: 'devolver o pacote anonimamente',
        },
        {
          title: '{seed} procura esconderijo',
          hours: [8, 20],
          effects: [{ kind: 'seed_message', text: 'Preciso de um lugar pra sumir por dois dias. Pago em informação, que é o que eu tenho. Não pergunta o que eu carrego.' }],
          block: 'recusar ou entregar quem pediu ajuda',
        },
        {
          title: 'Equipe de recuperação varre {district}',
          hours: [12, 30],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'news', source: '54 News', headline: 'Netrunner encontrado frito em {district}', body: 'Morte cerebral por "sobrecarga de equipamento". O terceiro do mês.' },
          ],
          block: 'apagar rastros digitais com ajuda de um runner',
        },
        {
          title: 'A NetWatch entra no caso',
          hours: [18, 36],
          effects: [
            { kind: 'faction_shift', delta: 1 },
            { kind: 'news', source: 'NCNet', headline: 'NetWatch investiga "incidente de segurança" em {district}', body: 'Nós de rede do bairro estão sendo inspecionados. Instabilidade prevista.' },
          ],
          block: 'vender o dado à NetWatch antes',
        },
        {
          title: 'O dado é publicado ou destruído',
          hours: [18, 40],
          effects: [{ kind: 'scene_hook', text: 'O pacote de {who} vai ser decidido hoje: publicado, vendido ou apagado. Alguém vai pagar o preço.' }],
          block: 'escolher a quem entregar',
        },
      ],
    },
    {
      key: 'epidemia_quimica',
      fits: ['chem', 'medical', 'street'],
      stages: [
        {
          title: 'Droga nova e barata em {place}',
          hours: [6, 14],
          effects: [
            { kind: 'rumor', headline: 'Tem coisa nova na pista', body: 'Uma droga barata apareceu em {place}. Quem usa diz que nunca se sentiu tão calmo.' },
            { kind: 'scene_hook', text: 'Alguém oferece ao jogador, quase de graça, uma amostra da droga nova.' },
          ],
          block: 'rastrear o fornecedor',
        },
        {
          title: 'Casos estranhos entre {victim}',
          hours: [10, 24],
          effects: [
            { kind: 'news', source: 'NCNet', headline: 'Clínicas de {district} relatam "apatia em massa"', body: 'Pacientes chegam obedientes, sem lembrar de nada. Médicos pedem amostras.' },
            { kind: 'victim_missing' },
          ],
          block: 'levar uma amostra a um ripperdoc ou químico',
        },
        {
          title: 'Alguém próximo começa a usar',
          hours: [12, 30],
          effects: [
            { kind: 'seed_message', text: 'Sei que não é da minha conta, mas vi alguém que você conhece comprando a coisa nova. Achei que você ia querer saber.' },
            { kind: 'flag', key: 'droga_perto' },
          ],
          block: 'intervir pessoalmente ou cortar o fornecimento',
        },
        {
          title: 'Overdoses em massa',
          hours: [18, 36],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'news', source: '54 News', headline: 'Overdoses em série em {district}', body: 'A 54 News apurou que todas as vítimas usaram a mesma substância. Fornecedor desconhecido.' },
          ],
          block: 'destruir o estoque ou o laboratório',
        },
        {
          title: '{who} lança a "cura" e lucra com ela',
          hours: [18, 40],
          effects: [
            { kind: 'faction_shift', delta: 1 },
            { kind: 'news', source: 'NCNet', headline: 'Novo tratamento promete reverter a "apatia" de {district}', body: 'Patrocinado por um parceiro de {who}. Primeira dose grátis.' },
          ],
          block: 'provar a origem e vazar as provas',
        },
      ],
    },
    {
      key: 'tomada_do_quarteirao',
      fits: ['politics', 'corp', 'money'],
      stages: [
        {
          title: 'Cortes "técnicos" de água e energia',
          hours: [6, 14],
          effects: [{ kind: 'news', source: 'NCNet', headline: 'Falhas de água e energia em {district}', body: 'A concessionária fala em manutenção. Moradores falam em sabotagem.' }],
          block: 'descobrir quem mandou desligar',
        },
        {
          title: 'Ofertas de compra aos moradores',
          hours: [10, 24],
          effects: [
            { kind: 'seed_message', text: 'Tenho uma proposta generosa pros moradores do seu bloco. Você parece alguém que o pessoal escuta. Vamos conversar?' },
            { kind: 'scene_hook', text: 'Panfletos de "oferta de compra" aparecem embaixo das portas do bairro.' },
          ],
          block: 'organizar os moradores para recusar juntos',
        },
        {
          title: 'Incêndio misterioso',
          hours: [12, 30],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'news', source: '54 News', headline: 'Incêndio em prédio de {district} deixa uma vítima', body: 'Bombeiros apontam "fiação antiga". O terreno já tem comprador interessado.' },
          ],
          block: 'vigiar o prédio ou achar o incendiário antes',
        },
        {
          title: 'A Câmara aprova a "revitalização"',
          hours: [18, 36],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Câmara aprova projeto de revitalização para {district}', body: 'Votação relâmpago, sem debate. Despejos começam em breve.' },
            { kind: 'faction_shift', delta: 1 },
            { kind: 'flag', key: 'revitalizacao_aprovada' },
          ],
          block: 'chantagear ou expor o vereador',
        },
        {
          title: 'Despejo com escolta da NCPD',
          hours: [18, 40],
          effects: [{ kind: 'scene_hook', text: 'Caminhões de mudança e viaturas da NCPD chegam ao quarteirão ao amanhecer.' }],
          block: 'resistência, mídia ao vivo ou acordo com quem está comprando',
        },
      ],
    },
    {
      key: 'culto_ascensao',
      fits: ['occult', 'net', 'cyber'],
      stages: [
        {
          title: 'Sinais estranhos em {place}',
          hours: [6, 14],
          effects: [
            { kind: 'rumor', headline: 'As telas rezam', body: 'Em {place}, as telas mostram a mesma frase às 3h. Tem gente indo lá ajoelhar.' },
            { kind: 'scene_hook', text: 'Uma máquina ou tela perto do jogador falha e mostra, por um segundo, uma mensagem que não deveria estar ali.' },
          ],
          block: 'desligar ou isolar o nó',
        },
        {
          title: '{victim} começam a frequentar as reuniões',
          hours: [10, 24],
          effects: [
            { kind: 'flag', key: 'reunioes_do_culto' },
            { kind: 'seed_message', text: 'Você sente que essa cidade te prende? A gente se encontra à meia-noite. Sem cromo desligado, sem medo.' },
          ],
          block: 'infiltrar uma reunião',
        },
        {
          title: 'Um fiel some depois de "subir"',
          hours: [12, 30],
          effects: [
            { kind: 'victim_missing' },
            { kind: 'rumor', headline: 'Subiu', body: 'Dizem que {seed} levou mais um pra "subir". Ninguém viu ele descer.' },
          ],
          block: 'resgatar o fiel antes do rito',
        },
        {
          title: 'Apagão de rede em {district}',
          hours: [18, 36],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Apagão de rede em {district}; NetWatch sobrevoa a área', body: 'Drones da NetWatch circulam o bairro. Moradores relatam vozes no Agent.' },
            { kind: 'faction_shift', delta: 1 },
          ],
          block: 'entregar o nó à NetWatch ou ajudar a esconder',
        },
        {
          title: 'O rito final',
          hours: [18, 40],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'scene_hook', text: 'Hoje é a noite do rito em {place}. Com ou sem o jogador, alguém vai tentar atravessar.' },
          ],
          block: 'interromper o rito ou cortar a energia',
        },
      ],
    },
    {
      key: 'operacao_policial_suja',
      fits: ['politics', 'violence', 'police'],
      stages: [
        {
          title: 'Batidas aleatórias em {district}',
          hours: [6, 14],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Operação da NCPD prende dezenas em {district}', body: 'A delegacia comemora "o maior resultado do ano". Advogados contestam.' },
            { kind: 'rumor', headline: 'Estão levando qualquer um', body: 'Fica longe das esquinas. Estão pegando gente pela cara.' },
          ],
          block: 'ficar fora das ruas ou alertar os vizinhos',
        },
        {
          title: 'Um conhecido é preso e "confessa" em 24h',
          hours: [10, 24],
          effects: [
            { kind: 'victim_missing' },
            { kind: 'news', source: 'NCNet', headline: 'Suspeito confessa crimes em {district} em tempo recorde', body: 'Família diz que ele estava em casa na noite dos crimes.' },
          ],
          block: 'achar um advogado ou um álibi',
        },
        {
          title: '{seed} oferece imunidade em troca de nomes',
          hours: [12, 30],
          effects: [
            { kind: 'seed_message', text: 'Você não está na lista. Ainda. Me dá dois nomes e continua não estando. Oferta válida até amanhã.' },
            { kind: 'flag', key: 'oferta_de_imunidade' },
          ],
          block: 'recusar, mentir ou gravar a oferta',
        },
        {
          title: 'Morte sob custódia',
          hours: [18, 36],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'rumor', headline: 'Morreu na cela', body: 'Saiu de lá num saco. A versão oficial é "mal súbito".' },
            { kind: 'faction_shift', delta: 1 },
          ],
          block: 'vazar provas a um jornalista',
        },
        {
          title: 'Promoção ou queda do responsável',
          hours: [18, 40],
          effects: [{ kind: 'news', source: '54 News', headline: 'Responsável pela operação em {district} é condecorado', body: 'Ou investigado — depende de quem chegou primeiro à imprensa.' }],
          block: 'expor ou proteger o oficial',
        },
      ],
    },
    {
      key: 'contagem_do_golpe',
      fits: ['smuggling', 'money', 'violence', 'corp'],
      stages: [
        {
          title: '{who} recruta quem conhece as rotas',
          hours: [6, 14],
          effects: [
            { kind: 'seed_message', text: 'Ouvi dizer que você conhece {district} de olho fechado. Tenho um trabalho grande. Do tipo que paga uma vida. Interessa?' },
            { kind: 'scene_hook', text: 'Alguém pergunta, casualmente demais, sobre horários e rotas de entrega do bairro.' },
          ],
          block: 'recusar ou entrar como agente duplo',
        },
        {
          title: 'Plantas, horários e uniformes são roubados',
          hours: [10, 24],
          effects: [
            { kind: 'flag', key: 'golpe_em_preparo' },
            { kind: 'rumor', headline: 'Uniforme sumido', body: 'Sumiram uniformes de uma transportadora em {district}. Ninguém registrou queixa.' },
          ],
          block: 'avisar o alvo ou o canal',
        },
        {
          title: 'Um membro da equipe some',
          hours: [12, 30],
          effects: [{ kind: 'victim_missing' }],
          block: 'achar o traidor',
        },
        {
          title: 'O golpe acontece',
          hours: [12, 30],
          effects: [
            { kind: 'news', source: '54 News', headline: 'Carga corporativa é roubada em {district}', body: 'Prejuízo milionário. A corp promete "resposta proporcional".' },
            { kind: 'scene_hook', text: 'A cidade amanhece com drones corporativos varrendo {district} atrás da carga roubada.' },
          ],
          block: 'sabotar, participar ou trair',
        },
        {
          title: 'Racha na partilha',
          hours: [18, 40],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'faction_shift', delta: 1 },
          ],
          block: 'sumir com a parte ou entregar a equipe',
        },
      ],
    },
    {
      key: 'apagao_de_testemunhas',
      fits: ['violence', 'politics', 'corp', 'media'],
      stages: [
        {
          title: 'Alguém viu algo em {place} e fala demais',
          hours: [6, 14],
          effects: [{ kind: 'rumor', headline: 'Boca grande', body: 'Tem gente contando no bar o que viu em {place}. Não devia.' }],
          block: 'convencer a pessoa a calar a boca, por bem',
        },
        {
          title: 'A primeira testemunha morre em "acidente"',
          hours: [10, 24],
          effects: [
            { kind: 'victim_dead' },
            { kind: 'news', source: '54 News', headline: 'Acidente fatal em {district}', body: 'Queda, segundo a NCPD. Sem testemunhas — curiosamente.' },
          ],
          block: 'esconder as testemunhas que sobraram',
        },
        {
          title: '{seed} está na lista e pede ajuda',
          hours: [12, 30],
          effects: [
            { kind: 'seed_message', text: 'Eu vi. Eu sei que eles sabem que eu vi. Me tira daqui e eu te conto tudo.' },
            { kind: 'flag', key: 'lista_de_testemunhas' },
          ],
          block: 'tirar quem pediu ajuda do distrito',
        },
        {
          title: 'O jogador também está na lista',
          hours: [18, 36],
          effects: [
            { kind: 'scene_hook', text: 'Alguém segue o jogador de longe. Pelo jeito, {who} acha que ele viu demais.' },
            { kind: 'faction_shift', delta: 1 },
          ],
          block: 'negociar com {who} ou provar que não viu nada',
        },
      ],
    },
  ],

  seeds: [
    { key: 'cobrador_educado', gender: 'm', role: 'Cobrador', text: 'Fala baixo, lembra o aniversário de todo mundo e nunca ameaça diretamente; prefere mandar flores.', traits: ['educado demais', 'paciente', 'implacável'], voice: 'formal e carinhoso, chama todo mundo de "querido", nunca levanta a voz', fits: ['money', 'street'] },
    { key: 'netrunner_desertora', gender: 'f', role: 'Netrunner fugitiva', text: 'Ex-runner corporativa com o implante superaquecendo e uma paranoia justificada; paga em informação.', traits: ['paranoica', 'brilhante', 'exausta'], voice: 'frases cortadas, jargão de rede, desconfia de toda pergunta', fits: ['net', 'corp'] },
    { key: 'ripper_arrependido', gender: 'm', role: 'Ripperdoc', text: 'Ripperdoc que instalou o lote ruim sem saber e agora quer consertar, mas tem medo.', traits: ['culpado', 'meticuloso', 'covarde'], voice: 'termos médicos misturados com gíria, pede desculpa demais', fits: ['cyber', 'medical'] },
    { key: 'despachante_app', gender: 'm', role: 'Chefe de turno', text: 'Supervisor da central de entregas que manipula rotas por fora e sabe quem vai ser assaltado.', traits: ['oportunista', 'simpático', 'covarde'], voice: 'papo de gerente motivacional, diz "parceiro" e "meta" o tempo todo', fits: ['corp', 'street', 'smuggling'] },
    { key: 'jornalista_screamsheet', gender: 'f', role: 'Jornalista de screamsheet', text: 'Edita um screamsheet pirata num quarto só e quer a manchete a qualquer custo.', traits: ['obstinada', 'idealista', 'imprudente'], voice: 'rápida, cheia de perguntas, cita fontes que ninguém conhece', fits: ['media', 'politics'] },
    { key: 'policial_cansado', gender: 'm', role: 'Detetive da NCPD', text: 'Perto da aposentadoria, honesto o bastante para avisar e corrupto o bastante para não agir.', traits: ['cínico', 'cansado', 'ainda tem um limite'], voice: 'seco, irônico, fala como quem já viu tudo', fits: ['politics', 'violence', 'police'] },
    { key: 'rezadeira_bairro', gender: 'f', role: 'Líder comunitária', text: 'Mantém o altar do bairro, sabe os segredos de todos e cobra favores em vez de dinheiro.', traits: ['sábia', 'manipuladora', 'protetora'], voice: 'mistura reza e gíria, chama o jogador de "filho"', fits: ['occult', 'street'] },
    { key: 'lutador_endividado', gender: 'm', role: 'Lutador', text: 'Ex-boxeador cromado lutando para pagar a clínica da filha.', traits: ['orgulhoso', 'leal', 'desesperado'], voice: 'pouca fala, muita pausa, metáforas de luta', fits: ['violence', 'money'] },
    { key: 'nomade_de_passagem', gender: 'm', role: 'Contrabandista nômade', text: 'Motorista Aldecaldo que só vai ficar três dias e precisa de alguém que conheça as ruas.', traits: ['franco', 'impaciente', 'leal ao clã'], voice: 'seco, direto, despreza a cidade e diz isso', fits: ['smuggling'] },
    { key: 'herdeira_corporativa', gender: 'f', role: 'Insider corporativa', text: 'Filha de um gerente médio que descobriu o que o pai assina e quer vazar sem se queimar.', traits: ['culpada', 'mimada', 'corajosa sem saber'], voice: 'corporatês educado que escorrega em gíria quando fica nervosa', fits: ['corp', 'politics', 'media'] },
    { key: 'seguranca_mox', gender: 'f', role: 'Segurança do Mox', text: 'Cuida da segurança do clube e do pessoal que trabalha lá; desconfia de qualquer um com dinheiro demais.', traits: ['protetora', 'desconfiada', 'leal'], voice: 'curta e grossa, testa as pessoas com perguntas diretas', fits: ['street', 'violence', 'media', 'vice'] },
    { key: 'boneca_que_lembra', gender: 'f', role: 'Boneca (doll)', text: 'Boneca adulta cujo chip falhou: lembra de tudo o que viu e ouviu nos quartos — e isso vale uma fortuna e uma bala.', traits: ['observadora', 'irônica', 'assustada'], voice: 'fala suave e treinada, que racha quando fica nervosa', fits: ['vice', 'net', 'media'] },
    { key: 'gerente_da_casa', gender: 'm', role: 'Gerente de casa de bonecas', text: 'Administra a casa com planilha e sorriso; trata contrato como gente e gente como contrato.', traits: ['calculista', 'cortês', 'sem escrúpulos'], voice: 'educado como recepcionista de hotel caro, nunca diz uma palavra feia', fits: ['vice', 'money', 'street'] },
    { key: 'receptador_penhores', gender: 'm', role: 'Receptador', text: 'Dono de casa de penhores que compra cromo sem perguntar, até reconhecer o implante de um amigo.', traits: ['ganancioso', 'sentimental', 'medroso'], voice: 'pechincha até no cumprimento, ri de nervoso', fits: ['cyber', 'money', 'smuggling'] },
    { key: 'veterano_cromado', gender: 'm', role: 'Veterano de guerra', text: 'Braço militar ultrapassado, vontade de lutar de novo e crises que beiram a ciberpsicose.', traits: ['disciplinado', 'instável', 'saudoso da guerra'], voice: 'jargão militar, chama todo mundo por patente inventada', fits: ['cyber', 'violence'] },
    { key: 'editora_bd', gender: 'f', role: 'Editora de braindance', text: 'Corta as cenas proibidas dos BDs e guarda cópias como seguro de vida.', traits: ['fria', 'curiosa', 'calculista'], voice: 'técnica e distante, descreve tudo como se fosse uma edição', fits: ['media', 'net'] },
  ],

  names: [
    ['Akemi Sato', 'f'], ['Bruno Vega', 'm'], ['Carmen Ibarra', 'f'], ['Darius Cole', 'm'], ['Eiji Moriyama', 'm'], ['Fátima Rojas', 'f'],
    ['Gideon Pierce', 'm'], ['Hana Kwon', 'f'], ['Ignacio Ruiz', 'm'], ['Jin Takeda', 'm'], ['Kayla Brooks', 'f'], ['Luz Marín', 'f'],
    ['Marcus Delacroix', 'm'], ['Nadia Orlova', 'f'], ['Omar Haddad', 'm'], ['Paloma Reyes', 'f'], ['Quentin Shaw', 'm'], ['Reiko Tanabe', 'f'],
    ['Santiago Lara', 'm'], ['Tamsin Wu', 'f'], ['Ulysse Baptiste', 'm'], ['Valeria Cruz', 'f'], ['Wen Li', 'f'], ['Xiomara Diaz', 'f'],
    ['Yusuf Okafor', 'm'], ['Zoe Mercer', 'f'], ['Rosa Alvarado', 'f'], ['Benny "Sete Dedos"', 'm'], ['Cass Moreau', 'f'], ['Dmitri Volkov', 'm'],
    ['Esme Calloway', 'f'], ['Frankie Ochoa', 'm'], ['Goro Ishida', 'm'], ['Hector Salinas', 'm'], ['Ivy Navarro', 'f'], ['Jules Fontaine', 'f'],
    ['Kenji Arai', 'm'], ['Lola Batista', 'f'], ['Mateo Fuentes', 'm'], ['Noor Siddiqui', 'f'],
  ],
};
