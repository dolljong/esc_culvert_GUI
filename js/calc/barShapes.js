// barShapes.js - 철근 상세(형상) 번호와 길이 계산 (철근 제원표 · 철근상세도 · 수량 공용)
//
// 철근 제원표의 '상세' 번호가 가리키는 형상과 치수 기호(A~E, R)의 뜻.
// 길이(mm) = shapeLength(shape, dims, dia) + 이음장 × 이음수 (barSchedule 에서 더함)
// 변수형(테이퍼) 철근은 소문자 a~d 가 대문자 A~D 의 다른 끝 값이며, 길이는 평균 치수로 계산한다.

import { barInfo, barLength } from './rebar.js';

/** 135° 갈고리 1개 길이 (KCI: 6db 이상, 75mm 이상 + 구부림부) */
export function hookLen(dia) {
    const b = barInfo(dia);
    const db = b ? b.d : 16;
    return Math.round(Math.max(6 * db, 75) + 3 * db);
}

/**
 * 형상 목록. keys = 사용 치수 기호, hooks = 갈고리 수, desc = 설명
 */
export const SHAPES = {
    1: { name: '직선', keys: ['A'], desc: 'A' },
    2: { name: 'ㄱ형', keys: ['A', 'B'], desc: 'A + B' },
    3: { name: 'ㄷ형', keys: ['A', 'B', 'C'], desc: 'A + B + C' },
    5: { name: '곡선절곡 ㄱ형', keys: ['A', 'B', 'C', 'R'], desc: 'A + B(호) + C' },
    6: { name: '곡선절곡 ㄷ형', keys: ['A', 'B', 'C', 'D', 'E', 'R'], desc: 'A + B(호) + C + D(호) + E' },
    7: { name: '캡형 전단', keys: ['A', 'B', 'C'], hooks: 2, desc: 'A + B + C + 갈고리×2' },
    8: { name: '겹침형 전단', keys: ['A', 'B', 'C'], desc: '2A + 2B + C(겹침)' },
    9: { name: 'ㄷ형 전단', keys: ['A', 'B', 'C'], desc: 'A + B + C' },
    10: { name: '꺽인ㄷ형 전단', keys: ['A', 'B', 'C'], hooks: 1, desc: 'A + B + C + 갈고리' },
    11: { name: '폐합 띠철근', keys: ['A', 'B'], hooks: 2, desc: '2(A + B) + 갈고리×2' },
    12: { name: '원형 띠철근', keys: ['A'], desc: 'π·A' },
    13: { name: '다절곡', keys: ['A', 'B', 'C', 'D', 'E', 'R'], desc: 'A + B + C + D + E + 절곡부' },
    14: { name: '헌치철근', keys: ['A', 'B', 'C', 'D', 'E'], desc: 'A + B + C (D·E = A-B, B-C 꺾임 내각 °)' },
};
export const SHAPE_NOS = Object.keys(SHAPES).map(Number);
export const DIM_KEYS = ['A', 'B', 'C', 'D', 'E', 'R'];
export const VAR_KEYS = ['a', 'b', 'c', 'd'];

const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

/** 변수형 치수 평균 반영 */
export function effDims(dims = {}, vars = {}) {
    const out = {};
    for (const k of DIM_KEYS) {
        const v = n0(dims[k]);
        const lo = vars && vars[k.toLowerCase()];
        out[k] = lo != null && lo !== '' && isFinite(+lo) && +lo > 0 && k !== 'R' ? (v + +lo) / 2 : v;
    }
    return out;
}

/**
 * 형상 길이 (mm, 이음 제외).
 * row: { shape, dims, vars, dia, arc (다절곡 절곡부 합) }
 */
export function shapeLength(row) {
    const d = effDims(row.dims, row.vars);
    const s = SHAPES[row.shape] ? +row.shape : 1;
    const hk = (SHAPES[s].hooks || 0) * hookLen(row.dia);
    switch (s) {
        case 1: return d.A;
        case 2: return d.A + d.B;
        case 3: case 5: case 9: case 14: return d.A + d.B + d.C;
        case 6: return d.A + d.B + d.C + d.D + d.E;
        case 7: case 10: return d.A + d.B + d.C + hk;
        case 8: return 2 * d.A + 2 * d.B + d.C;
        case 11: return 2 * (d.A + d.B) + hk;
        case 12: return Math.PI * d.A;
        case 13: return d.A + d.B + d.C + d.D + d.E + n0(row.arc);
        default: return d.A;
    }
}

/**
 * 폴리라인 철근 → 형상 번호와 치수.
 * 1구간: 1(A) / 2구간: 5(A, B=호, C, R) / 3구간: 6 / 그 이상: 13 (A~E = 직선부, arc = 절곡부 합)
 * bendR = 0 이면 2(ㄱ), 3(ㄷ) 형.
 */
export function shapeFromPts(pts, bendR = 0) {
    // 짧은 구간에서 구부림 반지름이 직선부를 넘지 않도록 줄인다 (90° 기준 접선길이 = R)
    const seg = [];
    for (let i = 1; i < pts.length; i++) seg.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    if (bendR && seg.length > 1) {
        let lim = Infinity;
        seg.forEach((L, i) => { lim = Math.min(lim, i === 0 || i === seg.length - 1 ? L : L / 2); });
        bendR = Math.max(0, Math.min(bendR, lim * 0.9));
    }
    const bl = barLength(pts, bendR);
    const st = bl.straight.map(v => Math.round(v));
    const arcs = bl.bends.map(b => Math.round(b.arc));
    const R = Math.round(bendR);
    if (st.length <= 1) return { shape: 1, dims: { A: st[0] || 0 }, length: bl.length };
    if (!bendR) {
        if (st.length === 2) return { shape: 2, dims: { A: st[0], B: st[1] }, length: bl.length };
        if (st.length === 3) return { shape: 3, dims: { A: st[0], B: st[1], C: st[2] }, length: bl.length };
    }
    if (st.length === 2) return { shape: 5, dims: { A: st[0], B: arcs[0] || 0, C: st[1], R }, length: bl.length };
    if (st.length === 3) return { shape: 6, dims: { A: st[0], B: arcs[0] || 0, C: st[1], D: arcs[1] || 0, E: st[2], R }, length: bl.length };
    const sum = st.slice(5).reduce((a, v) => a + v, 0);
    const dims = { A: st[0], B: st[1], C: st[2], D: st[3], E: (st[4] || 0) + sum, R };
    return { shape: 13, dims, arc: arcs.reduce((a, v) => a + v, 0), length: bl.length };
}
