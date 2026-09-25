import './app-identity';
import { applyLanguageFromSettings } from './language';
import { app, BrowserWindow, powerMonitor } from 'electron';
import path from 'node:path';
import { Ipc } from '../shared/ipc';
import { strings } from '../renderer/strings';
import { getStreamState, onStreamStateChanged, registerIpc, setStreamState } from './ipc';
import { refreshDockMenu, setAppMenu } from './menu';
import { onAfterNowPlaying, refreshNow, replayLast, startPoller, stopPoller } from './poller';
import { applyThemeFromSettings, initialBackgroundColor, watchTheme, windowsTitleBarOverlay } from './theme';
import {
  attachWindow,
  getAttachedWindow,
  initialWindowOptions,
  restoreRendererMode,
} from './window-state';

registerIpc();

let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function requestReconnect(): void {
  if (getStreamState() !== 'playing') return;
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.PlaybackReconnect);
  refreshNow();
}

function createWindow(): void {
  const initial = initialWindowOptions();
  mainWindow = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
    minWidth: initial.minWidth,
    minHeight: initial.minHeight,
    resizable: initial.resizable,
    alwaysOnTop: initial.alwaysOnTop,
    useContentSize: true,
    backgroundColor: initialBackgroundColor(),
    title: strings.appName,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: windowsTitleBarOverlay(),
      autoHideMenuBar: true,
    } : {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: initial.trafficLightPosition,
    }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  attachWindow(mainWindow);

  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) return;
    startPoller(mainWindow);
    replayLast(mainWindow);
    restoreRendererMode();
    applyThemeFromSettings();
    refreshDockMenu();
    if (!mainWindow.isVisible()) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    stopPoller();
    mainWindow = null;
    setStreamState('stopped');
  });
}

app.on('ready', () => {
  applyLanguageFromSettings();
  app.setAboutPanelOptions({ applicationName: strings.appName });
  watchTheme();
  setAppMenu();
  onStreamStateChanged(() => refreshDockMenu());
  onAfterNowPlaying(() => refreshDockMenu());
  powerMonitor.on('resume', () => {
    requestReconnect();
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
