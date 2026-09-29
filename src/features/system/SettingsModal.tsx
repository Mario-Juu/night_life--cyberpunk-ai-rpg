import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal, cn } from '../../ui';
import { sound } from '../../services/audio';
import { useUiStore } from '../../store/uiStore';
import { newCampaign } from '../../store/turnController';
import { RadioControl } from '../radio/RadioControl';

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm text-fg">{label}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
      <span className="cp-switch shrink-0">
        <input type="checkbox" className="cp-switch__input" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="cp-switch__track">
          <span className="cp-switch__thumb" />
        </span>
      </span>
    </label>
  );
}

export function SettingsModal() {
  const open = useUiStore(s => s.modal === 'settings');
  const model = useUiStore(s => s.model);
  const revealDv = useUiStore(s => s.revealDv);
  const animateDice = useUiStore(s => s.animateDice);
  const vfxOn = useUiStore(s => s.vfx);
  const [sfxVolume, setSfxVolume] = useState(sound.getVolume());
  const hasKey = useUiStore(s => s.hasKey);
  const close = () => useUiStore.getState().openModal(null);
  const [sfx, setSfx] = useState(sound.isEnabled());
  const [ambience, setAmbience] = useState(sound.isAmbienceActive());

  return (
    <Modal open={open} onClose={close} title="Configurações" size="sm">
      <div className="space-y-5">
        <section className="space-y-2">
          <p className="eyebrow">Modelo do Mestre</p>
          <div className="grid grid-cols-2 gap-2">
            {(['flash', 'pro'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => useUiStore.getState().setModel(m)}
                aria-pressed={model === m}
                className={cn('border p-2.5 text-left', model === m ? 'border-neon-cyan bg-neon-cyan/10' : 'border-line hover:border-muted')}
              >
                <span className="font-display text-xs uppercase tracking-wider">{m === 'flash' ? 'Flash' : 'Pro'}</span>
                <span className="block text-[11px] text-muted">{m === 'flash' ? 'Rápido e direto' : 'Prosa densa, mais lento'}</span>
              </button>
            ))}
          </div>
          {!hasKey && (
            <p className="flex items-start gap-1.5 text-xs text-neon-yellow">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Nenhuma chave Gemini configurada no servidor (.env). O Mestre responderá em modo degradado.
            </p>
          )}
        </section>

        <section className="divide-y divide-line-soft">
          <Toggle label="Efeitos sonoros" description="Dados, alertas e notificações." checked={sfx} onChange={() => setSfx(sound.toggle())} />
          {sfx && (
            <label className="flex items-center gap-3 py-2 text-xs text-muted">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sfxVolume}
                onChange={e => {
                  const v = Number(e.target.value);
                  setSfxVolume(v);
                  sound.setVolume(v);
                }}
                onPointerUp={() => sound.playDiceLand()}
                aria-label="Volume dos efeitos sonoros"
                className="flex-1 accent-[var(--color-neon-cyan)]"
              />
            </label>
          )}
          <Toggle label="Ambiente de Night City" description="Chuva, neon e sirenes ao fundo." checked={ambience} onChange={() => setAmbience(sound.toggleAmbience())} />
        </section>

        <section className="divide-y divide-line-soft">
          <Toggle label="Animação dos dados" description="Mostra os dados rolando antes do resultado." checked={animateDice} onChange={v => useUiStore.getState().setAnimateDice(v)} />
          <Toggle label="Efeitos visuais" description="Scanlines, flashes, tremor de tela e alerta de PV baixo." checked={vfxOn} onChange={v => useUiStore.getState().setVfx(v)} />
          <div className="py-2">
            <Button size="sm" variant="ghost" onClick={() => useUiStore.setState({ introSeen: false, modal: null })}>
              Rever introdução
            </Button>
          </div>
          <Toggle
            label="Revelar dificuldades (DV)"
            description="Modo transparente/depuração. Numa mesa normal o DV é segredo do Mestre."
            checked={revealDv}
            onChange={v => useUiStore.getState().setRevealDv(v)}
          />
        </section>

        <section className="space-y-2 border-t border-line-soft pt-4">
          <p className="eyebrow">Rádio de Night City</p>
          <RadioControl expanded />
        </section>

        <section className="space-y-2 border-t border-line-soft pt-4">
          <p className="eyebrow text-danger">Zona de perigo</p>
          <Button
            variant="ghost"
            tone="danger"
            block
            onClick={() => {
              if (window.confirm('Começar uma nova campanha? A campanha atual será descartada (os slots de save continuam).')) newCampaign();
            }}
          >
            Nova campanha
          </Button>
        </section>
      </div>
    </Modal>
  );
}
