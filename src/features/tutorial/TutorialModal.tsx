import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, GraduationCap } from 'lucide-react';
import { Button, Modal, cn } from '../../ui';
import { useUiStore, type TutorialId } from '../../store/uiStore';
import { TUTORIALS } from './tutorials';

/** Passo a passo do tutorial aberto (um por sistema, na primeira vez que ele aparece). */
export function TutorialModal() {
  const id = useUiStore(s => s.tutorial);
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [id]);
  if (!id) return null;
  const t = TUTORIALS[id];
  const s = t.steps[step];
  const last = step === t.steps.length - 1;
  const close = () => useUiStore.getState().closeTutorial();

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-neon-yellow" /> {t.title}
        </span>
      }
      subtitle={`Tutorial · ${step + 1} de ${t.steps.length}`}
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <button type="button" onClick={close} className="text-[11px] text-dim hover:text-muted underline-offset-2 hover:underline">
            Pular
          </button>
          <div className="flex items-center gap-1.5">
            <span className="flex gap-1 mr-2" aria-hidden>
              {t.steps.map((_, i) => (
                <span key={i} className={cn('w-1.5 h-1.5', i === step ? 'bg-neon-cyan' : 'bg-line')} />
              ))}
            </span>
            <Button size="sm" variant="ghost" disabled={step === 0} onClick={() => setStep(n => n - 1)} icon={<ChevronLeft className="w-3.5 h-3.5" />}>
              Voltar
            </Button>
            <Button size="sm" variant="solid" tone={last ? 'green' : 'cyan'} onClick={() => (last ? close() : setStep(n => n + 1))}>
              {last ? 'Entendi' : 'Próximo'}
              {!last && <ChevronRight className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3" key={`${id}-${step}`}>
        <h3 className="font-display text-sm uppercase tracking-wider text-neon-cyan animate-reveal">{s.title}</h3>
        <p className="text-sm text-muted leading-relaxed animate-reveal [&_b]:text-fg [&_code]:text-neon-cyan">{s.body}</p>
        {s.visual && <div className="animate-reveal">{s.visual}</div>}
      </div>
    </Modal>
  );
}

/** Dispara o tutorial do sistema na primeira vez que a condição fica verdadeira. */
export function useTutorial(id: TutorialId, when: boolean) {
  useEffect(() => {
    if (when) useUiStore.getState().showTutorial(id);
  }, [id, when]);
}
