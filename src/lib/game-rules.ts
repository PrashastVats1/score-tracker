export interface Player {
  name: string;
  score: number;
}

export interface GameAction {
  id: string;
  timestamp: Date;
  description: string;
  gameNumber: number;
}

export type PanelActionType = 'Add to Target' | 'Deduct' | 'Swap' | 'Steal';
export type ScoreboardAdjustType = 'add' | 'deduct';

export type GameSnapshot = {
  players: Player[];
  playerOrder: string[];
  activePlayerName: string;
  winner: string | null;
  gameNumber: number;
  gameLog: GameAction[];
};

export type Attempt =
  | {
      kind: 'panel';
      action: PanelActionType;
      targetName: string;
      points: number;
    }
  | {
      kind: 'scoreboard';
      action: ScoreboardAdjustType;
      targetName: string;
      points: number;
    };

export type AttemptResult =
  | { ok: false; reason: string; snapshot: GameSnapshot }
  | { ok: true; snapshot: GameSnapshot; logDescriptions: string[] };

const pointWord = (points: number) => (points === 1 ? 'point' : 'points');

export const clampScore = (score: number): { score: number; overflowed: boolean } => {
  if (score > 20) return { score: 15, overflowed: true };
  return { score: Math.max(0, score), overflowed: false };
};

export const canActOnTarget = (actorScore: number, targetScore: number): boolean =>
  actorScore < targetScore;

export const isSelfAdd = (actorName: string, targetName: string, isAdd: boolean): boolean =>
  isAdd && actorName === targetName;

export const nextActivePlayer = (playerOrder: string[], activePlayerName: string): string => {
  if (playerOrder.length === 0) return '';
  const index = playerOrder.indexOf(activePlayerName);
  if (index === -1) return playerOrder[0];
  return playerOrder[(index + 1) % playerOrder.length];
};

export const resolveActivePlayer = (
  playerOrder: string[],
  storedActivePlayerName?: string | null
): string => {
  if (storedActivePlayerName && playerOrder.includes(storedActivePlayerName)) {
    return storedActivePlayerName;
  }
  return playerOrder[0] ?? '';
};

export const deriveWinner = (players: Player[]): string | null => {
  const winner = players.find((player) => player.score >= 20);
  return winner ? winner.name : null;
};

export const findPlayer = (players: Player[], name: string): Player | undefined =>
  players.find((player) => player.name === name);

const setPlayerScore = (players: Player[], name: string, score: number): Player[] =>
  players.map((player) => (player.name === name ? { ...player, score } : player));

export const isLegalTarget = (
  actor: Player,
  target: Player,
  options?: { requireEnoughPoints?: boolean; points?: number; isAdd?: boolean }
): boolean => {
  if (isSelfAdd(actor.name, target.name, Boolean(options?.isAdd))) {
    return true;
  }
  if (actor.name === target.name) return false;
  if (!canActOnTarget(actor.score, target.score)) return false;
  if (options?.requireEnoughPoints) {
    return target.score >= (options.points ?? 0);
  }
  return true;
};

const reject = (snapshot: GameSnapshot, reason: string): AttemptResult => ({
  ok: false,
  reason,
  snapshot
});

export const applyAttempt = (snapshot: GameSnapshot, attempt: Attempt): AttemptResult => {
  if (snapshot.winner) {
    return reject(snapshot, 'The game is over.');
  }

  const actor = findPlayer(snapshot.players, snapshot.activePlayerName);
  if (!actor) {
    return reject(snapshot, 'There is no active player.');
  }

  const target = findPlayer(snapshot.players, attempt.targetName);
  if (!target) {
    return reject(snapshot, 'That target is not in this game.');
  }

  const isAdd =
    attempt.kind === 'scoreboard'
      ? attempt.action === 'add'
      : attempt.action === 'Add to Target';

  if (attempt.kind === 'panel' && actor.name === target.name && !isAdd) {
    return reject(snapshot, 'Choose a different target than the active player.');
  }

  const needsEnoughPoints =
    attempt.kind === 'scoreboard'
      ? attempt.action === 'deduct'
      : attempt.action === 'Deduct' || attempt.action === 'Steal';

  if (!isLegalTarget(actor, target, {
    requireEnoughPoints: needsEnoughPoints,
    isAdd,
    points: attempt.kind === 'panel' && attempt.action === 'Swap' ? undefined : attempt.points
  })) {
    if (actor.name === target.name) {
      return reject(snapshot, `${actor.name} cannot deduct from themselves.`);
    }
    if (!canActOnTarget(actor.score, target.score)) {
      return reject(
        snapshot,
        `${actor.name} cannot act on ${target.name} (your score must be lower than the target).`
      );
    }
    return reject(
      snapshot,
      `${target.name} doesn't have enough points for that action.`
    );
  }

  let players = snapshot.players.map((player) => ({ ...player }));
  const logDescriptions: string[] = [];

  const applyClampedScore = (name: string, rawScore: number) => {
    const { score, overflowed } = clampScore(rawScore);
    players = setPlayerScore(players, name, score);
    if (overflowed) {
      logDescriptions.push(`${name}'s score went above 20 and was reset to 15.`);
    }
  };

  if (attempt.kind === 'scoreboard') {
    if (attempt.action === 'add') {
      applyClampedScore(target.name, target.score + attempt.points);
      logDescriptions.push(
        `${actor.name} added ${attempt.points} ${pointWord(attempt.points)} to ${target.name}.`
      );
    } else {
      applyClampedScore(target.name, target.score - attempt.points);
      logDescriptions.push(
        `${actor.name} deducted ${attempt.points} ${pointWord(attempt.points)} from ${target.name}.`
      );
    }
  } else {
    switch (attempt.action) {
      case 'Add to Target':
        applyClampedScore(target.name, target.score + attempt.points);
        logDescriptions.push(
          `${actor.name} added ${attempt.points} ${pointWord(attempt.points)} to ${target.name}.`
        );
        break;
      case 'Deduct':
        applyClampedScore(target.name, target.score - attempt.points);
        logDescriptions.push(
          `${actor.name} deducted ${attempt.points} ${pointWord(attempt.points)} from ${target.name}.`
        );
        break;
      case 'Swap':
        applyClampedScore(actor.name, target.score);
        applyClampedScore(target.name, actor.score);
        logDescriptions.push(`${actor.name} swapped scores with ${target.name}.`);
        break;
      case 'Steal':
        applyClampedScore(actor.name, actor.score + attempt.points);
        applyClampedScore(target.name, target.score - attempt.points);
        logDescriptions.push(
          `${actor.name} stole ${attempt.points} ${pointWord(attempt.points)} from ${target.name}.`
        );
        break;
    }
  }

  const winner = deriveWinner(players);
  if (winner) {
    logDescriptions.push(`${winner} wins Game ${snapshot.gameNumber}.`);
  }

  return {
    ok: true,
    logDescriptions,
    snapshot: {
      ...snapshot,
      players,
      winner,
      activePlayerName: winner
        ? snapshot.activePlayerName
        : nextActivePlayer(snapshot.playerOrder, snapshot.activePlayerName)
    }
  };
};

export const startNewGameState = (snapshot: GameSnapshot, now: Date = new Date()): GameSnapshot => {
  const nextGameNumber = snapshot.winner ? snapshot.gameNumber + 1 : snapshot.gameNumber;
  const retainedLog = snapshot.winner
    ? snapshot.gameLog
    : snapshot.gameLog.filter((entry) => entry.gameNumber !== snapshot.gameNumber);

  const newGameEntry: GameAction = {
    id: now.getTime().toString(),
    timestamp: now,
    description: 'New game started. All scores reset to 0.',
    gameNumber: nextGameNumber
  };

  return {
    players: snapshot.players.map((player) => ({ ...player, score: 0 })),
    playerOrder: snapshot.playerOrder,
    activePlayerName: snapshot.playerOrder[0] ?? '',
    winner: null,
    gameNumber: nextGameNumber,
    gameLog: [newGameEntry, ...retainedLog]
  };
};

export const restoreTurnState = (
  players: Player[],
  storedActivePlayerName?: unknown,
  storedWinner?: unknown
): { activePlayerName: string; winner: string | null } => {
  const playerOrder = players.map((player) => player.name);
  const activePlayerName =
    typeof storedActivePlayerName === 'string'
      ? resolveActivePlayer(playerOrder, storedActivePlayerName)
      : resolveActivePlayer(playerOrder);

  let winner: string | null = null;
  if (typeof storedWinner === 'string' && playerOrder.includes(storedWinner)) {
    winner = storedWinner;
  } else {
    winner = deriveWinner(players);
  }

  return { activePlayerName, winner };
};
