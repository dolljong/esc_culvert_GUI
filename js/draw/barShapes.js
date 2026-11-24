// barShapes.js - 철근상세 형상 스케치 (철근 제원 화면 · 철근상세도 공용)
//
// drawBarShape(d, row, opts) : 형상 번호(row.shape)의 모식도를 그리고 치수기호와 값을 붙인다.
// 모식도는 실척이 아니라 형상별 고정 비율(폭 opts.w)로 그린다. 철근 자홍, 치수선 빨강, 문자 초록, 기호 노랑.

import { COLOR, fmtLen, fmtNum } from '../cad/drawing.js';
import { SHAPES, shapeLength } from '../calc/barShapes.js';

const BAR = { color: COLOR.MAGENTA, layer: 'REBAR' };

/** 형상별 모식도: 점열(단위 폭 1, 높이 비) + 기호 위치 */
function schematic(shape) {
    switch (+shape) {
        case 2: return { pts: [[0, 0], [1, 0], [1, 0.45]], labels: [['A', 0.5, 0, 'b'], ['B', 1, 0.22, 'r']] };
        case 3: return { pts: [[0, 0.45], [0, 0], [1, 0], [1, 0.45]], labels: [['A', 0, 0.22, 'l'], ['B', 0.5, 0, 'b'], ['C', 1, 0.22, 'r']] };
        case 5: return { pts: [[0, 0.5], [0.85, 0.5], [0.95, 0.47], [1, 0.4], [1, 0]], labels: [['A', 0.42, 0.5, 't'], ['B', 0.98, 0.5, 'tr'], ['C', 1, 0.2, 'r']], R: [0.92, 0.42] };
        case 6: return { pts: [[0, 0], [0, 0.4], [0.03, 0.47], [0.1, 0.5], [0.9, 0.5], [0.97, 0.47], [1, 0.4], [1, 0]], labels: [['A', 0, 0.2, 'l'], ['B', 0.02, 0.5, 'tl'], ['C', 0.5, 0.5, 't'], ['D', 0.98, 0.5, 'tr'], ['E', 1, 0.2, 'r']], R: [0.9, 0.42] };
        case 7: return { pts: [[0.08, 0.08], [0, 0], [0, 0.5], [1, 0.5], [1, 0.32], [0.92, 0.4]], labels: [['B', 0, 0.25, 'l'], ['A', 0.5, 0.5, 't'], ['C', 1, 0.41, 'r']] };
        case 8: return { pts: [[0.25, 0.5], [0, 0.5], [0, 0], [1, 0], [1, 0.5], [0.05, 0.5]], labels: [['A', 0.5, 0, 'b'], ['B', 1, 0.25, 'r'], ['C', 0.15, 0.5, 't']] };
        case 9: return { pts: [[0.55, 0.5], [0, 0.5], [0, 0], [0.55, 0]], labels: [['A', 0, 0.25, 'l'], ['B', 0.28, 0.5, 't'], ['C', 0.28, 0, 'b']] };
        case 10: return { pts: [[0, 0.32], [0, 0.5], [1, 0.5], [1, 0], [0.6, 0], [0.66, 0.06]], labels: [['A', 0.5, 0.5, 't'], ['B', 1, 0.25, 'r'], ['C', 0.8, 0, 'b']] };
        case 11: return { pts: [[0.1, 0.42], [0.02, 0.5], [0, 0.5], [0, 0], [1, 0], [1, 0.5], [0, 0.5], [0.1, 0.42]], labels: [['A', 0.5, 0, 'b'], ['B', 1, 0.25, 'r']] };
        case 12: return { circle: true, labels: [['A', 0.5, 0.25, 'c']] };
        case 13: return { pts: [[0, 0.5], [0.3, 0.5], [0.45, 0.1], [0.75, 0.1], [1, 0.4]], labels: [['A', 0.15, 0.5, 't'], ['B', 0.37, 0.3, 'l'], ['C', 0.6, 0.1, 'b'], ['D', 0.88, 0.25, 'r']] };
        case 14: return { pts: [[0.05, 0.12], [0.15, 0.35], [0.85, 0.35], [0.95, 0.12]], labels: [['A', 0.1, 0.23, 'l'], ['B', 0.5, 0.35, 't'], ['C', 0.9, 0.23, 'r'], ['D', 0.2, 0.3, 'b'], ['E', 0.8, 0.3, 'b']] };
        default: return { pts: [[0, 0], [1, 0]], labels: [['A', 0.5, 0, 'b']] };
    }
}

/**
 * 형상 스케치.
 * row: { shape, dims, vars, dia, mark, lap, lapN, length, count }
 * opts: { x, y (왼쪽 아래), w (폭 mm), th (문자높이), title }
 */
export function drawBarShape(d, row, opts = {}) {
    const W = opts.w || 4000, th = opts.th || d.textHeight;
    const ox = opts.x || 0, oy = opts.y || 0;
    const actual = Array.isArray(row.pts) && row.pts.length > 2;
    const sc = actual ? { pts: [], labels: [] } : schematic(row.shape);
    const H = W * 0.5;
    const P = ([u, v]) => [ox + u * W, oy + v * W];
    if (sc.circle) {
        d.circle(ox + W * 0.5, oy + W * 0.25, W * 0.25, BAR);
        d.line(ox + W * 0.25, oy + W * 0.25, ox + W * 0.75, oy + W * 0.25, { color: COLOR.RED, layer: 'DIM' });
    } else if (actual) {
        drawActualShape(d, row, ox, oy, W, th);
    } else {
        d.pline(sc.pts.map(P), BAR);
    }
    const dims = row.dims || {};
    const vars = row.vars || {};
    for (const [k, u, v, side] of sc.labels) {
        const val = dims[k];
        const lo = vars[k.toLowerCase()];
        const txt = `${k}=${val != null && val !== '' ? fmtLen(+val) : '-'}${lo ? `~${fmtLen(+lo)}` : ''}`;
        const q = P([u, v]);
        const off = th * 0.6;
        let x = q[0], y = q[1], align = 'center', valign = 'middle';
        if (side.includes('t')) { y += off; valign = 'bottom'; }
        if (side.includes('b')) { y -= off; valign = 'top'; }
        if (side === 'l') { x -= off; align = 'right'; }
        if (side === 'r') { x += off; align = 'left'; }
        if (side === 'tl') { x -= off; align = 'right'; }
        if (side === 'tr') { x += off; align = 'left'; }
        d.text(x, y, k, { color: COLOR.YELLOW, h: th * 0.8, align, valign: valign === 'middle' ? 'bottom' : valign, layer: 'VAR' });
        d.text(x, y - (valign === 'top' ? th * 0.95 : th * 0.05), txt.slice(2), { color: COLOR.GREEN, h: th * 0.65, align, valign: 'top', layer: 'TEXT' });
    }
    if (sc.R && dims.R) {
        const q = P(sc.R);
        d.text(q[0] - th * 0.3, q[1] - th * 0.3, `R=${dims.R}`, { color: COLOR.GREEN, h: th * 0.6, align: 'right', valign: 'top', layer: 'TEXT' });
    }
    // 제목 / 요약
    const info = SHAPES[row.shape] || SHAPES[1];
    const L = row.length != null ? row.length : shapeLength(row);
    const yT = oy + H + th * 2.4;
    d.text(ox, yT, `${row.mark || ''}  ${row.dia || ''}  상세 ${row.shape} (${info.name})`, { color: COLOR.WHITE, h: th, align: 'left', valign: 'bottom', layer: 'TEXT' });
    d.text(ox, oy - th * 2.6, `L = ${fmtLen(Math.round(L))}${row.lapN ? `  (이음 ${row.lap} × ${row.lapN})` : ''}${row.count != null ? `   ${row.count} EA` : ''}   [${info.desc}]`, { color: COLOR.GREEN, h: th * 0.75, align: 'left', valign: 'top', layer: 'TEXT' });
}

// ── 형상별 변수 치수 (같은 모양 철근을 한 그림으로) ─────────────────────

/** 모식도 점열의 구간 번호 → 치수 기호 (호(arc)·원·R 은 기호 문자만) */
const DIM_SEGS = {
    1: { A: 0 }, 2: { A: 0, B: 1 }, 3: { A: 0, B: 1, C: 2 },
    5: { A: 0, C: 3 }, 6: { A: 0, C: 3, E: 6 },
    7: { B: 1, A: 2, C: 3 }, 8: { C: 0, A: 2, B: 3 }, 9: { B: 0, A: 1, C: 2 },
    10: { A: 1, B: 2, C: 3 }, 11: { A: 3, B: 4 }, 13: { A: 0, B: 1, C: 2, D: 3 },
};
const ARC_LABELS = { 5: [['B', 0.98, 0.5]], 6: [['B', 0.02, 0.5], ['D', 0.98, 0.5]] };

/** 꺾임 내각·회전 방향 (같은 모양 판정용). pts 가 없으면 '' */
function bendSig(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return '';
    const out = [];
    for (let i = 1; i < pts.length - 1; i++) {
        const u = [pts[i - 1][0] - pts[i][0], pts[i - 1][1] - pts[i][1]], v = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
        const den = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1;
        const ang = Math.round(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / den))) * 180 / Math.PI);
        out.push(`${ang}${Math.sign(u[0] * v[1] - u[1] * v[0]) >= 0 ? '+' : '-'}`);
    }
    return out.join(',');
}

/** 같은 모양 키: 상세 번호 + (실제 형상이면) 꺾임 각도·방향. 좌우 대칭은 같은 모양으로 본다. */
export function shapeKey(row) {
    const sig = bendSig(row.pts);
    const mir = sig.replace(/[+-]/g, (c) => (c === '+' ? '-' : '+'));
    return `${+row.shape || 1}|${sig < mir ? sig : mir}|${+row.lapN > 0 ? 'J' : ''}`;
}

/** rows → [{ key, rows }] (처음 나온 순서) */
export function groupShapes(rows) {
    const m = new Map();
    for (const r of rows) {
        const k = shapeKey(r);
        if (!m.has(k)) m.set(k, { key: k, rows: [] });
        m.get(k).rows.push(r);
    }
    return [...m.values()];
}

/** 세그먼트 a-b 에 치수선 (모양 바깥쪽으로), 문자 = 변수명 */
function varDim(d, a, b, key, cen, off, th) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    const n = [-dy / L, dx / L];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const sgn = (m[0] - cen[0]) * n[0] + (m[1] - cen[1]) * n[1] >= 0 ? 1 : -1;
    d.dimA(a, b, sgn * off, key, { h: th * 0.8, textColor: COLOR.YELLOW });
}

/**
 * 같은 모양 철근 묶음의 상세 (그림 하나, 각 구간 치수선 = 변수명).
 * 그림 아래에 철근별 정보(원 안 기호, 수평선 위 직경·격이음, 아래 변수 길이)를 놓는다.
 * opts: { x, y (그림 영역 왼쪽 아래), w, th }
 */
export function drawBarShapeGroup(d, rows, opts = {}) {
    const r0 = rows[0];
    const W = opts.w || 4000, th = opts.th || d.textHeight;
    const ox = opts.x || 0, oy = opts.y || 0;
    const off = th * 1.6;
    const shape = +r0.shape || 1;
    const info = SHAPES[shape] || SHAPES[1];
    let q;
    const actual = Array.isArray(r0.pts) && r0.pts.length > 2;
    if (actual) {
        q = fitActual(visualPts(r0.pts), ox, oy + off * 1.5, W, W * 0.42);
        const cen = centroid(q);
        d.pline(q, BAR);
        const keys = ['A', 'B', 'C', 'D', 'E'];
        for (let i = 1; i < q.length && i <= keys.length; i++) varDim(d, q[i - 1], q[i], keys[i - 1], cen, off, th);
        // 꺾임 내각: 실제 값이 같은 묶음이므로 숫자로 (상세 14 의 D·E)
        if (shape === 14) [['D', 1], ['E', 2]].forEach(([k, i]) => angleText(d, q, i, `${k}=${r0.dims && r0.dims[k]}°`, th));
    } else {
        const sc = schematic(shape);
        const P = ([u, v]) => [ox + u * W, oy + off * 1.5 + v * W];
        if (sc.circle) {
            const c = P([0.5, 0.25]);
            d.circle(c[0], c[1], W * 0.25, BAR);
            d.dimA([c[0] - W * 0.25, c[1]], [c[0] + W * 0.25, c[1]], 0, 'A', { h: th * 0.8, textColor: COLOR.YELLOW });
        } else {
            q = sc.pts.map(P);
            d.pline(q, BAR);
            const cen = centroid(q);
            for (const [k, i] of Object.entries(DIM_SEGS[shape] || { A: 0 })) if (q[i + 1]) varDim(d, q[i], q[i + 1], k, cen, off, th);
            for (const [k, u, v] of ARC_LABELS[shape] || []) { const p = P([u, v]); d.text(p[0], p[1] + th * 0.6, k, { color: COLOR.YELLOW, h: th * 0.8, valign: 'bottom', layer: 'VAR' }); }
            if (sc.R) { const p = P(sc.R); d.text(p[0] - th * 0.3, p[1] - th * 0.3, 'R', { color: COLOR.YELLOW, h: th * 0.7, align: 'right', valign: 'top', layer: 'VAR' }); }
        }
    }
    // 겹이음 표시: 가장 긴 구간 가운데에 겹친 직선 하나 + 치수선 J
    if (q && rows.some(r => +r.lapN > 0)) drawLapMark(d, q, th);
    // 상세 번호·길이식
    d.text(ox, oy - th * 0.4, `상세 ${shape} (${info.name})  L = ${info.desc}`, { color: COLOR.GREEN, h: th * 0.7, align: 'left', valign: 'top', layer: 'TEXT' });
    // 철근별 정보: 원(기호) + 원 아래쪽 수평선. 선 위 = 직경(·겹이음 길이x개수), 선 아래 = 변수 길이
    const keys = info.keys.filter(k => !(shape === 14 && (k === 'D' || k === 'E')));   // 헌치철근 꺾임 각도는 그림에 값으로 표기
    // 같은 기호·값 줄은 하나로 합치고 개수(N)는 더한다
    const items = new Map();
    for (const r of rows) {
        const vars = keys.map(k => { const v = varValue(r, k); return v ? `${k}=${v}` : ''; }).filter(Boolean).join(', ');
        const lap = +r.lapN > 0 ? `J=${fmtNum(+r.lap)}x${+r.lapN}` : '';
        const Lt = r.length != null ? r.length : shapeLength(r) + (+r.lap || 0) * (+r.lapN || 0);   // 전체 길이 (격이음 포함)
        const sig = `${r.mark}|${r.dia}|${Math.round(Lt)}|${lap}|${vars}`;
        const it = items.get(sig);
        if (it) { it.n += +r.count || 0; continue; }
        items.set(sig, { mark: r.mark, dia: r.dia, Lt, lap, vars, n: +r.count || 0 });
    }
    const rad = th * 0.95, step = th * 3.6;
    let y = oy - th * 2.2 - rad;                       // 첫 원 중심
    for (const { mark, dia, Lt, lap, vars, n } of items.values()) {
        const top = [dia || '', Lt ? `L=${fmtNum(Math.round(Lt))}` : '', n ? `N=${fmtNum(n)}` : ''].filter(Boolean).join('   ');
        const cx = ox + rad;
        d.circle(cx, y, rad, { color: COLOR.RED, layer: 'MARK' });
        d.text(cx, y, mark || '', { color: COLOR.GREEN, h: th * 0.8, valign: 'middle', layer: 'MARK' });
        const yl = y - rad;                            // 원 아래쪽 수평선
        const tx = cx + rad + th * 0.4;
        const hT = th * 0.75;
        // 격이음(J=길이x개수)은 항상 선 위쪽 맨 오른쪽
        const len = Math.max(W * 0.55, textLen(top, hT) + (lap ? textLen(lap, hT) + th * 1.5 : 0), textLen(vars, hT)) + th * 0.8;
        if (lap) d.text(tx + len, yl + th * 0.25, lap, { color: COLOR.GREEN, h: hT, align: 'right', valign: 'bottom', layer: 'TEXT' });
        d.line(cx, yl, tx + len, yl, { color: COLOR.RED, layer: 'MARK' });
        if (top) d.text(tx, yl + th * 0.25, top, { color: COLOR.GREEN, h: hT, align: 'left', valign: 'bottom', layer: 'TEXT' });
        if (vars) d.text(tx, yl - th * 0.25, vars, { color: COLOR.GREEN, h: hT, align: 'left', valign: 'top', layer: 'TEXT' });
        y -= step;
    }
}

/** 문자열 대략 폭 (한글 1, 그 외 0.6 단위) */
function textLen(str, h) {
    let u = 0;
    for (const ch of String(str || '')) u += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6;
    return u * h;
}

/** 변수 값: 길이(변화 철근은 범위), 없으면 빈 문자 */
function varValue(r, k) {
    const v = r.dims && r.dims[k];
    if (v == null || v === '') return '';
    const lo = r.vars && r.vars[k.toLowerCase()];
    return lo ? `${fmtNum(+v)}~${fmtNum(+lo)}` : fmtNum(+v);
}

/** 겹이음: 가장 긴 구간 가운데 25% 에 나란한 직선 하나(모양 안쪽) + 치수선 'J' */
function drawLapMark(d, q, th) {
    let k = 1, best = -1;
    for (let i = 1; i < q.length; i++) { const L = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (L > best) { best = L; k = i; } }
    const a = q[k - 1], b = q[k];
    const t = [(b[0] - a[0]) / best, (b[1] - a[1]) / best];
    let n = [-t[1], t[0]];
    const cen = centroid(q);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // 모양 안쪽으로 (변수 치수선은 바깥쪽). 직선 철근처럼 안쪽이 없으면 아래로.
    const inward = (cen[0] - m[0]) * n[0] + (cen[1] - m[1]) * n[1];
    if (inward < -1e-6 || (Math.abs(inward) <= 1e-6 && n[1] > 0)) n = [-n[0], -n[1]];
    const half = best * 0.125, gap = th * 0.5;
    const p0 = [m[0] - t[0] * half + n[0] * gap, m[1] - t[1] * half + n[1] * gap];
    const p1 = [m[0] + t[0] * half + n[0] * gap, m[1] + t[1] * half + n[1] * gap];
    d.line(p0[0], p0[1], p1[0], p1[1], BAR);
    // dimA 의 offset 은 (p0→p1) 왼쪽 법선(-dy, dx) 기준 → 겹친 직선보다 더 안쪽(n 방향)으로
    const left = [-(p1[1] - p0[1]), p1[0] - p0[0]];
    const sgn = left[0] * n[0] + left[1] * n[1] >= 0 ? 1 : -1;
    d.dimA(p0, p1, sgn * th * 1.4, 'J', { h: th * 0.8, textColor: COLOR.YELLOW });
}

function centroid(q) {
    return [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
}

/** 실제 점열을 가장 긴 구간이 수평이 되게 돌려 W × H 상자 안에 맞춘다 */
function fitActual(pts, ox, oy, W, H) {
    let k = 1, best = -1;
    for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (L > best) { best = L; k = i; } }
    const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
    const ca = Math.cos(-a), sa = Math.sin(-a);
    const rot = pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
    const xs = rot.map(p => p[0]), ys = rot.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const sc = Math.min(W / ((Math.max(...xs) - x0) || 1), H / ((Math.max(...ys) - y0) || 1));
    return rot.map(([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc]);
}

/** 꼭짓점 i 안쪽(이등분선 방향)에 각도 문자 */
function angleText(d, q, i, str, th) {
    if (!q[i - 1] || !q[i + 1]) return;
    const u1 = [q[i - 1][0] - q[i][0], q[i - 1][1] - q[i][1]], u2 = [q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]];
    const l1 = Math.hypot(u1[0], u1[1]) || 1, l2 = Math.hypot(u2[0], u2[1]) || 1;
    const bis = [u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2];
    const bl = Math.hypot(bis[0], bis[1]) || 1;
    d.text(q[i][0] + bis[0] / bl * th * 2.2, q[i][1] + bis[1] / bl * th * 2.2, str, { color: COLOR.GREEN, h: th * 0.75, valign: 'middle', layer: 'DIM' });
}

/** 상세 스케치에서 짧은 구간(끝 꺾임 100mm 등)이 보이도록 가장 긴 구간의 이 비율까지 늘려 그린다 (각도는 유지, 치수 문자는 실제 값) */
const MIN_SEG_RATIO = 0.22;

/** 각 구간 방향은 그대로 두고 길이만 최소값 이상으로 늘린 점열 */
function visualPts(pts) {
    const seg = [];
    for (let i = 1; i < pts.length; i++) seg.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    const lens = seg.map(([x, y]) => Math.hypot(x, y));
    const minL = Math.max(...lens) * MIN_SEG_RATIO;
    const out = [pts[0].slice()];
    seg.forEach(([x, y], i) => {
        const L = lens[i], s = L > 1e-9 && L < minL ? minL / L : 1;
        const q = out[out.length - 1];
        out.push([q[0] + x * s, q[1] + y * s]);
    });
    return out;
}

/**
 * 실제 절곡 각도로 그린다 (row.pts: 철근 점열, mm). 가장 긴 구간을 수평으로 돌려 폭 W, 높이 W/2 안에 맞춘다.
 * 구간 기호는 A, B, C … 순서 (row.dims 와 같은 순서).
 */
function drawActualShape(d, row, ox, oy, W, th) {
    const pts = visualPts(row.pts);
    let k = 0, best = -1;
    for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (L > best) { best = L; k = i; } }
    const a = Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]);
    const ca = Math.cos(-a), sa = Math.sin(-a);
    const rot = pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
    const xs = rot.map(q => q[0]), ys = rot.map(q => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const sc = Math.min(W / ((Math.max(...xs) - x0) || 1), W * 0.5 / ((Math.max(...ys) - y0) || 1));
    const P = ([x, y]) => [ox + (x - x0) * sc, oy + (y - y0) * sc];
    const q = rot.map(P);
    d.pline(q, BAR);
    const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cy = q.reduce((s, p) => s + p[1], 0) / q.length;
    const hn = +row.shape === 14;
    const keys = hn ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E'];
    const dims = row.dims || {};
    // 헌치철근: 꺾임 내각 D·E 를 꺾임점 안쪽에 표기
    if (hn) [['D', 1], ['E', 2]].forEach(([kk, i]) => {
        if (!q[i - 1] || !q[i + 1] || dims[kk] == null || dims[kk] === '') return;
        const u1 = [q[i - 1][0] - q[i][0], q[i - 1][1] - q[i][1]], u2 = [q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]];
        const l1 = Math.hypot(u1[0], u1[1]) || 1, l2 = Math.hypot(u2[0], u2[1]) || 1;
        const bis = [u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2];
        const bl = Math.hypot(bis[0], bis[1]) || 1;
        d.text(q[i][0] + bis[0] / bl * th * 1.6, q[i][1] + bis[1] / bl * th * 1.6, `${kk}=${dims[kk]}°`, { color: COLOR.GREEN, h: th * 0.8, valign: 'middle', layer: 'DIM' });
    });
    for (let i = 1; i < q.length && i <= keys.length; i++) {
        const m = [(q[i][0] + q[i - 1][0]) / 2, (q[i][1] + q[i - 1][1]) / 2];
        const t = [q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]];
        const tl = Math.hypot(t[0], t[1]) || 1;
        let n = [-t[1] / tl, t[0] / tl];
        if ((m[0] - cx) * n[0] + (m[1] - cy) * n[1] < 0) n = [-n[0], -n[1]];
        const kk = keys[i - 1];
        const val = dims[kk];
        d.text(m[0] + n[0] * th * 0.9, m[1] + n[1] * th * 0.9, `${kk}=${val != null && val !== '' ? fmtLen(+val) : '-'}`, { color: COLOR.GREEN, h: th, valign: 'middle', layer: 'DIM' });
    }
}
