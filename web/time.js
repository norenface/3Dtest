// ゲーム内時間の管理（TimeManager）と、迷宮の開閉・階層閉鎖のルール。
//
//  ・地上ゲート：周期 TIME.cycleDays 日。各周期の 1 日目（開放日）の入場フェイズ中だけ入場できる
//  ・地上から突入した瞬間を 0 時間とし、階層ごとの閉鎖時間（closeHours。第1層 168・第2層 240・第3層 360）に達すると
//    その階層にいる生存者は都市へ強制送還される（帰還成功）
//  ・次の階層へ進むと、閉鎖までの期限はその階層の閉鎖時間へ延びる。閉鎖時間を過ぎた上層へは戻れない
//  ・特殊な亀裂（isSpecialRift: true）は timeMode で時間の流れを変えられる
//      'stopped' … 中にいる間は時間が止まる（閉鎖もしない）
//      'surface' … 地上と同じく時間は流れるが、亀裂そのものは閉鎖しない
//
// 数値はすべて data.js の TIME / FLOORS から読む。描画や入力には依存しない（単体でテストできる）。
import { TIME, FLOORS } from './data.js';

export function floorConfig(floorId) {
  const f = FLOORS.find(fl => fl.id === floorId);
  if (!f) throw new Error('unknown floor ' + floorId);
  return f;
}

// 階層の閉鎖時間（突入からの経過時間。亀裂は閉鎖しないので null）。
// 階層データの closeHours を使い、なければ深さから求める（TIME.fallbackCloseHours）
export function closeHoursOf(floorOrId) {
  const f = typeof floorOrId === 'object' ? floorOrId : floorConfig(floorOrId);
  if (f.isSpecialRift) return null;
  return f.closeHours ?? TIME.fallbackCloseHours(f.depth);
}

// 「168時間（7日目）」のような表示
export function closeLabel(floorOrId) {
  const h = closeHoursOf(floorOrId);
  return h === null ? '閉鎖しない' : `${h}時間（${Math.ceil(h / 24)}日目）`;
}

// 突入からの経過時間 elapsedHours で、その階層が閉鎖されているか（checkFloorClosure）
export function checkFloorClosure(elapsedHours, floorId) {
  const ch = closeHoursOf(floorId);
  return ch !== null && elapsedHours >= ch;
}

// 地上ゲートが開いているか（開放日＝周期の 1 日目の入場フェイズ中だけ）
export function isGateOpen(day, hour = 0) {
  return day === 1 && hour < TIME.gateOpenHours;
}

// 次の開放日まであと何日か（今日が開放日でゲートが開いていれば 0。開放日でも入場フェイズが過ぎていれば次の周期まで）
export function daysUntilGateOpens(day, hour = 0) {
  if (day === 1) return hour < TIME.gateOpenHours ? 0 : TIME.cycleDays;
  return TIME.cycleDays - day + 1;
}

// 閉門間際の入場か（ゲートが閉じるまで lateEntryHours 時間を切っている）
export function isLateEntry(hour) {
  return hour >= TIME.gateOpenHours - TIME.lateEntryHours;
}

// 時刻の表示 'HH:MM'
export function formatClock(hours) {
  const h = Math.floor(hours % 24), m = Math.floor((hours * 60) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class TimeManager {
  constructor() {
    this.hours = 0;        // 開放日 0:00 からの経過時間（暦。Day の表示に使う）
    this.startHours = 0;   // 突入した時刻（暦）。閉鎖の判定は突入からの経過時間 elapsed で行う
  }

  // 入場した日時から始める（この瞬間が「0 時間」）
  start(day = 1, hour = TIME.entryHour) {
    this.hours = (day - 1) * 24 + hour;
    this.startHours = this.hours;
  }

  // 突入からの経過時間
  get elapsed() { return this.hours - this.startHours; }

  get day() { return Math.floor(this.hours / 24) + 1; }
  get hour() { return Math.floor(this.hours % 24); }
  get minute() { return Math.floor((this.hours * 60) % 60); }

  // 時間を進めるかどうか（亀裂の「時間停止」）
  flows(floor) {
    return !(floor.isSpecialRift && floor.timeMode === 'stopped');
  }

  // 実時間 dt 秒ぶん進める。日付が変わったか・今いる階層が閉鎖されたかを返す
  tick(dt, floor) {
    if (!this.flows(floor)) return { dayChanged: false, closed: false };
    const before = this.day;
    this.hours += dt / TIME.secondsPerDay * 24;
    return { dayChanged: this.day !== before, closed: checkFloorClosure(this.elapsed, floor.id) };
  }

  // 何日か一気に進める（野営など）。閉鎖時間を越える場合は閉鎖の瞬間で止める
  advanceDays(days, floor) {
    if (!this.flows(floor)) return { dayChanged: false, closed: false };
    const before = this.day;
    let target = this.hours + days * 24;
    const ch = closeHoursOf(floor);
    if (ch !== null) target = Math.min(target, this.startHours + ch);
    this.hours = Math.max(this.hours, target);
    return { dayChanged: this.day !== before, closed: checkFloorClosure(this.elapsed, floor.id) };
  }

  // 今いる階層が閉鎖されるまでの残り時間（ゲーム内の時間。閉鎖しない・時間が止まっているなら null）
  hoursUntilClose(floor) {
    const ch = closeHoursOf(floor);
    if (ch === null || !this.flows(floor)) return null;
    return Math.max(0, ch - this.elapsed);
  }

  // 突入からの経過「168:00」のような表示
  elapsedLabel() {
    const e = Math.max(0, this.elapsed);
    return `${Math.floor(e)}:${String(Math.floor((e * 60) % 60)).padStart(2, '0')}`;
  }

  label() {
    return `Day ${this.day}  ${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }
}

// 「あと 2 日 5 時間」のような表示
export function formatRemaining(hours) {
  if (hours === null) return '';
  const h = Math.ceil(hours);
  const d = Math.floor(h / 24), r = h % 24;
  if (d === 0) return `あと ${r} 時間`;
  return r === 0 ? `あと ${d} 日` : `あと ${d} 日 ${r} 時間`;
}
