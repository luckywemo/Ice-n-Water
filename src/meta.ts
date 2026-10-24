// Persistent meta: stats + last-picked difficulty in localStorage.

export type Difficulty = 'easy' | 'normal' | 'hard';
// 'floating' — joystick appears where the thumb lands; 'sticky' — fixed spot
export type JoyMode = 'floating' | 'sticky';

export interface DiffPreset {
  label: string;
  chaserMult: number; // militia speed multiplier
  seconds: number; // round length
  aiRunners: number; // crew size (fewer mates = harder)
  reinforceAt: number; // fraction of time left when backup arrives
}

export const DIFFS: Record<Difficulty, DiffPreset> = {
  easy: { label: 'EASY', chaserMult: 0.9, seconds: 75, aiRunners: 5, reinforceAt: 0.4 },
  normal: { label: 'NORMAL', chaserMult: 1, seconds: 90, aiRunners: 4, reinforceAt: 0.5 },
  hard: { label: 'HARD', chaserMult: 1.1, seconds: 105, aiRunners: 3, reinforceAt: 0.55 },
};

export interface Stats {
  games: number;
  wins: number;
  streak: number;
  bestStreak: number;
  bestSurvived: number; // seconds
}

const STATS_KEY = 'icenwater_stats';
const PICKS_KEY = 'icenwater_picks';

export function loadStats(): Stats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return { games: 0, wins: 0, streak: 0, bestStreak: 0, bestSurvived: 0, ...JSON.parse(raw) };
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return { games: 0, wins: 0, streak: 0, bestStreak: 0, bestSurvived: 0 };
}

export function recordResult(win: boolean, survivedSec: number): Stats {
  const s = loadStats();
  s.games++;
  s.bestSurvived = Math.max(s.bestSurvived, survivedSec);
  if (win) {
    s.wins++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  } else {
    s.streak = 0;
  }
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* storage full/blocked — stats are nice-to-have */
  }
  return s;
}

export function loadPicks(): { difficulty: Difficulty; joy: JoyMode } {
  try {
    const raw = localStorage.getItem(PICKS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        difficulty: ['easy', 'normal', 'hard'].includes(p.difficulty) ? p.difficulty : 'normal',
        joy: p.joy === 'sticky' ? 'sticky' : 'floating',
      };
    }
  } catch {
    /* fall through */
  }
  return { difficulty: 'normal', joy: 'floating' };
}

export function savePicks(difficulty: Difficulty, joy: JoyMode = 'floating') {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify({ difficulty, joy }));
  } catch {
    /* fine */
  }
}
