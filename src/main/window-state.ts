import { Menu, screen, type BrowserWindow, type Rectangle } from 'electron';
import { Ipc } from '../shared/ipc';
import {
  CONTENT_SIZE,
  MAIN_MIN_SIZE,
  isRectangle,
  isWindowMode,
  mainMinimum,
  type WindowMode,
} from '../shared/window';
import { getSettings, updateWindowSettings } from './store';

let win: BrowserWindow | null = null;
let mode: WindowMode = 'main';
// Content coordinates, never the native fullscreen/zoom rectangle or mini frame.
let ordinaryMain: Rectangle | undefined;
// Moving between displays must not rewrite native constraints. Keep the
// installed ordinary minimum until an explicit main restore or recovery.
let ordinaryMinimum = { ...MAIN_MIN_SIZE };
let applying = false;
let resizing: 'manual' | 'native' | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let nativeCompletionCheck: ReturnType<typeof setImmediate> | undefined;
let displayRecoveryPending = false;
let detach: (() => void) | undefined;
let publishedAvailability: boolean | undefined;

function rounded(bounds: Rectangle): Rectangle {
  return {
    x: Math.round(bounds.x), y: Math.round(bounds.y),
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
}

function sameBounds(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function areaFor(bounds: Rectangle): Rectangle {
  return screen.getDisplayMatching(bounds).workArea;
}

/** A reachable piece of the top drag region is enough; spanning is intentional. */
function accessible(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const height = Math.min(bounds.y + 28, area.y + area.height) - Math.max(bounds.y, area.y);
    return width >= Math.min(80, bounds.width) && height >= 16;
  });
}

function recoveredBounds(bounds: Rectangle, next: WindowMode): Rectangle {
  const area = areaFor(bounds);
  const min = mainMinimum(area);
  const width = next === 'mini' ? CONTENT_SIZE.mini.width : Math.min(area.width, Math.max(min.width, bounds.width));
  const height = next === 'mini' ? CONTENT_SIZE.mini.height : Math.min(area.height, Math.max(min.height, bounds.height));
  return rounded({
    width, height,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  });
}

function restoredMain(): Rectangle {
  const saved = getSettings().mainBounds;
  // A valid rectangle may come from a formerly smaller display. Preserve its
  // placement and apply today's minimum instead of discarding it as corruption.
  if (isRectangle(saved)) return mainReturnBounds(saved);
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(CONTENT_SIZE.main.width, area.width);
  const height = Math.min(CONTENT_SIZE.main.height, area.height);
  return rounded({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height });
}

function miniBounds(main: Rectangle): Rectangle {
  const bounds = { x: main.x + main.width - CONTENT_SIZE.mini.width, y: main.y, ...CONTENT_SIZE.mini };
  return accessible(bounds) ? rounded(bounds) : recoveredBounds(bounds, 'mini');
}

function mainReturnBounds(main: Rectangle): Rectangle {
  const min = mainMinimum(areaFor(main));
  const desired = { ...main, width: Math.max(main.width, min.width), height: Math.max(main.height, min.height) };
  return accessible(desired) ? rounded(desired) : recoveredBounds(desired, 'main');
}

function frameExtra(target: BrowserWindow): { width: number; height: number } {
  const frame = target.getBounds();
  const content = target.getContentBounds();
  return { width: Math.max(0, frame.width - content.width), height: Math.max(0, frame.height - content.height) };
}

function trafficLightPosition(next: WindowMode): { x: number; y: number } {
  return next === 'mini' ? { x: 12, y: 14 } : { x: 16, y: 16 };
}

function applyAlwaysOnTop(target: BrowserWindow, next: WindowMode): void {
  const wanted = next === 'mini' && getSettings().alwaysOnTopCompact;
  if (target.isAlwaysOnTop() !== wanted) target.setAlwaysOnTop(wanted);
}

/** Only explicit presentation changes and inaccessible-display recovery call this. */
function applyGeometry(
  target: BrowserWindow, next: WindowMode, desired: Rectangle,
  min = next === 'main' ? mainMinimum(areaFor(desired)) : CONTENT_SIZE.mini,
): Rectangle {
  target.setResizable(true);
  target.setMinimumSize(0, 0);
  const extra = frameExtra(target);
  target.setMinimumSize(min.width + extra.width, min.height + extra.height);
  target.setContentBounds(desired, false);
  // Never install compact maxima: clearing them does not reliably clear the
  // native maximum in Electron 44.4.1 on macOS. Fixed bounds + nonresizability do.
  target.setResizable(next === 'main');
  applyAlwaysOnTop(target, next);
  if (process.platform === 'darwin') target.setWindowButtonPosition(trafficLightPosition(next));

  const actual = rounded(target.getContentBounds());
  const [minWidth, minHeight] = target.getMinimumSize();
  if (!sameBounds(actual, desired) || target.isResizable() !== (next === 'main') ||
      minWidth !== min.width + extra.width || minHeight !== min.height + extra.height) {
    throw new Error(`Window presentation did not apply in ${next} mode`);
  }
  return actual;
}

function ordinary(target: BrowserWindow): boolean {
  return mode === 'main' && !applying && !resizing && target.isNormal() && target.isResizable();
}

function validOrdinaryBounds(bounds: Rectangle): boolean {
  return isRectangle(bounds) && bounds.width >= ordinaryMinimum.width && bounds.height >= ordinaryMinimum.height;
}

export function canEnterMini(): boolean {
  const target = getAttachedWindow();
  return !!target && ordinary(target) && validOrdinaryBounds(target.getContentBounds());
}

function publishAvailability(target: BrowserWindow, force = false): void {
  const available = canEnterMini();
  const menuItem = Menu.getApplicationMenu()?.getMenuItemById('window-mini');
  if (menuItem) menuItem.enabled = available;
  if (force || available !== publishedAvailability) {
    target.webContents.send(Ipc.WindowMiniAvailabilityChanged, available);
    publishedAvailability = available;
  }
}

function publish(target: BrowserWindow): void {
  if (target.isDestroyed()) return;
  target.webContents.send(Ipc.WindowModeChanged, mode);
  publishAvailability(target, true);
}

function persistMain(): void {
  if (!ordinaryMain) return;
  try {
    updateWindowSettings({ mainBounds: ordinaryMain }, ordinaryMinimum);
  } catch (error) {
    console.error('Unable to save ordinary main window bounds', error);
  }
}

/** Capture only on a known ordinary observation, never in the persistence timer. */
function captureMain(target: BrowserWindow): boolean {
  if (!ordinary(target)) return false;
  const bounds = rounded(target.getContentBounds());
  if (!validOrdinaryBounds(bounds)) return false;
  ordinaryMain = bounds;
  return true;
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    persistMain();
  }, 250);
}

export function setWindowMode(next: WindowMode): void {
  const target = getAttachedWindow();
  if (!target || !isWindowMode(next)) return;
  if (next === mode) {
    publish(target);
    return;
  }
  // No queued shrink: an unavailable request ends here, even if a native
  // transition completes later. isResizable also rejects macOS fullscreen
  // transitions that isNormal alone cannot identify.
  if (applying || resizing || !target.isNormal() || (next === 'mini' && !canEnterMini())) {
    publishAvailability(target, true);
    return;
  }

  if (mode === 'main') captureMain(target);
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const previous = mode;
  const previousBounds = rounded(target.getContentBounds());
  const main = ordinaryMain ?? restoredMain();
  const desired = next === 'mini' ? miniBounds(previousBounds) : mainReturnBounds(main);
  applying = true;
  publishAvailability(target);
  let applied = false;
  try {
    const actual = applyGeometry(target, next, desired);
    mode = next;
    if (mode === 'main') {
      ordinaryMain = actual;
      ordinaryMinimum = mainMinimum(areaFor(desired));
    }
    applied = true;
  } catch (error) {
    console.error('Window presentation change failed', error);
    // One rollback belongs to this request only. Native observations never
    // retry it, and a newly entered native special state remains OS-owned.
    if (target.isNormal()) {
      try {
        applyGeometry(target, previous, previousBounds, previous === 'main' ? ordinaryMinimum : CONTENT_SIZE.mini);
      } catch (rollbackError) {
        console.error('Unable to roll back window presentation', rollbackError);
      }
    }
  } finally {
    applying = false;
  }
  if (applied) {
    try {
      updateWindowSettings({ mode, mainBounds: ordinaryMain }, ordinaryMinimum);
    } catch (error) {
      console.error('Unable to save window presentation', error);
    }
  }
  publish(target);
}

/** A display event alone is not permission to normalize a usable placement. */
function recoverInaccessibleWindow(target: BrowserWindow): void {
  if (!displayRecoveryPending) return;
  if (applying || resizing || !target.isNormal() || (mode === 'main' && !target.isResizable())) return;
  // A display change authorizes one attempt, including a deferred attempt at
  // native completion. Ordinary observations never create this authority.
  displayRecoveryPending = false;
  const current = rounded(target.getContentBounds());
  if (accessible(current)) return;
  applying = true;
  try {
    const actual = applyGeometry(target, mode, recoveredBounds(current, mode));
    if (mode === 'main') {
      ordinaryMain = actual;
      ordinaryMinimum = mainMinimum(areaFor(actual));
      persistMain();
    }
  } catch (error) {
    console.error('Unable to recover inaccessible window', error);
  } finally {
    applying = false;
  }
  publishAvailability(target);
}

export function attachWindow(target: BrowserWindow): void {
  detach?.();
  win = target;
  mode = getSettings().mode;
  ordinaryMain = restoredMain();
  ordinaryMinimum = mainMinimum(areaFor(ordinaryMain));
  applying = false;
  resizing = undefined;
  displayRecoveryPending = false;
  publishedAvailability = undefined;
  // The BrowserWindow constructor already applied initialWindowOptions().
  // Attaching listeners and renderer synchronization do not repeat geometry.
  captureMain(target);
  persistMain();

  const onWillResize = () => {
    if (applying) return;
    clearImmediate(nativeCompletionCheck);
    nativeCompletionCheck = undefined;
    resizing = 'manual';
    clearTimeout(saveTimer);
    saveTimer = undefined;
    publishAvailability(target);
  };
  const onResize = () => {
    if (applying) return;
    clearImmediate(nativeCompletionCheck);
    nativeCompletionCheck = undefined;
    const bounds = target.getContentBounds();
    if (!resizing && mode === 'main' && ordinaryMain &&
        (bounds.width !== ordinaryMain.width || bounds.height !== ordinaryMain.height)) resizing = 'native';
    // No capture during native size changes. A completion event, not elapsed
    // time, ends this guard. Delayed notifications of our committed bounds do
    // not invent a transition. Electron has no public zoom-start event; before
    // the first native observation the isNormal/isResizable gate is its limit.
    publishAvailability(target);
  };
  const onMove = () => {
    if (applying) return;
    const bounds = target.getContentBounds();
    if (ordinaryMain && bounds.width === ordinaryMain.width && bounds.height === ordinaryMain.height && captureMain(target)) scheduleSave();
    publishAvailability(target);
  };
  const onResized = () => {
    if (applying) return;
    // On macOS this event can precede maximize/unmaximize. It only establishes
    // ordinary resize completion when will-resize identified a manual gesture.
    if (resizing === 'manual') {
      resizing = undefined;
      if (captureMain(target)) scheduleSave();
      recoverInaccessibleWindow(target);
    } else if (resizing === 'native') {
      clearImmediate(nativeCompletionCheck);
      // Electron 44.4.1 emits resized immediately before its zoom completion
      // dispatch. Check next turn, after that dispatch, rather than treating
      // resized in isolation as ordinary geometry. This is event ordering,
      // not an animation-duration guess; the actual resized event is required.
      nativeCompletionCheck = setImmediate(() => {
        nativeCompletionCheck = undefined;
        if (target !== win || target.isDestroyed() || applying) return;
        resizing = undefined;
        if (captureMain(target)) scheduleSave();
        recoverInaccessibleWindow(target);
        publishAvailability(target);
      });
    }
    publishAvailability(target);
  };
  const onNativeCompletion = () => {
    if (applying) return;
    clearImmediate(nativeCompletionCheck);
    nativeCompletionCheck = undefined;
    resizing = undefined;
    recoverInaccessibleWindow(target);
    publishAvailability(target);
  };
  const onOrdinaryReturn = () => {
    onNativeCompletion();
    if (!applying && captureMain(target)) scheduleSave();
  };
  const onDisplayChanged = () => {
    displayRecoveryPending = true;
    recoverInaccessibleWindow(target);
  };
  const onClose = () => {
    // Flush a final move, but do not treat close as resize/zoom completion.
    const bounds = target.getContentBounds();
    if (ordinaryMain && bounds.width === ordinaryMain.width && bounds.height === ordinaryMain.height) captureMain(target);
    clearTimeout(saveTimer);
    saveTimer = undefined;
    clearImmediate(nativeCompletionCheck);
    nativeCompletionCheck = undefined;
    persistMain();
  };
  const cleanup = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    clearImmediate(nativeCompletionCheck);
    nativeCompletionCheck = undefined;
    target.removeListener('will-resize', onWillResize);
    target.removeListener('resize', onResize);
    target.removeListener('move', onMove);
    target.removeListener('resized', onResized);
    target.removeListener('enter-full-screen', onNativeCompletion);
    target.removeListener('maximize', onNativeCompletion);
    target.removeListener('minimize', onNativeCompletion);
    target.removeListener('leave-full-screen', onOrdinaryReturn);
    target.removeListener('unmaximize', onOrdinaryReturn);
    target.removeListener('restore', onOrdinaryReturn);
    target.removeListener('close', onClose);
    target.removeListener('closed', cleanup);
    screen.removeListener('display-metrics-changed', onDisplayChanged);
    screen.removeListener('display-removed', onDisplayChanged);
    if (win === target) {
      win = null;
      ordinaryMain = undefined;
      applying = false;
      resizing = undefined;
      displayRecoveryPending = false;
      detach = undefined;
    }
  };
  detach = cleanup;
  target.on('will-resize', onWillResize);
  target.on('resize', onResize);
  target.on('move', onMove);
  target.on('resized', onResized);
  target.on('enter-full-screen', onNativeCompletion);
  target.on('maximize', onNativeCompletion);
  target.on('minimize', onNativeCompletion);
  target.on('leave-full-screen', onOrdinaryReturn);
  target.on('unmaximize', onOrdinaryReturn);
  target.on('restore', onOrdinaryReturn);
  target.on('close', onClose);
  target.on('closed', cleanup);
  screen.on('display-metrics-changed', onDisplayChanged);
  screen.on('display-removed', onDisplayChanged);
  publishAvailability(target, true);
}

export function getWindowMode(): WindowMode { return mode; }

export function getAttachedWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function restoreRendererMode(): void {
  const target = getAttachedWindow();
  if (target) publish(target);
}

export function applyAlwaysOnTopFromSettings(): void {
  const target = getAttachedWindow();
  if (target) applyAlwaysOnTop(target, mode);
}

export function initialWindowOptions(): {
  x: number; y: number; width: number; height: number;
  minWidth: number; minHeight: number; resizable: boolean; alwaysOnTop: boolean;
  trafficLightPosition: { x: number; y: number };
} {
  const settings = getSettings();
  const main = restoredMain();
  const bounds = settings.mode === 'mini' ? miniBounds(main) : main;
  const min = settings.mode === 'main' ? mainMinimum(areaFor(bounds)) : CONTENT_SIZE.mini;
  return {
    ...bounds,
    minWidth: min.width,
    minHeight: min.height,
    resizable: settings.mode === 'main',
    alwaysOnTop: settings.mode === 'mini' && settings.alwaysOnTopCompact,
    trafficLightPosition: trafficLightPosition(settings.mode),
  };
}
