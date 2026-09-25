const de = {
  appName: 'JazzRadio',
  stationName: 'JazzRadio Berlin',
  connecting: 'Verbinde …',
  live: 'Live',
  liveBadge: 'LIVE',
  bitrate: '192\u200Akbps',
  play: 'Wiedergabe',
  playbackMenu: 'Wiedergabe',
  google: 'Bei Google suchen',
  favorite: 'Favorisieren',
  expand: 'Vergrößern',
  collapse: 'Verkleinern',
  settings: 'Einstellungen',
  playlist: 'Playlist',
  favorites: 'Favoriten',
  notes: 'Notizen',
  now: 'Jetzt',
  share: 'Teilen',
  shareCopy: 'Als Text kopieren',
  shareFile: 'Als Datei sichern …',
  shareSheet: 'Teilen …',
  exportFailed: 'Datei konnte nicht gespeichert werden',
  exportFailedDetail: 'Bitte wähle einen anderen Speicherort oder versuche es erneut.',
  shareFailed: 'Teilen fehlgeschlagen',
  shareFailedDetail: 'Bitte versuche es erneut.',
  favoriteAdded: 'hinzugefügt am',
  noteNew: 'Notiz schreiben',
  notePlaceholder: 'Notiz schreiben …',
  noteLive: 'Läuft gerade',
  noteAnchorPrefix: 'Wird angeheftet an: ',
  noteDelete: 'Löschen',
  settingsAppearance: 'Darstellung',
  settingsNotepad: 'Notizbuch',
  settingsWindow: 'Fenster',
  themeDark: 'Dunkel',
  themeLight: 'Hell',
  themeSystem: 'System',
  notepadShow: 'Notizbuch anzeigen',
  notepadPaper: 'Papier',
  notepadInk: 'Tinte',
  alwaysOnTop: 'Mini über allen Fenstern',
  pause: 'Pause',
  interrupted: 'Verbindung unterbrochen …',
  volume: 'Lautstärke',
  windowMenu: 'Fenster',
  modeMini: 'Mini',
  modeMain: 'Hauptfenster',
  settingsLanguage: 'Sprache', languageSystem: 'System', languageGerman: 'Deutsch', languageEnglish: 'English',
  noteEdit: 'Bearbeiten', noteSave: 'Speichern', noteCancel: 'Abbrechen',
  noteSaveFailed: 'Die Notiz konnte nicht gespeichert werden.', noteDeleteFailed: 'Die Notiz konnte nicht gelöscht werden.',
  noteEmpty: 'Bitte einen Text eingeben.', noteText: 'Notiztext',
  editMenu: 'Bearbeiten', undo: 'Rückgängig', redo: 'Wiederholen', cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einfügen', selectAll: 'Alles auswählen',
  helpMenu: 'Hilfe', reportBug: 'Fehler melden …', privacyPolicy: 'Datenschutzerklärung', about: 'Über JazzRadio',
  hide: 'JazzRadio ausblenden', hideOthers: 'Andere ausblenden', unhide: 'Alle einblenden', quit: 'JazzRadio beenden',
  favoritesFile: 'JazzRadio-Favoriten', notesFile: 'JazzRadio-Notizen', textFile: 'Text',
};

export type Language = 'de' | 'en';
export type LanguagePreference = 'system' | Language;
export type StringKey = keyof typeof de;
const en: Record<StringKey, string> = {
  appName: 'JazzRadio', stationName: 'JazzRadio Berlin', connecting: 'Connecting …', live: 'Live', liveBadge: 'LIVE', bitrate: '192\u200Akbps',
  play: 'Play', playbackMenu: 'Playback', google: 'Search Google', favorite: 'Favorite', expand: 'Expand', collapse: 'Collapse',
  settings: 'Settings', playlist: 'Playlist', favorites: 'Favorites', notes: 'Notes', now: 'Now',
  share: 'Share', shareCopy: 'Copy as text', shareFile: 'Save to file …', shareSheet: 'Share …', favoriteAdded: 'added on',
  exportFailed: 'Could not save the file', exportFailedDetail: 'Please choose another location or try again.',
  shareFailed: 'Could not share', shareFailedDetail: 'Please try again.',
  noteNew: 'Write a note', notePlaceholder: 'Write a note …', noteLive: 'Now playing', noteAnchorPrefix: 'Attached to: ', noteDelete: 'Delete',
  settingsAppearance: 'Appearance', settingsNotepad: 'Notepad', settingsWindow: 'Window', themeDark: 'Dark', themeLight: 'Light', themeSystem: 'System',
  notepadShow: 'Show notepad', notepadPaper: 'Paper', notepadInk: 'Ink', alwaysOnTop: 'Keep mini above other windows',
  pause: 'Pause', interrupted: 'Connection interrupted …', volume: 'Volume', windowMenu: 'Window', modeMini: 'Mini', modeMain: 'Main window',
  settingsLanguage: 'Language', languageSystem: 'System', languageGerman: 'Deutsch', languageEnglish: 'English',
  noteEdit: 'Edit', noteSave: 'Save', noteCancel: 'Cancel', noteSaveFailed: 'The note could not be saved.', noteDeleteFailed: 'The note could not be deleted.',
  noteEmpty: 'Please enter some text.', noteText: 'Note text', editMenu: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All', helpMenu: 'Help', reportBug: 'Report Bug …', privacyPolicy: 'Privacy Policy', about: 'About JazzRadio',
  hide: 'Hide JazzRadio', hideOthers: 'Hide Others', unhide: 'Show All', quit: 'Quit JazzRadio',
  favoritesFile: 'JazzRadio-Favorites', notesFile: 'JazzRadio-Notes', textFile: 'Text',
};
let language: Language = 'en';
/** Stable reference: modules read the current dictionary without recreating UI state. */
export const strings: Record<StringKey, string> = { ...en };
export function resolveLanguage(preference: LanguagePreference, osLocale: string): Language {
  if (preference === 'de' || preference === 'en') return preference;
  return /^de(?:[-_]|$)/i.test(osLocale) ? 'de' : 'en';
}
export function setLanguage(next: Language): boolean {
  if (next === language) return false;
  language = next;
  Object.assign(strings, next === 'de' ? de : en);
  return true;
}
export function getLanguage(): Language { return language; }
export function getLocale(): string { return language === 'de' ? 'de-DE' : 'en-GB'; }
