import type { BrowserWindow } from 'electron';
import { Ipc, type NowPlayingPayload, type Track } from '../shared/ipc';
import {
  HISTORY_LIMIT,
  HISTORY_POLL_MS,
  HISTORY_URL,
  STATUS_POLL_MS,
  STATUS_URL,
} from '../shared/station';
import { artworkLargeUrl, toTrack } from '../shared/track';

type StatusResponse = {
  current_track?: {
    title?: string;
    start_time?: string;
    artwork_url?: string;
    artwork_url_large?: string;
  };
};

type HistoryResponse = {
  tracks?: Array<{
    title?: string;
    start_time?: string;
    artwork_url?: string;
  }>;
};

let windowRef: BrowserWindow | null = null;
let statusTimer: ReturnType<typeof setInterval> | undefined;
let historyTimer: ReturnType<typeof setInterval> | undefined;
let lastNowPlaying: NowPlayingPayload | null = null;
let lastHistory: Track[] | null = null;
const afterNowPlaying = new Set<() => void>();

export function onAfterNowPlaying(listener: () => void): () => void {
  afterNowPlaying.add(listener);
  return () => {
    afterNowPlaying.delete(listener);
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function sendNowPlaying(payload: NowPlayingPayload): void {
  lastNowPlaying = payload;
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send(Ipc.NowPlayingUpdate, payload);
  for (const listener of afterNowPlaying) listener();
}

function sendHistory(tracks: Track[]): void {
  lastHistory = tracks;
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send(Ipc.HistoryUpdate, tracks);
}

async function pollStatus(): Promise<void> {
  try {
    const data = (await getJson(STATUS_URL)) as StatusResponse;
    const current = data.current_track;
    const track = toTrack(current ?? {});
    if (!track) return;
    sendNowPlaying({
      track,
      artworkLarge: artworkLargeUrl(current?.artwork_url_large, current?.artwork_url),
    });
  } catch {
    // Poll failures are silent; the UI keeps the last known track.
  }
}

async function pollHistory(): Promise<void> {
  try {
    const data = (await getJson(HISTORY_URL)) as HistoryResponse;
    const tracks = (data.tracks ?? [])
      .map((entry) => toTrack(entry))
      .filter((track): track is Track => track !== null)
      .slice(0, HISTORY_LIMIT);
    if (!tracks.length) return;
    sendHistory(tracks);
  } catch {
    // Poll failures are silent.
  }
}

export function getLastNowPlaying(): NowPlayingPayload | null {
  return lastNowPlaying;
}

export function refreshNow(): void {
  void pollStatus();
  void pollHistory();
}

export function replayLast(win: BrowserWindow): void {
  if (lastNowPlaying) {
    win.webContents.send(Ipc.NowPlayingUpdate, lastNowPlaying);
  }
  if (lastHistory) {
    win.webContents.send(Ipc.HistoryUpdate, lastHistory);
  }
}

export function startPoller(win: BrowserWindow): void {
  windowRef = win;
  void pollStatus();
  void pollHistory();
  if (!statusTimer) {
    statusTimer = setInterval(() => {
      void pollStatus();
    }, STATUS_POLL_MS);
  }
  if (!historyTimer) {
    historyTimer = setInterval(() => {
      void pollHistory();
    }, HISTORY_POLL_MS);
  }
}

export function stopPoller(): void {
  windowRef = null;
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = undefined;
  }
  if (historyTimer) {
    clearInterval(historyTimer);
    historyTimer = undefined;
  }
}
