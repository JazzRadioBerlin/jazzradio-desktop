import { berlinClock, deNumericDate, type Note } from '../shared/export';
import type { Settings } from '../shared/window';
import { getCurrentTrack } from './nowplaying';
import { isPlaying, onPlaybackChange } from './player';
import { setPanel } from './playlist';
import { strings } from './strings';

let items: Note[] = [];

function notesRoot(): HTMLElement | null {
  return document.querySelector('.js-notes');
}

function composeField(): HTMLTextAreaElement | null {
  return document.querySelector('.js-note-compose');
}

function applySkin(settings: Settings): void {
  const root = notesRoot();
  if (!root) return;
  root.classList.toggle('papier', settings.notepadSkin === 'paper');
  root.classList.toggle('tinte', settings.notepadSkin === 'ink');
}

function applyVisibility(settings: Settings): void {
  const tab = document.querySelector<HTMLButtonElement>('.tab[data-panel="notizen"]');
  const enabled = settings.notepadEnabled;
  if (tab) {
    tab.hidden = !enabled;
    if (!enabled && tab.classList.contains('on')) setPanel('playlist');
  }
}

export function applyNotepadSettings(settings: Settings): void {
  applySkin(settings);
  applyVisibility(settings);
}

function syncComposeAnchor(): void {
  const node = document.querySelector('.js-anchor');
  if (!node) return;
  const track = isPlaying() ? getCurrentTrack() : null;
  node.textContent = track
    ? `${strings.noteAnchorPrefix}${track.title} — ${track.artist}`
    : strings.noteLive;
}

function noteAnchorText(note: Note): string {
  if (note.anchor) {
    const time = berlinClock(note.anchor.at);
    return time
      ? `${time} · ${note.anchor.title} — ${note.anchor.artist}`
      : `${note.anchor.title} — ${note.anchor.artist}`;
  }
  try {
    return deNumericDate(new Date(note.createdAt));
  } catch {
    return '';
  }
}

type NoteView = {
  note: Note;
  element: HTMLElement;
  body: HTMLParagraphElement;
  field: HTMLTextAreaElement;
  actions: HTMLElement;
  save: HTMLButtonElement;
  cancel: HTMLButtonElement;
  remove: HTMLButtonElement;
  anchor: HTMLElement;
  error: HTMLElement;
  errorKey?: 'noteSaveFailed' | 'noteDeleteFailed' | 'noteEmpty';
  editing: boolean;
  pending: boolean;
};

const views = new Map<string, NoteView>();
let composePending = false;
let composeError: HTMLElement | undefined;

function action(key: 'noteSave' | 'noteCancel'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'note-action';
  button.dataset.noteLabel = key;
  button.textContent = strings[key];
  return button;
}

function syncView(view: NoteView): void {
  view.body.textContent = view.note.text;
  view.body.hidden = view.editing;
  view.field.hidden = !view.editing;
  view.field.readOnly = view.pending;
  view.actions.hidden = !view.editing;
  view.body.setAttribute('aria-label', `${strings.noteEdit}: ${view.note.text}`);
  view.body.setAttribute('aria-disabled', String(view.pending));
  view.remove.disabled = view.pending;
  view.remove.title = strings.noteDelete;
  view.remove.setAttribute('aria-label', strings.noteDelete);
  view.save.hidden = view.cancel.hidden = !view.editing;
  for (const button of [view.save, view.cancel]) {
    button.disabled = view.pending;
    button.textContent = strings[button.dataset.noteLabel as 'noteSave' | 'noteCancel'];
  }
  view.field.setAttribute('aria-label', strings.noteText);
  view.anchor.textContent = noteAnchorText(view.note);
  view.error.textContent = view.errorKey ? strings[view.errorKey] : '';
  view.error.hidden = !view.errorKey;
  view.element.setAttribute('aria-busy', String(view.pending));
}

function closeEditor(view: NoteView): void {
  view.editing = false;
  view.errorKey = undefined;
  syncView(view);
  view.body.focus();
}

async function saveEdit(view: NoteView): Promise<void> {
  if (view.pending) return;
  if (!view.field.value.trim()) {
    view.errorKey = 'noteEmpty';
    syncView(view);
    view.field.focus();
    return;
  }
  view.pending = true;
  view.errorKey = undefined;
  syncView(view);
  try {
    const next = await window.jazzradio.updateNote(view.note.id, view.field.value);
    view.pending = false;
    apply(next);
    closeEditor(view);
  } catch {
    view.pending = false;
    view.errorKey = 'noteSaveFailed';
    syncView(view);
    view.field.focus();
  }
}

function noteRow(note: Note): NoteView {
  const element = document.createElement('div');
  element.className = 'note';
  const body = document.createElement('p');
  body.className = 'note-text';
  body.tabIndex = 0;
  body.setAttribute('role', 'button');
  const field = document.createElement('textarea');
  field.className = 'note-editor';
  field.rows = 4;
  field.maxLength = 8000;
  const save = action('noteSave');
  const cancel = action('noteCancel');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'note-delete';
  remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const actions = document.createElement('div');
  actions.className = 'note-actions';
  actions.append(save, cancel);
  const anchorRow = document.createElement('div');
  anchorRow.className = 'anchor';
  const dot = document.createElement('span');
  dot.className = 'dot';
  const anchor = document.createElement('span');
  anchorRow.append(dot, anchor);
  const error = document.createElement('div');
  error.className = 'note-error';
  error.setAttribute('role', 'status');
  const view: NoteView = {
    note, element, body, field, actions, save, cancel, remove, anchor, error,
    editing: false, pending: false,
  };
  const openEditor = () => {
    if (view.pending || view.editing) return;
    view.editing = true;
    view.errorKey = undefined;
    field.value = view.note.text;
    syncView(view);
    field.focus();
  };
  body.addEventListener('click', openEditor);
  body.addEventListener('keydown', (event) => {
    if (event.isComposing || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    openEditor();
  });
  save.addEventListener('click', () => { void saveEdit(view); });
  cancel.addEventListener('click', () => { closeEditor(view); });
  field.addEventListener('keydown', (event) => {
    if (event.isComposing || view.pending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeEditor(view);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveEdit(view);
    }
  });
  remove.addEventListener('click', async () => {
    if (view.pending) return;
    view.pending = true;
    view.errorKey = undefined;
    syncView(view);
    try {
      const next = await window.jazzradio.removeNote(view.note.id);
      apply(next);
      composeField()?.focus();
    } catch {
      view.pending = false;
      view.errorKey = 'noteDeleteFailed';
      syncView(view);
    }
  });
  element.append(body, field, anchorRow, actions, error, remove);
  syncView(view);
  return view;
}

function renderList(): void {
  const root = document.querySelector('.js-notes-list');
  if (!root) return;
  const ids = new Set(items.map((note) => note.id));
  for (const [id, view] of views) {
    if (!ids.has(id)) {
      view.element.remove();
      views.delete(id);
    }
  }
  // Reuse existing nodes: refreshes must not replace a focused editor or its draft.
  items.forEach((note, index) => {
    let view = views.get(note.id);
    if (!view) {
      view = noteRow(note);
      views.set(note.id, view);
    } else {
      view.note = note;
      syncView(view);
    }
    const at = root.children[index] ?? null;
    if (at !== view.element) root.insertBefore(view.element, at);
  });
}

function apply(next: Note[]): void {
  items = next;
  renderList();
}

/** Relabel in place without changing any textarea value, selection or focus. */
export function refreshNotesLocale(): void {
  syncComposeAnchor();
  composeField()?.setAttribute('aria-label', strings.noteText);
  for (const view of views.values()) syncView(view);
  if (composeError && !composeError.hidden) composeError.textContent = strings.noteSaveFailed;
}

async function saveCompose(): Promise<void> {
  const field = composeField();
  if (!field || composePending) return;
  const text = field.value.trim();
  if (!text) return;
  composePending = true;
  field.readOnly = true;
  if (composeError) composeError.hidden = true;
  try {
    apply(await window.jazzradio.addNote(text));
    field.value = '';
  } catch {
    if (composeError) {
      composeError.textContent = strings.noteSaveFailed;
      composeError.hidden = false;
    }
  } finally {
    composePending = false;
    field.readOnly = false;
  }
}

function bindCompose(): void {
  const field = composeField();
  if (!field) return;
  field.maxLength = 8000;
  field.setAttribute('aria-label', strings.noteText);
  composeError = document.createElement('div');
  composeError.className = 'note-error';
  composeError.setAttribute('role', 'status');
  composeError.hidden = true;
  field.after(composeError);
  field.addEventListener('keydown', (event) => {
    if (event.isComposing || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void saveCompose();
  });
}

function focusCompose(): void {
  const tab = document.querySelector<HTMLButtonElement>('.tab[data-panel="notizen"]');
  if (!tab || tab.hidden) return;
  setPanel('notizen');
  requestAnimationFrame(() => {
    composeField()?.focus();
  });
}

export function initNotes(settings: Settings): void {
  applyNotepadSettings(settings);
  syncComposeAnchor();
  bindCompose();
  window.jazzradio.onSettingsChanged(applyNotepadSettings);
  window.jazzradio.onNowPlaying(() => {
    syncComposeAnchor();
  });
  onPlaybackChange(() => {
    syncComposeAnchor();
  });
  window.jazzradio.onNotesChanged(apply);
  window.jazzradio.onNotesFocus(focusCompose);
  void window.jazzradio.listNotes().then(apply);
}
