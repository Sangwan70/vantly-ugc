// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import {
  Block,
  BlockPatch,
  BlockType,
  BuilderState,
  Row,
  makeButtonBlock,
  makeDividerBlock,
  makeImageBlock,
  makeQuoteBlock,
  makeRawBlock,
  makeRow,
  makeSocialIconsBlock,
  makeSpacerBlock,
  makeStatsBlock,
  makeTextBlock,
  newId,
} from './types';
import { ThemePreset } from './themes';

/** All state mutations here are pure -- take a BuilderState, return a new
 * one -- since the state (rows/columns/blocks) is plain JSON with no
 * functions/dates/etc., a deep clone via JSON round-trip is simple and
 * safe, and this builder's data is small enough that it's not a
 * performance concern. */
function clone(state: BuilderState): BuilderState {
  return JSON.parse(JSON.stringify(state));
}

function newBlock(type: BlockType): Block {
  switch (type) {
    case 'text':
      return makeTextBlock();
    case 'image':
      return makeImageBlock();
    case 'button':
      return makeButtonBlock();
    case 'divider':
      return makeDividerBlock();
    case 'spacer':
      return makeSpacerBlock();
    case 'quote':
      return makeQuoteBlock();
    case 'social':
      return makeSocialIconsBlock();
    case 'stats':
      return makeStatsBlock();
    case 'raw':
      return makeRawBlock('');
  }
}

export function addRow(state: BuilderState, columnCount: 1 | 2 | 3, atIndex?: number): { state: BuilderState; rowId: string } {
  const next = clone(state);
  const row = makeRow(columnCount);
  const index = atIndex ?? next.rows.length;
  next.rows.splice(index, 0, row);
  return { state: next, rowId: row.id };
}

export function deleteRow(state: BuilderState, rowId: string): BuilderState {
  const next = clone(state);
  next.rows = next.rows.filter((r) => r.id !== rowId);
  return next;
}

export function duplicateRow(state: BuilderState, rowId: string): BuilderState {
  const next = clone(state);
  const idx = next.rows.findIndex((r) => r.id === rowId);
  if (idx === -1) return next;
  const copy: Row = JSON.parse(JSON.stringify(next.rows[idx]));
  copy.id = newId();
  copy.columns = copy.columns.map((col) => ({
    ...col,
    id: newId(),
    blocks: col.blocks.map((b) => ({ ...b, id: newId() })),
  }));
  next.rows.splice(idx + 1, 0, copy);
  return next;
}

export function moveRow(state: BuilderState, rowId: string, targetIndex: number): BuilderState {
  const next = clone(state);
  const fromIndex = next.rows.findIndex((r) => r.id === rowId);
  if (fromIndex === -1) return next;
  const [row] = next.rows.splice(fromIndex, 1);
  const clampedIndex = Math.max(0, Math.min(targetIndex, next.rows.length));
  next.rows.splice(clampedIndex, 0, row);
  return next;
}

export function updateRow(state: BuilderState, rowId: string, patch: Partial<Row>): BuilderState {
  const next = clone(state);
  const row = next.rows.find((r) => r.id === rowId);
  if (row) Object.assign(row, patch);
  return next;
}

const COLUMN_SPLITS: Record<1 | 2 | 3, number[]> = {
  1: [100],
  2: [50, 50],
  3: [33.34, 33.33, 33.33],
};

/** Changing a row's column count redistributes existing blocks rather
 * than discarding them: growing keeps all blocks in column 1 and adds
 * empty columns; shrinking merges the blocks of the columns being
 * removed onto the end of the last remaining column. Nothing an admin
 * has already placed is ever silently dropped. */
export function setRowColumnCount(state: BuilderState, rowId: string, count: 1 | 2 | 3): BuilderState {
  const next = clone(state);
  const row = next.rows.find((r) => r.id === rowId);
  if (!row) return next;
  const allBlocks = row.columns.flatMap((c) => c.blocks);
  const widths = COLUMN_SPLITS[count];
  const newColumns = widths.map((w, i) => ({
    id: row.columns[i]?.id || newId(),
    widthPercent: w,
    blocks: i === 0 ? allBlocks : [],
  }));
  row.columns = newColumns;
  return next;
}

const MIN_COLUMN_WIDTH_PERCENT = 10;

/** Sets every column's width in one row explicitly (e.g. from the
 * Inspector's per-column % inputs, or a preset like "30/70"). Values are
 * clamped to a 10-90% range each. Does NOT force the total to exactly
 * 100 -- a slightly-off total still renders fine (flex-basis just scales
 * proportionally), so a typed 48/48 while adjusting isn't rejected
 * mid-edit. */
export function setColumnWidths(state: BuilderState, rowId: string, widths: number[]): BuilderState {
  const next = clone(state);
  const row = next.rows.find((r) => r.id === rowId);
  if (!row) return next;
  row.columns.forEach((col, i) => {
    if (widths[i] == null || Number.isNaN(widths[i])) return;
    col.widthPercent = Math.min(90, Math.max(MIN_COLUMN_WIDTH_PERCENT, widths[i]));
  });
  return next;
}

/** Drag-resize the boundary between two adjacent columns: only the pair
 * of columns flanking the dragged handle change width, transferring
 * percentage points between them so their combined width stays constant
 * -- other columns in a 3-column row are untouched. `leftWidthPercent`
 * is the new width for `leftColumnId`; the right column absorbs
 * whatever's left of the pair's original combined width. */
export function resizeColumnPair(
  state: BuilderState,
  rowId: string,
  leftColumnId: string,
  rightColumnId: string,
  leftWidthPercent: number,
): BuilderState {
  const next = clone(state);
  const row = next.rows.find((r) => r.id === rowId);
  if (!row) return next;
  const left = row.columns.find((c) => c.id === leftColumnId);
  const right = row.columns.find((c) => c.id === rightColumnId);
  if (!left || !right) return next;
  const combined = left.widthPercent + right.widthPercent;
  const clampedLeft = Math.min(
    combined - MIN_COLUMN_WIDTH_PERCENT,
    Math.max(MIN_COLUMN_WIDTH_PERCENT, leftWidthPercent),
  );
  left.widthPercent = clampedLeft;
  right.widthPercent = combined - clampedLeft;
  return next;
}

/** Rewrites every block's *accent* color(s) to the given theme -- see
 * themes.ts's doc comment for exactly what is and isn't touched. Applies
 * across the whole page in one action rather than requiring a
 * block-by-block color-picker pass. */
export function applyTheme(state: BuilderState, theme: ThemePreset): BuilderState {
  const next = clone(state);
  for (const row of next.rows) {
    for (const col of row.columns) {
      for (const block of col.blocks) {
        switch (block.type) {
          case 'button':
            block.bgColor = theme.accent;
            block.textColor = theme.onAccent;
            break;
          case 'divider':
            block.color = theme.divider;
            break;
          case 'quote':
            block.accentColor = theme.accent;
            break;
          case 'social':
            block.badgeColor = theme.accent;
            break;
          case 'stats':
            block.accentColor = theme.accent;
            break;
          default:
            break;
        }
      }
    }
  }
  return next;
}

export function findBlockLocation(
  state: BuilderState,
  blockId: string,
): { rowIndex: number; colIndex: number; blockIndex: number } | null {
  for (let rowIndex = 0; rowIndex < state.rows.length; rowIndex++) {
    const cols = state.rows[rowIndex].columns;
    for (let colIndex = 0; colIndex < cols.length; colIndex++) {
      const blockIndex = cols[colIndex].blocks.findIndex((b) => b.id === blockId);
      if (blockIndex !== -1) return { rowIndex, colIndex, blockIndex };
    }
  }
  return null;
}

export function addBlockToColumn(
  state: BuilderState,
  columnId: string,
  type: BlockType,
): { state: BuilderState; blockId: string } {
  const next = clone(state);
  for (const row of next.rows) {
    const col = row.columns.find((c) => c.id === columnId);
    if (col) {
      const block = newBlock(type);
      col.blocks.push(block);
      return { state: next, blockId: block.id };
    }
  }
  return { state: next, blockId: '' };
}

/** Deep-clones a block and mints fresh ids for it -- including nested
 * per-item ids (SocialIconsBlock's links, StatsBlock's items) -- so
 * inserting the same saved block twice never produces id collisions. */
function cloneBlockWithFreshIds(block: Block): Block {
  const copy: Block = JSON.parse(JSON.stringify(block));
  if (copy.type === 'social') {
    copy.links = copy.links.map((l) => ({ ...l, id: newId() }));
  } else if (copy.type === 'stats') {
    copy.items = copy.items.map((i) => ({ ...i, id: newId() }));
  }
  copy.id = newId();
  return copy;
}

/** Inserts a specific block (e.g. one loaded from the "Saved Blocks"
 * localStorage list) into a column, rather than creating a brand new
 * default-valued block from a `BlockType` like `addBlockToColumn` does. */
export function addExistingBlockToColumn(
  state: BuilderState,
  columnId: string,
  block: Block,
): { state: BuilderState; blockId: string } {
  const next = clone(state);
  const fresh = cloneBlockWithFreshIds(block);
  for (const row of next.rows) {
    const col = row.columns.find((c) => c.id === columnId);
    if (col) {
      col.blocks.push(fresh);
      return { state: next, blockId: fresh.id };
    }
  }
  return { state: next, blockId: '' };
}

export function updateBlock(state: BuilderState, blockId: string, patch: BlockPatch): BuilderState {
  const next = clone(state);
  for (const row of next.rows) {
    for (const col of row.columns) {
      const block = col.blocks.find((b) => b.id === blockId);
      if (block) {
        Object.assign(block, patch);
        return next;
      }
    }
  }
  return next;
}

export function deleteBlock(state: BuilderState, blockId: string): BuilderState {
  const next = clone(state);
  for (const row of next.rows) {
    for (const col of row.columns) {
      const idx = col.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) {
        col.blocks.splice(idx, 1);
        return next;
      }
    }
  }
  return next;
}

export function duplicateBlock(state: BuilderState, blockId: string): { state: BuilderState; blockId: string } {
  const next = clone(state);
  for (const row of next.rows) {
    for (const col of row.columns) {
      const idx = col.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) {
        const copy = { ...col.blocks[idx], id: newId() };
        col.blocks.splice(idx + 1, 0, copy);
        return { state: next, blockId: copy.id };
      }
    }
  }
  return { state: next, blockId: '' };
}

/** Moves a block (by id) to `targetColumnId` at `targetIndex`, removing
 * it from wherever it currently lives first -- covers both "reorder
 * within the same column" and "drag into a different column" with one
 * function. */
export function moveBlock(
  state: BuilderState,
  blockId: string,
  targetColumnId: string,
  targetIndex: number,
): BuilderState {
  const next = clone(state);
  let moving: Block | null = null;
  for (const row of next.rows) {
    for (const col of row.columns) {
      const idx = col.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) {
        [moving] = col.blocks.splice(idx, 1);
      }
    }
  }
  if (!moving) return next;
  for (const row of next.rows) {
    const col = row.columns.find((c) => c.id === targetColumnId);
    if (col) {
      const clampedIndex = Math.max(0, Math.min(targetIndex, col.blocks.length));
      col.blocks.splice(clampedIndex, 0, moving);
      return next;
    }
  }
  return next;
}
