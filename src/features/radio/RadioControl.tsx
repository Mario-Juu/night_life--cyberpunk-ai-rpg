import { useEffect, useState } from 'react';
import { Loader2, Pause, Play, Radio, SkipBack, SkipForward, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { STATIONS, radio } from '../../services/radioEngine';
import { sound } from '../../services/audio';
import { cn } from '../../ui';

function useRadio() {
  const read = () => ({
    station: radio.getCurrentStation(),
    index: radio.getStationIndex(),
    status: radio.getStatus(),
    muted: radio.getIsMuted(),
    volume: radio.getVolume(),
    news: radio.getCurrentNews(),
  });
  const [state, setState] = useState(read);
  useEffect(() => radio.subscribe(() => setState(read())), []);
  return state;
}

const STATUS_TEXT = { stopped: 'desligado', loading: 'sintonizando…', playing: 'no ar', offline: 'sem sinal' } as const;

/** Controle compacto da rádio de Night City. */
export function RadioControl({ expanded = false }: { expanded?: boolean }) {
  const r = useRadio();
  const active = r.status === 'playing' || r.status === 'loading';
  const click = (fn: () => void) => () => {
    sound.playClick();
    fn();
  };

  const StatusIcon = r.status === 'loading' ? Loader2 : r.status === 'offline' ? WifiOff : Radio;

  return (
    <div className={cn('flex min-w-0', expanded ? 'flex-col gap-3' : 'items-center gap-1')}>
      <div className="flex items-center gap-1 min-w-0">
        <StatusIcon
          className={cn(
            'w-4 h-4 shrink-0',
            r.status === 'playing' && 'text-neon-magenta animate-pulse-soft',
            r.status === 'loading' && 'text-neon-yellow animate-spin',
            r.status === 'offline' && 'text-danger',
            r.status === 'stopped' && 'text-dim',
          )}
        />
        <div className={cn('min-w-0', expanded ? 'flex-1' : 'hidden xl:block w-36')}>
          <p className="font-display text-[10px] uppercase tracking-wider truncate text-fg" title={r.station.description}>
            {r.station.name}
          </p>
          <p className={cn('tabular text-[9px] truncate', r.status === 'offline' ? 'text-danger' : 'text-dim')}>
            {r.station.frequency} · {STATUS_TEXT[r.status]}
          </p>
        </div>
        {expanded && (
          <button type="button" onClick={click(() => radio.prevStation())} aria-label="Estação anterior" className="p-1.5 text-muted hover:text-neon-magenta">
            <SkipBack className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={click(() => radio.togglePlay())}
          aria-label={active ? 'Parar rádio' : 'Tocar rádio'}
          aria-pressed={active}
          className="p-1.5 text-muted hover:text-neon-magenta"
        >
          {active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button type="button" onClick={click(() => radio.nextStation())} aria-label="Próxima estação" className="p-1.5 text-muted hover:text-neon-magenta">
          <SkipForward className="w-4 h-4" />
        </button>
        <button type="button" onClick={click(() => radio.toggleMute())} aria-label={r.muted ? 'Ativar som da rádio' : 'Silenciar rádio'} className="p-1.5 text-muted hover:text-neon-magenta">
          {r.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>

      {expanded && (
        <>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={r.volume}
            onChange={e => radio.setVolume(Number(e.target.value))}
            aria-label="Volume da rádio"
            className="w-full accent-[var(--color-neon-magenta)]"
          />
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1" aria-label="Estações">
            {STATIONS.map((st, i) => (
              <li key={st.id}>
                <button
                  type="button"
                  onClick={click(() => {
                    if (i !== r.index) radio.setStation(i);
                    if (!active || i !== r.index) {
                      if (radio.getStatus() !== 'loading' && radio.getStatus() !== 'playing') radio.play();
                    }
                  })}
                  aria-current={i === r.index ? 'true' : undefined}
                  className={cn(
                    'w-full text-left border px-2 py-1.5 transition-colors',
                    i === r.index ? 'border-neon-magenta bg-neon-magenta/10' : 'border-line hover:border-muted',
                  )}
                >
                  <span className="block font-display text-[10px] uppercase tracking-wider truncate">{st.name}</span>
                  <span className="block text-[10px] text-dim truncate">
                    {st.frequency} · {st.genre}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted italic line-clamp-2">📡 {r.news}</p>
        </>
      )}
    </div>
  );
}
