// plateMct.js - 3D Plate 해석: MIDAS Civil 입력(.mct) 생성 / 출력(.anl) 읽기 (매뉴얼 4.7)
//
// plateModel(p, c, bi, { mesh }) → { mesh, cases, combos, sg (지반반력계수), cond, checkIndex, E, d }
// mctText(p, c, bi, { mesh }) → string        MIDAS Civil MCT (KN, M)
// parseAnl(text) → { loads:[name], elems: Map<elem, {[load]: {cent:{Fxx..}, nodes:{key:{...}}}}>, mode, count, comps }
// plateValue(res, elem, load, comp, mode, plateNodes) → number | null
//
// 판 결과 성분: Fxx Fyy Fxy (kN/m), Mxx Myy Mxy (kN·m/m), Vxx Vyy (kN/m) + 주값 FMax FMin MMax MMin.

import { buildPlateMesh, plateLoads } from './plateMesh.js';
import { loadCases } from './loads.js';
import { combos as comboList, COMBO_KINDS } from './combos.js';
import { getDesign } from './design.js';
import { getChecks, checkCondition } from './loadHelpers.js';
import { subgrade } from './frame2d.js';

export const PLATE_COMPS = ['Fxx', 'Fyy', 'Fxy', 'FMax', 'FMin', 'Vxx', 'Mxx', 'Myy', 'Mxy', 'MMax', 'MMin', 'Vyy'];
const BASE_COMPS = ['Fxx', 'Fyy', 'Fxy', 'Mxx', 'Myy', 'Mxy', 'Vxx', 'Vyy'];

/** 포락 조합 이름 (매뉴얼: ENVUSE, ENVULT, ENVECC 는 ANL 출력시 반드시 선택) */
export const ENVELOPES = [
    { name: 'ENVULT', kinds: ['factored'], desc: '계수하중 포락' },
    { name: 'ENVECC', kinds: ['factoredEcc'], desc: '계수하중(최대편심) 포락' },
    { name: 'ENVUSE', kinds: ['service'], desc: '사용하중 포락' },
    { name: 'ENVEQC', kinds: ['eqCollapse'], desc: '지진하중(붕괴방지) 포락' },
    { name: 'ENVEQF', kinds: ['eqFunction'], desc: '지진하중(기능수행) 포락' },
];

const LCTYPE = { 고정하중: 'D', 토압: 'EP', 수압: 'WP', 활하중: 'L', 온도하중: 'T', 지진하중: 'E', 사용자하중: 'USER' };

/** 블록 bi 의 대표 검토단면 index */
export function blockCheckIndex(p, c, bi) {
    const ch = getChecks(p, c);
    const k = ch.rows.findIndex(r => (r.block | 0) === bi);
    return k >= 0 ? k : 0;
}

const modelCache = new Map();

export function plateModel(p, c, bi = 0, opts = {}) {
    const mesh = +opts.mesh || 500;
    const key = JSON.stringify([p.design, p.alignment && p.alignment.vip, c, bi, mesh]);
    if (modelCache.has(key)) return modelCache.get(key);
    if (modelCache.size > 10) modelCache.clear();
    const k = blockCheckIndex(p, c, bi);
    const cond = checkCondition(p, c, k, 'calc');
    const d = getDesign(p);
    const m = buildPlateMesh(c, bi, { mesh });
    const cases = loadCases(p, c, k).map(lc => ({ ...lc, plate: plateLoads(m, lc) }));
    const cbs = comboList(p, c, k);
    let sg;
    try { sg = subgrade(p, c, cond); } catch { sg = { mode: 'calc', kv: 50000, kvEq: 100000, lines: [] }; }
    const out = { mesh: m, cases, combos: cbs, sg, cond, checkIndex: k, E: (+d.env.Ec || 26986) * 1000, d };
    modelCache.set(key, out);
    return out;
}

const f = (v, n = 4) => {
    const s = (+v).toFixed(n);
    return s === '-0.0000' || /^-0\.0+$/.test(s) ? (0).toFixed(n) : s;
};
const e4 = (v) => (+v).toExponential(4);

/** MIDAS 이름 (공백/쉼표 제거, 최대 20자) */
const nm = (s) => String(s).replace(/[\s,;]+/g, '_').slice(0, 20);

/** 노드 목록 압축 ("1to20" 형식) */
function compactList(ids) {
    const s = [...ids].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        out.push(j > i ? `${s[i]}to${s[j]}` : `${s[i]}`);
        i = j + 1;
    }
    return out.join(' ');
}

export function mctText(p, c, bi = 0, opts = {}) {
    const M = plateModel(p, c, bi, opts);
    const { mesh, cases, combos, sg, d } = M;
    const L = [];
    const fck = +d.env.fck || 24;
    L.push(`; ESC Culvert - 3D Plate 해석 입력 (MIDAS Civil MCT)`);
    L.push(`; 암거: ${c.name}  BLOCK ${bi + 1}  블록길이 ${f(mesh.Lb, 3)} m  Mesh ${mesh.mesh} mm`);
    L.push(`; 검토단면: ${M.cond.name || ''}  절점 ${mesh.nodes.length}  요소 ${mesh.plates.length}`);
    L.push(`; 좌표: X 횡방향(좌측벽 중심=0), Y 종방향(블록 시점=0), Z 연직(하부슬래브 중심=0)`);
    L.push('');
    L.push('*VERSION', '   8.0.0', '');
    L.push('*UNIT    ; Unit System', '; FORCE, LENGTH, HEAT, TEMPER', '   KN   , M, KJ, C', '');
    L.push('*STRUCTYPE    ; Structure Type', '; iSTYP, iMASS, iSMAS, bMASSOFFSET, bSELFWEIGHT, GRAV, TEMP, bALIGNBEAM, bALIGNSLAB, bROTRIGID', '   0, 1, 1, NO, YES, 9.806, 0, NO, NO, NO', '');
    L.push('*NODE    ; Nodes', '; iNO, X, Y, Z');
    for (const n of mesh.nodes) L.push(`   ${n.id}, ${f(n.x)}, ${f(n.y)}, ${f(n.z)}`);
    L.push('');
    L.push('*ELEMENT    ; Elements', '; iEL, TYPE, iMAT, iPRO, iN1, iN2, iN3, iN4, iSUB, iWID    ; Planar');
    for (const pl of mesh.plates) L.push(`   ${pl.id}, PLATE, 1, ${pl.thk}, ${pl.n.join(', ')}, 1, 0`);
    L.push('');
    L.push('*MATERIAL    ; Material', '; iMAT, TYPE, MNAME, SPHEAT, HEATCO, PLAST, TUNIT, bMASS, DAMPRATIO, [DATA1]    ; STEEL, CONC, USER', '; [DATA1] : 2, ELAST, POISN, THERMAL, DEN, MASS');
    L.push(`   1, CONC , C${fck}, 0, 0, , C, NO, 0.05, 2, ${e4(M.E)}, ${+d.env.nuC || 0.17}, 1.0000e-005, ${+d.env.gRC || 24.5}, 0`);
    L.push('');
    L.push('*THICKNESS    ; Thickness', '; iTHK, TYPE, NAME, bSAME, THIK-IN, THIK-OUT, bOFFSET, OFFTYPE, VALUE    ; TYPE=VALUE');
    for (const t of mesh.thicknesses) L.push(`   ${t.id}, VALUE, T${Math.round(t.t * 1000)}, YES, ${f(t.t)}, 0, NO, 0, 0`);
    L.push('');
    L.push('*GROUP    ; Group', '; NAME, NODE_LIST, ELEM_LIST, PLANE_TYPE');
    for (const [gid, ids] of Object.entries(mesh.groups)) L.push(`   ${nm(gid.replace(':', '_'))}, , ${compactList(ids)}, 0`);
    L.push('');
    // 지반 스프링
    if (sg.mode === 'fixed') {
        L.push('*CONSTRAINT    ; Supports (지반반력계수 미사용: 하부 고정)', '; NODE_LIST, CONST(Dx,Dy,Dz,Rx,Ry,Rz), GROUP');
        L.push(`   ${compactList(mesh.bottomNodes.map(b => b.node))}, 111000, `);
    } else {
        const kv = sg.kv, kh = kv / 3;
        L.push(`*SPRING    ; Point Spring Supports (kv = ${f(kv, 0)} kN/m³, kh = kv/3, 지배면적 × k)`, '; NODE_LIST, Type, SDx, SDy, SDz, SRx, SRy, SRz, GROUP');
        for (const b of mesh.bottomNodes) L.push(`   ${b.node}, LINEAR, ${f(kh * b.trib, 3)}, ${f(kh * b.trib, 3)}, ${f(kv * b.trib, 3)}, 0, 0, 0, `);
    }
    L.push('');
    // 하중 케이스
    L.push('*STLDCASE    ; Static Load Cases', '; LCNAME, LCTYPE, DESC');
    for (const lc of cases) L.push(`   ${nm(lc.key)}, ${LCTYPE[lc.cat] || 'USER'}, ${String(lc.name || '').replace(/,/g, ' ')}`);
    L.push('');
    for (const lc of cases) {
        const pl = lc.plate;
        if (!pl.pres.length && !pl.conc.length && !pl.temp.length) continue;
        L.push(`*USE-STLD, ${nm(lc.key)}`, '');
        if (pl.pres.length) {
            L.push('*PRESSURE    ; Pressure Loads', '; ELEM_LIST, CMD, ETYP, LTYP, DIR, VX, VY, VZ, bPROJ, PU, P1, P2, P3, P4, GROUP');
            for (const q of pl.pres) L.push(`   ${q.elem}, PRES, PLATE, FACE, ${q.dir}, 0, 0, 0, NO, ${f(q.p)}, 0, 0, 0, 0, `);
            L.push('');
        }
        if (pl.conc.length) {
            L.push('*CONLOAD    ; Nodal Loads', '; NODE_LIST, FX, FY, FZ, MX, MY, MZ, GROUP');
            for (const q of pl.conc) L.push(`   ${q.node}, ${f(q.FX)}, 0, ${f(q.FZ)}, 0, 0, 0, `);
            L.push('');
        }
        if (pl.temp.length) {
            const byT = new Map();
            for (const t of pl.temp) { const k = f(t.dT, 3); (byT.get(k) || byT.set(k, []).get(k)).push(t.elem); }
            L.push('*ELTEMPER    ; Element Temperatures', '; ELEM_LIST, TEMPER, GROUP');
            for (const [t, ids] of byT) if (+t) L.push(`   ${compactList(ids)}, ${t}, `);
            L.push('');
            const grads = pl.temp.filter(t => Math.abs(t.grad) > 1e-9);
            if (grads.length) {
                L.push('*THERGRAD    ; Temperature Gradient', '; ELEM_LIST, TYPE, TZ, bUSEHZ, HZ, GROUP    ; TYPE=2 (Plate)');
                for (const t of grads) L.push(`   ${t.elem}, 2, ${f(t.grad, 3)}, NO, 0, `);
                L.push('');
            }
        }
    }
    // 하중 조합 + 포락
    L.push('*LOADCOMB    ; Combinations', '; NAME=NAME, KIND, ACTIVE, bES, iTYPE, DESC, iSERV-TYPE, nLCOMTYPE, nSEISTYPE   ; line 1', ';      ANAL1, LCNAME1, FACT1, ...                                               ; from line 2');
    const pushItems = (items) => {
        for (let i = 0; i < items.length; i += 4) L.push('        ' + items.slice(i, i + 4).join(', '));
    };
    for (const cb of combos) {
        const meta = COMBO_KINDS.find(x => x.id === cb.kind);
        L.push(`   NAME=${nm(cb.name)}, GEN, ACTIVE, 0, 0, ${meta ? meta.title : cb.kind} ${cb.lc || ''}, 0, 0, 0`);
        pushItems(Object.entries(cb.factors).filter(([, v]) => +v).map(([k, v]) => `ST, ${nm(k)}, ${+v}`));
    }
    for (const env of ENVELOPES) {
        const list = combos.filter(cb => env.kinds.includes(cb.kind));
        if (!list.length) continue;
        L.push(`   NAME=${env.name}, GEN, ACTIVE, 0, 1, ${env.desc}, 0, 0, 0`);
        pushItems(list.map(cb => `CB, ${nm(cb.name)}, 1`));
    }
    L.push('');
    L.push('*ENDDATA');
    return L.join('\r\n');
}

// ── ANL 읽기 ─────────────────────────────────────────────────────────

const VAL_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const PART_RE = /^(Cent\.?|Center|[IJKL]\[\d+\]|[IJKL]|N\d+)$/i;

/** 주값 */
function principal(xx, yy, xy) {
    const a = (xx + yy) / 2, r = Math.hypot((xx - yy) / 2, xy);
    return [a + r, a - r];
}

function withPrincipal(v) {
    const o = { ...v };
    if (o.Fxx != null && o.Fyy != null) [o.FMax, o.FMin] = principal(o.Fxx, o.Fyy, o.Fxy || 0);
    if (o.Mxx != null && o.Myy != null) [o.MMax, o.MMin] = principal(o.Mxx, o.Myy, o.Mxy || 0);
    return o;
}

/**
 * MIDAS Civil Text Output (.anl) 의 판 부재력 표를 읽는다.
 * "Force per unit length (L)" 표가 있으면 그것을, 없으면 처음 찾은 판 부재력 표를 쓴다.
 * 행 형식(관대하게 읽음): [Elem] [Load] Part v1 v2 ... (Part = Cent. | I[node] | node)
 */
export function parseAnl(text) {
    const tables = { L: new Map(), G: new Map(), X: new Map() };
    let mode = 'X', cols = BASE_COMPS, active = false, elem = null, load = null;
    const loads = { L: new Set(), G: new Set(), X: new Set() };
    let rows = 0;
    for (let raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/([IJKL])\s*\[\s*(\d+)\s*\]/g, '$1[$2]').trim();
        if (!line) continue;
        if (/force\s+per\s+unit\s+length|\(\s*L\s*\)/i.test(line)) { mode = 'L'; active = true; continue; }
        if (/default\s*\(\s*G\s*\)|\(\s*G\s*\)/i.test(line)) { mode = 'G'; active = true; continue; }
        if (/plate/i.test(line) && /force/i.test(line)) { active = true; continue; }
        if (/\b(beam|truss|solid|displacement|reaction)\b/i.test(line) && !/plate/i.test(line)) { active = false; continue; }
        const toks = line.split(/\s+/);
        if (toks.some(t => /^Fxx$/i.test(t)) || toks.some(t => /^Mxx$/i.test(t))) {
            const c = toks.filter(t => /^(F|M|V)(xx|yy|xy|zz|xz|yz|max|min)$/i.test(t)).map(t => {
                const k = t[0].toUpperCase() + t.slice(1).toLowerCase();
                return k.replace(/^Fmax$/, 'FMax').replace(/^Fmin$/, 'FMin').replace(/^Mmax$/, 'MMax').replace(/^Mmin$/, 'MMin');
            });
            if (c.length) cols = c;
            active = true;
            continue;
        }
        if (!active) continue;
        // 뒤쪽 숫자열
        let k = toks.length;
        while (k > 0 && VAL_RE.test(toks[k - 1].replace(/,/g, ''))) k--;
        const nums = toks.slice(k).map(t => +t.replace(/,/g, ''));
        if (nums.length < cols.length) continue;
        const valStart = nums.length - cols.length;
        // 앞쪽 식별자: 숫자열 앞부분이 넘치면 (elem/node 가 숫자) 앞쪽으로 돌린다
        const pre = [...toks.slice(0, k), ...toks.slice(k, k + valStart)];
        const vals = nums.slice(valStart);
        let part = null;
        if (pre.length >= 3) { elem = +pre[0]; load = pre[1]; part = pre[pre.length - 1]; }
        else if (pre.length === 2) {
            if (PART_RE.test(pre[1]) || /^\d+$/.test(pre[1])) {
                if (/^\d+$/.test(pre[0])) { elem = +pre[0]; } else load = pre[0];
                part = pre[1];
            } else { elem = +pre[0]; load = pre[1]; part = 'Cent.'; }
        } else if (pre.length === 1) part = pre[0];
        else continue;
        if (!(elem > 0) || !load) continue;
        if (!PART_RE.test(part) && !/^\d+$/.test(part)) continue;
        const v = {};
        cols.forEach((cname, i) => { v[cname] = vals[i]; });
        const tb = tables[mode];
        let er = tb.get(elem);
        if (!er) { er = {}; tb.set(elem, er); }
        let lr = er[load];
        if (!lr) { lr = { cent: null, nodes: {} }; er[load] = lr; }
        const pv = withPrincipal(v);
        if (/^cent/i.test(part)) lr.cent = pv;
        else {
            const m = /\[(\d+)\]/.exec(part);
            lr.nodes[m ? m[1] : part.replace(/^N/i, '')] = pv;
        }
        loads[mode].add(load);
        rows++;
    }
    const use = tables.L.size ? 'L' : tables.G.size ? 'G' : 'X';
    const elems = tables[use];
    // 중심값이 없으면 절점 평균
    for (const er of elems.values()) {
        for (const lr of Object.values(er)) {
            if (lr.cent) continue;
            const ns = Object.values(lr.nodes);
            if (!ns.length) continue;
            const avg = {};
            for (const kk of Object.keys(ns[0])) avg[kk] = ns.reduce((a, q) => a + (q[kk] || 0), 0) / ns.length;
            lr.cent = withPrincipal(avg);
        }
    }
    return { mode: use, loads: [...loads[use]], elems, rows, count: elems.size, cols };
}

/**
 * 요소 결과값. mode: 'center' | 'avg' (각 절점 평균값) | 'max' (절대 최대)
 * plate: buildPlateMesh 의 plate (절점 id 매칭용), nodeAvg: nodeAverages() 결과 (avg 모드)
 */
export function plateValue(res, elem, load, comp, mode = 'center', plate = null, nodeAvg = null) {
    const er = res && res.elems.get(elem);
    const lr = er && er[load];
    if (!lr) return null;
    if (mode === 'center' || !plate) return lr.cent ? lr.cent[comp] ?? null : null;
    const keys = plate.n.map(String);
    const letters = ['I', 'J', 'K', 'L'];
    const vals = keys.map((k, i) => (lr.nodes[k] || lr.nodes[letters[i]] || null)).filter(Boolean).map(q => q[comp]).filter(v => v != null);
    if (mode === 'avg' && nodeAvg) {
        const av = plate.n.map(n => nodeAvg.get(n)).filter(v => v != null);
        if (av.length) return av.reduce((a, b) => a + b, 0) / av.length;
    }
    if (!vals.length) return lr.cent ? lr.cent[comp] ?? null : null;
    if (mode === 'max') return vals.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), vals[0]);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** 절점 평균값 Map<node, value> (같은 부재군 요소끼리만 평균 — 모서리에서 다른 부재와 섞지 않음은 단순화 생략) */
export function nodeAverages(res, mesh, load, comp) {
    const sum = new Map(), cnt = new Map();
    const letters = ['I', 'J', 'K', 'L'];
    for (const pl of mesh.plates) {
        const lr = res.elems.get(pl.id) && res.elems.get(pl.id)[load];
        if (!lr) continue;
        pl.n.forEach((n, i) => {
            const q = lr.nodes[String(n)] || lr.nodes[letters[i]] || lr.cent;
            if (!q || q[comp] == null) return;
            sum.set(n, (sum.get(n) || 0) + q[comp]);
            cnt.set(n, (cnt.get(n) || 0) + 1);
        });
    }
    const out = new Map();
    for (const [n, s] of sum) out.set(n, s / cnt.get(n));
    return out;
}

/** 부재군별 요약 (최대/최소) — 계산 결과 보기 */
export function summarize(res, mesh, load, comps = ['Mxx', 'Myy', 'Fxx', 'Vxx', 'Vyy']) {
    const out = {};
    for (const [gid, ids] of Object.entries(mesh.groups)) {
        const row = {};
        for (const cp of comps) {
            let mx = -Infinity, mn = Infinity, emx = null, emn = null;
            for (const id of ids) {
                const v = plateValue(res, id, load, cp, 'center');
                if (v == null) continue;
                if (v > mx) { mx = v; emx = id; }
                if (v < mn) { mn = v; emn = id; }
            }
            row[cp] = { max: isFinite(mx) ? mx : null, min: isFinite(mn) ? mn : null, emx, emn };
        }
        out[gid] = row;
    }
    return out;
}
