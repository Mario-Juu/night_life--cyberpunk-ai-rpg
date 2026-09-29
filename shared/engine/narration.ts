import type { Dialogue } from '../types/game';

export type NarrationSegment = { kind: 'text'; text: string } | { kind: 'dialogue'; speaker: string; text: string };

const TAG_RE = /\[(?:DIALOGUE|FALA):\s*([^\]]+)\]([\s\S]*?)\[\/(?:DIALOGUE|FALA)\]/gi;

function stripQuotes(text: string): string {
  return text.trim().replace(/^["“”«]+|["“”»]+$/g, '').trim();
}

/** Divide a narração em trechos de texto e falas, na ordem em que aparecem. */
export function parseNarration(narration: string): NarrationSegment[] {
  const segments: NarrationSegment[] = [];
  let last = 0;
  for (const m of narration.matchAll(TAG_RE)) {
    const before = narration.slice(last, m.index).trim();
    if (before) segments.push({ kind: 'text', text: before });
    const text = stripQuotes(m[2]);
    if (text) segments.push({ kind: 'dialogue', speaker: m[1].trim(), text });
    last = (m.index ?? 0) + m[0].length;
  }
  const rest = narration.slice(last).trim();
  if (rest) segments.push({ kind: 'text', text: rest });
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
