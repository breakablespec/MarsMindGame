// Persistence: one versioned JSON blob in localStorage (wrapped in try/catch — storage may be unavailable).

import type { ColonyState } from './state';
import { syncExplored } from './world';
import { bumpGrid } from './grid';

export const SAVE_KEY = 'aicolony.save.v1';
export function saveGame(st: ColonyState) {
  if (st.demo) return;
  try { syncExplored(st); st.lastSavedAt = Date.now(); localStorage.setItem(SAVE_KEY, JSON.stringify(st)); } catch { /* storage unavailable */ }
}
export function loadGame(): ColonyState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw) as ColonyState;
    if (st.version !== 1 || !Array.isArray(st.modules)) return null;
    bumpGrid();
    return st;
  } catch { return null; }
}
export function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }
