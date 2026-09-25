export const WINDOW_MODES = ['mini', 'main'] as const;
export type WindowMode = (typeof WINDOW_MODES)[number];

export const CONTENT_SIZE: Record<WindowMode, { width: number; height: number }> = {
  mini: { width: 260, height: 324 },
  main: { width: 1152, height: 744 },
};

export const MAIN_MIN_SIZE = { width: 760, height: 520 };

export const VOLUME_STEP = 0.02;

export type ThemePreference = 'dark' | 'light' | 'system';
export type NotepadSkin = 'paper' | 'ink';

export type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function isRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Rectangle;
  return [rect.x, rect.y, rect.width, rect.height].every(
    (n) => typeof n === 'number' && Number.isFinite(n),
  ) && rect.width > 0 && rect.height > 0;
}

/** The same minimum is used for native constraints, restoration and saves. */
export function mainMinimum(area: Rectangle): { width: number; height: number } {
  return {
    width: Math.min(MAIN_MIN_SIZE.width, area.width),
    height: Math.min(MAIN_MIN_SIZE.height, area.height),
  };
}

export function validMainBounds(bounds: unknown, area: Rectangle): bounds is Rectangle {
  if (!isRectangle(bounds)) return false;
  const min = mainMinimum(area);
  // Manual placement may straddle displays; valid sizes do not require
  // the rectangle to fit within any one display.
  return bounds.width >= min.width && bounds.height >= min.height;
}

export type Settings = {
  mode: WindowMode;
  mainBounds?: Rectangle;
  theme: ThemePreference;
  language: 'system' | 'de' | 'en';
  /** Main-process resolved locale, included in IPC snapshots, never persisted. */
  readonly resolvedLanguage?: 'de' | 'en';
  notepadEnabled: boolean;
  notepadSkin: NotepadSkin;
  /** Mini only; retain the existing persisted preference key. */
  alwaysOnTopCompact: boolean;
  volume: number;
};

export const SETTINGS_DEFAULTS: Settings = {
  mode: 'main',
  theme: 'system',
  language: 'system',
  notepadEnabled: true,
  notepadSkin: 'paper',
  alwaysOnTopCompact: false,
  volume: 0.8,
};

export function isWindowMode(value: unknown): value is WindowMode {
  return value === 'mini' || value === 'main';
}
