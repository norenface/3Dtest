// セーブ・ロード・リセット。
// ゲームは必ずこのモジュール経由で保存する（アプリ化の際は、保存先を
// Capacitor Preferences や Electron のファイル保存に差し替えられるようにするため）。
import { NEW_GAME } from './data.js';

const SAVE_KEY = 'essence-labyrinth/save/v1';
const SETTINGS_KEY = 'essence-labyrinth/settings/v1';
const PRE_RUN_KEY = 'essence-labyrinth/prerun/v1';   // 迷宮に入る直前のセーブ（力尽きたときに戻す）
const RUN_KEY = 'essence-labyrinth/run/v1';          // 探索中の状態（オートセーブ。アプリを閉じても続きから遊べる）

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
  clearRun();
  return clone(NEW_GAME);
}

function loadJSON(key) {
  const raw = backend.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---- 迷宮に入る直前のセーブ（出発時に保存し、力尽きたらこれに戻す）
export function savePreRun(data) {
  backend.set(PRE_RUN_KEY, JSON.stringify(data));
}
export function loadPreRun() {
  const d = loadJSON(PRE_RUN_KEY);
  return d ? { ...clone(NEW_GAME), ...d } : null;
}

// ---- 探索中の状態（階層・位置・時刻・HP・魔物など）
export function saveRunState(state) {
  backend.set(RUN_KEY, JSON.stringify(state));
}
export function loadRunState() {
  return loadJSON(RUN_KEY);
}

// 探索が終わったら両方消す
export function clearRun() {
  backend.remove(RUN_KEY);
  backend.remove(PRE_RUN_KEY);
}

export function loadSettings(defaults) {
  const raw = backend.get(SETTINGS_KEY);
  if (!raw) return { ...defaults };
  try { return { ...defaults, ...JSON.parse(raw) }; } catch { return { ...defaults }; }
}

export function saveSettings(settings) {
  backend.set(SETTINGS_KEY, JSON.stringify(settings));
}
