import { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import { sound } from '../../services/audio';
import { checkKey, fetchStatus } from '../../services/api';
import { useUiStore } from '../../store/uiStore';

type Tone = 'sys' | 'ok' | 'warn' | 'err' | 'accent' | 'input';
interface Line {
  text: string;
  tone: Tone;
}

/** Linhas de boot do terminal de acesso (digitadas rápido, como na introdução). */
const BOOT: Line[] = [
  { text: 'ZETATECH BIOS v7.7.2 — (c) 2077 Zetatech Corp.', tone: 'sys' },
  { text: 'Iniciando terminal de acesso à Rede ..........', tone: 'sys' },
  { text: '[ AVISO ] Nenhuma credencial de IA encontrada neste deck', tone: 'warn' },
  { text: '', tone: 'sys' },
  { text: '> ACESSO RESTRITO — O MESTRE DE NIGHT CITY PRECISA DE UMA CHAVE GEMINI', tone: 'accent' },
  { text: 'A chave é grátis: gere a sua no Google AI Studio e cole abaixo.', tone: 'sys' },
  { text: 'Ela fica salva só neste navegador e vai direto para o servidor do jogo a cada turno — mais ninguém vê.', tone: 'sys' },
  { text: 'Plano gratuito: ~20 pedidos por dia por modelo (cada turno usa 2 ou 3). Dá para trocar depois em Configurações.', tone: 'sys' },
];

const KEY_FORMAT = /^[A-Za-z0-9_\-.]{20,200}$/;

const TONE_CLASS: Record<Tone, string> = {
  sys: 'text-muted',
  ok: 'text-neon-green',
  warn: 'text-neon-yellow',
  err: 'text-danger',
  accent: 'text-neon-cyan font-display tracking-wider',
  input: 'text-fg',
};

const mask = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 4)}${'•'.repeat(12)}${k.slice(-4)}`);

/**
 * Terminal de acesso: antes da introdução e da criação de personagem, pede a chave Gemini do
 * jogador (o servidor não tem chave própria) e só libera quando o Google aceitá-la.
 */
export function KeyGate({ onDone }: { onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const [chars, setChars] = useState(0);
  const [log, setLog] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const booted = shown >= BOOT.length;

  // Digitação do boot: rápida (4 ms por caractere), com uma pausa curta entre as linhas.
  useEffect(() => {
    if (booted) return;
    const line = BOOT[shown];
    if (chars < line.text.length) {
      const t = setTimeout(() => setChars(c => c + 2), 4);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShown(i => i + 1);
      setChars(0);
    }, line.text ? 110 : 60);
    return () => clearTimeout(t);
  }, [booted, shown, chars]);

  useEffect(() => {
    if (booted && !checking) inputRef.current?.focus();
  }, [booted, checking]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [shown, chars, log, checking]);

  const skipBoot = () => {
    if (!booted) {
      setShown(BOOT.length);
      setChars(0);
    } else inputRef.current?.focus();
  };

  const accept = async (key: string, note: Line) => {
    useUiStore.getState().setGeminiKey(key);
    const status = await fetchStatus();
    useUiStore.getState().setHasKey(status.hasKey || !!key);
    setLog(l => [...l, note, { text: 'Bem-vindo à Rede, choom.', tone: 'accent' }]);
    sound.playSuccess();
    setTimeout(onDone, 1100);
  };

  const submit = async () => {
    const key = draft.trim();
    if (!key || checking) return;
    sound.playClick();
    setLog(l => [...l, { text: `CHAVE> ${mask(key)}`, tone: 'input' }]);
    if (!KEY_FORMAT.test(key)) {
      setLog(l => [...l, { text: '[ ERRO ] Formato inválido — cole a chave inteira, sem espaços (começa com "AIza" ou "AQ.").', tone: 'err' }]);
      sound.playAlert();
      return;
    }
    setChecking(true);
    setLog(l => [...l, { text: 'Verificando credencial com a Rede ..........', tone: 'sys' }]);
    const res = await checkKey(key);
    setChecking(false);
    if (res.valid === true) return accept(key, { text: '[ OK ] Credencial aceita. Mestre online.', tone: 'ok' });
    if (res.valid === null)
      return accept(key, { text: '[ AVISO ] Não deu para verificar agora (rede instável). A chave foi salva e será testada no primeiro turno.', tone: 'warn' });
    setDraft('');
    sound.playAlert();
    setLog(l => [...l, { text: '[ ERRO ] O Google recusou esta chave. Confira se copiou inteira e se ela está ativa no AI Studio.', tone: 'err' }]);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-surface-0 text-fg overflow-hidden" onClick={skipBoot} role="dialog" aria-label="Chave de acesso">
      <div className="absolute inset-0 vfx-scanlines pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)' }} />

      <div className="h-full overflow-y-auto px-4 sm:px-10 py-10">
        <div className="max-w-3xl mx-auto space-y-2 tabular text-xs sm:text-sm" aria-live="polite">
          {BOOT.slice(0, shown + 1).map((line, i) => {
            if (i > shown || (i === shown && booted)) return null;
            const text = i < shown ? line.text : line.text.slice(0, chars);
            if (!line.text) return <div key={i} className="h-3" />;
            return (
              <p key={i} className={cn(TONE_CLASS[line.tone], i === shown && 'caret-blink')}>
                {text}
              </p>
            );
          })}

          {booted && (
            <>
              <p className="pt-1">
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-neon-magenta underline underline-offset-4 hover:text-neon-cyan"
                >
                  → aistudio.google.com/apikey
                </a>
                <span className="text-dim"> (entre com sua conta Google → "Create API key" → copie)</span>
              </p>
              <div className="h-2" />
              {log.map((line, i) => (
                <p key={i} className={TONE_CLASS[line.tone]}>
                  {line.text}
                </p>
              ))}
              {checking ? (
                <p className="text-muted caret-blink">aguardando resposta</p>
              ) : (
                !log.some(l => l.tone === 'ok' || (l.tone === 'warn' && l.text.includes('salva'))) && (
                  <form
                    className="flex items-center gap-2 border-b border-neon-cyan/40 focus-within:border-neon-cyan py-1"
                    onSubmit={e => {
                      e.preventDefault();
                      void submit();
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="text-neon-cyan shrink-0">CHAVE&gt;</span>
                    <input
                      ref={inputRef}
                      type="password"
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Chave de acesso Gemini"
                      placeholder="cole sua chave e aperte Enter"
                      className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-dim tabular"
                    />
                    <button type="submit" disabled={!draft.trim()} className="cp-btn cp-btn--neon cp-btn--sm shrink-0 disabled:opacity-40">
                      [ ENTER ] Conectar
                    </button>
                  </form>
                )
              )}
            </>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}
