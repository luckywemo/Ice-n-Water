// Persistent meta: stats + last-picked difficulty in localStorage.

export type Difficulty = 'easy' | 'normal' | 'hard';
// 'floating' — joystick appears where the thumb lands; 'sticky' — fixed spot
export type JoyMode = 'floating' | 'sticky';
// bean composite rate — the live WebGL+fur bean is the heavy per-frame cost,
// so this is the real perf lever (the engine itself is vsync-locked anyway)
export type PerfMode = 'low' | 'balanced' | 'high';
export const PERF_MS: Record<PerfMode, number> = { low: 66, balanced: 33, high: 16 };
export const PERF_ORDER: PerfMode[] = ['low', 'balanced', 'high'];
export const PERF_LABEL: Record<PerfMode, string> = { low: '15 FPS', balanced: '30 FPS', high: '60 FPS' };
// 3D playground camera rig — the view sets the base offset/fov, Range is a
// 70–160% distance stepper layered on top
export type CamView = 'third' | 'classic' | 'wide';
export const CAM_ORDER: CamView[] = ['third', 'classic', 'wide'];
export const CAM_LABEL: Record<CamView, string> = {
  third: '3RD PERSON',
  classic: 'CLASSIC',
  wide: 'WIDE',
};
// the FPS pick also carries the coat preset — low is trimmed+thin+cheap,
// high is shaggy+plush+pricier. Balanced values are the reference look.
export interface FurQuality {
  fluff: number; // strand length scale
  mess: number; // angle + curve jitter amplitude
  density: number; // sampling density (1 ≈ one strand per 3px)
}
export const FUR_Q: Record<PerfMode, FurQuality> = {
  low: { fluff: 0.7, mess: 0.22, density: 0.7 },
  balanced: { fluff: 0.85, mess: 0.3, density: 1.0 },
  high: { fluff: 1.0, mess: 0.4, density: 1.6 },
};

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

export function loadPicks(): {
  difficulty: Difficulty;
  joy: JoyMode;
  perf: PerfMode;
  hints: boolean;
  camView: CamView;
  camRange: number;
} {
  try {
    const raw = localStorage.getItem(PICKS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        difficulty: ['easy', 'normal', 'hard'].includes(p.difficulty) ? p.difficulty : 'normal',
        joy: p.joy === 'sticky' ? 'sticky' : 'floating',
        perf: PERF_ORDER.includes(p.perf) ? p.perf : 'balanced',
        hints: p.hints !== false, // on by default — the settings toggle writes false
        camView: CAM_ORDER.includes(p.camView) ? p.camView : 'classic',
        camRange:
          typeof p.camRange === 'number'
            ? Math.min(160, Math.max(70, Math.round(p.camRange)))
            : 100,
      };
    }
  } catch {
    /* fall through */
  }
  return { difficulty: 'normal', joy: 'floating', perf: 'balanced', hints: true, camView: 'classic', camRange: 100 };
}

export function savePicks(
  difficulty: Difficulty,
  joy: JoyMode = 'floating',
  perf: PerfMode = 'balanced',
  hints = true,
  camView: CamView = 'classic',
  camRange = 100,
) {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify({ difficulty, joy, perf, hints, camView, camRange }));
  } catch {
    /* fine */
  }
}

/** ms between bean composites — read once per scene, not per frame */
export function perfInterval(): number {
  return PERF_MS[loadPicks().perf];
}

/** the coat preset riding on the Bean FPS pick */
export function furQuality(): FurQuality {
  return FUR_Q[loadPicks().perf];
}
