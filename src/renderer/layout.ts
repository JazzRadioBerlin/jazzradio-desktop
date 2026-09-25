import {
  VOLUME_STEP,
  WINDOW_MODES,
  isWindowMode,
  type WindowMode,
} from '../shared/window';
import { getVolume, setVolume, syncVolumeSliders } from './player';

/** Main has stated its mode; a settings snapshot must not override it. */
let confirmed = false;
let miniAvailable = false;

function applyMode(next: WindowMode): void {
  if (!isWindowMode(next)) return;
  const active = `mode-${next}`;
  WINDOW_MODES.forEach((candidate) => {
    if (candidate !== next) document.body.classList.remove(`mode-${candidate}`);
  });
  document.body.classList.add(active);
}

/** The startup hint from stored settings — never allowed to undo main's word. */
export function applyInitialMode(next: WindowMode): void {
  if (confirmed) return;
  applyMode(next);
}

function onModeChanged(next: WindowMode): void {
  confirmed = true;
  applyMode(next);
}

/**
 * Registered before anything else in boot: the mode listener must exist before
 * requesting main's confirmed mode. Main owns geometry; viewport changes do
 * not select a mode or trigger renderer-side recovery.
 */
export function initModeSync(): void {
  applyMiniAvailability(false);
  window.jazzradio.onModeChanged(onModeChanged);
  window.jazzradio.onMiniAvailabilityChanged(applyMiniAvailability);
  window.jazzradio.syncMode();
}

function applyMiniAvailability(available: boolean): void {
  miniAvailable = available;
  document.querySelectorAll<HTMLButtonElement>('.js-collapse').forEach((button) => {
    button.disabled = !available;
  });
}

export function initLayout(): void {
  document.querySelectorAll('.js-expand').forEach((button) => {
    button.addEventListener('click', () => {
      window.jazzradio.setMode('main');
    });
  });

  document.querySelectorAll('.js-collapse').forEach((button) => {
    button.addEventListener('click', () => {
      if (miniAvailable) window.jazzradio.setMode('mini');
    });
  });

  document.querySelectorAll<HTMLElement>('.layout-mini').forEach((root) => {
    root.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -VOLUME_STEP : VOLUME_STEP;
        setVolume(getVolume() + delta);
        syncVolumeSliders();
        window.jazzradio.setSettings({ volume: getVolume() });
      },
      { passive: false },
    );
  });
}
