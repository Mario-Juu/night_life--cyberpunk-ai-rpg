import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { merchantItem } from '@shared/rules/merchantCatalog';
import { Button, Modal } from '../../ui';
import { quickTool } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

/** A banca só aparece como ação no fim da cena; não interrompe a narrativa com modal automático. */
export function MerchantCatalogAction({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const busy = useUiStore(s => s.gmBusy);
  const catalog = game.world.merchantCatalog;
  if (!catalog || (catalog.expiresTurn !== undefined && game.turn > catalog.expiresTurn)) return null;
  const items = catalog.stock.map(merchantItem).filter((item): item is NonNullable<ReturnType<typeof merchantItem>> => !!item);
  const negotiating = !!game.world.tradeOffer;
  const quantityOf = (key: string) => quantities[key] ?? 1;
  const setQuantity = (key: string, value: number) => setQuantities(current => ({ ...current, [key]: Math.max(1, Math.min(999, value)) }));
  return (
    <section className="border border-neon-yellow/50 bg-neon-yellow/5 p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow text-neon-yellow">Catálogo disponível</p>
        <p className="mt-0.5 text-sm text-fg truncate">{catalog.seller} · {items.length} itens</p>
      </div>
      <Button size="sm" variant="solid" tone="yellow" disabled={negotiating} title={negotiating ? 'Finalize ou recuse a negociação pendente primeiro.' : undefined} icon={<ShoppingBag className="w-3.5 h-3.5" />} onClick={() => setOpen(true)}>{negotiating ? 'Negociação em andamento' : 'Abrir catálogo'}</Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title={catalog.seller}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map(item => {
            const quantity = quantityOf(item.key);
            const stackable = item.category === 'ammo' || item.category === 'consumable';
            const total = item.price * quantity;
            return <li key={item.key} className="border border-line bg-surface-0/30 p-3 space-y-2">
              <div className="flex justify-between gap-2"><p className="text-sm text-fg">{item.name}</p><span className="tabular text-neon-yellow">€${total}</span></div>
              <p className="text-[11px] leading-relaxed text-muted">{item.description}</p>
              {stackable && <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-dim">Qtd.</span>
                <input
                  aria-label={`Quantidade de ${item.name}`}
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  value={quantity}
                  onChange={event => setQuantity(item.key, Number.parseInt(event.target.value, 10) || 1)}
                  className="cp-input w-16 py-1 text-center tabular"
                />
              </div>}
              <Button size="sm" variant="ghost" tone="yellow" disabled={busy || negotiating || game.character.money < total} onClick={() => { setOpen(false); void quickTool('propose_catalog_item', { catalogKey: item.key, quantity }, `Quero ver os termos de ${quantity}× ${item.name}.`); }}>Negociar {quantity}×</Button>
            </li>;
          })}
        </ul>
      </Modal>
    </section>
  );
}
