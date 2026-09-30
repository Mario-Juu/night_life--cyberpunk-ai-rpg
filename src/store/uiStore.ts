import type { FailureKind } from '@shared/types/turn';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ModelMode } from '@shared/types/gm';
import type { GameState } from '@shared/types/game';

export type MobileTab = 'story' | 'sheet' | 'journal' | 'phone';
export type SideTab = 'combat' | 'journal' | 'contacts' | 'net';
export type ModalId = 'saves' | 'log' | 'rules' | 'settings' | 'newGame' | 'sandbox' | null;
export type LogTab = 'events' | 'turns' | 'timeline';
export type TutorialId = 'net' | 'combat' | 'role' | 'humanity' | 'cyber' | 'sandbox';

export type LiteChoice = 'lite' | 'wait' | 'always' | 'cancel';
export interface LiteChoiceRequest {
  failureKind?: FailureKind;
  /** Esperar pode resolver (sobrecarga); com cota diária esgotada, não. */
  waitMayHelp: boolean;
  resolve: (choice: LiteChoice) => void;
}

interface UiStore {
  mobileTab: MobileTab;
  sideTab: SideTab;
  sheetOpen: boolean;
  sideOpen: boolean;
  phoneOpen: boolean;
  activeThread: string | null;
  modal: ModalId;
  logTab: LogTab;
  gmBusy: boolean;
  gmBusyLabel: string;
  phoneTyping: string | null;
  lastDegraded: boolean;
  model: ModelMode;
  hasKey: boolean;
  /** Mostrar DVs ao jogador (modo transparente/depuração). Padrão: escondido, como numa mesa real. */
  revealDv: boolean;
  animateDice: boolean;
  /** Efeitos visuais de tela (flashes, tremor, scanlines). */
  vfx: boolean;
  /** Introdução em console já vista neste navegador. */
  introSeen: boolean;
  /**
   * Estado exibido nos painéis enquanto o Mestre narra uma rolagem: o jogador só descobre
   * o desfecho (PV, abates, morte) junto com a narração. null = mostra o estado real.
   */
  concealedGame: GameState | null;
  /** Sandbox: o próximo d10 rolado sai com este valor (uma vez). */
  forcedD10: number | null;
  /** Chave Gemini do próprio jogador (fica só neste navegador; vai no cabeçalho dos pedidos). */
  geminiKey: string;
  /** Quando os flash falham na narração: perguntar antes de usar o flash-lite, ou usar direto. */
  liteNarration: 'ask' | 'allow';
  /** Pergunta pendente ao jogador (Flash indisponível: esperar ou seguir com o Lite?). */
  liteChoice: LiteChoiceRequest | null;
  /** Tutoriais de primeira vez (um por sistema). */
  tutorialsOn: boolean;
  seenTutorials: TutorialId[];
  tutorial: TutorialId | null;

  setMobileTab: (tab: MobileTab) => void;
  setSideTab: (tab: SideTab) => void;
  toggleSheet: () => void;
  toggleSide: () => void;
  openPhone: (threadId?: string | null) => void;
  closePhone: () => void;
  setActiveThread: (id: string | null) => void;
  openModal: (id: ModalId) => void;
  openLog: (tab: LogTab) => void;
  setBusy: (busy: boolean, label?: string) => void;
  setPhoneTyping: (npcId: string | null) => void;
  setDegraded: (v: boolean) => void;
  setModel: (m: ModelMode) => void;
  setHasKey: (v: boolean) => void;
  setRevealDv: (v: boolean) => void;
  setAnimateDice: (v: boolean) => void;
  setVfx: (v: boolean) => void;
  setIntroSeen: (v: boolean) => void;
  setConcealedGame: (g: GameState | null) => void;
  setForcedD10: (v: number | null) => void;
  /** Mostra o tutorial do sistema se ainda não foi visto (force = rever pelas Configurações). */
  showTutorial: (id: TutorialId, force?: boolean) => void;
  closeTutorial: () => void;
  setTutorialsOn: (v: boolean) => void;
  setGeminiKey: (v: string) => void;
  setLiteNarration: (v: 'ask' | 'allow') => void;
  setLiteChoice: (v: LiteChoiceRequest | null) => void;
  resetTutorials: () => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    set => ({
      mobileTab: 'story',
      sideTab: 'journal',
      sheetOpen: true,
      sideOpen: true,
      phoneOpen: false,
      activeThread: null,
      modal: null,
      logTab: 'events',
      gmBusy: false,
      gmBusyLabel: '',
      phoneTyping: null,
      lastDegraded: false,
      model: 'flash',
      hasKey: true,
      revealDv: false,
      animateDice: true,
      vfx: true,
      introSeen: false,
      concealedGame: null,
      forcedD10: null,
      geminiKey: '',
      liteNarration: 'ask',
      liteChoice: null,
      tutorialsOn: true,
      seenTutorials: [],
      tutorial: null,

      setMobileTab: mobileTab => set({ mobileTab }),
      setSideTab: sideTab => set({ sideTab }),
      toggleSheet: () => set(s => ({ sheetOpen: !s.sheetOpen })),
      toggleSide: () => set(s => ({ sideOpen: !s.sideOpen })),
      openPhone: threadId => set(s => ({ phoneOpen: true, activeThread: threadId === undefined ? s.activeThread : threadId })),
      closePhone: () => set({ phoneOpen: false }),
      setActiveThread: activeThread => set({ activeThread }),
      openModal: modal => set({ modal }),
      openLog: logTab => set({ modal: 'log', logTab }),
      setBusy: (gmBusy, gmBusyLabel = '') => set({ gmBusy, gmBusyLabel }),
      setPhoneTyping: phoneTyping => set({ phoneTyping }),
      setDegraded: lastDegraded => set({ lastDegraded }),
      setModel: model => set({ model }),
      setHasKey: hasKey => set({ hasKey }),
      setRevealDv: revealDv => set({ revealDv }),
      setAnimateDice: animateDice => set({ animateDice }),
      setVfx: vfx => set({ vfx }),
      setIntroSeen: introSeen => set({ introSeen }),
      setConcealedGame: concealedGame => set({ concealedGame }),
      setForcedD10: forcedD10 => set({ forcedD10 }),
      showTutorial: (id, force = false) =>
        set(s => {
          if (s.tutorial) return s;
          if (!force && (!s.tutorialsOn || !s.introSeen || s.seenTutorials.includes(id))) return s;
          return { tutorial: id };
        }),
      closeTutorial: () => set(s => ({ tutorial: null, seenTutorials: s.tutorial && !s.seenTutorials.includes(s.tutorial) ? [...s.seenTutorials, s.tutorial] : s.seenTutorials })),
      setTutorialsOn: tutorialsOn => set({ tutorialsOn }),
      setGeminiKey: geminiKey => set({ geminiKey: geminiKey.trim() }),
      setLiteNarration: liteNarration => set({ liteNarration }),
      setLiteChoice: liteChoice => set({ liteChoice }),
      resetTutorials: () => set({ seenTutorials: [], tutorialsOn: true }),
    }),
    {
      name: 'nightlife_ui_v2',
      storage: createJSONStorage(() => localStorage),
      partialize: s => ({ model: s.model, sheetOpen: s.sheetOpen, sideOpen: s.sideOpen, sideTab: s.sideTab, revealDv: s.revealDv, animateDice: s.animateDice, vfx: s.vfx, introSeen: s.introSeen, tutorialsOn: s.tutorialsOn, seenTutorials: s.seenTutorials, geminiKey: s.geminiKey, liteNarration: s.liteNarration }),
    },
  ),
);
