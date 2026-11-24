// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Free background music for the Voiceover Studio.
 *
 * Every track is a public-domain (or CC0) RECORDING of a public-domain work,
 * hosted on Wikimedia Commons, so it can be used in ads and client videos with
 * no licence fee and no attribution. Licences were checked on each file's
 * Commons page (extmetadata LicenseShortName) on 2026-11-24 — re-check before
 * adding a track: performances are often CC BY-SA even when the composition is
 * centuries old.
 *
 * `url` is Commons' MP3 transcode (the Studio only accepts MP3/WAV/M4A); the
 * Studio re-hosts it to our storage on pick (POST /v1/studio/assets).
 */
export interface FreeMusicTrack {
  id: string;
  title: string;
  composer: string;
  performer: string;
  mood: 'upbeat' | 'calm' | 'energetic';
  /** Seconds. */
  duration: number;
  license: 'Public domain' | 'CC0';
  /** Commons file page — licence + provenance. */
  source: string;
  /** Direct MP3. */
  url: string;
}

const commons = (file: string) => {
  const name = file.replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name).replace(/%2C/g, ',')}`;
};

export const FREE_MUSIC: readonly FreeMusicTrack[] = [
  {
    id: 'mozart-k525-allegro',
    title: 'Eine kleine Nachtmusik — I. Allegro',
    composer: 'W. A. Mozart',
    performer: 'Musopen',
    mood: 'upbeat',
    duration: 253,
    license: 'Public domain',
    source: commons('Mozart K525 Serenade in G Major 1 - Allegro.ogg'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/68/Mozart_K525_Serenade_in_G_Major_1_-_Allegro.ogg/Mozart_K525_Serenade_in_G_Major_1_-_Allegro.ogg.mp3',
  },
  {
    id: 'mozart-k525-rondo',
    title: 'Eine kleine Nachtmusik — IV. Rondo',
    composer: 'W. A. Mozart',
    performer: 'Musopen',
    mood: 'upbeat',
    duration: 194,
    license: 'Public domain',
    source: commons('Mozart K525 Serenade in G Major 4 - Rondo.ogg'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3b/Mozart_K525_Serenade_in_G_Major_4_-_Rondo.ogg/Mozart_K525_Serenade_in_G_Major_4_-_Rondo.ogg.mp3',
  },
  {
    id: 'haydn-lark-allegro',
    title: "String Quartet 'The Lark' — I. Allegro moderato",
    composer: 'J. Haydn',
    performer: 'Musopen String Quartet',
    mood: 'upbeat',
    duration: 372,
    license: 'Public domain',
    source: commons("Haydn - String Quartet, Op. 64 No. 5 in D major 'The Lark' - I. Allegro moderato (Musopen String Quartet).flac"),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/ca/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_I._Allegro_moderato_%28Musopen_String_Quartet%29.flac/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_I._Allegro_moderato_%28Musopen_String_Quartet%29.flac.mp3',
  },
  {
    id: 'haydn-lark-finale',
    title: "String Quartet 'The Lark' — IV. Finale (Vivace)",
    composer: 'J. Haydn',
    performer: 'Musopen String Quartet',
    mood: 'energetic',
    duration: 91,
    license: 'Public domain',
    source: commons("Haydn - String Quartet, Op. 64 No. 5 in D major 'The Lark' - IV. Finale. Vivace (Musopen String Quartet).flac"),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/b/ba/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_IV._Finale._Vivace_%28Musopen_String_Quartet%29.flac/Haydn_-_String_Quartet%2C_Op._64_No._5_in_D_major_%27The_Lark%27_-_IV._Finale._Vivace_%28Musopen_String_Quartet%29.flac.mp3',
  },
  {
    id: 'mozart-figaro-overture',
    title: 'The Marriage of Figaro — Overture',
    composer: 'W. A. Mozart',
    performer: 'Musopen Symphony',
    mood: 'energetic',
    duration: 241,
    license: 'Public domain',
    source: commons('Mozart - Le nozze di Figaro, K492 - Overture (Musopen Symphony).flac'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d2/Mozart_-_Le_nozze_di_Figaro%2C_K492_-_Overture_%28Musopen_Symphony%29.flac/Mozart_-_Le_nozze_di_Figaro%2C_K492_-_Overture_%28Musopen_Symphony%29.flac.mp3',
  },
  {
    id: 'vivaldi-autumn-allegro',
    title: 'The Four Seasons, Autumn — I. Allegro',
    composer: 'A. Vivaldi',
    performer: 'The Modena Chamber Orchestra',
    mood: 'upbeat',
    duration: 329,
    license: 'Public domain',
    source: commons("The Modena Chamber Orchestra - Vivaldi's Autumn, RV 293 - I. Allegro.ogg"),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c4/The_Modena_Chamber_Orchestra_-_Vivaldi%27s_Autumn%2C_RV_293_-_I._Allegro.ogg/The_Modena_Chamber_Orchestra_-_Vivaldi%27s_Autumn%2C_RV_293_-_I._Allegro.ogg.mp3',
  },
  {
    id: 'vivaldi-mandolin-rv425',
    title: 'Mandolin Concerto in C major, RV 425',
    composer: 'A. Vivaldi',
    performer: 'The Milan Baroque Soloists',
    mood: 'upbeat',
    duration: 500,
    license: 'Public domain',
    source: commons('Antonio Vivaldi, Mandolin Concerto in C major, RV 425.ogg'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/6/60/Antonio_Vivaldi%2C_Mandolin_Concerto_in_C_major%2C_RV_425.ogg/Antonio_Vivaldi%2C_Mandolin_Concerto_in_C_major%2C_RV_425.ogg.mp3',
  },
  {
    id: 'grieg-morning-mood',
    title: 'Peer Gynt — Morning Mood',
    composer: 'E. Grieg',
    performer: 'Musopen Symphony',
    mood: 'calm',
    duration: 229,
    license: 'Public domain',
    source: commons('Grieg - Peer Gynt Suite No. 1, Op. 46 - I. Morning Mood (Musopen Symphony).flac'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/c/c2/Grieg_-_Peer_Gynt_Suite_No._1%2C_Op._46_-_I._Morning_Mood_%28Musopen_Symphony%29.flac/Grieg_-_Peer_Gynt_Suite_No._1%2C_Op._46_-_I._Morning_Mood_%28Musopen_Symphony%29.flac.mp3',
  },
  {
    id: 'bach-bwv147',
    title: 'Jesu, Joy of Man’s Desiring (BWV 147)',
    composer: 'J. S. Bach',
    performer: 'Orchestra Gli Armonici',
    mood: 'calm',
    duration: 202,
    license: 'CC0',
    source: commons('Bach, BWV 147, 10. Jesus bleibet meine Freude.ogg'),
    url: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/2/27/Bach%2C_BWV_147%2C_10._Jesus_bleibet_meine_Freude.ogg/Bach%2C_BWV_147%2C_10._Jesus_bleibet_meine_Freude.ogg.mp3',
  },
];

/**
 * Studio defaults for a steady background bed under narration.
 *
 * Measured on a real render (EP1 ad, 2026-11-24): these recordings are quiet
 * and the renderer's sidechain duck pulls music ~17 dB under any voice, so the
 * first defaults (18% + 75% duck) left the bed ~28 dB below the voice even
 * between sentences — inaudible on a phone. 80% with no ducking sits ~15-17 dB
 * under narration (-35 dBFS RMS vs voice -19), audible but never competing.
 */
export const FREE_MUSIC_DEFAULTS = { volume: 0.8, duck: false, duck_amount: 0.75, fade_in: 1.5, fade_out: 2.5, loop: true } as const;
