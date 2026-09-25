import { getLocale, strings } from '../renderer/strings';
export type ShareKind = 'favorites' | 'notes';
export type ShareAction = 'copy' | 'file' | 'sheet';

export type NoteAnchor = {
  artist: string;
  title: string;
  at: string;
};

export type Note = {
  id: string;
  text: string;
  createdAt: string;
  anchor?: NoteAnchor;
};

function isAnchor(value: unknown): value is NoteAnchor {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as NoteAnchor;
  return (
    typeof anchor.artist === 'string' &&
    typeof anchor.title === 'string' &&
    typeof anchor.at === 'string'
  );
}

export function isNote(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const note = value as Note;
  return (
    typeof note.id === 'string' &&
    note.id.length > 0 &&
    typeof note.text === 'string' &&
    typeof note.createdAt === 'string' &&
    (note.anchor === undefined || isAnchor(note.anchor))
  );
}

function berlinParts(date: Date): { day: string; month: string; year: string } {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), year: get('year') };
}

export function deNumericDate(date: Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin',
  }).format(date);
}

function berlinDayStamp(date: Date): string {
  const { day, month, year } = berlinParts(date);
  return `${year}-${month}-${day}`;
}

const listDate = () => new Intl.DateTimeFormat(getLocale(), {
  dateStyle: 'short',
  timeZone: 'Europe/Berlin',
});

const berlinTime = () => new Intl.DateTimeFormat(getLocale(), {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
});

export function favoriteListDate(iso: string): string {
  try {
    return listDate().format(new Date(iso));
  } catch {
    return '';
  }
}

export function berlinClock(iso: string): string {
  try {
    return berlinTime().format(new Date(iso));
  } catch {
    return '';
  }
}

export function favoritesFilename(date = new Date()): string {
  return `${strings.favoritesFile}-${berlinDayStamp(date)}.txt`;
}

export function notesFilename(date = new Date()): string {
  return `${strings.notesFile}-${berlinDayStamp(date)}.txt`;
}
