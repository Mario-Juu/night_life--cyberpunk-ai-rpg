import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>()(set => ({
  toasts: [],
  push: (t, ttlMs = 5000) => {
    const id = ++seq;
    set(s => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    if (ttlMs > 0) setTimeout(() => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), ttlMs);
  },
  dismiss: id => set(s => ({ toasts: s.toasts.filter(x => x.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id'>, ttlMs?: number) => useToastStore.getState().push(t, ttlMs);
