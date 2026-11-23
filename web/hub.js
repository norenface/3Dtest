// 拠点（ハブ）画面：換金・商店・精髄（ビルド調整）・古文書。
// 迷宮から戻ったとき、またはタイトルから始めたときに開く。数値はすべて data.js の HUB / LORE などから読む。
import * as D from './data.js';
import * as Store from './storage.js';
import { isGateOpen, daysUntilGateOpens } from './time.js';

const $ = sel => document.querySelector(sel);
const STAT_KEYS = ['STR', 'VIT', 'AGI', 'INT', 'MAG', 'MND'];
const STAT_NAMES = { STR: '筋力', VIT: '耐久', AGI: '敏捷', INT: '知力', MAG: '魔力', MND: '精神' };
const TABS = [
  ['sell', '換金'],
  ['shop', '商店'],
  ['essence', '精髄'],
  ['lore', '古文書'],
];

let ctx = null;       // { getSave, computeStats, onDepart, onTitle }
let tab = 'sell';
let note = '';
let readingLore = null;

export function openHub(context, message = '') {
  ctx = context;
  note = message;
  if (message) tab = ctx.getSave().stones > 0 ? 'sell' : tab;
  render();
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
  const open = isGateOpen(s.day);
  const T = D.TIME;
  const floors = D.FLOORS.filter(f => !f.isSpecialRift)
    .map(f => `第${f.depth}層 ${f.closeDay ?? T.closeDayBase + T.closeDayStep * (f.depth - 1)}日目`).join(' ／ ');
  return `<div class="calendar ${open ? 'open' : 'closed'}" data-test="calendar">
    <div><b>第${s.cycle}周期 Day ${s.day}</b> <span class="muted">／ ${T.cycleDays} 日周期</span></div>
    <div>${open
      ? '地上ゲート：<b class="ok">開放中</b>（開放日の入場フェイズ）'
      : `地上ゲート：<b class="ng">閉鎖中</b> — 次の開放日まで あと ${daysUntilGateOpens(s.day)} 日`}</div>
    <div class="muted">階層の閉鎖日：${floors}</div>
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
        <div class="muted">魔石 ${s.stones} ／ 回復薬 ${s.potions} ／ 霊薬 ${s.oblivion}</div>
      </div>
    </div>
    ${calendarHTML(s)}
    ${note ? `<div class="hub-note">${note}</div>` : ''}
    <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
    <div class="tab-body">${renderTab(s)}</div>
    <div class="btns row">
      ${isGateOpen(s.day)
        ? '<button class="btn primary" id="hub-depart">迷宮へ出発（ゲート開放中）</button>'
        : `<button class="btn primary" id="hub-wait">次の開放日まで過ごす（${daysUntilGateOpens(s.day)} 日）</button>`}
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
    const p = D.HUB.stonePrice;
    return `
      <p class="muted">迷宮で拾った魔石を買い取ります。1 個 ${p} ゴールド。</p>
      <div class="kv"><span>所持している魔石</span><span>${s.stones} 個（${s.stones * p} G）</span></div>
      <div class="btns row">
        <button class="btn primary" data-act="sellAll" ${s.stones ? '' : 'disabled'}>すべて売る</button>
        <button class="btn" data-act="sellOne" ${s.stones ? '' : 'disabled'}>1 個売る</button>
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
      ${nextW
        ? row(`武器：${w[s.weaponLevel].name} → ${nextW.name}`, `攻撃力 +${nextW.attackBonus}（現在 +${w[s.weaponLevel].attackBonus}）`, nextW.price, 'buyWeapon', s.gold >= nextW.price, '強化')
        : row(`武器：${w[s.weaponLevel].name}`, 'これ以上は強化できない。', null, 'none', false, '最大')}
      ${nextA
        ? row(`防具：${a[s.armorLevel].name} → ${nextA.name}`, `最大HP +${nextA.hpBonus}、受けるダメージ ${Math.round((1 - nextA.damageTakenMultiplier) * 100)}% 減`, nextA.price, 'buyArmor', s.gold >= nextA.price, '強化')
        : row(`防具：${a[s.armorLevel].name}`, 'これ以上は強化できない。', null, 'none', false, '最大')}
      ${row(`${H.oblivion.name}（所持 ${s.oblivion}）`, H.oblivion.description + '「精髄」タブで使う。', H.oblivion.price, 'buyOblivion', s.gold >= H.oblivion.price)}`;
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
    case 'sellOne': {
      const n = name === 'sellAll' ? s.stones : Math.min(1, s.stones);
      s.stones -= n;
      s.gold += n * H.stonePrice;
      note = `魔石 ${n} 個を ${n * H.stonePrice} ゴールドで売った。`;
      break;
    }
    case 'buyPotion':
      if (s.gold >= H.potion.price && s.potions < H.potion.max) { s.gold -= H.potion.price; s.potions++; note = `${H.potion.name}を買った。`; }
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
      if (s.gold >= H.oblivion.price) { s.gold -= H.oblivion.price; s.oblivion++; note = `${H.oblivion.name}を手に入れた。`; }
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
      const days = daysUntilGateOpens(s.day);
      s.cycle++;
      s.day = 1;
      note = `都市で ${days} 日を過ごした。第${s.cycle}周期の開放日だ。地上ゲートが開いている。`;
      break;
    }
    default:
      return;
  }
  save();
  render();
}
