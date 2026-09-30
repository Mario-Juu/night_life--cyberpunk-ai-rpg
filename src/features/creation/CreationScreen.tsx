import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Zap } from 'lucide-react';
import type { RoleId, StatKey, Stats } from '@shared/types/game';
import {
  POINT_BUDGET,
  ROLES,
  STARTER_WEAPONS,
  STAT_MAX,
  STAT_MIN,
  STAT_PRESETS,
  STARTING_MONEY,
  adjustStat,
  buildCharacter,
  buildStartingSkills,
  statTotal,
  validateStats,
} from '@shared/rules/creation';
import { STAT_INFO, STAT_KEYS, computeMaxHp, computeMaxHumanity } from '@shared/rules/stats';
import { DISTRICTS } from '@shared/rules/world';
import { SKILLS } from '@shared/rules/skills';
import { WEAPONS } from '@shared/rules/weapons';
import { Badge, Button, Card, Field, Input, Stepper, Textarea, cn } from '../../ui';
import { sound } from '../../services/audio';
import { startCampaign, startSandbox } from '../../store/turnController';
import { fetchStatus } from '../../services/api';
import { useUiStore } from '../../store/uiStore';

const STEPS = ['Identidade', 'Origem', 'Atributos', 'Equipamento'];

export function CreationScreen() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [age, setAge] = useState(21);
  const [occupation, setOccupation] = useState('Entregador de encomendas noturnas');
  const [appearance, setAppearance] = useState('');
  const [district, setDistrict] = useState('WATSON');
  const [role, setRole] = useState<RoleId>('solo');
  const [familyTie, setFamilyTie] = useState('Minha mãe, exausta de turnos dobrados na fábrica da Petrochem');
  const [debtReason, setDebtReason] = useState('€$2.400 de aluguel atrasado e o convênio médico da família');
  const [personalAnchor, setPersonalAnchor] = useState('Tirar minha família deste cubículo antes que Night City nos engula');
  const [preset, setPreset] = useState<string | null>('balanced');
  const [stats, setStats] = useState<Stats>({ ...STAT_PRESETS[0].stats });
  const [weaponId, setWeaponId] = useState(STARTER_WEAPONS[0].id);
  const [starting, setStarting] = useState(false);
  const model = useUiStore(s => s.model);
  const hasKey = useUiStore(s => s.hasKey);
  const [keyDraft, setKeyDraft] = useState('');

  const total = statTotal(stats);
  const remaining = POINT_BUDGET - total;
  const statsError = validateStats(stats);
  const skills = useMemo(() => buildStartingSkills(role), [role]);
  const topSkills = SKILLS.filter(s => (skills[s.id] ?? 0) > 2).sort((a, b) => (skills[b.id] ?? 0) - (skills[a.id] ?? 0));

  const canNext = step === 0 ? handle.trim().length > 0 : step === 2 ? !statsError : true;

  const changeStat = (k: StatKey, delta: number) => {
    sound.playClick();
    setPreset(null);
    setStats(prev => adjustStat(prev, k, delta));
  };

  const finish = async () => {
    setStarting(true);
    sound.playCrit();
    const character = buildCharacter({ name, handle, age, role, occupation, district, familyTie, debtReason, personalAnchor, appearance, stats, starterWeaponId: weaponId });
    await startCampaign(character);
  };

  const next = () => {
    sound.playClick();
    if (step < STEPS.length - 1) setStep(step + 1);
    else void finish();
  };

  return (
    <div className="h-dvh overflow-y-auto scanlines">
      <div className="min-h-full flex items-start sm:items-center justify-center px-3 py-6 sm:p-8">
        <div className="w-full max-w-3xl space-y-5">
          <header className="text-center space-y-1">
            <p className="eyebrow">
              Registro de ingresso · Night City · 2077 ·{' '}
              <button type="button" className="underline-offset-2 hover:underline hover:text-neon-cyan" onClick={() => useUiStore.getState().setIntroSeen(false)}>
                rever introdução
              </button>{' '}
              ·{' '}
              <button type="button" className="underline-offset-2 hover:underline hover:text-neon-yellow" onClick={() => startSandbox(role)} title="Personagem de testes com tudo no máximo e painel de depuração">
                modo sandbox (depuração)
              </button>
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-black tracking-widest text-neon-cyan drop-shadow-[0_0_12px_rgba(0,240,255,0.5)]">
              NIGHT<span className="text-neon-magenta">//</span>LIFE
            </h1>
          </header>

          {!hasKey && (
            <div className="border border-neon-yellow/50 bg-neon-yellow/5 p-3 space-y-2">
              <p className="text-sm text-neon-yellow">Sem chave Gemini: o Mestre (IA) não vai responder.</p>
              <p className="text-xs text-muted">
                Crie uma chave grátis no Google AI Studio e cole aqui. Ela fica só neste navegador (dá para trocar depois nas Configurações).
              </p>
              <div className="flex gap-1.5">
                <Input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="Cole sua chave Gemini" autoComplete="off" aria-label="Chave Gemini" />
                <Button
                  variant="solid"
                  tone="yellow"
                  disabled={!keyDraft.trim()}
                  onClick={async () => {
                    useUiStore.getState().setGeminiKey(keyDraft);
                    setKeyDraft('');
                    useUiStore.getState().setHasKey((await fetchStatus()).hasKey);
                  }}
                >
                  Salvar
                </Button>
              </div>
            </div>
          )}

          <Stepper steps={STEPS} current={step} className="justify-center" />

          <Card cut raised title={STEPS[step]} subtitle={`Etapa ${step + 1} de ${STEPS.length}`} bodyClassName="space-y-5">
            {step === 0 && (
              <>
                <p className="text-sm text-muted leading-relaxed">
                  Você não é uma lenda. É alguém cru que acabou de botar a cara nas calçadas de Night City.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Nome">
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Alex Santos, Ren, Maya…" maxLength={40} />
                  </Field>
                  <Field label="Apelido de rua *" hint="Como a rua te chama.">
                    <Input tone="yellow" value={handle} onChange={e => setHandle(e.target.value)} placeholder="Sparks, Zero, Rook…" maxLength={24} data-autofocus />
                  </Field>
                  <Field label="Idade">
                    <Input type="number" min={16} max={60} value={age} onChange={e => setAge(Number(e.target.value))} />
                  </Field>
                  <Field label="Como você se mantém no corre">
                    <Input value={occupation} onChange={e => setOccupation(e.target.value)} maxLength={80} />
                  </Field>
                </div>
                <Field label="Aparência (opcional)">
                  <Input value={appearance} onChange={e => setAppearance(e.target.value)} placeholder="Jaqueta de neon rasgada, cabelo raspado, olhar cansado…" maxLength={160} />
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <section className="space-y-2">
                  <p className="eyebrow">Papel</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ROLES.map(r => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          setRole(r.id);
                        }}
                        className={cn(
                          'text-left p-3 border transition-colors',
                          role === r.id ? 'border-neon-yellow bg-neon-yellow/10' : 'border-line hover:border-muted',
                        )}
                        aria-pressed={role === r.id}
                      >
                        <span className={cn('font-display text-xs uppercase tracking-wider', role === r.id ? 'text-neon-yellow' : 'text-fg')}>{r.label}</span>
                        <span className="block text-[11px] text-muted mt-1 leading-snug">{r.tagline}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="eyebrow">Distrito onde você caiu</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {DISTRICTS.map(d => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          setDistrict(d.id);
                        }}
                        className={cn('text-left p-2.5 border transition-colors', district === d.id ? 'border-neon-cyan bg-neon-cyan/10' : 'border-line hover:border-muted')}
                        aria-pressed={district === d.id}
                      >
                        <span className="font-display text-xs uppercase tracking-wider">{d.name}</span>
                        <span className="block text-[11px] text-muted line-clamp-2 mt-0.5">{d.vibe}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-3 pt-2 border-t border-line-soft">
                  <p className="eyebrow">Laços humanos · estilo Edgerunners</p>
                  <Field label="Laço mais importante" hint="Pessoa ou bicho de estimação.">
                    <Input value={familyTie} onChange={e => setFamilyTie(e.target.value)} maxLength={140} />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Dívida / pressão imediata">
                      <Textarea rows={2} value={debtReason} onChange={e => setDebtReason(e.target.value)} maxLength={160} />
                    </Field>
                    <Field label="Sonho / âncora">
                      <Textarea rows={2} value={personalAnchor} onChange={e => setPersonalAnchor(e.target.value)} maxLength={160} />
                    </Field>
                  </div>
                </section>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={remaining === 0 ? 'green' : remaining > 0 ? 'yellow' : 'danger'} cut>
                    Pontos livres: {remaining} / {POINT_BUDGET}
                  </Badge>
                  <span className="tabular text-xs text-muted">
                    PV {computeMaxHp(stats.BODY, stats.WILL)} · Humanidade {computeMaxHumanity(stats.EMP)} · Sorte {stats.LUCK}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {STAT_PRESETS.map(p => (
                    <Button
                      key={p.id}
                      size="sm"
                      variant={preset === p.id ? 'solid' : 'ghost'}
                      onClick={() => {
                        sound.playClick();
                        setPreset(p.id);
                        setStats({ ...p.stats });
                      }}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {STAT_KEYS.map(k => (
                    <div key={k} className="border border-line bg-surface-0/60 p-2 text-center" title={STAT_INFO[k].description}>
                      <div className="font-display text-[11px] text-neon-cyan tracking-widest">{k}</div>
                      <div className="text-[10px] text-dim truncate">{STAT_INFO[k].label}</div>
                      <div className="flex items-center justify-center gap-2 mt-1.5">
                        <button type="button" aria-label={`Diminuir ${k}`} disabled={stats[k] <= STAT_MIN} onClick={() => changeStat(k, -1)} className="w-7 h-7 border border-line text-muted hover:text-fg disabled:opacity-30 grid place-items-center">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="tabular text-lg w-5">{stats[k]}</span>
                        <button type="button" aria-label={`Aumentar ${k}`} disabled={stats[k] >= STAT_MAX || remaining <= 0} onClick={() => changeStat(k, 1)} className="w-7 h-7 border border-neon-cyan/60 text-neon-cyan hover:bg-neon-cyan/10 disabled:opacity-30 grid place-items-center">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {statsError && <p className="text-xs text-neon-yellow">{statsError}</p>}
                <div>
                  <p className="eyebrow mb-1.5">Perícias de destaque ({ROLES.find(r => r.id === role)?.label})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {topSkills.map(s => (
                      <Badge key={s.id} tone="muted">
                        {s.label} <span className="text-dim">({s.stat})</span> {skills[s.id]}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <section className="space-y-2">
                  <p className="eyebrow">Arma inicial</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {STARTER_WEAPONS.map(w => {
                      const profile = WEAPONS[w.weaponClass];
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => {
                            sound.playClick();
                            setWeaponId(w.id);
                          }}
                          className={cn('text-left p-3 border transition-colors', weaponId === w.id ? 'border-neon-magenta bg-neon-magenta/10' : 'border-line hover:border-muted')}
                          aria-pressed={weaponId === w.id}
                        >
                          <span className="font-display text-xs uppercase tracking-wider">{w.name}</span>
                          <span className="block tabular text-[11px] text-neon-magenta mt-1">
                            {profile.label} · {profile.defaultDamage}
                            {w.magSize ? ` · pente ${w.magSize} · +${w.spareAmmo} balas` : ' · corpo a corpo'}
                          </span>
                          <span className="block text-[11px] text-muted mt-1">{w.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <div className="border border-line-soft bg-surface-0/60 p-3 text-sm text-muted leading-relaxed">
                  Você começa sem fama, com <span className="text-neon-yellow">€${STARTING_MONEY}</span>, jaqueta balística (SP 7), boné reforçado (SP 4),
                  dois biocurativos, o Agent de bolso e o kit do seu papel. Narrador: modelo <span className="text-neon-cyan uppercase">{model}</span>.
                </div>
              </>
            )}

            <footer className="flex items-center justify-between pt-4 border-t border-line-soft">
              {step > 0 ? (
                <Button variant="ghost" icon={<ChevronLeft className="w-4 h-4" />} onClick={() => setStep(step - 1)} disabled={starting}>
                  Voltar
                </Button>
              ) : (
                <span />
              )}
              <Button
                variant={step === STEPS.length - 1 ? 'neon' : 'solid'}
                tone={step === STEPS.length - 1 ? 'yellow' : 'cyan'}
                onClick={next}
                disabled={!canNext}
                loading={starting}
                icon={step === STEPS.length - 1 ? <Zap className="w-4 h-4" /> : undefined}
              >
                {step === STEPS.length - 1 ? 'Entrar na rua' : 'Próximo'}
                {step < STEPS.length - 1 && <ChevronRight className="w-4 h-4" />}
              </Button>
            </footer>
          </Card>
        </div>
      </div>
    </div>
  );
}
