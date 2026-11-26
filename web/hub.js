// 拠点（ハブ）画面：換金・商店・精髄（ビルド調整）・古文書。
// 迷宮から戻ったとき、またはタイトルから始めたときに開く。数値はすべて data.js の HUB / LORE などから読む。
import * as D from './data.js';
import * as Store from './storage.js';
import { GRADES, stoneCount, stoneValue } from './stones.js';
import { isGateOpen, daysUntilGateOpens, isLateEntry, formatClock, closeLabel } from './time.js';

const $ = sel => document.querySelector(sel);
const STAT_KEYS = ['STR', 'VIT', 'AGI', 'INT', 'MAG', 'MND'];
const STAT_NAMES = { STR: '筋力', VIT: '耐久', AGI: '敏捷', INT: '知力', MAG: '魔力', MND: '精神' };
const TABS = [
  ['sell', '換金'],
  ['shop', '商店'],
  ['craft', '工房'],
  ['essence', '精髄'],
  ['feats', '功績'],
  ['lore', '古文書'],
];

let ctx = null;       // { getSave, computeStats, onDepart, onTitle }
let tab = 'sell';
let note = '';
let readingLore = null;

export function openHub(context, message = '') {
  ctx = context;
  note = message;
  if (message) tab = stoneCount(ctx.getSave().stones) > 0 ? 'sell' : tab;
  render();
}

// 開放日の時刻が進んだとき（game.js から呼ぶ）。暦の部分だけ描き直し、ゲートが閉じた・閉門間際になったときは全体を描き直す
export function hubClockChanged(changedPhase, message = '') {
  if (!ctx) return;
  if (changedPhase) { if (message) note = message; render(); return; }
  const el = $('#hub-calendar');
  if (el) el.outerHTML = calendarHTML(ctx.getSave());
}

function save() {
  Store.saveGame(ctx.getSave());
}

function hex(c) {
  return '#' + c.toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------- 古文書の状態
export function loreStatus(s, entry) {
  if (s.lore.includes(entry.id)) return { state: 'open' };
  if (entry.unlock?.kills) {
    const have = s.kills[entry.unlock.kills] || 0;
    if (have >= entry.unlock.count) return { state: 'free' };
    return { state: 'locked', progress: `${D.MONSTERS[entry.unlock.kills].name}を ${entry.unlock.count} 体倒すと無料（${have}/${entry.unlock.count}）` };
  }
  if (entry.unlock?.deepest) {
    if ((s.deepest || 1) >= entry.unlock.deepest) return { state: 'free' };
    return { state: 'locked', progress: `第${entry.unlock.deepest}層に到達すると無料` };
  }
  return { state: 'locked' };
}

// ---------------------------------------------------------------- 暦（地上ゲートの開閉）
function calendarHTML(s) {
  const open = isGateOpen(s.day, s.hour);
  const T = D.TIME;
  const left = T.gateOpenHours - s.hour;
  const leftText = left >= 1 ? `${Math.floor(left)} 時間 ${Math.floor((left % 1) * 60)} 分` : `${Math.floor(left * 60)} 分`;
  // 深さごとに 1 つ（第2層は 4 つのエリアとも同じ閉鎖時間）
  const seen = new Set();
  const floors = D.FLOORS.filter(f => !f.isSpecialRift && !f.test && !seen.has(f.depth) && seen.add(f.depth))
    .map(f => `第${f.depth}層 ${closeLabel(f)}`).join(' ／ ');
  return `<div class="calendar ${open ? 'open' : 'closed'}" data-test="calendar" id="hub-calendar">
    <div><b>第${s.cycle}周期 Day ${s.day}${s.day === 1 ? ` <span data-test="clock">${formatClock(s.hour)}</span>` : ''}</b> <span class="muted">／ ${T.cycleDays} 日周期</span></div>
    <div>${open
      ? `地上ゲート：<b class="ok">開放中</b> — 閉じるまで あと ${leftText}（${String(T.gateOpenHours).padStart(2, '0')}:00 に閉門）`
      : `地上ゲート：<b class="ng">閉鎖中</b> — 次の開放日まで あと ${daysUntilGateOpens(s.day, s.hour)} 日`}</div>
    ${open && isLateEntry(s.hour) ? '<div class="warn-text" data-test="late">閉門間際：いま入ると、暗黒地帯に降り立ってしまうおそれがある</div>' : ''}
    <div class="muted">階層の閉鎖（突入から）：${floors}</div>
  </div>`;
}

// ---------------------------------------------------------------- 描画
function render() {
  const s = ctx.getSave();
  const card = $('#hub-card');
  card.innerHTML = `
    <div class="hub-head">
      <div><h2 style="margin:0">${D.HUB.name}</h2><div class="muted">迷宮の入口にある宿場町</div></div>
      <div class="hub-wallet">
        <div>ゴールド <b data-test="gold">${s.gold}</b> G</div>
        <div class="muted">魔石 ${stoneCount(s.stones)} ／ 回復薬 ${s.potions} ／ 松明 ${s.torches} ／ 巻物 ${s.returnScrolls} ／ 霊薬 ${s.oblivion}</div>
      </div>
    </div>
    ${calendarHTML(s)}
    ${note ? `<div class="hub-note">${note}</div>` : ''}
    <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    <div class="tab-body">${renderTab(s)}</div>
    <div class="btns row">
      ${isGateOpen(s.day, s.hour)
        ? '<button class="btn primary" id="hub-depart">迷宮へ出発（ゲート開放中）</button>'
        : `<button class="btn primary" id="hub-wait">次の開放日まで過ごす（${daysUntilGateOpens(s.day, s.hour)} 日）</button>`}
      <button class="btn" id="hub-title">タイトルへ</button>
    </div>`;
  card.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; readingLore = null; note = ''; render(); });
  card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.arg));
  if ($('#hub-depart')) $('#hub-depart').onclick = () => ctx.onDepart();
  if ($('#hub-wait')) $('#hub-wait').onclick = () => act('waitGate');
  $('#hub-title').onclick = () => ctx.onTitle();
}

function renderTab(s) {
  if (tab === 'sell') {
    const G = D.STONE_GRADES;
    const owned = GRADES.filter(g => s.stones[g] > 0);
    const rows = owned.map(g => `
      <div class="shop-row" data-test="stone-${g}">
        <div><div><span style="color:${hex(G[g].color)}">◆</span> ${g}等級の魔石 × ${s.stones[g]}</div>
          <div class="muted">1 個 ${G[g].price} G ／ 合計 ${s.stones[g] * G[g].price} G</div></div>
        <button class="btn" data-act="sellGrade" data-arg="${g}">売る</button>
      </div>`).join('');
    // 素材
    const M = D.MATERIALS;
    const mats = Object.entries(s.mats ?? {}).filter(([, n]) => n > 0);
    const matRows = mats.map(([id, n]) => `
      <div class="shop-row" data-test="mat-${id}">
        <div><div>${M[id].name} × ${n}</div><div class="muted">1 個 ${M[id].price} G ／ 合計 ${n * M[id].price} G</div></div>
        <button class="btn" data-act="sellMat" data-arg="${id}">売る</button>
      </div>`).join('');
    const matValue = mats.reduce((v, [id, n]) => v + n * M[id].price, 0);
    return `
      <p class="muted">迷宮で拾った魔石を買い取ります。等級が高いほど高値（9 等級 ${G[9].price} G 〜 1 等級 ${G[1].price} G）。</p>
      ${rows || '<div class="muted">魔石を持っていない。</div>'}
      <div class="kv"><span>所持している魔石</span><span>${stoneCount(s.stones)} 個（${stoneValue(s.stones)} G）</span></div>
      <div class="btns row">
        <button class="btn primary" data-act="sellAll" ${stoneCount(s.stones) ? '' : 'disabled'}>魔石をすべて売る</button>
      </div>
      <h3 style="margin:14px 0 4px">素材</h3>
      <p class="muted">魔物が落とした素材も買い取ります（工房で使うこともできる）。</p>
      ${matRows || '<div class="muted">素材を持っていない。</div>'}
      <div class="btns row">
        <button class="btn" data-act="sellAllMats" ${matValue ? '' : 'disabled'}>素材をすべて売る（${matValue} G）</button>
      </div>`;
  }
  if (tab === 'shop') {
    const H = D.HUB;
    const w = H.weapons, a = H.armors;
    const nextW = w[s.weaponLevel + 1], nextA = a[s.armorLevel + 1];
    const row = (title, desc, price, act, can, label = '買う') => `
      <div class="shop-row">
        <div><div>${title}</div><div class="muted">${desc}</div></div>
        <button class="btn ${can ? 'primary' : ''}" data-act="${act}" ${can ? '' : 'disabled'}>${label}${price != null ? `<br><small>${price} G</small>` : ''}</button>
      </div>`;
    return `
      ${row(`${H.potion.name}（所持 ${s.potions}/${H.potion.max}）`, H.potion.description, H.potion.price, 'buyPotion',
        s.gold >= H.potion.price && s.potions < H.potion.max)}
      ${row(`${H.torch.name}（所持 ${s.torches}/${H.torch.max}）`, H.torch.description, H.torch.price, 'buyTorch',
        s.gold >= H.torch.price && s.torches < H.torch.max)}
      ${nextW
        ? row(`武器：${w[s.weaponLevel].name} → ${nextW.name}`, `攻撃力 +${nextW.attackBonus}（現在 +${w[s.weaponLevel].attackBonus}）`, nextW.price, 'buyWeapon', s.gold >= nextW.price, '強化')
        : row(`武器：${w[s.weaponLevel].name}`, 'これ以上は強化できない。', null, 'none', false, '最大')}
      ${nextA
        ? row(`防具：${a[s.armorLevel].name} → ${nextA.name}`, `最大HP +${nextA.hpBonus}、受けるダメージ ${Math.round((1 - nextA.damageTakenMultiplier) * 100)}% 減`, nextA.price, 'buyArmor', s.gold >= nextA.price, '強化')
        : row(`防具：${a[s.armorLevel].name}`, 'これ以上は強化できない。', null, 'none', false, '最大')}
      ${H.returnScroll.inShop ? row(`${H.returnScroll.name}（所持 ${s.returnScrolls}/${H.returnScroll.max}）`, H.returnScroll.description, H.returnScroll.price, 'buyReturnScroll',
        s.gold >= H.returnScroll.price && s.returnScrolls < H.returnScroll.max) : ''}
      ${H.oblivion.inShop ? row(`${H.oblivion.name}（所持 ${s.oblivion}）`, H.oblivion.description + '「精髄」タブで使う。', H.oblivion.price, 'buyOblivion', s.gold >= H.oblivion.price) : ''}`;
  }
  if (tab === 'craft') {
    const M = D.MATERIALS;
    const rows = D.RECIPES.map(rc => {
      const have = Object.entries(rc.needs).map(([id, n]) => `${M[id].name} ${s.mats?.[id] ?? 0}/${n}`).join('・');
      const enough = Object.entries(rc.needs).every(([id, n]) => (s.mats?.[id] ?? 0) >= n);
      const H = D.HUB;
      const full = rc.makes === 'potion' ? s.potions >= H.potion.max : rc.makes === 'torch' ? s.torches >= H.torch.max : (s[rc.makes] ?? 0) >= (rc.max ?? Infinity);
      const count = rc.max ? `（${s[rc.makes] ?? 0}/${rc.max} 回）` : rc.makes === 'potion' ? `（所持 ${s.potions}/${H.potion.max}）` : `（所持 ${s.torches}/${H.torch.max}）`;
      return `
      <div class="shop-row" data-test="recipe-${rc.id}">
        <div><div>${rc.name}${count}</div><div class="muted">${rc.desc} 必要：${have}</div></div>
        <button class="btn ${enough && !full ? 'primary' : ''}" data-act="craft" data-arg="${rc.id}" ${enough && !full ? '' : 'disabled'}>${full ? '最大' : '作る'}</button>
      </div>`;
    }).join('');
    return `<p class="muted">迷宮で拾った素材から、道具を作ったり装備を鍛えたりする。</p>${rows}`;
  }
  if (tab === 'feats') {
    const st = ctx.computeStats();
    const need = D.LEVEL.expToNext(s.level ?? 1);
    const feats = (s.feats ?? []).map(f => `<div class="kv"><span>${f.text}</span><span>+${f.exp}（第${f.cycle}周期 Day ${f.day}）</span></div>`).join('');
    return `
      <div class="kv"><span>レベル</span><span><b>Lv ${s.level ?? 1}</b></span></div>
      <div class="kv"><span>次のレベルまで</span><span>経験値 ${s.exp ?? 0} / ${need}</span></div>
      <div class="expbar"><i style="width:${Math.min(100, (s.exp ?? 0) / need * 100)}%"></i></div>
      <p class="muted">功績を上げると経験値がたまり、レベルが上がる。レベルが上がるとステータスが伸びる（${st.race.name}は筋力・耐久がよく伸びる）。
        功績：初めて倒した種類の魔物 +1、その周期で最初に下の層（3 層以降）へ進む +1、初めて到達した階層 +1、初めての次元の亀裂 +1、
        第2層より深い所で閉鎖まで生き延びて帰還 +1、深淵の魔物 +1、亀裂の主 +2、オークヒーロー +3、オークロード +5。</p>
      <h3 style="margin:10px 0 4px">手に入れた功績（新しい順）</h3>
      ${feats || '<div class="muted">まだない。</div>'}`;
  }
  if (tab === 'essence') {
    const st = ctx.computeStats();
    const slotHTML = Array.from({ length: D.MAX_SKILL_SLOTS }, (_, i) => {
      const id = s.skillSlots[i];
      const sk = id && D.ACTIVE_SKILLS[id];
      return `<div class="slot ${sk ? 'on' : ''}" style="${sk ? `border-color:${hex(sk.color)}` : ''}">
        <span class="slot-key">${i + 1}</span>${sk ? sk.name : '<span class="muted">空き</span>'}
        ${sk && i > 0 ? `<button class="mini" data-act="slotUp" data-arg="${i}" title="前へ">↑</button>` : ''}
        ${sk ? `<button class="mini" data-act="slotRemove" data-arg="${i}" title="外す">×</button>` : ''}
      </div>`;
    }).join('');
    const essenceHTML = s.absorbed.map(id => {
      const e = D.ESSENCES[id], sk = D.ACTIVE_SKILLS[e.activeSkill], pa = D.PASSIVES[e.passiveSkill];
      const inSlot = s.skillSlots.includes(e.activeSkill);
      return `<div class="essence-row">
        <div class="orb-dot" style="color:${hex(e.color)}"></div>
        <div class="grow">
          <div>${e.name} <span class="muted">${e.rank}等級・容量 ${e.cost}</span></div>
          <div class="muted">${Object.entries(e.statBonus).map(([k, v]) => `${STAT_NAMES[k]}+${v}`).join(' ')} ／ ${pa.name} ／ スキル：${sk.name}（CT ${sk.cooldown}秒）</div>
        </div>
        <div class="col-btns">
          <button class="btn small" data-act="slotToggle" data-arg="${e.activeSkill}" ${!inSlot && s.skillSlots.length >= D.MAX_SKILL_SLOTS ? 'disabled' : ''}>${inSlot ? 'スロットから外す' : 'スロットに入れる'}</button>
          <button class="btn small danger" data-act="forget" data-arg="${id}" ${s.oblivion > 0 ? '' : 'disabled'}>霊薬で取り除く</button>
        </div>
      </div>`;
    }).join('') || '<p class="muted">まだ精髄を吸収していない。迷宮の魔物が落とす精髄を探そう。</p>';
    return `
      <div class="stats">${STAT_KEYS.map(k => `<div>${STAT_NAMES[k]}<b>${st.stats[k]}</b></div>`).join('')}</div>
      <div class="kv"><span>最大HP / スタミナ / 攻撃力</span><span>${st.maxHp} / ${st.maxStamina} / ${Math.round(st.attack)}</span></div>
      <div class="kv"><span>魂の器</span><span>${st.used} / ${st.capacity}</span></div>
      <div class="kv"><span>パッシブ</span><span>${st.passives.map(p => D.PASSIVES[p].name).join('・')}</span></div>
      <h3>スキルスロット <span class="muted">（迷宮で 1〜4 キー／スキルボタン）</span></h3>
      <div class="slots">${slotHTML}</div>
      <h3>吸収した精髄</h3>
      ${essenceHTML}`;
  }
  if (tab === 'lore') {
    if (readingLore) {
      const e = D.LORE.find(l => l.id === readingLore);
      return `<div class="lore-text"><h3>${e.title}</h3><p>${e.text}</p></div>
        <button class="btn" data-act="loreBack">一覧へ戻る</button>`;
    }
    return `<p class="muted">迷宮について書き残された古い書物。未知の精髄や、階層の仕掛けの手がかりが記されている。</p>` +
      D.LORE.map(e => {
        const st = loreStatus(s, e);
        let btn = '';
        if (st.state === 'open') btn = `<button class="btn" data-act="loreRead" data-arg="${e.id}">読む</button>`;
        else if (st.state === 'free') btn = `<button class="btn primary" data-act="loreUnlockFree" data-arg="${e.id}">条件達成・読む</button>`;
        else btn = `<button class="btn ${s.gold >= e.price ? 'primary' : ''}" data-act="loreBuy" data-arg="${e.id}" ${s.gold >= e.price ? '' : 'disabled'}>購入<br><small>${e.price} G</small></button>`;
        return `<div class="shop-row">
          <div><div>${st.state === 'open' ? '📖 ' : ''}${e.title}</div><div class="muted">${st.state === 'open' ? '解読済み' : (st.progress || '未解読')}</div></div>
          ${btn}
        </div>`;
      }).join('');
  }
  return '';
}

// ---------------------------------------------------------------- 操作
function act(name, arg) {
  const s = ctx.getSave();
  const H = D.HUB;
  note = '';
  switch (name) {
    case 'sellAll':
    case 'sellGrade': {
      // sellAll：すべて / sellGrade：指定した等級をすべて
      const grades = name === 'sellAll' ? GRADES : [Number(arg)];
      let n = 0, gold = 0;
      for (const g of grades) {
        const c = s.stones[g] || 0;
        n += c; gold += c * D.STONE_GRADES[g].price;
        delete s.stones[g];
      }
      s.gold += gold;
      note = `魔石 ${n} 個を ${gold} ゴールドで売った。`;
      break;
    }
    case 'sellMat': {
      const n = s.mats?.[arg] ?? 0;
      const gold = n * D.MATERIALS[arg].price;
      s.gold += gold; delete s.mats[arg];
      note = `${D.MATERIALS[arg].name}を ${n} 個、${gold} ゴールドで売った。`;
      break;
    }
    case 'sellAllMats': {
      let n = 0, gold = 0;
      for (const [id, c] of Object.entries(s.mats ?? {})) { n += c; gold += c * D.MATERIALS[id].price; }
      s.gold += gold; s.mats = {};
      note = `素材を ${n} 個、${gold} ゴールドで売った。`;
      break;
    }
    case 'craft': {
      const rc = D.RECIPES.find(r => r.id === arg);
      if (!rc || !Object.entries(rc.needs).every(([id, n]) => (s.mats?.[id] ?? 0) >= n)) break;
      const H = D.HUB;
      if (rc.makes === 'potion') { if (s.potions >= H.potion.max) break; s.potions++; }
      else if (rc.makes === 'torch') { if (s.torches >= H.torch.max) break; s.torches++; }
      else { if ((s[rc.makes] ?? 0) >= rc.max) break; s[rc.makes] = (s[rc.makes] ?? 0) + 1; }
      for (const [id, n] of Object.entries(rc.needs)) { s.mats[id] -= n; if (s.mats[id] <= 0) delete s.mats[id]; }
      note = `${rc.name}：できあがった。`;
      break;
    }
    case 'buyPotion':
      if (s.gold >= H.potion.price && s.potions < H.potion.max) { s.gold -= H.potion.price; s.potions++; note = `${H.potion.name}を買った。`; }
      break;
    case 'buyTorch':
      if (s.gold >= H.torch.price && s.torches < H.torch.max) { s.gold -= H.torch.price; s.torches++; note = `${H.torch.name}を買った。`; }
      break;
    case 'buyReturnScroll':
      if (H.returnScroll.inShop && s.gold >= H.returnScroll.price && s.returnScrolls < H.returnScroll.max) { s.gold -= H.returnScroll.price; s.returnScrolls++; note = `${H.returnScroll.name}を買った。`; }
      break;
    case 'buyWeapon': {
      const next = H.weapons[s.weaponLevel + 1];
      if (next && s.gold >= next.price) { s.gold -= next.price; s.weaponLevel++; note = `武器を${next.name}に強化した。`; }
      break;
    }
    case 'buyArmor': {
      const next = H.armors[s.armorLevel + 1];
      if (next && s.gold >= next.price) { s.gold -= next.price; s.armorLevel++; note = `防具を${next.name}に強化した。`; }
      break;
    }
    case 'buyOblivion':
      if (H.oblivion.inShop && s.gold >= H.oblivion.price) { s.gold -= H.oblivion.price; s.oblivion++; note = `${H.oblivion.name}を手に入れた。`; }
      break;
    case 'slotToggle': {
      const i = s.skillSlots.indexOf(arg);
      if (i >= 0) s.skillSlots.splice(i, 1);
      else if (s.skillSlots.length < D.MAX_SKILL_SLOTS) s.skillSlots.push(arg);
      break;
    }
    case 'slotRemove':
      s.skillSlots.splice(Number(arg), 1);
      break;
    case 'slotUp': {
      const i = Number(arg);
      [s.skillSlots[i - 1], s.skillSlots[i]] = [s.skillSlots[i], s.skillSlots[i - 1]];
      break;
    }
    case 'forget': {
      const e = D.ESSENCES[arg];
      if (s.oblivion <= 0) break;
      if (!confirm(`${e.name}を魂から取り除きます。忘却の霊薬を 1 つ使います。よろしいですか？`)) return;
      s.oblivion--;
      s.absorbed = s.absorbed.filter(id => id !== arg);
      s.skillSlots = s.skillSlots.filter(id => id !== e.activeSkill);
      note = `${e.name}を魂から取り除いた。器に空きができた。`;
      break;
    }
    case 'loreBuy': {
      const e = D.LORE.find(l => l.id === arg);
      if (s.gold >= e.price && !s.lore.includes(e.id)) { s.gold -= e.price; s.lore.push(e.id); readingLore = e.id; }
      break;
    }
    case 'loreUnlockFree': {
      const e = D.LORE.find(l => l.id === arg);
      if (loreStatus(s, e).state === 'free') { s.lore.push(e.id); readingLore = e.id; }
      break;
    }
    case 'loreRead':
      readingLore = arg;
      break;
    case 'loreBack':
      readingLore = null;
      break;
    case 'waitGate': {
      // 次の周期の開放日まで都市で過ごす
      const days = daysUntilGateOpens(s.day, s.hour);
      s.cycle++;
      s.day = 1;
      s.hour = 0;
      note = `都市で ${days} 日を過ごした。第${s.cycle}周期の開放日だ。地上ゲートが開いている。`;
      break;
    }
    default:
      return;
  }
  save();
  render();
}
