// localStorage wrapper around the sim's save format. Every call tolerates storage being blocked or full.
import type { GameState } from './sim';
import type { Quality } from './post';
import { deserialize, serialize } from './sim/save';

const KEY = 'browser-rpg.save';
const HELP_KEY = 'browser-rpg.help-seen';
const QUALITY_KEY = 'browser-rpg.quality';

export type LoadResult = { state: GameState | null; status: 'none' | 'loaded' | 'incompatible' };

export function loadGame(): LoadResult {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* storage blocked: new game */ }
  if (raw === null) return { state: null, status: 'none' };
  const state = deserialize(raw);
  return state ? { state, status: 'loaded' } : { state: null, status: 'incompatible' };
}

export function saveGame(s: GameState): boolean {
  try { localStorage.setItem(KEY, serialize(s)); return true; } catch { return false; }
}

export function wipeSave() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(HELP_KEY); } catch { /* nothing to wipe */ }
}

export const helpSeen = () => { try { return localStorage.getItem(HELP_KEY) !== null; } catch { return true; } };
export const markHelpSeen = () => { try { localStorage.setItem(HELP_KEY, '1'); } catch { /* ignore */ } };

export const loadQuality = (): Quality => { try { return localStorage.getItem(QUALITY_KEY) === 'low' ? 'low' : 'high'; } catch { return 'high'; } };
export const saveQuality = (q: Quality) => { try { localStorage.setItem(QUALITY_KEY, q); } catch { /* ignore */ } };
