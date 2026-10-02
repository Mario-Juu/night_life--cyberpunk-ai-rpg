// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildCharacter, STAT_PRESETS } from '@shared/rules/creation';
import { createInitialState } from '@shared/engine/initialState';
import { gameReducer } from '@shared/engine/reducer';
import { applyInterpretation, applyNarration, beginTurn } from '@shared/engine/turn';
import type { GameState } from '@shared/types/game';
import { Modal } from '../ui';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { GameLayout } from '../features/layout/GameLayout';
import { createSandboxState } from '@shared/engine/sandbox';
import { createMemoryRepository, setRepository } from '../services/repository';

function makeGame(): GameState {
  const c = buildCharacter({
    name: 'Ren', handle: 'Sparks', age: 22, role: 'solo', occupation: 'Entregador', district: 'WATSON',
    familyTie: 'Elena', debtReason: 'aluguel', personalAnchor: '', appearance: '',
    stats: { ...STAT_PRESETS[0].stats }, starterWeaponId: 'pistol',
  });
  // Turno: narração com fala, depois uma ação interpretada que pede um teste.
  let step = beginTurn(createInitialState(c), null, 'prologue');
  step = applyNarration(step, {
    narration: 'A porta range.\n\n[DIALOGUE: Rafa]\nAbre aí, choom.\n[/DIALOGUE]',
    dialogues: [], toolCalls: [], discoveries: [], enemyActions: [], suggestedActions: ['Abrir a porta'],
  });
  step = beginTurn(step.state, 'Convenço o Rafa');
  step = applyInterpretation(step, { intent: { type: 'social', summary: 'convencer', confidence: 1 }, toolCalls: [{ tool: 'persuade', args: { dv: 15, reason: 'Convencer o Rafa' } }] });
  return step.state;
}

beforeEach(() => {
  setRepository(createMemoryRepository());
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  useUiStore.setState({ mobileTab: 'story', modal: null, phoneOpen: false, activeThread: null });
});

describe('Modal', () => {
  it('fecha com Esc e com clique no fundo, renderizado no body', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Teste">
        <button>ok</button>
      </Modal>,
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.body.querySelector('[aria-hidden]')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('GameLayout', () => {
  it('não oferece regenerar uma narração sem snapshot pós-motor (Sandbox)', async () => {
    const game = createSandboxState();
    useGameStore.setState({ game });
    render(<GameLayout game={game} />);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByRole('button', { name: /Regenerar narração/i })).toBeNull();
  });

  it('mostra UM único botão de rolar e a fala do NPC formatada', () => {
    const game = makeGame();
    useGameStore.setState({ game });
    render(<GameLayout game={game} />);
    // Desktop e mobile compartilham a mesma coluna; o card de rolagem aparece por coluna visível.
    const buttons = screen.getAllByRole('button', { name: /Rolar 1d10/i });
    expect(buttons.length).toBeGreaterThan(0);
    expect(new Set(buttons.map(b => b.closest('[aria-label="Teste pendente"]'))).size).toBe(buttons.length);
    expect(screen.getAllByText(/Abre aí, choom/).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText(/Role o teste/).length).toBeGreaterThan(0);
  });

  it('aba Ficha no mobile renderiza a ficha (não fica em branco)', () => {
    const game = makeGame();
    useGameStore.setState({ game });
    render(<GameLayout game={game} />);
    act(() => useUiStore.getState().setMobileTab('sheet'));
    expect(screen.getAllByText('Sparks').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pontos de Vida').length).toBeGreaterThan(0);
  });

  it('rolagem resolvida vira resultado sem botão', () => {
    let game = makeGame();
    game = gameReducer(game, {
      type: 'rollResolved',
      outcome: {
        request: game.pendingRoll!,
        check: { stat: 'COOL', statValue: 6, skillId: 'persuasion', skillValue: 2, d10: { rolls: [9], natural: 9, total: 9, crit: false, fumble: false }, modifiers: [], luckSpent: 0, total: 17, dv: 15, success: true, margin: 2 },
      },
    });
    useGameStore.setState({ game });
    render(<GameLayout game={game} />);
    expect(screen.queryByRole('button', { name: /Rolar 1d10/i })).toBeNull();
    expect(screen.getAllByText('Sucesso').length).toBeGreaterThan(0);
  });
});

describe('Tutoriais de primeira vez', () => {
  it('a primeira abertura narrada apresenta o tutorial do primeiro corre', async () => {
    const { TutorialModal } = await import('../features/tutorial/TutorialModal');
    useUiStore.setState({ introSeen: true, tutorialsOn: true, seenTutorials: [], tutorial: null });
    const base = makeGame();
    const game = { ...base, world: { ...base.world, opening: { key: 'classic', title: 'Cubículo', hook: '' } } };
    render(
      <>
        <GameLayout game={game} />
        <TutorialModal />
      </>,
    );
    expect(useUiStore.getState().tutorial).toBe('opening');
    expect(screen.getByText('Você começa pequeno')).toBeTruthy();
  });

  it('o combate se apresenta uma vez; depois de visto não volta', async () => {
    const { TutorialModal } = await import('../features/tutorial/TutorialModal');
    useUiStore.setState({ introSeen: true, tutorialsOn: true, seenTutorials: [], tutorial: null });
    const game = { ...makeGame(), combat: { active: true, round: 1, playerInitiative: null, combatants: [], log: [] } };
    render(
      <>
        <GameLayout game={game} />
        <TutorialModal />
      </>,
    );
    expect(useUiStore.getState().tutorial).toBe('combat');
    expect(screen.getByText('O motor resolve, o Mestre narra')).toBeTruthy();
    act(() => useUiStore.getState().closeTutorial());
    expect(useUiStore.getState().seenTutorials).toContain('combat');
    act(() => useUiStore.getState().showTutorial('combat'));
    expect(useUiStore.getState().tutorial).toBeNull();
  });
});
