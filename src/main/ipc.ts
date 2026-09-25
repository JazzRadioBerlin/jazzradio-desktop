import { applyLanguageFromSettings, getLocalizedSettings } from './language';
import { ipcMain } from 'electron';
import type { NoteAnchor } from '../shared/export';
import type { FavoriteDraft, GoogleQuery, ShareRequest, StreamState } from '../shared/ipc';
import { Ipc } from '../shared/ipc';
import { isWindowMode, type Settings } from '../shared/window';
import { getLastNowPlaying } from './poller';
import { openGoogle, runShare } from './share';
import {
  addNote,
  getFavorites,
  getNotes,
  getSettings,
  removeNote,
  updateNote,
  toggleFavorite,
  updateSettings,
} from './store';
import {
  applyAlwaysOnTopFromSettings,
  getAttachedWindow,
  getWindowMode,
  restoreRendererMode,
  setWindowMode,
} from './window-state';
import { applyThemeFromSettings } from './theme';

let streamState: StreamState = 'stopped';
let streamStateListener: (() => void) | undefined;

export function getStreamState(): StreamState {
  return streamState;
}

export function setStreamState(state: StreamState): void {
  streamState = state;
  streamStateListener?.();
}

export function onStreamStateChanged(listener: () => void): void {
  streamStateListener = listener;
}

function asDraft(value: unknown): FavoriteDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as FavoriteDraft;
  if (typeof draft.artist !== 'string' || typeof draft.title !== 'string') return null;
  const artworkUrl =
    draft.artworkUrl === undefined || draft.artworkUrl === null || typeof draft.artworkUrl === 'string'
      ? draft.artworkUrl
      : undefined;
  return {
    artist: draft.artist.slice(0, 300),
    title: draft.title.slice(0, 300),
    artworkUrl,
  };
}

function asGoogleQuery(value: unknown): GoogleQuery | null {
  if (!value || typeof value !== 'object') return null;
  const query = value as GoogleQuery;
  if (typeof query.artist !== 'string' || typeof query.title !== 'string') return null;
  const artist = query.artist.trim().slice(0, 300);
  const title = query.title.trim().slice(0, 300);
  if (!artist && !title) return null;
  return { artist, title };
}

function asShareRequest(value: unknown): ShareRequest | null {
  if (!value || typeof value !== 'object') return null;
  const request = value as ShareRequest;
  if (request.kind !== 'favorites' && request.kind !== 'notes') return null;
  if (request.action !== 'copy' && request.action !== 'file' && request.action !== 'sheet') {
    return null;
  }
  return { kind: request.kind, action: request.action };
}

export function notifyFavorites(): void {
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.FavoritesChanged, getFavorites());
}

export function toggleFavoriteAndNotify(draft: FavoriteDraft): ReturnType<typeof toggleFavorite> {
  const items = toggleFavorite(draft);
  notifyFavorites();
  return items;
}

export function setRendererPanel(panel: 'playlist' | 'favoriten' | 'notizen'): void {
  if (panel === 'notizen' && !getSettings().notepadEnabled) return;
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.PanelSet, panel);
}

export function focusNotesComposer(): void {
  if (!getSettings().notepadEnabled) return;
  if (getWindowMode() !== 'main') setWindowMode('main');
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.PanelSet, 'notizen');
  win.webContents.send(Ipc.NotesFocus);
}

function notifyNotes(): void {
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.NotesChanged, getNotes());
}

function playingAnchor(): NoteAnchor | undefined {
  if (streamState !== 'playing') return undefined;
  const track = getLastNowPlaying()?.track;
  if (!track) return undefined;
  return {
    artist: track.artist,
    title: track.title,
    at: new Date().toISOString(),
  };
}

export function registerIpc(): void {
  ipcMain.on(Ipc.StreamState, (_event, state: StreamState) => {
    if (state === 'playing' || state === 'stopped') {
      setStreamState(state);
    }
  });

  ipcMain.on(Ipc.WindowSetMode, (_event, mode: unknown) => {
    if (isWindowMode(mode)) setWindowMode(mode);
  });

  ipcMain.on(Ipc.WindowSyncMode, () => {
    restoreRendererMode();
  });

  ipcMain.handle(Ipc.SettingsGet, () => getLocalizedSettings());

  ipcMain.on(Ipc.SettingsSet, (event, patch: Partial<Settings>) => {
    if (!patch || typeof patch !== 'object') return;
    const previous = getSettings();
    const next = updateSettings(patch);
    applyLanguageFromSettings();
    const settings = getLocalizedSettings();
    if (previous.alwaysOnTopCompact !== next.alwaysOnTopCompact && getWindowMode() === 'mini') {
      applyAlwaysOnTopFromSettings();
    }
    applyThemeFromSettings();
    if (!event.sender.isDestroyed()) {
      event.sender.send(Ipc.SettingsChanged, settings);
    }
  });

  ipcMain.handle(Ipc.FavoritesList, () => getFavorites());

  ipcMain.handle(Ipc.FavoritesToggle, (_event, payload: unknown) => {
    const draft = asDraft(payload);
    if (!draft) return getFavorites();
    return toggleFavoriteAndNotify(draft);
  });

  ipcMain.on(Ipc.ExternalGoogle, (_event, payload: unknown) => {
    const query = asGoogleQuery(payload);
    if (query) openGoogle(query.artist, query.title);
  });

  ipcMain.on(Ipc.ShareMenu, (_event, payload: unknown) => {
    const request = asShareRequest(payload);
    if (request) void runShare(request.kind, request.action);
  });

  ipcMain.handle(Ipc.NotesList, () => getNotes());

  ipcMain.handle(Ipc.NotesAdd, (_event, payload: unknown) => {
    if (typeof payload !== 'string') return getNotes();
    const items = addNote(payload, playingAnchor());
    notifyNotes();
    return items;
  });

  ipcMain.handle(Ipc.NotesUpdate, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid note update');
    const draft = payload as { id?: unknown; text?: unknown };
    if (typeof draft.id !== 'string' || !draft.id || typeof draft.text !== 'string') {
      throw new Error('Invalid note update');
    }
    const items = updateNote(draft.id, draft.text);
    notifyNotes();
    return items;
  });

  ipcMain.handle(Ipc.NotesRemove, (_event, payload: unknown) => {
    if (typeof payload !== 'string' || !payload) return getNotes();
    const items = removeNote(payload);
    notifyNotes();
    return items;
  });
}
