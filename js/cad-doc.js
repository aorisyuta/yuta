/* =====================================================================
   UniBoard CAD — 図面ドキュメント操作
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore;

  function newDoc() { return { components: [], wires: [], junctions: [], nextId: 1 }; }

  /** 古いデータや生成物のために、接続点へ ID を補う */
  function ensureIds(doc) {
    (doc.junctions || []).forEach(j => { if (!j.id) j.id = 'j' + (doc.nextId++); });
    return doc;
  }

  function autoRef(doc, prefix) {
    if (prefix === '#PWR' || prefix === '#LBL') return prefix + doc.nextId;
    let n = 1;
    const used = new Set(doc.components.map(c => c.ref));
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }

  function addComponent(doc, type, x, y, rot, init) {
    const s = type === 'CUSTOM' ? C1.customSym({ props: (init && init.props) || {} }) : C1.SYM[type];
    if (!s) return null;
    const c = {
      id: 'c' + (doc.nextId++), type, x, y, rot: rot || 0,
      ref: (init && init.ref) || autoRef(doc, s.prefix || 'U'),
      val: (init && init.val !== undefined && init.val !== null) ? init.val : (s.val || ''),
      props: Object.assign({}, s.props, (init && init.props) || {})
    };
    doc.components.push(c);
    return c;
  }
  function addWire(doc, x1, y1, x2, y2) {
    if (x1 === x2 && y1 === y2) return null;
    for (const w of doc.wires)
      if ((w.x1 === x1 && w.y1 === y1 && w.x2 === x2 && w.y2 === y2) ||
          (w.x1 === x2 && w.y1 === y2 && w.x2 === x1 && w.y2 === y1)) return null;
    const w = { id: 'w' + (doc.nextId++), x1, y1, x2, y2 };
    doc.wires.push(w); return w;
  }
  function loadSample(s) {
    const doc = newDoc();
    for (const c of s.components) addComponent(doc, c.type, c.x, c.y, c.rot, { ref: c.ref, val: c.val, props: c.props });
    for (const w of s.wires) addWire(doc, w.x1, w.y1, w.x2, w.y2);
    doc.junctions = s.junctions.map(j => ({ x: j.x, y: j.y }));
    doc.nextId = Math.max(doc.nextId, 1000);
    return ensureIds(doc);
  }
  const APP_VERSION = '2026.09.27';
  function serialize(doc) {
    return JSON.stringify({
      v: 2, app: APP_VERSION, types: [...new Set(doc.components.map(c => c.type))].sort(),
      components: doc.components.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot, ref: c.ref, val: c.val, props: c.props })),
      wires: doc.wires.map(w => ({ id: w.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 })),
      junctions: doc.junctions.map(j => ({ id: j.id, x: j.x, y: j.y })), nextId: doc.nextId,
      perfboard: doc.perfboard || undefined   // 蛇の目基板の手配置 (部品の穴位置と配線)
    }, null, 1);
  }
  function deserialize(txt) {
    const o = JSON.parse(txt);
    return ensureIds({
      components: o.components || [], wires: o.wires || [],
      junctions: o.junctions || [], nextId: o.nextId || 1000, perfboard: o.perfboard || undefined
    });
  }

  /* ---------- 完全パイプライン: 図面 → 基板 ---------- */
  function convert(doc, cfg, hooks) {
    cfg = Object.assign({ type: 'perf', cols: 0, rows: 0, stripDir: 'row', quality: 1, policy: 'auto' }, cfg);
    const nets = C1.extractNets(doc);
    const prj = global.CADBoard.buildProject(doc, nets);
    let board;
    if (cfg.cols && cfg.rows) board = { cols: cfg.cols, rows: cfg.rows };
    else board = global.CADBoard.autoBoardSize(prj, cfg.type);
    board.type = cfg.type; board.stripDir = cfg.stripDir;
    if (cfg.corner && cfg.cols && cfg.rows && cfg.type !== 'strip') { board.keepout = global.CADBoard.cornerKeepout(board.cols, board.rows, cfg.corner); board.corner = cfg.corner; }
    const placer = global.CADBoard.makePlacer(prj, board, { seed: cfg.seed || 12345, crowdW: cfg.type === 'strip' ? 0 : [1, 2.5, 4][cfg.spacing == null ? 1 : cfg.spacing] });
    placer.finish();
    if (!cfg.cols || !cfg.rows) global.CADBoard.compactBoard(prj, board, 2);
    let result = null, strip = null, problems;
    if (cfg.type === 'strip') {
      strip = global.CADBoard.stripConvert(prj, board);
      result = { routes: new Map(), stats: {}, metrics: { totalLen: 0, vias: 0, forced: strip.jumpers.length, topLen: 0, botLen: 0, nets: prj.nets.length, routed: prj.nets.length } };
      problems = global.CADBoard.verify(prj, board, result, strip);
    } else {
      const ropt = { topExtra: cfg.policy === 'jumper' ? -2 : cfg.policy === 'solder' ? 14 : 5,
                     viaCost: cfg.policy === 'jumper' ? 30 : 55,
                     maxPass: 5 + (cfg.quality | 0) * 3 + (cfg.forced === false ? 3 : 0), seed: cfg.seed || 7,
                     noForced: cfg.forced === false, reduceTop: [300, 1000, 3000][cfg.quality | 0] || 1000 };
      result = global.CADBoard.routeAll(prj, board, ropt);
      problems = global.CADBoard.verify(prj, board, result, null);
    }
    return { nets, prj, board, result, strip, problems, erc: C1.erc(doc, nets) };
  }

  global.CADDoc = { newDoc, addComponent, addWire, autoRef, loadSample, serialize, deserialize, convert, ensureIds };
})(typeof window !== 'undefined' ? window : globalThis);
