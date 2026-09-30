import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Input, Modal, cn } from '../../ui';
import { fetchStatus } from '../../services/api';
import { sound } from '../../services/audio';
import { useUiStore } from '../../store/uiStore';
import { newCampaign } from '../../store/turnController';
import { RadioControl } from '../radio/RadioControl';
import { TUTORIALS } from '../tutorial/tutorials';

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
  const tutorialsOn = useUiStore(s => s.tutorialsOn);
  const [sfxVolume, setSfxVolume] = useState(sound.getVolume());
  const hasKey = useUiStore(s => s.hasKey);
  const geminiKey = useUiStore(s => s.geminiKey);
  const liteNarration = useUiStore(s => s.liteNarration);
  const [keyDraft, setKeyDraft] = useState('');
  const close = () => useUiStore.getState().openModal(null);
  const [sfx, setSfx] = useState(sound.isEnabled());
  const [ambience, setAmbience] = useState(sound.isAmbienceActive());

  return (
    <Modal open={open} onClose={close} title="Configurações" size="sm">
      <div className="space-y-5">
        <section className="space-y-1">
          <p className="eyebrow">Modelo do Mestre</p>
          <p className="text-[11px] text-muted">Gemini Flash. Se uma versão estiver ocupada ou sem cota, o Mestre desce para a anterior (3.8 → 3.7 → 3.6 → 3.5).</p>
          <p className="text-[11px] text-muted">Se todos os Flash falharem na narração:</p>
          <div className="grid grid-cols-2 gap-2">
            {(['ask', 'allow'] as const).map(v => (
              <button
                key={v}
                type="button"
                onClick={() => useUiStore.getState().setLiteNarration(v)}
                aria-pressed={liteNarration === v}
                className={cn('border p-2 text-left', liteNarration === v ? 'border-neon-cyan bg-neon-cyan/10' : 'border-line hover:border-muted')}
              >
                <span className="font-display text-xs uppercase tracking-wider">{v === 'ask' ? 'Perguntar' : 'Usar o Lite'}</span>
                <span className="block text-[11px] text-muted">{v === 'ask' ? 'Esperar o Flash ou seguir com o Lite' : 'Sem perguntar (prosa mais simples)'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <p className="eyebrow">Sua chave Gemini</p>
          <p className="text-[11px] text-muted">
            Use a sua própria chave (grátis no Google AI Studio). Ela fica salva só neste navegador e vai para o servidor deste jogo em cada pedido ao Mestre — nunca para mais
            ninguém. Sem ela, vale a chave do servidor (se houver).
          </p>
          <div className="flex gap-1.5">
            <Input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder={geminiKey ? '•••••••• (salva)' : 'Cole sua chave aqui'} autoComplete="off" aria-label="Chave Gemini" className="h-9 text-sm" />
            <Button
              size="sm"
              variant="solid"
              disabled={!keyDraft.trim()}
              onClick={async () => {
                useUiStore.getState().setGeminiKey(keyDraft);
                setKeyDraft('');
                const status = await fetchStatus();
                useUiStore.getState().setHasKey(status.hasKey);
              }}
            >
              Salvar
            </Button>
            {geminiKey && (
              <Button
                size="sm"
                variant="ghost"
                tone="danger"
                onClick={async () => {
                  useUiStore.getState().setGeminiKey('');
                  const status = await fetchStatus();
                  useUiStore.getState().setHasKey(status.hasKey);
                }}
              >
                Remover
              </Button>
            )}
          </div>
          {geminiKey && <p className="text-[11px] text-neon-green">Usando a sua chave.</p>}
          {!hasKey && (
            <p className="flex items-start gap-1.5 text-xs text-neon-yellow">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Nenhuma chave Gemini disponível: coloque a sua acima (ou no .env do servidor). Sem chave, o Mestre responde em modo degradado.
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
          <Toggle
            label="Tutoriais"
            description="Cada sistema (Rede, combate, papel, Humanidade) se apresenta na primeira vez que aparece."
            checked={tutorialsOn}
            onChange={v => useUiStore.getState().setTutorialsOn(v)}
          />
          <p className="text-[11px] text-dim">Rever agora:</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.values(TUTORIALS).map(t => (
              <Button
                key={t.id}
                size="sm"
                variant="ghost"
                onClick={() => {
                  useUiStore.getState().openModal(null);
                  useUiStore.getState().showTutorial(t.id, true);
                }}
              >
                {t.title}
              </Button>
            ))}
          </div>
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
