import { nativeTheme } from 'electron';
import { Ipc } from '../shared/ipc';
import { getSettings } from './store';
import { getAttachedWindow } from './window-state';

const DARK_BG = '#16140f';
const LIGHT_BG = '#ffffff';

export function resolvedDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

export function windowsTitleBarOverlay(): Electron.TitleBarOverlayOptions {
  return {
    color: resolvedDark() ? DARK_BG : LIGHT_BG,
    symbolColor: resolvedDark() ? '#f2efe6' : '#16140f',
    height: 46,
  };
}

function paintWindow(): void {
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(resolvedDark() ? DARK_BG : LIGHT_BG);
  if (process.platform === 'win32') win.setTitleBarOverlay(windowsTitleBarOverlay());
}

export function emitThemeResolved(): void {
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.ThemeResolved, resolvedDark());
}

export function applyThemeFromSettings(): void {
  nativeTheme.themeSource = getSettings().theme;
  paintWindow();
  emitThemeResolved();
}

export function watchTheme(): void {
  nativeTheme.on('updated', () => {
    paintWindow();
    emitThemeResolved();
  });
}

export function initialBackgroundColor(): string {
  nativeTheme.themeSource = getSettings().theme;
  return resolvedDark() ? DARK_BG : LIGHT_BG;
}
