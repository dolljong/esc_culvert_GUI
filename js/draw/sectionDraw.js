// sectionDraw.js - 암거 횡단면도 (입력결과 확인창 공용)
//
// 매뉴얼 2.4 화면 규칙:
//  · 구조물 외곽 하늘색, 치수선 빨강 + 치수문자 초록, 변수명(WL, B1 …) 노랑 (클릭 시 입력셀)
//  · 선형 중심선 빨간 일점쇄선 + '선형1', 상부 EL ▽, 하부 기초 EL ▲, 중앙 하단 STA/EL
//  · 부상방지저판은 측면 날개, 버림콘크리트는 기초 아래 얇은 선

import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { sectionGeom, haunchSize } from '../calc/sectionGeom.js';
import { elevationAt } from '../calc/alignment.js';
import { fmtSta } from '../core/model.js';

const CY = COLOR.CYAN;

/**
 * opts:
 *   names: true      치수에 변수명 표시
 *   dims: true       치수선
 *   sta: number      기준 Station (m) — EL 계산
 *   alignment        선형 데이터 (EL)
 *   alignName
 *   dx, dy           배치 이동 (mm)
 *   cross: fn(d, g)  차도부/측구 등 추가 그리기
 *   simple: true     치수/문자 없이 외곽만
 */
export function drawSection(d, c, bi = 0, opts = {}) {
    const g = sectionGeom(c, bi);
    const ox = opts.dx || 0, oy = opts.dy || 0;
    const T = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
    const th = d.textHeight;
    const st = { color: CY, layer: 'CONC' };

    // 버림콘크리트
    if (g.lean) {
        d.pline(T(g.lean.poly), { ...st, closed: true });
        if (g.H4 > 0) {
            // 측면벽체까지 버림 (기초하단에서 H4 높이)
            const lw = g.lean.w, lt = g.lean.t;
            d.pline(T([[g.baseX0 - lw, 0], [g.baseX0 - lw, g.H4], [g.baseX0 - lw + lt, g.H4], [g.baseX0 - lw + lt, 0]]), { ...st, closed: false });
            d.pline(T([[g.baseX1 + lw, 0], [g.baseX1 + lw, g.H4], [g.baseX1 + lw - lt, g.H4], [g.baseX1 + lw - lt, 0]]), { ...st, closed: false });
        }
    }
    // 외곽
    d.pline(T(g.outer), { ...st, closed: true });
    if (g.kind !== 'U') {
        // 원형기둥 면(벽체선)은 내공 다각형에서 빼고 아래 기둥 표현에서 그린다
        const roundX = g.walls.filter(w => w.kind === 'mid' && w.type === '원형기둥').flatMap(w => [w.x0, w.x1].map(x => ({ x, floor: w.floor })));
        const skip = (cell, a, b) => Math.abs(a[0] - b[0]) < 1e-6 && roundX.some(q => Math.abs(q.x - a[0]) < 1e-6 && (!q.floor || q.floor === cell.floor));
        for (const cell of g.cells) {
            if (!roundX.length) { d.pline(T(cell.poly), { ...st, closed: true }); continue; }
            const P = cell.poly;
            P.forEach((a, i) => { const b = P[(i + 1) % P.length]; if (!skip(cell, a, b)) d.line(a[0] + ox, a[1] + oy, b[0] + ox, b[1] + oy, st); });
        }
    }
    // 부상방지저판
    if (g.antiFloat) {
        d.pline(T(g.antiFloat.left), { ...st, closed: false });
        d.pline(T(g.antiFloat.right), { ...st, closed: false });
    }
    // 기둥 표현
    for (const w of g.walls) {
        if (w.kind !== 'mid') continue;
        const cellsOfFloor = g.cells.filter(cc => (w.floor ? cc.floor === w.floor : true));
        const left = cellsOfFloor[w.index], right = cellsOfFloor[w.index + 1];
        if (!left || !right) continue;
        const y0 = left.y0, y1 = left.y1;
        if (w.type !== '사각기둥' && w.type !== '원형기둥') continue;
        // 기둥에 붙은 헌치의 아래(위) 끝 높이
        const hs = g.kind === 'DOUBLE'
            ? ((g.sec.haunch2 || {})[w.floor === 2 ? 'upper' : 'lower'] || [])
            : (g.sec.haunch || []);
        const hL = hs[w.index] || {}, hR = hs[w.index + 1] || {};
        const hTop = Math.max(haunchSize(hL.UR).w, haunchSize(hR.UL).w);
        const hBot = Math.max(haunchSize(hL.LR).w, haunchSize(hR.LL).w);
        const yb = y0 + hBot, yt = y1 - hTop;
        // 기둥과 상·하부 헌치가 만나는 선
        if (yt > yb) {
            d.line(w.x0 + ox, yb + oy, w.x1 + ox, yb + oy, st);
            d.line(w.x0 + ox, yt + oy, w.x1 + ox, yt + oy, st);
        }
        if (w.type === '사각기둥') {
            // X 표시는 헌치 끝 사이에만 그린다
            if (yt > yb) {
                d.line(w.x0 + ox, yb + oy, w.x1 + ox, yt + oy, { ...st, dash: 'hidden' });
                d.line(w.x1 + ox, yb + oy, w.x0 + ox, yt + oy, { ...st, dash: 'hidden' });
            }
        } else if (w.type === '원형기둥') {
            // 원형기둥 외곽선 (헌치 끝 사이)
            if (yt > yb) {
                d.line(w.x0 + ox, yb + oy, w.x0 + ox, yt + oy, { ...st, layer: 'COL' });
                d.line(w.x1 + ox, yb + oy, w.x1 + ox, yt + oy, { ...st, layer: 'COL' });
            }
        }
    }
    // U형 중분대 / 절취 표시는 외곽에 포함됨

    if (opts.cross) opts.cross(d, g, ox, oy);
    if (opts.simple) return g;

    // ── 치수 ──
    const names = opts.names !== false;
    const sec = g.sec;
    const yTopDim = g.Htot + th * 3.2 + oy;
    const yTopDim2 = yTopDim + th * 2.6;
    if (opts.dims !== false) {
        // 상부 체인
        const topXs = [], topNames = [];
        if (g.kind === 'U') {
            const wt = g.WT;
            topXs.push(g.inner.x0 - wt, g.inner.x0);
            topNames.push('WT');
            if (g.median) { topXs.push(g.median.x0, g.median.x1); topNames.push('B1', 'Gw'); }
            topXs.push(g.inner.x1, g.inner.x1 + wt);
            topNames.push(g.median ? 'B2' : 'B1', 'WT');
        } else {
            const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 2) : g.cells;
            const left0 = g.kind === 'DOUBLE' ? g.W - g.W + (g.WL - g.WLu) : 0;
            topXs.push(left0);
            topNames.push('WL');
            cells.forEach((cc, i) => {
                topXs.push(cc.x0, cc.x1);
                topNames.push(`B${i + 1}`, i < cells.length - 1 ? `C${i + 1}` : 'WR');
            });
            topXs.push(g.kind === 'DOUBLE' ? g.W - (g.WR - g.WRu) : g.W);
        }
        const tx = dedupeSorted(topXs);
        for (let i = 0; i < tx.length - 1; i++) {
            d.dimH(tx[i] + ox, tx[i + 1] + ox, g.Htot + oy, yTopDim, undefined, { name: names ? topNames[i] : undefined });
        }
        d.dimH(tx[0] + ox, tx[tx.length - 1] + ox, g.Htot + oy, yTopDim2);

        // 좌우 체인
        const vy = [];
        const vn = [];
        if (g.lean) { vy.push(-g.lean.t); vn.push(''); }
        vy.push(0); vn.push('LT');
        if (g.kind === 'U') {
            vy.push(g.LT); vn.push('H1');
            vy.push(g.LT + g.H1); vn.push('H2');
            vy.push(g.LT + g.H1 + g.H2); vn.push('H3');
            vy.push(g.Htot);
        } else if (g.kind === 'DOUBLE') {
            vy.push(g.LT); vn.push('MH');
            vy.push(g.LT + g.MH); vn.push('MT');
            vy.push(g.LT + g.MH + g.MT); vn.push('');
            vy.push(g.LT + g.H); vn.push('UT');
            vy.push(g.Htot);
        } else {
            vy.push(g.LT); vn.push('H');
            vy.push(g.LT + g.H); vn.push('UT');
            vy.push(g.Htot);
        }
        const xl = g.baseX0 - (g.lean ? g.lean.w : 0) - th * 3 + ox;
        const xr = g.baseX1 + (g.lean ? g.lean.w : 0) + th * 3 + ox;
        // 치수 보조선 기준 x: 부상방지 키가 있으면 키 끝
        const xl0 = (g.antiFloat ? g.baseX0 : 0) + ox, xr0 = (g.antiFloat ? g.baseX1 : g.W) + ox;
        for (let i = 0; i < vy.length - 1; i++) {
            d.dimV(vy[i] + oy, vy[i + 1] + oy, xl0, xl, undefined, {});
            d.dimV(vy[i] + oy, vy[i + 1] + oy, xr0, xr, undefined, { name: names && vn[i] ? vn[i] : undefined });
        }
        d.dimV(vy[0] + oy, vy[vy.length - 1] + oy, xl0, xl - th * 2.6);
        d.dimV(vy[0] + oy, vy[vy.length - 1] + oy, xr0, xr + th * 2.6);

        // 하부 체인
        const yb = -(g.lean ? g.lean.t : 0) - th * 3.2 + oy;
        const bx = [];
        if (g.lean) bx.push(g.baseX0 - g.lean.w);
        bx.push(g.baseX0);
        if (g.antiFloat) bx.push(0);
        if (g.kind === 'U') {
            bx.push(g.inner.x0);
            if (g.median) bx.push(g.median.x0, g.median.x1);
            bx.push(g.inner.x1);
        } else {
            const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
            cells.forEach(cc => bx.push(cc.x0, cc.x1));
        }
        bx.push(g.W);
        if (g.antiFloat) bx.push(g.baseX1);
        if (g.lean) bx.push(g.baseX1 + g.lean.w);
        const bxs = dedupeSorted(bx);
        for (let i = 0; i < bxs.length - 1; i++) d.dimH(bxs[i] + ox, bxs[i + 1] + ox, -(g.lean ? g.lean.t : 0) + oy, yb);
        d.dimH(bxs[0] + ox, bxs[bxs.length - 1] + ox, -(g.lean ? g.lean.t : 0) + oy, yb - th * 2.6);
    }

    // ── 중심선 / EL / STA ──
    const offset = +c.offset || 0;
    const xAlign = g.cx - offset + ox;
    d.line(xAlign, -(g.lean ? g.lean.t : 0) - th * 1.5 + oy, xAlign, g.Htot + th * 1.5 + oy, { color: COLOR.RED, dash: 'center', layer: 'CENTER' });
    d.text(xAlign + th * 0.4, g.Htot + th * 1.0 + oy, opts.alignName || '선형1', { color: COLOR.GREEN, h: th * 0.8, align: 'left', layer: 'TEXT' });

    if (opts.sta != null) {
        const refEl = opts.alignment ? elevationAt(opts.alignment.vip, opts.sta) : 0;
        const toEl = (y) => refEl + (y - g.refY) / 1000;
        d.elMark(ox + th * 0.5, g.Htot + oy, toEl(g.Htot), { h: th * 0.75 });
        d.elMark(g.baseX0 + ox, oy, toEl(0), { h: th * 0.75, down: true, align: 'right' });
        // 중앙 하단: 하부슬래브 상면 기준점
        const yRef = g.refY + oy;
        d.line(xAlign, yRef, xAlign + th * 2, yRef + th * 2.2, { color: COLOR.RED, layer: 'DIM' });
        d.line(xAlign + th * 2, yRef + th * 2.2, xAlign + th * 9, yRef + th * 2.2, { color: COLOR.RED, layer: 'DIM' });
        d.text(xAlign + th * 2.3, yRef + th * 2.45, `STA. ${fmtSta(opts.sta)}`, { color: COLOR.GREEN, h: th * 0.75, align: 'left', layer: 'TEXT' });
        d.text(xAlign + th * 2.3, yRef + th * 1.95, `EL. ${toEl(g.refY).toFixed(3)}`, { color: COLOR.GREEN, h: th * 0.75, align: 'left', valign: 'top', layer: 'TEXT' });
    }
    return g;
}

function dedupeSorted(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const out = [];
    for (const v of s) if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v);
    return out;
}

/** 단면 크기에 맞는 문자 높이 */
export function sectionTextHeight(c, bi = 0) {
    const g = sectionGeom(c, bi);
    return Math.max(120, Math.min(400, Math.max(g.W, g.Htot) / 42));
}

/** 단면도 Drawing 하나를 만들어 반환 */
export function sectionDrawing(p, c, bi = 0, opts = {}) {
    const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
    const st = opts.sta != null ? opts.sta : c.startSta;
    drawSection(d, c, bi, { alignment: p.alignment, alignName: p.alignment.name, sta: st, ...opts });
    return d;
}

export { fmtLen };
