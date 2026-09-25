import type { ShareAction, ShareKind } from './export';

export type { Favorite, FavoriteDraft } from './favorite';
export type { Note, NoteAnchor, ShareAction, ShareKind } from './export';

export const Ipc = {
  NowPlayingUpdate: 'nowplaying:update',
  HistoryUpdate: 'history:update',
  StreamState: 'stream:state',
  WindowSetMode: 'window:set-mode',
  WindowModeChanged: 'window:mode-changed',
  WindowMiniAvailabilityChanged: 'window:mini-availability-changed',
  /** Renderer asks main to re-state the authoritative mode. */
  WindowSyncMode: 'window:sync-mode',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SettingsChanged: 'settings:changed',
  PlaybackToggle: 'playback:toggle',
  PlaybackReconnect: 'playback:reconnect',
  FavoritesList: 'favorites:list',
  FavoritesToggle: 'favorites:toggle',
  FavoritesChanged: 'favorites:changed',
  ExternalGoogle: 'external:google',
  ShareMenu: 'share:menu',
  PanelSet: 'panel:set',
  NotesList: 'notes:list',
  NotesAdd: 'notes:add',
  NotesUpdate: 'notes:update',
  NotesRemove: 'notes:remove',
  NotesChanged: 'notes:changed',
  NotesFocus: 'notes:focus',
  ThemeResolved: 'theme:resolved',
} as const;

export type StreamState = 'playing' | 'stopped';

export type Track = {
  artist: string;
  title: string;
  artworkUrl: string | null;
  startTime: string | null;
};

export type NowPlayingPayload = {
  track: Track;
  artworkLarge: string | null;
};

export type GoogleQuery = {
  artist: string;
  title: string;
};

export type ShareRequest = {
  kind: ShareKind;
  action: ShareAction;
};

export type PanelId = 'playlist' | 'favoriten' | 'notizen';
