// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Editor state for one Voiceover Studio project: timeline with undo/redo and
 * debounced autosave to api-v2.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceoverTimeline } from '@vantly-ugc/schema';
import { studioApi, type StudioProject } from './api';

const HISTORY_LIMIT = 100;
const SAVE_DEBOUNCE_MS = 1200;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export function useStudioProject(id: string) {
  const [project, setProject] = useState<StudioProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeline, setTimelineState] = useState<VoiceoverTimeline | null>(null);
  const [title, setTitleState] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const past = useRef<VoiceoverTimeline[]>([]);
  const future = useRef<VoiceoverTimeline[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ timeline: VoiceoverTimeline | null; title: string }>({ timeline: null, title: '' });

  useEffect(() => {
    let cancelled = false;
    studioApi
      .getProject(id)
      .then(({ project }) => {
        if (cancelled) return;
        setProject(project);
        setTimelineState(project.timeline);
        setTitleState(project.title);
        latest.current = { timeline: project.timeline, title: project.title };
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => { cancelled = true; };
  }, [id]);

  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const { timeline: tl, title: tt } = latest.current;
    if (!tl) return;
    setSaveState('saving');
    try {
      await studioApi.saveProject(id, { timeline: tl, title: tt || 'Untitled voiceover' });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [id]);

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Don't lose the last edits when the tab closes.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (saveTimer.current) { void flush(); e.preventDefault(); }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flush]);

  const lastEdit = useRef<{ key?: string; at: number }>({ at: 0 });

  /** Apply an edit. `coalesce` merges rapid edits (typing, dragging) into one undo step. */
  const update = useCallback(
    (fn: (t: VoiceoverTimeline) => VoiceoverTimeline, opts?: { coalesce?: string }) => {
      const prev = latest.current.timeline;
      if (!prev) return;
      const next = fn(prev);
      if (next === prev) return;
      const key = opts?.coalesce;
      const now = Date.now();
      const last = lastEdit.current;
      if (!(key && last.key === key && now - last.at < 1000)) {
        past.current = [...past.current.slice(-HISTORY_LIMIT + 1), prev];
      }
      lastEdit.current = { key, at: now };
      future.current = [];
      latest.current.timeline = next;
      setTimelineState(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const undo = useCallback(() => {
    const cur = latest.current.timeline;
    const prev = past.current.pop();
    if (!prev || !cur) return;
    future.current = [cur, ...future.current];
    latest.current.timeline = prev;
    lastEdit.current = { at: 0 };
    setTimelineState(prev);
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const cur = latest.current.timeline;
    const next = future.current.shift();
    if (!next || !cur) return;
    past.current = [...past.current, cur];
    latest.current.timeline = next;
    lastEdit.current = { at: 0 };
    setTimelineState(next);
    scheduleSave();
  }, [scheduleSave]);

  const setTitle = useCallback((t: string) => {
    setTitleState(t);
    latest.current.title = t;
    scheduleSave();
  }, [scheduleSave]);

  return {
    project,
    loadError,
    timeline,
    title,
    setTitle,
    update,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
    flush,
  };
}
