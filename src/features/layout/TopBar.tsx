import { useEffect, useRef, useState } from 'react';
import { BookOpen, Bug, CloudRain, History, Menu, MessageSquare, PanelLeft, PanelRight, Save, Settings, Siren, Swords } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { formatGameTime } from '@shared/rules/world';
import { THREAT_LABEL, computeThreat } from '@shared/engine/world';
import { Badge, IconButton, cn } from '../../ui';
import { useUiStore, type ModalId } from '../../store/uiStore';
import { openPhoneThread } from '../../store/turnController';
import { RadioControl } from '../radio/RadioControl';

function MenuButton({ sandbox }: { sandbox?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const openModal = useUiStore(s => s.openModal);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: Array<{ id: ModalId; label: string; icon: React.ReactNode }> = [
    { id: 'saves', label: 'Salvar / Carregar', icon: <Save className="w-4 h-4" /> },
    { id: 'log', label: 'Registro e linha do tempo', icon: <History className="w-4 h-4" /> },
    { id: 'rules', label: 'Regras', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'settings', label: 'Configurações', icon: <Settings className="w-4 h-4" /> },
    ...(sandbox ? [{ id: 'sandbox' as const, label: 'Sandbox (depuração)', icon: <Bug className="w-4 h-4" /> }] : []),
  ];

  return (
    <div ref={ref} className="relative">
      <IconButton label="Menu" icon={<Menu className="w-4 h-4" />} onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu" />
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-56 bg-surface-2 border border-line shadow-2xl py-1 animate-fade-in z-30">
          {items.map(item => (
            <button
              key={item.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                openModal(item.id);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-fg hover:bg-neon-cyan/10 hover:text-neon-cyan text-left"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ game }: { game: GameState }) {
  const t = formatGameTime(game.world.time);
  const unread = game.phone.reduce((s, th) => s + th.unread, 0);
  const toggleSheet = useUiStore(s => s.toggleSheet);
  const sheetOpen = useUiStore(s => s.sheetOpen);
  const sideOpen = useUiStore(s => s.sideOpen);
  const toggleSide = useUiStore(s => s.toggleSide);
  const model = useUiStore(s => s.model);
  const degraded = useUiStore(s => s.lastDegraded);
  const loc = game.world.location;
  const threat = computeThreat(game);

  return (
    <header className="shrink-0 h-14 flex items-center gap-2 px-2 sm:px-3 border-b border-line bg-surface-1 relative z-10">
      <IconButton label={sheetOpen ? 'Recolher ficha' : 'Mostrar ficha'} icon={<PanelLeft className="w-4 h-4" />} onClick={toggleSheet} aria-pressed={sheetOpen} className="hidden lg:inline-flex" />

      <div className="hidden sm:block font-display font-black tracking-widest text-sm text-neon-cyan shrink-0">
        N<span className="text-neon-magenta">//</span>L
      </div>

      <div className="flex-1 min-w-0 px-1 sm:px-2">
        <p className="font-display text-[11px] sm:text-xs uppercase tracking-wider text-fg truncate">
          {loc.district}
          <span className="text-dim"> › </span>
          {loc.subDistrict}
          <span className="hidden md:inline">
            <span className="text-dim"> › </span>
            {loc.spot}
          </span>
        </p>
        <p className="tabular text-[10px] text-muted truncate flex items-center gap-1.5">
          <span className="text-neon-cyan">T{game.turn}</span>
          <span className="text-neon-yellow">{t.time}</span> {t.weekday}, {t.date}
          <span className="hidden sm:inline-flex items-center gap-1">
            <CloudRain className="w-3 h-3" /> {game.world.weather}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {game.combat.active ? (
          <button
            type="button"
            onClick={() => useUiStore.setState({ sideOpen: true, sideTab: 'combat', mobileTab: 'journal' })}
            className="hidden sm:inline-flex"
            title="Abrir painel de combate"
          >
            <Badge tone="danger" solid>
              <Swords className="w-3 h-3" /> Combate
            </Badge>
          </button>
        ) : (
          threat !== 'low' && (
            <Badge tone={threat === 'medium' ? 'yellow' : 'danger'} className="hidden sm:inline-flex" title="Nível de ameaça da cena">
              Ameaça: {THREAT_LABEL[threat]}
            </Badge>
          )
        )}
        {game.world.heat > 0 && (
          <Badge tone={game.world.heat >= 3 ? 'danger' : 'yellow'} title="Calor policial">
            <Siren className="w-3 h-3" /> {game.world.heat}
          </Badge>
        )}
        <Badge tone={degraded ? 'yellow' : 'muted'} className="hidden md:inline-flex" title={degraded ? 'A última resposta do Mestre foi de contingência' : 'Modelo do Mestre'}>
          Mestre {model}
          {degraded && ' ⚠'}
        </Badge>
        <div className="hidden md:flex border-l border-line pl-1.5 ml-0.5">
          <RadioControl />
        </div>
        <IconButton
          label="Abrir telefone"
          icon={<MessageSquare className="w-4 h-4" />}
          badge={unread}
          onClick={() => openPhoneThread(useUiStore.getState().activeThread)}
          className={cn('hidden lg:inline-flex', unread > 0 && 'animate-pulse-soft')}
        />
        <IconButton
          label={sideOpen ? 'Recolher painel lateral' : 'Mostrar painel lateral'}
          icon={<PanelRight className="w-4 h-4" />}
          onClick={toggleSide}
          aria-pressed={sideOpen}
          className="hidden lg:inline-flex"
        />
        <MenuButton sandbox={game.sandbox} />
      </div>
    </header>
  );
}
