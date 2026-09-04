// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { useMemo } from 'react';
import { Block, BlockPatch, BlockType, BuilderState, Row, Selection } from './types';
import { ThemePreset } from './themes';
import * as m from './mutations';

export interface BuilderActions {
  addRow: (columnCount: 1 | 2 | 3) => void;
  deleteRow: (rowId: string) => void;
  duplicateRow: (rowId: string) => void;
  moveRow: (rowId: string, targetIndex: number) => void;
  updateRow: (rowId: string, patch: Partial<Row>) => void;
  setRowColumnCount: (rowId: string, count: 1 | 2 | 3) => void;
  setColumnWidths: (rowId: string, widths: number[]) => void;
  resizeColumnPair: (
    rowId: string,
    leftColumnId: string,
    rightColumnId: string,
    leftWidthPercent: number,
  ) => void;
  addBlock: (columnId: string, type: BlockType) => void;
  updateBlock: (blockId: string, patch: BlockPatch) => void;
  deleteBlock: (blockId: string) => void;
  duplicateBlock: (blockId: string) => void;
  moveBlock: (blockId: string, targetColumnId: string, targetIndex: number) => void;
  applyTheme: (theme: ThemePreset) => void;
  addSavedBlock: (columnId: string, block: Block) => void;
}

/** Wires the pure functions in mutations.ts up to React state, adding the
 * "select whatever was just created" UX touch each add/duplicate action
 * needs -- a brand new row/block with nothing selected feels broken. */
export function useBuilderActions(
  setState: (updater: (prev: BuilderState) => BuilderState) => void,
  setSelection: (s: Selection) => void,
): BuilderActions {
  return useMemo(
    () => ({
      addRow: (columnCount) => {
        let newRowId = '';
        setState((prev) => {
          const { state, rowId } = m.addRow(prev, columnCount);
          newRowId = rowId;
          return state;
        });
        setSelection({ kind: 'row', rowId: newRowId });
      },
      deleteRow: (rowId) => {
        setState((prev) => m.deleteRow(prev, rowId));
        setSelection(null);
      },
      duplicateRow: (rowId) => {
        setState((prev) => m.duplicateRow(prev, rowId));
      },
      moveRow: (rowId, targetIndex) => {
        setState((prev) => m.moveRow(prev, rowId, targetIndex));
      },
      updateRow: (rowId, patch) => {
        setState((prev) => m.updateRow(prev, rowId, patch));
      },
      setRowColumnCount: (rowId, count) => {
        setState((prev) => m.setRowColumnCount(prev, rowId, count));
      },
      setColumnWidths: (rowId, widths) => {
        setState((prev) => m.setColumnWidths(prev, rowId, widths));
      },
      resizeColumnPair: (rowId, leftColumnId, rightColumnId, leftWidthPercent) => {
        setState((prev) =>
          m.resizeColumnPair(prev, rowId, leftColumnId, rightColumnId, leftWidthPercent),
        );
      },
      addBlock: (columnId, type) => {
        let newBlockId = '';
        setState((prev) => {
          const { state, blockId } = m.addBlockToColumn(prev, columnId, type);
          newBlockId = blockId;
          return state;
        });
        if (newBlockId) setSelection({ kind: 'block', blockId: newBlockId });
      },
      updateBlock: (blockId, patch) => {
        setState((prev) => m.updateBlock(prev, blockId, patch));
      },
      deleteBlock: (blockId) => {
        setState((prev) => m.deleteBlock(prev, blockId));
        setSelection(null);
      },
      duplicateBlock: (blockId) => {
        let newBlockId = '';
        setState((prev) => {
          const { state, blockId: dupId } = m.duplicateBlock(prev, blockId);
          newBlockId = dupId;
          return state;
        });
        if (newBlockId) setSelection({ kind: 'block', blockId: newBlockId });
      },
      moveBlock: (blockId, targetColumnId, targetIndex) => {
        setState((prev) => m.moveBlock(prev, blockId, targetColumnId, targetIndex));
      },
      applyTheme: (theme) => {
        setState((prev) => m.applyTheme(prev, theme));
      },
      addSavedBlock: (columnId, block) => {
        let newBlockId = '';
        setState((prev) => {
          const { state, blockId } = m.addExistingBlockToColumn(prev, columnId, block);
          newBlockId = blockId;
          return state;
        });
        if (newBlockId) setSelection({ kind: 'block', blockId: newBlockId });
      },
    }),
    [setState, setSelection],
  );
}
