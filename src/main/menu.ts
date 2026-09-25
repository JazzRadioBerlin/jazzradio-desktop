import { Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import { strings } from '../renderer/strings';
import { Ipc } from '../shared/ipc';
import { focusNotesComposer, getStreamState, setRendererPanel, toggleFavoriteAndNotify } from './ipc';
import { getLastNowPlaying } from './poller';
import { openGoogle } from './share';
import { canEnterMini, getAttachedWindow, setWindowMode } from './window-state';
import { onLanguageChanged } from './language';

function favoriteCurrent(): void {
  const track = getLastNowPlaying()?.track;
  if (!track) return;
  toggleFavoriteAndNotify({
    artist: track.artist,
    title: track.title,
    artworkUrl: track.artworkUrl,
  });
}

function googleCurrent(): void {
  const track = getLastNowPlaying()?.track;
  if (!track) return;
  openGoogle(track.artist, track.title);
}

function sendPlaybackToggle(): void {
  const win = getAttachedWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(Ipc.PlaybackToggle);
}

export function refreshDockMenu(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  const track = getLastNowPlaying()?.track;
  const line = track ? `${track.artist} – ${track.title}` : strings.connecting;
  const playing = getStreamState() === 'playing';
  app.dock.setMenu(
    Menu.buildFromTemplate([
      { label: line, enabled: false },
      { type: 'separator' },
      {
        label: playing ? strings.pause : strings.play,
        click: () => sendPlaybackToggle(),
      },
    ]),
  );
}

export function setAppMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: strings.appName,
            submenu: [
              { role: 'about' as const, label: strings.about },
              { type: 'separator' as const },
              { role: 'hide' as const, label: strings.hide },
              { role: 'hideOthers' as const, label: strings.hideOthers },
              { role: 'unhide' as const, label: strings.unhide },
              { type: 'separator' as const },
              { role: 'quit' as const, label: strings.quit },
            ],
          },
        ]
      : []),
    {
      label: strings.editMenu,
      submenu: [
        { role: 'undo', label: strings.undo },
        { role: 'redo', label: strings.redo },
        { type: 'separator' },
        { role: 'cut', label: strings.cut },
        { role: 'copy', label: strings.copy },
        { role: 'paste', label: strings.paste },
        { role: 'selectAll', label: strings.selectAll },
      ],
    },
    {
      label: strings.playbackMenu,
      submenu: [
        {
          label: strings.play,
          accelerator: 'Space',
          registerAccelerator: false,
          click: () => sendPlaybackToggle(),
        },
        { type: 'separator' },
        {
          label: strings.favorite,
          accelerator: 'CommandOrControl+F',
          click: () => favoriteCurrent(),
        },
        {
          label: strings.google,
          accelerator: 'CommandOrControl+G',
          click: () => googleCurrent(),
        },
        {
          label: strings.noteNew,
          accelerator: 'CommandOrControl+N',
          click: () => focusNotesComposer(),
        },
      ],
    },
    {
      label: strings.windowMenu,
      submenu: [
        {
          label: strings.playlist,
          accelerator: 'CommandOrControl+1',
          click: () => setRendererPanel('playlist'),
        },
        {
          label: strings.favorites,
          accelerator: 'CommandOrControl+2',
          click: () => setRendererPanel('favoriten'),
        },
        {
          label: strings.notes,
          accelerator: 'CommandOrControl+3',
          click: () => setRendererPanel('notizen'),
        },
        { type: 'separator' },
        {
          id: 'window-mini',
          label: strings.modeMini,
          enabled: canEnterMini(),
          accelerator: 'Alt+CommandOrControl+2',
          click: () => setWindowMode('mini'),
        },
        {
          id: 'window-main',
          label: strings.modeMain,
          accelerator: 'Alt+CommandOrControl+3',
          click: () => setWindowMode('main'),
        },
      ],
    },
    {
      label: strings.helpMenu,
      role: 'help',
      submenu: [
        {
          label: strings.reportBug,
          click: () => {
            void shell.openExternal('mailto:info@jazzradio.net').catch((error: unknown) => {
              console.error('Could not open the bug-report email draft', error);
            });
          },
        },
        {
          label: strings.privacyPolicy,
          click: () => {
            void shell.openExternal('https://jazzradio.net/datenschutzerklaerung/').catch((error: unknown) => {
              console.error('Could not open the privacy policy', error);
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  refreshDockMenu();
}

onLanguageChanged(setAppMenu);
