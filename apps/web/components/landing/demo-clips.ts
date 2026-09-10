// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Small set of real R2-hosted sample renders shared by the landing
 * page's hero clip fan (hero-clip-grid.tsx) and the "Start generating"
 * CTA's clip marquee (cta-clip-marquee.tsx), so both visuals draw from
 * the same real generated videos instead of each hardcoding its own
 * copy of the URLs. Same clips Home2Flow / FeatureGrid already use.
 */
export const DEMO_CLIPS = [
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/vnext/primitive-runs/7252a5f8-48a5-439b-9e79-33333333cccc/simple-selfie.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/c3354440-1d8d-4832-ab4d-01bbd07bb9eb/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/d095fee4-2935-456f-83de-4c00681ac051/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/generation-outputs/120eaf6f-d2af-4f66-83e8-e62ec826de01/ac468576-3cc2-4d05-ad21-d69a34141132/character-video-final.mp4',
  'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev/brand-extracts/subtitle/120eaf6f-d2af-4f66-83e8-e62ec826de01/3f2c5f0a-61c6-45b0-a855-f2484b95d65d-subs/subtitled.mp4',
] as const;
