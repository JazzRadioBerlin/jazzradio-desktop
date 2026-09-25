import { app, clipboard, dialog, ShareMenu, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  berlinClock,
  deNumericDate,
  favoritesFilename,
  notesFilename,
  type Note,
  type ShareAction,
  type ShareKind,
} from '../shared/export';
import type { Favorite } from '../shared/favorite';
import { strings } from '../renderer/strings';
import { getFavorites, getNotes } from './store';
import { getAttachedWindow } from './window-state';

function formatFavoritesText(items: Favorite[]): string {
  return items
    .map((item) => {
      const added = deNumericDate(new Date(item.addedAt));
      return `${item.artist} – ${item.title} · ${strings.favoriteAdded} ${added}`;
    })
    .join('\n');
}

function formatNotesText(notes: Note[]): string {
  const heading = `${strings.appName} — ${strings.notes}`;
  const blocks = notes.map((note) => {
    const body = note.text;
    let anchor: string;
    if (note.anchor) {
      const time = berlinClock(note.anchor.at);
      const date = deNumericDate(new Date(note.createdAt));
      const line = time
        ? `${time} · ${note.anchor.title} — ${note.anchor.artist} · ${date}`
        : `${note.anchor.title} — ${note.anchor.artist} · ${date}`;
      anchor = line;
    } else {
      anchor = deNumericDate(new Date(note.createdAt));
    }
    return `${body}\n\n${anchor}`;
  });
  return `${[heading, ...blocks].join('\n\n')}\n`;
}

function payload(kind: ShareKind): { text: string; filename: string } {
  if (kind === 'notes') {
    return {
      text: formatNotesText(getNotes()),
      filename: notesFilename(),
    };
  }
  return {
    text: formatFavoritesText(getFavorites()),
    filename: favoritesFilename(),
  };
}

async function saveFile(text: string, filename: string): Promise<void> {
  const win = getAttachedWindow();
  const options = {
    title: strings.shareFile,
    buttonLabel: strings.noteSave,
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: strings.textFile, extensions: ['txt'] }],
  };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return;
  // The sandbox grant applies to the exact destination selected in the panel.
  await writeFile(result.filePath, text, 'utf8');
}

function showSheet(text: string): void {
  if (process.platform !== 'darwin') return;
  const win = getAttachedWindow();
  if (!win) return;
  const menu = new ShareMenu({ texts: [text] });
  menu.popup({ window: win });
}

export async function runShare(kind: ShareKind, action: ShareAction): Promise<void> {
  try {
    const { text, filename } = payload(kind);
    if (action === 'copy') {
      clipboard.writeText(text);
      return;
    }
    if (action === 'file') {
      await saveFile(text, filename);
      return;
    }
    if (action === 'sheet') {
      showSheet(text);
    }
  } catch {
    dialog.showErrorBox(
      action === 'file' ? strings.exportFailed : strings.shareFailed,
      action === 'file' ? strings.exportFailedDetail : strings.shareFailedDetail,
    );
  }
}

export function openGoogle(artist: string, title: string): void {
  const query = `${artist} ${title}`.trim();
  if (!query) return;
  void shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}
