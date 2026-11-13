
import { useState, useEffect, useRef } from 'react';
import { Trophy, RefreshCw, Download } from 'lucide-react';
import { Button } from './ui/button';
import Scoreboard from './Scoreboard';
import ActionPanel from './ActionPanel';
import GameLog from './GameLog';
import WinsTracker from './WinsTracker';
import PlayerSetupDialog from './PlayerSetupDialog';
import WinnerDialog from './WinnerDialog';
import {
  applyAttempt,
  restoreTurnState,
  startNewGameState,
  type Attempt,
  type GameAction,
  type GameSnapshot,
  type PanelActionType,
  type Player
} from '@/lib/game-rules';

export type { GameAction, Player };

const GAME_STORAGE_KEY = 'perfect20_game';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoredPlayer = (value: unknown): value is Player =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  value.name.trim() !== '' &&
  typeof value.score === 'number' &&
  Number.isFinite(value.score);

const parseStoredGameLog = (value: unknown): GameAction[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const entries: GameAction[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.id !== 'string' || typeof item.description !== 'string') return null;
    if (typeof item.gameNumber !== 'number' || !Number.isFinite(item.gameNumber)) return null;

    const timestamp = new Date(String(item.timestamp));
    if (Number.isNaN(timestamp.getTime())) return null;

    entries.push({
      id: item.id,
      timestamp,
      description: item.description,
      gameNumber: item.gameNumber
    });
  }

  return entries;
};

const parseStoredWins = (value: unknown): Record<string, number> | null => {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;

  const wins: Record<string, number> = {};
  for (const [name, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isFinite(count)) return null;
    wins[name] = count;
  }
  return wins;
};

type RestoredGameState = {
  players: Player[];
  gameLog: GameAction[];
  wins: Record<string, number>;
  currentGameNumber: number;
  activePlayerName: string;
  winner: string | null;
  playerOrder: string[];
};

const readStoredGameState = (): { state: RestoredGameState | null; preserveExisting: boolean } => {
  const savedGame = localStorage.getItem(GAME_STORAGE_KEY);
  if (!savedGame) {
    return { state: null, preserveExisting: false };
  }

  try {
    const parsed: unknown = JSON.parse(savedGame);
    if (!isRecord(parsed) || !Array.isArray(parsed.players) || parsed.players.length === 0) {
      return { state: null, preserveExisting: true };
    }
    if (!parsed.players.every(isStoredPlayer)) {
      return { state: null, preserveExisting: true };
    }

    const gameLog = parseStoredGameLog(parsed.gameLog);
    const wins = parseStoredWins(parsed.wins);
    if (gameLog === null || wins === null) {
      return { state: null, preserveExisting: true };
    }

    const currentGameNumber =
      parsed.currentGameNumber === undefined
        ? 1
        : parsed.currentGameNumber;

    if (typeof currentGameNumber !== 'number' || !Number.isFinite(currentGameNumber)) {
      return { state: null, preserveExisting: true };
    }

    const playerOrder = Array.isArray(parsed.playerOrder) && parsed.playerOrder.every(
      (name): name is string => typeof name === 'string'
    ) && parsed.playerOrder.length === parsed.players.length
      ? parsed.playerOrder
      : parsed.players.map((player) => player.name);

    const { activePlayerName, winner } = restoreTurnState(
      parsed.players,
      parsed.activePlayerName,
      parsed.winner
    );

    return {
      state: {
        players: parsed.players,
        gameLog,
        wins,
        currentGameNumber,
        activePlayerName,
        winner,
        playerOrder
      },
      preserveExisting: false
    };
  } catch (error) {
    console.error('Failed to restore Perfect 20 game from localStorage.', error);
    return { state: null, preserveExisting: true };
  }
};

const Perfect20Game = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState('');
  const [activePlayerName, setActivePlayerName] = useState('');
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [targetPlayer, setTargetPlayer] = useState('');
  const [actionType, setActionType] = useState<PanelActionType>('Add to Target');
  const [actionPoints, setActionPoints] = useState(1);
  const [gameLog, setGameLog] = useState<GameAction[]>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const [wins, setWins] = useState<Record<string, number>>({});
  const [showSetup, setShowSetup] = useState(true);
  const [showWinnerDialog, setShowWinnerDialog] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'txt'>('txt');
  const [currentGameNumber, setCurrentGameNumber] = useState(1);
  const skipPersistRef = useRef(false);

  // Load game state from localStorage
  useEffect(() => {
    const { state, preserveExisting } = readStoredGameState();
    if (preserveExisting) {
      skipPersistRef.current = true;
      return;
    }
    if (!state) return;

    setPlayers(state.players);
    setPlayerOrder(state.playerOrder);
    setActivePlayerName(state.activePlayerName);
    setCurrentPlayer(state.activePlayerName);
    setTargetPlayer(state.players.find((player) => player.name !== state.activePlayerName)?.name ?? '');
    setShowSetup(false);
    setGameLog(state.gameLog);
    setWins(state.wins);
    setCurrentGameNumber(state.currentGameNumber);
    setWinner(state.winner);
    setShowWinnerDialog(Boolean(state.winner));
  }, []);

  // Save game state to localStorage
  useEffect(() => {
    if (skipPersistRef.current) return;
    if (players.length > 0) {
      const gameState = {
        players,
        gameLog,
        wins,
        currentGameNumber,
        activePlayerName,
        winner,
        playerOrder
      };
      localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(gameState));
    }
  }, [players, gameLog, wins, currentGameNumber, activePlayerName, winner, playerOrder]);

  const handlePlayersSetup = (playerNames: string[]) => {
    skipPersistRef.current = false;
    const newPlayers = playerNames.map(name => ({ name, score: 0 }));
    setPlayers(newPlayers);
    setPlayerOrder(playerNames);
    setActivePlayerName(playerNames[0]);
    setCurrentPlayer(playerNames[0]);
    setTargetPlayer(playerNames[1] ?? '');
    setWinner(null);
    setActionPoints(1);
    setShowSetup(false);
    addLogEntry('Game started with players: ' + playerNames.join(', '));
  };

  const getSnapshot = (): GameSnapshot => ({
    players,
    playerOrder: playerOrder.length > 0 ? playerOrder : players.map((player) => player.name),
    activePlayerName,
    winner,
    gameNumber: currentGameNumber,
    gameLog
  });

  const commitAttempt = (attempt: Attempt) => {
    const result = applyAttempt(getSnapshot(), attempt);
    if (!result.ok) return;

    setPlayers(result.snapshot.players);
    setActivePlayerName(result.snapshot.activePlayerName);
    setCurrentPlayer(result.snapshot.activePlayerName);
    setWinner(result.snapshot.winner);
    setGameLog((prev) => [
      ...result.logDescriptions
        .map((description, index) => ({
          id: `${Date.now()}-${index}-${description}`,
          timestamp: new Date(),
          description,
          gameNumber: currentGameNumber
        }))
        .reverse(),
      ...prev
    ]);

    if (result.snapshot.winner) {
      setShowWinnerDialog(true);
      setWins((prev) => ({
        ...prev,
        [result.snapshot.winner as string]: (prev[result.snapshot.winner as string] || 0) + 1
      }));
    }
  };

  const addLogEntry = (description: string) => {
    const newAction: GameAction = {
      id: Date.now().toString(),
      timestamp: new Date(),
      description,
      gameNumber: currentGameNumber
    };
    setGameLog(prev => [newAction, ...prev]);
  };

  const canStealFrom = (stealerName: string, targetName: string) => {
    const stealer = players.find(p => p.name === stealerName);
    const target = players.find(p => p.name === targetName);
    return Boolean(stealer && target && stealer.score < target.score);
  };

  const applyAction = () => {
    commitAttempt({
      kind: 'panel',
      action: actionType,
      targetName: targetPlayer,
      points: actionPoints
    });
  };

  const quickAction = (playerName: string, action: 'add' | 'deduct', points: number = 1) => {
    commitAttempt({
      kind: 'scoreboard',
      action,
      targetName: playerName,
      points
    });
  };

  const generateDownload = () => {
    const currentDate = new Date().toLocaleDateString();
    const currentTime = new Date().toLocaleTimeString();
    
    let content = `Perfect 20 Game Log\nGenerated on: ${currentDate} at ${currentTime}\n\n`;
    
    content += 'WINS TRACKER:\n';
    content += '=================\n';
    players.forEach(player => {
      content += `${player.name}: ${wins[player.name] || 0} wins\n`;
    });
    
    content += '\nGAME LOG:\n';
    content += '==========\n';
    if (gameLog.length === 0) {
      content += 'No actions recorded yet.\n';
    } else {
      gameLog.slice().reverse().forEach((action, index) => {
        const time = action.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        content += `${index + 1}. [Game ${action.gameNumber}] [${time}] ${action.description}\n`;
      });
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perfect-20-game-log-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const startNewGame = () => {
    const next = startNewGameState(getSnapshot());
    setPlayers(next.players);
    setPlayerOrder(next.playerOrder);
    setActivePlayerName(next.activePlayerName);
    setCurrentPlayer(next.activePlayerName);
    setWinner(next.winner);
    setCurrentGameNumber(next.gameNumber);
    setGameLog(next.gameLog);
    setShowWinnerDialog(false);
    setActionPoints(1);
  };

  const resetEverything = () => {
    setPlayers([]);
    setPlayerOrder([]);
    setActivePlayerName('');
    setCurrentPlayer('');
    setGameLog([]);
    setWinner(null);
    setWins({});
    setShowSetup(true);
    setShowWinnerDialog(false);
    setActionPoints(1);
    setCurrentGameNumber(1);
    skipPersistRef.current = false;
    localStorage.removeItem(GAME_STORAGE_KEY);
  };

  const closeWinnerDialog = () => {
    setShowWinnerDialog(false);
  };

  if (showSetup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
        <PlayerSetupDialog 
          isOpen={showSetup} 
          onPlayersSetup={handlePlayersSetup}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-indigo-600 to-purple-700 rounded-full mb-4 shadow-lg">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Perfect 20</h1>
          <p className="text-slate-600 mb-2">First player to reach exactly 20 points wins!</p>
          <p className="text-lg font-semibold text-indigo-700 mb-4" aria-live="polite">
            {winner ? `${winner} has won this game.` : `${activePlayerName}'s turn`}
          </p>
          
          <div className="flex justify-center gap-4 flex-wrap">
            <Button 
              onClick={startNewGame}
              variant="outline"
              className="flex items-center gap-2 border-slate-300 hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              New Game
            </Button>
            
            <Button 
              onClick={generateDownload}
              variant="outline"
              className="flex items-center gap-2 border-slate-300 hover:bg-slate-50"
            >
              <Download className="w-4 h-4" />
              Download Log (.txt)
            </Button>
            
            <Button 
              onClick={resetEverything}
              variant="destructive"
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700"
            >
              <RefreshCw className="w-4 h-4" />
              Reset Everything
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Scoreboard 
              players={players} 
              onQuickAction={quickAction}
              gameEnded={!!winner}
              activePlayerName={activePlayerName}
            />
            <ActionPanel
              players={players}
              currentPlayer={activePlayerName}
              setCurrentPlayer={setCurrentPlayer}
              targetPlayer={targetPlayer}
              setTargetPlayer={setTargetPlayer}
              actionType={actionType}
              setActionType={setActionType}
              actionPoints={actionPoints}
              setActionPoints={setActionPoints}
              onApplyAction={applyAction}
              gameEnded={!!winner}
              canStealFrom={canStealFrom}
              actorName={activePlayerName}
            />
          </div>
          
          <div className="space-y-6">
            <GameLog gameLog={gameLog} />
            <WinsTracker 
              players={players.map(p => p.name)} 
              wins={wins} 
            />
          </div>
        </div>
      </div>

      <WinnerDialog 
        isOpen={showWinnerDialog}
        winner={winner || ''}
        onNewGame={startNewGame}
        onClose={closeWinnerDialog}
      />
    </div>
  );
};

export default Perfect20Game;
