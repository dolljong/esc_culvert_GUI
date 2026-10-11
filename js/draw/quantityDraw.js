// quantityDraw.js - 수량산출서 삽도 (출력 > 수량산출서 확인창 / 출력된 삽도 보기 / DXF)
//
// quantityFigure(p, c, sheet, opts) → Drawing   sheet.fig = { type:'body'|'earth'|'wingI'|'wingW'|'approach'|'rebar', bi, key, idx, sta }
//   body    : 본체 단면 (콘크리트 해치 + 거푸집 면 번호)
//   earth   : 터파기 단면 (지층별 해치, 지표, 구조물) — opts.ground=false 이면 지층 해치 생략
//   wingI   : 일체식 날개벽 전개도,  wingW : 옹벽식 날개벽 단면 (시점/종점 행)
//   approach: 접속슬래브 종단면,     rebar : 본체 단면
// quantityFiguresDrawing(p, c, result, opts) → 모든 삽도를 격자로 배치한 Drawing (DXF 저장용)

import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from './sectionDraw.js';
import { sectionGeom, polyArea } from '../calc/sectionGeom.js';
import { formEdges, earthSection, clipBand, BASIS } from '../calc/quantity.js';
import { integralElevation, wallSection, defaultWallDim, WING_NAMES } from '../calc/wingGeom.js';
import { getApproach, approachSection } from '../calc/approachGeom.js';
import { fmtSta } from '../core/model.js';

const PART_NO = { wallOut: 1, wallIn: 2, mid: 3, slab: 4 };
const PART_TXT = ['외측벽체(외측)', '외측벽체(내측)', '기둥(중간벽체)', '슬래브/헌치'];
const SOIL_COLOR = { 토사: 6, 풍화암: 1, 연암: 30, 경암: 5 };

function bodyFigure(p, c, bi, o = {}) {
    const g = sectionGeom(c, bi);
    const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
    const th = d.textHeight;
    // 콘크리트 해치 (부재별 사각형 / 일반 단면은 외곽)
    if (g.kind === 'BOX') {
        d.hatch([[0, g.Htot - g.UT], [g.W, g.Htot - g.UT], [g.W, g.Htot], [0, g.Htot]], { color: 8, pattern: 'ansi31', layer: 'HATCH' });
        d.hatch([[0, 0], [g.W, 0], [g.W, g.LT], [0, g.LT]], { color: 8, pattern: 'ansi31', layer: 'HATCH' });
        for (const w of g.walls) d.hatch([[w.x0, g.LT], [w.x1, g.LT], [w.x1, g.Htot - g.UT], [w.x0, g.Htot - g.UT]], { color: 8, pattern: 'ansi31', layer: 'HATCH' });
    } else {
        d.hatch(g.outer, { color: 8, pattern: 'ansi31', layer: 'HATCH' });
    }
    if (g.antiFloat) { d.hatch(g.antiFloat.left, { color: 8, layer: 'HATCH' }); d.hatch(g.antiFloat.right, { color: 8, layer: 'HATCH' }); }
    if (g.lean) d.hatch(g.lean.poly, { color: 9, pattern: 'dots', layer: 'HATCH' });
    drawSection(d, c, bi, { alignment: p.alignment, alignName: p.alignment.name, sta: c.startSta, names: false });
    // 거푸집 면 번호
    const fe = formEdges(g, { basis: o.basis === BASIS[1] ? 1 : 0 });
    for (const e of fe) {
        const mx = (e.x0 + e.x1) / 2, my = (e.y0 + e.y1) / 2;
        const nx = e.nx, ny = e.ny;
        d.bubble(mx + nx * th * 1.0, my + ny * th * 1.0, String(PART_NO[e.part] || 0), { color: COLOR.YELLOW, r: th * 0.55 });
    }
    const y0 = (g.lean ? -g.lean.t : 0) - th * 7;
    PART_TXT.forEach((t, i) => d.text(g.W * 0.05 + (i % 2) * g.W * 0.5, y0 - Math.floor(i / 2) * th * 1.4, `(${i + 1}) 거푸집 - ${t}`, { color: COLOR.YELLOW, align: 'left', h: th * 0.8, layer: 'TEXT' }));
    d.text(g.W / 2, g.Htot + th * 7, `BLOCK ${bi + 1} 수량산출 단면`, { color: COLOR.WHITE, h: th * 1.1, layer: 'TEXT' });
    return d;
}

function earthFigure(p, c, bi, sta, o = {}) {
    const s = earthSection(p, c, bi, sta);
    const g = s.g;
    const d = new Drawing({ textHeight: Math.max(150, Math.min(500, (s.poly.length ? Math.max(...s.poly.map(q => q[0])) - Math.min(...s.poly.map(q => q[0])) : g.W) / 45)) });
    const th = d.textHeight;
    const showGround = o.ground !== false;
    if (showGround) {
        for (const b of s.bands) {
            const pts = clipBand(s.poly, b.ylo, b.yhi);
            if (!pts.length) continue;
            d.hatch(pts, { color: SOIL_COLOR[b.name] || 8, pattern: b.name === '토사' ? 'dots' : 'ansi31', alpha: 0.3, layer: 'HATCH' });
            const yt = Math.min(b.yhi, s.yG), yb = Math.max(isFinite(b.ylo) ? b.ylo : s.yB, s.yB);
            const xr = Math.max(...pts.map(q => q[0]));
            d.text(xr + th * 0.8, (yt + yb) / 2, `${b.name} A=${(b.area / 1e6).toFixed(3)} m²`, { color: SOIL_COLOR[b.name] || 7, align: 'left', valign: 'middle', layer: 'TEXT' });
            if (isFinite(b.ylo) && b.ylo > s.yB) d.line(Math.min(...pts.map(q => q[0])) - th * 2, b.ylo, xr + th * 2, b.ylo, { color: SOIL_COLOR[b.name] || 8, dash: 'dash', layer: 'GROUND' });
        }
    }
    if (s.poly.length) d.pline(s.poly, { color: COLOR.YELLOW, closed: true, layer: 'EXCAV' });
    // 지표
    const xs = s.poly.length ? s.poly.map(q => q[0]) : [g.baseX0, g.baseX1];
    const x0 = Math.min(...xs) - th * 4, x1 = Math.max(...xs) + th * 4;
    d.line(x0, s.yG, x1, s.yG, { color: COLOR.GREEN, layer: 'GROUND' });
    d.text(x0, s.yG + th * 0.4, `지표 EL. ${s.ex.groundEl.toFixed(3)}`, { color: COLOR.GREEN, align: 'left', layer: 'TEXT' });
    if (s.ex.gwl != null && showGround) {
        const yw = s.ex.toY(s.ex.gwl);
        d.line(x0, yw, x1, yw, { color: COLOR.GREEN, dash: 'dash', layer: 'GROUND' });
        d.text(x1, yw + th * 0.3, `지하수위 EL. ${s.ex.gwl.toFixed(3)}`, { color: COLOR.GREEN, align: 'right', layer: 'TEXT' });
    }
    drawSection(d, c, bi, { simple: true });
    // 터파기 치수
    if (s.poly.length) {
        const xb0 = s.poly.find(q => Math.abs(q[1] - s.yB) < 1e-6) || s.poly[0];
        d.dimV(s.yB, s.yG, x0 + th * 4, x0 + th * 1.5, fmtLen(s.yG - s.yB));
        const bot = s.poly.filter(q => Math.abs(q[1] - s.yB) < 1e-6).map(q => q[0]);
        if (bot.length >= 2) d.dimH(Math.min(...bot), Math.max(...bot), s.yB, s.yB - th * 2.5);
        void xb0;
    }
    d.text((x0 + x1) / 2, s.yG + th * 3, `터파기 단면  STA. ${fmtSta(sta)}  (BLOCK ${bi + 1})`, { color: COLOR.WHITE, h: th * 1.1, layer: 'TEXT' });
    d.text((x0 + x1) / 2, s.yB - th * 5, `터파기 A=${(s.excArea / 1e6).toFixed(3)} m²   구조물 A=${(s.structArea / 1e6).toFixed(3)} m²   되메우기 A=${(s.backArea / 1e6).toFixed(3)} m²`, { color: COLOR.YELLOW, layer: 'TEXT' });
    return d;
}

function wingIFigure(c, key) {
    const el = integralElevation(c, key);
    const d = new Drawing({ textHeight: Math.max(120, Math.max(el.L1, el.hRoot) / 40) });
    const th = d.textHeight;
    d.hatch(el.poly, { color: 8, layer: 'HATCH' });
    d.pline(el.poly, { color: COLOR.CYAN, closed: true, layer: 'CONC' });
    d.dimH(0, el.L1, 0, -th * 2.5);
    d.dimV(0, el.hRoot, 0, -th * 2.5);
    d.dimV(0, el.hTip, el.L1, el.L1 + th * 2.5);
    d.text(el.L1 / 2, el.hRoot + th * 2, `${WING_NAMES[key]} 일체식 날개벽 전개도  A=${(polyArea(el.poly) / 1e6).toFixed(3)} m²`, { color: COLOR.WHITE, h: th * 1.1, layer: 'TEXT' });
    return d;
}

function wingWFigure(c, key) {
    const dim = (c.wings && c.wings.dim && c.wings.dim[key] && c.wings.dim[key].wall) || defaultWallDim(c);
    const rows = dim.rows && dim.rows.length ? dim.rows : defaultWallDim(c).rows;
    const s0 = wallSection(rows[0]), s1 = wallSection(rows[1] || rows[0]);
    const d = new Drawing({ textHeight: Math.max(120, Math.max(s0.W, s0.WH) / 35) });
    const th = d.textHeight;
    const gap = Math.max(s0.W, s1.W) + th * 10;
    [[s0, '시점부', 0], [s1, '종점부', gap]].forEach(([s, nm, dx]) => {
        const T = (pts) => pts.map(([x, y]) => [x + dx, y]);
        d.hatch(T(s.poly), { color: 8, layer: 'HATCH' });
        d.pline(T(s.poly), { color: COLOR.CYAN, closed: true, layer: 'CONC' });
        if (s.key) d.pline(T(s.key), { color: COLOR.CYAN, closed: true, layer: 'CONC' });
        if (s.lean) d.pline(T(s.lean), { color: COLOR.CYAN, closed: true, layer: 'CONC' });
        d.dimH(dx, dx + s.W, 0, -th * 3.5);
        d.dimV(0, s.WH, dx + s.W, dx + s.W + th * 2.5);
        d.text(dx + s.W / 2, s.WH + th * 2, `${nm}  A=${(polyArea(s.poly) / 1e6).toFixed(4)} m²`, { color: COLOR.WHITE, layer: 'TEXT' });
    });
    d.text(gap / 2, Math.max(s0.WH, s1.WH) + th * 4.5, `${WING_NAMES[key]} 옹벽식 날개벽 단면`, { color: COLOR.WHITE, h: th * 1.2, layer: 'TEXT' });
    return d;
}

function approachFigure(c, idx) {
    const a = getApproach(c).list[idx];
    const g = sectionGeom(c, 0);
    const sec = approachSection(c, a, g);
    const d = new Drawing({ textHeight: Math.max(100, sec.Ltot / 40) });
    const th = d.textHeight;
    d.hatch(sec.slab, { color: 8, layer: 'HATCH' });
    d.pline(sec.slab, { color: COLOR.CYAN, closed: true, layer: 'CONC' });
    d.pline(sec.bracket, { color: COLOR.CYAN, closed: true, layer: 'CONC' });
    d.line(0, sec.yBr - 2000, 0, g.Htot, { color: COLOR.CYAN, layer: 'CONC' });
    d.dimH(sec.x0, sec.x1, Math.min(...sec.slab.map(q => q[1])), Math.min(...sec.slab.map(q => q[1])) - th * 3);
    d.text((sec.x0 + sec.x1) / 2, sec.topNear + th * 2.5, `접속슬래브${idx + 1} (${a.side})  A=${(polyArea(sec.slab) / 1e6).toFixed(4)} m²`, { color: COLOR.WHITE, h: th * 1.1, layer: 'TEXT' });
    return d;
}

/** 시트의 삽도 */
export function quantityFigure(p, c, sheet, opts = {}) {
    const f = (sheet && sheet.fig) || { type: 'body', bi: 0 };
    switch (f.type) {
        case 'earth': return earthFigure(p, c, f.bi | 0, f.sta != null ? f.sta : c.startSta, opts);
        case 'wingI': return wingIFigure(c, f.key);
        case 'wingW': return wingWFigure(c, f.key);
        case 'approach': return approachFigure(c, f.idx | 0);
        default: return bodyFigure(p, c, f.bi | 0, opts);
    }
}

/** 삽도 목록 [{ no, title, drawing }] (산출근거 시트마다 하나, 토공은 블록 시·종점 두 단면) */
export function quantityFigures(p, c, result, opts = {}) {
    const out = [];
    const o = { basis: result.opts.basis, ground: result.opts.groundFig, ...opts };
    for (const s of result.sheets) {
        if (s.kind !== '산근' || !s.fig) continue;
        if (opts.sheets && !opts.sheets.includes(s.id)) continue;
        try {
            if (s.fig.type === 'earth' && s.sections) {
                for (const sec of s.sections) out.push({ no: out.length + 1, title: `${s.name} - STA. ${fmtSta(sec.sta)}`, drawing: earthFigure(p, c, s.fig.bi, sec.sta, o) });
            } else out.push({ no: out.length + 1, title: s.name, drawing: quantityFigure(p, c, s, o) });
        } catch (e) { console.warn('[quantityDraw]', s.id, e); }
    }
    return out;
}

/** 모든 삽도를 격자로 한 Drawing 에 (DXF) */
export function quantityFiguresDrawing(figs) {
    const out = new Drawing({ textHeight: 250 });
    let x = 0, y = 0, rowH = 0, col = 0;
    for (const f of figs) {
        const bb = f.drawing.bbox();
        if (!bb) continue;
        const sc = 1;
        out.merge(f.drawing, x - bb.minX, y - bb.maxY, sc);
        out.text(x + bb.w / 2, y + 400, `[Pic ${f.no}] ${f.title}`, { color: COLOR.WHITE, h: 300, layer: 'TEXT' });
        rowH = Math.max(rowH, bb.h + 1500);
        x += bb.w + 3000;
        if (++col >= 3) { col = 0; x = 0; y -= rowH; rowH = 0; }
    }
    return out;
}
