import { strings } from '../renderer/strings';
import type { Track } from './ipc';

// The feed sometimes carries Windows-1252 punctuation as C1 controls.
// Repair only those known characters; valid Unicode needs no re-decoding.
const FEED_PUNCTUATION: Record<string, string> = {
  '\u0085': '\u2026',
  '\u0091': '\u2018',
  '\u0092': '\u2019',
  '\u0093': '\u201c',
  '\u0094': '\u201d',
  '\u0096': '\u2013',
  '\u0097': '\u2014',
};

export function splitRawTitle(raw: string): { artist: string; title: string } {
  const index = raw.indexOf(' - ');
  if (index < 0) {
    return { artist: strings.stationName, title: raw };
  }
  return {
    artist: raw.slice(0, index),
    title: raw.slice(index + 3),
  };
}

function isAppleArtwork(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.mzstatic.com');
  } catch {
    return false;
  }
}

export function artworkThumbUrl(url: string | undefined): string | null {
  if (!url || !isAppleArtwork(url)) return null;
  return url;
}

export function artworkLargeUrl(
  artworkUrlLarge: string | undefined,
  artworkUrl: string | undefined,
): string | null {
  if (artworkUrlLarge && isAppleArtwork(artworkUrlLarge)) return artworkUrlLarge;
  if (artworkUrl && isAppleArtwork(artworkUrl)) {
    return artworkUrl.replace('100x100bb', '600x600bb');
  }
  return null;
}

export function toTrack(input: {
  title?: string;
  start_time?: string;
  artwork_url?: string;
}): Track | null {
  const raw = input.title?.trim();
  if (!raw) return null;
  const repaired = raw.replace(/[\u0085\u0091-\u0094\u0096\u0097]/g, (character) =>
    FEED_PUNCTUATION[character],
  );
  const { artist, title } = splitRawTitle(repaired);
  return {
    artist,
    title,
    artworkUrl: artworkThumbUrl(input.artwork_url),
    startTime: input.start_time ?? null,
  };
}

export function sameTrack(a: Track, b: Track): boolean {
  return a.artist === b.artist && a.title === b.title;
}
