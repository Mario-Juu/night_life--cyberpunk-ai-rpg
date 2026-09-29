import { useRef, useState } from 'react';
import { Download, HardDrive, Trash2, Upload } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { Button, Modal } from '../../ui';
import { toast } from '../../ui/toastStore';
import { SLOT_COUNT, deleteSlot, exportSave, importSave, listSlots, loadFromSlot, saveToSlot } from '../../services/saves';
import { useGameStore } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';

export function SaveLoadModal({ game }: { game: GameState }) {
  const open = useUiStore(s => s.modal === 'saves');
  const close = () => useUiStore.getState().openModal(null);
  const [slots, setSlots] = useState(listSlots);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => setSlots(listSlots());

  const load = (state: GameState, label: string) => {
    useGameStore.getState().setGame(state);
    useUiStore.setState({ activeThread: null, phoneOpen: false });
    toast({ title: 'Campanha carregada', body: label, tone: 'success' });
    close();
  };

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      toast({ title: 'Erro', body: (err as Error).message, tone: 'danger' });
    }
  };

  return (
    <Modal open={open} onClose={close} title="Salvar / Carregar" subtitle="O jogo salva automaticamente a cada ação. Use slots para guardar pontos de retorno." size="md">
      <div className="space-y-3">
        {Array.from({ length: SLOT_COUNT }, (_, i) => {
          const slot = i + 1;
          const info = slots[i];
          return (
            <div key={slot} className="border border-line bg-surface-0/50 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <HardDrive className="w-5 h-5 text-neon-cyan shrink-0 hidden sm:block" />
              <div className="flex-1 min-w-0">
                <p className="font-display text-xs uppercase tracking-wider">Slot {slot}</p>
                {info ? (
                  <p className="text-xs text-muted truncate">
                    {info.handle} · {info.title} · turno {info.turn} · {new Date(info.savedAt).toLocaleString('pt-BR')}
                  </p>
                ) : (
                  <p className="text-xs text-dim">Vazio</p>
                )}
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="solid"
                  onClick={() =>
                    guard(() => {
                      if (info && !window.confirm(`Sobrescrever o slot ${slot}?`)) return;
                      saveToSlot(slot, game);
                      refresh();
                      toast({ title: `Salvo no slot ${slot}`, tone: 'success' });
                    })
                  }
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" disabled={!info} onClick={() => guard(() => window.confirm('Carregar este slot? O progresso atual não salvo será perdido.') && load(loadFromSlot(slot), `Slot ${slot}`))}>
                  Carregar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  tone="danger"
                  disabled={!info}
                  aria-label={`Apagar slot ${slot}`}
                  icon={<Trash2 className="w-3 h-3" />}
                  onClick={() => {
                    if (window.confirm(`Apagar o slot ${slot}?`)) {
                      deleteSlot(slot);
                      refresh();
                    }
                  }}
                />
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2 pt-3 border-t border-line-soft">
          <Button variant="ghost" icon={<Download className="w-4 h-4" />} onClick={() => exportSave(game)}>
            Exportar arquivo
          </Button>
          <Button variant="ghost" icon={<Upload className="w-4 h-4" />} onClick={() => fileRef.current?.click()}>
            Importar arquivo
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                load(await importSave(file), file.name);
              } catch (err) {
                toast({ title: 'Importação falhou', body: (err as Error).message, tone: 'danger' });
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
