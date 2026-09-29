import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../ui';
import { sound } from '../../services/audio';
import { useDiceStore, type DiceShow, type ShownDie } from '../../store/diceStore';
import { vfx } from '../../store/vfxStore';

const ROLL_MS = 900; // tempo girando antes do primeiro dado parar
const STAGGER_MS = 220; // intervalo entre dados parando
const STAGE_PAUSE_MS = 650; // pausa mostrando o resultado de cada etapa
const HOLD_MS = 1100; // tempo mostrando o total antes de voltar à cena

const TONE_COLOR: Record<ShownDie['tone'], string> = {
  normal: 'var(--color-neon-cyan)',
  crit: 'var(--color-neon-green)',
  fumble: 'var(--color-danger)',
};

/** Um dado: gira mostrando faces aleatórias até `settled`, então pousa no valor real. */
function Die({ die, settled }: { die: ShownDie; settled: boolean }) {
  const [face, setFace] = useState(() => 1 + Math.floor(Math.random() * die.sides));
  useEffect(() => {
    if (settled) {
      setFace(die.value);
      return;
    }
    const t = setInterval(() => setFace(1 + Math.floor(Math.random() * die.sides)), 70);
    return () => clearInterval(t);
  }, [settled, die.sides, die.value]);

  const color = settled ? TONE_COLOR[die.tone] : 'var(--color-muted)';
  const isD10 = die.sides === 10;
  return (
    <div className={cn('relative w-20 h-20 sm:w-24 sm:h-24', settled ? 'animate-dice-land' : 'animate-dice-tumble')} aria-hidden>
      <svg viewBox="0 0 100 100" className="w-full h-full" style={{ filter: settled ? `drop-shadow(0 0 10px ${color})` : undefined }}>
        {isD10 ? (
          <>
            {/* d10: trapezoedro pentagonal visto de frente */}
            <polygon points="50,3 94,38 50,97 6,38" fill="var(--color-surface-2)" stroke={color} strokeWidth="3" strokeLinejoin="round" />
            <polyline points="6,38 50,56 94,38" fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="2" />
            <line x1="50" y1="56" x2="50" y2="97" stroke={color} strokeOpacity="0.45" strokeWidth="2" />
          </>
        ) : (
          <rect x="10" y="10" width="80" height="80" rx="12" fill="var(--color-surface-2)" stroke={color} strokeWidth="3" />
        )}
        <text
          x="50"
          y={isD10 ? 46 : 52}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={settled ? color : 'var(--color-fg)'}
          style={{ font: `700 ${face >= 10 ? 26 : 30}px var(--font-display)` }}
        >
          {face}
        </text>
      </svg>
    </div>
  );
}

function useSequence(show: DiceShow | null, onDone: () => void) {
  const [stage, setStage] = useState(0);
  const [settled, setSettled] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    setStage(0);
    setSettled(0);
    setShowResult(false);
  }, [show?.id]);

  useEffect(() => {
    if (!show) return;
    const current = show.stages[stage];
    if (!current) {
      doneRef.current();
      return;
    }
    if (!current.dice.length) {
      setStage(s => s + 1);
      return;
    }
    sound.playDiceRattle(ROLL_MS + (current.dice.length - 1) * STAGGER_MS);
    const timers: ReturnType<typeof setTimeout>[] = [];
    current.dice.forEach((_, i) =>
      timers.push(
        setTimeout(() => {
          setSettled(i + 1);
          sound.playDiceLand();
        }, ROLL_MS + i * STAGGER_MS),
      ),
    );
    const allSettled = ROLL_MS + (current.dice.length - 1) * STAGGER_MS;
    timers.push(
      setTimeout(() => {
        setShowResult(true);
        const d = current.dice[0];
        if (d?.tone === 'crit') {
          sound.playCrit();
          vfx('crit');
        }
        if (d?.tone === 'fumble') {
          sound.playFumble();
          vfx('fumble');
        }
      }, allSettled + 120),
    );
    const last = stage === show.stages.length - 1;
    timers.push(
      setTimeout(
        () => {
          if (last) return doneRef.current();
          setStage(s => s + 1);
          setSettled(0);
          setShowResult(false);
        },
        allSettled + (last ? HOLD_MS : STAGE_PAUSE_MS) + 120,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [show, stage]);

  return { stage, settled, showResult };
}

/** Overlay que encena a rolagem sobre a cena. Clique/Enter/Esc pula. */
export function DiceOverlay() {
  const show = useDiceStore(s => s.show);
  const finish = useDiceStore(s => s.finish);
  const setMounted = useDiceStore(s => s.setMounted);
  const { stage, settled, showResult } = useSequence(show, finish);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, [setMounted]);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', 'Escape', ' '].includes(e.key)) {
        e.preventDefault();
        finish();
      }
    };
    // Rede de segurança: nunca prende o jogo.
    const guard = setTimeout(finish, 12_000);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(guard);
    };
  }, [show, finish]);

  if (!show) return null;
  const current = show.stages[Math.min(stage, show.stages.length - 1)];

  return createPortal(
    <div
      className="fixed inset-0 z-55 grid place-items-center bg-surface-0/75 backdrop-blur-sm animate-fade-in cursor-pointer select-none"
      onClick={finish}
      role="dialog"
      aria-live="assertive"
      aria-label={`Rolagem: ${show.title}`}
    >
      <div className="flex flex-col items-center gap-5 px-6 text-center max-w-lg">
        <p className="eyebrow text-neon-yellow">{current?.label}</p>
        <p className="text-sm sm:text-base text-fg max-w-md">{show.title}</p>

        {current && (
          <div className="flex flex-wrap items-center justify-center gap-4 min-h-24" key={stage}>
            {current.dice.map((d, i) => (
              <Die key={i} die={d} settled={i < settled} />
            ))}
          </div>
        )}

        <p className={cn('tabular text-lg min-h-7 transition-opacity', showResult ? 'opacity-100 text-fg' : 'opacity-0')}>{current?.result}</p>

        <p className="text-[10px] uppercase tracking-widest text-dim">clique para pular</p>
      </div>
    </div>,
    document.body,
  );
}
