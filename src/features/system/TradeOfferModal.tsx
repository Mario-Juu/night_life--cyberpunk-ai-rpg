import { useEffect, useState } from 'react';
import { HandCoins, PackageCheck, ShoppingBag, X } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { Button, Modal } from '../../ui';
import { quickTool } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

/**
 * A IA só pode criar a oferta. Esta tela é a fronteira de autoridade: ao aceitar, uma única
 * operação do motor debita o preço congelado e insere exatamente o item mostrado.
 */
export function TradeOfferModal({ game, open, onClose }: { game: GameState; open: boolean; onClose: () => void }) {
  const offer = game.world.tradeOffer;
  const busy = useUiStore(s => s.gmBusy);
  const [quantityDraft, setQuantityDraft] = useState('1');
  useEffect(() => setQuantityDraft(String(offer?.item.quantity ?? 1)), [offer?.id, offer?.item.quantity]);
  if (!offer) return null;
  const canAdjustQuantity = ['ammo', 'consumable'].includes(offer.item.category) && !offer.haggle?.attempted;
  const quantity = canAdjustQuantity ? Math.max(1, Math.min(999, Number.parseInt(quantityDraft, 10) || 1)) : offer.item.quantity;
  const previewPrice = canAdjustQuantity ? Math.max(1, Math.round(offer.item.value ?? offer.price / offer.item.quantity)) * quantity : offer.price;
  const accept = () => void quickTool('settle_trade', { offerId: offer.id, ...(canAdjustQuantity ? { quantity } : {}) }, `Confirmo a compra de ${offer.item.name}.`);
  const decline = () => void quickTool('decline_trade', { offerId: offer.id }, `Recuso a oferta de ${offer.item.name}.`);
  const haggle = () => void quickTool('haggle_trade', { offerId: offer.id, ...(canAdjustQuantity ? { quantity } : {}) }, `Uso meus contatos para pechinchar ${offer.item.name}.`);
  const canHaggle = game.character.bio.role === 'fixer' && !offer.haggle?.attempted;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Negociação"
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button>
          <Button variant="ghost" tone="danger" disabled={busy} icon={<X className="w-4 h-4" />} onClick={decline}>Recusar</Button>
          {canHaggle && <Button variant="ghost" tone="cyan" disabled={busy} icon={<HandCoins className="w-4 h-4" />} onClick={haggle}>Pechinchar</Button>}
          <Button variant="solid" tone="yellow" disabled={busy || game.character.money < previewPrice} icon={<PackageCheck className="w-4 h-4" />} onClick={accept}>Confirmar por €${previewPrice}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="border border-neon-yellow/50 bg-neon-yellow/5 p-3">
          <p className="eyebrow text-neon-yellow">Oferta de {offer.seller}</p>
          <p className="mt-1 text-base text-fg">{quantity}× {offer.item.name}</p>
        </div>
        {canAdjustQuantity && (
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="trade-quantity" className="text-dim">Quantidade</label>
            <input id="trade-quantity" type="number" min={1} max={999} inputMode="numeric" value={quantityDraft} onChange={e => setQuantityDraft(e.target.value)} onBlur={() => setQuantityDraft(String(quantity))} className="cp-input w-20 py-1 text-center tabular" />
            <span className="text-[11px] text-dim">Total: €${previewPrice}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="border border-line-soft p-2"><span className="block text-[10px] uppercase tracking-wider text-dim">{canAdjustQuantity ? 'Preço por unidade' : 'Preço fechado'}</span><span className="tabular text-neon-yellow">€${canAdjustQuantity ? Math.max(1, Math.round(offer.item.value ?? offer.price / offer.item.quantity)) : offer.price}</span></div>
          <div className="border border-line-soft p-2"><span className="block text-[10px] uppercase tracking-wider text-dim">Seu saldo</span><span className="tabular text-neon-cyan">€${game.character.money}</span></div>
        </div>
        {offer.haggle && <p className={offer.haggle.success ? 'text-xs text-neon-green' : 'text-xs text-dim'}>{offer.haggle.success ? `Pechincha: −€$${offer.haggle.discount}.` : 'Pechincha recusada.'}</p>}
        {game.character.money < previewPrice && <p className="flex gap-2 text-xs text-danger"><HandCoins className="mt-0.5 h-4 w-4 shrink-0" /> Eddies insuficientes.</p>}
      </div>
    </Modal>
  );
}

/** Oferta pendente fica no fim da cena; o jogador abre os termos quando quiser. */
export function TradeOfferAction({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  const offer = game.world.tradeOffer;
  if (!offer) return null;
  return (
    <section className="border border-neon-yellow/50 bg-neon-yellow/5 p-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="eyebrow text-neon-yellow">Oferta pendente</p>
        <p className="mt-0.5 text-sm text-fg truncate">{offer.item.quantity}× {offer.item.name} · €${offer.price}</p>
      </div>
      <Button size="sm" variant="solid" tone="yellow" icon={<ShoppingBag className="w-3.5 h-3.5" />} onClick={() => setOpen(true)}>Abrir negociação</Button>
      <TradeOfferModal game={game} open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
