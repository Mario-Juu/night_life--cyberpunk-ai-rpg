import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportSave } from '../services/saves';
import type { GameState } from '@shared/types/game';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Rede de segurança da interface: um erro ao desenhar a tela vira um painel com saída, em vez de
 * tela branca. Importa porque o estado é persistido: sem isto, um save ruim quebra TODO carregamento.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui]', error, info.componentStack);
  }

  /** Lê a campanha direto do armazenamento (o store pode estar justamente quebrado). */
  private storedGame(): GameState | null {
    try {
      return JSON.parse(localStorage.getItem('nightlife_state_v2') ?? 'null')?.state?.game ?? null;
    } catch {
      return null;
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const game = this.storedGame();
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-surface-0 p-4 text-fg">
        <div className="w-full max-w-lg space-y-4 border border-danger/60 bg-surface-1 p-5">
          <div className="space-y-1">
            <p className="font-display text-xs uppercase tracking-wider text-danger">Falha na interface</p>
            <p className="text-sm text-muted">
              A tela não pôde ser desenhada. Sua campanha continua salva neste navegador — exporte o arquivo antes de tentar qualquer coisa.
            </p>
          </div>
          <pre className="max-h-28 overflow-auto border border-line-soft bg-surface-0 p-2 text-[11px] text-dim">{String(error.message || error)}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="border border-neon-cyan px-3 py-2 font-display text-xs uppercase tracking-wider text-neon-cyan hover:bg-neon-cyan/10" onClick={() => window.location.reload()}>
              Recarregar
            </button>
            {game && (
              <button
                type="button"
                className="border border-neon-yellow px-3 py-2 font-display text-xs uppercase tracking-wider text-neon-yellow hover:bg-neon-yellow/10"
                onClick={() => {
                  try {
                    exportSave(game);
                  } catch {
                    /* sem o que exportar */
                  }
                }}
              >
                Exportar a campanha
              </button>
            )}
            <button
              type="button"
              className="border border-danger px-3 py-2 font-display text-xs uppercase tracking-wider text-danger hover:bg-danger/10"
              onClick={() => {
                if (!window.confirm('Começar do zero? A campanha atual sai da tela (uma cópia fica guardada no navegador).')) return;
                try {
                  const raw = localStorage.getItem('nightlife_state_v2');
                  if (raw) localStorage.setItem('nightlife_state_backup', raw);
                  localStorage.removeItem('nightlife_state_v2');
                } catch {
                  /* nada a guardar */
                }
                window.location.reload();
              }}
            >
              Começar do zero
            </button>
          </div>
        </div>
      </div>
    );
  }
}
