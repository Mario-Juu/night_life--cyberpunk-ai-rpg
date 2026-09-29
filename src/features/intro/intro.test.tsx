// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntroConsole, INTRO_SCRIPT } from './IntroConsole';

vi.mock('../../services/audio', () => ({ sound: new Proxy({}, { get: () => () => undefined }) }));
afterEach(cleanup);

describe('introdução em console', () => {
  it('conecta, digita, pode ser completada e segue para o registro', () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    const onDone = vi.fn();
    render(<IntroConsole onDone={onDone} />);
    expect(screen.getByText(/PRESSIONE QUALQUER TECLA/)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'a' });
    for (let i = 0; i < 80; i++) act(() => vi.advanceTimersByTime(5));
    expect(screen.getByText(/ZETATECH BIOS/)).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Enter' }); // completa o texto
    expect(screen.getByText(INTRO_SCRIPT.at(-1)!.text)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Enter' }); // avança
    expect(onDone).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('Esc pula a qualquer momento', () => {
    const onDone = vi.fn();
    render(<IntroConsole onDone={onDone} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDone).toHaveBeenCalled();
  });
});
