import type { Settings, ThemePreference } from '../shared/window';
import { strings } from './strings';

let preference: ThemePreference = 'system';
let systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

export function applyResolvedTheme(theme: ThemePreference, dark: boolean): void {
  preference = theme;
  systemDark = dark;
  const hell = theme === 'light' || (theme === 'system' && !dark);
  document.body.classList.toggle('hell', hell);
}

export function applyThemePreference(theme: ThemePreference): void {
  applyResolvedTheme(theme, systemDark);
}

function setToggle(button: HTMLElement | null, on: boolean, label: string): void {
  if (!button) return;
  button.classList.toggle('on', on);
  button.setAttribute('aria-checked', on ? 'true' : 'false');
  button.setAttribute('aria-label', label);
}

function sync(settings: Settings): void {
  document.querySelectorAll<HTMLButtonElement>('.js-language [data-language]').forEach((button) => {
    const on = button.dataset.language === settings.language;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll<HTMLButtonElement>('.js-theme [data-theme]').forEach((button) => {
    const on = button.dataset.theme === settings.theme;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll<HTMLButtonElement>('.js-notepad-skin [data-skin]').forEach((button) => {
    const on = button.dataset.skin === settings.notepadSkin;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const skin = document.querySelector('.js-notepad-skin');
  skin?.classList.toggle('is-disabled', !settings.notepadEnabled);
  skin?.setAttribute('aria-disabled', settings.notepadEnabled ? 'false' : 'true');
  setToggle(
    document.querySelector('.js-notepad-enabled'),
    settings.notepadEnabled,
    strings.notepadShow,
  );
  setToggle(
    document.querySelector('.js-always-on-top'),
    settings.alwaysOnTopCompact,
    strings.alwaysOnTop,
  );
  applyThemePreference(settings.theme);
}

function openSettings(): void {
  document.body.classList.add('settings-open');
  const gear = document.querySelector('.js-settings');
  gear?.classList.add('on');
  gear?.setAttribute('aria-pressed', 'true');
}

function closeSettings(): void {
  document.body.classList.remove('settings-open');
  const gear = document.querySelector('.js-settings');
  gear?.classList.remove('on');
  gear?.setAttribute('aria-pressed', 'false');
}

function isOpen(): boolean {
  return document.body.classList.contains('settings-open');
}

export function initSettings(settings: Settings): void {
  sync(settings);
  applyResolvedTheme(settings.theme, systemDark);

  document.querySelector('.js-settings')?.setAttribute('aria-pressed', 'false');

  document.querySelector('.js-settings')?.addEventListener('click', () => {
    if (isOpen()) closeSettings();
    else openSettings();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.repeat || !isOpen()) return;
    event.preventDefault();
    closeSettings();
  });

  document.querySelectorAll<HTMLButtonElement>('.js-theme [data-theme]').forEach((button) => {
    button.addEventListener('click', () => {
      const theme = button.dataset.theme;
      if (theme === 'dark' || theme === 'light' || theme === 'system') {
        window.jazzradio.setSettings({ theme });
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('.js-notepad-skin [data-skin]').forEach((button) => {
    button.addEventListener('click', () => {
      if (document.querySelector('.js-notepad-skin')?.classList.contains('is-disabled')) return;
      const skin = button.dataset.skin;
      if (skin === 'paper' || skin === 'ink') {
        window.jazzradio.setSettings({ notepadSkin: skin });
      }
    });
  });

  document.querySelector('.js-notepad-enabled')?.addEventListener('click', () => {
    const on = document.querySelector('.js-notepad-enabled')?.classList.contains('on');
    window.jazzradio.setSettings({ notepadEnabled: !on });
  });

  document.querySelector('.js-always-on-top')?.addEventListener('click', () => {
    const on = document.querySelector('.js-always-on-top')?.classList.contains('on');
    window.jazzradio.setSettings({ alwaysOnTopCompact: !on });
  });

  document.querySelectorAll<HTMLButtonElement>('.js-language [data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset.language;
      if (language === 'system' || language === 'de' || language === 'en') window.jazzradio.setSettings({ language });
    });
  });

  window.jazzradio.onSettingsChanged(sync);
  window.jazzradio.onThemeResolved((dark) => {
    applyResolvedTheme(preference, dark);
  });
  window.jazzradio.onPanelSet(() => {
    if (isOpen()) closeSettings();
  });
  window.jazzradio.onNotesFocus(() => {
    if (isOpen()) closeSettings();
  });
  window.jazzradio.onModeChanged((mode) => {
    if (mode !== 'main' && isOpen()) closeSettings();
  });
}
