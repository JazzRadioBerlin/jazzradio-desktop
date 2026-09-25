import type { Track } from '../shared/ipc';
import { play, stop } from './player';
import { strings } from './strings';

let current: Track | null = null;
let artworkLarge: string | null = null;
let artSerial = 0;

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

/** Candidate URLs in fallback order, without blanks or repeats. */
function artSources(...urls: (string | null | undefined)[]): string[] {
  const sources: string[] = [];
  for (const url of urls) {
    if (url && !sources.includes(url)) sources.push(url);
  }
  return sources;
}

function clearArt(img: HTMLImageElement): void {
  img.onload = null;
  img.onerror = null;
  img.hidden = true;
  img.removeAttribute('src');
}

/**
 * Shows `img` only once a candidate has actually loaded, walking the fallback
 * chain on error and leaving the record-mark placeholder alone when nothing
 * loads — the broken-image glyph never gets a chance to paint. The token makes
 * a slow load that lands after the artwork changed a no-op.
 */
function setArt(img: HTMLImageElement | null, sources: string[]): void {
  if (!img) return;
  const key = sources.join('\n');
  if (img.dataset.artKey === key) return;

  const token = String((artSerial += 1));
  img.dataset.artKey = key;
  img.dataset.artToken = token;
  clearArt(img);

  const stale = (): boolean => img.dataset.artToken !== token;
  const attempt = (index: number): void => {
    const url = sources[index];
    if (!url || stale()) return;
    img.onload = () => {
      if (!stale()) img.hidden = false;
    };
    img.onerror = () => {
      if (stale()) return;
      clearArt(img);
      attempt(index + 1);
    };
    img.src = url;
  };

  attempt(0);
}

function render(): void {
  const title = current?.title ?? strings.connecting;
  const artist = current?.artist ?? strings.stationName;

  document.querySelectorAll('.js-title').forEach((node) => {
    node.textContent = title;
    if (node instanceof HTMLElement) node.title = title;
  });
  document.querySelectorAll('.js-artist').forEach((node) => {
    node.textContent = artist;
    if (node instanceof HTMLElement) node.title = artist;
  });
  const hero = artSources(artworkLarge, current?.artworkUrl);
  document.querySelectorAll<HTMLImageElement>('.js-art').forEach((img) => {
    setArt(img, hero);
  });
}

async function setMediaSession(): Promise<void> {
  if (!('mediaSession' in navigator)) return;
  const title = current?.title ?? strings.connecting;
  const artist = current?.artist ?? strings.stationName;
  const artwork = artworkLarge
    ? [{ src: artworkLarge, sizes: '600x600', type: 'image/jpeg' }]
    : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist,
    album: strings.stationName,
    artwork,
  });
}

export function getCurrentTrack(): Track | null {
  return current;
}

export function initNowPlaying(): void {
  const live = $('.js-live');
  const bitrate = $('.js-bitrate');
  if (live) live.textContent = strings.live;
  if (bitrate) bitrate.textContent = strings.bitrate;
  document.querySelectorAll('.js-live-badge').forEach((node) => {
    node.textContent = strings.liveBadge;
  });
  render();

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
      void play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      stop();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      stop();
    });
  }

  window.jazzradio.onNowPlaying((payload) => {
    current = payload.track;
    artworkLarge = payload.artworkLarge;
    render();
    void setMediaSession();
  });
}

export function refreshNowPlayingLocale(): void {
  const bitrate = $('.js-bitrate');
  if (bitrate) bitrate.textContent = strings.bitrate;
  document.querySelectorAll('.js-live-badge').forEach((node) => { node.textContent = strings.liveBadge; });
  render();
  void setMediaSession();
}
