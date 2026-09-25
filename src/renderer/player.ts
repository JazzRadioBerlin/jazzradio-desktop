import { DEFAULT_VOLUME, STREAM_URL } from '../shared/station';
import { strings } from './strings';

const RECONNECT_MS = [2_000, 5_000, 10_000];
const RECONNECT_THEN_MS = 15_000;

const listeners = new Set<(playing: boolean) => void>();

let audio: HTMLAudioElement | null = null;
let playing = false;
let volume = DEFAULT_VOLUME;
let reconnectTimer: number | undefined;
let reconnectAttempt = 0;

function notify(): void {
  for (const listener of listeners) listener(playing);
}

function applyPlayingClass(): void {
  document.body.classList.toggle('playing', playing);
}

function delayForAttempt(attempt: number): number {
  return RECONNECT_MS[attempt] ?? RECONNECT_THEN_MS;
}

function setInterrupted(on: boolean): void {
  document.body.classList.toggle('interrupted', on);
  document.querySelectorAll('.js-live').forEach((node) => {
    node.textContent = on ? strings.interrupted : strings.live;
  });
}

function clearReconnect(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function syncPlayback(next: boolean): void {
  playing = next;
  applyPlayingClass();
  window.jazzradio.setStreamState(next ? 'playing' : 'stopped');
  notify();
}

function scheduleReconnect(): void {
  if (!playing) return;
  setInterrupted(true);
  if (reconnectTimer !== undefined) return;
  const wait = delayForAttempt(reconnectAttempt);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    reconnectAttempt += 1;
    void startStream();
  }, wait);
}

async function startStream(): Promise<void> {
  if (!audio || !playing) return;
  audio.src = STREAM_URL;
  audio.volume = volume;
  try {
    await audio.play();
  } catch {
    scheduleReconnect();
  }
}

export function isPlaying(): boolean {
  return playing;
}

export function onPlaybackChange(listener: (playing: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function play(): Promise<void> {
  if (!audio) return;
  reconnectAttempt = 0;
  clearReconnect();
  syncPlayback(true);
  await startStream();
}

export function stop(): void {
  if (!audio) return;
  clearReconnect();
  syncPlayback(false);
  setInterrupted(false);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

export function toggle(): void {
  if (playing) {
    stop();
  } else {
    void play();
  }
}

export function reconnectNow(): void {
  if (!playing) return;
  reconnectAttempt = 0;
  clearReconnect();
  void startStream();
}

export function getVolume(): number {
  return volume;
}

export function setVolume(next: number): void {
  volume = Math.min(1, Math.max(0, next));
  if (audio) audio.volume = volume;
}

export function syncVolumeSliders(): void {
  const percent = String(Math.round(volume * 100));
  document.querySelectorAll<HTMLInputElement>('.js-vol').forEach((slider) => {
    slider.value = percent;
    slider.style.setProperty('--vol', `${percent}%`);
  });
}

function interactiveTarget(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return node.isContentEditable || !!node.closest(
    'button, input, textarea, select, a[href], summary, [tabindex]',
  );
}

export function initPlayer(): void {
  audio = document.querySelector<HTMLAudioElement>('#stream');
  if (!audio) return;
  audio.volume = volume;
  syncPlayback(false);

  audio.addEventListener('playing', () => {
    reconnectAttempt = 0;
    clearReconnect();
    setInterrupted(false);
  });
  audio.addEventListener('error', () => {
    if (playing) scheduleReconnect();
  });
  audio.addEventListener('stalled', () => {
    if (playing) scheduleReconnect();
  });
  audio.addEventListener('ended', () => {
    if (playing) scheduleReconnect();
  });

  document.querySelectorAll<HTMLButtonElement>('.js-play').forEach((button) => {
    button.addEventListener('click', () => {
      toggle();
    });
  });

  document.querySelectorAll<HTMLInputElement>('.js-vol').forEach((slider) => {
    slider.value = String(Math.round(volume * 100));
    slider.style.setProperty('--vol', `${slider.value}%`);
    slider.addEventListener('input', () => {
      slider.style.setProperty('--vol', `${slider.value}%`);
      setVolume(Number(slider.value) / 100);
      window.jazzradio.setSettings({ volume });
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.defaultPrevented || event.isComposing ||
        event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (interactiveTarget(document.activeElement)) return;
    event.preventDefault();
    toggle();
  });

  window.addEventListener('online', () => {
    if (playing) reconnectNow();
  });
  window.addEventListener('offline', () => {
    if (playing) setInterrupted(true);
  });

  window.jazzradio.onPlaybackToggle(() => {
    toggle();
  });
  window.jazzradio.onPlaybackReconnect(() => {
    reconnectNow();
  });
}

export function refreshPlayerLocale(): void {
  setInterrupted(document.body.classList.contains('interrupted'));
  const label = playing ? strings.pause : strings.play;
  document.querySelectorAll<HTMLButtonElement>('.js-play').forEach((button) => {
    button.title = label;
    button.setAttribute('aria-label', label);
  });
}
