import { CarFront, Crosshair, Gauge, ShieldAlert, Wind } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { Badge, Button, Meter } from '../../ui';
import { quickTool } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

const ACTIONS = [
  { key: 'drive', label: 'Dirigir', icon: Gauge, text: 'Forço o carro a ganhar distância.' },
  { key: 'evade', label: 'Evadir', icon: Wind, text: 'Desvio do tráfego e dos tiros.' },
  { key: 'escape', label: 'Escapar', icon: CarFront, text: 'Procuro uma rota para despistar os perseguidores.' },
  { key: 'ram', label: 'Abalroar', icon: ShieldAlert, text: 'Jogo o carro contra o veículo perseguidor.' },
  { key: 'shoot', label: 'Atirar', icon: Crosshair, text: 'Atiro no veículo perseguidor.' },
] as const;

/** Painel de perseguição: é paralelo ao combate e oferece ações diretas do motor. */
export function ChasePanel({ game }: { game: GameState }) {
  const chase = game.world.chase;
  const busy = useUiStore(s => s.gmBusy);
  if (!chase) return null;
  const blocked = busy || !!game.pendingRoll;
  return (
    <div className="space-y-4">
      <header className="space-y-1 border border-neon-yellow/50 bg-neon-yellow/5 p-3">
        <p className="eyebrow text-neon-yellow flex items-center gap-1.5"><CarFront className="w-3.5 h-3.5" /> Perseguição ativa</p>
        <h3 className="font-display text-sm uppercase tracking-wider text-fg">{chase.opponent}</h3>
        <p className="text-[11px] text-muted">{chase.reason}</p>
      </header>
      <div className="grid grid-cols-2 gap-2">
        <Meter label="Pressão" value={chase.pressure} max={5} tone="danger" size="sm" />
        <Meter label="Seu veículo" value={chase.vehicleIntegrity} max={6} tone={chase.vehicleIntegrity <= 2 ? 'danger' : 'cyan'} size="sm" />
        <Meter label="Veículo alvo" value={chase.opponentIntegrity} max={6} tone="yellow" size="sm" />
        <div className="flex items-center justify-center"><Badge tone="yellow">0 pressão = escapou</Badge></div>
      </div>
      <section className="space-y-2">
        <p className="eyebrow">Manobras</p>
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map(({ key, label, icon: Icon, text }) => (
            <Button key={key} size="sm" variant={key === 'escape' ? 'solid' : 'ghost'} tone={key === 'ram' ? 'danger' : key === 'shoot' ? 'yellow' : 'cyan'} disabled={blocked} icon={<Icon className="w-3.5 h-3.5" />} onClick={() => void quickTool('chase_action', { action: key }, text)}>
              {label}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
