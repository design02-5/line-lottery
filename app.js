/**
 * LINE 抽獎動畫頁（LIFF）
 *
 * 網址參數：
 *   liff=  LIFF ID
 *   api=   Apps Script 部署 ID（AKfycb... 那串）或完整 /exec 網址
 *   demo   預覽模式：不連 LINE、用假資料（一定要明確帶 ?demo 才會進入）
 *
 * 抽獎結果一律由 Apps Script 決定，這裡只負責播動畫。
 */
(() => {
  'use strict';

  const qs = new URLSearchParams(location.search);
  // LINE 第一次轉址時，參數可能被包在 liff.state 裡，也一併讀取當備援
  const stateQs = new URLSearchParams((qs.get('liff.state') || '').replace(/^[^?]*\?/, ''));
  const param = k => qs.get(k) || stateQs.get(k) || '';
  const apiParam = param('api');
  const API = apiParam.startsWith('http') ? apiParam : apiParam ? 'https://script.google.com/macros/s/' + apiParam + '/exec' : '';
  const LIFF_ID = param('liff');
  // 預覽模式只在網址明確帶 demo 時才啟用；正式網址缺參數要報錯，不能默默變成假資料
  const DEMO = qs.has('demo');

  // ===================== 配色主題 =====================
  // 試算表「配色主題」選一組，再用「背景色／主色／獎項色盤／外殼色」覆蓋
  const DARK_INK = { text: '#F4F1FF', muted: '#B3ADCF', card: 'rgba(255,255,255,.07)', line: 'rgba(255,255,255,.13)', modalText: '#DDD8F2', stars: 1 };
  const LIGHT_INK = { text: '#1D1D1F', muted: '#6B6B73', card: 'rgba(255,255,255,.72)', line: 'rgba(0,0,0,.08)', modalText: '#45454D', stars: 0 };
  const THEMES = {
    '奢華金': Object.assign({}, DARK_INK, {
      bg: '#0E0B1F', bg2: '#1B1440', glow: '#2C2170',
      accent: '#F5C451', accentHi: '#FFE08A', accentDeep: '#C98F1C', onAccent: '#2A1D00',
      shell: '#E0335A', shellHi: '#FF5F7E', shellDeep: '#B81F45', onShell: '#FFD5DF',
      modal1: '#2A2160', modal2: '#17123A',
      palette: ['#F5C451', '#B57BFF', '#4FC3F7', '#FF7AA2', '#5EE0A0', '#FF9F43', '#7C9CFF', '#FFD166'], lose: '#8A93A6',
    }),
    '清新綠': Object.assign({}, LIGHT_INK, {
      text: '#12392D', muted: '#5C7F72', modalText: '#3E5F53',
      bg: '#EEF8F2', bg2: '#E1F4EA', glow: '#C4EBD7',
      accent: '#22A06B', accentHi: '#5FD39E', accentDeep: '#127A4F', onAccent: '#FFFFFF',
      shell: '#2BB37A', shellHi: '#5FD39E', shellDeep: '#178A5A', onShell: '#F2FFF8',
      modal1: '#FFFFFF', modal2: '#EEF9F3',
      palette: ['#22A06B', '#FFB703', '#3A86FF', '#FF6B8B', '#8E7DFF', '#00B4D8', '#F77F00', '#7BD389'], lose: '#B8C4BF',
    }),
    '喜氣紅': Object.assign({}, DARK_INK, {
      text: '#FFF4E6', muted: '#F0C9B0', modalText: '#FBE3D2',
      bg: '#2A0508', bg2: '#4A0A10', glow: '#8C1420',
      accent: '#FFCF5C', accentHi: '#FFE9A8', accentDeep: '#D4931A', onAccent: '#4A0A10',
      shell: '#C4161C', shellHi: '#E8383D', shellDeep: '#8E0E13', onShell: '#FFE9A8',
      modal1: '#6A0F17', modal2: '#3A070C',
      palette: ['#FFCF5C', '#FF8A5B', '#FFF1D0', '#F25C54', '#F7B267', '#FFE9A8', '#E76F51', '#FFD6A5'], lose: '#9C6B6B',
    }),
    '極簡白': Object.assign({}, LIGHT_INK, {
      bg: '#F5F5F3', bg2: '#FBFBFA', glow: '#FFFFFF',
      accent: '#1D1D1F', accentHi: '#4A4A50', accentDeep: '#000000', onAccent: '#FFFFFF',
      shell: '#2C2C2E', shellHi: '#48484A', shellDeep: '#1C1C1E', onShell: '#F5F5F7',
      modal1: '#FFFFFF', modal2: '#F5F5F7',
      palette: ['#1D1D1F', '#C9A96E', '#8E8E93', '#5E5CE6', '#D1D1D6', '#A2845E', '#636366', '#E5E5EA'], lose: '#E5E5EA',
    }),
  };
  let RARITY = THEMES['奢華金'].palette;
  let LOSE_COLOR = THEMES['奢華金'].lose;
  let LIGHT_BG = false;

  /** 淺色背景上太淺的字色自動加深，確保看得清楚 */
  const readable = c => (c && LIGHT_BG && lum(c) > 0.55 ? shade(c, -45) : c);

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isHttps = u => /^https:\/\/\S+$/.test(String(u || ''));

  let idToken = '';
  let info = null;

  // ===================== API =====================

  async function api(action) {
    if (DEMO) return mockApi(action);
    const res = await fetch(API, { method: 'POST', body: JSON.stringify({ action, idToken }) });
    if (!res.ok) throw new Error('伺服器回應錯誤（' + res.status + '）');
    return res.json();
  }

  /** 抽獎：失敗時丟出含訊息的錯誤 */
  async function requestDraw() {
    const r = await api('draw');
    if (!r.ok) throw new Error(r.message || '抽獎失敗，請稍後再試');
    return r;
  }

  // ---- 預覽模式假資料 ----
  const demoState = { previous: null };
  async function mockApi(action) {
    await sleep(action === 'draw' ? 1300 : 300);
    const prizes = [
      { name: '頭獎 Dyson 吹風機', image: '', lose: false },
      { name: '星巴克 500 元禮券', image: '', lose: false },
      { name: '全館 100 元折價券', image: '', lose: false },
      { name: '再接再厲', image: '', lose: true },
    ];
    if (action === 'info') {
      return {
        ok: true, activity: '中秋好禮抽獎', style: qs.get('style') || '輪盤', theme: '#06C755',
        // 預覽也能測覆蓋色：網址加 &accent=%23FF6600&bg=%23FFFFFF&shell=...&palette=%23111111,%23222222&logo=https://...
        look: {
          preset: qs.get('theme') || '奢華金',
          bg: qs.get('bg') || '', accent: qs.get('accent') || '', shell: qs.get('shell') || '',
          palette: (qs.get('palette') || '').split(',').filter(Boolean),
          logo: qs.get('logo') || '', bgImage: qs.get('bgImage') || '',
        },
        description: '・活動期間每人限抽一次\n・中獎請截圖並回覆本帳號「姓名＋電話」領獎\n・此為預覽模式，結果不會記錄',
        prizes, state: 'open', stateText: '', userName: '預覽者', notFriend: false, addFriendUrl: '',
        button: { text: '逛逛官網', url: 'https://example.com' }, previous: demoState.previous,
      };
    }
    const r = Math.random();
    const pick = qs.has('force') ? Number(qs.get('force')) : r < 0.08 ? 0 : r < 0.25 ? 1 : r < 0.6 ? 2 : 3;
    const p = prizes[pick];
    return {
      ok: true, status: p.lose ? 'lose' : 'win', already: false, name: '預覽者', prize: p.name, image: '',
      text: p.lose ? '別灰心，下次活動再來挑戰！' : '請截圖此畫面，並於 7 日內回覆本帳號「姓名＋電話」完成領獎。',
    };
  }

  // ===================== 啟動 =====================

  async function main() {
    try {
      if (!DEMO) {
        if (!API || !LIFF_ID) {
          throw new Error('抽獎頁設定不完整（缺少 ' + [!API && 'api', !LIFF_ID && 'liff'].filter(Boolean).join('、') +
            ' 參數），請通知主辦單位檢查 LIFF 的 Endpoint URL');
        }
        await liff.init({ liffId: LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: location.href });
          return;
        }
        idToken = liff.getIDToken();
      }
      info = await api('info');
      if (!info.ok) throw new Error(info.message || '載入失敗');
      render();
    } catch (err) {
      console.error(err);
      showFatal(err.message || String(err));
    } finally {
      $('loading').classList.add('done');
    }
  }

  /** 主題＋覆蓋色 → CSS 變數 */
  function applyLook(look) {
    look = look || {};
    const t = Object.assign({}, THEMES[look.preset] || THEMES['奢華金']);

    if (look.bg) {
      const dark = lum(look.bg) < 0.5;
      Object.assign(t, dark ? DARK_INK : LIGHT_INK, {
        bg: look.bg,
        bg2: shade(look.bg, dark ? 10 : 4),
        glow: shade(look.bg, dark ? 24 : 10),
        modal1: dark ? shade(look.bg, 16) : '#FFFFFF',
        modal2: dark ? shade(look.bg, 4) : shade(look.bg, 3),
      });
    }
    if (look.accent) {
      Object.assign(t, {
        accent: look.accent, accentHi: shade(look.accent, 35), accentDeep: shade(look.accent, -28),
        onAccent: lum(look.accent) > 0.6 ? '#1D1D1F' : '#FFFFFF',
      });
    }
    if (look.shell) {
      Object.assign(t, {
        shell: look.shell, shellHi: shade(look.shell, 20), shellDeep: shade(look.shell, -25),
        onShell: lum(look.shell) > 0.6 ? '#2A1D00' : '#FFF6E8',
      });
    }
    if (look.palette && look.palette.length) t.palette = look.palette;

    const vars = {
      '--bg': t.bg, '--bg2': t.bg2, '--glow': t.glow, '--text': t.text, '--muted': t.muted,
      '--card': t.card, '--line': t.line, '--accent': t.accent, '--accent-hi': t.accentHi,
      '--accent-deep': t.accentDeep, '--on-accent': t.onAccent, '--shell': t.shell, '--shell-hi': t.shellHi,
      '--shell-deep': t.shellDeep, '--on-shell': t.onShell, '--modal1': t.modal1, '--modal2': t.modal2,
      '--modal-text': t.modalText, '--stars': t.stars,
      // 深色背景：白→亮主色；淺色背景：深主色→主色（避免黑漸淺色變成髒咖啡色）
      '--title1': t.stars ? t.text : t.accentDeep,
      '--title2': t.stars ? t.accentHi : t.accent,
    };
    LIGHT_BG = !t.stars;
    Object.keys(vars).forEach(k => document.documentElement.style.setProperty(k, vars[k]));
    document.querySelector('meta[name="theme-color"]').content = t.bg;
    RARITY = t.palette;
    LOSE_COLOR = t.lose;

    const logo = $('logo');
    logo.hidden = !isHttps(look.logo);
    if (!logo.hidden) { logo.src = look.logo; logo.onerror = () => { logo.hidden = true; }; }
    const backdrop = $('backdrop');
    backdrop.hidden = !isHttps(look.bgImage);
    if (!backdrop.hidden) backdrop.style.backgroundImage = 'url("' + look.bgImage.replace(/"/g, '%22') + '")';
  }

  function render() {
    applyLook(info.look);
    document.documentElement.style.setProperty('--theme', info.theme || '#06C755');
    document.title = info.activity;
    $('title').textContent = info.activity;
    $('greet').textContent = info.userName ? '嗨，' + info.userName + '！祝你好運 🍀' : '';

    // 每個獎項配一個稀有度顏色，未中獎固定灰色
    let n = 0;
    info.prizes.forEach(p => { p.color = p.lose ? LOSE_COLOR : RARITY[n++ % RARITY.length]; });

    $('prizeList').innerHTML = info.prizes.filter(p => !p.lose).map(p =>
      '<li>' + (isHttps(p.image) ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="dot" style="--c:' + p.color + '"></span>') +
      '<span>' + esc(p.name) + '</span></li>').join('');
    $('desc').textContent = info.description || '';
    $('info').hidden = false;

    if (DEMO) setupDemoBar();

    if (info.notFriend) {
      return notice('🤝', '請先加入官方帳號好友，才能參加抽獎喔！',
        info.addFriendUrl ? '<a class="btn theme" href="' + esc(info.addFriendUrl) + '">加入好友</a>' : '');
    }
    if (info.state !== 'open' && !info.previous) {
      return notice(info.state === 'notstarted' ? '⏳' : '🎐', info.stateText, '');
    }

    const style = { '輪盤': Wheel, '扭蛋機': Gacha, '刮刮卡': Scratch }[info.style] || Wheel;
    style.mount();
    if (info.previous) {
      style.showDone(info.previous);
      setTimeout(() => showResult(info.previous), 500);
    }
  }

  function notice(icon, text, extraHtml) {
    $('stage').innerHTML = '<div class="notice"><div class="icon">' + icon + '</div><p>' + esc(text) + '</p>' + extraHtml + '</div>';
  }

  function showFatal(message) {
    $('title').textContent = '哎呀，出了點狀況';
    notice('⚠️', message, '<button class="btn" onclick="location.reload()">重新整理</button>');
  }

  function setupDemoBar() {
    const bar = $('demoBar');
    bar.hidden = false;
    bar.querySelectorAll('button').forEach(b => {
      const key = b.dataset.style ? 'style' : 'theme';
      const current = key === 'style' ? info.style : info.look.preset;
      b.classList.toggle('on', b.dataset[key] === current);
      b.onclick = () => {
        const u = new URL(location.href);
        u.searchParams.set(key, b.dataset[key]);
        u.searchParams.set('demo', '1');
        location.href = u.toString();
      };
    });
  }

  function prizeOf(result) {
    return info.prizes.find(p => p.name === result.prize) || { name: result.prize, color: result.status === 'win' ? RARITY[0] : LOSE_COLOR, lose: result.status !== 'win' };
  }

  /** 抽獎錯誤或「活動已結束／獎品抽完」等訊息 */
  function showMessage(text) {
    openModal({ eyebrow: '提醒', prize: '', text, color: '', win: false });
  }

  // ===================== 結果視窗 =====================

  function showResult(r) {
    const win = r.status === 'win';
    openModal({
      eyebrow: r.already ? (win ? '你已經抽過囉・你抽中了' : '你已經抽過囉') : (win ? '🎉 恭喜中獎！' : '差一點點！'),
      prize: r.prize,
      text: r.text,
      color: prizeOf(r).color,
      image: r.image,
      win: win,
    });
    if (win && !r.already) celebrate(prizeOf(r).color);
  }

  function openModal(o) {
    const modal = $('modal');
    modal.classList.toggle('win', !!o.win);
    $('modalCard').style.setProperty('--c', readable(o.color) || '');
    $('mEyebrow').textContent = o.eyebrow;
    $('mPrize').textContent = o.prize || '';
    $('mPrize').hidden = !o.prize;
    $('mText').textContent = o.text || '';
    const img = $('mImg');
    img.hidden = !isHttps(o.image);
    if (!img.hidden) img.src = o.image;
    const link = $('mLink');
    link.hidden = !(info && info.button);
    if (!link.hidden) { link.textContent = info.button.text; link.href = info.button.url; }
    $('mClose').onclick = () => {
      modal.hidden = true;
      if (!DEMO && window.liff && liff.isInClient() && o.prize) liff.closeWindow();
    };
    modal.hidden = false;
  }

  function celebrate(color) {
    if (navigator.vibrate) navigator.vibrate([80, 60, 160]);
    if (typeof confetti !== 'function') return;
    const colors = [color, '#F5C451', '#ffffff', '#FF7AA2'];
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.55 }, colors, zIndex: 60 });
    setTimeout(() => confetti({ particleCount: 60, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, zIndex: 60 }), 250);
    setTimeout(() => confetti({ particleCount: 60, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, zIndex: 60 }), 400);
  }

  // ===================== 輪盤 =====================

  const Wheel = (() => {
    let canvas, wrap, btn, slices = [], angle = 0, seg = 0;

    function mount() {
      $('stage').innerHTML =
        '<div class="wheel-wrap" id="wheelWrap">' +
        '  <div class="wheel-rim"></div><div class="wheel-lights" id="lights"></div>' +
        '  <canvas id="wheel" width="640" height="640"></canvas>' +
        '  <div class="wheel-pointer"></div>' +
        '  <button class="wheel-btn" id="spinBtn">抽</button>' +
        '</div><p class="hint" id="hint">點中間按鈕開始抽獎</p>';
      wrap = $('wheelWrap'); canvas = $('wheel'); btn = $('spinBtn');

      // 獎項少於 6 個就重複排列，輪盤才不會太空
      slices = info.prizes.slice();
      while (slices.length < 6) slices = slices.concat(info.prizes);
      seg = 360 / slices.length;

      const lights = $('lights');
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const el = document.createElement('i');
        el.style.left = (50 + Math.sin(a) * 46.5) + '%';
        el.style.top = (50 - Math.cos(a) * 46.5) + '%';
        lights.appendChild(el);
      }
      draw();
      btn.onclick = spin;
    }

    function draw() {
      const ctx = canvas.getContext('2d');
      const c = 320, r = 320;
      ctx.clearRect(0, 0, 640, 640);
      slices.forEach((p, i) => {
        const a0 = (-90 + i * seg) * Math.PI / 180;
        const a1 = (-90 + (i + 1) * seg) * Math.PI / 180;
        const g = ctx.createRadialGradient(c, c, 40, c, c, r);
        const base = i % 2 ? shade(p.color, -18) : p.color;
        g.addColorStop(0, shade(base, 40));
        g.addColorStop(1, base);
        ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, a0, a1); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.stroke();

        // 文字沿半徑方向排列
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate((-90 + (i + 0.5) * seg) * Math.PI / 180);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        // 依格子深淺自動選黑字或白字
        const lightSlice = lum(base) > 0.58;
        ctx.fillStyle = lightSlice ? '#2A1D00' : '#FFFFFF';
        ctx.shadowColor = lightSlice ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4;
        // 文字只能放在中央按鈕外圍（約 170px 寬），放不下就縮小字級
        const { lines, size } = fitText(ctx, p.name, 170, slices.length > 8 ? [24, 20, 17] : [30, 26, 22, 19]);
        lines.forEach((t, li) => ctx.fillText(t, r - 26, (li - (lines.length - 1) / 2) * (size + 4)));
        ctx.restore();
      });
    }

    function setAngle(a) { canvas.style.transform = 'rotate(' + a + 'deg)'; }

    let lastTick = 0;
    function tickPointer() {
      const k = Math.floor(angle / seg);
      if (k !== lastTick) {
        lastTick = k;
        wrap.classList.remove('ticking'); void wrap.offsetWidth; wrap.classList.add('ticking');
      }
    }

    async function spin() {
      btn.disabled = true;
      wrap.classList.add('spinning');
      $('hint').textContent = '轉動中…';

      let result = null, error = null;
      requestDraw().then(r => { result = r; }, e => { error = e; });

      // 第一段：加速並等後端回傳（至少轉 1.4 秒）
      let v = 0;
      const vmax = 0.95; // 度/毫秒
      const t0 = performance.now();
      let last = t0;
      await new Promise(done => {
        function step(now) {
          const dt = Math.min(48, now - last); last = now;
          v = Math.min(vmax, v + dt * 0.0016);
          angle += v * dt; setAngle(angle); tickPointer();
          if ((result || error) && now - t0 > 1400) return done();
          requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });

      // 第二段：減速停到結果那一格（有錯誤就隨便停）
      let targetIdx = -1;
      if (result && (result.status === 'win' || result.status === 'lose')) {
        const matches = slices.map((p, i) => (p.name === result.prize ? i : -1)).filter(i => i >= 0);
        targetIdx = matches.length ? matches[Math.floor(Math.random() * matches.length)] : -1;
      }
      const T = 4600;
      let end = angle + v * T / 3;
      if (targetIdx >= 0) {
        const theta = (targetIdx + 0.5) * seg + (Math.random() - 0.5) * seg * 0.6;
        const want = ((-theta % 360) + 360) % 360;
        end += ((want - (end % 360)) % 360 + 360) % 360;
      }
      const start = angle, dist = end - start, ts = performance.now();
      await new Promise(done => {
        function step(now) {
          const k = Math.min(1, (now - ts) / T);
          angle = start + dist * (1 - Math.pow(1 - k, 3));
          setAngle(angle); tickPointer();
          if (k < 1) requestAnimationFrame(step); else done();
        }
        requestAnimationFrame(step);
      });

      wrap.classList.remove('spinning');
      if (error || !result || result.status === 'message') {
        btn.disabled = false;
        $('hint').textContent = '點中間按鈕開始抽獎';
        return showMessage(error ? error.message : result.text);
      }
      if (result.status === 'win') wrap.classList.add('won');
      await sleep(350);
      showDone(result);
      showResult(result);
    }

    function showDone(r) {
      btn.disabled = true;
      btn.textContent = r.status === 'win' ? '中' : '完';
      $('hint').textContent = '你的結果：' + r.prize;
      if (!r.already) return;
      // 已抽過：直接把輪盤轉到結果那格
      const i = slices.findIndex(p => p.name === r.prize);
      if (i >= 0) { angle = -((i + 0.5) * seg); setAngle(angle); }
    }

    return { mount, showDone };
  })();

  // ===================== 扭蛋機 =====================

  const Gacha = (() => {
    let root, knob;

    function mount() {
      $('stage').innerHTML =
        '<div class="gacha" id="gacha">' +
        '  <div class="dome"><div class="balls" id="balls"></div><div class="dome-shine"></div></div>' +
        '  <div class="machine" id="machine"><div class="plate">LUCKY</div>' +
        '    <button class="knob" id="knob" aria-label="轉動把手"></button><div class="knob-tip">轉我</div>' +
        '    <div class="chute"></div></div>' +
        '</div><p class="hint" id="hint">轉動把手開始扭蛋</p>';
      root = $('gacha'); knob = $('knob');

      // 球堆在下半部，位置固定但看起來隨機
      const spots = [[8, 62], [30, 66], [52, 64], [72, 60], [18, 44], [40, 46], [62, 44], [80, 40], [28, 26], [50, 28], [70, 24], [6, 30], [86, 58]];
      const balls = $('balls');
      spots.forEach(([x, y], i) => {
        const p = info.prizes[i % info.prizes.length];
        const b = document.createElement('div');
        b.className = 'ball';
        b.style.cssText = 'left:' + x + '%;top:' + y + '%;--c:' + p.color + ';--rot:' + ((i * 67) % 360) + 'deg';
        balls.appendChild(b);
      });
      knob.onclick = turn;
    }

    async function turn() {
      knob.disabled = true;
      $('hint').textContent = '喀啦喀啦…';
      root.classList.add('shaking');
      knob.classList.add('turn');

      const [res] = await Promise.allSettled([requestDraw(), sleep(1700)]);
      root.classList.remove('shaking');

      if (res.status === 'rejected' || res.value.status === 'message') {
        knob.classList.remove('turn');
        knob.disabled = false;
        $('hint').textContent = '轉動把手開始扭蛋';
        return showMessage(res.status === 'rejected' ? res.reason.message : res.value.text);
      }
      const r = res.value;
      const color = prizeOf(r).color;

      // 膠囊從出口掉出來
      const drop = document.createElement('div');
      drop.className = 'drop-cap';
      drop.innerHTML = capsule(color);
      $('machine').appendChild(drop);
      await sleep(1000);

      // 放大到畫面中央，搖三下，點一下打開
      const stage = document.createElement('div');
      stage.className = 'reveal';
      stage.style.setProperty('--c', color);
      stage.innerHTML = (r.status === 'win' ? '<div class="glow"></div>' : '') + capsule(color) + '<p>點一下打開</p>';
      document.body.appendChild(stage);
      drop.remove();
      const cap = stage.querySelector('.cap');
      await sleep(700);
      cap.classList.add('wobble');

      await new Promise(done => {
        const timer = setTimeout(done, 3500);
        stage.onclick = () => { clearTimeout(timer); done(); };
      });
      stage.onclick = null;
      stage.querySelector('p').remove();
      cap.classList.remove('wobble');
      cap.classList.add('open');
      if (navigator.vibrate) navigator.vibrate(40);
      await sleep(550);
      stage.remove();
      showDone(r);
      showResult(r);
    }

    function capsule(color) {
      return '<div class="cap" style="--c:' + color + '"><div class="cap-top"></div><div class="cap-bot"></div><div class="cap-band"></div></div>';
    }

    function showDone(r) {
      knob.disabled = true;
      $('hint').textContent = '你的結果：' + r.prize;
    }

    return { mount, showDone };
  })();

  // ===================== 刮刮卡 =====================

  const Scratch = (() => {
    let canvas, ctx, getBtn, revealed = false;

    function mount() {
      $('stage').innerHTML =
        '<div class="scratch-card">' +
        '  <div class="sc-head">刮刮樂</div><div class="sc-sub">' + esc(info.activity) + '</div>' +
        '  <div class="sc-area" id="scArea">' +
        '    <div class="sc-result" id="scResult"></div>' +
        '    <canvas id="scCanvas"></canvas>' +
        '    <button class="btn sc-get" id="scGet">領取刮刮卡</button>' +
        '  </div>' +
        '  <div class="sc-foot" id="scFoot">刮開銀漆揭曉結果</div>' +
        '</div><p class="hint" id="hint">每人限領一張</p>';
      canvas = $('scCanvas'); getBtn = $('scGet');
      paintCover(true);
      getBtn.onclick = take;
    }

    function paintCover(locked) {
      const area = $('scArea');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = area.clientWidth * dpr;
      canvas.height = area.clientHeight * dpr;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.scale(dpr, dpr);
      const w = area.clientWidth, h = area.clientHeight;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d9d9e0'); g.addColorStop(.45, '#f4f4f8'); g.addColorStop(.55, '#bdbdc8'); g.addColorStop(1, '#e2e2ea');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      // 細顆粒
      for (let i = 0; i < w * h / 18; i++) {
        ctx.fillStyle = Math.random() > .5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.06)';
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
      }
      if (!locked) {
        ctx.fillStyle = 'rgba(80,80,100,.55)';
        ctx.font = '700 18px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('👆 用手指刮開這裡', w / 2, h / 2);
      }
    }

    async function take() {
      getBtn.disabled = true;
      getBtn.innerHTML = '<span class="spinner"></span>發卡中…';
      let r;
      try {
        r = await requestDraw();
      } catch (err) {
        getBtn.disabled = false; getBtn.textContent = '領取刮刮卡';
        return showMessage(err.message);
      }
      if (r.status === 'message') {
        getBtn.disabled = false; getBtn.textContent = '領取刮刮卡';
        return showMessage(r.text);
      }
      if (r.already) { getBtn.remove(); showDone(r); return showResult(r); }

      fillResult(r);
      getBtn.remove();
      paintCover(false);
      $('hint').textContent = '刮開超過一半就會揭曉';
      enableScratch(r);
    }

    function fillResult(r) {
      const p = prizeOf(r);
      $('scResult').innerHTML =
        '<div class="emoji">' + (r.status === 'win' ? '🎉' : '🍀') + '</div>' +
        '<div class="name" style="color:' + (r.status === 'win' ? shade(p.color, -35) : '#777') + '">' + esc(r.prize) + '</div>';
    }

    function enableScratch(r) {
      let drawing = false, last = null, moves = 0;
      const pos = e => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
      const scratchTo = p => {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = 42; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo((last || p).x, (last || p).y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
        if (++moves % 10 === 0 && clearedRatio() > 0.5) finish(r);
      };
      canvas.onpointerdown = e => { drawing = true; last = null; canvas.setPointerCapture(e.pointerId); scratchTo(pos(e)); };
      canvas.onpointermove = e => { if (drawing) scratchTo(pos(e)); };
      canvas.onpointerup = canvas.onpointercancel = () => {
        drawing = false; last = null;
        if (clearedRatio() > 0.5) finish(r);
      };
    }

    function clearedRatio() {
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      let clear = 0, total = 0;
      const step = 4 * 12;
      for (let i = 3; i < data.length; i += step) { total++; if (data[i] === 0) clear++; }
      return clear / total;
    }

    function finish(r) {
      if (revealed) return;
      revealed = true;
      canvas.classList.add('gone');
      setTimeout(() => { showDone(r); showResult(r); }, 600);
    }

    function showDone(r) {
      revealed = true;
      fillResult(r);
      canvas.classList.add('gone');
      const b = $('scGet'); if (b) b.remove();
      $('hint').textContent = '你的結果：' + r.prize;
    }

    return { mount, showDone };
  })();

  // ===================== 小工具 =====================

  /** 依實際寬度換行（英數單字不拆開），最多兩行；放不下就換小一級字，最後一級仍放不下則截斷加… */
  function fitText(ctx, text, maxW, sizes) {
    const tokens = String(text).match(/[A-Za-z0-9$%.,+\-]+|\s+|./g) || [''];
    for (let s = 0; s < sizes.length; s++) {
      const size = sizes[s];
      ctx.font = '900 ' + size + 'px "Noto Sans TC", sans-serif';
      const lines = [''];
      tokens.forEach(t => {
        const cur = lines[lines.length - 1];
        if (ctx.measureText(cur + t).width <= maxW || !cur.trim()) lines[lines.length - 1] = cur + t;
        else lines.push(t.trim());
      });
      const clean = lines.map(l => l.trim()).filter(Boolean);
      const fits = clean.length <= 2 && clean.every(l => ctx.measureText(l).width <= maxW);
      if (fits || s === sizes.length - 1) {
        if (!fits) {
          clean.length = Math.min(clean.length, 2);
          while (clean[1] && ctx.measureText(clean[1] + '…').width > maxW) clean[1] = clean[1].slice(0, -1);
          if (clean[1] !== undefined) clean[1] += '…';
        }
        return { lines: clean, size };
      }
    }
  }

  /** 相對亮度 0～1 */
  function lum(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  }

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v + (pct > 0 ? (255 - v) : v) * pct / 100)));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
  }

  main();
})();
