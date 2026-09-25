import { app } from 'electron';

// Keep the identity used by shipped builds before the display-name change.
// Electron derives userData/sessionData and macOS Safe Storage's service and
// account from this internal name. Renaming those would strand existing data
// and choose a different encryption key. This does not set the OS display name.
// Import before application modules can open stores or Chromium sessions.
app.setName('JazzRadio Berlin');
