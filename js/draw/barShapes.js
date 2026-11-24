// barShapes.js - 철근상세 형상 스케치 (철근 제원 화면 · 철근상세도 공용)
//
// drawBarShape(d, row, opts) : 형상 번호(row.shape)의 모식도를 그리고 치수기호와 값을 붙인다.
// 모식도는 실척이 아니라 형상별 고정 비율(폭 opts.w)로 그린다. 철근 자홍, 치수선 빨강, 문자 초록, 기호 노랑.

import { COLOR, fmtLen } from '../cad/drawing.js';
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

/**
 * 실제 절곡 각도로 그린다 (row.pts: 철근 점열, mm). 가장 긴 구간을 수평으로 돌려 폭 W, 높이 W/2 안에 맞춘다.
 * 구간 기호는 A, B, C … 순서 (row.dims 와 같은 순서).
 */
function drawActualShape(d, row, ox, oy, W, th) {
    const pts = row.pts;
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
