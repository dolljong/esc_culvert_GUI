// wingRebar.js - 날개벽 배근 데이터 · 철근 · 간이 설계검토 (배근 입력 > 날개벽 배근, 매뉴얼 5.11)
//
// 데이터: culverts[i].rebar.wing = {
//   cover: { front, back, top, bottom, end, inner, railTop, railSide },     피복 (콘크리트 면 ~ 철근 중심)
//   marks: { main:'WR', shear:'WS', haunch:'WH', rail:'WN' },               철근기호
//   sameAll: true,                                                          모든 날개벽에 같은 피복/기호
//   items: { SL|SR|EL|ER: 일체식 | 옹벽식 } }
// 일체식: { std, front:{ V:[{n,s}], H:[{n,s}], dia:{ v, h1, h2, hu }, rail:{ H:[{n,s}], len, dia:{ v, h } } },
//          back:{ …같음, M }, shear:{ dia, nMain, type, segs:[{n,s}] } }
//   V = 근단(본체 접합부)부터 수직철근 위치, H = 하단부터 수평철근 위치 (구간 '개수@간격' 누적)
// 옹벽식: { std, view:{ foot, wall }, main:{ wall:{ place, front, back, dR }, foot:{ place, top, bottom, gap } },
//          horz:{ wall:{ front, back, ctc }, foot:{ front, back, ctc }, key:{ v, h, ctc } },
//          shear:{ wall:{ dia, type, n, ctc }, foot:{…}, key:{…} } }
// 형상 좌표: calc/wingGeom.js (일체식 전개 입면 integralElevation, 옹벽식 단면 wallSection).

import { installedWings, integralElevation, wallSection, defaultWallRow, wingPlan, WING_NAMES } from './wingGeom.js';
import { getDesign, KaRankine } from './design.js';
import { barArea, devLength, materials, barD } from './rebar.js';
import { flexure, shear as rcShear, crack } from './rcDesign.js';
import { shearDims } from './shearBars.js';

export const CTC_OPTS = [100, 125, 150, 200, 250, 300];
export const COVER_ROWS = [['front', '날개벽전면', 80], ['back', '날개벽배면', 80], ['top', '날개벽상면', 80], ['bottom', '날개벽하면', 80], ['end', '날개벽끝단', 80], ['inner', '벽체내측', 80], ['railTop', '난간벽상면', 50], ['railSide', '난간벽측면', 50]];
export const MARK_ROWS = [['main', '날개벽철근', 'WR'], ['shear', '전단철근', 'WS'], ['haunch', '헌치철근', 'WH'], ['rail', '난간벽철근', 'WN']];

const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

export function defaultWingCommon() {
    return {
        cover: Object.fromEntries(COVER_ROWS.map(([k, , v]) => [k, v])),
        marks: Object.fromEntries(MARK_ROWS.map(([k, , v]) => [k, v])),
        sameAll: true,
        items: {},
    };
}

export function getWingCommon(c) {
    const d = defaultWingCommon();
    const s = c && c.rebar && c.rebar.wing;
    if (!s) return d;
    return { cover: { ...d.cover, ...(s.cover || {}) }, marks: { ...d.marks, ...(s.marks || {}) }, sameAll: s.sameAll !== false, items: s.items || {}, own: s.own || {} };
}

/** 날개벽별 피복/기호 (sameAll 이 꺼져 있으면 own[key] 우선) */
export function wingCoverOf(c, key) {
    const w = getWingCommon(c);
    const o = !w.sameAll && w.own && w.own[key];
    return { cover: { ...w.cover, ...((o && o.cover) || {}) }, marks: { ...w.marks, ...((o && o.marks) || {}) } };
}

/**
 * 일체식 날개벽 배면 헌치철근 (평면 좌표, wingPlan 과 같은 좌표계).
 * 헌치면과 평행하게 피복(배면) 만큼 안쪽에 두고
 *   날개벽 쪽 → 날개벽 외측(전면) 수평철근 선까지, 본체 쪽 → 암거 벽체 내측 수평철근 선까지 연장한 뒤
 *   양 끝을 각 철근 방향으로 hook(100) 만큼 꺾는다.
 * 반환: { pts:[본체 꺾임끝, 본체, 날개벽, 날개벽 꺾임끝], wing, body, len } | null
 */
export function haunchBarLine(wp, cv, hook = 100) {
    if (!wp || !wp.haunch) return null;
    const [a, b] = wp.haunch;
    const t = [b[0] - a[0], b[1] - a[1]];
    const tl = Math.hypot(t[0], t[1]);
    if (tl < 1e-6) return null;
    let n = [-t[1] / tl, t[0] / tl];
    const c = wp.backRoot;
    if ((c[0] - a[0]) * n[0] + (c[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const cb = n0(cv.back) || 80, cf = n0(cv.front) || 80, ci = n0(cv.inner) || 80;
    const p0 = [a[0] + n[0] * cb, a[1] + n[1] * cb];
    const hit = (q, e) => {
        const den = t[0] * e[1] - t[1] * e[0];
        if (Math.abs(den) < 1e-9) return null;
        const k = ((q[0] - p0[0]) * e[1] - (q[1] - p0[1]) * e[0]) / den;
        return [p0[0] + t[0] * k, p0[1] + t[1] * k];
    };
    // 날개벽 외측(전면) 수평철근 선: 전면(root→tip) 에서 배면 쪽으로 피복
    const wing = hit([wp.root[0] + wp.back[0] * cf, wp.root[1] + wp.back[1] * cf], wp.dir);
    // 암거 벽체 내측 수평철근 선: 벽체 내면(v = vIn) 에서 외면 쪽으로 피복
    const sv = Math.sign(wp.vIn - wp.vOut) || 1;
    const body = hit([a[0], wp.vIn - sv * ci], [1, 0]);
    if (!wing || !body) return null;
    // 꺾임: 진행 방향 쪽으로 각 철근과 평행하게
    const go = [wing[0] - body[0], wing[1] - body[1]];
    const sw = go[0] * wp.dir[0] + go[1] * wp.dir[1] >= 0 ? 1 : -1;
    const wingHook = [wing[0] + wp.dir[0] * sw * hook, wing[1] + wp.dir[1] * sw * hook];
    const sb = -go[0] >= 0 ? 1 : -1;
    const bodyHook = [body[0] + sb * hook, body[1]];
    const len = Math.hypot(go[0], go[1]) + 2 * hook;
    return { pts: [bodyHook, body, wing, wingHook], wing, body, len };
}

/**
 * 일체식 날개벽 수평철근 (평면, face: 'front' | 'back').
 * 날개벽 끝(피복) 에서 근단 쪽으로 진행해 암거 벽체 내측 피복 위치까지 연장하고, 끝을 벽체 내측 철근 방향으로 hook 만큼 꺾는다.
 * 꺾는 방향은 진행 방향 쪽 (날개벽이 직각이면 90°, 사각이 있으면 90° 보다 큰 둔각).
 * 반환: { pts:[날개벽 끝, 벽체 내측, 꺾임 끝], extIn (근단선에서 벽체 내측까지 날개벽 방향 거리), bendDeg } | null
 */
export function horzBarPlan(wp, cv, face, hook = 100) {
    if (!wp) return null;
    const off = face === 'front' ? (n0(cv.front) || 80) : wp.thick - (n0(cv.back) || 80);
    const base = [wp.root[0] + wp.back[0] * off, wp.root[1] + wp.back[1] * off];
    const sv = Math.sign(wp.vIn - wp.vOut) || 1;
    const vT = wp.vIn - sv * (n0(cv.inner) || 80);
    if (Math.abs(wp.dir[1]) < 1e-9) return null;
    const sIn = (vT - base[1]) / wp.dir[1];                       // 근단선 기준 (음수 = 암거 쪽)
    const at = (t) => [base[0] + wp.dir[0] * t, base[1] + wp.dir[1] * t];
    const tip = at(wp.len - (n0(cv.end) || 80)), inner = at(sIn);
    const go = [inner[0] - tip[0], inner[1] - tip[1]];             // 진행 방향 (암거 쪽)
    const gl = Math.hypot(go[0], go[1]) || 1;
    const F = wp.frame || {};
    let su = Math.sign(go[0]);
    if (Math.abs(go[0]) < 1e-6 * gl) su = (F.end || 'S') === 'S' ? 1 : -1;
    const hookEnd = [inner[0] + su * hook, inner[1]];
    const bendDeg = 180 - Math.acos(Math.max(-1, Math.min(1, (go[0] * su) / gl))) * 180 / Math.PI;
    return { pts: [tip, inner, hookEnd], extIn: Math.max(0, -sIn), bendDeg };
}

/**
 * 일체식 날개벽 평면(단면 B-B) 표시 좌표: 평면 배치(도면 좌표)를 회전만 해서 날개벽을 수평으로 놓는다 (뒤집지 않음).
 * 근단(root) 이 원점, 회전각은 작은 쪽을 고른다 → 날개벽이 +x 또는 −x 로 뻗는다.
 * 반환: { Q(planPt) → [x, y], sx (날개벽 진행 x 부호), sy (배면 쪽 y 부호), at(s, off) → 근단에서 s, 전면에서 배면 쪽 off 위치의 평면점 }
 */
export function wingPlanView(wp) {
    const G = (q) => wp.frame.toG(q[0], q[1]);
    const g0 = G(wp.root);
    const g1 = G([wp.root[0] + wp.dir[0], wp.root[1] + wp.dir[1]]);
    const a = Math.atan2(g1[1] - g0[1], g1[0] - g0[0]);
    const norm = (t) => Math.atan2(Math.sin(t), Math.cos(t));
    const t1 = norm(-a), t2 = norm(Math.PI - a);
    const th = Math.abs(t1) <= Math.abs(t2) ? t1 : t2;
    const c = Math.cos(th), s = Math.sin(th);
    const Q = (q) => { const g = G(q); const dx = g[0] - g0[0], dy = g[1] - g0[1]; return [dx * c - dy * s, dx * s + dy * c]; };
    const tip = Q([wp.root[0] + wp.dir[0] * 1000, wp.root[1] + wp.dir[1] * 1000]);
    const bk = Q([wp.root[0] + wp.back[0] * 1000, wp.root[1] + wp.back[1] * 1000]);
    const at = (sv, off) => [wp.root[0] + wp.dir[0] * sv + wp.back[0] * off, wp.root[1] + wp.dir[1] * sv + wp.back[1] * off];
    return { Q, sx: Math.sign(tip[0]) || 1, sy: Math.sign(bk[1]) || -1, at };
}

/**
 * 일체식 날개벽 평면에 붙는 암거 벽체 (본체 쪽 일부): { outer, inner, end, cut } 선분.
 * 길이는 벽 두께의 3배(최소 1500), 헌치철근(hb)이 있으면 그 끝 + 300 까지.
 */
export function bodyWallPlan(wp, hb = null) {
    const F = wp.frame;
    const sg = (F.end || 'S') === 'S' ? 1 : -1;
    let ext = Math.max(1500, 3 * Math.abs(wp.vIn - wp.vOut));
    if (hb) for (const q of hb.pts) ext = Math.max(ext, sg * (q[0] - F.endU(q[1])) + 300);
    const seg = (v) => [[F.endU(v), v], [F.endU(v) + sg * ext, v]];
    return { outer: seg(wp.vOut), inner: seg(wp.vIn), end: [[F.endU(wp.vOut), wp.vOut], [F.endU(wp.vIn), wp.vIn]], cut: [[F.endU(wp.vOut) + sg * ext, wp.vOut], [F.endU(wp.vIn) + sg * ext, wp.vIn]] };
}

/** 길이 L 을 '첫간격 + n@sp + 나머지' 구간으로 */
function zonesFor(L, sp, first) {
    first = Math.min(first, L);
    const n = Math.max(0, Math.floor((L - first) / sp + 1e-9));
    const r = Math.round(L - first - n * sp);
    const out = [{ n: 1, s: Math.round(first) }];
    if (n) out.push({ n, s: sp });
    if (r > 20) out.push({ n: 1, s: r });
    return out;
}

export function defaultIntegralRebar(c, key, std = 150) {
    const ev = integralElevation(c, key);
    const cv = wingCoverOf(c, key).cover;
    const sp = std * 2;
    const face = (back) => ({
        V: zonesFor(ev.L1 - cv.end, sp, cv.inner + 140),
        H: zonesFor(ev.hRoot - cv.top - cv.bottom, sp, cv.bottom + 160).map((z, i) => (i === 0 ? { n: 1, s: z.s } : z)),
        dia: { v: 'D19', h1: 'D16', h2: 'D19', hu: 'D19' },
        rail: { H: [{ n: 1, s: 150 }], len: 500, dia: { v: 'D10', h: 'D10' } },
        ...(back ? { M: 0 } : {}),
    });
    return {
        kind: '일체식', std,
        front: face(false), back: face(true),
        shear: { dia: 'D13', nMain: 4, type: '꺽인ㄷ형', segs: zonesFor(ev.L1 - cv.end, sp * 2, cv.inner + 300) },
    };
}

export function defaultWallRebar(c, key, std = 250) {
    void key;
    return {
        kind: '옹벽식', std, view: { foot: true, wall: false },
        main: { wall: { place: true, front: 'D16', back: 'D19', dR: 0 }, foot: { place: true, top: 'D19', bottom: 'D19', gap: false } },
        horz: { wall: { front: 'D13', back: 'D13', ctc: 300 }, foot: { front: 'D13', back: 'D13', ctc: 300 }, key: { v: 'D16', h: 'D13', ctc: 300 } },
        shear: { wall: { dia: 'D13', type: '캡형', n: 4, ctc: 500 }, foot: { dia: 'D13', type: '캡형', n: 4, ctc: 500 }, key: { dia: '', type: '꺽인ㄷ형', n: 4, ctc: 500 } },
    };
}

/** 저장값 또는 기본값 */
export function getWingRebar(c, key) {
    const w = installedWings(c).find(x => x.key === key);
    if (!w) return null;
    const s = c.rebar && c.rebar.wing && c.rebar.wing.items && c.rebar.wing.items[key];
    if (s && s.kind === w.type) return s;
    return w.type === '옹벽식' ? defaultWallRebar(c, key) : defaultIntegralRebar(c, key);
}

/** 구간 누적 위치 (base 부터, 각 구간 끝마다 철근) */
export function zonePositions(segs, base = 0) {
    const out = [];
    let s = base;
    for (const z of segs || []) for (let k = 0; k < (z.n | 0); k++) { s += n0(z.s); out.push(s); }
    return out;
}

/** 옹벽식 날개벽 단면 (시점/종점 행) */
function wallRows(c, key) {
    const rows = (c.wings && c.wings.dim && c.wings.dim[key] && c.wings.dim[key].wall && c.wings.dim[key].wall.rows) || [defaultWallRow(c), defaultWallRow(c, true)];
    return rows.map(r => wallSection(r));
}

function wingLen(c, key) {
    const pos = c.wings && c.wings.pos && c.wings.pos[key];
    return pos && n0(pos.len) > 0 ? n0(pos.len) : 5000;
}

/**
 * 철근 제원용 철근 목록.
 * 반환: [{ desc, prefix, dia, shape, dims, vars, count, main, lapStd }]
 */
export function wingBars(p, c, key) {
    const w = installedWings(c).find(x => x.key === key);
    if (!w) return [];
    const r = getWingRebar(c, key);
    const { cover: cv, marks } = wingCoverOf(c, key);
    const name = WING_NAMES[key];
    const out = [];
    const add = (o) => { if (o.count > 0 && o.dia) out.push({ ...o, desc: `${name} ${o.desc}` }); };
    if (w.type === '일체식') {
        const ev = integralElevation(c, key);
        const plan = (() => { try { return wingPlan(p, c, key); } catch { return null; } })();
        for (const [fk, ft] of [['front', '전면'], ['back', '배면']]) {
            const f = r[fk];
            const xs = zonePositions(f.V, 0).filter(x => x < ev.L1 - 1);
            const hs = xs.map(x => ev.topAt(x) - cv.top - cv.bottom);
            if (xs.length) add({ desc: `${ft} 수직철근`, prefix: marks.main, dia: f.dia.v, shape: 1, dims: { A: Math.round(Math.max(...hs)) }, vars: { a: Math.round(Math.min(...hs)) }, count: xs.length, main: true });
            const ys = zonePositions(f.H, 0).filter(y => y < ev.hRoot - 1);
            // 암거 벽체 내측 피복까지 연장 + 끝 100 꺾음 (평면이 없으면 정착장, 직선)
            const hp = plan ? horzBarPlan(plan, cv, fk) : null;
            const ld = hp ? hp.extIn : devLength(p, f.dia.h1, {});
            const ext = (y) => (y <= ev.hTip ? ev.L1 : ev.L1 * (ev.hRoot - y) / Math.max(1, ev.hRoot - ev.hTip));
            const lens = ys.map(y => Math.max(0, ext(y) - cv.end) + ld);
            const cst = lens.filter((L, i) => ys[i] <= ev.hTip), vary = lens.filter((L, i) => ys[i] > ev.hTip);
            // 형상: 꺾음이 있으면 ㄱ형 (A 직선, B=100), 실제 각도 점열
            const hShape = (A, a) => {
                if (!hp) return { shape: 1, dims: { A: Math.round(A) }, ...(a != null ? { vars: { a: Math.round(a) } } : {}) };
                const u = [hp.pts[0][0] - hp.pts[1][0], hp.pts[0][1] - hp.pts[1][1]], ul = Math.hypot(u[0], u[1]) || 1;
                const pts = [[Math.round(u[0] / ul * A), Math.round(u[1] / ul * A)], [0, 0], [Math.round(hp.pts[2][0] - hp.pts[1][0]), Math.round(hp.pts[2][1] - hp.pts[1][1])]];
                return { shape: 2, dims: { A: Math.round(A), B: 100 }, ...(a != null ? { vars: { a: Math.round(a) } } : {}), pts };
            };
            if (cst.length) add({ desc: `${ft} 수평철근`, prefix: marks.main, dia: f.dia.h1, ...hShape(cst[0]), count: cst.length, main: false });
            if (vary.length) add({ desc: `${ft} 수평철근(변화)`, prefix: marks.main, dia: f.dia.h1, ...hShape(Math.max(...vary), Math.min(...vary)), count: vary.length, main: false });
            if (fk === 'back' && n0(f.M) > 0) {
                const l2 = ys.map(y => Math.max(0, ext(y) - n0(f.M)) + devLength(p, f.dia.h2, {})).filter(L => L > 0);
                if (l2.length) add({ desc: '배면 수평철근2', prefix: marks.main, dia: f.dia.h2, shape: 1, dims: { A: Math.round(Math.max(...l2)) }, vars: Math.max(...l2) !== Math.min(...l2) ? { a: Math.round(Math.min(...l2)) } : {}, count: l2.length, main: false });
            }
            if (fk === 'back' && plan && plan.haunch && f.dia.hu) {
                const hb = haunchBarLine(plan, cv);
                if (hb) add({ desc: '헌치철근', prefix: marks.haunch, dia: f.dia.hu, shape: 3, dims: { A: 100, B: Math.round(hb.len - 200), C: 100 }, pts: hb.pts.map(q => [Math.round(q[0] - hb.pts[0][0]), Math.round(q[1] - hb.pts[0][1])]), count: ys.length, main: false });
                else add({ desc: '헌치철근', prefix: marks.haunch, dia: f.dia.hu, shape: 1, dims: { A: Math.round(Math.hypot(plan.haunch[1][0] - plan.haunch[0][0], plan.haunch[1][1] - plan.haunch[0][1]) + 2 * devLength(p, f.dia.hu, {})) }, count: ys.length, main: false });
            }
            const rl = f.rail;
            if (rl && rl.dia) {
                if (rl.dia.v && n0(rl.len) > 0) add({ desc: `${ft} 난간벽 수직철근`, prefix: marks.rail, dia: rl.dia.v, shape: 1, dims: { A: n0(rl.len) }, count: xs.length, main: false });
                const nh = zonePositions(rl.H, 0).length;
                const slope = Math.hypot(ev.L1, ev.hRoot - ev.hTip) - 2 * cv.railSide;
                if (rl.dia.h && nh) add({ desc: `${ft} 난간벽 수평철근`, prefix: marks.rail, dia: rl.dia.h, shape: 1, dims: { A: Math.round(slope) }, count: nh, main: false });
            }
        }
        const sh = r.shear;
        if (sh && sh.dia) {
            const nx = zonePositions(sh.segs, 0).length;
            const T = (ev.T1 + ev.T2) / 2 || 300;
            const sp = (r.std || 150) * 2;
            const ny = Math.max(1, Math.ceil((ev.hRoot + ev.hTip) / 2 / ((+sh.nMain || 4) * sp)));
            const sd = shearDims(p, sh.type, { t: T, cA: cv.front, cB: cv.back, dm: barD(r.front.dia.v), ds: barD(sh.dia), nMain: +sh.nMain || 4, sp, dia: sh.dia });
            add({ desc: '전단철근', prefix: marks.shear, dia: sh.dia, shape: sd.shape, dims: sd.dims, count: nx * ny, main: false });
        }
    } else {
        const [s0, s1] = wallRows(c, key);
        const L = wingLen(c, key);
        const avg = (a, b) => (a + b) / 2;
        const ctc = n0(r.std) || 250;
        const nL = Math.max(1, Math.floor((L - 2 * cv.end) / ctc) + 1);
        const m = r.main;
        const hV = [s0, s1].map(s => s.WH - cv.top - cv.bottom);
        if (m.wall.place) {
            const leg = 12 * barD(m.wall.back) + 150;
            add({ desc: '벽체 배면 주철근', prefix: marks.main, dia: m.wall.back, shape: 2, dims: { A: Math.round(Math.max(...hV)), B: Math.round(leg) }, vars: hV[0] !== hV[1] ? { a: Math.round(Math.min(...hV)) } : {}, count: nL, main: true });
            if (n0(m.wall.dR) > 0) add({ desc: '벽체 배면 주철근(2Cycle)', prefix: marks.main, dia: m.wall.back, shape: 2, dims: { A: Math.round(Math.max(...hV) - n0(m.wall.dR)), B: Math.round(leg) }, count: nL, main: true });
            add({ desc: '벽체 전면 주철근', prefix: marks.main, dia: m.wall.front, shape: 2, dims: { A: Math.round(Math.max(...hV)), B: Math.round(leg) }, vars: hV[0] !== hV[1] ? { a: Math.round(Math.min(...hV)) } : {}, count: nL, main: true });
        }
        const Wf = [s0, s1].map(s => s.W - 2 * cv.end);
        if (m.foot.place) {
            const topW = m.foot.gap ? [s0, s1].map(s => s.B2 + s.B3 - cv.end) : Wf;
            add({ desc: '기초 상면 주철근', prefix: marks.main, dia: m.foot.top, shape: 1, dims: { A: Math.round(Math.max(...topW)) }, vars: topW[0] !== topW[1] ? { a: Math.round(Math.min(...topW)) } : {}, count: nL, main: true });
            add({ desc: '기초 하면 주철근', prefix: marks.main, dia: m.foot.bottom, shape: 1, dims: { A: Math.round(Math.max(...Wf)) }, vars: Wf[0] !== Wf[1] ? { a: Math.round(Math.min(...Wf)) } : {}, count: nL, main: true });
        }
        const hz = r.horz;
        const Lh = L - 2 * cv.end;
        const nWall = Math.max(1, Math.floor(avg(s0.hStem, s1.hStem) / (n0(hz.wall.ctc) || 300)) + 1);
        if (hz.wall.back) add({ desc: '벽체 배면 수평철근', prefix: marks.main, dia: hz.wall.back, shape: 1, dims: { A: Math.round(Lh) }, count: nWall, main: false, long: true });
        if (hz.wall.front) add({ desc: '벽체 전면 수평철근', prefix: marks.main, dia: hz.wall.front, shape: 1, dims: { A: Math.round(Lh) }, count: nWall, main: false, long: true });
        const nFoot = Math.max(1, Math.floor(avg(Wf[0], Wf[1]) / (n0(hz.foot.ctc) || 300)) + 1);
        if (hz.foot.back) add({ desc: '기초 상면 배력철근', prefix: marks.main, dia: hz.foot.back, shape: 1, dims: { A: Math.round(Lh) }, count: nFoot, main: false, long: true });
        if (hz.foot.front) add({ desc: '기초 하면 배력철근', prefix: marks.main, dia: hz.foot.front, shape: 1, dims: { A: Math.round(Lh) }, count: nFoot, main: false, long: true });
        if (s0.key && hz.key) {
            const kp = s0.key;
            const T = Math.abs(kp[2][1]), Wk = Math.abs(kp[1][0] - kp[0][0]);
            if (hz.key.v) add({ desc: '활동방지벽 수직철근', prefix: marks.main, dia: hz.key.v, shape: 3, dims: { A: Math.round(T + s0.BF2 - 160), B: Math.round(Wk - 160), C: Math.round(T + s0.BF2 - 160) }, count: Math.max(1, Math.floor(Lh / (n0(hz.key.ctc) || 300)) + 1), main: false });
            if (hz.key.h) add({ desc: '활동방지벽 수평철근', prefix: marks.main, dia: hz.key.h, shape: 1, dims: { A: Math.round(Lh) }, count: 2 * Math.max(1, Math.floor((T - 80) / (n0(hz.key.ctc) || 300)) + 1), main: false, long: true });
        }
        const sh = r.shear;
        for (const [k, t, T, len] of [['wall', '벽체', avg(s0.B3, s1.B3), avg(s0.hStem, s1.hStem)], ['foot', '기초', avg(s0.BF1, s1.BF1), avg(s0.W, s1.W)]]) {
            const z = sh[k];
            if (!z || !z.dia) continue;
            const sd = shearDims(p, z.type, { t: T, cA: 80, cB: 80, dm: barD(k === 'wall' ? m.wall.back : m.foot.top), ds: barD(z.dia), nMain: +z.n || 4, sp: ctc, dia: z.dia });
            const cnt = Math.ceil(Lh / ((+z.n || 4) * ctc)) * Math.max(1, Math.floor(len / (n0(z.ctc) || 500)));
            add({ desc: `${t} 전단철근`, prefix: marks.shear, dia: z.dia, shape: sd.shape, dims: sd.dims, count: cnt, main: false });
        }
    }
    return out;
}

/**
 * 간이 설계검토.
 *  일체식: 본체에 고정된 수평 캔틸레버 (높이 1m 띠, 주동토압 + 상재하중) → 근단 배면 수평철근
 *  옹벽식: 벽체 하단 캔틸레버 (배면 주철근) + 뒷굽 저판 (상면 주철근)
 * 반환: [{ part, pos, h, d, As, Mu, phiMn, okM, Vu, phiVn, okV, crack:{…} }]
 */
export function wingCheck(p, c, key) {
    const w = installedWings(c).find(x => x.key === key);
    if (!w) return [];
    const r = getWingRebar(c, key);
    const { fck, fy, code } = materials(p);
    const D = getDesign(p);
    const wd = D.wing || {};
    const gam = +wd.gBack || 19, phi = +wd.phiBack || 30, q = +wd.surcharge || 10;
    const fEP = +wd.epFactor || 1.6, fLL = +wd.liveFactor || 1.6;
    const Ka = KaRankine(phi, 0);
    const { cover: cv } = wingCoverOf(c, key);
    const env = (D.env && D.env.corrosion || '건조환경').replace('환경', '');
    const out = [];
    const row = (o) => {
        const sec = { b: 1000, h: o.h, d: o.d, As: o.As, fck, fy, code };
        const fl = flexure(sec);
        const sv = rcShear(sec, o.Vu * 1e3, 0);
        let cr = null;
        try { cr = crack({ ...sec, cover: o.cc, dc: o.h - o.d, spacing: o.sp, env }, o.Ms * 1e6); } catch { cr = null; }
        out.push({ ...o, rho: fl.rho, rhoMin: fl.rhoMin, phiMn: fl.phiMn / 1e6, okM: fl.phiMn / 1e6 >= o.Mu, phiVn: sv.phiVn / 1e3, okV: sv.phiVn / 1e3 >= o.Vu, crack: cr });
    };
    if (w.type === '일체식') {
        const ev = integralElevation(c, key);
        const T = ev.T2 || 300;
        const ys = zonePositions(r.back.H, 0);
        for (const [pos, y] of [['하단부', Math.max(500, ev.hTip * 0.5)], ['중앙부', ev.hRoot / 2]]) {
            const z = (ev.hRoot - y) / 1000;
            const pE = Ka * gam * z, pL = Ka * q;
            const L = ev.L1 / 1000;
            const MsE = pE * L * L / 2, MsL = pL * L * L / 2;
            const sp = (() => { let best = 300; for (let i = 1; i < ys.length; i++) if (y >= ys[i - 1] && y <= ys[i]) best = ys[i] - ys[i - 1]; return best; })();
            const As = barArea(r.back.dia.h1) * 1000 / sp;
            row({ part: '일체식 날개벽 (수평 캔틸레버)', pos, h: T, d: T - cv.back, As, sp, cc: cv.back - barD(r.back.dia.h1) / 2, Mu: fEP * MsE + fLL * MsL, Ms: MsE + MsL, Vu: (fEP * pE + fLL * pL) * L });
        }
    } else {
        const [s0] = wallRows(c, key);
        const h = s0.hStem / 1000;
        const ctc = n0(r.std) || 250;
        const MsE = Ka * gam * h ** 3 / 6, MsL = Ka * q * h * h / 2;
        const As = barArea(r.main.wall.back) * 1000 / ctc;
        row({ part: '옹벽식 벽체', pos: '벽체 하단', h: s0.B3, d: s0.B3 - cv.back, As, sp: ctc, cc: cv.back - barD(r.main.wall.back) / 2, Mu: fEP * MsE + fLL * MsL, Ms: MsE + MsL, Vu: fEP * Ka * gam * h * h / 2 + fLL * Ka * q * h });
        const B2 = s0.B2 / 1000, Hs = (s0.WH - s0.BF1) / 1000;
        const wS = gam * Hs + 25 * s0.BF1 / 1000, wL = q;
        const MhE = wS * B2 * B2 / 2, MhL = wL * B2 * B2 / 2;
        const Ah = barArea(r.main.foot.top) * 1000 / ctc;
        row({ part: '옹벽식 기초', pos: '뒷굽', h: s0.BF1, d: s0.BF1 - 80, As: Ah, sp: ctc, cc: 80 - barD(r.main.foot.top) / 2, Mu: 1.4 * MhE + fLL * MhL, Ms: MhE + MhL, Vu: (1.4 * wS + fLL * wL) * B2 });
    }
    return out;
}
