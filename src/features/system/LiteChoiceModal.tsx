import { Clock, Feather, Zap } from 'lucide-react';
import { Button, Modal } from '../../ui';
import { useUiStore } from '../../store/uiStore';

/**
 * Os modelos Flash falharam na narração. Em vez de cair calado no Flash-Lite (prosa mais crua),
 * o jogador escolhe: esperar e tentar o Flash de novo, ou seguir com o Lite.
 */
export function LiteChoiceModal() {
  const req = useUiStore(s => s.liteChoice);
  if (!req) return null;
  const quota = req.failureKind === 'quota_day';
  const choose = (c: Parameters<typeof req.resolve>[0]) => req.resolve(c);

  return (
    <Modal open onClose={() => choose('cancel')} title="Mestre Flash indisponível" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-muted leading-relaxed">
          {quota
            ? 'A cota diária gratuita dos modelos Flash desta chave acabou (zera à meia-noite do Pacífico, ~4h de Brasília).'
            : 'Os servidores do Google estão sobrecarregados agora para os modelos Flash — costuma passar em instantes.'}{' '}
          O <span className="text-fg">Flash-Lite</span> ainda responde, mas a narração dele é mais simples e crua.
        </p>
        <div className="grid gap-2">
          {req.waitMayHelp && !quota && (
            <Button variant="solid" tone="cyan" block icon={<Clock className="w-4 h-4" />} onClick={() => choose('wait')}>
              Esperar ~20 s e tentar o Flash de novo
            </Button>
          )}
          <Button variant={req.waitMayHelp && !quota ? 'ghost' : 'solid'} tone="yellow" block icon={<Feather className="w-4 h-4" />} onClick={() => choose('lite')}>
            Seguir com o Flash-Lite desta vez
          </Button>
          <Button variant="ghost" tone="purple" block icon={<Zap className="w-4 h-4" />} onClick={() => choose('always')}>
            Sempre usar o Lite quando o Flash falhar
          </Button>
        </div>
        <p className="text-[11px] text-dim">
          O motor já resolveu a ação; só falta a narração. Fechar deixa o turno sem narrar (dá para regenerar depois). A preferência muda em Configurações.
        </p>
      </div>
    </Modal>
  );
}
