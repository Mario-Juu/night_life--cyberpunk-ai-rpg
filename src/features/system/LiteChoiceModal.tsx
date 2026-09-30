import type { ReactNode } from 'react';
import { Clock, Feather, Zap } from 'lucide-react';
import { Modal, cn } from '../../ui';
import { useUiStore, type LiteChoice } from '../../store/uiStore';

function Option({ icon, title, hint, tone, primary, onClick }: { icon: ReactNode; title: string; hint: string; tone: 'cyan' | 'yellow' | 'purple'; primary?: boolean; onClick: () => void }) {
  const toneClass = {
    cyan: 'border-neon-cyan/60 text-neon-cyan hover:bg-neon-cyan/10',
    yellow: 'border-neon-yellow/60 text-neon-yellow hover:bg-neon-yellow/10',
    purple: 'border-neon-purple/50 text-neon-purple hover:bg-neon-purple/10',
  }[tone];
  return (
    <button type="button" onClick={onClick} className={cn('w-full flex items-start gap-3 border p-3 text-left transition-colors', toneClass, primary && 'bg-white/[0.03]')}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block font-display text-xs uppercase tracking-wider">{title}</span>
        <span className="block text-[11px] text-muted mt-0.5">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Os modelos Flash falharam na narração. Em vez de cair calado no Flash-Lite (prosa mais crua),
 * o jogador escolhe: esperar e tentar o Flash de novo, ou seguir com o Lite.
 */
export function LiteChoiceModal() {
  const req = useUiStore(s => s.liteChoice);
  const backup = useUiStore(s => s.backupLabel);
  const lite = /lite/i.test(backup);
  if (!req) return null;
  const quota = req.failureKind === 'quota_day';
  const canWait = req.waitMayHelp && !quota;
  const choose = (c: LiteChoice) => req.resolve(c);

  return (
    <Modal open onClose={() => choose('cancel')} title="Flash indisponível" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted leading-relaxed">
          {quota ? (
            <>
              A cota diária gratuita dos modelos <span className="text-fg">Flash</span> desta chave acabou. Ela volta à meia-noite do Pacífico (~4h de Brasília).
            </>
          ) : (
            <>
              Os servidores do Google estão sobrecarregados para os modelos <span className="text-fg">Flash</span> agora. Costuma passar em instantes.
            </>
          )}
        </p>
        <p className="text-sm text-muted leading-relaxed">
          {lite ? (
            <>
              O <span className="text-fg">Flash-Lite</span> ainda responde, mas narra de um jeito mais simples e cru.
            </>
          ) : (
            <>
              A reserva é o <span className="text-fg">{backup}</span> (outro provedor): a prosa muda um pouco de estilo. Se ele também falhar, o Flash-Lite assume.
            </>
          )}
        </p>
        <div className="grid gap-2">
          {canWait && <Option primary tone="cyan" icon={<Clock className="w-4 h-4" />} title="Esperar e tentar o Flash" hint="Aguarda ~20 s e tenta de novo." onClick={() => choose('wait')} />}
          <Option primary={!canWait} tone="yellow" icon={<Feather className="w-4 h-4" />} title={`Usar o ${backup} agora`} hint="Só nesta narração." onClick={() => choose('lite')} />
          <Option tone="purple" icon={<Zap className="w-4 h-4" />} title="Sempre usar a reserva" hint="Não perguntar de novo quando o Flash falhar (dá para mudar em Configurações)." onClick={() => choose('always')} />
        </div>
        <p className="text-[11px] text-dim">O motor já resolveu a ação; só falta a narração. Fechar deixa o turno sem narrar — dá para regenerar depois.</p>
      </div>
    </Modal>
  );
}
