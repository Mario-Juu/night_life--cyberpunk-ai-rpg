import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { GameState } from '@shared/types/game';
import { characterWoundState } from '@shared/engine/health';
import { useUiStore } from '../../store/uiStore';
import { useVfxStore, type VfxEvent } from '../../store/vfxStore';

const DURATION: Record<VfxEvent['kind'], number> = { damage: 650, crit: 900, fumble: 700, combat: 1400, heal: 1100, glitch: 450 };

function Transient({ event }: { event: VfxEvent }) {
  const remove = useVfxStore(s => s.remove);
  useEffect(() => {
    const t = setTimeout(() => remove(event.id), DURATION[event.kind]);
    return () => clearTimeout(t);
  }, [event, remove]);

  switch (event.kind) {
    case 'damage':
      return <div className="absolute inset-0 vfx-flash" style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(255,0,60,0.55) 100%)' }} />;
    case 'crit':
      return <div className="absolute inset-0 vfx-flash" style={{ background: 'radial-gradient(circle at center, rgba(57,255,20,0.28) 0%, transparent 60%)' }} />;
    case 'heal':
      return <div className="absolute inset-0 vfx-flash-slow" style={{ background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,240,255,0.25) 100%)' }} />;
    case 'combat':
      return (
        <>
          <div className="absolute inset-x-0 top-0 h-2 vfx-siren" style={{ background: 'linear-gradient(90deg, transparent, #ff003c, transparent)' }} />
          <div className="absolute inset-x-0 bottom-0 h-2 vfx-siren" style={{ background: 'linear-gradient(90deg, transparent, #ff003c, transparent)' }} />
          <div className="absolute inset-0 vfx-flash" style={{ background: 'rgba(255,0,60,0.12)' }} />
        </>
      );
    case 'fumble':
    case 'glitch':
      return (
        <div className="absolute inset-0 vfx-glitch">
          {[12, 34, 58, 77].map((top, i) => (
            <div
              key={i}
              className="absolute inset-x-0"
              style={{ top: `${top}%`, height: `${3 + (i % 2) * 5}px`, background: i % 2 ? 'rgba(0,240,255,0.35)' : 'rgba(255,0,234,0.35)', transform: `translateX(${i % 2 ? 8 : -12}px)` }}
            />
          ))}
        </div>
      );
  }
}

/**
 * Camada de efeitos sobre a tela: scanlines + vinheta permanentes, pulso vermelho
 * com PV baixo e efeitos momentâneos (dano, crítico, falha, combate, cura).
 */
export function VfxLayer({ game }: { game: GameState | null }) {
  const enabled = useUiStore(s => s.vfx);
  const events = useVfxStore(s => s.events);
  if (!enabled) return null;
  const wound = game ? characterWoundState(game.character) : 'healthy';

  return createPortal(
    <div className="fixed inset-0 z-45 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute inset-0 vfx-scanlines" />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.45) 100%)' }} />
      {(wound === 'seriously' || wound === 'mortally') && (
        <div
          className={wound === 'mortally' ? 'absolute inset-0 vfx-pulse-fast' : 'absolute inset-0 vfx-pulse'}
          style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(255,0,60,0.35) 100%)' }}
        />
      )}
      {events.map(e => (
        <Transient key={e.id} event={e} />
      ))}
    </div>,
    document.body,
  );
}
