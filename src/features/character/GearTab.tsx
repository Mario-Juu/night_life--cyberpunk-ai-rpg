import { Crosshair, Package, RotateCw, Shield, Syringe, Trash2 } from 'lucide-react';
import type { GameState, InventoryItem } from '@shared/types/game';
import { AMMO_LABEL, WEAPONS } from '@shared/rules/weapons';
import { Badge, Button, Empty, cn } from '../../ui';
import { dispatch } from '../../store/gameStore';
import { consumeItem, reload } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';

function ammoInStock(items: InventoryItem[], kind: InventoryItem['ammoKind']): number {
  return items.filter(i => i.category === 'ammo' && i.ammoKind === kind).reduce((s, i) => s + i.quantity, 0);
}

function ItemRow({ item, game }: { item: InventoryItem; game: GameState }) {
  const busy = useUiStore(s => s.gmBusy);
  const inv = game.character.inventory;
  const w = item.weapon;
  const profile = w ? WEAPONS[w.weaponClass] : null;
  const stock = w?.ammo ? ammoInStock(inv, w.ammo) : 0;
  const canReload = !!w && w.magSize !== null && w.loaded < w.magSize && stock > 0;

  return (
    <li className={cn('border bg-surface-0/40 p-2.5 space-y-2', item.equipped ? 'border-neon-cyan/40' : 'border-line-soft')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-fg leading-snug">
            {item.name}
            {item.quantity > 1 && <span className="tabular text-muted"> ×{item.quantity}</span>}
          </p>
          {item.description && <p className="text-[11px] text-muted line-clamp-2">{item.description}</p>}
        </div>
        {item.equipped && <Badge tone="cyan">Equipado</Badge>}
      </div>

      {w && profile && (
        <div className="flex flex-wrap items-center gap-1.5 tabular text-[11px]">
          <Badge tone="magenta">{w.damage}</Badge>
          <Badge tone="muted">{profile.label}</Badge>
          {w.magSize !== null ? (
            <Badge tone={w.loaded === 0 ? 'danger' : 'muted'}>
              Pente {w.loaded}/{w.magSize}
            </Badge>
          ) : profile.thrown ? (
            <Badge tone="yellow">Arremesso · área · ×{item.quantity}</Badge>
          ) : profile.halfArmor ? (
            <Badge tone="muted">Ignora ½ SP</Badge>
          ) : null}
          {profile.rof === 2 && <Badge tone="muted">Cad. 2</Badge>}
          {profile.autofire && <Badge tone="muted">Rajada ×{profile.autofire.mult}</Badge>}
          {w.quality === 'poor' && <Badge tone="muted">Ruim (trava num 1)</Badge>}
          {w.quality === 'excellent' && <Badge tone="purple">Excelente +1</Badge>}
          {w.jammed && <Badge tone="danger">TRAVADA</Badge>}
          {w.nonLethal === 'stun' && <Badge tone="cyan">Choque (não letal)</Badge>}
          {w.nonLethal === 'rubber' && <Badge tone="cyan">Borracha (não letal)</Badge>}
          {w.ammo && <span className="text-dim">Reserva: {stock}</span>}
        </div>
      )}
      {item.armor && (
        <p className="tabular text-[11px] text-muted">
          {item.armor.slot === 'head' ? 'Cabeça' : 'Corpo'} · SP {item.armor.sp}/{item.armor.maxSp}
          {item.armor.sp < item.armor.maxSp && <span className="text-neon-yellow"> (danificada)</span>}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {item.implant && <span className="text-[10px] font-display uppercase tracking-wider text-neon-purple border border-neon-purple/40 px-1.5 py-0.5">Implante</span>}
        {(w || item.armor) && !(item.implant && item.armor) && (
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'equip', itemId: item.id, equipped: !item.equipped })} icon={item.armor ? <Shield className="w-3 h-3" /> : <Crosshair className="w-3 h-3" />}>
            {item.equipped ? 'Desequipar' : 'Equipar'}
          </Button>
        )}
        {w && w.magSize !== null && (
          <Button size="sm" variant="ghost" tone="yellow" disabled={!canReload || busy} onClick={() => reload(item.id)} icon={<RotateCw className="w-3 h-3" />} title={stock === 0 ? 'Sem munição compatível' : undefined}>
            Recarregar
          </Button>
        )}
        {item.category === 'consumable' && (item.heal || item.drug || item.streetDrug) ? (
          <Button size="sm" variant="ghost" tone={item.streetDrug ? 'purple' : 'green'} disabled={(!item.drug && !item.streetDrug && game.character.hp.current >= game.character.hp.max) || busy} onClick={() => consumeItem(item.id)} icon={<Syringe className="w-3 h-3" />}>
            Usar
          </Button>
        ) : null}
        {!item.equipped && !item.implant && (
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            onClick={() => {
              if (window.confirm(`Descartar ${item.name}?`)) dispatch({ type: 'dropItem', itemId: item.id });
            }}
            icon={<Trash2 className="w-3 h-3" />}
            aria-label={`Descartar ${item.name}`}
          />
        )}
      </div>
    </li>
  );
}

const GROUPS: Array<{ title: string; filter: (i: InventoryItem) => boolean }> = [
  { title: 'Armas', filter: i => i.category === 'weapon' },
  { title: 'Armadura', filter: i => i.category === 'armor' },
  { title: 'Munição', filter: i => i.category === 'ammo' },
  { title: 'Consumíveis', filter: i => i.category === 'consumable' },
  { title: 'Equipamento e dados', filter: i => i.category === 'gear' || i.category === 'datashard' },
];

export function GearTab({ game }: { game: GameState }) {
  const inv = game.character.inventory;
  if (!inv.length) return <Empty icon={<Package className="w-8 h-8" />} title="Bolsos vazios" />;
  return (
    <div className="space-y-5">
      {GROUPS.map(g => {
        const items = inv.filter(g.filter);
        if (!items.length) return null;
        return (
          <section key={g.title} className="space-y-1.5">
            <p className="eyebrow">{g.title}</p>
            {g.title === 'Munição' ? (
              <ul className="space-y-1">
                {items.map(i => (
                  <li key={i.id} className="flex items-center justify-between text-sm border-b border-line-soft py-1">
                    <span className="text-fg">{i.ammoKind ? AMMO_LABEL[i.ammoKind] : i.name}</span>
                    <span className="tabular text-muted">×{i.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="space-y-1.5">
                {items.map(i => (
                  <ItemRow key={i.id} item={i} game={game} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
