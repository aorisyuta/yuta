/* ---- md.js ---- */
/* =====================================================================
   UniBoard SPICE — Android (Material Design 3) の画面部品
   アプリバー (︙メニュー) / ナビゲーションバー・レール / FAB / 波紋 / 触感 /
   ボトムシートのスワイプで閉じる / システムバーの色合わせ
   html.md のときだけ組み立てる (それ以外は切り替え関数だけ用意)
   ===================================================================== */
(function () {
  'use strict';
  const D = document.documentElement;
  if (!D.classList.contains('md')) return;

  const UB = window.UniBoard, A = UB.api, S = () => UB.state;
  const $ = id => document.getElementById(id);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const bridge = window.AndroidBridge;
  // 触感: 1 = 軽いタップ / 16 = 完了 / 17 = 失敗
  const haptic = k => { try { if (bridge && bridge.haptic) bridge.haptic(k || 1); } catch (e) { } };
  window.UBHaptic = haptic;

  const ic = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const IC = {
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    more: ic('<circle cx="12" cy="5.5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="18.5" r="1.9"/>', true),
    sch: ic('<path d="M2 12h3.5l1.6-4.5 3 9 3-9 3 9 1.6-4.5H22"/>'),
    perf: ic('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><g fill="currentColor" stroke="none"><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="12" cy="8.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/><circle cx="8.5" cy="12" r="1.3"/><circle cx="15.5" cy="12" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/><circle cx="12" cy="15.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/></g><path d="M12 12h3.5"/>'),
    pcb: ic('<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>'),
    play: ic('<path d="M8 5.2v13.6L19 12z"/>', true),
    folder: ic('<path d="M3.5 18.5V6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5Z"/>'),
    wave: ic('<path d="M2.5 12h3l2-6 3.5 12 2.5-8.5 1.5 2.5h6.5"/>'),
    open: ic('<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>'),
    save: ic('<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>'),
    all: ic('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.2"/>'),
    info: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>'),
    theme: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor"/>'),
    style: ic('<rect x="3.5" y="5" width="17" height="11.5" rx="1.8"/><path d="M8.5 20h7M12 16.5V20"/>'),
    parts: ic('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    calc: ic('<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M8 7h8M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h.01M15.5 18h.01" stroke-width="2.2"/>'),
    search: ic('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>')
  };

  /* ================= アプリバー ================= */
  const bar = document.querySelector('.bar');
  const navBtn = el('button', 'btn md-navbtn', IC.menu); navBtn.type = 'button'; navBtn.title = '部品リスト'; navBtn.setAttribute('aria-label', '部品リスト');
  navBtn.onclick = () => { haptic(); $('bPal2').click(); };
  const title = el('div', 'md-title');
  bar.insertBefore(title, bar.firstChild); bar.insertBefore(navBtn, title);
  $('bCmd').querySelector('svg').outerHTML = IC.search;
  $('bCalc').querySelector('svg').outerHTML = IC.calc;
  $('bCmd').setAttribute('aria-label', '検索'); $('bCalc').setAttribute('aria-label', '計算ツール');
  const more = el('button', 'btn md-more', IC.more); more.type = 'button'; more.title = 'その他'; more.setAttribute('aria-label', 'その他のメニュー');
  more.onclick = e => { e.stopPropagation(); menu ? closeMenu() : openMenu(); };
  bar.appendChild(more);

  /* ================= ︙ メニュー ================= */
  let menu = null;
  const themeName = () => { const m = /:\s*([^（(]+)/.exec($('bTheme').title || ''); return m ? m[1].trim() : ''; };
  function items() {
    const tab = document.body.dataset.mdtab;
    return [
      [IC.folder, 'サンプル回路', () => $('bSample').click()],
      [IC.wave, 'SPICE サンプル回路', () => window.UBSpiceSamples && window.UBSpiceSamples()],
      null,
      [IC.open, '開く…', () => $('bImport').click()],
      [IC.save, 'ダウンロード…', () => $('bExport').click()],
      null,
      tab === 'sch' && [IC.parts, '部品リスト', () => $('bPal2').click(), $('bPal2').getAttribute('aria-pressed') === 'true' ? '表示中' : ''],
      tab === 'sch' && [IC.all, 'すべて選択', () => $('bAll').click()],
      tab !== 'pcbx' && [IC.info, '情報パネル', () => $('bInsp').click(), $('bInsp').getAttribute('aria-pressed') === 'true' ? '表示中' : ''],
      [IC.theme, '表示テーマ', () => $('bTheme').click(), themeName()]
    ].filter(x => x !== false);
  }
  function openMenu() {
    closeMenu();
    menu = el('div', 'md-menu'); menu.setAttribute('role', 'menu');
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
    menu.style.top = Math.max(8, r.top + 4) + 'px';
    menu.style.right = Math.max(8, innerWidth - r.right + 4) + 'px';
    more.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; more.setAttribute('aria-expanded', 'false'); } }
  document.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target) && e.target !== more && !more.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* ================= ナビゲーションバー / レール ================= */
  const nav = el('nav', 'md-nav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '画面');
  const logo = el('div', 'md-rail-logo', document.querySelector('.brand .logo').outerHTML); nav.appendChild(logo);
  const DEST = [['tabSch', 'sch', '回路図', IC.sch, '回路図'], ['tabPcb', 'pcb', '蛇の目基板', IC.perf, '蛇の目基板'], ['tabPcbx', 'pcbx', 'PCB', IC.pcb, 'PCB 設計']];
  DEST.forEach(([id, key, label, icon]) => {
    const b = el('button', 'md-nav-it', '<span class="md-ind">' + icon + '</span><span class="md-lbl">' + label + '</span>');
    b.type = 'button'; b.dataset.for = id; b.setAttribute('role', 'tab');
    b.onclick = () => { if ($(id).getAttribute('aria-selected') !== 'true') haptic(); closeMenu(); $(id).click(); };
    nav.appendChild(b);
  });
  document.body.appendChild(nav);

  /* ================= FAB (シミュレーション実行) ================= */
  const fab = el('button', 'md-fab', IC.play + '<span>シミュレーション</span>');
  fab.type = 'button'; fab.title = 'シミュレーション実行 (F5)'; fab.setAttribute('aria-label', 'シミュレーション実行');
  fab.onclick = () => { haptic(); $('bRunQ').click(); };
  $('stage').appendChild(fab);

  /* ================= 画面の切り替えに合わせる ================= */
  function sync() {
    const d = DEST.find(x => $(x[0]).getAttribute('aria-selected') === 'true') || DEST[0];
    document.body.dataset.mdtab = d[1];
    nav.querySelectorAll('.md-nav-it').forEach(b => b.setAttribute('aria-selected', String(b.dataset.for === d[0])));
    title.innerHTML = d[4] + '<small>UniBoard SPICE</small>';
    navBtn.hidden = d[1] !== 'sch';
    closeMenu();
    systemBars();
  }
  new MutationObserver(sync).observe(document.querySelector('.bar > .tabs'), { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });

  /* ================= 波紋 (リップル) ================= */
  const RSEL = '.btn,.md-nav-it,.itabs button,.dk-tabs button,.dk-types button,.tabs button,.lc,.lr,.cmdk-it,.md-menu button,.calc-nav button,.scard,.md-fab,.wv-chip,.netrow,.pclose';
  document.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const t = e.target.closest && e.target.closest(RSEL); if (!t || t.disabled) return;
    const host0 = t.classList.contains('md-nav-it') ? t.querySelector('.md-ind') : t;
    if (getComputedStyle(host0).position === 'static') host0.style.position = 'relative';
    let h = host0.querySelector(':scope > .md-rh');
    if (!h) { h = el('span', 'md-rh'); host0.insertBefore(h, host0.firstChild); }
    const r = host0.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2.1;
    const p = el('span', 'md-rp');
    p.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    h.appendChild(p);
    setTimeout(() => { p.remove(); if (h.isConnected && !h.childElementCount) h.remove(); }, 620);
  }, { passive: true, capture: true });

  /* ================= 触感 ================= */
  // ツールの切り替え・選択でも軽く震わせる
  document.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('.tools .btn,.px-bar .btn,.dk-types button,.itabs button,.lc,.lr');
    if (t) haptic();
  }, true);
  const toast0 = window.UBToast;
  if (toast0) window.UBToast = (t, lv) => { if (lv === 'err') haptic(17); else if (lv === 'ok') haptic(16); return toast0(t, lv); };

  /* ================= ボトムシートを下へスワイプして閉じる ================= */
  const compact = () => innerWidth <= 640;
  function swipeClose(sheet, close) {
    const h = el('div', 'md-handle'); h.setAttribute('aria-hidden', 'true'); sheet.insertBefore(h, sheet.firstChild);
    let y0 = null, dy = 0;
    h.addEventListener('pointerdown', e => { if (!compact()) return; y0 = e.clientY; dy = 0; h.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
    h.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = dy ? `translateY(${dy}px)` : ''; });
    const end = () => {
      if (y0 == null) return; y0 = null;
      sheet.style.transition = 'transform .22s cubic-bezier(.2,0,0,1)';
      if (dy > Math.min(120, sheet.offsetHeight * .25)) { haptic(); sheet.style.transform = 'translateY(100%)'; setTimeout(() => { close(); sheet.style.transform = ''; sheet.style.transition = ''; }, 200); }
      else { sheet.style.transform = ''; setTimeout(() => { sheet.style.transition = ''; }, 230); }
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    h.addEventListener('click', () => { if (compact() && dy < 4) close(); });
  }
  swipeClose($('inspector'), () => $('inspClose').click());
  swipeClose(document.querySelector('#modal .sheet'), () => $('modalClose').click());

  /* ================= Android の戻るボタン: メニューを先に閉じる ================= */
  const back0 = window.UBAndroidBack;
  window.UBAndroidBack = () => { if (menu) { closeMenu(); return true; } return back0 ? back0() : false; };

  /* ================= システムバー (ステータスバー・ナビゲーションバー) の色 ================= */
  const hex = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('') : null; };
  let barsQ = 0;
  function systemBars() {
    if (!bridge || !bridge.setSystemBars) return;
    cancelAnimationFrame(barsQ);
    barsQ = requestAnimationFrame(() => {
      const top = hex(getComputedStyle(bar).backgroundColor) || '#f5fbf7';
      const bottom = hex(getComputedStyle(nav).backgroundColor) || top;
      const light = parseInt(top.slice(1, 3), 16) + parseInt(top.slice(3, 5), 16) + parseInt(top.slice(5, 7), 16) > 382;
      try { bridge.setSystemBars(top, innerWidth >= 600 ? top : bottom, light); } catch (e) { }
    });
  }
  new MutationObserver(systemBars).observe(D, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) { const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(systemBars); }
  window.addEventListener('resize', systemBars);

  sync();
  requestAnimationFrame(() => { A.resize(); A.rp(); });
})();
