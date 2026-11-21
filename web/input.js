// 入力の抽象化。ゲームロジックはキーやタッチを直接見ず、ここが作る「操作の状態」だけを読む。
//
//   input.move      … {x, y} 移動（-1〜1。y が前）
//   input.takeLook() … 視点の回転量 {yaw: 左右, pitch: 上下}（ラジアン。読むたびに 0 に戻る）
//   input.dash      … ダッシュ中か
//   input.consume('attack' | 'interact' | 'menu' | 'potion' | 'skill0'〜'skill3') … そのフレームに押されたか（押下を 1 回だけ返す）
//
// PC: WASD/↑↓ 移動（A/D は横歩き）、マウスで視点（クリックでマウスをゲームに固定。ドラッグでも可）、Q/E/←→ で左右を向く、
//     左クリック or J/Space 攻撃、1〜4 スキル、R 回復薬、Shift ダッシュ、F/Enter 調べる、Esc メニュー
// タッチ: 左下の仮想スティックで移動、右側のドラッグで視点、ボタンで攻撃・ダッシュ・調べる・スキル・回復薬
export class Input {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, y: 0 };
    this.lookDelta = 0;   // 左右
    this.lookDeltaY = 0;  // 上下
    this.dash = false;
    this.enabled = true;
    this.mouseSensitivity = 0.0025;
    this.keys = new Set();
    this.pressed = new Set();
    this.touchMode = false;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lookTouch = { id: null, x: 0, y: 0 };
    this.dashTouch = false;
    this.mouseDrag = null;
    this._bindKeyboard();
    this._bindMouse();
    this._bindTouch();
  }

  consume(action) {
    const had = this.pressed.has(action);
    this.pressed.delete(action);
    return had;
  }

  takeLook() {
    const d = { yaw: this.lookDelta, pitch: this.lookDeltaY };
    this.lookDelta = 0;
    this.lookDeltaY = 0;
    return d;
  }

  // マウスをゲームに固定する（PC の一人称視点用。クリックなどの操作の中から呼ぶ必要がある）
  lockPointer() {
    if (this.touchMode || document.pointerLockElement) return;
    const canvas = this.root.querySelector('canvas');
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* 対応していない環境では何もしない */ }
  }

  get pointerLocked() {
    return !!document.pointerLockElement;
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.move.x = this.move.y = 0;
    this.lookDelta = 0;
    this.lookDeltaY = 0;
    this.dash = false;
    this.dashTouch = false;
    this.stick.id = null;
    this.lookTouch.id = null;
    this._updateStickView();
  }

  // 毎フレーム呼ぶ：キーボードの押下状態から move / dash を作る
  update(dt) {
    if (!this.stick.id) {
      let x = 0, y = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
      if (this.keys.has('KeyD')) x += 1;
      if (this.keys.has('KeyA')) x -= 1;
      const len = Math.hypot(x, y) || 1;
      this.move.x = x / len;
      this.move.y = y / len;
    }
    if (this.keys.has('KeyQ') || this.keys.has('ArrowLeft')) this.lookDelta += 2.4 * dt;
    if (this.keys.has('KeyE') || this.keys.has('ArrowRight')) this.lookDelta -= 2.4 * dt;
    this.dash = this.dashTouch || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  // ---------------------------------------------------------------- キーボード
  _bindKeyboard() {
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.repeat) { if (['Space'].includes(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      if (e.code === 'KeyJ' || e.code === 'Space') { this.pressed.add('attack'); e.preventDefault(); }
      if (e.code === 'KeyF' || e.code === 'Enter') this.pressed.add('interact');
      if (e.code === 'Escape' || e.code === 'KeyP') this.pressed.add('menu');
      if (e.code === 'KeyR') this.pressed.add('potion');
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (digit >= 0) this.pressed.add('skill' + digit);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.touchMode && this._setTouchMode(false);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.clear());
  }

  // ---------------------------------------------------------------- マウス
  // マウスがゲームに固定されていれば動かすだけで視点が回る。固定されていないときはドラッグで回す
  _bindMouse() {
    const canvas = this.root.querySelector('canvas');
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (e.button === 0) this.pressed.add('attack');
      this.lockPointer();
      this.mouseDrag = { x: e.clientX, y: e.clientY };
    });
    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        this.lookDelta -= e.movementX * this.mouseSensitivity;
        this.lookDeltaY -= e.movementY * this.mouseSensitivity;
        return;
      }
      if (!this.mouseDrag) return;
      this.lookDelta -= (e.clientX - this.mouseDrag.x) * this.mouseSensitivity * 1.6;
      this.lookDeltaY -= (e.clientY - this.mouseDrag.y) * this.mouseSensitivity * 1.6;
      this.mouseDrag.x = e.clientX;
      this.mouseDrag.y = e.clientY;
    });
    addEventListener('mouseup', () => { this.mouseDrag = null; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------------------------------------------------------------- タッチ
  _bindTouch() {
    const el = this.root;
    this.stickEl = el.querySelector('#stick');
    this.stickKnob = el.querySelector('#stick-knob');
    const btn = (id, action) => {
      const b = el.querySelector(id);
      if (!b) return;
      b.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        if (!this.enabled) return;
        if (action === 'dash') this.dashTouch = true; else this.pressed.add(action);
        b.classList.add('down');
      }, { passive: false });
      const up = e => { e.preventDefault(); if (action === 'dash') this.dashTouch = false; b.classList.remove('down'); };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    };
    btn('#btn-attack', 'attack');
    btn('#btn-dash', 'dash');
    btn('#btn-interact', 'interact');
    btn('#btn-menu', 'menu');
    btn('#btn-potion', 'potion');
    for (let i = 0; i < 4; i++) btn('#btn-skill-' + i, 'skill' + i);

    const canvasLayer = el.querySelector('canvas');
    const onStart = e => {
      if (!this.enabled) return;
      this._setTouchMode(true);
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.stick.id === null) {
          this.stick.id = t.identifier;
          this.stick.ox = t.clientX; this.stick.oy = t.clientY;
          this.stick.x = 0; this.stick.y = 0;
          this._updateStickView();
        } else if (this.lookTouch.id === null) {
          this.lookTouch.id = t.identifier;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onMove = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          const R = 55;
          let dx = t.clientX - this.stick.ox, dy = t.clientY - this.stick.oy;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx = dx / len * R; dy = dy / len * R; }
          this.stick.x = dx / R; this.stick.y = dy / R;
          this.move.x = this.stick.x;
          this.move.y = -this.stick.y;
          this._updateStickView();
        } else if (t.identifier === this.lookTouch.id) {
          this.lookDelta -= (t.clientX - this.lookTouch.x) * 0.006;
          this.lookDeltaY -= (t.clientY - this.lookTouch.y) * 0.006;
          this.lookTouch.x = t.clientX;
          this.lookTouch.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stick.id) {
          this.stick.id = null;
          this.move.x = this.move.y = 0;
          this._updateStickView();
        } else if (t.identifier === this.lookTouch.id) {
          this.lookTouch.id = null;
        }
      }
    };
    canvasLayer.addEventListener('touchstart', onStart, { passive: false });
    canvasLayer.addEventListener('touchmove', onMove, { passive: false });
    canvasLayer.addEventListener('touchend', onEnd);
    canvasLayer.addEventListener('touchcancel', onEnd);
    if (matchMedia('(pointer: coarse)').matches) this._setTouchMode(true);
  }

  _setTouchMode(on) {
    this.touchMode = on;
    document.body.classList.toggle('touch', on);
  }

  _updateStickView() {
    if (!this.stickEl) return;
    if (this.stick.id === null) {
      this.stickEl.classList.remove('active');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.stickEl.classList.add('active');
    this.stickEl.style.left = this.stick.ox + 'px';
    this.stickEl.style.top = this.stick.oy + 'px';
    this.stickKnob.style.transform = `translate(calc(-50% + ${this.stick.x * 55}px), calc(-50% + ${this.stick.y * 55}px))`;
  }
}
