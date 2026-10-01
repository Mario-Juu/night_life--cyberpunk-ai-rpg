import { useMemo, useState } from 'react';
import { Cpu, Search, Zap } from 'lucide-react';
import type { CyberwareCategory, CyberwareItem, GameState } from '@shared/types/game';
import { effectiveEmp } from '@shared/rules/stats';
import { humanityBand } from '@shared/rules/humanity';
import { CYBERWARE, FOUNDATION_LABEL, GRADE_LABEL, INSTALL_LABEL, RIPPERDOC_TIER_LABEL, TIER_LABEL, averageLoss, maxHumanityPenalty, type CyberTier, type CyberwareDef } from '@shared/rules/cyberware';
import { SKILLS } from '@shared/rules/skills';
import { activeOs, cyberAccess, foundations, installedOs, osCooldownName, sceneRipperdoc } from '@shared/engine/cyberware';
import { Badge, Button, Empty, Input, Meter, Modal, Select, cn } from '../../ui';
import { quickTool } from '../../store/turnController';
import { useUiStore } from '../../store/uiStore';
import { useTutorial } from '../tutorial/TutorialModal';

/** Cores de raridade (como em 2077): cinza, verde, azul, roxo, laranja. */
const TIER_CLASS: Record<CyberTier, string> = {
  1: 'border-line text-muted',
  2: 'border-neon-green/60 text-neon-green',
  3: 'border-neon-cyan/60 text-neon-cyan',
  4: 'border-neon-purple/70 text-neon-purple',
  5: 'border-neon-yellow/70 text-neon-yellow',
};

function TierTag({ def }: { def: CyberwareDef }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={cn('border px-1 py-px text-[9px] font-display uppercase tracking-wider', TIER_CLASS[def.tier])}>
        T{def.tier} {TIER_LABEL[def.tier]}
      </span>
      {def.grade !== 'civil' && (
        <span className={cn('border px-1 py-px text-[9px] font-display uppercase tracking-wider', def.grade === 'military' ? 'border-danger/60 text-danger' : 'border-neon-magenta/60 text-neon-magenta')}>
          {GRADE_LABEL[def.grade]}
        </span>
      )}
      {def.brand && <span className="text-[10px] text-dim">{def.brand}</span>}
    </span>
  );
}

const CATEGORIES: Array<CyberwareCategory | 'Todos'> = ['Todos', 'Neuralware', 'Ciberóptico', 'Ciberáudio', 'Implante Interno', 'Implante Dérmico', 'Membro Cibernético', 'Borgware', 'Estético'];

/** Por que (ainda) não dá para instalar — só uma dica; o motor revalida tudo. */
function blocker(game: GameState, def: CyberwareDef): string | null {
  const c = game.character;
  if (def.requires) {
    const f = foundations(c).filter(x => x.kind === def.requires);
    if (!f.length) return `Precisa de ${FOUNDATION_LABEL[def.requires]}`;
    const free = f.filter(x => x.capacity - x.used >= (def.slots ?? 1)).length;
    if (free < (def.paired ? 2 : 1)) return def.paired ? `Precisa de 2 ${FOUNDATION_LABEL[def.requires]} com slot livre` : 'Sem slot livre';
  }
  if (def.foundation && c.cyberware.filter(x => x.key && CYBERWARE[x.key]?.foundation?.kind === def.foundation!.kind).length >= def.foundation.max) return 'Já no máximo';
  if (def.os && installedOs(c)) return 'Só um sistema operacional';
  if (def.speedware && c.cyberware.some(x => x.key && CYBERWARE[x.key]?.speedware)) return 'Só uma speedware';
  const access = cyberAccess(game, def);
  if (!access.ok) return access.error;
  if (c.money < access.price) return 'Eddies insuficientes';
  return null;
}

function Installed({ game, cw, depth = 0 }: { game: GameState; cw: CyberwareItem; depth?: number }) {
  const busy = useUiStore(s => s.gmBusy);
  const c = game.character;
  const children = c.cyberware.filter(x => x.parentId === cw.id);
  const slot = foundations(c).find(f => f.item.id === cw.id);
  const def = cw.key ? CYBERWARE[cw.key] : undefined;
  const isOs = !!def?.os;
  const on = isOs && !!activeOs(game);
  const cooling = isOs && game.activeEffects.some(e => e.name === osCooldownName(def!));
  return (
    <li className={cn('border border-neon-purple/30 bg-neon-purple/5 p-2.5 space-y-1', depth > 0 && 'ml-3 border-l-2')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg">
          {cw.name}
          {cw.skillId && <span className="text-dim"> · {SKILLS.find(s => s.id === cw.skillId)?.label}</span>}
        </p>
        <Badge tone="purple">−{cw.humanityLoss} HUM</Badge>
      </div>
      {def && <TierTag def={def} />}
      {slot && <p className="tabular text-[10px] text-neon-cyan">Slots {slot.used}/{slot.capacity}</p>}
      <p className="text-[11px] text-muted">{def?.effect ?? cw.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {isOs && (
          <Button size="sm" variant="ghost" tone="yellow" icon={<Zap className="w-3 h-3" />} disabled={busy || on || cooling} onClick={() => void quickTool('activate_cyberware', { key: cw.key }, `Ativo o ${def!.name}.`)}>
            {on ? 'Ativo' : cooling ? 'Recarregando' : 'Ativar'}
          </Button>
        )}
        {!children.length && (
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            disabled={busy || game.combat.active}
            onClick={() => window.confirm(`Remover ${cw.name} numa clínica? A Humanidade máxima volta; a perdida, só com terapia.`) && void quickTool('remove_cyberware', { cyberwareId: cw.id }, `Vou a um ripperdoc remover ${cw.name}.`)}
          >
            Remover
          </Button>
        )}
      </div>
      {children.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {children.map(ch => (
            <Installed key={ch.id} game={game} cw={ch} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function RipperdocCatalog({ game }: { game: GameState }) {
  const busy = useUiStore(s => s.gmBusy);
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('Todos');
  const [q, setQ] = useState('');
  const [chipSkill, setChipSkill] = useState('handgun');
  const [tier, setTier] = useState<CyberTier | 0>(0);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const doc = sceneRipperdoc(game);
  const list = useMemo(() => {
    const n = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return Object.values(CYBERWARE)
      .filter(
        d =>
          (cat === 'Todos' || d.category === cat) &&
          (!tier || d.tier === tier) &&
          (!n || `${d.name} ${d.brand ?? ''} ${d.effect}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(n)) &&
          (!onlyAvailable || cyberAccess(game, d).ok),
      )
      .sort((a, b) => a.tier - b.tier);
  }, [cat, q, tier, onlyAvailable, game]);

  return (
    <section className="space-y-3">
      <p className="eyebrow">Ripperdoc · catálogo ({Object.keys(CYBERWARE).length})</p>
      <div className={cn('border p-3 text-[11px]', doc ? 'border-neon-cyan/40 bg-neon-cyan/5 text-muted' : 'border-line bg-surface-0/30 text-dim')}>
        {doc ? (
          <>
            <span className="text-fg">{doc.name}</span> · nível {doc.ripperdoc!.tier} ({RIPPERDOC_TIER_LABEL[doc.ripperdoc!.tier]}){doc.ripperdoc!.blackMarket ? ' · mercado negro' : ''}
          </>
        ) : (
          'Nenhum ripperdoc na cena: só bio-mods básicos (T1 de shopping). Vá até uma clínica para o resto.'
        )}
      </div>
      <div className="flex flex-wrap gap-1 rounded border border-line-soft bg-surface-0/30 p-2">
        {([0, 1, 2, 3, 4, 5] as const).map(t => (
          <button key={t} type="button" onClick={() => setTier(t)} className={cn('border px-1.5 py-0.5 text-[10px]', tier === t ? 'border-neon-cyan text-neon-cyan' : 'border-line text-muted hover:text-fg')}>
            {t ? `T${t}` : 'Todo tier'}
          </button>
        ))}
        <label className="flex items-center gap-1 text-[10px] text-muted ml-auto">
          <input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} className="accent-[var(--color-neon-cyan)]" />
          Só o que dá para instalar aqui
        </label>
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: olho, lâmina, iniciativa…" className="h-8 pl-7 text-sm" aria-label="Buscar implante" />
      </div>
      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map(k => (
          <button key={k} type="button" onClick={() => setCat(k)} className={cn('border px-1.5 py-0.5 text-[10px]', cat === k ? 'border-neon-cyan text-neon-cyan' : 'border-line text-muted hover:text-fg')}>
            {k}
          </button>
        ))}
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {list.map(d => {
          const why = blocker(game, d);
          const access = cyberAccess(game, d);
          const price = access.ok ? access.price : d.price * (d.paired ? 2 : 1);
          return (
            <li key={d.key} className="border border-line bg-surface-0/20 p-3 space-y-2 transition-colors hover:border-neon-purple/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{d.name}</p>
                  <TierTag def={d} />
                  <p className="tabular text-[10px] text-dim">
                    {d.category} · {INSTALL_LABEL[d.install]}
                    {d.requires ? ` · em ${FOUNDATION_LABEL[d.requires]} (${d.slots ?? 1} slot${(d.slots ?? 1) > 1 ? 's' : ''})` : ''}
                    {d.foundation ? ` · fundação, ${d.foundation.slots} slots` : ''}
                    {d.paired ? ' · par' : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="tabular text-sm text-neon-yellow">€${price}</p>
                  <p className="tabular text-[10px] text-neon-purple">
                    HUM −{d.hl === '0' ? 0 : `${d.hl}${d.paired ? '×2' : ''}`} {d.hl !== '0' && <span className="text-dim">(~{averageLoss(d.hl) * (d.paired ? 2 : 1)}, máx −{maxHumanityPenalty(d) * (d.paired ? 2 : 1)})</span>}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted">{d.effect}</p>
              {d.effects.some(e => e.kind === 'skill_chip') && (
                <Select value={chipSkill} onChange={e => setChipSkill(e.target.value)} aria-label="Perícia do chip" className="h-8 text-xs">
                  {SKILLS.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-neon-yellow">{why}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  tone="purple"
                  disabled={busy || !!why || game.combat.active}
                  onClick={() =>
                    void quickTool('install_cyberware', { key: d.key, ...(d.effects.some(e => e.kind === 'skill_chip') ? { skillId: chipSkill } : {}) }, doc ? `Peço para ${doc.name} instalar ${d.name}.` : `Instalo ${d.name}.`)
                  }
                >
                  Instalar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RipperdocCatalogModal({ game, open, onClose }: { game: GameState; open: boolean; onClose: () => void }) {
  const doc = sceneRipperdoc(game);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Catálogo do ripperdoc"
      subtitle={doc ? `${doc.name} · nível ${doc.ripperdoc!.tier} · ${RIPPERDOC_TIER_LABEL[doc.ripperdoc!.tier]}` : 'Terminal remoto: implantes básicos ficam disponíveis sem uma clínica na cena.'}
    >
      <RipperdocCatalog game={game} />
    </Modal>
  );
}

export function CyberTab({ game }: { game: GameState }) {
  useTutorial('cyber', true);
  const c = game.character;
  const emp = Math.min(c.stats.EMP, effectiveEmp(c.humanity.current));
  const band = humanityBand(c);
  const [ripperdocOpen, setRipperdocOpen] = useState(false);
  const shop = ripperdocOpen;
  const roots = c.cyberware.filter(cw => !cw.parentId || !c.cyberware.some(p => p.id === cw.parentId));
  const loose = c.inventory.filter(i => i.cyberKey);
  const busy = useUiStore(s => s.gmBusy);
  return (
    <div className="space-y-4">
      <Meter label="Humanidade" value={c.humanity.current} max={c.humanity.max} tone={band.band === 'stable' ? 'purple' : 'danger'} />
      {band.band !== 'stable' && (
        <Badge tone="danger" solid={band.band === 'cyberpsycho'}>
          {band.label}
        </Badge>
      )}
      <p className="text-xs text-muted">
        EMP efetivo: <span className="tabular text-fg">{emp}</span> de {c.stats.EMP}. Cada 10 pontos de Humanidade perdidos reduzem a Empatia. Em 0, ciberpsicose. Cada implante
        baixa o máximo em 2 (Borgware 4); terapia recupera a perdida (€$500 = 2d6 · €$1000 = 4d6).
      </p>
      {roots.length === 0 ? (
        <Empty icon={<Cpu className="w-8 h-8" />} title="Carne e osso">
          Nenhum implante instalado. Veja o catálogo do ripperdoc abaixo.
        </Empty>
      ) : (
        <ul className="space-y-1.5">
          {roots.map(cw => (
            <Installed key={cw.id} game={game} cw={cw} />
          ))}
        </ul>
      )}
      {loose.length > 0 && (
        <section className="space-y-1.5">
          <p className="eyebrow">Peças soltas (só a cirurgia)</p>
          {loose.map(i => {
            const def = CYBERWARE[i.cyberKey!];
            if (!def) return null;
            const access = cyberAccess(game, def);
            return (
              <div key={i.id} className="border border-neon-yellow/40 p-2 space-y-1">
                <p className="text-sm text-fg">{def.name}</p>
                <TierTag def={def} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-neon-yellow">{access.ok ? `Cirurgia €$${access.price}` : access.error}</span>
                  <Button size="sm" variant="ghost" tone="purple" disabled={busy || !access.ok || game.combat.active} onClick={() => void quickTool('install_cyberware', { key: def.key }, `Peço para instalarem a peça de ${def.name} que eu tenho.`)}>
                    Instalar
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}
      <Button size="sm" variant={shop ? 'solid' : 'ghost'} tone="purple" block onClick={() => setRipperdocOpen(s => !s)} icon={<Cpu className="w-3.5 h-3.5" />}>
        {shop ? 'Fechar catálogo' : 'Catálogo do ripperdoc'}
      </Button>
      <RipperdocCatalogModal game={game} open={ripperdocOpen} onClose={() => setRipperdocOpen(false)} />
    </div>
  );
}
