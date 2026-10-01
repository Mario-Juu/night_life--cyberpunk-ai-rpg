import { useState, type ReactNode } from 'react';
import { Bug, Dices, HeartPulse, Radar, RotateCcw, Skull, Swords, UserCog } from 'lucide-react';
import type { ConditionKey, GameState, NetDifficulty, RoleId, StatKey } from '@shared/types/game';
import { STAT_KEYS } from '@shared/rules/stats';
import { ROLES } from '@shared/rules/creation';
import { NPC_TEMPLATES } from '@shared/rules/npcTemplates';
import { HUMANITY_BANDS, humanityBand } from '@shared/rules/humanity';
import { NET_DIFFICULTY_LABEL, PROGRAMS } from '@shared/rules/net';
import { DISTANCE_LABEL } from '@shared/rules/weapons';
import { ROLE_LABEL } from '@shared/rules/labels';
import { CONDITION_KEYS, CONDITION_LABEL, hasCondition } from '@shared/engine/conditions';
import { applySandboxRole, sbx } from '@shared/engine/sandbox';
import { humanityTransition } from '@shared/engine/humanity';
import { REGISTRY, executeTool } from '@shared/engine/tools';
import { seededRng, newSeed } from '@shared/engine/dice';
import { validateSave } from '../../services/saves';
import { Badge, Button, Input, Modal, Select, Textarea, cn } from '../../ui';
import { commit, requireGame } from '../../store/gameStore';
import { useUiStore } from '../../store/uiStore';
import { announceHumanity, startSandbox } from '../../store/turnController';
import { toast } from '../../ui/toastStore';

/** Aplica uma mudança do painel no estado ATUAL (sem limitadores) e registra no feed. */
function apply(fn: (s: GameState) => GameState, note?: string) {
  const before = requireGame();
  let next = fn(before);
  next = humanityTransition(before, next);
  if (note) next = sbx.note(next, note);
  commit(next);
  announceHumanity(before, next);
}

/** Executa uma ferramenta do motor como 'engine' (mesmas regras do jogo, sem o LLM). */
function tool(name: string, args: Record<string, unknown>, note: string) {
  const before = requireGame();
  const res = executeTool(REGISTRY, before, { tool: name, args }, { rng: seededRng(newSeed()), origin: 'engine' });
  if (!res.record.ok) {
    toast({ title: 'O motor recusou', body: res.record.summary, tone: 'warning' });
    return;
  }
  commit(sbx.note(res.state, `${note} — ${res.record.summary}`));
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2 border border-line-soft p-3">
      <p className="eyebrow flex items-center gap-1.5">
        {icon} {title}
      </p>
      {children}
    </section>
  );
}

function NumberField({ label, value, onCommit, min = 0, max = 999999 }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number }) {
  const [v, setV] = useState(String(value));
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="w-24 shrink-0">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={v}
        onChange={e => setV(e.target.value)}
        onBlur={() => Number(v) !== value && onCommit(Number(v))}
        onKeyDown={e => e.key === 'Enter' && onCommit(Number(v))}
        className="h-8 text-sm"
      />
    </label>
  );
}

export function SandboxModal({ game }: { game: GameState }) {
  const open = useUiStore(s => s.modal === 'sandbox');
  const forced = useUiStore(s => s.forcedD10);
  const close = () => useUiStore.getState().openModal(null);
  const c = game.character;
  const [tpl, setTpl] = useState('maelstrom_ganger');
  const [count, setCount] = useState(2);
  const [distance, setDistance] = useState('melee');
  const [difficulty, setDifficulty] = useState<NetDifficulty>('standard');
  const [json, setJson] = useState('');
  const band = humanityBand(c);

  if (!game.sandbox) return null;

  return (
    <Modal open={open} onClose={close} title="Sandbox · depuração" size="lg">
      <div className="space-y-3 text-sm" key={game.session.version}>
        <p className="text-xs text-muted">
          Tudo aqui altera o estado na hora, sem limites. Pelo texto também vale: "gera 3 gangers da Maelstrom", "cria uma rede avançada", "me amarra".
        </p>

        <Section title="Personagem" icon={<UserCog className="w-3.5 h-3.5" />}>
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <span className="w-24 shrink-0">Papel</span>
              <Select value={c.bio.role} onChange={e => apply(s => applySandboxRole(s, e.target.value as RoleId, s.character.roleRank), `Papel → ${ROLE_LABEL[e.target.value as RoleId]}`)}>
                {ROLES.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>
            <NumberField label="Rank do papel" value={c.roleRank} min={1} max={10} onCommit={v => apply(s => sbx.rank(s, v), `Rank → ${v}`)} />
            <NumberField label="PV" value={c.hp.current} onCommit={v => apply(s => sbx.hp(s, v), `PV → ${v}`)} />
            <NumberField label="PV máx." value={c.hp.max} onCommit={v => apply(s => sbx.hp(s, Math.min(s.character.hp.current, v), v), `PV máx. → ${v}`)} />
            <NumberField label="Humanidade" value={c.humanity.current} onCommit={v => apply(s => sbx.humanity(s, v), `Humanidade → ${v}`)} />
            <NumberField label="Eddies" value={c.money} onCommit={v => apply(s => sbx.money(s, v), `€$ → ${v}`)} />
            <NumberField label="PM" value={c.ip} onCommit={v => apply(s => sbx.ip(s, v), `PM → ${v}`)} />
            <NumberField label="Sorte" value={c.luck.current} onCommit={v => apply(s => sbx.luck(s, v), `Sorte → ${v}`)} />
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {STAT_KEYS.map(k => (
              <label key={k} className="text-center">
                <span className="font-display text-[9px] tracking-widest text-neon-cyan">{k}</span>
                <Input
                  type="number"
                  defaultValue={c.stats[k]}
                  min={1}
                  max={20}
                  onBlur={e => Number(e.target.value) !== c.stats[k] && apply(s => sbx.stat(s, k as StatKey, Number(e.target.value)), `${k} → ${e.target.value}`)}
                  className="h-8 text-sm text-center"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => apply(s => sbx.allSkills(s, 10), 'Todas as perícias → 10')}>
              Perícias 10
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply(s => sbx.allSkills(s, 0), 'Todas as perícias → 0')}>
              Perícias 0
            </Button>
            <Button size="sm" variant="ghost" tone="green" icon={<RotateCcw className="w-3 h-3" />} onClick={() => apply(sbx.revive, 'Personagem restaurado')}>
              Restaurar (vida, morte, ferimentos)
            </Button>
          </div>
        </Section>

        <Section title="Humanidade / ciberpsicose" icon={<HeartPulse className="w-3.5 h-3.5" />}>
          <p className="text-xs">
            Agora: <span className="tabular text-neon-cyan">{c.humanity.current}</span> — <Badge tone={band.band === 'stable' ? 'muted' : 'danger'}>{band.label}</Badge>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...HUMANITY_BANDS].map(b => {
              const target = b.band === 'cyberpsycho' ? 0 : b.band === 'stable' ? c.humanity.max : b.min + 2;
              return (
                <Button key={b.band} size="sm" variant="ghost" tone={b.band === 'cyberpsycho' ? 'danger' : 'purple'} onClick={() => apply(s => sbx.humanity(s, target), `Humanidade → ${target} (${b.label})`)}>
                  {b.label} ({target})
                </Button>
              );
            })}
          </div>
        </Section>

        <Section title="Condições e morte" icon={<Skull className="w-3.5 h-3.5" />}>
          <div className="flex flex-wrap gap-1.5">
            {CONDITION_KEYS.map(k => {
              const on = hasCondition(c.conditions, k as ConditionKey);
              return (
                <Button key={k} size="sm" variant={on ? 'solid' : 'ghost'} tone="yellow" onClick={() => apply(s => sbx.condition(s, k as ConditionKey, !on), `${CONDITION_LABEL[k as ConditionKey]} ${on ? 'removido' : 'aplicado (desde o turno anterior)'}`)}>
                  {CONDITION_LABEL[k as ConditionKey]}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" tone="danger" onClick={() => apply(s => sbx.lethalThreat(s, s.scene.lethalThreat ? null : 'Bomba em contagem regressiva no andar'), game.scene.lethalThreat ? 'Ameaça letal removida' : 'Ameaça letal armada (desde o turno anterior)')}>
              {game.scene.lethalThreat ? 'Desarmar ameaça letal' : 'Armar ameaça letal'}
            </Button>
            <Button size="sm" variant="ghost" tone="danger" onClick={() => tool('add_injury', {}, 'Ferimento crítico aleatório')}>
              Ferimento crítico
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply(sbx.clearInjuries, 'Ferimentos removidos')}>
              Limpar ferimentos
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply(sbx.clearEffects, 'Efeitos removidos')}>
              Limpar efeitos
            </Button>
          </div>
        </Section>

        <Section title="Combate (fichas prontas)" icon={<Swords className="w-3.5 h-3.5" />}>
          <div className="grid sm:grid-cols-[1fr_5rem_7rem] gap-2">
            <Select value={tpl} onChange={e => setTpl(e.target.value)} aria-label="Ficha">
              {Object.values(NPC_TEMPLATES).map(t => (
                <option key={t.key} value={t.key}>
                  {t.name} — PV {t.hp}, SP {t.sp.body}, {t.weapons[0].damage}
                </option>
              ))}
            </Select>
            <Input type="number" min={1} max={6} value={count} onChange={e => setCount(Number(e.target.value))} aria-label="Quantidade" className="h-9" />
            <Select value={distance} onChange={e => setDistance(e.target.value)} aria-label="Distância">
              {(['melee', '0-6m', '7-12m', '13-25m', '26-50m'] as const).map(d => (
                <option key={d} value={d}>
                  {DISTANCE_LABEL[d]}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[11px] text-dim">{NPC_TEMPLATES[tpl]?.description} · {NPC_TEMPLATES[tpl]?.gear}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="solid" tone="danger" onClick={() => tool('start_combat', { combatants: [{ name: NPC_TEMPLATES[tpl].name, template: tpl, count, distance }] }, 'Inimigos gerados')}>
              Gerar inimigos
            </Button>
            <Button
              size="sm"
              variant="solid"
              tone="green"
              disabled={!game.combat.active}
              title={game.combat.active ? 'Adiciona um combatente do seu lado à luta atual.' : 'Inicie um combate antes de adicionar um aliado.'}
              onClick={() => tool('start_combat', { combatants: [{ name: `Aliado: ${NPC_TEMPLATES[tpl].name}`, template: tpl, count: 1, distance, side: 'ally' }] }, 'Aliado adicionado ao combate')}
            >
              Adicionar 1 aliado
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply(sbx.endCombat, 'Combate limpo')}>
              Limpar combate
            </Button>
          </div>
        </Section>

        <Section title="Rede" icon={<Radar className="w-3.5 h-3.5" />}>
          <div className="flex flex-wrap gap-1.5 items-center">
            <Select value={difficulty} onChange={e => setDifficulty(e.target.value as NetDifficulty)} aria-label="Dificuldade" className="w-40">
              {(['basic', 'standard', 'uncommon', 'advanced'] as const).map(d => (
                <option key={d} value={d}>
                  {NET_DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="solid" tone="cyan" onClick={() => tool('net_architecture', { name: 'Servidor de testes', difficulty, files: 'Arquivo alvo', controls: 'Torretas do corredor' }, 'Arquitetura criada')}>
              Criar arquitetura
            </Button>
            <Button size="sm" variant="ghost" disabled={!game.net.run} onClick={() => apply(sbx.refillNetActions, 'Ações de Rede recarregadas')}>
              Recarregar ações
            </Button>
            <Button size="sm" variant="ghost" onClick={() => apply(sbx.clearNet, 'Rede limpa')}>
              Limpar rede
            </Button>
          </div>
          {c.bio.role === 'netrunner' && (
            <div className="flex flex-wrap gap-1">
              {Object.values(PROGRAMS).map(p => (
                <button key={p.key} type="button" className="border border-line px-1.5 py-0.5 text-[10px] text-muted hover:text-neon-cyan" onClick={() => apply(s => sbx.giveProgram(s, p.key), `Programa ${p.name}`)}>
                  +{p.name}
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Dados" icon={<Dices className="w-3.5 h-3.5" />}>
          <p className="text-xs text-muted">Força o PRÓXIMO d10 (ataque, teste ou Rede). 10 = crítico, 1 = falha crítica.</p>
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => useUiStore.getState().setForcedD10(forced === n ? null : n)}
                className={cn('w-8 h-8 border tabular text-sm', forced === n ? 'border-neon-yellow bg-neon-yellow/15 text-neon-yellow' : 'border-line text-muted hover:text-fg')}
              >
                {n}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Estado bruto (JSON)" icon={<Bug className="w-3.5 h-3.5" />}>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setJson(JSON.stringify(requireGame(), null, 2))}>
              Carregar estado
            </Button>
            <Button
              size="sm"
              variant="ghost"
              tone="yellow"
              disabled={!json}
              onClick={() => {
                try {
                  const parsed = validateSave(JSON.parse(json));
                  commit({ ...parsed, sandbox: true });
                  toast({ title: 'Estado aplicado', tone: 'success' });
                } catch (err) {
                  toast({ title: 'JSON inválido', body: (err as Error).message, tone: 'warning' });
                }
              }}
            >
              Aplicar JSON
            </Button>
            <Button size="sm" variant="ghost" tone="danger" onClick={() => window.confirm('Recriar o Sandbox do zero?') && startSandbox(c.bio.role)}>
              Recriar sandbox
            </Button>
          </div>
          {json && <Textarea rows={10} value={json} onChange={e => setJson(e.target.value)} className="font-mono text-[11px]" />}
        </Section>
      </div>
    </Modal>
  );
}
