import { History, RefreshCw, Skull } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { Button } from '../../ui';
import { useUiStore } from '../../store/uiStore';
import { newCampaign } from '../../store/turnController';

export function GameOverOverlay({ game }: { game: GameState }) {
  const modal = useUiStore(s => s.modal);
  if (!game.character.dead || modal) return null;
  return (
    <div className="fixed inset-0 z-30 bg-surface-0/90 backdrop-blur-sm grid place-items-center p-6 animate-fade-in" role="alertdialog" aria-labelledby="flatline-title">
      <div className="text-center space-y-4 max-w-sm">
        <Skull className="w-14 h-14 mx-auto text-danger drop-shadow-[0_0_16px_rgba(255,0,60,0.7)]" />
        <h2 id="flatline-title" className="font-display text-3xl font-black tracking-[0.3em] text-danger">
          FLATLINE
        </h2>
        <p className="text-sm text-muted">
          {game.character.bio.handle} bateu as botas em {game.world.location.district}. Night City nem piscou.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="solid" tone="yellow" icon={<History className="w-4 h-4" />} onClick={() => useUiStore.getState().openLog('timeline')}>
            Voltar no tempo
          </Button>
          <Button
            variant="ghost"
            tone="danger"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => {
              if (window.confirm('Começar uma nova campanha?')) newCampaign();
            }}
          >
            Nova campanha
          </Button>
        </div>
      </div>
    </div>
  );
}
