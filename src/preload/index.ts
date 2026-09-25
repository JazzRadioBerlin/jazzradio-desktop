import { contextBridge, ipcRenderer } from 'electron';
import type { JazzradioApi } from '../shared/api';
import {
  Ipc,
  type Favorite,
  type FavoriteDraft,
  type GoogleQuery,
  type Note,
  type NowPlayingPayload,
  type PanelId,
  type ShareRequest,
  type StreamState,
  type Track,
} from '../shared/ipc';
import type { Settings, WindowMode } from '../shared/window';

const api: JazzradioApi = {
  platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'other',
  onNowPlaying(callback) {
    const listener = (_event: unknown, payload: NowPlayingPayload) => {
      callback(payload);
    };
    ipcRenderer.on(Ipc.NowPlayingUpdate, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.NowPlayingUpdate, listener);
    };
  },
  onHistory(callback) {
    const listener = (_event: unknown, tracks: Track[]) => {
      callback(tracks);
    };
    ipcRenderer.on(Ipc.HistoryUpdate, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.HistoryUpdate, listener);
    };
  },
  setStreamState(state: StreamState) {
    ipcRenderer.send(Ipc.StreamState, state);
  },
  setMode(mode: WindowMode) {
    ipcRenderer.send(Ipc.WindowSetMode, mode);
  },
  syncMode() {
    ipcRenderer.send(Ipc.WindowSyncMode);
  },
  onModeChanged(callback) {
    const listener = (_event: unknown, mode: WindowMode) => {
      callback(mode);
    };
    ipcRenderer.on(Ipc.WindowModeChanged, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.WindowModeChanged, listener);
    };
  },
  onMiniAvailabilityChanged(callback) {
    const listener = (_event: unknown, available: boolean) => {
      callback(available === true);
    };
    ipcRenderer.on(Ipc.WindowMiniAvailabilityChanged, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.WindowMiniAvailabilityChanged, listener);
    };
  },
  getSettings() {
    return ipcRenderer.invoke(Ipc.SettingsGet) as Promise<Settings>;
  },
  setSettings(patch: Partial<Settings>) {
    ipcRenderer.send(Ipc.SettingsSet, patch);
  },
  onSettingsChanged(callback) {
    const listener = (_event: unknown, settings: Settings) => {
      callback(settings);
    };
    ipcRenderer.on(Ipc.SettingsChanged, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.SettingsChanged, listener);
    };
  },
  listFavorites() {
    return ipcRenderer.invoke(Ipc.FavoritesList) as Promise<Favorite[]>;
  },
  toggleFavorite(draft: FavoriteDraft) {
    return ipcRenderer.invoke(Ipc.FavoritesToggle, draft) as Promise<Favorite[]>;
  },
  onFavoritesChanged(callback) {
    const listener = (_event: unknown, items: Favorite[]) => {
      callback(items);
    };
    ipcRenderer.on(Ipc.FavoritesChanged, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.FavoritesChanged, listener);
    };
  },
  searchGoogle(query: GoogleQuery) {
    ipcRenderer.send(Ipc.ExternalGoogle, query);
  },
  share(request: ShareRequest) {
    ipcRenderer.send(Ipc.ShareMenu, request);
  },
  onPanelSet(callback) {
    const listener = (_event: unknown, panel: PanelId) => {
      callback(panel);
    };
    ipcRenderer.on(Ipc.PanelSet, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.PanelSet, listener);
    };
  },
  listNotes() {
    return ipcRenderer.invoke(Ipc.NotesList) as Promise<Note[]>;
  },
  addNote(text: string) {
    return ipcRenderer.invoke(Ipc.NotesAdd, text) as Promise<Note[]>;
  },
  updateNote(id: string, text: string) {
    return ipcRenderer.invoke(Ipc.NotesUpdate, { id, text }) as Promise<Note[]>;
  },
  removeNote(id: string) {
    return ipcRenderer.invoke(Ipc.NotesRemove, id) as Promise<Note[]>;
  },
  onNotesChanged(callback) {
    const listener = (_event: unknown, items: Note[]) => {
      callback(items);
    };
    ipcRenderer.on(Ipc.NotesChanged, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.NotesChanged, listener);
    };
  },
  onNotesFocus(callback) {
    const listener = () => {
      callback();
    };
    ipcRenderer.on(Ipc.NotesFocus, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.NotesFocus, listener);
    };
  },
  onThemeResolved(callback) {
    const listener = (_event: unknown, dark: boolean) => {
      callback(Boolean(dark));
    };
    ipcRenderer.on(Ipc.ThemeResolved, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.ThemeResolved, listener);
    };
  },
  onPlaybackToggle(callback) {
    const listener = () => {
      callback();
    };
    ipcRenderer.on(Ipc.PlaybackToggle, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.PlaybackToggle, listener);
    };
  },
  onPlaybackReconnect(callback) {
    const listener = () => {
      callback();
    };
    ipcRenderer.on(Ipc.PlaybackReconnect, listener);
    return () => {
      ipcRenderer.removeListener(Ipc.PlaybackReconnect, listener);
    };
  },
};

contextBridge.exposeInMainWorld('jazzradio', api);
