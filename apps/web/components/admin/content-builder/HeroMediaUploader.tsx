// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * Admin-facing hero background editor for the fixed marketing pages that
 * support a hero image/video (pricing, blog, docs -- see FIXED_SLUGS in
 * lib/content/get-page.ts). Modeled on AutoGPT's ImageCropUploader: a
 * fixed 16:9 crop stage, drag-to-reposition, zoom slider, and an overlay
 * darkness slider whose preview MUST use the exact same
 * `rgba(0,0,0,opacity/100)` formula as the real page's
 * components/landing/marketing-shell.tsx PageHero -- keep these two in
 * sync, since a preview/real mismatch here is exactly the class of bug
 * that AutoGPT's own tool had to fix historically.
 */

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { MiniButton, MiniInput, MiniLabel, DARK } from './ui';

const MAX_IMAGE_SIZE_MB = 8; // matches /api/admin/content/media's own cap
const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

const STAGE_W = 480;
const STAGE_H = 270; // 16:9 -- matches the aspect PageHero renders its background at
const OUTPUT_W = 1600;
const OUTPUT_H = 900;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

async function uploadHeroImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await fetch('/api/admin/content/media', { method: 'POST', credentials: 'include', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Upload failed (${r.status})`);
  return j.url as string;
}

function baseScale(w: number, h: number): number {
  return Math.max(STAGE_W / w, STAGE_H / h);
}

function clampOffset(
  next: { x: number; y: number },
  w: number,
  h: number,
  zoom: number,
): { x: number; y: number } {
  const scale = baseScale(w, h) * zoom;
  const renderedW = w * scale;
  const renderedH = h * scale;
  const minX = Math.min(0, STAGE_W - renderedW);
  const minY = Math.min(0, STAGE_H - renderedH);
  return {
    x: Math.min(0, Math.max(minX, next.x)),
    y: Math.min(0, Math.max(minY, next.y)),
  };
}

export interface HeroMediaValue {
  hero_image_url: string;
  hero_video_url: string;
  hero_overlay_opacity: number;
}

export function HeroMediaUploader({
  value,
  onChange,
}: {
  value: HeroMediaValue;
  onChange: (patch: Partial<HeroMediaValue>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  function openFilePicker() {
    setError(null);
    fileInputRef.current?.click();
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      setError(`Max upload size is ${MAX_IMAGE_SIZE_MB}MB.`);
      return;
    }
    setError(null);
    setCropSrc(URL.createObjectURL(file));
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    setNaturalSize(null);
  }

  function onCropImgLoad() {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNaturalSize({ w, h });
    const scale = baseScale(w, h) * MIN_ZOOM;
    setOffset({ x: (STAGE_W - w * scale) / 2, y: (STAGE_H - h * scale) / 2 });
  }

  function onZoomChange(z: number) {
    setZoom(z);
    if (naturalSize) setOffset((prev) => clampOffset(prev, naturalSize.w, naturalSize.h, z));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!naturalSize) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current || !naturalSize) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setOffset(
      clampOffset(
        { x: dragState.current.origX + dx, y: dragState.current.origY + dy },
        naturalSize.w,
        naturalSize.h,
        zoom,
      ),
    );
  }
  function onPointerUp() {
    dragState.current = null;
  }

  async function applyCrop() {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    setUploading(true);
    setError(null);
    try {
      const scale = baseScale(naturalSize.w, naturalSize.h) * zoom;
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;
      const sWidth = STAGE_W / scale;
      const sHeight = STAGE_H / scale;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_W;
      canvas.height = OUTPUT_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported in this browser');
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, OUTPUT_W, OUTPUT_H);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('Failed to encode cropped image');

      const file = new File([blob], 'hero.jpg', { type: 'image/jpeg' });
      const url = await uploadHeroImage(file);
      onChange({ hero_image_url: url });
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      setNaturalSize(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function cancelCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setNaturalSize(null);
  }

  const overlayStyle = {
    backgroundColor: `rgba(0,0,0,${Math.min(100, Math.max(0, value.hero_overlay_opacity)) / 100})`,
  };

  return (
    <div className="space-y-4">
      <div>
        <MiniLabel>Hero background image</MiniLabel>

        {cropSrc ? (
          <div className="mt-2 space-y-2">
            <div
              className="relative touch-none select-none overflow-hidden rounded-lg"
              style={{ width: STAGE_W, height: STAGE_H, background: '#000', cursor: 'grab' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <img
                ref={imgRef}
                src={cropSrc}
                onLoad={onCropImgLoad}
                draggable={false}
                alt=""
                style={
                  naturalSize
                    ? {
                        position: 'absolute',
                        left: offset.x,
                        top: offset.y,
                        width: naturalSize.w * baseScale(naturalSize.w, naturalSize.h) * zoom,
                        height: naturalSize.h * baseScale(naturalSize.w, naturalSize.h) * zoom,
                        maxWidth: 'none',
                      }
                    : { position: 'absolute', opacity: 0 }
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: DARK.textMuted }}>Zoom</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => onZoomChange(Number(e.target.value))}
                className="h-1 flex-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <MiniButton variant="default" onClick={applyCrop} disabled={uploading || !naturalSize}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Apply crop
              </MiniButton>
              <MiniButton onClick={cancelCrop} disabled={uploading}>Cancel</MiniButton>
            </div>
          </div>
        ) : value.hero_image_url ? (
          <div className="mt-2 space-y-2">
            <div className="relative overflow-hidden rounded-lg" style={{ width: STAGE_W, height: STAGE_H }}>
              <img src={value.hero_image_url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0" style={overlayStyle} />
            </div>
            <div className="flex items-center gap-2">
              <MiniButton onClick={openFilePicker}><ImagePlus className="h-3.5 w-3.5" /> Replace image</MiniButton>
              <MiniButton onClick={() => onChange({ hero_image_url: '' })}><X className="h-3.5 w-3.5" /> Remove</MiniButton>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <MiniButton onClick={openFilePicker}><ImagePlus className="h-3.5 w-3.5" /> Upload image</MiniButton>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          onChange={onFileSelected}
          className="hidden"
        />
        {error ? <p className="mt-1 text-[11px]" style={{ color: DARK.danger }}>{error}</p> : null}
      </div>

      <div>
        <MiniLabel>Hero background video URL (optional — takes priority over the image above when both are set)</MiniLabel>
        <MiniInput
          className="mt-1"
          value={value.hero_video_url}
          onChange={(e) => onChange({ hero_video_url: e.target.value })}
          placeholder="https://…/hero.mp4"
        />
      </div>

      <div>
        <MiniLabel>Overlay darkness ({Math.round(value.hero_overlay_opacity)}%)</MiniLabel>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value.hero_overlay_opacity}
          onChange={(e) => onChange({ hero_overlay_opacity: Number(e.target.value) })}
          className="mt-1 h-1 w-full"
        />
      </div>
    </div>
  );
}
