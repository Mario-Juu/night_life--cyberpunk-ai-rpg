import { useState } from 'react';
import { Activity, Backpack, Cpu, User } from 'lucide-react';
import type { GameState } from '@shared/types/game';
import { getRole } from '@shared/rules/creation';
import { Tabs } from '../../ui';
import { StatusTab } from './StatusTab';
import { SkillsTab } from './SkillsTab';
import { GearTab } from './GearTab';
import { CyberTab } from './CyberTab';

type Tab = 'status' | 'skills' | 'gear' | 'cyber';

export function CharacterPanel({ game }: { game: GameState }) {
  const [tab, setTab] = useState<Tab>('status');
  const c = game.character;
  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="px-4 pt-4 pb-3 border-b border-line-soft">
        <p className="eyebrow">{getRole(c.bio.role).label} · {c.bio.age} anos</p>
        <h2 className="font-display text-lg uppercase tracking-wider text-neon-yellow truncate">{c.bio.handle}</h2>
        <p className="text-xs text-muted truncate">{c.bio.name} · {c.bio.occupation}</p>
      </header>
      <Tabs<Tab>
        size="sm"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'status', label: 'Status', icon: <Activity className="w-3.5 h-3.5" /> },
          { id: 'skills', label: 'Perícias', icon: <User className="w-3.5 h-3.5" />, badge: c.ip >= 20 ? 1 : undefined },
          { id: 'gear', label: 'Equip.', icon: <Backpack className="w-3.5 h-3.5" /> },
          { id: 'cyber', label: 'Cromo', icon: <Cpu className="w-3.5 h-3.5" /> },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'status' && <StatusTab game={game} />}
        {tab === 'skills' && <SkillsTab game={game} />}
        {tab === 'gear' && <GearTab game={game} />}
        {tab === 'cyber' && <CyberTab game={game} />}
      </div>
    </div>
  );
}
