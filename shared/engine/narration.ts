import type { Dialogue } from '../types/game';

export type NarrationSegment = { kind: 'text'; text: string } | { kind: 'dialogue'; speaker: string; text: string };

/** Abertura `[DIALOGUE: Nome]` (grupo 1) ou fechamento `[/DIALOGUE]`. Aceita FALA como sinônimo. */
const TAG_RE = /\[(?:DIALOGUE|FALA):\s*([^\]]+)\]|\[\/\s*(?:DIALOGUE|FALA)\s*\]/gi;

function stripQuotes(text: string): string {
  return text.trim().replace(/^["“”«]+|["“”»]+$/g, '').trim();
}

/**
 * Divide a narração em trechos de texto e falas, na ordem em que aparecem.
 * Tolerante a erros do modelo: fala aberta dentro de outra (a anterior termina ali),
 * fala sem fechamento (termina no próximo parágrafo) e fechamento solto (ignorado).
 */
export function parseNarration(narration: string): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  const pushText = (raw: string) => {
    const text = raw.trim();
    if (text) segments.push({ kind: 'text', text });
  };
  const pushDialogue = (speaker: string, raw: string, closed: boolean) => {
    // Sem fechamento: a fala vai até o fim do parágrafo; o resto volta a ser narração.
    const [body, ...after] = closed ? [raw] : raw.trim().split(/\n\s*\n/);
    const text = stripQuotes(body);
    if (text) segments.push({ kind: 'dialogue', speaker, text });
    if (after.length) pushText(after.join('\n\n'));
  };

  let speaker: string | null = null;
  let last = 0;
  for (const m of narration.matchAll(TAG_RE)) {
    const chunk = narration.slice(last, m.index);
    last = (m.index ?? 0) + m[0].length;
    const opening = m[1] !== undefined;
    if (speaker === null) pushText(chunk);
    else pushDialogue(speaker, chunk, !opening);
    speaker = opening ? m[1].trim() : null;
  }
  const rest = narration.slice(last);
  if (speaker === null) pushText(rest);
  else pushDialogue(speaker, rest, false);
  return segments;
}

export function hasDialogueTags(narration: string): boolean {
  return /\[(?:DIALOGUE|FALA):/i.test(narration);
}

/**
 * Se o modelo mandou falas só na lista `dialogues`, intercala-as entre os parágrafos
 * (evitando duplicar falas já presentes no texto).
 */
export function weaveDialogues(narration: string, dialogues: Dialogue[]): string {
  if (!dialogues.length || hasDialogueTags(narration)) return narration;
  const paragraphs = narration.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const pending = dialogues.filter(d => {
    const sample = stripQuotes(d.text).slice(0, 30).toLowerCase();
    return sample && !paragraphs.some(p => p.toLowerCase().includes(sample));
  });
  if (!pending.length) return narration;
  const block = (d: Dialogue) => `[DIALOGUE: ${d.speaker}]\n${stripQuotes(d.text)}\n[/DIALOGUE]`;
  if (!paragraphs.length) return pending.map(block).join('\n\n');

  const out: string[] = [];
  const step = Math.max(1, Math.floor(paragraphs.length / pending.length));
  let di = 0;
  paragraphs.forEach((p, i) => {
    out.push(p);
    if (di < pending.length && (i + 1) % step === 0 && i < paragraphs.length - 1) out.push(block(pending[di++]));
  });
  while (di < pending.length) out.splice(Math.max(1, out.length - 1), 0, block(pending[di++]));
  return out.join('\n\n');
}
