// crossGeom.js - 횡단제원(차도부/측구) 데이터와 형상 (일반 입력 > 횡단 제원)
//
// c.cross = {
//   all: false,                 // 차도부 전체설치
//   cur: 0,                     // 편집 중인 련
//   cells: [{ use, segs:[{len, kind, slope, depth}], minT, pave, linkHaunch, detail:{B1,b,h} }]
// }
// segs: 련 내공을 가로로 나눈 구간 L1..Ln (mm). 마지막 구간 길이 = B − Σ(나머지).
// kind: 없음 / 차도 / 방호벽 / 측구 / 측구2(지하차도). slope: % (차도만), depth: 측구높이 mm (하부슬래브 상면에서 아래로)

import { sectionGeom, haunchSize } from './sectionGeom.js';

export const CROSS_KINDS = ['없음', '차도', '방호벽', '측구'];
export const BARRIER_H = 810;    // 방호벽 높이 (차도부 상면에서, mm)

export function crossKinds(c) {
    return c.type === '지하차도' ? [...CROSS_KINDS, '측구2'] : CROSS_KINDS;
}

/** 단면의 (하층) 련 목록 */
export function crossCells(c, bi = 0) {
    const g = sectionGeom(c, bi);
    return { g, cells: g.cells.filter(cc => cc.floor !== 2) };
}

export function defaultCrossCell(B) {
    const side = 400, ditch = 200;
    if (B < 2 * (side + ditch) + 1000) {
        return { use: false, segs: [{ len: B, kind: '차도', slope: 2.0, depth: 0 }], minT: 100, pave: 0, linkHaunch: false, detail: { B1: 150, b: 50, h: 50 } };
    }
    return {
        use: false,
        segs: [
            { len: side, kind: '없음', slope: 0, depth: 0 },
            { len: ditch, kind: '측구', slope: 0, depth: 200 },
            { len: B - 2 * (side + ditch), kind: '차도', slope: 2.0, depth: 0 },
            { len: ditch, kind: '측구', slope: 0, depth: 200 },
            { len: side, kind: '없음', slope: 0, depth: 0 },
        ],
        minT: 100, pave: 0, linkHaunch: false, detail: { B1: 150, b: 50, h: 50 },
    };
}

export function defaultCross(c, bi = 0) {
    const { cells } = crossCells(c, bi);
    return { all: false, cur: 0, cells: cells.map(cc => defaultCrossCell(cc.B)) };
}

/** 련 수가 바뀐 경우 등 정리 */
export function normalizeCross(c, cr, bi = 0) {
    const { cells } = crossCells(c, bi);
    const out = cr ? JSON.parse(JSON.stringify(cr)) : defaultCross(c, bi);
    if (!Array.isArray(out.cells)) out.cells = [];
    out.cells = cells.map((cc, i) => {
        const x = out.cells[i];
        if (!x || !Array.isArray(x.segs) || !x.segs.length) return defaultCrossCell(cc.B);
        const d = defaultCrossCell(cc.B);
        return { ...d, ...x, detail: { ...d.detail, ...(x.detail || {}) } };
    });
    if (out.all == null) out.all = false;
    out.cur = Math.max(0, Math.min(cells.length - 1, out.cur | 0));
    return out;
}

/** 구간 길이 (마지막 = B − 합) */
export function segLengths(cell, B) {
    const n = cell.segs.length;
    const out = cell.segs.map(s => +s.len || 0);
    if (n) out[n - 1] = B - out.slice(0, n - 1).reduce((a, b) => a + b, 0);
    return out;
}

/**
 * 련 내부 형상 (단면 좌표 mm)
 * 반환 { road: [[pts]], barriers: [[pts]], ditches: [[pts]], pave: [[p,q]], links: [[p,q]] }
 */
export function crossShapes(g, cc, cell, sec) {
    const out = { road: [], barriers: [], ditches: [], pave: [], links: [] };
    const y0 = cc.y0;
    const lens = segLengths(cell, cc.B);
    const minT = +cell.minT || 0;
    let x = cc.x0;
    lens.forEach((len, i) => {
        const s = cell.segs[i];
        const xa = x, xb = x + len;
        x = xb;
        if (len <= 0) return;
        if (s.kind === '차도') {
            const rise = len / 2 * (+s.slope || 0) / 100;
            const top = [[xb, y0 + minT], [(xa + xb) / 2, y0 + minT + rise], [xa, y0 + minT]];
            out.road.push([[xa, y0], [xb, y0], ...top]);
            if (+cell.pave > 0) {
                const pv = +cell.pave;
                out.pave.push([[xa, y0 + minT - pv], [(xa + xb) / 2, y0 + minT + rise - pv]], [[(xa + xb) / 2, y0 + minT + rise - pv], [xb, y0 + minT - pv]]);
            }
        } else if (s.kind === '방호벽') {
            out.barriers.push([[xa, y0], [xb, y0], [xb, y0 + minT + BARRIER_H], [xa, y0 + minT + BARRIER_H]]);
        } else if (s.kind === '측구' || s.kind === '측구2') {
            const dpt = +s.depth || 0;
            if (s.kind === '측구2') {
                const dt = cell.detail || {};
                const b = Math.min(len, +dt.b || 0), hh = +dt.h || 0;
                // 차도 쪽 상단에 b×h 턱
                const roadRight = i > 0 && cell.segs[i - 1].kind === '차도';
                out.ditches.push(roadRight
                    ? [[xa, y0 + minT], [xa, y0 + minT - hh], [xa + b, y0 + minT - hh], [xa + b, y0 - dpt], [xb, y0 - dpt], [xb, y0]]
                    : [[xa, y0], [xa, y0 - dpt], [xb - b, y0 - dpt], [xb - b, y0 + minT - hh], [xb, y0 + minT - hh], [xb, y0 + minT]]);
            } else {
                out.ditches.push([[xa, y0], [xa, y0 - dpt], [xb, y0 - dpt], [xb, y0]]);
            }
        }
    });
    // 하부헌치를 측구와 연결
    if (cell.linkHaunch && sec) {
        const hs = (g.kind === 'U' ? (sec.haunch || [])[0] : (sec.haunch || [])[cc.index]) || {};
        const first = cell.segs[0], last = cell.segs[cell.segs.length - 1];
        const ditch = (s) => s && (s.kind === '측구' || s.kind === '측구2');
        const link = (hc, side) => {
            const sz = haunchSize(hc);
            if (!(sz.w > 0 && sz.s > 0)) return;
            const s = side < 0 ? first : last;
            const dpt = +s.depth || 0;
            const xw = side < 0 ? cc.x0 : cc.x1;
            const dx = sz.s * (sz.w + dpt) / sz.w;
            out.links.push([[xw, y0 + sz.w], [xw - side * dx, y0 - dpt]]);
        };
        if (ditch(first) && hs.LL && hs.LL.use) link(hs.LL, -1);
        if (ditch(last) && hs.LR && hs.LR.use) link(hs.LR, 1);
    }
    return out;
}
