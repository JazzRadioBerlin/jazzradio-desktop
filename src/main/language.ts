import { app } from 'electron';
import { getLanguage, resolveLanguage, setLanguage } from '../renderer/strings';
import { getSettings } from './store';
import type { Settings } from '../shared/window';

const listeners = new Set<() => void>();
export function onLanguageChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyLanguageFromSettings(): void {
  const language = resolveLanguage(getSettings().language, app.getPreferredSystemLanguages()[0] ?? app.getLocale());
  if (setLanguage(language)) for (const listener of listeners) listener();
}

export function getLocalizedSettings(): Settings {
  return { ...getSettings(), resolvedLanguage: getLanguage() };
}
