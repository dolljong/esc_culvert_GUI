// wingGeom.js - 날개벽 형상 (상세입력 > 날개벽 위치 / 날개벽 제원)
//
// 데이터 (culverts[i].wings):
//   pos: { SL|SR|EL|ER: { type:'설치안함'|'일체식'|'옹벽식', len(mm), angle(°), front:'벽체내측'|'벽체외측'|'기준거리', dist(mm) } }
//   dim: { SL|SR|EL|ER: {
//          integral: { L1, H2, H3, T1, T2, Hu1, Hu2, std:'도로공사'|'건교부' },
//          wall: { rows: [시점행, 종점행], fill: {...}, drain: {...} } } }
//
// 평면 국부좌표 (mm): u = 선형 진행방향(이음 Station 기준), v = 선형중심에서 우측 +.
// 암거 단부 이음선(사각)은 u = -cot(이음각) · v.
// 날개벽 각도 = 본체 벽면(암거 안쪽 방향)과 날개벽이 이루는 평면 각 (90 = 단부면과 평행, 180 = 벽면 연장).
//
// 일체식 날개벽 전개도(해석상 정의):
//   근단: 상단 = 암거 상단, 하단 = 암거 하단 (근단 높이 = 본체 전체높이)
//   H2 = 끝단 노출 높이, H3 = 끝단 근입(하부) 높이 → 끝단 높이 = H2 + H3
//   T1 = 상단 두께, T2 = 하단 두께, Hu1/Hu2 = 평면 헌치 (본체 외면 방향 / 날개벽 배면 방향)
// 옹벽식 날개벽 단면 (역T형, 배면=왼쪽, 전면=오른쪽):
//   footing = B2(뒷굽) + B3(벽체 하단폭) + B1(앞굽), 벽체높이 = WH - max(BF1, BB1)

import { jointStations, blocks } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import { getHorizontal, elevationAt } from './alignment.js';

const n0 = (v) => (isFinite(+v) ? +v : 0);
const K = 1000;

export const WING_KEYS = ['SL', 'SR', 'EL', 'ER'];
export const WING_NAMES = { SL: '시점부(좌)', SR: '시점부(우)', EL: '종점부(좌)', ER: '종점부(우)' };
export const WING_LABELS = { SL: ['시점', '좌측'], SR: ['시점', '우측'], EL: ['종점', '좌측'], ER: ['종점', '우측'] };
export const WING_TYPES = ['설치안함', '일체식', '옹벽식'];
export const FRONT_POS = ['벽체내측', '벽체외측', '기준거리'];
export const WING_STD = ['도로공사', '건교부'];

// ── 기본값 ────────────────────────────────────────────────────────────

export function defaultWingPos() {
    return {
        SL: { type: '일체식', len: 5000, angle: 130, front: '벽체외측', dist: 500 },
        SR: { type: '옹벽식', len: 4500, angle: 150, front: '벽체외측', dist: 500 },
        EL: { type: '설치안함', len: 5000, angle: 130, front: '벽체외측', dist: 500 },
        ER: { type: '설치안함', len: 5000, angle: 130, front: '벽체외측', dist: 500 },
    };
}

/** 위치 기본값을 현재 단면 벽 두께에 맞춘다 */
export function defaultWingPosFor(c) {
    const pos = defaultWingPos();
    for (const k of WING_KEYS) pos[k].dist = wallThick(c, k);
    return pos;
}

export function defaultIntegral(c, len = 5000) {
    const g = safeGeom(c, 0);
    return { L1: len, H2: 1000, H3: 1000, T1: 300, T2: Math.max(300, Math.round(g ? g.WL : 500)), Hu1: 300, Hu2: 300, std: '도로공사' };
}

/** 옹벽식 단면 한 행 (시점 또는 종점) */
export function defaultWallRow(c, end = false) {
    const g = safeGeom(c, 0);
    const Htot = g ? g.Htot : 5600;
    const topEl = culvertTopEl(c, 'S');
    const WH = Math.round(end ? Math.max(2000, Htot - 1000) : Htot + 400);
    const baseEl = topEl - (Htot + 400) / K;
    return {
        batter: end ? 0.0244 : 0.0198, WH, WT: 290,
        B1: 600, B2: end ? 2900 : 3400, B3: 500,
        BF1: 700, BF2: 500, BB1: 700, BB2: 500,
        EL: +(baseEl + WH / K).toFixed(3), addH: 0,
        key: { use: true, D: end ? 2200 : 2600, W: 450, T: 500 },
        HU1: 300, HU2: 300, IO: 100, IH: 100,
    };
}

export function defaultWallDim(c) {
    return {
        rows: [defaultWallRow(c, false), defaultWallRow(c, true)],
        fill: { inf: false, SL: 500, SH: 2000, SD: 0, slope1: 1.5, slope2: 1.8, bermW: 1000, bermS: 4.0 },
        drain: { use: true, dia: 100, dH: 1000, ctcH: 3000, dV: 300, T: 300 },
    };
}

export function defaultWingDim(c, key) {
    const pos = (c.wings && c.wings.pos && c.wings.pos[key]) || defaultWingPos()[key];
    return { integral: defaultIntegral(c, n0(pos.len) || 5000), wall: defaultWallDim(c) };
}

// ── 조회 ─────────────────────────────────────────────────────────────

function safeGeom(c, bi) {
    try { return sectionGeom(c, bi); } catch { return null; }
}

/** 날개벽이 붙는 블록 (시점=첫 블록, 종점=끝 블록) */
export function wingBlock(c, key) {
    return key[0] === 'S' ? 0 : Math.max(0, blocks(c).length - 1);
}

/** 날개벽이 붙는 본체 측벽 두께 (mm) */
export function wallThick(c, key) {
    const g = safeGeom(c, wingBlock(c, key));
    if (!g) return 500;
    return key[1] === 'L' ? g.WL : g.WR;
}

/** 전면위치에 따른 거리 (벽체 내면에서 날개벽 전면까지, mm) */
export function frontDist(c, key, pos) {
    if (!pos) return 0;
    if (pos.front === '벽체내측') return 0;
    if (pos.front === '벽체외측') return wallThick(c, key);
    return n0(pos.dist);
}

/** 설치된 날개벽 목록 [{key, type, name}] */
export function installedWings(c) {
    const pos = (c.wings && c.wings.pos) || defaultWingPosFor(c);
    return WING_KEYS.filter(k => pos[k] && pos[k].type && pos[k].type !== '설치안함')
        .map(k => ({ key: k, type: pos[k].type, name: `${WING_NAMES[k]}-${pos[k].type}` }));
}

/** 암거 상부슬래브 상면 EL (m) — 시점('S') 또는 종점('E') */
export function culvertTopEl(c, end = 'S', p = null) {
    const st = jointStations(c);
    const sta = end === 'S' ? st[0] : st[st.length - 1];
    const bi = end === 'S' ? 0 : Math.max(0, st.length - 2);
    const g = safeGeom(c, bi);
    let ref = 0;
    try { ref = p ? elevationAt(p.alignment.vip, sta) : 0; } catch { ref = 0; }
    if (!g) return ref;
    return ref + (g.Htot - g.refY) / K;
}

// ── 평면 ─────────────────────────────────────────────────────────────

/**
 * 암거 단부의 평면 국부좌표계.
 * 반환: { sta, angle, cot, g, off, vL, vR, toG(u,v) → [x,y] (도면 mm), endU(v) }
 */
export function endFrame(p, c, end = 'S') {
    const st = jointStations(c);
    const joints = c.joints || [];
    const isS = end === 'S';
    const sta = isS ? st[0] : st[st.length - 1];
    const j = isS ? joints[0] : joints[joints.length - 1];
    const angle = (j && +j.angle) || 90;
    const a = angle * Math.PI / 180;
    const cot = Math.abs(Math.sin(a)) < 1e-6 ? 0 : Math.cos(a) / Math.sin(a);
    const bi = isS ? 0 : Math.max(0, st.length - 2);
    const g = sectionGeom(c, bi);
    const off = n0(c.offset);
    let toG = (u, v) => [u, -v];
    try {
        const h = getHorizontal(p.alignment);
        const q = h.pointAt(sta);
        const tx = Math.cos(q.th), ty = Math.sin(q.th);
        const rx = Math.sin(q.th), ry = -Math.cos(q.th);
        toG = (u, v) => [q.x * K + u * tx + v * rx, q.y * K + u * ty + v * ry];
    } catch { /* 선형 없음: 국부좌표 그대로 */ }
    return {
        sta, angle, cot, g, off, end,
        vL: off - g.W / 2, vR: off + g.W / 2,
        endU: (v) => -cot * v,
        toG,
    };
}

function lineIntersect(p, d, q, e) {
    // p + s d = q + t e
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-9) return null;
    const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
    return { s, pt: [p[0] + s * d[0], p[1] + s * d[1]] };
}

/**
 * 날개벽 평면 형상 (국부좌표 u,v mm).
 * thick: 평면 두께 (일체식 T2, 옹벽식 벽체 하단폭)
 * 반환: { key, type, len, angle, dir, back, root, tip, backRoot, backTip, poly, haunch, frame, wallV }
 */
export function wingPlan(p, c, key, opts = {}) {
    const pos = (c.wings && c.wings.pos && c.wings.pos[key]) || defaultWingPosFor(c)[key];
    const end = key[0] === 'S' ? 'S' : 'E';
    const F = opts.frame || endFrame(p, c, end);
    const left = key[1] === 'L';
    const g = F.g;
    const tw = left ? g.WL : g.WR;
    const vOut = left ? F.vL : F.vR;
    const vIn = left ? F.vL + tw : F.vR - tw;
    const dist = frontDist(c, key, pos);
    const vF = left ? vIn - dist : vIn + dist;
    const A = n0(pos.angle || 90) * Math.PI / 180;
    let dir;
    if (key === 'SL') dir = [Math.cos(A), -Math.sin(A)];
    else if (key === 'SR') dir = [Math.cos(A), Math.sin(A)];
    else if (key === 'EL') dir = [-Math.cos(A), -Math.sin(A)];
    else dir = [-Math.cos(A), Math.sin(A)];
    const back = (key === 'SL' || key === 'ER') ? [-dir[1], dir[0]] : [dir[1], -dir[0]];
    const L = n0(pos.len);
    const T = opts.thick != null ? opts.thick : thickOf(c, key);
    const root = [F.endU(vF), vF];
    const tip = [root[0] + dir[0] * L, root[1] + dir[1] * L];
    const backTip = [tip[0] + back[0] * T, tip[1] + back[1] * T];
    // 배면선과 본체 외면선(v = vOut)의 교점, 없으면 단부선과의 교점
    const sideDir = [1, 0];
    let backRoot = null;
    const hit = lineIntersect(backTip, [-dir[0], -dir[1]], [F.endU(vOut), vOut], sideDir);
    if (hit && hit.s > 0 && hit.s < L + T * 4 + 5000) backRoot = hit.pt;
    if (!backRoot) {
        const endDir = [-F.cot, 1];
        const h2 = lineIntersect(backTip, [-dir[0], -dir[1]], [F.endU(0), 0], endDir);
        backRoot = h2 ? h2.pt : [root[0] + back[0] * T, root[1] + back[1] * T];
    }
    // 평면 헌치 (일체식): 배면 접합 모서리
    let haunch = null;
    if (pos.type === '일체식') {
        const d = (c.wings && c.wings.dim && c.wings.dim[key] && c.wings.dim[key].integral) || defaultIntegral(c);
        const hu1 = n0(d.Hu1), hu2 = n0(d.Hu2);
        if (hu1 > 0 && hu2 > 0 && hit && hit.s > 0) {
            const sgnU = end === 'S' ? 1 : -1;
            const a = [backRoot[0] + sgnU * hu1, backRoot[1]];
            const b = [backRoot[0] + dir[0] * hu2, backRoot[1] + dir[1] * hu2];
            haunch = [a, b];
        }
    }
    return {
        key, type: pos.type, len: L, angleDeg: n0(pos.angle), dir, back, root, tip, backRoot, backTip,
        poly: [root, tip, backTip, backRoot], haunch, frame: F, vOut, vIn, vF, thick: T, dist,
    };
}

/** 평면 두께 */
export function thickOf(c, key) {
    const pos = (c.wings && c.wings.pos && c.wings.pos[key]) || {};
    const dim = (c.wings && c.wings.dim && c.wings.dim[key]) || {};
    if (pos.type === '옹벽식') {
        const r = (dim.wall && dim.wall.rows && dim.wall.rows[0]) || defaultWallRow(c);
        return n0(r.B3) || n0(r.WT) || 300;
    }
    const it = dim.integral || defaultIntegral(c);
    return n0(it.T2) || n0(it.T1) || 300;
}

// ── 일체식 전개도 ────────────────────────────────────────────────────

/** 일체식 날개벽 전개 입면 (x: 근단 0 → 끝단 L1, y: 본체 하면 0) */
export function integralElevation(c, key) {
    const dim = (c.wings && c.wings.dim && c.wings.dim[key] && c.wings.dim[key].integral) || defaultIntegral(c);
    const g = sectionGeom(c, wingBlock(c, key));
    const pos = c.wings && c.wings.pos && c.wings.pos[key];
    const L1 = pos && n0(pos.len) > 0 ? n0(pos.len) : n0(dim.L1), H2 = n0(dim.H2), H3 = n0(dim.H3);
    const hRoot = g.Htot, hTip = H2 + H3;
    return {
        L1, H1: 0, H2, H3, hRoot, hTip, Htot: g.Htot, T1: n0(dim.T1), T2: n0(dim.T2),
        poly: [[0, 0], [L1, 0], [L1, hTip], [0, hRoot]],
        /** x 위치의 상단 높이 */
        topAt: (x) => hRoot + (hTip - hRoot) * Math.max(0, Math.min(1, x / (L1 || 1))),
    };
}

// ── 옹벽식 단면 ──────────────────────────────────────────────────────

/**
 * 역T형 옹벽 단면 (x: 뒷굽 끝 0 → 앞굽 끝, y: 기초 하면 0)
 * 반환: { poly, stem:{xb0,xb1,xt0,xt1,y0,y1}, key:poly|null, keyLine(도면용 ㄷ자), lean:poly|null, leanParts(도면용, 전단키에서 끊음), W, WH, hStem }
 */
export function wallSection(r) {
    const B1 = n0(r.B1), B2 = n0(r.B2), B3 = n0(r.B3);
    const BF1 = n0(r.BF1), BF2 = n0(r.BF2), BB1 = n0(r.BB1), BB2 = n0(r.BB2);
    const WH = n0(r.WH), WT = n0(r.WT), n = n0(r.batter);
    const W = B1 + B2 + B3;
    const xb0 = B2, xb1 = B2 + B3;               // 벽체 하단 (배면, 전면)
    const yJ = Math.max(BF1, BB1);               // 벽체 하단 높이
    const hStem = Math.max(0, WH - yJ);
    let xt1 = xb1 - n * hStem;                   // 전면 상단 (전면경사)
    let xt0 = xt1 - WT;                          // 배면 상단
    if (xt0 < xb0) xt0 = xb0;
    const HU1 = n0(r.HU1), HU2 = n0(r.HU2);
    const poly = [[0, 0], [W, 0], [W, BB2], [xb1, BB1], [xt1, WH], [xt0, WH]];
    // 배면 (xt0,WH) → (xb0, BF1) 직선, 배면헌치
    const backAt = (y) => xb0 + (xt0 - xb0) * (y - BF1) / ((WH - BF1) || 1);
    if (HU1 > 0 && HU2 > 0) {
        poly.push([backAt(BF1 + HU2), BF1 + HU2], [xb0 - HU1, BF1 + (BF2 - BF1) * (HU1 / (B2 || 1))]);
    } else poly.push([xb0, BF1]);
    poly.push([0, BF2]);
    let key = null, keyLine = null;
    if (r.key && r.key.use) {
        const D = n0(r.key.D), Wk = n0(r.key.W), T = n0(r.key.T);
        key = [[D, 0], [D + Wk, 0], [D + Wk, -T], [D, -T]];      // 계산용 (점 순서를 바꾸지 말 것: 철근·면적이 의존)
        // 도면용: 기초 하면에 붙은 ㄷ자 (뒤쪽 수직 → 하면 → 앞쪽 수직). 윗변은 기초 하면과 겹치므로 그리지 않는다.
        keyLine = [[D, 0], [D, -T], [D + Wk, -T], [D + Wk, 0]];
    }
    const IO = n0(r.IO), IH = n0(r.IH);
    const lean = IH > 0 ? [[-IO, 0], [W + IO, 0], [W + IO, -IH], [-IO, -IH]] : null;
    // 도면용 버림: 전단키 자리에서 끊는다 (키가 버림보다 깊으면 두 조각, 얕으면 키 모양으로 파인 한 조각)
    let leanParts = lean ? [lean] : null;
    if (lean && key) {
        const k0 = n0(r.key.D), k1 = k0 + n0(r.key.W), kT = n0(r.key.T);
        if (kT >= IH) {
            leanParts = [];
            if (k0 > -IO) leanParts.push([[-IO, 0], [k0, 0], [k0, -IH], [-IO, -IH]]);
            if (k1 < W + IO) leanParts.push([[k1, 0], [W + IO, 0], [W + IO, -IH], [k1, -IH]]);
        } else {
            leanParts = [[[-IO, 0], [k0, 0], [k0, -kT], [k1, -kT], [k1, 0], [W + IO, 0], [W + IO, -IH], [-IO, -IH]]];
        }
    }
    return { poly, W, WH, hStem, yJ, stem: { xb0, xb1, xt0, xt1, y0: yJ, y1: WH }, key, keyLine, lean, leanParts, B1, B2, B3, BF1, BF2, BB1, BB2, WT, batter: n };
}

/** 각 날개벽의 평면 다각형 (도면 좌표) — 도면/수량 공용 */
export function wingPlansGlobal(p, c) {
    const out = [];
    for (const w of installedWings(c)) {
        const wp = wingPlan(p, c, w.key);
        const T = wp.frame.toG;
        out.push({ ...wp, gPoly: wp.poly.map(([u, v]) => T(u, v)) });
    }
    return out;
}
