/**
 * Efeitos visuais de tela (flash, tremor, glitch). Disparados por eventos do jogo;
 * a camada `VfxLayer` os desenha. Desligáveis nas Configurações e respeitam
 * `prefers-reduced-motion`.
 */
import { create } from 'zustand';
import { useUiStore } from './uiStore';

export type VfxKind = 'damage' | 'crit' | 'fumble' | 'combat' | 'heal' | 'glitch';

export interface VfxEvent {
  id: number;
  kind: VfxKind;
}

interface VfxStore {
  events: VfxEvent[];
  push: (kind: VfxKind) => void;
  remove: (id: number) => void;
}

let seq = 0;

export const useVfxStore = create<VfxStore>()(set => ({
  events: [],
  push: kind => {
    const id = ++seq;
    set(s => ({ events: [...s.events.slice(-4), { id, kind }] }));
  },
  remove: id => set(s => ({ events: s.events.filter(e => e.id !== id) })),
}));

const SHAKE: Partial<Record<VfxKind, string>> = { damage: 'vfx-shake', fumble: 'vfx-shake-hard', combat: 'vfx-shake' };

/** Dispara um efeito de tela (no-op se os efeitos estiverem desligados). */
export function vfx(kind: VfxKind) {
  if (typeof document === 'undefined' || !useUiStore.getState().vfx) return;
  useVfxStore.getState().push(kind);
  const shake = SHAKE[kind];
  const root = document.getElementById('root');
  if (shake && root) {
    root.classList.remove('vfx-shake', 'vfx-shake-hard');
    void root.offsetWidth; // reinicia a animação
    root.classList.add(shake);
    setTimeout(() => root.classList.remove(shake), 600);
  }
}
