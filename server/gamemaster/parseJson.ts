/** Escapa quebras de linha cruas dentro de strings e remove vírgulas finais. */
export function repairJsonString(input: string): string {
  let inString = false;
  let escaped = false;
  let out = '';
  for (const ch of input) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse tolerante da saída do LLM. Retorna objeto ou lança erro —
 * nunca inventa conteúdo (o chamador decide o fallback).
 */
export function parseLlmJson(raw: string): Record<string, unknown> {
  let text = (raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const attempts = [text, repairJsonString(text)];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    text = text.slice(first, last + 1);
    attempts.push(text, repairJsonString(text));
  }
  for (const a of attempts) {
    const parsed = tryParse(a);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  }

  // Último recurso: recuperar só a narração.
  const m = raw.match(/"narration"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    const narration = tryParse(`"${m[1]}"`);
    if (typeof narration === 'string' && narration.trim().length > 20) return { narration };
  }
  throw new Error('Resposta do modelo não é JSON válido.');
}
