// 魔石の等級。魔石は「等級ごとの個数」 { 9: 3, 8: 1, ... } で持つ（9 等級がいちばん下、1 等級がいちばん上）。
// 倒した魔物は必ず魔石を 1 個落とし、その等級は魔物の強さ（魔物の等級・階層・亀裂の主）で決まる。
import { STONE_GRADES, MONSTERS, BOSS } from './data.js';

export const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// 古いセーブ（個数だけの数値）も読めるようにする（すべて 9 等級として扱う）
export function normalizeStones(v) {
  if (typeof v === 'number') return v > 0 ? { 9: v } : {};
  const out = {};
  for (const g of GRADES) if (v?.[g] > 0) out[g] = v[g];
  return out;
}

export function addStone(bag, grade, n = 1) {
  bag[grade] = (bag[grade] || 0) + n;
  return bag;
}

export function mergeStones(into, from) {
  for (const g of GRADES) if (from?.[g]) addStone(into, g, from[g]);
  return into;
}

export function stoneCount(bag) {
  return GRADES.reduce((n, g) => n + (bag?.[g] || 0), 0);
}

export function stoneValue(bag) {
  return GRADES.reduce((v, g) => v + (bag?.[g] || 0) * STONE_GRADES[g].price, 0);
}

// いちばん高い等級（なければ null）
export function bestGrade(bag) {
  return GRADES.find(g => bag?.[g] > 0) ?? null;
}

// 「8等級×2・9等級×3」のような表示
export function stoneText(bag) {
  const parts = GRADES.filter(g => bag?.[g] > 0).map(g => `${g}等級×${bag[g]}`);
  return parts.length ? parts.join('・') : 'なし';
}

// 魔物が落とす魔石の等級：魔物の等級 − 階層の gradeUp −（亀裂の主なら BOSS.gradeUp）
export function stoneGradeFor(monsterId, floor, boss = false) {
  const g = MONSTERS[monsterId].grade - (floor?.gradeUp ?? 0) - (boss ? BOSS.gradeUp : 0);
  return Math.max(1, Math.min(9, g));
}
