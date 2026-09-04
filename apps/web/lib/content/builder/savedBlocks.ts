// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { Block } from './types';

/**
 * "Save as reusable block" -- lets an admin save a block they've styled
 * (a Button with the exact brand color, a Quote with the house layout,
 * etc.) and re-insert it into any other page later without redoing the
 * styling. Deliberately kept out of the backend entirely: this is
 * per-browser, localStorage-only, same tradeoff as any other "just
 * remember my preference" UI setting -- no server round-trip, no schema
 * change, and it's fine if it doesn't follow the admin to a different
 * machine.
 */

export interface SavedBlock {
  id: string;
  name: string;
  block: Block;
  createdAt: string;
}

const STORAGE_KEY = 'content-builder:saved-blocks';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getSavedBlocks(): SavedBlock[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    // Corrupted/foreign localStorage value -- treat as empty rather than
    // throwing and breaking the whole builder over a saved-blocks glitch.
    return [];
  }
}

function persist(blocks: SavedBlock[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
}

export function saveBlockToStorage(name: string, block: Block): SavedBlock[] {
  const entry: SavedBlock = {
    id: `saved${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Untitled block',
    block: JSON.parse(JSON.stringify(block)),
    createdAt: new Date().toISOString(),
  };
  const next = [...getSavedBlocks(), entry];
  persist(next);
  return next;
}

export function deleteSavedBlockFromStorage(id: string): SavedBlock[] {
  const next = getSavedBlocks().filter((b) => b.id !== id);
  persist(next);
  return next;
}
