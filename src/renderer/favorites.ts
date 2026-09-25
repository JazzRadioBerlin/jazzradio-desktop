import type { Favorite } from '../shared/favorite';
import { favoriteId } from '../shared/favorite';
import { favoriteListDate } from '../shared/export';
import type { PanelId, ShareAction, Track } from '../shared/ipc';
import { getCurrentTrack } from './nowplaying';
import { strings } from './strings';

const listeners = new Set<() => void>();

let items: Favorite[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

function apply(next: Favorite[]): void {
  items = next;
  syncCurrentHearts();
  renderList();
  notify();
}

export function onFavoritesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isHearted(artist: string, title: string): boolean {
  const id = favoriteId(artist, title);
  return items.some((item) => item.id === id);
}

export async function toggleFavoriteTrack(track: Track): Promise<void> {
  await window.jazzradio.toggleFavorite({
    artist: track.artist,
    title: track.title,
    artworkUrl: track.artworkUrl,
  });
}

function syncCurrentHearts(): void {
  const current = getCurrentTrack();
  const on = current ? isHearted(current.artist, current.title) : false;
  document.querySelectorAll('.js-heart').forEach((button) => {
    button.classList.toggle('hearted', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function thumb(url: string | undefined): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'tart';

  const placeholder = document.createElement('span');
  placeholder.className = 'ph';
  placeholder.innerHTML = '<svg><use href="#disc-mark"></use></svg>';
  wrap.append(placeholder);

  if (url) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      img.classList.add('is-loaded');
    });
    img.addEventListener('error', () => {
      img.remove();
    });
    img.src = url;
    wrap.append(img);
  }

  return wrap;
}

function favoriteRow(item: Favorite): HTMLElement {
  const el = document.createElement('div');
  el.className = 'trow';

  const info = document.createElement('span');
  info.className = 'tinfo';
  const title = document.createElement('span');
  title.className = 'ttitle';
  title.textContent = item.title;
  title.title = item.title;
  const artist = document.createElement('span');
  artist.className = 'tartist';
  artist.textContent = item.artist;
  artist.title = item.artist;
  info.append(title, artist);

  const actions = document.createElement('span');
  actions.className = 'tactions';

  const google = document.createElement('button');
  google.type = 'button';
  google.className = 'ibtn';
  google.title = strings.google;
  google.setAttribute('aria-label', strings.google);
  google.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#ic-search"></use></svg>';
  google.addEventListener('click', () => {
    window.jazzradio.searchGoogle({ artist: item.artist, title: item.title });
  });
  actions.append(google);

  const heart = document.createElement('button');
  heart.type = 'button';
  heart.className = 'ibtn hearted';
  heart.title = strings.favorite;
  heart.setAttribute('aria-label', strings.favorite);
  heart.setAttribute('aria-pressed', 'true');
  heart.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#ic-heart"></use></svg>';
  heart.addEventListener('click', () => {
    void toggleFavoriteTrack({
      artist: item.artist,
      title: item.title,
      artworkUrl: item.artworkUrl ?? null,
      startTime: null,
    });
  });

  const time = document.createElement('span');
  time.className = 'ttime';
  time.textContent = favoriteListDate(item.addedAt);

  el.append(thumb(item.artworkUrl), info, actions, heart, time);
  return el;
}

function renderList(): void {
  const root = document.querySelector('.js-favs');
  if (!root) return;
  const next = document.createDocumentFragment();
  items.forEach((item) => {
    next.append(favoriteRow(item));
  });
  root.replaceChildren(next);
}

function activePanel(): PanelId {
  const on = document.querySelector<HTMLElement>('.tab.on');
  const panel = on?.dataset.panel;
  if (panel === 'favoriten' || panel === 'notizen' || panel === 'playlist') return panel;
  return 'playlist';
}

function shareKind(): 'favorites' | 'notes' {
  return activePanel() === 'notizen' ? 'notes' : 'favorites';
}

function bindShare(): void {
  if (window.jazzradio.platform !== 'darwin') {
    document.querySelectorAll<HTMLElement>('.js-share-sheet').forEach((button) => {
      button.hidden = true;
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest('.js-share-toggle');
    const inMenu = target.closest('.sharemenu');
    document.querySelectorAll('.share.open').forEach((share) => {
      if (!toggle || share !== toggle.parentElement) share.classList.remove('open');
    });
    if (toggle) toggle.parentElement?.classList.toggle('open');
    if (inMenu) {
      inMenu.closest('.share')?.classList.remove('open');
      const button = target.closest('button');
      const action = button?.dataset.share;
      if (action === 'copy' || action === 'file' || action === 'sheet') {
        window.jazzradio.share({ kind: shareKind(), action: action as ShareAction });
      }
    }
  });
}

function bindCurrentActions(): void {
  document.querySelectorAll('.js-heart').forEach((button) => {
    button.addEventListener('click', () => {
      const track = getCurrentTrack();
      if (track) void toggleFavoriteTrack(track);
    });
  });

  document.querySelectorAll('.js-google').forEach((button) => {
    button.addEventListener('click', () => {
      const track = getCurrentTrack();
      if (track) window.jazzradio.searchGoogle({ artist: track.artist, title: track.title });
    });
  });
}

export function initFavorites(): void {
  bindCurrentActions();
  bindShare();
  window.jazzradio.onFavoritesChanged(apply);
  window.jazzradio.onNowPlaying(() => {
    syncCurrentHearts();
  });
  void window.jazzradio.listFavorites().then(apply);
}

export function refreshFavoritesLocale(): void { renderList(); }
