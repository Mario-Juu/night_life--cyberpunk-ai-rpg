// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useUiStore } from '../../store/uiStore';

const checkKey = vi.fn();
vi.mock('../../services/api', () => ({
  checkKey: (k: string) => checkKey(k),
  fetchStatus: async () => ({ status: 'ok', hasKey: false, defaultMode: 'flash', promptVersion: 't' }),
}));
vi.mock('../../services/audio', () => ({ sound: new Proxy({}, { get: () => () => undefined }) }));

// jsdom não tem scrollIntoView.
Element.prototype.scrollIntoView = () => undefined;

const { KeyGate } = await import('./KeyGate');

const KEY = 'AIzaSyChaveDeTeste_0000000000000000000';

async function bootAndType(value: string) {
  const onDone = vi.fn();
  render(<KeyGate onDone={onDone} />);
  // Pula a digitação do boot (clique no terminal).
  fireEvent.click(screen.getByRole('dialog'));
  const input = await screen.findByLabelText('Chave de acesso Gemini');
  fireEvent.change(input, { target: { value } });
  return { onDone, input };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useUiStore.setState({ geminiKey: '', hasKey: false });
  checkKey.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('KeyGate (terminal de acesso)', () => {
  it('chave aceita pelo Google: salva no navegador e libera o jogo', async () => {
    checkKey.mockResolvedValue({ valid: true });
    const { onDone } = await bootAndType(KEY);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conectar/i }));
    });
    expect(checkKey).toHaveBeenCalledWith(KEY);
    expect(await screen.findByText(/Credencial aceita/)).toBeTruthy();
    expect(useUiStore.getState().geminiKey).toBe(KEY);
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(onDone).toHaveBeenCalled();
    // A chave nunca aparece inteira na tela.
    expect(screen.queryByText(new RegExp(KEY))).toBeNull();
  });

  it('chave recusada: mostra o erro, não salva e deixa tentar de novo', async () => {
    checkKey.mockResolvedValue({ valid: false, reason: 'invalid' });
    const { onDone } = await bootAndType(KEY);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conectar/i }));
    });
    expect(await screen.findByText(/recusou esta chave/)).toBeTruthy();
    expect(useUiStore.getState().geminiKey).toBe('');
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Chave de acesso Gemini')).toBeTruthy();
  });

  it('formato inválido nem chega ao servidor', async () => {
    await bootAndType('abc 123');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conectar/i }));
    });
    expect(await screen.findByText(/Formato inválido/)).toBeTruthy();
    expect(checkKey).not.toHaveBeenCalled();
  });

  it('rede instável: salva e segue (a chave é testada no primeiro turno)', async () => {
    checkKey.mockResolvedValue({ valid: null, reason: 'network' });
    await bootAndType(KEY);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conectar/i }));
    });
    expect(await screen.findByText(/Não deu para verificar/)).toBeTruthy();
    expect(useUiStore.getState().geminiKey).toBe(KEY);
  });
});
