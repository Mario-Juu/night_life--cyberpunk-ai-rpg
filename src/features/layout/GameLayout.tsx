import { unreadNews } from '@shared/engine/fronts';
import { BookOpen, CarFront, MessageSquare, Radar, ScrollText, Swords, User, Users } from 'lucide-react';
import { NetPanel } from '../net/NetPanel';
import { ChasePanel } from '../chase/ChasePanel';
import { useTutorial } from '../tutorial/TutorialModal';
import { humanityBand } from '@shared/rules/humanity';
import type { GameState } from '@shared/types/game';
import { Drawer, Tabs, cn } from '../../ui';
import { useUiStore, type MobileTab, type SideTab } from '../../store/uiStore';
import { CharacterPanel } from '../character/CharacterPanel';
import { CombatPanel } from '../combat/CombatPanel';
import { JournalPanel } from '../journal/JournalPanel';
import { NarrativeFeed } from '../narrative/NarrativeFeed';
import { ActionInput } from '../narrative/ActionInput';
import { PhoneView } from '../phone/PhoneView';
import { TopBar } from './TopBar';
import { GameOverOverlay } from './GameOverOverlay';

function SidePanel({ game }: { game: GameState }) {
  const tab = useUiStore(s => s.sideTab);
  const setTab = useUiStore(s => s.setSideTab);
  const showNet = game.character.bio.role === 'netrunner' || !!game.net.architecture;
  const effective: SideTab = game.net.run ? 'net' : (game.combat.active || !!game.world.chase) && tab === 'contacts' ? 'combat' : tab === 'net' && !showNet ? 'journal' : tab;
  return (
    <div className="h-full flex flex-col min-h-0">
      <Tabs<SideTab>
        compact={showNet}
        value={effective}
        onChange={setTab}
        items={[
          { id: 'journal', label: 'Diário', icon: <BookOpen className="w-3.5 h-3.5" /> },
          { id: 'combat', label: game.world.chase ? 'Perseg.' : 'Combate', icon: game.world.chase ? <CarFront className="w-3.5 h-3.5 text-neon-yellow" /> : <Swords className={cn('w-3.5 h-3.5', game.combat.active && 'text-danger')} />, badge: game.world.chase ? game.world.chase.pressure : game.combat.active ? game.combat.combatants.filter(c => c.status === 'active' && c.side !== 'ally').length : undefined },
          ...(showNet ? [{ id: 'net' as const, label: 'Rede', icon: <Radar className={cn('w-3.5 h-3.5', game.net.run && 'text-neon-cyan')} />, badge: game.net.architecture && !game.net.run ? 1 : undefined }] : []),
          { id: 'contacts', label: 'Contatos', icon: <Users className="w-3.5 h-3.5" /> },
        ]}
      />
      {effective === 'contacts' ? (
        <div className="flex-1 min-h-0">
          <PhoneView game={game} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {effective === 'journal' ? <JournalPanel game={game} /> : effective === 'net' ? <NetPanel game={game} /> : game.world.chase ? <ChasePanel game={game} /> : <CombatPanel game={game} />}
        </div>
      )}
    </div>
  );
}

function StoryColumn({ game }: { game: GameState }) {
  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col">
      {game.combat.active && (
        <div className="shrink-0 flex items-center justify-center gap-2 py-1.5 bg-danger/10 border-b border-danger/40 text-danger font-display text-[10px] uppercase tracking-[0.3em] lg:hidden">
          <Swords className="w-3.5 h-3.5" /> Combate · rodada {game.combat.round}
        </div>
      )}
      {game.world.chase && (
        <div className="shrink-0 max-h-72 overflow-y-auto border-b border-neon-yellow/50 bg-surface-1/80 p-3">
          <ChasePanel game={game} />
        </div>
      )}
      <NarrativeFeed game={game} />
      <ActionInput game={game} />
    </main>
  );
}

const MOBILE_TABS: Array<{ id: MobileTab; label: string; icon: typeof User }> = [
  { id: 'story', label: 'Cena', icon: ScrollText },
  { id: 'sheet', label: 'Ficha', icon: User },
  { id: 'journal', label: 'Diário', icon: BookOpen },
  { id: 'phone', label: 'Agent', icon: MessageSquare },
];

export function GameLayout({ game }: { game: GameState }) {
  // Durante a narração de uma rolagem, os painéis mostram o estado de antes do dado:
  // o desfecho (PV, abates, morte) só aparece junto com a narração.
  const concealed = useUiStore(s => s.concealedGame);
  const view = concealed ?? game;
  const sheetOpen = useUiStore(s => s.sheetOpen);
  const sideOpen = useUiStore(s => s.sideOpen);
  const mobileTab = useUiStore(s => s.mobileTab);
  const setMobileTab = useUiStore(s => s.setMobileTab);
  const phoneOpen = useUiStore(s => s.phoneOpen);
  const closePhone = useUiStore(s => s.closePhone);
  const unread = game.phone.reduce((s, t) => s + t.unread, 0) + unreadNews(game);
  // Tutoriais de primeira vez (cada sistema se apresenta quando aparece). Esperam a narração terminar.
  const idle = !concealed;
  useTutorial('sandbox', idle && !!game.sandbox);
  useTutorial('combat', idle && game.combat.active);
  useTutorial('net', idle && !!game.net.architecture && game.character.bio.role === 'netrunner');
  useTutorial('humanity', idle && humanityBand(game.character).band !== 'stable');

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <TopBar game={view} />

      {/* Desktop: 3 colunas */}
      <div className="hidden lg:flex flex-1 min-h-0">
        {sheetOpen && (
          <aside className="w-80 xl:w-88 shrink-0 border-r border-line bg-surface-1/60 min-h-0" aria-label="Ficha do personagem">
            <CharacterPanel game={view} />
          </aside>
        )}
        <StoryColumn game={game} />
        {sideOpen && (
          <aside className="w-80 xl:w-96 shrink-0 border-l border-line bg-surface-1/60 min-h-0" aria-label="Painel lateral">
            <SidePanel game={view} />
          </aside>
        )}
      </div>

      {/* Mobile/tablet: uma vista por vez */}
      <div className="lg:hidden flex-1 min-h-0 flex flex-col">
        {mobileTab === 'story' && <StoryColumn game={game} />}
        {mobileTab === 'sheet' && (
          <div className="flex-1 min-h-0">
            <CharacterPanel game={view} />
          </div>
        )}
        {mobileTab === 'journal' && (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
            {view.net.architecture && <NetPanel game={view} />}
            {view.world.chase ? <ChasePanel game={view} /> : view.combat.active && <CombatPanel game={view} />}
            <JournalPanel game={view} />
          </div>
        )}
        {mobileTab === 'phone' && (
          <div className="flex-1 min-h-0">
            <PhoneView game={view} />
          </div>
        )}
      </div>

      <nav className="lg:hidden shrink-0 grid grid-cols-4 border-t border-line bg-surface-1 safe-bottom" aria-label="Navegação">
        {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
          const active = mobileTab === id;
          const badge = id === 'phone' ? unread : id === 'journal' && game.combat.active ? 1 : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMobileTab(id)}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex flex-col items-center justify-center gap-0.5 h-14 font-display text-[9px] uppercase tracking-wider', active ? 'text-neon-cyan' : 'text-muted')}
            >
              <Icon className={cn('w-5 h-5', id === 'journal' && game.combat.active && !active && 'text-danger')} />
              {label}
              {badge > 0 && <span className="absolute top-2 left-1/2 ml-2 w-2 h-2 rounded-full bg-neon-magenta" />}
              {active && <span className="absolute top-0 inset-x-4 h-0.5 bg-neon-cyan" />}
            </button>
          );
        })}
      </nav>

      {/* Só abre no desktop (openPhoneThread decide); no mobile o telefone é uma aba. */}
      <Drawer open={phoneOpen} onClose={closePhone} label="Telefone">
        <PhoneView game={view} onClose={closePhone} />
      </Drawer>

      <GameOverOverlay game={view} />
    </div>
  );
}
