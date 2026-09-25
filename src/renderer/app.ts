import './styles/tokens.css';
import './styles/app.css';
import { getLanguage, resolveLanguage, setLanguage, strings } from './strings';
import { initPlayer, onPlaybackChange, refreshPlayerLocale, setVolume, syncVolumeSliders } from './player';
import { initNowPlaying, refreshNowPlayingLocale } from './nowplaying';
import { initPlaylist, refreshPlaylistLocale } from './playlist';
import { initFavorites, refreshFavoritesLocale } from './favorites';
import { initNotes, refreshNotesLocale } from './notes';
import { applyThemePreference, initSettings } from './settings';
import { applyInitialMode, initLayout, initModeSync } from './layout';

function translateDocument(): void {
  document.documentElement.lang = getLanguage();
  document.title = strings.appName;

  const title = document.querySelector('[data-app-title]');
  if (title) title.textContent = strings.appName;

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n as keyof typeof strings;
    if (key in strings) node.textContent = strings[key];
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle as keyof typeof strings;
    if (key in strings) {
      node.title = strings[key];
      node.setAttribute('aria-label', strings[key]);
    }
  });

  document.querySelectorAll<HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder as keyof typeof strings;
    if (key in strings) node.placeholder = strings[key];
  });

}

async function boot(): Promise<void> {
  // First, before any await and before anything that could throw: the window
  // mode is main's to decide, and the renderer must never miss it being said.
  initModeSync();
  document.body.classList.toggle('platform-win32', window.jazzradio.platform === 'win32');

  const settings = await window.jazzradio.getSettings();
  setLanguage(settings.resolvedLanguage ?? resolveLanguage(settings.language, navigator.language));
  applyThemePreference(settings.theme);
  applyInitialMode(settings.mode);
  setVolume(settings.volume);
  syncVolumeSliders();

  translateDocument();

  document.querySelectorAll('button svg').forEach((svg) => {
    svg.setAttribute('aria-hidden', 'true');
  });

  initPlayer();
  initNowPlaying();
  initPlaylist();
  initFavorites();
  initNotes(settings);
  window.jazzradio.onSettingsChanged((next) => {
    if (!setLanguage(next.resolvedLanguage ?? resolveLanguage(next.language, navigator.language))) return;
    translateDocument();
    refreshNowPlayingLocale();
    refreshPlayerLocale();
    refreshPlaylistLocale();
    refreshFavoritesLocale();
    refreshNotesLocale();
  });
  initSettings(settings);
  initLayout();

  const syncPlayLabel = (playing: boolean) => {
    const label = playing ? strings.pause : strings.play;
    document.querySelectorAll<HTMLButtonElement>('.js-play').forEach((button) => {
      button.title = label;
      button.setAttribute('aria-label', label);
    });
  };
  syncPlayLabel(false);

  onPlaybackChange((playing) => {
    syncPlayLabel(playing);
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  });

  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('occluded', document.hidden);
  });
}

void boot();
