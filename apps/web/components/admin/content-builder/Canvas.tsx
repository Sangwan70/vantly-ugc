// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bookmark,
  BookmarkPlus,
  Columns2,
  Columns3,
  Copy,
  GripVertical,
  ImageIcon,
  Minus,
  MousePointerClick,
  MoveVertical,
  Plus,
  Quote as QuoteIcon,
  Rows,
  Share2,
  Square,
  Trash2,
  Type,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Block, BlockPatch, BlockType, BuilderState, Row, Selection } from '@/lib/content/builder/types';
import { BuilderActions } from '@/lib/content/builder/useBuilderActions';
import { SavedBlock, deleteSavedBlockFromStorage, getSavedBlocks, saveBlockToStorage } from '@/lib/content/builder/savedBlocks';
import {
  ButtonBlockView,
  DividerBlockView,
  ImageBlockView,
  QuoteBlockView,
  RawHtmlBlockView,
  SocialIconsBlockView,
  SpacerBlockView,
  StatsBlockView,
  TextBlockView,
} from './BlockViews';
import { MiniButton, MiniDropdown, MiniDropdownItem, DARK } from './ui';

const BLOCK_TYPE_OPTIONS: { type: BlockType; label: string; icon: React.ReactNode }[] = [
  { type: 'text', label: 'Text', icon: <Type className="h-3.5 w-3.5" /> },
  { type: 'image', label: 'Image', icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { type: 'button', label: 'Button', icon: <MousePointerClick className="h-3.5 w-3.5" /> },
  { type: 'divider', label: 'Divider', icon: <Minus className="h-3.5 w-3.5" /> },
  { type: 'spacer', label: 'Spacer', icon: <MoveVertical className="h-3.5 w-3.5" /> },
  { type: 'quote', label: 'Quote', icon: <QuoteIcon className="h-3.5 w-3.5" /> },
  { type: 'social', label: 'Social Icons', icon: <Share2 className="h-3.5 w-3.5" /> },
  { type: 'stats', label: 'Stats', icon: <BarChart3 className="h-3.5 w-3.5" /> },
];

function AddBlockMenu({
  onAdd,
  savedBlocks,
  onAddSaved,
  onDeleteSaved,
}: {
  onAdd: (type: BlockType) => void;
  savedBlocks: SavedBlock[];
  onAddSaved: (block: Block) => void;
  onDeleteSaved: (id: string) => void;
}) {
  return (
    <MiniDropdown
      trigger={
        <MiniButton className="gap-1">
          <Plus className="h-3 w-3" />
          Add block
        </MiniButton>
      }
    >
      {(close) => (
        <>
          {BLOCK_TYPE_OPTIONS.map((opt) => (
            <MiniDropdownItem
              key={opt.type}
              onSelect={() => {
                onAdd(opt.type);
                close();
              }}
            >
              {opt.icon}
              {opt.label}
            </MiniDropdownItem>
          ))}
          {savedBlocks.length > 0 && (
            <>
              <div className="my-1 h-px" style={{ background: DARK.inputBorder }} />
              <div className="px-2 py-1 text-[10px] font-semibold uppercase" style={{ color: DARK.textMuted }}>
                Saved blocks
              </div>
              {savedBlocks.map((saved) => (
                <MiniDropdownItem
                  key={saved.id}
                  onSelect={() => {
                    onAddSaved(saved.block);
                    close();
                  }}
                  className="group/saved"
                >
                  <Bookmark className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate">{saved.name}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 opacity-0 hover:bg-red-500/10 group-hover/saved:opacity-100"
                    title="Delete saved block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSaved(saved.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" style={{ color: DARK.danger }} />
                  </button>
                </MiniDropdownItem>
              ))}
            </>
          )}
        </>
      )}
    </MiniDropdown>
  );
}

function BlockDispatcher(props: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: BlockPatch) => void;
  columnWidthPx: number;
}) {
  const { block } = props;
  switch (block.type) {
    case 'text':
      return <TextBlockView {...props} block={block} />;
    case 'image':
      return <ImageBlockView {...props} block={block} />;
    case 'button':
      return <ButtonBlockView {...props} block={block} />;
    case 'divider':
      return <DividerBlockView {...props} block={block} />;
    case 'spacer':
      return <SpacerBlockView {...props} block={block} />;
    case 'quote':
      return <QuoteBlockView {...props} block={block} />;
    case 'social':
      return <SocialIconsBlockView {...props} block={block} />;
    case 'stats':
      return <StatsBlockView {...props} block={block} />;
    case 'raw':
      return <RawHtmlBlockView {...props} block={block} />;
  }
}

// Drag payloads are JSON strings on the "application/json" dataTransfer
// type -- only ever produced and consumed by this same component tree,
// so no need to defend against foreign drag sources.
type BlockDragPayload = { kind: 'block'; blockId: string };
type RowDragPayload = { kind: 'row'; rowId: string };

export function Canvas({
  state,
  actions,
  selection,
  onSelect,
  canvasWidth,
}: {
  state: BuilderState;
  actions: BuilderActions;
  selection: Selection;
  onSelect: (s: Selection) => void;
  canvasWidth: number;
}) {
  const [rowDropIndex, setRowDropIndex] = useState<number | null>(null);
  const [blockDropTarget, setBlockDropTarget] = useState<{ columnId: string; index: number } | null>(null);
  const [savedBlocks, setSavedBlocks] = useState<SavedBlock[]>([]);

  useEffect(() => {
    setSavedBlocks(getSavedBlocks());
  }, []);

  function handleSaveBlock(block: Block) {
    const name = window.prompt('Name this reusable block:', `${block.type} block`);
    if (name === null) return;
    setSavedBlocks(saveBlockToStorage(name, block));
  }

  function handleDeleteSaved(id: string) {
    setSavedBlocks(deleteSavedBlockFromStorage(id));
  }

  function handleRowDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    setRowDropIndex(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as RowDragPayload;
      if (payload.kind === 'row') actions.moveRow(payload.rowId, index);
    } catch {
      // ignore malformed payloads
    }
  }

  function handleBlockDrop(e: React.DragEvent, columnId: string, index: number) {
    e.preventDefault();
    e.stopPropagation();
    setBlockDropTarget(null);
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as BlockDragPayload;
      if (payload.kind === 'block') {
        actions.moveBlock(payload.blockId, columnId, index);
        onSelect({ kind: 'block', blockId: payload.blockId });
      }
    } catch {
      // ignore malformed payloads
    }
  }

  return (
    <div className="mx-auto" style={{ width: canvasWidth }}>
      <div className="rounded-lg" style={{ background: '#0F1015', border: `1px solid ${DARK.inputBorder}` }}>
        {state.rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-10 text-sm" style={{ color: DARK.textMuted }}>
            <Rows className="h-6 w-6" />
            Empty. Add your first row below.
          </div>
        )}

        {state.rows.map((row, rowIndex) => (
          <div key={row.id}>
            <div
              className="h-2 transition-colors"
              style={{ background: rowDropIndex === rowIndex ? 'rgba(167,139,250,0.3)' : 'transparent' }}
              onDragOver={(e) => {
                e.preventDefault();
                setRowDropIndex(rowIndex);
              }}
              onDragLeave={() => setRowDropIndex((cur) => (cur === rowIndex ? null : cur))}
              onDrop={(e) => handleRowDrop(e, rowIndex)}
            />
            <RowShell
              row={row}
              rowIndex={rowIndex}
              rowCount={state.rows.length}
              selected={selection?.kind === 'row' && selection.rowId === row.id}
              onSelectRow={() => onSelect({ kind: 'row', rowId: row.id })}
              actions={actions}
              canvasWidth={canvasWidth}
              selection={selection}
              onSelectBlock={(blockId) => onSelect({ kind: 'block', blockId })}
              blockDropTarget={blockDropTarget}
              setBlockDropTarget={setBlockDropTarget}
              onBlockDrop={handleBlockDrop}
              savedBlocks={savedBlocks}
              onSaveBlock={handleSaveBlock}
              onDeleteSaved={handleDeleteSaved}
            />
          </div>
        ))}

        <div
          className="h-2 transition-colors"
          style={{ background: rowDropIndex === state.rows.length ? 'rgba(167,139,250,0.3)' : 'transparent' }}
          onDragOver={(e) => {
            e.preventDefault();
            setRowDropIndex(state.rows.length);
          }}
          onDragLeave={() => setRowDropIndex((cur) => (cur === state.rows.length ? null : cur))}
          onDrop={(e) => handleRowDrop(e, state.rows.length)}
        />
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="text-xs" style={{ color: DARK.textMuted }}>Add row:</span>
        <MiniButton className="gap-1" title="1 column" onClick={() => actions.addRow(1)}>
          <Square className="h-3.5 w-3.5" /> 1
        </MiniButton>
        <MiniButton className="gap-1" title="2 columns" onClick={() => actions.addRow(2)}>
          <Columns2 className="h-3.5 w-3.5" /> 2
        </MiniButton>
        <MiniButton className="gap-1" title="3 columns" onClick={() => actions.addRow(3)}>
          <Columns3 className="h-3.5 w-3.5" /> 3
        </MiniButton>
      </div>
    </div>
  );
}

function RowShell({
  row,
  rowIndex: _rowIndex,
  rowCount,
  selected,
  onSelectRow,
  actions,
  canvasWidth,
  selection,
  onSelectBlock,
  blockDropTarget,
  setBlockDropTarget,
  onBlockDrop,
  savedBlocks,
  onSaveBlock,
  onDeleteSaved,
}: {
  row: Row;
  rowIndex: number;
  rowCount: number;
  selected: boolean;
  onSelectRow: () => void;
  actions: BuilderActions;
  canvasWidth: number;
  selection: Selection;
  onSelectBlock: (blockId: string) => void;
  blockDropTarget: { columnId: string; index: number } | null;
  setBlockDropTarget: (t: { columnId: string; index: number } | null) => void;
  onBlockDrop: (e: React.DragEvent, columnId: string, index: number) => void;
  savedBlocks: SavedBlock[];
  onSaveBlock: (block: Block) => void;
  onDeleteSaved: (id: string) => void;
}) {
  return (
    <div
      className="group/row relative border-b border-dashed px-2 py-2 last:border-b-0"
      style={{
        backgroundColor: row.bgColor || undefined,
        borderColor: 'rgba(255,255,255,0.05)',
        boxShadow: selected ? `inset 0 0 0 1px ${DARK.accent}` : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelectRow();
      }}
    >
      <div className="pointer-events-none absolute -left-1 top-1 z-10 flex -translate-x-full gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto">
        <div
          className="cursor-grab rounded border p-1 shadow-sm"
          style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'row', rowId: row.id } satisfies RowDragPayload));
            e.dataTransfer.effectAllowed = 'move';
          }}
          title="Drag to reorder row"
        >
          <GripVertical className="h-3.5 w-3.5" style={{ color: DARK.textMuted }} />
        </div>
      </div>
      <div className="pointer-events-none absolute -right-1 top-1 z-10 flex translate-x-full gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto">
        <button
          type="button"
          className="rounded border p-1 shadow-sm hover:bg-white/5"
          style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
          title="Duplicate row"
          onClick={(e) => {
            e.stopPropagation();
            actions.duplicateRow(row.id);
          }}
        >
          <Copy className="h-3.5 w-3.5" style={{ color: DARK.textMuted }} />
        </button>
        {rowCount > 1 && (
          <button
            type="button"
            className="rounded border p-1 shadow-sm hover:bg-red-500/10"
            style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
            title="Delete row"
            onClick={(e) => {
              e.stopPropagation();
              actions.deleteRow(row.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" style={{ color: DARK.danger }} />
          </button>
        )}
      </div>

      <div className="flex">
        {row.columns.map((col, colIndex) => {
          const columnWidthPx = Math.max(60, Math.round((canvasWidth * col.widthPercent) / 100) - 20);
          const nextCol = row.columns[colIndex + 1];
          return (
            <Fragment key={col.id}>
              <div
                className="min-w-0 flex-1 space-y-2 px-1"
                style={{ flexBasis: `${col.widthPercent}%` }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setBlockDropTarget({ columnId: col.id, index: col.blocks.length });
                }}
                onDrop={(e) => onBlockDrop(e, col.id, col.blocks.length)}
              >
                {col.blocks.map((block, blockIndex) => (
                  <div key={block.id}>
                    <div
                      className="h-1.5 rounded transition-colors"
                      style={{
                        background:
                          blockDropTarget?.columnId === col.id && blockDropTarget.index === blockIndex
                            ? 'rgba(167,139,250,0.4)'
                            : 'transparent',
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setBlockDropTarget({ columnId: col.id, index: blockIndex });
                      }}
                      onDrop={(e) => onBlockDrop(e, col.id, blockIndex)}
                    />
                    <BlockShell
                      block={block}
                      selected={selection?.kind === 'block' && selection.blockId === block.id}
                      onSelect={() => onSelectBlock(block.id)}
                      actions={actions}
                      columnWidthPx={columnWidthPx}
                      onSaveBlock={onSaveBlock}
                    />
                  </div>
                ))}
                <div
                  className="h-1.5 rounded transition-colors"
                  style={{
                    background:
                      blockDropTarget?.columnId === col.id && blockDropTarget.index === col.blocks.length
                        ? 'rgba(167,139,250,0.4)'
                        : 'transparent',
                  }}
                />
                <div className="flex justify-center">
                  <AddBlockMenu
                    onAdd={(type) => actions.addBlock(col.id, type)}
                    savedBlocks={savedBlocks}
                    onAddSaved={(block) => actions.addSavedBlock(col.id, block)}
                    onDeleteSaved={onDeleteSaved}
                  />
                </div>
              </div>
              {nextCol && (
                <ColumnResizeHandle
                  rowId={row.id}
                  leftColumnId={col.id}
                  rightColumnId={nextCol.id}
                  leftWidthPercent={col.widthPercent}
                  rightWidthPercent={nextCol.widthPercent}
                  canvasWidth={canvasWidth}
                  actions={actions}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function ColumnResizeHandle({
  rowId,
  leftColumnId,
  rightColumnId,
  leftWidthPercent,
  rightWidthPercent,
  canvasWidth,
  actions,
}: {
  rowId: string;
  leftColumnId: string;
  rightColumnId: string;
  leftWidthPercent: number;
  rightWidthPercent: number;
  canvasWidth: number;
  actions: BuilderActions;
}) {
  const dragRef = useRef<{ startX: number; startLeft: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startLeft: leftWidthPercent };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const deltaPercent = ((e.clientX - dragRef.current.startX) / canvasWidth) * 100;
    actions.resizeColumnPair(rowId, leftColumnId, rightColumnId, dragRef.current.startLeft + deltaPercent);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  return (
    <div
      className="group/handle relative w-2 shrink-0 cursor-col-resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
      title={`${Math.round(leftWidthPercent)}% / ${Math.round(rightWidthPercent)}%`}
    >
      <div
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors group-hover/handle:w-1"
        style={{ background: DARK.inputBorder }}
      />
    </div>
  );
}

function BlockShell({
  block,
  selected,
  onSelect,
  actions,
  columnWidthPx,
  onSaveBlock,
}: {
  block: Block;
  selected: boolean;
  onSelect: () => void;
  actions: BuilderActions;
  columnWidthPx: number;
  onSaveBlock: (block: Block) => void;
}) {
  return (
    <div
      className="group/block relative rounded p-1"
      style={{ background: selected ? 'rgba(167,139,250,0.08)' : undefined }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div
        className={cn(
          'absolute -top-2.5 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity',
          selected ? 'opacity-100' : 'group-hover/block:opacity-100',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="cursor-grab rounded border p-0.5 shadow-sm"
          style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/json', JSON.stringify({ kind: 'block', blockId: block.id } satisfies BlockDragPayload));
            e.dataTransfer.effectAllowed = 'move';
          }}
          title="Drag to move"
        >
          <GripVertical className="h-3 w-3" style={{ color: DARK.textMuted }} />
        </div>
        <button
          type="button"
          className="rounded border p-0.5 shadow-sm hover:bg-white/5"
          style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
          title="Duplicate block"
          onClick={() => actions.duplicateBlock(block.id)}
        >
          <Copy className="h-3 w-3" style={{ color: DARK.textMuted }} />
        </button>
        {block.type !== 'raw' && (
          <button
            type="button"
            className="rounded border p-0.5 shadow-sm hover:bg-white/5"
            style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
            title="Save as reusable block"
            onClick={() => onSaveBlock(block)}
          >
            <BookmarkPlus className="h-3 w-3" style={{ color: DARK.textMuted }} />
          </button>
        )}
        <button
          type="button"
          className="rounded border p-0.5 shadow-sm hover:bg-red-500/10"
          style={{ background: '#1B1C2A', borderColor: DARK.inputBorder }}
          title="Delete block"
          onClick={() => actions.deleteBlock(block.id)}
        >
          <Trash2 className="h-3 w-3" style={{ color: DARK.danger }} />
        </button>
      </div>
      <BlockDispatcher
        block={block}
        selected={selected}
        onSelect={onSelect}
        onChange={(patch) => actions.updateBlock(block.id, patch)}
        columnWidthPx={columnWidthPx}
      />
    </div>
  );
}
