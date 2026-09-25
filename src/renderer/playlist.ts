import { berlinClock } from '../shared/export';
import type { PanelId, Track } from '../shared/ipc';
import { HISTORY_LIMIT } from '../shared/station';
import { sameTrack } from '../shared/track';
import { isHearted, onFavoritesChange, toggleFavoriteTrack } from './favorites';
import { strings } from './strings';

let current: Track | null = null;
let history: Track[] = [];

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return berlinClock(iso);
}

function thumb(url: string | null): HTMLElement {
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

function row(track: Track, isNow: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = isNow ? 'trow now' : 'trow';

  const info = document.createElement('span');
  info.className = 'tinfo';
  const title = document.createElement('span');
  title.className = 'ttitle';
  title.textContent = track.title;
  title.title = track.title;
  const artist = document.createElement('span');
  artist.className = 'tartist';
  artist.textContent = track.artist;
  artist.title = track.artist;
  info.append(title, artist);

  const actions = document.createElement('span');
  actions.className = 'tactions';

  const heart = document.createElement('button');
  heart.type = 'button';
  heart.className = isHearted(track.artist, track.title) ? 'ibtn hearted' : 'ibtn';
  heart.title = strings.favorite;
  heart.setAttribute('aria-label', strings.favorite);
  heart.setAttribute('aria-pressed', heart.classList.contains('hearted') ? 'true' : 'false');
  heart.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#ic-heart"></use></svg>';
  heart.addEventListener('click', () => {
    void toggleFavoriteTrack(track);
  });

  const google = document.createElement('button');
  google.type = 'button';
  google.className = 'ibtn';
  google.title = strings.google;
  google.setAttribute('aria-label', strings.google);
  google.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="#ic-search"></use></svg>';
  google.addEventListener('click', () => {
    window.jazzradio.searchGoogle({ artist: track.artist, title: track.title });
  });

  actions.append(heart, google);

  const time = document.createElement('span');
  time.className = 'ttime';
  time.textContent = isNow ? strings.now : formatTime(track.startTime);

  el.append(thumb(track.artworkUrl), info, actions, time);
  return el;
}

function playlistRows(): Track[] {
  const rows: Track[] = [];
  if (current) rows.push(current);
  for (const track of history) {
    if (current && sameTrack(track, current)) continue;
    rows.push(track);
    if (rows.length >= HISTORY_LIMIT) break;
  }
  return rows;
}

function render(): void {
  const root = document.querySelector('.js-playlist');
  if (!root) return;
  const next = document.createDocumentFragment();
  playlistRows().forEach((track, index) => {
    next.append(row(track, index === 0));
  });
  root.replaceChildren(next);
}

function bindTabs(): void {
  const tabs = document.querySelector('.tabs');
  if (!tabs) return;
  tabs.querySelectorAll<HTMLButtonElement>('.tab[data-panel]').forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.tab').forEach((other) => other.classList.remove('on'));
      tab.classList.add('on');
      const panels = tabs.parentElement?.querySelector('.panels');
      panels?.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
        panel.classList.toggle('on', panel.dataset.panel === tab.dataset.panel);
      });
      const share = tabs.querySelector<HTMLElement>('.tabshare');
      if (share) {
        share.classList.remove('open');
        share.hidden = tab.dataset.panel === 'playlist';
      }
    });
  });
}

export function setPanel(panel: PanelId): void {
  const tab = document.querySelector<HTMLButtonElement>(`.tab[data-panel="${panel}"]`);
  if (!tab || tab.hidden) return;
  tab.click();
}

export function initPlaylist(): void {
  bindTabs();
  onFavoritesChange(render);
  window.jazzradio.onNowPlaying((payload) => {
    current = payload.track;
    render();
  });
  window.jazzradio.onHistory((tracks) => {
    history = tracks;
    render();
  });
  window.jazzradio.onPanelSet(setPanel);
}

export function refreshPlaylistLocale(): void { render(); }
