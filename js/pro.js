if (!window.AndroidBridge) {
/* ---- pro.js ---- */
/* =====================================================================
   UniBoard SPICE — Pro テーマの画面部品 と PRO 機能の解除
   ・ヒント (操作説明) をキャンバスの上ではなくフッターに出す
   ・スマホ用の︙メニュー
   ・PRO: 完成した蛇の目基板の配置修正 (部品の移動・回転・配線の引き直し) を
     パスワードで解除する。判定はブラウザ内だけの簡易なもの。
   ===================================================================== */
(function () {
  'use strict';
  const D = document.documentElement;
  const UB = window.UniBoard, A = UB.api, S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const H = window.UBHooks = window.UBHooks || {};
  const toast = (t, l) => window.UBToast && window.UBToast(t, l);

  /* ================= 設定 (ここを書き換える) ================= */
  // 使い方ガイド (note 記事) の URL。公開したらここに貼る
  const GUIDE_URL = 'https://note.com/';
  // パスワードのハッシュ値。変えるときはブラウザのコンソールで UBPro.hash('新しいパスワード') を実行し、出た値をここに貼る
  const PASS_HASH = '64d6193967fa2';   // 初期パスワード: UBPRO2026
  const SALT = 'uniboard-spice/pro/v1';

  /* ================= PRO の状態 ================= */
  function hash(s) {
    // cyrb53 (暗号ではない簡易ハッシュ)
    s = SALT + '|' + String(s).trim();
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
  const KEY = 'ubspice.pro';
  let unlocked = false;
  try { unlocked = localStorage.getItem(KEY) === PASS_HASH; } catch (e) { }
  function setUnlocked(v) {
    unlocked = v;
    try { v ? localStorage.setItem(KEY, PASS_HASH) : localStorage.removeItem(KEY); } catch (e) { }
    syncBadge(); lockHint(); if (A.hint) A.hint();
  }

  const ICO = {
    lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2"/></svg>',
    open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.4-1"/></svg>',
    board: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M8 8h3v3H8zM13 13h3v3h-3z"/><path d="M11 9.5h3.5V13"/></svg>',
    more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3.4" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="8" cy="12.6" r="1.4"/></svg>',
    theme: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.6"/><path d="M8 2.4v11.2a5.6 5.6 0 0 0 0-11.2Z" fill="currentColor"/></svg>',
    folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.2 12.4V4.2a1.5 1.5 0 0 1 1.5-1.5h2.6l1.6 2.1h4.4a1.5 1.5 0 0 1 1.5 1.5v6.1a1.5 1.5 0 0 1-1.5 1.5H3.7a1.5 1.5 0 0 1-1.5-1.5Z"/></svg>',
    wave: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 8h2.4l1.6-4.6 2.6 9.2 1.8-6.4 1.1 1.8h2.9"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6v8M5 5.6 8 2.6l3 3M2.8 10.4v1.6a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.6"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6v8M5 7.6l3 3 3-3M2.8 10.4v1.6a1.4 1.4 0 0 0 1.4 1.4h7.6a1.4 1.4 0 0 0 1.4-1.4v-1.6"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.1" r=".95" fill="currentColor" stroke="none"/></svg>',
    calc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="1.8" width="10" height="12.4" rx="1.6"/><path d="M5.4 4.6h5.2M5.6 8h.1M8 8h.1M10.4 8h.1M5.6 10.6h.1M8 10.6h.1M10.4 10.6h.1" stroke-linecap="round"/></svg>',
    key: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="5.5" cy="10.5" r="3"/><path d="m7.6 8.4 5.6-5.6M11.2 4.8l1.6 1.6M9.8 6.2l1.2 1.2"/></svg>',
    book: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 3.2h4a1.5 1.5 0 0 1 1.5 1.5v8.6a1.2 1.2 0 0 0-1.2-1.2H2.5zM13.5 3.2h-4A1.5 1.5 0 0 0 8 4.7v8.6a1.2 1.2 0 0 1 1.2-1.2h4.3z"/></svg>'
  };

  /* ================= フッター: ヒント + ステータス ================= */
  if (D.classList.contains('pro')) {
    const foot = el('div', 'pro-foot');
    const status = $('status');
    status.parentNode.insertBefore(foot, status);
    foot.appendChild($('hint'));
    if ($('pxHint')) foot.appendChild($('pxHint'));
    foot.appendChild(status);
    const tip = () => { const h = $('hint'); h.title = h.textContent; const p = $('pxHint'); if (p) p.title = p.textContent; };
    new MutationObserver(tip).observe(foot, { childList: true, subtree: true, characterData: true });
  }

  /* ================= 上のバー ================= */
  $('bTheme').innerHTML = ICO.theme;
  const bar = document.querySelector('.bar');
  const badge = el('button', 'btn pro-badge'); badge.type = 'button';
  badge.onclick = () => openUnlock();
  bar.insertBefore(badge, $('bTheme'));
  function syncBadge() {
    badge.innerHTML = (unlocked ? ICO.open : ICO.lock) + '<span>PRO</span>';
    badge.classList.toggle('on', unlocked);
    badge.title = unlocked ? 'PRO 機能: 有効' : 'PRO 機能を解除する';
  }
  syncBadge();

  /* ︙ メニュー (スマホ) */
  const more = el('button', 'btn icon pro-more', ICO.more); more.type = 'button'; more.title = 'メニュー'; more.setAttribute('aria-label', 'メニュー');
  bar.appendChild(more);
  let menu = null;
  function items() {
    const pcbx = document.body.classList.contains('pcbx-on');
    return [
      [ICO.folder, 'サンプル回路・新規', () => $('bSample').click()],
      [ICO.wave, 'SPICE サンプル回路', () => window.UBSpiceSamples && window.UBSpiceSamples()],
      null,
      [ICO.up, '開く…', () => $('bImport').click()],
      [ICO.down, 'ダウンロード…', () => $('bExport').click()],
      null,
      !pcbx && [ICO.info, '情報パネル', () => $('bInsp').click(), $('bInsp').getAttribute('aria-pressed') === 'true' ? '表示中' : ''],
      [ICO.calc, '計算ツール', () => window.UBCalc && window.UBCalc.open()],
      [ICO.theme, '表示テーマ', () => $('bTheme').click(), ((/:\s*([^（(]+)/.exec($('bTheme').title || '') || [])[1] || '').trim()],
      null,
      [unlocked ? ICO.open : ICO.lock, 'PRO 機能', () => openUnlock(), unlocked ? '有効' : '未解除'],
      [ICO.book, '使い方ガイド', () => window.open(GUIDE_URL, '_blank', 'noopener')]
    ].filter(x => x !== false);
  }
  function openMenu() {
    closeMenu();
    menu = el('div', 'pro-menu'); menu.setAttribute('role', 'menu');
    let prevSep = true;
    items().forEach(it => {
      if (!it) { if (!prevSep) menu.appendChild(el('hr')); prevSep = true; return; }
      const b = el('button', null, it[0] + '<span>' + it[1] + '</span>' + (it[3] ? '<em>' + it[3] + '</em>' : ''));
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.onclick = () => { closeMenu(); it[2](); };
      menu.appendChild(b); prevSep = false;
    });
    document.body.appendChild(menu);
    const r = more.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.right = Math.max(6, innerWidth - r.right) + 'px';
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  more.onclick = e => { e.stopPropagation(); menu ? closeMenu() : openMenu(); };
  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target) && !more.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* ================= PRO の解除画面 ================= */
  function openUnlock(reason) {
    A.openModal('UniBoard SPICE PRO', body => {
      const w = el('div', 'pro-unlock');
      const head = el('div', 'pu-head');
      head.appendChild(el('div', 'pu-ico', ICO.board));
      const t = el('div');
      t.appendChild(el('h4', null, unlocked ? 'PRO 機能は有効です' : '完成した基板を、手で仕上げる'));
      t.appendChild(el('p', null, reason || '自動生成された蛇の目基板のパターン図を、部品単位で手直しできる機能です。'));
      head.appendChild(t); w.appendChild(head);
      const ul = el('ul');
      ['部品をドラッグして移動 — 関係する配線だけを自動で引き直し', 'R キー / ボタンで 90° 回転 (置けないときは近くの空きを自動で探す)',
        '置けない場所は赤い影で表示、つながる相手を点線でガイド', '元に戻す / やり直し (最大 60 手)'].forEach(s => ul.appendChild(el('li', null, s)));
      w.appendChild(ul);
      if (unlocked) {
        w.appendChild(el('p', 'pu-ok', 'このブラウザでは PRO 機能が使えます。蛇の目基板の画面で部品をドラッグしてください。'));
        const off = el('button', 'btn', 'この端末の解除を取り消す'); off.type = 'button';
        off.onclick = () => { setUnlocked(false); $('modal').hidden = true; toast('PRO 機能の解除を取り消しました'); };
        w.appendChild(el('div', 'pu-row')).appendChild(off);
      } else {
        w.appendChild(el('p', null, 'パスワードは使い方ガイド (note 有料記事) に記載しています。ご購入いただいた分は Android アプリ版の開発にも充てています。'));
        const row = el('div', 'pu-row');
        const inp = el('input'); inp.type = 'password'; inp.placeholder = 'パスワード'; inp.autocomplete = 'off'; inp.spellcheck = false;
        const go = el('button', 'btn primary', '解除'); go.type = 'button';
        const err = el('div', 'pu-err');
        const tryIt = () => {
          if (hash(inp.value) === PASS_HASH) { setUnlocked(true); $('modal').hidden = true; toast('PRO 機能を解除しました。蛇の目基板で部品をドラッグできます', 'ok'); }
          else { err.textContent = 'パスワードが違います'; inp.select(); }
        };
        go.onclick = tryIt; inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryIt(); });
        row.appendChild(inp); row.appendChild(go); w.appendChild(row); w.appendChild(err);
        const a = el('a', null, '使い方ガイドを見る (note) →'); a.href = GUIDE_URL; a.target = '_blank'; a.rel = 'noopener';
        w.appendChild(a);
        setTimeout(() => { try { inp.focus(); } catch (e) { } }, 30);
      }
      body.appendChild(w);
    });
  }

  /* ================= 蛇の目基板の配置修正を PRO にする ================= */
  const down0 = H.boardDown;
  if (down0) {
    H.boardDown = (wx, wy, e) => {
      if (unlocked) return down0(wx, wy, e);
      const hit = down0(wx, wy, e);
      if (!hit) return false;
      // 部品をつかんだ → 取り消して案内を出す
      const PE = window.UBPerfEdit;
      if (PE && PE.state) { PE.state.drag = null; PE.state.sel = -1; }
      const be = $('boardEdit'); if (be) be.hidden = true;
      A.rp();
      openUnlock('部品の移動・回転による配置の手直しは PRO 機能です。');
      return true;
    };
  }
  // ロック中は基板画面の操作説明を差し替える
  const LOCKED = '<b>基板</b> — パッドを<b>クリック</b>でネット強調 / 何もない所をドラッグで画面移動 / 部品の移動・回転は <b>PRO</b>';
  function lockHint() {
    const h = $('hint');
    if (!unlocked && S().tab === 'pcb' && S().board && h.innerHTML !== LOCKED && /ドラッグ<\/b>で移動/.test(h.innerHTML)) h.innerHTML = LOCKED;
  }
  new MutationObserver(lockHint).observe($('hint'), { childList: true, subtree: true });

  // シミュレーションを開閉したら、回路図を残りの領域に合わせ直す
  let wasDocked = $('stage').classList.contains('docked');
  new MutationObserver(() => {
    const d = $('stage').classList.contains('docked');
    if (d !== wasDocked) { wasDocked = d; if (S().tab === 'sch') setTimeout(() => { A.resize(); A.fit(); A.rp(); }, 120); }
  }).observe($('stage'), { attributes: true, attributeFilter: ['class'] });

  // 波形パネルの高さを変えるとキャンバスの高さも変わるので、描画解像度を合わせ直す
  let cvQ = 0;
  new ResizeObserver(() => { cancelAnimationFrame(cvQ); cvQ = requestAnimationFrame(() => { A.resize(); A.rp(); }); }).observe($('cv'));

  // 画面の切り替えでパネルの幅が変わるので、寸法を測り直してから基板を全体表示する
  const tab0 = H.onTab;
  H.onTab = t => {
    if (tab0) tab0(t);
    requestAnimationFrame(() => requestAnimationFrame(() => { A.resize(); if (t === 'pcb' && S().board) A.fit(); A.rp(); }));
  };

  // 横向きのスマホでは部品リストを閉じて始める
  if (innerHeight <= 520 && innerWidth > 640 && S().palOpen) { S().palOpen = false; A.applyPanels(); }

  window.UBPro = { hash, open: openUnlock, get unlocked() { return unlocked; } };

  requestAnimationFrame(() => { A.resize && A.resize(); A.rp && A.rp(); });
})();

}
