import { Cpu } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { effectiveEmp } from '@shared/rules/stats';
import { Badge, Empty, Meter } from '../../ui';

export function CyberTab({ game }: { game: GameState }) {
  const c = game.character;
  const emp = Math.min(c.stats.EMP, effectiveEmp(c.humanity.current));
  return (
    <div className="space-y-4">
      <Meter label="Humanidade" value={c.humanity.current} max={c.humanity.max} tone="purple" />
      <p className="text-xs text-muted">
        EMP efetivo: <span className="tabular text-fg">{emp}</span> de {c.stats.EMP}. Cada 10 pontos de Humanidade perdidos reduzem a Empatia. Abaixo de 20 o
        risco de ciberpsicose é real.
      </p>
      {c.cyberware.length === 0 ? (
        <Empty icon={<Cpu className="w-8 h-8" />} title="Carne e osso">
          Nenhum implante instalado. Um Medicânico pode mudar isso, se você tiver os eddies.
        </Empty>
      ) : (
        <ul className="space-y-1.5">
          {c.cyberware.map(cw => (
            <li key={cw.id} className="border border-neon-purple/30 bg-neon-purple/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-fg">{cw.name}</p>
                <Badge tone="purple">−{cw.humanityLoss} HUM</Badge>
              </div>
              <p className="text-[11px] text-muted">{cw.category}</p>
              {cw.description && <p className="text-xs text-muted mt-1">{cw.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
