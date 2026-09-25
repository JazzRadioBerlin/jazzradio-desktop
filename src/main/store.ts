import Store from 'electron-store';
import { screen } from 'electron';
import { randomUUID } from 'node:crypto';
import { isNote, type Note, type NoteAnchor } from '../shared/export';
import { favoriteId, isFavorite, type Favorite, type FavoriteDraft } from '../shared/favorite';
import {
  SETTINGS_DEFAULTS,
  isWindowMode,
  isRectangle,
  mainMinimum,
  type Rectangle,
  type Settings,
} from '../shared/window';

type SettingsFile = {
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
};

let store: SettingsFile | undefined;

function settingsStore(): SettingsFile {
  if (!store) {
    store = new Store<Settings>({
      name: 'settings',
      defaults: SETTINGS_DEFAULTS,
    }) as unknown as SettingsFile;
    // Legacy presentation migration: leave geometry and every other key intact.
    const savedMode: unknown = store.get('mode');
    if (savedMode === 'strip') {
      try {
        store.set('mode', 'main');
      } catch (error) {
        // Reads still resolve legacy mode to main; do not block startup or retry.
        console.error('Unable to migrate legacy window mode', error);
      }
    }
  }
  return store;
}

function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const next: Partial<Settings> = {};
  if (patch.language === 'system' || patch.language === 'de' || patch.language === 'en') {
    next.language = patch.language;
  }
  if (patch.theme === 'dark' || patch.theme === 'light' || patch.theme === 'system') {
    next.theme = patch.theme;
  }
  if (typeof patch.notepadEnabled === 'boolean') next.notepadEnabled = patch.notepadEnabled;
  if (patch.notepadSkin === 'paper' || patch.notepadSkin === 'ink') {
    next.notepadSkin = patch.notepadSkin;
  }
  if (typeof patch.alwaysOnTopCompact === 'boolean') {
    next.alwaysOnTopCompact = patch.alwaysOnTopCompact;
  }
  if (typeof patch.volume === 'number' && Number.isFinite(patch.volume)) {
    next.volume = Math.min(1, Math.max(0, patch.volume));
  }
  return next;
}

export function getSettings(): Settings {
  const current = settingsStore();
  const mode = current.get('mode');
  const volume = current.get('volume');
  const mainBounds = current.get('mainBounds');
  const theme = current.get('theme');
  const language = current.get('language');
  const notepadSkin = current.get('notepadSkin');
  return {
    mode: isWindowMode(mode) ? mode : SETTINGS_DEFAULTS.mode,
    mainBounds: isRectangle(mainBounds) ? mainBounds : undefined,
    theme: theme === 'dark' || theme === 'light' || theme === 'system' ? theme : SETTINGS_DEFAULTS.theme,
    language: language === 'de' || language === 'en' ? language : 'system',
    notepadEnabled: current.get('notepadEnabled') ?? SETTINGS_DEFAULTS.notepadEnabled,
    notepadSkin: notepadSkin === 'paper' || notepadSkin === 'ink' ? notepadSkin : SETTINGS_DEFAULTS.notepadSkin,
    alwaysOnTopCompact: current.get('alwaysOnTopCompact') ?? SETTINGS_DEFAULTS.alwaysOnTopCompact,
    volume:
      typeof volume === 'number' && Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : SETTINGS_DEFAULTS.volume,
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const cleaned = sanitize(patch);
  const current = settingsStore();
  (Object.keys(cleaned) as (keyof Settings)[]).forEach((key) => {
    const value = cleaned[key];
    if (value !== undefined) current.set(key, value as Settings[typeof key]);
  });
  return getSettings();
}

/** Geometry is writable only by the main window controller, never settings IPC. */
export function updateWindowSettings(
  patch: { mode?: Settings['mode']; mainBounds?: Rectangle },
  ordinaryMinimum?: { width: number; height: number },
): void {
  if (patch.mainBounds !== undefined) {
    const bounds = patch.mainBounds;
    if (!isRectangle(bounds)) throw new Error('Refusing invalid main window bounds');
    // The controller may supply the minimum actually installed for its known
    // ordinary snapshot. Moving from a small display does not change that
    // policy until explicit main restoration; this provenance is never IPC input.
    const min = ordinaryMinimum ?? mainMinimum(screen.getDisplayMatching(bounds).workArea);
    if (!isRectangle({ x: 0, y: 0, ...min }) || bounds.width < min.width || bounds.height < min.height) {
      throw new Error('Refusing invalid main window bounds');
    }
  }
  const current = settingsStore();
  if (patch.mainBounds) current.set('mainBounds', patch.mainBounds);
  if (isWindowMode(patch.mode)) current.set('mode', patch.mode);
}

type FavoritesFile = {
  get(key: 'items'): unknown;
  set(key: 'items', value: Favorite[]): void;
};

let favorites: FavoritesFile | undefined;

function favoritesStore(): FavoritesFile {
  if (!favorites) {
    favorites = new Store({
      name: 'favorites',
      defaults: { items: [] as Favorite[] },
    }) as unknown as FavoritesFile;
  }
  return favorites;
}

function sanitizeFavorites(value: unknown): Favorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: Favorite[] = [];
  for (const entry of value) {
    if (!isFavorite(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push({
      id: entry.id,
      artist: entry.artist,
      title: entry.title,
      addedAt: entry.addedAt,
      ...(entry.artworkUrl ? { artworkUrl: entry.artworkUrl } : {}),
    });
  }
  return items;
}

export function getFavorites(): Favorite[] {
  return sanitizeFavorites(favoritesStore().get('items'));
}

export function toggleFavorite(draft: FavoriteDraft): Favorite[] {
  const artist = draft.artist.trim();
  const title = draft.title.trim();
  const id = favoriteId(artist, title);
  const items = getFavorites();
  if (!id) return items;

  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) {
    items.splice(index, 1);
    favoritesStore().set('items', items);
    return items;
  }

  const artwork = draft.artworkUrl?.trim();
  const next: Favorite = {
    id,
    artist,
    title,
    addedAt: new Date().toISOString(),
    ...(artwork ? { artworkUrl: artwork } : {}),
  };
  const updated = [next, ...items];
  favoritesStore().set('items', updated);
  return updated;
}

type NotesFile = {
  get(key: 'items'): unknown;
  set(key: 'items', value: Note[]): void;
};

let notes: NotesFile | undefined;

function notesStore(): NotesFile {
  if (!notes) {
    notes = new Store({
      name: 'notes',
      defaults: { items: [] as Note[] },
    }) as unknown as NotesFile;
  }
  return notes;
}

function sanitizeNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: Note[] = [];
  for (const entry of value) {
    if (!isNote(entry) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    items.push({
      id: entry.id,
      text: entry.text,
      createdAt: entry.createdAt,
      ...(entry.anchor ? { anchor: entry.anchor } : {}),
    });
  }
  return items;
}

export function getNotes(): Note[] {
  return sanitizeNotes(notesStore().get('items'));
}

export function addNote(text: string, anchor?: NoteAnchor): Note[] {
  const body = text.trim();
  if (!body) return getNotes();
  const createdAt = new Date().toISOString();
  const next: Note = {
    id: randomUUID(),
    text: body.slice(0, 8000),
    createdAt,
    ...(anchor ? { anchor } : {}),
  };
  const updated = [next, ...getNotes()];
  notesStore().set('items', updated);
  return updated;
}

export function updateNote(id: string, text: string): Note[] {
  const body = text.trim();
  if (!body || body.length > 8000) throw new Error('Invalid note text');
  const items = getNotes();
  const index = items.findIndex((note) => note.id === id);
  if (index < 0) throw new Error('Note no longer exists');
  items[index] = { ...items[index], text: body };
  notesStore().set('items', items);
  return items;
}

export function removeNote(id: string): Note[] {
  const items = getNotes().filter((note) => note.id !== id);
  notesStore().set('items', items);
  return items;
}
