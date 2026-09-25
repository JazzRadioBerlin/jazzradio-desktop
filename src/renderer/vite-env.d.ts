/// <reference types="vite/client" />

import type { JazzradioApi } from '../shared/api';

declare global {
  interface Window {
    jazzradio: JazzradioApi;
  }
}

export {};
