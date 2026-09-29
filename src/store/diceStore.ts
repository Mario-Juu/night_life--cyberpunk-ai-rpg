/**
 * Apresentação das rolagens: o motor já decidiu os valores; aqui só se encena o momento.
 * `playDice` mostra o overlay e resolve quando a animação termina (ou o jogador pula).
 * A encenação mostra SÓ os dados — sucesso/falha, dano e abates só aparecem com a narração.
 */
import { create } from 'zustand';
import type { RollOutcome } from '@shared/types/game';
import { useUiStore } from './uiStore';

export type DieTone = 'normal' | 'crit' | 'fumble';

export interface ShownDie {
  sides: number;
  value: number;
  tone: DieTone;
}

export interface DiceStage {
  label: string;
  dice: ShownDie[];
  /** Texto exibido depois que todos os dados param (ex.: "Total 16"). */
  result: string;
}

export interface DiceShow {
  id: string;
  title: string;
  stages: DiceStage[];
}

interface DiceStore {
  show: DiceShow | null;
  mounted: boolean;
  resolve: (() => void) | null;
  setMounted: (v: boolean) => void;
  finish: () => void;
}

export const useDiceStore = create<DiceStore>()((set, get) => ({
  show: null,
  mounted: false,
  resolve: null,
  setMounted: mounted => set({ mounted }),
  finish: () => {
    const { resolve } = get();
    set({ show: null, resolve: null });
    resolve?.();
  },
}));

/** Monta a encenação: só os d10 e o total. Nunca revela DV, sucesso/falha ou dano. */
export function diceShowFrom(outcome: RollOutcome): DiceShow {
  const { check, deathSave, initiative, attack, request } = outcome;
  const stages: DiceStage[] = [];
  if (check.d10.rolls.length) {
    const [first, extra] = check.d10.rolls;
    const dice: ShownDie[] = [{ sides: 10, value: first, tone: check.d10.crit ? 'crit' : check.d10.fumble ? 'fumble' : 'normal' }];
    if (extra !== undefined) dice.push({ sides: 10, value: extra, tone: check.d10.crit ? 'crit' : 'fumble' });
    const result = deathSave
      ? `d10: ${deathSave.roll}`
      : initiative
        ? `Iniciativa ${initiative.player}`
        : check.d10.crit
          ? `10 natural! O dado explode: +${extra} · total ${check.total}`
          : check.d10.fumble
            ? `1 natural… o dado implode: −${extra} · total ${check.total}`
            : `Total ${check.total}`;
    stages.push({ label: deathSave ? 'Teste de Morte' : initiative ? 'Iniciativa' : attack ? 'Ataque' : 'Teste', dice, result });
  }
  return { id: request.id, title: request.reason, stages };
}

/**
 * Encena a rolagem. Resolve `true` se a animação foi exibida.
 * Sem overlay montado (testes) ou com a animação desligada, resolve na hora.
 */
export function playDice(show: DiceShow): Promise<boolean> {
  const store = useDiceStore.getState();
  if (!store.mounted || !useUiStore.getState().animateDice || !show.stages.some(s => s.dice.length)) return Promise.resolve(false);
  store.resolve?.();
  return new Promise(resolve => useDiceStore.setState({ show, resolve: () => resolve(true) }));
}
