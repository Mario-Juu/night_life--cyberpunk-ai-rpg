export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export type Tone = 'cyan' | 'magenta' | 'yellow' | 'green' | 'purple' | 'danger';
