/* ---- sim-netlist.js ---- */
/* =====================================================================
   UniBoard SPICE — 回路図 → SPICE ネットリスト変換 / IC の動作モデル
   ===================================================================== */
(function (global) {
  'use strict';
  const C1 = global.CADCore, SP = global.Spice, CP = global.CADParts;
  const num = SP.parseNum;

  /* ---------------- 値の解釈 ---------------- */
  const LEDKEY = { '赤': 'red', 'red': 'red', '橙': 'orange', 'orange': 'orange', '黄': 'yellow', 'yellow': 'yellow', '黄緑': 'yg', '緑': 'green', 'green': 'green', '青': 'blue', 'blue': 'blue', '白': 'white', 'white': 'white', '電球色': 'warm', 'ピンク': 'pink', '紫': 'violet', '赤外': 'ir', 'uv': 'uv', 'led': 'red' };
  const LEDCOLOR = { red: '#ff3b30', orange: '#ff8a00', yellow: '#ffd60a', yg: '#b5e61d', green: '#30d158', blue: '#0a84ff', white: '#f2f7ff', warm: '#ffc66e', pink: '#ff6fb1', violet: '#b56cff', ir: '#b0303a', uv: '#8a5cff' };
  function ledKey(val) {
    const v = String(val || '').trim().toLowerCase();
    for (const k of Object.keys(LEDKEY)) if (v.includes(k.toLowerCase())) return LEDKEY[k];
    return 'red';
  }
  function volts(val, def) {
    const m = String(val || '').replace(/,/g, '.').match(/([+-]?\d+(?:\.\d+)?)\s*V/i) || String(val || '').match(/^([+-]?\d+(?:\.\d+)?)$/);
    return m ? parseFloat(m[1]) : def;
  }
  /* SPICE 向けの数値表記 (10u / 4.7k など) */
  function sn(v) {
    if (!isFinite(v) || v === 0) return String(v);
    const S = [[1e12, 'T'], [1e9, 'G'], [1e6, 'Meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    const a = Math.abs(v);
    for (const [m, p] of S) if (a >= m * 0.9999) return +(v / m).toPrecision(6) + p;
    return v.toExponential(4);
  }
  const clean = s => String(s || '').toUpperCase().replace(/\s+/g, '');
  function modelName(val) { return String(val || '').toLowerCase().replace(/[^a-z0-9._-]/g, ''); }

  /* 既知 IC の対応表 */
  function icModel(val) {
    const v = clean(val);
    if (/^(NE|LM|NJM|TLC|ICM7|LMC|SE|TS|MIC1)?555/.test(v) || /^I?CM7555/.test(v)) return { kind: '555' };
    const op = Object.keys(CP.OPDATA).find(k => v === k || v.startsWith(k));
    if (op) return { kind: 'opamp', d: CP.OPDATA[op], name: op };
    if (/^(LM|NJM)?(393|2903)/.test(v) || /^(TLC3702|TLV3702|MCP6562)/.test(v)) return { kind: 'cmp2' };
    if (/^(LM|NJM)?(339|2901)/.test(v)) return { kind: 'cmp4' };
    if (/^LM311/.test(v)) return { kind: 'cmp1' };
    let m = v.match(/^74(HC|HCT|LS|AC|ACT|ALS|F|S|LV|LVC)?(\d+)/);
    if (m && SP.BUILTINS['logic_' + m[2]]) return { kind: 'logic', key: m[2] };
    m = v.match(/^(CD|TC|MC1|HEF)?(4\d{3,4})B?P?/);
    if (m && SP.BUILTINS['logic_cd' + m[2]]) return { kind: 'logic', key: 'cd' + m[2] };
    if (m && SP.BUILTINS['logic_' + m[2]]) return { kind: 'logic', key: m[2] };
    return null;
  }
  function opParams(o) {
    const d = (o && o.d) || { gbw: 1e6, rr: 0 };
    const hp = d.rr === 2 ? 0.02 : d.rr === 1 ? 1.4 : 1.4, hn = d.rr === 2 ? 0.02 : d.rr === 1 ? 0.02 : 1.4;
    return `gbw=${d.gbw} hrp=${hp} hrn=${hn}`;
  }
  function regParams(val) {
    const v = clean(val);
    let m;
    if (/LM317|LM350|LM338|LM1117-ADJ|ADJ/.test(v)) return 'v=1.25 adj=1 drop=1.8';
    if (/LM337/.test(v)) return 'v=-5 drop=1.8';
    if ((m = v.match(/^79(?:L|M)?(\d{2})/))) return `v=-${+m[1]} drop=1.5`;
    if ((m = v.match(/^78(?:L|M)?(\d{2})/))) return `v=${+m[1]} drop=2`;
    if ((m = v.match(/(\d+(?:\.\d+)?)$/)) || (m = v.match(/-(\d+(?:\.\d+)?)/))) {
      let x = parseFloat(m[1]); if (/33\d?$/.test(m[1]) && x > 30) x = 3.3; if (/^50\d?$/.test(m[1])) x = 5;
      if (x > 30) x = x / 10;
      return `v=${x} drop=${/AMS1117|LD1117|LM1117/.test(v) ? 1.1 : 0.3}`;
    }
    return 'v=5 drop=2';
  }
  function railVolts(name, cfg) {
    const u = String(name).toUpperCase().replace(/\s/g, '');
    if (cfg.rails && cfg.rails[u] != null) return cfg.rails[u];
    const m = u.match(/^([+-])?(\d+(?:[.V]\d+)?)V?$/) || u.match(/^([+-])(\d+(?:\.\d+)?)/) || u.match(/^V?([+-])?(\d+(?:\.\d+)?)V$/);
    if (m) { const v = parseFloat(m[2].replace('V', '.')); return m[1] === '-' ? -v : v; }
    if (/^(VCC|VDD|V\+|VPP|VBAT|VIN|VS)$/.test(u)) return cfg.vcc;
    if (/^(VEE|V-|VSS-|-VCC|VNEG)$/.test(u)) return cfg.vee;
    return null;
  }

  /* ---------------- 回路図 → ネットリスト ---------------- */
  function schematicToNetlist(doc, opts) {
    opts = Object.assign({ vcc: 5, vee: -5, rails: {}, autoRails: true, tol: 0 }, opts || {});
    const nets = C1.extractNets(doc);
    const warnings = [], lines = [], models = new Set(), map = {}, nodeOf = new Map(), elemOf = {}, info = {};
    const sanitize = s => String(s).replace(/[^A-Za-z0-9_]/g, c => c === '+' ? 'p' : c === '-' ? 'm' : c === '.' ? 'd' : c === '$' ? '' : '_').toLowerCase() || 'n';
    const used = new Set(['0']);
    const gndRe = /^(GND|AGND|DGND|SGND|PGND|0V|0|VSS|COM|GROUND)$/i;
    let hasGnd = false;
    nets.forEach((n, i) => {
      let nm;
      if (gndRe.test(String(n.name).replace(/\s/g, ''))) { nm = '0'; hasGnd = true; }
      else {
        nm = n.name.startsWith('N$') ? 'n' + n.name.slice(2) : sanitize(n.name);
        let k = nm, j = 2; while (used.has(k)) k = nm + '_' + j++; nm = k; used.add(nm);
      }
      map[nm] = n.name; n.spice = nm;
      n.pins.forEach(p => nodeOf.set(p.comp.id + ':' + p.pin.n, nm));
    });
    if (!hasGnd) warnings.push({ lv: 'err', t: 'GND 記号がありません。基準電位 (0V) になる所に GND を置いてください。' });
    let ncN = 0;
    const node = (c, pinNo) => {
      const k = nodeOf.get(c.id + ':' + pinNo);
      if (k) return k;
      const nm = 'nc' + (++ncN) + '_' + sanitize(c.ref) + '_' + pinNo; map[nm] = '(未接続 ' + c.ref + '.' + pinNo + ')';
      return nm;
    };
    const isConnected = (c, pinNo) => nodeOf.has(c.id + ':' + pinNo);
    const sourcesOnNet = new Set();
    const R = s => sanitize(s);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 - 0.5; };
    const tolv = v => opts.tol ? v * (1 + 2 * opts.tol * rnd()) : v;

    for (const c of doc.components) {
      const s = C1.symOf(c); if (!s || s.virtual) continue;
      const ref = R(c.ref || c.id), val = c.val || '', pr = c.props || {};
      const pn = n => node(c, n), out = [], add = l => out.push(l);
      const T = c.type;
      try {
        switch (T) {
          case 'R': { const v = num(val); if (!isFinite(v) || v <= 0) throw new Error('抵抗値 "' + val + '" を読めません'); add(`R${ref} ${pn(1)} ${pn(2)} ${sn(tolv(v))}`); break; }
          case 'RNET': { const v = num(val) || 10e3; for (let i = 2; i <= 9; i++) add(`R${ref}_${i} ${pn(1)} ${pn(i)} ${v}`); break; }
          case 'POT': {
            const v = num(val); if (!isFinite(v)) throw new Error('抵抗値 "' + val + '" を読めません');
            const w = Math.min(0.999, Math.max(0.001, pr.wiper == null ? 0.5 : +pr.wiper));
            add(`R${ref}a ${pn(1)} ${pn(2)} ${v * w}`); add(`R${ref}b ${pn(2)} ${pn(3)} ${v * (1 - w)}`); break;
          }
          case 'NTC': {
            const r25 = num(val) || 10e3, B = +pr.beta || 3435, t = pr.temp == null ? 25 : +pr.temp;
            add(`R${ref} ${pn(1)} ${pn(2)} ${r25 * Math.exp(B * (1 / (t + 273.15) - 1 / 298.15))}`); break;
          }
          case 'LDR': {
            const r10 = num(val) || 10e3, lx = Math.max(0.01, pr.light == null ? 100 : +pr.light);
            add(`R${ref} ${pn(1)} ${pn(2)} ${Math.min(10e6, r10 * Math.pow(lx / 10, -0.75))}`); break;
          }
          case 'VARISTOR': { const bv = volts(val, 470); add(`D${ref}a ${pn(1)} ${ref}_m znr${ref}`); add(`D${ref}b ${pn(2)} ${ref}_m znr${ref}`); models.add(`.model znr${ref} D(IS=1e-12 N=1 BV=${bv} IBV=1m)`); break; }
          case 'C': case 'CP': case 'CNP': {
            let v = num(val); if (T === 'CP' && /F$/.test(val) && !/[pnuµm]F$/i.test(val)) v = parseFloat(val);
            if (!isFinite(v) || v <= 0) throw new Error('容量 "' + val + '" を読めません');
            add(`C${ref} ${pn(1)} ${pn(2)} ${sn(tolv(v))}`); break;
          }
          case 'L': { const v = num(val); if (!isFinite(v) || v <= 0) throw new Error('インダクタンス "' + val + '" を読めません'); add(`L${ref} ${pn(1)} ${pn(2)} ${sn(v)}`); break; }
          case 'X': {
            const f = num(String(val).replace(/hz/i, '')) || 16e6;
            const Cm = 15e-15, Lm = 1 / (Math.pow(2 * Math.PI * f, 2) * Cm);
            add(`C${ref}_0 ${pn(1)} ${pn(2)} 4p`); add(`R${ref}_m ${pn(1)} ${ref}_x1 30`); add(`L${ref}_m ${ref}_x1 ${ref}_x2 ${Lm}`); add(`C${ref}_m ${ref}_x2 ${pn(2)} ${Cm}`); break;
          }
          case 'F': add(`R${ref} ${pn(1)} ${pn(2)} 0.05`); break;
          case 'TRAFO': {
            const m = String(val).match(/([\d.]+)\s*[kK]?\s*[VΩ]?\s*:\s*([\d.]+)\s*([kK]?)/);
            let ratio = 100 / 12;
            if (m) { const a = parseFloat(m[1]) * (/k/i.test(String(val).split(':')[0]) ? 1e3 : 1), b = parseFloat(m[2]) * (m[3] ? 1e3 : 1); ratio = /Ω|[0-9]:[0-9]/.test(val) && /Ω|k:|600/.test(val) ? Math.sqrt(a / b) : a / b; }
            const Lp = 1, Ls = Lp / (ratio * ratio);
            add(`L${ref}p ${pn(1)} ${pn(2)} ${Lp}`); add(`L${ref}s ${pn(3)} ${pn(4)} ${Ls}`); add(`K${ref} L${ref}p L${ref}s 0.999`);
            add(`R${ref}iso ${pn(2)} ${pn(4)} 1e9`); break;
          }
          case 'D': case 'SBD': case 'TVS': case 'PHOTOD': {
            const mn = modelName(val);
            let m = SP.MODEL_LIB[mn] ? mn : null;
            if (!m) { m = T === 'SBD' ? '1n5819' : T === 'TVS' ? 'p6ke18a' : '1n4148'; if (val && T !== 'PHOTOD') warnings.push({ lv: 'warn', t: `${c.ref}: ${val} のモデルが無いため ${m.toUpperCase()} で代用` }); }
            if (!SP.MODEL_LIB[m]) models.add(`.model ${m} D(IS=2.52n N=1.75 RS=0.5)`);
            add(`D${ref} ${pn(1)} ${pn(2)} ${m}`);
            if (T === 'PHOTOD') { const lx = pr.light == null ? 100 : +pr.light; add(`I${ref}ph ${pn(2)} ${pn(1)} ${lx * 5e-9}`); }
            break;
          }
          case 'ZD': {
            const bv = volts(val, 5.1), mn = 'dz' + String(bv).replace('.', 'v');
            models.add(`.model ${mn} D(IS=1e-14 N=1 RS=2 BV=${bv} IBV=5m NBV=1.2)`);
            add(`D${ref} ${pn(1)} ${pn(2)} ${mn}`); break;
          }
          case 'LED': add(`D${ref} ${pn(1)} ${pn(2)} led_${ledKey(val)}`); info[c.id] = { led: ledKey(val) }; break;
          case 'LED7': {
            const ca = /アノード|anode|CA/i.test(val), key = ledKey(val), com = isConnected(c, 3) ? pn(3) : pn(8);
            const segs = s.pins.filter(p => p.name !== 'COM');
            segs.forEach(p => add(ca ? `D${ref}_${p.name} ${com} ${pn(p.n)} led_${key}` : `D${ref}_${p.name} ${pn(p.n)} ${com} led_${key}`));
            if (isConnected(c, 3) && isConnected(c, 8)) add(`R${ref}_com ${pn(3)} ${pn(8)} 0.01`);
            info[c.id] = { led: key, seg7: segs.map(p => ({ name: p.name, el: 'd' + ref + '_' + p.name })) };
            break;
          }
          case 'BR': {
            const m = 'd1n4007';
            models.add(`.model ${m} D(IS=14.1n N=1.984 RS=33.9m BV=1000 IBV=10u)`);
            add(`D${ref}a ${pn(1)} ${pn(2)} ${m}`); add(`D${ref}b ${pn(3)} ${pn(2)} ${m}`); add(`D${ref}c ${pn(4)} ${pn(1)} ${m}`); add(`D${ref}d ${pn(4)} ${pn(3)} ${m}`); break;
          }
          case 'NPN': case 'PNP': {
            const mn = modelName(val);
            let m = SP.MODEL_LIB[mn] && SP.MODEL_LIB[mn].type === T ? mn : null;
            if (!m) { m = T === 'NPN' ? '2sc1815' : '2sa1015'; if (val) warnings.push({ lv: 'warn', t: `${c.ref}: ${val} のモデルが無いため ${m.toUpperCase()} で代用` }); }
            add(`Q${ref} ${pn(2)} ${pn(1)} ${pn(3)} ${m}`); break;
          }
          case 'PHOTOTR': {
            const lx = pr.light == null ? 100 : +pr.light;
            add(`Q${ref} ${pn(1)} ${ref}_b ${pn(2)} 2sc1815`); add(`I${ref}ph ${pn(1)} ${ref}_b ${lx * 2e-8}`); add(`R${ref}_b ${ref}_b ${pn(2)} 1e9`); break;
          }
          case 'NMOS': case 'PMOS': {
            const mn = modelName(val);
            let m = SP.MODEL_LIB[mn] && SP.MODEL_LIB[mn].type === T ? mn : null;
            if (!m) { m = T === 'NMOS' ? '2sk2232' : '2sj334'; if (val && !/^2SJ$/i.test(val)) warnings.push({ lv: 'warn', t: `${c.ref}: ${val} のモデルが無いため ${m.toUpperCase()} で代用` }); }
            add(`M${ref} ${pn(2)} ${pn(1)} ${pn(3)} ${pn(3)} ${m}`); break;
          }
          case 'NJFET': case 'PJFET': {
            const mn = modelName(val);
            let m = SP.MODEL_LIB[mn] ? mn : null;
            if (!m) { m = T === 'NJFET' ? '2sk30a-gr' : '2sj103-gr'; if (val) warnings.push({ lv: 'warn', t: `${c.ref}: ${val} のモデルが無いため ${m.toUpperCase()} で代用` }); }
            add(`J${ref} ${pn(2)} ${pn(1)} ${pn(3)} ${m}`); break;
          }
          case 'SCR': {
            add(`Q${ref}p ${pn(3)} ${ref}_n1 ${pn(2)} scr_p`);
            add(`Q${ref}n ${ref}_n1 ${pn(3)} ${pn(1)} scr_n`); add(`R${ref}gk ${pn(3)} ${pn(1)} 1k`);
            models.add('.model scr_p PNP(IS=1e-14 BF=5)'); models.add('.model scr_n NPN(IS=1e-14 BF=50)'); break;
          }
          case 'TRIAC': {
            add(`S${ref}a ${pn(1)} ${pn(2)} ${pn(3)} ${pn(1)} swtriac`); add(`S${ref}b ${pn(1)} ${pn(2)} ${pn(1)} ${pn(3)} swtriac`);
            add(`D${ref}g1 ${pn(3)} ${pn(1)} dgate`); add(`D${ref}g2 ${pn(1)} ${pn(3)} dgate`);
            models.add('.model swtriac SW(RON=0.05 ROFF=1e9 VT=0.5 VH=0.05)'); models.add('.model dgate D(IS=1e-14 N=1.5)');
            warnings.push({ lv: 'warn', t: `${c.ref}: トライアックは簡易モデル (ゲート電流がある間だけ導通) です` });
            break;
          }
          case 'TL431': add(`X${ref} ${pn(1)} ${pn(2)} ${pn(3)} tl431`); break;
          case 'REG': add(`X${ref} ${pn(1)} ${pn(2)} ${pn(3)} regulator ${regParams(val)}`); break;
          case 'PC': {
            add(`D${ref} ${pn(1)} ${ref}_k led_ir`); add(`V${ref}s ${ref}_k ${pn(2)} 0`);
            add(`F${ref} 0 ${ref}_b V${ref}s 0.005`); add(`Q${ref} ${pn(4)} ${ref}_b ${pn(3)} opto_npn`); add(`R${ref}_be ${ref}_b ${pn(3)} 1meg`);
            models.add('.model opto_npn NPN(IS=1e-14 BF=200 VAF=100 CJC=10p CJE=10p)'); break;
          }
          case 'OPAMP': case 'OPAMP2': case 'OPAMP4': case 'DIP8': case 'DIP14': case 'DIP16': case 'IC555': case 'CMP2': {
            const ic = T === 'OPAMP' || T === 'OPAMP2' || T === 'OPAMP4' ? { kind: 'opamp', d: (icModel(val) || {}).d } : icModel(val);
            if (!ic) { warnings.push({ lv: 'info', t: `${c.ref} (${val || s.name}) は動作モデルが無いのでシミュレーションでは無視します` }); break; }
            const sup = (p, fb) => isConnected(c, p) ? pn(p) : fb;
            const rails = (vp, vn) => {
              const a = isConnected(c, vp), b = isConnected(c, vn);
              if (!a || !b) { warnings.push({ lv: 'warn', t: `${c.ref}: 電源ピンが未接続なので ±15V を仮定しました` }); return 'vpos=15 vneg=-15'; }
              return '';
            };
            if (ic.kind === '555') { const ps = [1, 2, 3, 4, 5, 6, 7, 8].map(pn); add(`X${ref} ${ps.join(' ')} ne555`); break; }
            if (ic.kind === 'opamp') {
              const p = opParams(ic);
              if (T === 'OPAMP') { const r = rails(8, 4); add(`X${ref} ${pn(3)} ${pn(2)} ${pn(1)} ${sup(8, '0')} ${sup(4, '0')} opamp ${p} ${r}`); }
              else if (T === 'OPAMP4' || T === 'DIP14') {
                const r = rails(4, 11);
                [[3, 2, 1], [5, 6, 7], [10, 9, 8], [12, 13, 14]].forEach((g, i) => add(`X${ref}${'abcd'[i]} ${pn(g[0])} ${pn(g[1])} ${pn(g[2])} ${sup(4, '0')} ${sup(11, '0')} opamp ${p} ${r}`));
              } else if (ic.d && ic.d.ch === 1 && (T === 'DIP8')) {
                const r = rails(7, 4); add(`X${ref} ${pn(3)} ${pn(2)} ${pn(6)} ${sup(7, '0')} ${sup(4, '0')} opamp ${p} ${r}`);
              } else {
                const r = rails(8, 4);
                add(`X${ref}a ${pn(3)} ${pn(2)} ${pn(1)} ${sup(8, '0')} ${sup(4, '0')} opamp ${p} ${r}`);
                add(`X${ref}b ${pn(5)} ${pn(6)} ${pn(7)} ${sup(8, '0')} ${sup(4, '0')} opamp ${p} ${r}`);
              }
              break;
            }
            if (ic.kind === 'cmp2') { [[3, 2, 1], [5, 6, 7]].forEach((g, i) => add(`X${ref}${'ab'[i]} ${pn(g[0])} ${pn(g[1])} ${pn(g[2])} ${pn(8)} ${pn(4)} comparator`)); break; }
            if (ic.kind === 'cmp4') { [[5, 4, 2], [7, 6, 1], [9, 8, 14], [11, 10, 13]].forEach((g, i) => add(`X${ref}${'abcd'[i]} ${pn(g[0])} ${pn(g[1])} ${pn(g[2])} ${pn(3)} ${pn(12)} comparator`)); break; }
            if (ic.kind === 'cmp1') { add(`X${ref} ${pn(2)} ${pn(3)} ${pn(7)} ${pn(8)} ${pn(1)} comparator`); break; }
            if (ic.kind === 'logic') {
              const b = SP.BUILTINS['logic_' + ic.key];
              if (b.pins !== s.pins.length) { warnings.push({ lv: 'warn', t: `${c.ref}: ${val} のピン数が記号と合いません` }); break; }
              const ps = []; for (let i = 1; i <= b.pins; i++) ps.push(pn(i));
              add(`X${ref} ${ps.join(' ')} logic_${ic.key}`); break;
            }
            break;
          }
          case 'LM386': {
            add(`X${ref} ${pn(3)} ${pn(2)} ${ref}_o ${pn(6)} ${pn(4)} opamp gbw=10meg hrp=1 hrn=0.5`);
            add(`R${ref}f ${ref}_o ${pn(2)} ${isConnected(c, 1) && isConnected(c, 8) ? 190e3 : 19e3}`); add(`R${ref}g ${pn(2)} ${ref}_ref 1k`);
            add(`R${ref}r1 ${pn(6)} ${ref}_ref 50k`); add(`R${ref}r2 ${ref}_ref ${pn(4)} 50k`); add(`C${ref}r ${ref}_ref ${pn(4)} 10u`);
            add(`R${ref}o ${ref}_o ${pn(5)} 0.5`); break;
          }
          case 'ULN2003': {
            for (let i = 0; i < 7; i++) { add(`Q${ref}_${i} ${pn(16 - i)} ${ref}_b${i} ${pn(8)} tip120`); add(`R${ref}_${i} ${pn(1 + i)} ${ref}_b${i} 2.7k`); add(`D${ref}_${i} ${pn(16 - i)} ${pn(9)} 1n4148`); }
            break;
          }
          case 'SENS3': {
            if (/LM35|LM61|LM60|MCP9700|LM335/i.test(val)) {
              const t = pr.temp == null ? 25 : +pr.temp, v = /LM61/i.test(val) ? 0.6 + t * 0.01 : /LM60/i.test(val) ? 0.424 + t * 0.00625 : /MCP9700/i.test(val) ? 0.5 + t * 0.01 : t * 0.01;
              add(`V${ref} ${ref}_i ${pn(3)} ${v}`); add(`R${ref}q ${pn(1)} ${pn(3)} 100k`); add(`R${ref} ${ref}_i ${pn(2)} 100`);
              info[c.id] = { temp: t };
            } else warnings.push({ lv: 'info', t: `${c.ref} (${val}) は動作モデルが無いので無視します` });
            break;
          }
          case 'SW': { const on = pr.state ? pr.state === 'on' : true; add(`R${ref} ${pn(1)} ${pn(2)} ${on ? 0.01 : 1e9}`); break; }
          case 'SWP': { const on = pr.state === 'on'; add(`R${ref} ${pn(1)} ${pn(2)} ${on ? 0.01 : 1e9}`); break; }
          case 'SW3': { const b = pr.state === 'b'; add(`R${ref}a ${pn(1)} ${pn(2)} ${b ? 1e9 : 0.01}`); add(`R${ref}b ${pn(1)} ${pn(3)} ${b ? 0.01 : 1e9}`); break; }
          case 'SW_DPDT': { const b = pr.state === 'b'; add(`R${ref}a1 ${pn(2)} ${pn(1)} ${b ? 1e9 : 0.01}`); add(`R${ref}b1 ${pn(2)} ${pn(3)} ${b ? 0.01 : 1e9}`); add(`R${ref}a2 ${pn(5)} ${pn(4)} ${b ? 1e9 : 0.01}`); add(`R${ref}b2 ${pn(5)} ${pn(6)} ${b ? 0.01 : 1e9}`); break; }
          case 'RLY': case 'RLY2': {
            const vn = volts(val, 5), rc = vn * vn / 0.36;
            const c1 = T === 'RLY' ? pn(1) : pn(1), c2 = T === 'RLY' ? pn(2) : pn(8);
            add(`R${ref}c ${c1} ${ref}_l ${rc}`); add(`L${ref}c ${ref}_l ${c2} 20m`);
            const mo = 'swrly_' + ref; models.add(`.model ${mo} SW(RON=0.05 ROFF=1e9 VT=${(0.6 * vn).toFixed(2)} VH=${(0.05 * vn).toFixed(2)})`);
            const mc = 'swrlyc_' + ref; models.add(`.model ${mc} SW(RON=0.05 ROFF=1e9 VT=${(-0.6 * vn).toFixed(2)} VH=${(0.05 * vn).toFixed(2)})`);
            const sets = T === 'RLY' ? [[3, 4, 5]] : [[4, 3, 2], [5, 6, 7]];
            sets.forEach(([com, no, nc], i) => { add(`S${ref}no${i} ${pn(com)} ${pn(no)} ${c1} ${c2} ${mo}`); add(`S${ref}nc${i} ${pn(com)} ${pn(nc)} ${c2} ${c1} ${mc}`); });
            break;
          }
          case 'BUZ': add(`R${ref} ${pn(1)} ${pn(2)} ${Math.max(50, volts(val, 5) * 40)}`); break;
          case 'SPK': add(`R${ref} ${pn(1)} ${pn(2)} ${num(String(val).replace(/Ω|ohm/i, '')) || 8}`); break;
          case 'M': { add(`R${ref} ${pn(1)} ${ref}_x ${Math.max(2, volts(val, 3) * 3)}`); add(`L${ref} ${ref}_x ${pn(2)} 1m`); break; }
          case 'LAMP': { const v = volts(val, 6); add(`R${ref} ${pn(1)} ${pn(2)} ${v * v / 0.3}`); info[c.id] = { lamp: v }; break; }
          case 'BAT': { const v = volts(val, 9); add(`V${ref} ${ref}_p ${pn(2)} ${v}`); add(`R${ref}i ${ref}_p ${pn(1)} ${v > 5 ? 1 : 0.2}`); sourcesOnNet.add(nodeOf.get(c.id + ':1')); break; }
          case 'DCJ': { const v = volts(String(val).replace(/^DC/i, ''), 12); add(`V${ref} ${pn(1)} ${pn(2)} ${v}`); sourcesOnNet.add(nodeOf.get(c.id + ':1')); break; }
          case 'VDC': { const v = num(String(val).replace(/V$/i, '')); add(`V${ref} ${pn(1)} ${pn(2)} ${isFinite(v) ? v : 5}`); sourcesOnNet.add(nodeOf.get(c.id + ':1')); sourcesOnNet.add(nodeOf.get(c.id + ':2')); break; }
          case 'VSIN': case 'VAC': case 'VPULSE': {
            let v = String(val || '').trim();
            if (!/^(sin|pulse|pwl|exp|dc|ac|[\d.+-])/i.test(v)) v = T === 'VPULSE' ? 'PULSE(0 5 0 1u 1u 0.5m 1m)' : 'SIN(0 1 1k)';
            if (!/\bac\b/i.test(v) && T !== 'VPULSE') v += ' AC 1';
            add(`V${ref} ${pn(1)} ${pn(2)} ${v}`); sourcesOnNet.add(nodeOf.get(c.id + ':1')); sourcesOnNet.add(nodeOf.get(c.id + ':2')); break;
          }
          case 'IDC': { const v = num(String(val).replace(/A$/i, '')); add(`I${ref} ${pn(2)} ${pn(1)} ${isFinite(v) ? v : 1e-3}`); break; }
          default:
            if (/^G_/.test(T)) { const f = T.slice(2).toLowerCase(); add(`X${ref} ${s.pins.map(p => pn(p.n)).join(' ')} gate_${f}`); break; }
            if (T === 'DFF') { add(`X${ref} ${pn(1)} ${pn(2)} ${pn(3)} ${pn(4)} gate_dff`); break; }
            // コネクタ類・モジュール: シミュレーションでは端子のみ
            break;
        }
      } catch (e) { warnings.push({ lv: 'err', t: `${c.ref}: ${e.message}` }); }
      if (out.length) { elemOf[c.id] = out.map(l => l.split(/\s+/)[0].toLowerCase()); lines.push(...out); }
    }
    // 電源記号に電圧源を自動で付ける
    const autoSrc = [];
    if (opts.autoRails) {
      nets.forEach(n => {
        if (!n.rail || n.spice === '0' || sourcesOnNet.has(n.spice)) return;
        const v = railVolts(n.name, opts);
        if (v == null) { if (n.pins.length) warnings.push({ lv: 'warn', t: `電源ネット ${n.name} の電圧が分かりません。シミュレーション設定で電圧を指定してください` }); return; }
        const nm = 'V_' + n.spice;
        autoSrc.push({ name: n.name, v, el: nm.toLowerCase() });
        lines.push(`${nm} ${n.spice} 0 ${v}`);
      });
    }
    const text = ['* ' + (opts.title || 'UniBoard SPICE 回路図'), ...lines, ...models].join('\n');
    return { text, map, nets, warnings, elemOf, info, autoSrc };
  }

  global.SimNet = { sn, schematicToNetlist, icModel, ledKey, LEDCOLOR, railVolts, volts };
})(typeof window !== 'undefined' ? window : globalThis);
