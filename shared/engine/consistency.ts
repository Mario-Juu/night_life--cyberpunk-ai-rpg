/**
 * Verificador de consistência narrativa: detecta quando a narração contradiz o motor.
 * Heurístico e conservador (poucos falsos positivos). Usado pelo servidor (nova tentativa)
 * e pelos evals.
 */
import type { Dialogue, Npc } from '../types/game';
import type { EngineResult, ToolCall } from '../types/turn';

const FIRED = /\b(dispar(a|ou|am|o)|atir(a|ou|am)|bala(s)? (atravess|acert|rasg|perfur)|tiro (acert|atravess|rasg|atinge))/i;
const DRY = /(clique seco|click seco|clique vazio|sem muni|descarregad|vazi[ao]|nada acontece|o gatilho estala)/i;
const HIT = /\b(acert(a|ou|ando)|atinge|atingiu|rasga|perfura)\b/i;
const MISS = /\b(err(a|ou)|passa (raspando|longe)|desvia|zune ao lado|não acerta)\b/i;

function norm(t: string) {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const MONEY_TOOLS = ['pay_money', 'buy_item', 'transfer_money', 'loot', 'complete_quest'];
/** Jogador pagando/transferindo/gastando um valor em eddies. */
const PLAYER_PAYS = /\b(transfer\w*|pag(a|ou|ando|ar|amento)|quit(a|ou|ar|ação)|deposit\w*|gast(a|ou|ar)|abat(e|eu|er)|desembols\w*)[^.\n]{0,90}?(€\$?\s?\d|\d[\d.]*\s?(eddies|€))/i;

export function checkNarration(result: EngineResult | null, narration: string, dialogues: Dialogue[], npcs: Npc[], narratorTools: ToolCall[] = []): string[] {
  const warnings: string[] = [];
  const text = narration;

  // NPC morto falando.
  const dead = npcs.filter(n => n.status === 'dead');
  const speakers = [...dialogues.map(d => d.speaker), ...Array.from(text.matchAll(/\[(?:DIALOGUE|FALA):\s*([^\]]+)\]/gi)).map(m => m[1])];
  for (const n of dead) {
    const first = norm(n.name).replace(/["“”]/g, '').split(/\s+/)[0];
    if (speakers.some(sp => norm(sp).includes(first))) warnings.push(`${n.name} está MORTO e não pode falar.`);
  }

  const attack = result?.roll?.attack;
  const failedAttackTool = result?.tools.find(t => t.tool === 'attack' && !t.ok);
  const noAmmo = attack?.failure === 'no_ammo' || /descarregad|clique seco/i.test(failedAttackTool?.summary ?? '');
  if (noAmmo && FIRED.test(text) && !DRY.test(text)) warnings.push('A arma estava SEM MUNIÇÃO: nenhum disparo aconteceu.');

  if (attack && !attack.failure) {
    if (attack.hit && MISS.test(text) && !HIT.test(text)) warnings.push(`O ataque ACERTOU ${attack.targetName}; a narração diz que errou.`);
    if (!attack.hit && HIT.test(text) && !MISS.test(text) && !/quase|por pouco/i.test(text)) warnings.push(`O ataque ERROU ${attack.targetName}; a narração diz que acertou.`);
  }

  const check = result?.roll && !result.roll.attack && !result.roll.initiative && !result.roll.deathSave ? result.roll.check : null;
  if (check && !check.success && /\bcom sucesso\b|\bconsegue perfeitamente\b/i.test(text)) warnings.push('O teste FALHOU; a narração descreve sucesso.');

  // Dinheiro só se move pelo motor: narrar um pagamento que nenhuma ferramenta registrou é contradição.
  const moneyMoved = (result?.tools ?? []).some(t => t.ok && MONEY_TOOLS.includes(t.tool)) || narratorTools.some(t => MONEY_TOOLS.includes(t.tool));
  if (!moneyMoved && PLAYER_PAYS.test(text)) warnings.push('A narração descreve o jogador pagando/transferindo eddies, mas o motor NÃO registrou nenhum pagamento — o saldo não mudou. Narre que o pagamento não aconteceu (ou ainda está pendente).');

  // O DV é segredo do Mestre.
  if (/\b(DV|dificuldade)\s*(de\s*)?\d{1,2}\b/i.test(text)) warnings.push('A narração revelou o DV/dificuldade numérica — isso é segredo do Mestre.');

  if (result?.roll?.deathSave && !result.roll.deathSave.success && /\b(sobrevive|recupera a consci|levanta)/i.test(text)) warnings.push('O personagem FALHOU no Teste de Morte e morreu.');
  return warnings;
}
