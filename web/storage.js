// セーブ・ロード・リセット。
// ゲームは必ずこのモジュール経由で保存する（アプリ化の際は、保存先を
// Capacitor Preferences や Electron のファイル保存に差し替えられるようにするため）。
import { NEW_GAME } from './data.js';

const SAVE_KEY = 'essence-labyrinth/save/v1';
const SETTINGS_KEY = 'essence-labyrinth/settings/v1';

// 保存先。localStorage が使えない環境（プライベートモード等）ではメモリに保持する
const memory = {};
const backend = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return memory[key] ?? null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { memory[key] = value; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { delete memory[key]; }
  },
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function hasSave() {
  return backend.get(SAVE_KEY) !== null;
}

export function loadGame() {
  const raw = backend.get(SAVE_KEY);
  if (!raw) return clone(NEW_GAME);
  try {
    // 新しい項目が増えても古いセーブを読めるよう、初期値に上書きする
    return { ...clone(NEW_GAME), ...JSON.parse(raw) };
  } catch {
    return clone(NEW_GAME);
  }
}

export function saveGame(data) {
  backend.set(SAVE_KEY, JSON.stringify(data));
}

export function resetGame() {
  backend.remove(SAVE_KEY);
  return clone(NEW_GAME);
}

export function loadSettings(defaults) {
  const raw = backend.get(SETTINGS_KEY);
  if (!raw) return { ...defaults };
  try { return { ...defaults, ...JSON.parse(raw) }; } catch { return { ...defaults }; }
}

export function saveSettings(settings) {
  backend.set(SETTINGS_KEY, JSON.stringify(settings));
}
