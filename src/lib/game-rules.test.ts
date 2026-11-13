import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAttempt,
  canActOnTarget,
  clampScore,
  deriveWinner,
  nextActivePlayer,
  resolveActivePlayer,
  restoreTurnState,
  startNewGameState,
  type GameSnapshot,
  type Player
} from './game-rules.ts';

const players = (...pairs: [string, number][]): Player[] =>
  pairs.map(([name, score]) => ({ name, score }));

const snapshot = (overrides: Partial<GameSnapshot> = {}): GameSnapshot => {
  const list = overrides.players ?? players(['Ada', 0], ['Bo', 5], ['Cam', 3]);
  return {
    players: list,
    playerOrder: overrides.playerOrder ?? list.map((player) => player.name),
    activePlayerName: overrides.activePlayerName ?? list[0].name,
    winner: overrides.winner ?? null,
    gameNumber: overrides.gameNumber ?? 1,
    gameLog: overrides.gameLog ?? []
  };
};

test('initial active player is the first setup player', () => {
  assert.equal(resolveActivePlayer(['Ada', 'Bo', 'Cam']), 'Ada');
});

test('turn advances after a successful action', () => {
  const result = applyAttempt(snapshot(), {
    kind: 'panel',
    action: 'Add to Target',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.activePlayerName, 'Bo');
    assert.equal(findScore(result.snapshot.players, 'Bo'), 6);
  }
});

test('turn wraps after the last player', () => {
  assert.equal(nextActivePlayer(['Ada', 'Bo', 'Cam'], 'Cam'), 'Ada');
  const result = applyAttempt(snapshot({ activePlayerName: 'Cam' }), {
    kind: 'panel',
    action: 'Add to Target',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.activePlayerName, 'Ada');
  }
});

test('invalid action leaves scores and active turn unchanged', () => {
  const before = snapshot({ players: players(['Ada', 4], ['Bo', 2]) });
  const result = applyAttempt(before, {
    kind: 'panel',
    action: 'Add to Target',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.snapshot.players, before.players);
    assert.equal(result.snapshot.activePlayerName, 'Ada');
    assert.equal(result.snapshot.gameLog.length, 0);
  }
});

test('acting on an equal or lower-scoring target is rejected', () => {
  assert.equal(canActOnTarget(4, 4), false);
  assert.equal(canActOnTarget(5, 4), false);
  assert.equal(canActOnTarget(3, 4), true);

  const equal = applyAttempt(snapshot({ players: players(['Ada', 4], ['Bo', 4]) }), {
    kind: 'panel',
    action: 'Steal',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(equal.ok, false);

  const lower = applyAttempt(snapshot({ players: players(['Ada', 6], ['Bo', 4]) }), {
    kind: 'panel',
    action: 'Swap',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(lower.ok, false);
});

test('the eligibility rule applies to scoreboard plus and minus adjustments', () => {
  const plusEqual = applyAttempt(snapshot({ players: players(['Ada', 2], ['Bo', 2]) }), {
    kind: 'scoreboard',
    action: 'add',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(plusEqual.ok, false);

  const plusHigher = applyAttempt(snapshot({ players: players(['Ada', 2], ['Bo', 8]) }), {
    kind: 'scoreboard',
    action: 'add',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(plusHigher.ok, true);
  if (plusHigher.ok) {
    assert.equal(findScore(plusHigher.snapshot.players, 'Bo'), 9);
    assert.equal(plusHigher.snapshot.activePlayerName, 'Bo');
  }

  const minusLower = applyAttempt(snapshot({ players: players(['Ada', 2], ['Bo', 1]) }), {
    kind: 'scoreboard',
    action: 'deduct',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(minusLower.ok, false);
});

test('Deduct and Steal reject amounts greater than the target score', () => {
  const deduct = applyAttempt(snapshot({ players: players(['Ada', 1], ['Bo', 3]) }), {
    kind: 'panel',
    action: 'Deduct',
    targetName: 'Bo',
    points: 4
  });
  assert.equal(deduct.ok, false);

  const steal = applyAttempt(snapshot({ players: players(['Ada', 1], ['Bo', 3]) }), {
    kind: 'panel',
    action: 'Steal',
    targetName: 'Bo',
    points: 4
  });
  assert.equal(steal.ok, false);
});

test('result above 20 becomes 15', () => {
  assert.deepEqual(clampScore(21), { score: 15, overflowed: true });
  const result = applyAttempt(snapshot({ players: players(['Ada', 0], ['Bo', 19]) }), {
    kind: 'panel',
    action: 'Add to Target',
    targetName: 'Bo',
    points: 2
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Bo'), 15);
    assert.equal(result.snapshot.winner, null);
    assert.ok(result.logDescriptions.some((line) => line.includes('reset to 15')));
  }
});

test('result exactly 20 wins', () => {
  const result = applyAttempt(snapshot({ players: players(['Ada', 0], ['Bo', 19]) }), {
    kind: 'panel',
    action: 'Add to Target',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Bo'), 20);
    assert.equal(result.snapshot.winner, 'Bo');
    assert.equal(deriveWinner(result.snapshot.players), 'Bo');
    assert.ok(result.logDescriptions.some((line) => line.includes('wins Game 1')));
    assert.equal(result.snapshot.activePlayerName, 'Ada');
  }
});

test('a winner prevents further actions', () => {
  const ended = snapshot({
    players: players(['Ada', 20], ['Bo', 4]),
    winner: 'Ada'
  });
  const result = applyAttempt(ended, {
    kind: 'scoreboard',
    action: 'add',
    targetName: 'Bo',
    points: 1
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.snapshot.players, ended.players);
    assert.equal(result.snapshot.activePlayerName, 'Ada');
  }
});

test('new game resets turn and winner state', () => {
  const next = startNewGameState(
    snapshot({
      players: players(['Ada', 20], ['Bo', 7], ['Cam', 3]),
      activePlayerName: 'Cam',
      winner: 'Ada',
      gameNumber: 1
    })
  );
  assert.equal(next.winner, null);
  assert.equal(next.activePlayerName, 'Ada');
  assert.equal(next.gameNumber, 2);
  assert.deepEqual(
    next.players.map((player) => player.score),
    [0, 0, 0]
  );
});

test("new game clears an unfinished game's log but retains a completed game's log", () => {
  const unfinished = startNewGameState(
    snapshot({
      winner: null,
      gameNumber: 1,
      gameLog: [
        {
          id: '2',
          timestamp: new Date('2026-01-01T00:00:02Z'),
          description: 'Ada added 1 point to Bo.',
          gameNumber: 1
        },
        {
          id: '1',
          timestamp: new Date('2026-01-01T00:00:01Z'),
          description: 'Game started with players: Ada, Bo, Cam',
          gameNumber: 1
        }
      ]
    })
  );
  assert.equal(unfinished.gameNumber, 1);
  assert.equal(unfinished.gameLog.length, 1);
  assert.equal(unfinished.gameLog[0].description, 'New game started. All scores reset to 0.');
  assert.equal(unfinished.gameLog[0].gameNumber, 1);

  const completedLog = [
    {
      id: 'win',
      timestamp: new Date('2026-01-01T00:00:03Z'),
      description: 'Bo wins Game 1.',
      gameNumber: 1
    },
    {
      id: 'start',
      timestamp: new Date('2026-01-01T00:00:01Z'),
      description: 'Game started with players: Ada, Bo, Cam',
      gameNumber: 1
    }
  ];
  const completed = startNewGameState(
    snapshot({
      winner: 'Bo',
      gameNumber: 1,
      gameLog: completedLog
    })
  );
  assert.equal(completed.gameNumber, 2);
  assert.equal(completed.gameLog.length, 3);
  assert.equal(completed.gameLog[0].gameNumber, 2);
  assert.ok(completed.gameLog.some((entry) => entry.description === 'Bo wins Game 1.'));
});

test('self-add is legal when all players have zero points', () => {
  const result = applyAttempt(
    snapshot({ players: players(['Ada', 0], ['Bo', 0], ['Cam', 0]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Ada', points: 1 }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Ada'), 1);
  }

  const panel = applyAttempt(
    snapshot({ players: players(['Ada', 0], ['Bo', 0], ['Cam', 0]) }),
    { kind: 'panel', action: 'Add to Target', targetName: 'Ada', points: 1 }
  );
  assert.equal(panel.ok, true);
});

test('self-add is legal when the active player is currently leading', () => {
  const result = applyAttempt(
    snapshot({ players: players(['Ada', 9], ['Bo', 4], ['Cam', 2]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Ada', points: 1 }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Ada'), 10);
  }
});

test('successful self-add advances the turn', () => {
  const result = applyAttempt(
    snapshot({ players: players(['Ada', 0], ['Bo', 0], ['Cam', 0]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Ada', points: 1 }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.snapshot.activePlayerName, 'Bo');
  }
});

test('self-add reaching exactly 20 wins', () => {
  const result = applyAttempt(
    snapshot({ players: players(['Ada', 19], ['Bo', 4]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Ada', points: 1 }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Ada'), 20);
    assert.equal(result.snapshot.winner, 'Ada');
  }
});

test('self-add exceeding 20 results in 15', () => {
  const result = applyAttempt(
    snapshot({ players: players(['Ada', 19], ['Bo', 4]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Ada', points: 2 }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(findScore(result.snapshot.players, 'Ada'), 15);
    assert.equal(result.snapshot.winner, null);
    assert.equal(result.snapshot.activePlayerName, 'Bo');
  }
});

test('self-deduct remains rejected', () => {
  const scoreboard = applyAttempt(
    snapshot({ players: players(['Ada', 5], ['Bo', 2]) }),
    { kind: 'scoreboard', action: 'deduct', targetName: 'Ada', points: 1 }
  );
  assert.equal(scoreboard.ok, false);
  if (!scoreboard.ok) {
    assert.equal(findScore(scoreboard.snapshot.players, 'Ada'), 5);
    assert.equal(scoreboard.snapshot.activePlayerName, 'Ada');
  }

  const panel = applyAttempt(
    snapshot({ players: players(['Ada', 5], ['Bo', 2]) }),
    { kind: 'panel', action: 'Deduct', targetName: 'Ada', points: 1 }
  );
  assert.equal(panel.ok, false);
});

test('adding to another player still requires a strictly higher target score', () => {
  const equal = applyAttempt(
    snapshot({ players: players(['Ada', 3], ['Bo', 3]) }),
    { kind: 'scoreboard', action: 'add', targetName: 'Bo', points: 1 }
  );
  assert.equal(equal.ok, false);

  const lower = applyAttempt(
    snapshot({ players: players(['Ada', 5], ['Bo', 3]) }),
    { kind: 'panel', action: 'Add to Target', targetName: 'Bo', points: 1 }
  );
  assert.equal(lower.ok, false);

  const higher = applyAttempt(
    snapshot({ players: players(['Ada', 3], ['Bo', 5]) }),
    { kind: 'panel', action: 'Add to Target', targetName: 'Bo', points: 1 }
  );
  assert.equal(higher.ok, true);
});

test('restored game state has a valid active player', () => {
  const names = ['Ada', 'Bo', 'Cam'];
  assert.equal(resolveActivePlayer(names, 'Bo'), 'Bo');
  assert.equal(resolveActivePlayer(names, 'Zoe'), 'Ada');
  assert.equal(restoreTurnState(players(['Ada', 1], ['Bo', 4]), 'Bo', null).activePlayerName, 'Bo');
  assert.equal(restoreTurnState(players(['Ada', 20], ['Bo', 4]), 'missing', null).winner, 'Ada');
  assert.equal(restoreTurnState(players(['Ada', 20], ['Bo', 4]), 'Bo', 'Ada').activePlayerName, 'Bo');
});

function findScore(list: Player[], name: string): number {
  const player = list.find((item) => item.name === name);
  assert.ok(player);
  return player.score;
}
