import { useEffect } from 'react';
import { ToastHost } from '../ui';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { fetchStatus } from '../services/api';
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
import { TutorialModal } from '../features/tutorial/TutorialModal';

export default function App() {
  const game = useGameStore(s => s.game);
  // Enquanto o Mestre narra uma rolagem, o registro também não antecipa o desfecho.
  const concealed = useUiStore(s => s.concealedGame);
  const introSeen = useUiStore(s => s.introSeen);

  useEffect(() => {
    void fetchStatus().then(status => useUiStore.getState().setHasKey(status.hasKey));
  }, []);

  return (
    <>
      {game ? (
        <>
          <GameLayout game={game} />
          <SaveLoadModal game={game} />
          <EventLogModal game={concealed ?? game} />
          <SettingsModal />
          <SandboxModal game={game} />
        </>
      ) : (
        <CreationScreen />
      )}
      {!introSeen && <IntroConsole onDone={() => useUiStore.getState().setIntroSeen(true)} />}
      <RulesModal />
      {game && <TutorialModal />}
      <DiceOverlay />
      <VfxLayer game={concealed ?? game} />
      <ToastHost />
    </>
  );
}
