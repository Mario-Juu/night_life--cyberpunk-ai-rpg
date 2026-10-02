import { useEffect, useState } from 'react';
import { ToastHost } from '../ui';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { fetchStatus } from '../services/api';
import { recoverInterruptedTurn } from '../store/turnController';
import { CreationScreen } from '../features/creation/CreationScreen';
import { GameLayout } from '../features/layout/GameLayout';
import { SaveLoadModal } from '../features/system/SaveLoadModal';
import { EventLogModal } from '../features/system/EventLogModal';
import { RulesModal } from '../features/system/RulesModal';
import { SettingsModal } from '../features/system/SettingsModal';
import { SandboxModal } from '../features/system/SandboxModal';
import { DiceOverlay } from '../features/dice/DiceOverlay';
import { VfxLayer } from '../features/vfx/VfxLayer';
import { IntroConsole } from '../features/intro/IntroConsole';
import { KeyGate } from '../features/intro/KeyGate';
import { LiteChoiceModal } from '../features/system/LiteChoiceModal';
import { TutorialModal } from '../features/tutorial/TutorialModal';

export default function App() {
  const game = useGameStore(s => s.game);
  // Enquanto o Mestre narra uma rolagem, o registro também não antecipa o desfecho.
  const concealed = useUiStore(s => s.concealedGame);
  const introSeen = useUiStore(s => s.introSeen);
  const hasKey = useUiStore(s => s.hasKey);
  const geminiKey = useUiStore(s => s.geminiKey);
  // Só decide se pede a chave depois de perguntar ao servidor (ele pode ter uma chave própria).
  const [statusChecked, setStatusChecked] = useState(false);
  const debug = useUiStore(s => s.debug);
  // Campanha Sandbox salva só volta com a flag de debug ligada no servidor.
  const sandboxLocked = !!game?.sandbox && !debug;

  // Turno que ficou no meio quando a página recarregou: fecha e avisa (senão a ação fica pendurada).
  useEffect(() => {
    recoverInterruptedTurn().catch(err => console.warn('[turn] retomada falhou:', err));
  }, []);

  useEffect(() => {
    void fetchStatus().then(status => {
      useUiStore.getState().setHasKey(status.hasKey);
      useUiStore.getState().setDebug(!!status.debug);
      if (status.backup) useUiStore.getState().setBackupLabel(status.backup);
      setStatusChecked(true);
    });
  }, []);

  // Sem chave no servidor nem no navegador: o terminal de acesso vem ANTES da introdução e da criação.
  const needsKey = statusChecked && !hasKey && !geminiKey;
  // Fica aberto até o terminal terminar a animação de "acesso concedido" (a chave já foi salva).
  const [gateOpen, setGateOpen] = useState(false);
  useEffect(() => {
    if (needsKey) setGateOpen(true);
  }, [needsKey]);

  return (
    <>
      {game && !sandboxLocked ? (
        <>
          <GameLayout game={game} />
          <SaveLoadModal game={game} />
          <EventLogModal game={concealed ?? game} />
          <SettingsModal />
          {debug && <SandboxModal game={game} />}
        </>
      ) : (
        <CreationScreen />
      )}
      {/* Antes de saber se falta a chave, nada de cadastro piscando por baixo: só o fundo do console. */}
      {!statusChecked && (!geminiKey || !introSeen) && <div className="fixed inset-0 z-[70] bg-surface-0" aria-hidden />}
      {needsKey || gateOpen ? (
        <KeyGate onDone={() => setGateOpen(false)} />
      ) : (
        statusChecked && !introSeen && <IntroConsole onDone={() => useUiStore.getState().setIntroSeen(true)} />
      )}
      <RulesModal />
      <LiteChoiceModal />
      {game && !sandboxLocked && <TutorialModal />}
      <DiceOverlay />
      <VfxLayer game={concealed ?? game} />
      <ToastHost />
    </>
  );
}
