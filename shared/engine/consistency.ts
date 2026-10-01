/**
 * Verificador de consistência narrativa: detecta quando a narração contradiz o motor.
 * Heurístico e conservador (poucos falsos positivos). Usado pelo servidor (nova tentativa)
 * e pelos evals.
 */
import type { Dialogue, Mission, Npc } from '../types/game';
import type { EngineResult, ToolCall } from '../types/turn';
import { MAX_TRANSFER_IN } from '../rules/catalog';
import { factAwareness } from './npcProfile';
import { PAYMENT_WINDOW_TURNS } from './world';

const FIRED = /\b(dispar(a|ou|am|o)|atir(a|ou|am)|bala(s)? (atravess|acert|rasg|perfur)|tiro (acert|atravess|rasg|atinge))/i;
const DRY = /(clique seco|click seco|clique vazio|sem muni|descarregad|vazi[ao]|nada acontece|o gatilho estala)/i;
const HIT = /\b(acert(a|ou|ando)|atinge|atingiu|rasga|perfura)\b/i;
const MISS = /\b(err(a|ou)|passa (raspando|longe)|desvia|zune ao lado|não acerta)\b/i;

/** Frase em que o JOGADOR é o alvo (ou se esquiva): é a fase dos inimigos, não o ataque dele. */
const PLAYER_IS_TARGET =
  /\b(acert\w*|ating\w*|rasg\w*|perfur\w*|pega)\s+(em\s+)?(voc[eê]|seu|sua|teu|tua)(?![\wÀ-ÿ])|\bte\s+(acert|ating|rasg|perfur|err|pega)|\bvoc[eê]\s+(e|é|foi|esta|está)\s+(atingid|acertad|ferid)|\bvoc[eê]\s+(se\s+)?(desvia|esquiva|abaixa|joga)|\b(zune|passa)\b[^.!?]{0,40}\b(voc[eê]|sua cabe[cç]a|seu ouvido|seu rosto)(?![\wÀ-ÿ])/i;
/** O jogador como sujeito do golpe ("você acerta seu alvo") continua sendo o ataque dele. */
const PLAYER_STRIKES = /\bvoc[eê]\s+(\S+\s+){0,2}?(acert|ating|dispar|atir|golpe|crav|rasg|perfur|err)/i;

/**
 * Só o trecho sobre o ataque do jogador. A fase dos inimigos vem narrada no mesmo texto ("a bala se
 * perde… o ganger acerta você"): sem separar, o acerto do inimigo contradiz o erro do jogador.
 */
export function playerAttackText(text: string): string {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .filter(s => PLAYER_STRIKES.test(s) || !PLAYER_IS_TARGET.test(s))
    .join(' ');
}

function norm(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const MONEY_TOOLS = ['pay_money', 'buy_item', 'transfer_money', 'loot', 'complete_quest'];
/** Jogador pagando/transferindo/gastando um valor em eddies. */
const PLAYER_PAYS = /\b(transfer\w*|pag(a|ou|ando|ar|amento)|quit(a|ou|ar|ação)|deposit\w*|gast(a|ou|ar)|abat(e|eu|er)|desembols\w*)[^.\n]{0,90}?(€\$?\s?\d|\d[\d.]*\s?(eddies|€))/i;

/** Pagamento que ainda não aconteceu (futuro, pedido, negação). */
// Fim de palavra com lookahead: em JS, \b depois de letra acentuada ("você", "pagará") nunca casa.
const NOT_DONE = /\b(n[aã]o|nunca|vai|v[aã]o|ir[aá]|precisa|precisar[aá]|deve|devia|teria|quer que|querem que|pede que|exige que|se voc[eê]|caso|pagar[aá]|transferir[aá])(?![\wÀ-ÿ])/i;
/** O jogador é quem paga: 2ª pessoa na frase ("você transfere", "seus eddies", "sua conta"). */
const BY_PLAYER = /\b(voc[eê]|seus? eddies|sua conta|seu saldo|te custa)(?![\wÀ-ÿ])/i;

/** Alguma frase narra o JOGADOR pagando agora (não "o barman pagou a rodada", nem "você vai pagar"). */
function playerPaysIn(text: string): boolean {
  return text.split(/(?<=[.!?…])\s+|\n+/).some(s => {
    const m = PLAYER_PAYS.exec(s);
    if (!m || !BY_PLAYER.test(s)) return false;
    // Até o fim da palavra do verbo ("pagará" inteiro), sem o que vem depois ("…e não olha para trás").
    const verbEnd = m.index + (/^\S+/.exec(s.slice(m.index))?.[0].length ?? m[1].length);
    return !NOT_DONE.test(s.slice(0, verbEnd));
  });
}

/** Narração declarando a morte do PRÓPRIO jogador (2ª pessoa). */
// "morre de rir" é expressão; "flatline" sozinho é jargão (o ICE ameaça "dar flatline"): só conta com o jogador como sujeito.
const PLAYER_DIES =
  /(voc[eê] (morre|morreu)(?! de (rir|vergonha|medo|t[eé]dio|curiosidade|inveja|saudade|calor|fome|sono))|voc[eê] (est[aá] mort[oa]|n[aã]o sobrevive)|seu (u|ú)ltimo (suspiro|batimento)|seu corpo (tomba|cai|desaba) sem vida|sua vida se apaga|seu cora[cç][aã]o para de bater|voc[eê] (d[aá]|deu|sofre|sofreu|entra em|entrou em) (um )?flatline)/i;
/** Fala entre aspas é ameaça/opinião de personagem, não fato narrado. */
const QUOTED = /“[^”]*”|"[^"]*"|\[(?:DIALOGUE|FALA):[^\]]*\][^\n]*/gi;
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

/**
 * Valores em eddies citados num trecho (já normalizado), na ordem: "€$4.510", "1010 eddies",
 * "4 mil", "quatro mil quinhentos e dez". Valores aproximados ("cerca de mil") ficam de fora.
 */
export function amountsIn(text: string): number[] {
  const out: number[] = [];
  const clean = text
    // "1,1 mil" = 1100 (vírgula decimal), não [1, 1000].
    .replace(/(\d+),(\d{1,2})\s*mil\b/g, (_m, a: string, b: string) => String(Math.round(Number(`${a}.${b}`) * 1000)))
    // "1 100" = 1100 (espaço como separador de milhar).
    .replace(/\b\d{1,3}(?: \d{3})+\b/g, m => m.replace(/ /g, ''));
  const tokens = clean.replace(/€\$?/g, ' ').split(/[^a-z0-9.]+/).filter(Boolean);
  const APPROX = new Set(['cerca', 'quase', 'uns', 'umas', 'aproximadamente', 'perto', 'mais', 'menos']);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i].replace(/\.$/, '');
    const approx = [tokens[i - 1], tokens[i - 2]].some(t => t && APPROX.has(t));
    if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(tok)) {
      let v = Number(tok.replace(/\./g, ''));
      if (tokens[i + 1] === 'mil') {
        v *= 1000;
        i++;
      }
      if (!approx) out.push(v);
      continue;
    }
    if (!(tok in NUMBER_WORDS) && tok !== 'mil') continue;
    // Por extenso: acumula até a sequência acabar ("e" só liga números).
    let total = 0;
    let cur = 0;
    let j = i;
    for (; j < tokens.length; j++) {
      const t = tokens[j].replace(/\.$/, '');
      if (t in NUMBER_WORDS) cur += NUMBER_WORDS[t];
      else if (t === 'mil') {
        total += (cur || 1) * 1000;
        cur = 0;
      } else if (t === 'e' && tokens[j + 1] && (tokens[j + 1].replace(/\.$/, '') in NUMBER_WORDS || tokens[j + 1] === 'mil')) continue;
      else break;
      if (tokens[j].endsWith('.')) {
        j++;
        break;
      }
    }
    const v = total + cur;
    // "um/uma" sozinho é artigo, não valor.
    if (!approx && (v > 1 || j - i > 1)) out.push(v);
    i = j - 1;
  }
  return out;
}

/** Saldos que a narração afirma ("o saldo sobe para X", "X eddies na conta"). Cada item = valores citados na frase. */
export function claimedBalances(narration: string): number[][] {
  const claims: number[][] = [];
  for (const sentence of norm(narration).split(/[!?\n]+|\.\s+/)) {
    // "o saldo da noite foi de três mortos" não é dinheiro.
    const saldo = /\bsaldo\b(?!\s*(devedor|da divida|negativ|d[aeo]s? (noite|dia|luta|briga|tiroteio|confronto|missao|operacao|corre|encontro)))/.exec(sentence);
    if (saldo) {
      // "o saldo sobe para X" (depois) ou "somando agora X no seu saldo" (antes).
      const after = amountsIn(sentence.slice(saldo.index));
      const before = amountsIn(sentence.slice(0, saldo.index)).slice(-1);
      const vals = after.length ? after : before;
      if (vals.length) claims.push(vals);
      continue;
    }
    // "na conta de Rafa" é a conta de outra pessoa.
    const conta = /\bna (sua )?conta\b(?! d[aeo]s? )/.exec(sentence);
    if (conta) {
      const vals = amountsIn(sentence.slice(0, conta.index));
      if (vals.length) claims.push(vals.slice(-1));
    }
  }
  return claims;
}

const SECRET_STOPWORDS = new Set(['sobre', 'quando', 'porque', 'depois', 'antes', 'ainda', 'jogador', 'tambem', 'muito', 'outro', 'outra', 'esta', 'estao', 'foram', 'seria', 'pelos', 'pelas', 'entre', 'mesmo', 'mesma', 'nunca', 'sempre']);

/** Palavras que identificam um segredo (5+ letras, sem as muito comuns). */
function secretKeywords(fact: string): string[] {
  return [...new Set(norm(fact).split(/[^a-z0-9]+/).filter(w => w.length >= 5 && !SECRET_STOPWORDS.has(w)))];
}

/**
 * Segredos que o jogador NÃO sabe e que a narração parece ter contado sem reveal_npc.
 * Heurístico: só registra (não pede reescrita) para medirmos antes de endurecer.
 */
export function leakedSecrets(narration: string, npcs: Npc[], narratorTools: ToolCall[] = []): Array<{ npc: Npc; fact: string }> {
  const revealed = new Set(narratorTools.filter(t => t.tool === 'reveal_npc').map(t => String(t.args?.itemId ?? '')));
  const words = new Set(norm(narration).split(/[^a-z0-9]+/));
  const out: Array<{ npc: Npc; fact: string }> = [];
  for (const npc of npcs) {
    for (const k of npc.knowledge) {
      if (factAwareness(k) !== 'no' || revealed.has(k.id)) continue;
      const keys = secretKeywords(k.fact);
      const hits = keys.filter(w => words.has(w)).length;
      if (keys.length >= 3 && hits >= 3 && hits / keys.length >= 0.6) out.push({ npc, fact: k.fact });
    }
  }
  return out;
}

const NOT_REALLY = /(quase|se n[aã]o|sen[aã]o|ou |vai |pode |podia|poderia|prestes a|antes que)[^.!?\n]{0,25}$/i;

export function checkNarration(
  result: EngineResult | null,
  narration: string,
  dialogues: Dialogue[],
  npcs: Npc[],
  narratorTools: ToolCall[] = [],
  opts: { playerDead?: boolean; money?: number; turn?: number; quests?: Array<Pick<Mission, 'id' | 'title' | 'status' | 'rewardEddies' | 'giverId' | 'resolvedTurn'>> } = {},
): string[] {
  const warnings: string[] = [];
  const text = narration;

  // NPC morto falando.
  const dead = npcs.filter(n => n.status === 'dead');
  const speakers = [...dialogues.map(d => d.speaker), ...Array.from(text.matchAll(/\[(?:DIALOGUE|FALA):\s*([^\]]+)\]/gi)).map(m => m[1])];
  for (const n of dead) {
    const first = norm(n.name).replace(/["“”]/g, '').split(/\s+/)[0];
    // Palavra inteira: "Ana" não é "Mariana", "Jax" não é "Jaxon".
    const word = new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
    if (first && speakers.some(sp => word.test(norm(sp)))) warnings.push(`${n.name} está MORTO e não pode falar.`);
  }

  const attack = result?.roll?.attack;
  const failedAttackTool = result?.tools.find(t => t.tool === 'attack' && !t.ok);
  const noAmmo = attack?.failure === 'no_ammo' || /descarregad|clique seco/i.test(failedAttackTool?.summary ?? '');
  if (noAmmo && FIRED.test(text) && !DRY.test(text)) warnings.push('A arma estava SEM MUNIÇÃO: nenhum disparo aconteceu.');

  if (attack && !attack.failure) {
    const own = playerAttackText(text);
    if (attack.hit && MISS.test(own) && !HIT.test(own)) warnings.push(`O ataque ACERTOU ${attack.targetName}; a narração diz que errou.`);
    if (!attack.hit && HIT.test(own) && !MISS.test(own) && !/quase|por pouco/i.test(own)) warnings.push(`O ataque ERROU ${attack.targetName}; a narração diz que acertou.`);
  }

  const check = result?.roll && !result.roll.attack && !result.roll.initiative && !result.roll.deathSave ? result.roll.check : null;
  if (check && !check.success && /\bcom sucesso\b|\bconsegue perfeitamente\b/i.test(text)) warnings.push('O teste FALHOU; a narração descreve sucesso.');

  // Dinheiro só se move pelo motor: narrar um pagamento que nenhuma ferramenta registrou é contradição.
  const moneyMoved = (result?.tools ?? []).some(t => t.ok && MONEY_TOOLS.includes(t.tool)) || narratorTools.some(t => MONEY_TOOLS.includes(t.tool));
  if (!moneyMoved && playerPaysIn(text)) warnings.push('A narração descreve o jogador pagando/transferindo eddies, mas o motor NÃO registrou nenhum pagamento — o saldo não mudou. Narre que o pagamento não aconteceu (ou ainda está pendente).');

  // Entrada avulsa acima do teto: o motor corta o valor, e a narração ficaria com um saldo que não existe.
  for (const t of narratorTools) {
    const amount = Number(t.args?.amount);
    if (t.tool === 'transfer_money' && amount > MAX_TRANSFER_IN)
      warnings.push(
        `transfer_money de €$${amount} passa do teto de €$${MAX_TRANSFER_IN} para entradas avulsas: o motor só creditaria €$${MAX_TRANSFER_IN}. Se é pagamento por um trabalho, use a missão (complete_quest; se ela não existir, start_quest com rewardEddies e complete_quest). Senão, narre que só €$${MAX_TRANSFER_IN} caíram agora e o resto fica pendente.`,
      );
  }

  // Pagamento de um trabalho JÁ pago: o motor vai recusar (mesma regra de transfer_money), então a
  // narração não pode contar com esse dinheiro.
  const quests = opts.quests ?? [];
  const giverWord = (giverId?: string) => {
    const npc = npcs.find(n => n.id === giverId);
    const first = norm(npc?.name ?? giverId?.replace(/^npc_/, '') ?? '').replace(/["“”']/g, '').split(/\s+/)[0];
    return first.length >= 3 ? first : null;
  };
  const alreadyPaid = (t: ToolCall) => {
    const amount = Number(t.args?.amount);
    if (t.tool !== 'transfer_money' || !(amount > 0) || opts.turn === undefined) return undefined;
    return quests.find(q => {
      if (q.status !== 'COMPLETED' || !(q.rewardEddies > 0) || q.resolvedTurn === undefined || opts.turn! - q.resolvedTurn > PAYMENT_WINDOW_TURNS) return false;
      const word = giverWord(q.giverId);
      return amount === q.rewardEddies || (!!word && norm(String(t.args?.counterpart ?? '')).includes(word));
    });
  };
  // Eco de um pagamento do jogador neste turno (pay_money −N → transfer_money +N): o motor recusa.
  const playerPaid = (result?.tools ?? []).filter(t => t.ok && t.tool === 'pay_money').map(t => t.summary);
  const isEcho = (t: ToolCall) => t.tool === 'transfer_money' && Number(t.args?.amount) > 0 && playerPaid.some(sum => Number(/Pagou €\$(\d+)/.exec(sum)?.[1]) === Number(t.args?.amount));
  for (const t of narratorTools)
    if (isEcho(t)) warnings.push(`O jogador PAGOU €$${t.args?.amount} neste turno; transfer_money de +€$${t.args?.amount} é o mesmo pagamento com o sinal trocado (o motor recusa). Não chame transfer_money: o pagamento já foi registrado.`);
  for (const t of narratorTools) {
    const q = alreadyPaid(t);
    if (q)
      warnings.push(`Pagamento duplicado: "${q.title}" já foi paga (€$${q.rewardEddies}) e o motor vai RECUSAR este transfer_money. Não pague de novo, não chame complete_quest de novo e não some esse valor ao saldo: o saldo continua €$${opts.money}.`);
  }

  // Saldo citado na narração tem que bater com o do motor (antes ou depois das transferências do narrador).
  // complete_quest só mexe no saldo se a missão ainda está ativa (senão o motor recusa).
  const activeReward = narratorTools
    .filter(t => t.tool === 'complete_quest')
    .map(t => quests.find(q => q.id === t.args?.questId && q.status === 'ACTIVE'))
    .reduce((n, q) => n + (q?.rewardEddies ?? 0), 0);
  const opaqueMoney = narratorTools.some(t => ['loot', 'pay_money', 'buy_item'].includes(t.tool)) || narratorTools.some(t => t.tool === 'complete_quest' && !quests.length);
  if (opts.money !== undefined && !opaqueMoney) {
    const transfers = narratorTools.filter(t => t.tool === 'transfer_money' && !alreadyPaid(t) && !isEcho(t)).reduce((n, t) => n + Math.min(MAX_TRANSFER_IN, Number(t.args?.amount) || 0), 0);
    // A recompensa da missão desconta o que já foi pago na cena: qualquer valor entre o saldo e saldo + recompensa é plausível só nos extremos.
    const valid = new Set([opts.money, opts.money + transfers, opts.money + activeReward, opts.money + transfers + activeReward]);
    const wrong = claimedBalances(text).find(vals => !vals.some(v => valid.has(v)));
    if (wrong)
      warnings.push(`A narração diz que o saldo é €$${wrong[wrong.length - 1]}, mas o saldo real é €$${opts.money + transfers}. Use o saldo do motor ou não cite o valor.`);
  }

  for (const leak of leakedSecrets(text, npcs, narratorTools))
    warnings.push(`Possível vazamento de segredo de ${leak.npc.name} ("${leak.fact}"): se o jogador descobriu, chame reveal_npc; senão, não conte.`);

  // O DV é segredo do Mestre.
  if (/\b(DV|dificuldade)\s*(de\s*)?\d{1,2}\b/i.test(text)) warnings.push('A narração revelou o DV/dificuldade numérica — isso é segredo do Mestre.');

  // Morte do jogador só acontece pelo motor (Teste de Morte falho ou execute).
  const engineKills =
    opts.playerDead ||
    (result?.roll?.deathSave && !result.roll.deathSave.success) ||
    (result?.tools ?? []).some(t => t.ok && t.tool === 'execute' && /FLATLINE/.test(t.summary)) ||
    narratorTools.some(t => t.tool === 'execute' && t.args?.targetId === 'player');
  const told = text.replace(QUOTED, m => ' '.repeat(m.length)); // mesmos índices, sem as falas
  const death = PLAYER_DIES.exec(told);
  if (!engineKills && death && !NOT_REALLY.test(told.slice(0, death.index))) {
    warnings.push(
      'A narração declara a MORTE do jogador, mas o motor não o matou. Se ele está indefeso (set_condition) ou sob ameaça letal anunciada (lethal_threat) desde o turno anterior, chame execute com targetId "player" e narre o flatline; caso contrário, NÃO é fatal ainda: descreva o ferimento (ou anuncie a ameaça com lethal_threat) e deixe os PV/Teste de Morte do motor decidirem.',
    );
  }

  if (result?.roll?.deathSave && !result.roll.deathSave.success && /\b(sobrevive|recupera a consci|levanta)/i.test(text)) warnings.push('O personagem FALHOU no Teste de Morte e morreu.');
  return warnings;
}
