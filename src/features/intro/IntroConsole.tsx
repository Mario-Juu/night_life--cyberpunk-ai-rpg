import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../ui';
import { sound } from '../../services/audio';

type LineTone = 'sys' | 'ok' | 'warn' | 'lore' | 'accent';

interface ScriptLine {
  text: string;
  tone: LineTone;
  /** ms por caractere */
  speed: number;
  /** pausa depois da linha (ms) */
  pause: number;
}

const sys = (text: string, pause = 90): ScriptLine => ({ text, tone: 'sys', speed: 4, pause });
const ok = (text: string): ScriptLine => ({ text, tone: 'ok', speed: 4, pause: 120 });
const lore = (text: string, pause = 520): ScriptLine => ({ text, tone: 'lore', speed: 17, pause });

/** Contexto do mundo (Night City, 2077) — curto, evocativo e fiel ao cenário. */
export const INTRO_SCRIPT: ScriptLine[] = [
  sys('ZETATECH BIOS v7.7.2 — (c) 2077 Zetatech Corp.'),
  sys('Checando memória neural .......... 64 TB'),
  ok('[ OK ] Interface neural sincronizada'),
  ok('[ OK ] Agente de bolso pareado'),
  sys('Conectando à Rede Pública de Night City', 200),
  { text: '[ AVISO ] Sinal instável — setor Watson com interferência corporativa', tone: 'warn', speed: 4, pause: 400 },
  ok('[ OK ] Conexão estabelecida'),
  { text: '', tone: 'sys', speed: 0, pause: 250 },
  { text: '> ANO 2077 · NIGHT CITY · ESTADO LIVRE DA CALIFÓRNIA DO NORTE', tone: 'accent', speed: 12, pause: 600 },
  lore('Meio século depois da bomba que derrubou a torre da Arasaka, a cidade foi reconstruída sobre as cinzas. E vendida de novo.'),
  lore('Quem manda são as megacorporações: Arasaka, Militech, Kang Tao, Biotechnica. A lei é um contrato de serviço, e a NCPD patrulha quem não pode pagar a Equipe de Trauma.'),
  lore('Nas ruas, as gangues dividem os distritos: Maelstrom, Tyger Claws, Valentinos, 6th Street, Voodoo Boys.'),
  lore('O cromo é barato; as dívidas, não. Cada implante leva um pedaço da sua humanidade.'),
  lore('Edgerunners vivem rápido e morrem cedo. Poucos viram lenda no Afterlife.', 700),
  { text: '', tone: 'sys', speed: 0, pause: 200 },
  { text: 'Você ainda não é ninguém. Tem uma dívida, alguém que depende de você e uma arma no bolso.', tone: 'accent', speed: 22, pause: 700 },
  { text: 'Bem-vindo a Night City, choom.', tone: 'accent', speed: 40, pause: 400 },
];

const TONE_CLASS: Record<LineTone, string> = {
  sys: 'text-muted',
  ok: 'text-neon-green',
  warn: 'text-neon-yellow',
  lore: 'text-fg/90 font-sans text-[15px] sm:text-base leading-relaxed',
  accent: 'text-neon-cyan font-display tracking-wider',
};

/**
 * Introdução em console: boot do sistema + contexto de Night City, digitado.
 * Começa com um "conectar" (o primeiro gesto libera o áudio do navegador).
 */
export function IntroConsole({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<'gate' | 'typing' | 'done'>('gate');
  const [lineIdx, setLineIdx] = useState(0);
  const [chars, setChars] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const finishTyping = useCallback(() => {
    setLineIdx(INTRO_SCRIPT.length);
    setChars(0);
    setPhase('done');
  }, []);

  const start = useCallback(() => {
    sound.playBoot();
    setPhase('typing');
  }, []);

  // Máquina de digitação: um caractere por vez, pausa ao fim de cada linha.
  useEffect(() => {
    if (phase !== 'typing') return;
    const line = INTRO_SCRIPT[lineIdx];
    if (!line) {
      setPhase('done');
      return;
    }
    if (chars < line.text.length) {
      const t = setTimeout(() => {
        setChars(c => c + 1);
        if (line.text[chars] !== ' ') sound.playKey();
      }, line.speed);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setLineIdx(i => i + 1);
      setChars(0);
    }, line.pause);
    return () => clearTimeout(t);
  }, [phase, lineIdx, chars]);

  useEffect(() => {
    if (phase === 'done') sound.playGlitch();
  }, [phase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lineIdx, chars, phase]);

  // Teclado: qualquer tecla conecta; Enter/Espaço completa; Enter no fim avança; Esc pula tudo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onDone();
      if (phase === 'gate') return start();
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (phase === 'typing') finishTyping();
      else onDone();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, start, finishTyping, onDone]);

  const onClick = () => {
    if (phase === 'gate') start();
    else if (phase === 'typing') finishTyping();
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-0 text-fg overflow-hidden" onClick={onClick} role="dialog" aria-label="Introdução">
      <div className="absolute inset-0 vfx-scanlines pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)' }} />

      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          onDone();
        }}
        className="absolute top-3 right-3 z-10 text-[10px] uppercase tracking-widest text-dim hover:text-neon-cyan px-2 py-1"
      >
        Pular introdução
      </button>

      {phase === 'gate' ? (
        <div className="h-full grid place-items-center p-6 text-center">
          <div className="space-y-5">
            <p className="font-display text-2xl sm:text-3xl font-black tracking-[0.3em] text-neon-cyan drop-shadow-[0_0_14px_rgba(0,240,255,0.6)]">
              NIGHT<span className="text-neon-magenta">//</span>LIFE
            </p>
            <p className="tabular text-xs sm:text-sm text-muted caret-blink">TOQUE OU PRESSIONE QUALQUER TECLA PARA CONECTAR</p>
            <p className="text-[10px] text-dim">recomendado: som ligado</p>
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto px-4 sm:px-10 py-10">
          <div className="max-w-3xl mx-auto space-y-2 tabular text-xs sm:text-sm" aria-live="polite">
            {INTRO_SCRIPT.slice(0, lineIdx + 1).map((line, i) => {
              const text = i < lineIdx ? line.text : line.text.slice(0, chars);
              if (!line.text) return <div key={i} className="h-3" />;
              const typing = i === lineIdx && phase === 'typing';
              return (
                <p key={i} className={cn(TONE_CLASS[line.tone], typing && 'caret-blink', line.tone === 'lore' && 'pl-3 border-l border-line')}>
                  {text}
                </p>
              );
            })}

            {phase === 'done' && (
              <div className="pt-10 pb-6 text-center space-y-6 animate-reveal">
                <p className="font-display text-4xl sm:text-6xl font-black tracking-[0.25em] text-neon-cyan vfx-logo">
                  NIGHT<span className="text-neon-magenta">//</span>LIFE
                </p>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    sound.playClick();
                    onDone();
                  }}
                  className="cp-btn cp-btn--neon cp-btn--yellow cp-btn--lg"
                  autoFocus
                >
                  [ ENTER ] Iniciar registro
                </button>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}
    </div>
  );
}
