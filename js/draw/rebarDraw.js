// rebarDraw.js - 배근 도면 (주철근/수평철근/헌치철근 입력결과 확인창 공용)
//
// 매뉴얼 5.2.2 색 규칙: 콘크리트 하늘색, 철근 자홍(현재 Cycle) / 빨강(다른 Cycle), 치수선 빨강 + 문자 초록,
// 철근기호 빨간 원 + 초록 문자, 부재력도 하늘색.
// 좌표는 sectionGeom 단면 좌표 (mm). 철근 형상은 calc/rebar.js 의 mainBarLayout 결과를 그린다.

import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from './sectionDraw.js';
import { frameAxes } from '../calc/sectionGeom.js';
import { mainBarLayout, pointAt, barInfo, coverOf, barD, faceRefSpan } from '../calc/rebar.js';

export const BAR_COLOR = 6;      // 자홍
export const OTHER_COLOR = 1;    // 빨강

/** 꺾인점을 반지름 R 원호(분할)로 둥글린 표시용 점열 */
export function filletPts(pts, R, seg = 4) {
    if (!R || pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
        const a = [p0[0] - p1[0], p0[1] - p1[1]], b = [p2[0] - p1[0], p2[1] - p1[1]];
        const la = Math.hypot(...a), lb = Math.hypot(...b);
        if (la < 1e-6 || lb < 1e-6) { out.push(p1); continue; }
        const ua = [a[0] / la, a[1] / la], ub = [b[0] / lb, b[1] / lb];
        const cos = ua[0] * ub[0] + ua[1] * ub[1];
        const th = Math.acos(Math.max(-1, Math.min(1, cos)));     // 끼인각
        if (th > Math.PI - 1e-3) { out.push(p1); continue; }
        const r = Math.min(R, Math.min(la, lb) * 0.45 * Math.tan(th / 2));
        const t = r / Math.tan(th / 2);
        const s = [p1[0] + ua[0] * t, p1[1] + ua[1] * t], e = [p1[0] + ub[0] * t, p1[1] + ub[1] * t];
        const bis = [ua[0] + ub[0], ua[1] + ub[1]], lbis = Math.hypot(...bis);
        const dc = r / Math.sin(th / 2);
        const cen = [p1[0] + bis[0] / lbis * dc, p1[1] + bis[1] / lbis * dc];
        const a0 = Math.atan2(s[1] - cen[1], s[0] - cen[0]);
        let a1 = Math.atan2(e[1] - cen[1], e[0] - cen[0]);
        let da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        for (let k = 0; k <= seg; k++) {
            const ang = a0 + da * k / seg;
            out.push([cen[0] + r * Math.cos(ang), cen[1] + r * Math.sin(ang)]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

const off = (pts, v, k) => pts.map(([x, y]) => [x + v[0] * k, y + v[1] * k]);

/**
 * 주철근 그리기.
 * opts: { color, colorOf(bar), lapOffset (겹이음 구분용 간격, mm), layer:'REBAR' }
 */
export function drawBars(d, layout, bars, opts = {}) {
    const k = opts.lapOffset ?? d.textHeight * 0.12;
    for (const b of bars) {
        const f = layout.faces.find(x => x.cycle === b.cycle && x.layer === b.layer && x.member === b.member && x.face === b.face);
        const inw = f ? f.line.inward : [0, 0];
        const color = opts.colorOf ? opts.colorOf(b) : (opts.color ?? BAR_COLOR);
        const pts = b.piece % 2 === 1 ? off(b.pts, inw, k) : b.pts;
        d.pline(filletPts(pts, b.bendR), { color, layer: opts.layer || 'REBAR', tip: `${b.mark || ''} ${b.dia} L=${fmtLen(b.length)}` });
    }
}

/** 가장 긴 선분의 중점 */
function anchorOf(b) {
    let best = 0, bi = 1;
    for (let i = 1; i < b.pts.length; i++) {
        const L = Math.hypot(b.pts[i][0] - b.pts[i - 1][0], b.pts[i][1] - b.pts[i - 1][1]);
        if (L > best) { best = L; bi = i; }
    }
    const a = b.pts[bi - 1], c = b.pts[bi];
    return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
}

/**
 * 철근기호 (빨간 원 + 초록 문자, 직경, L=길이) 와 지시선.
 * opts: { useInputName (UR1 등 입력문자), dist (철근에서 원까지 거리) }
 */
export function drawBarMarks(d, layout, bars, opts = {}) {
    const th = d.textHeight;
    const placed = [];
    for (const b of bars) {
        const f = layout.faces.find(x => x.cycle === b.cycle && x.layer === b.layer && x.member === b.member && x.face === b.face);
        if (!f) continue;
        const out = [-f.line.inward[0], -f.line.inward[1]];
        const cov = coverOf(layout.settings, b.member, b.face, b.layer);
        const a = anchorOf(b);
        let dist = cov + th * 1.6 + (opts.dist || 0);
        let p = [a[0] + out[0] * dist, a[1] + out[1] * dist];
        // 겹침 회피
        for (let tries = 0; tries < 6 && placed.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < th * 2.2); tries++) {
            if (f.line.axis === 'x') p = [p[0] + th * 2.4, p[1]]; else p = [p[0], p[1] - th * 2.4];
        }
        placed.push(p);
        const r = th * 0.7;
        d.line(a[0], a[1], p[0] - out[0] * r, p[1] - out[1] * r, { color: COLOR.RED, layer: 'MARK' });
        d.bubble(p[0], p[1], opts.useInputName ? b.name : (b.mark || b.name), { r, color: COLOR.RED, textColor: COLOR.GREEN });
        const h = th * 0.65;
        d.text(p[0] + r * 1.3, p[1] + h * 0.1, b.dia, { color: COLOR.GREEN, h, align: 'left', valign: 'bottom', layer: 'MARK' });
        d.text(p[0] + r * 1.3, p[1] - h * 0.2, `L=${fmtLen(b.length)}`, { color: COLOR.GREEN, h, align: 'left', valign: 'top', layer: 'MARK' });
    }
}

/**
 * 이음위치 치수 체인 (80 | 420 | UD1 | UD2 | ... | 420 | 80).
 * face: layout.faces 항목. opts: { names (변수명 표시), dist (면에서 치수선까지), highlight: k }
 */
export function drawLapChain(d, layout, face, opts = {}) {
    const g = layout.g, th = d.textHeight;
    const L = face.line;
    const span = faceRefSpan(g, face.member);
    const pos = [];
    let acc = 0;
    for (let k = 0; k < face.data.n; k++) { acc += +face.data.D[k] || 0; pos.push(acc); }
    const axisV = (s) => { const q = pointAt(L.path, s - L.s0).pt; return L.axis === 'x' ? q[0] : q[1]; };
    // 외면 (콘크리트 끝)
    let e0, e1;
    if (L.axis === 'x') {
        const st = g.kind === 'DOUBLE' && face.member === 'top' ? [g.WL - g.WLu, g.WR - g.WRu] : [0, 0];
        e0 = st[0]; e1 = g.W - st[1];
    } else {
        e0 = g.Htot; e1 = 0;
        if (g.kind === 'DOUBLE' && /^mid:/.test(face.member)) e0 = g.LT + g.MH + g.MT;
        if (g.kind === 'DOUBLE' && /^midU:/.test(face.member)) e1 = g.LT + g.MH;
    }
    const vals = [{ v: e0 }, { v: axisV(L.s0) }, { v: axisV(0) }];
    pos.forEach((s, k) => vals.push({ v: axisV(s), name: `${face.labels.D}${k + 1}` }));
    vals.push({ v: axisV(span) }, { v: axisV(L.s1) }, { v: e1 });
    // 정렬 (진행방향 유지, 중복 제거)
    const dir = L.axis === 'x' ? 1 : -1;
    const seq = [];
    for (const it of vals) {
        const last = seq[seq.length - 1];
        if (last && Math.abs(last.v - it.v) < 1e-6) { if (it.name) last.name = it.name; continue; }
        seq.push(it);
    }
    seq.sort((a, b) => dir * (a.v - b.v));
    const out = [-L.inward[0], -L.inward[1]];
    const cov = coverOf(layout.settings, face.member, face.face, face.layer);
    const dist = cov + th * (opts.dist ?? 3.8);
    const ref = pointAt(L.path, -L.s0).pt;
    if (L.axis === 'x') {
        const yRef = ref[1] + out[1] * cov, yDim = ref[1] + out[1] * dist;
        for (let i = 0; i < seq.length - 1; i++) {
            const name = seq[i + 1].name && opts.names !== false ? seq[i + 1].name : undefined;
            d.dimH(seq[i].v, seq[i + 1].v, yRef, yDim, undefined, { name, h: th * 0.7 });
        }
    } else {
        const xRef = ref[0] + out[0] * cov, xDim = ref[0] + out[0] * dist;
        for (let i = 0; i < seq.length - 1; i++) {
            const name = seq[i + 1].name && opts.names !== false ? seq[i + 1].name : undefined;
            d.dimV(seq[i + 1].v, seq[i].v, xRef, xDim, undefined, { name, h: th * 0.7 });
        }
    }
}

/** 이음 위치 표시 (빨간 짧은 선) */
export function drawSpliceTicks(d, layout, splices, opts = {}) {
    const th = d.textHeight;
    for (const s of splices) {
        const f = layout.faces.find(x => x.cycle === s.cycle && x.layer === s.layer && x.member === s.member && x.face === s.face);
        if (!f) continue;
        const n = f.line.inward;
        const a = s.pt;
        d.line(a[0] - n[0] * th * 0.4, a[1] - n[1] * th * 0.4, a[0] + n[0] * th * 0.4, a[1] + n[1] * th * 0.4, { color: opts.color ?? COLOR.RED, layer: 'MARK' });
    }
}

/**
 * 부재력도 (BMD/SFD). forces: [{ group, pts:[[x(m, 부재군 시점부터), value], ...] }]
 * 슬래브는 아래(+)로, 벽은 안쪽으로 그린다. 값 문자는 하늘색.
 */
export function drawForceDiagram(d, g, forces, opts = {}) {
    const ax = frameAxes(g);
    const th = d.textHeight;
    let vmax = 0;
    for (const f of forces) for (const [, v] of f.pts) vmax = Math.max(vmax, Math.abs(v));
    if (!(vmax > 0)) return;
    const scale = (opts.size || Math.max(g.W, g.Htot) * 0.12) / vmax;
    const st = { color: COLOR.CYAN, layer: 'FORCE' };
    for (const f of forces) {
        let base, nrm;
        if (f.group === 'top' || f.group === 'bottom' || f.group === 'mid') {
            const y = f.group === 'top' ? ax.yTop : f.group === 'bottom' ? ax.yBot : ax.yMid;
            base = (x) => [ax.xs[0] + x * 1000, y];
            nrm = [0, -1];
        } else {
            let xw;
            if (f.group === 'left') xw = ax.xs[0];
            else if (f.group === 'right') xw = ax.xs[ax.xs.length - 1];
            else { const m = /mid:(\d+)/.exec(f.group); xw = m ? ax.xs[+m[1] + 1] : null; }
            if (xw == null) continue;
            base = (x) => [xw, ax.yBot + x * 1000];
            nrm = f.group === 'right' ? [-1, 0] : [1, 0];
        }
        const outline = f.pts.map(([x, v]) => { const b = base(x); return [b[0] + nrm[0] * v * scale, b[1] + nrm[1] * v * scale]; });
        const b0 = base(f.pts[0][0]), b1 = base(f.pts[f.pts.length - 1][0]);
        d.pline([b0, ...outline, b1], st);
        const step = Math.max(1, Math.floor(f.pts.length / 24));
        for (let i = 0; i < f.pts.length; i += step) {
            const b = base(f.pts[i][0]);
            d.line(b[0], b[1], outline[i][0], outline[i][1], st);
        }
        // 극값 문자
        let iMax = 0, iMin = 0;
        f.pts.forEach(([, v], i) => { if (v > f.pts[iMax][1]) iMax = i; if (v < f.pts[iMin][1]) iMin = i; });
        const lbl = new Set([0, f.pts.length - 1, iMax, iMin]);
        for (const i of lbl) {
            const q = outline[i];
            d.text(q[0] + nrm[0] * th * 0.3, q[1] + nrm[1] * th * 0.3, f.pts[i][1].toFixed(3), { color: COLOR.CYAN, h: th * 0.55, rot: nrm[0] ? 90 : 0, layer: 'FORCE' });
        }
    }
}

/**
 * 주철근 입력 화면 도면.
 * opts: { cycle (현재 Cycle), zone, layer, member, face, showAll (모든 철근Mark), inputName,
 *         allLaps (전체 이음표기, 4Cycle), forces (drawForceDiagram 입력), unfold (전개도), blockLen (mm) }
 */
export function mainRebarDrawing(p, c, bi, opts = {}) {
    const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
    drawSection(d, c, bi, { simple: true });
    const cyc = opts.cycle || 1;
    const lay = mainBarLayout(p, c, bi, { zone: opts.zone, cycles: opts.allLaps ? undefined : [cyc] });
    const cur = (x) => x.cycle === cyc;
    const bars = lay.bars;
    drawBars(d, lay, bars, { colorOf: (b) => (cur(b) ? BAR_COLOR : OTHER_COLOR) });
    const isCurMem = (x) => x.member === opts.member;
    const marked = bars.filter(b => cur(b) && (opts.showAll || (isCurMem(b) && b.layer === (opts.layer || 1))));
    drawSpliceTicks(d, lay, lay.splices.filter(s => (opts.allLaps || cur(s)) && (opts.showAll || isCurMem(s))));
    for (const f of lay.faces.filter(x => cur(x) && isCurMem(x) && x.layer === (opts.layer || 1))) drawLapChain(d, lay, f, { names: true });
    drawBarMarks(d, lay, marked, { useInputName: opts.inputName !== false && !opts.showAll });
    if (opts.forces && opts.forces.length) drawForceDiagram(d, lay.g, opts.forces);
    if (opts.unfold && opts.member) drawUnfold(d, lay, opts);
    d.legend = `${cyc}Cycle`;
    return { d, layout: lay };
}

/**
 * 입력부 전개도: 단면 위쪽 노란 틀 안에 현재 부재의 평면 철근망 (부재 길이 × 블록 길이).
 */
export function drawUnfold(d, lay, opts) {
    const g = lay.g, th = d.textHeight;
    const faces = lay.faces.filter(f => f.member === opts.member && f.layer === (opts.layer || 1) && f.face === (opts.face || f.face));
    if (!faces.length) return;
    const Lmem = Math.max(...faces.map(f => f.line.len));
    const Lb = Math.min(opts.blockLen || 10000, Lmem * 1.2);
    const x0 = 0, y0 = g.Htot + th * 9;
    d.rect(x0 - th, y0 - th, Lmem + 2 * th, Lb + 2 * th, { color: COLOR.YELLOW, layer: 'FRAME' });
    d.rect(x0, y0, Lmem, Lb, { color: COLOR.CYAN, layer: 'CONC' });
    const ctc = +lay.settings.ctc || 250;
    const f0 = faces[0];
    const bars = lay.bars.filter(b => b.member === opts.member && b.face === f0.face && b.layer === f0.layer);
    const cycles = [...new Set(bars.map(b => b.cycle))].sort();
    const step = ctc / Math.max(1, cycles.length);
    let row = 0;
    for (let y = step / 2; y < Lb; y += step, row++) {
        const cyc = cycles[row % cycles.length];
        for (const b of bars.filter(x => x.cycle === cyc)) {
            const a = b.sFrom - f0.line.s0, e = b.sTo - f0.line.s0;
            d.line(x0 + a, y0 + y + (b.piece % 2) * th * 0.1, x0 + e, y0 + y + (b.piece % 2) * th * 0.1, { color: cyc === opts.cycle ? BAR_COLOR : OTHER_COLOR, layer: 'REBAR' });
        }
    }
    d.dimH(x0, x0 + Lmem, y0 + Lb, y0 + Lb + th * 1.5);
    d.dimV(y0, y0 + Lb, x0, x0 - th * 2.5);
    d.text(x0 + Lmem / 2, y0 + Lb + th * 3.2, `전개도 (${opts.memberTitle || opts.member})`, { color: COLOR.YELLOW, h: th * 0.8 });
}

/**
 * 수평철근(배력철근) 점 표시.
 * dots: [{ pt:[x,y], color }], r: 반지름
 */
export function drawDots(d, dots, r) {
    for (const q of dots) d.circle(q.pt[0], q.pt[1], r, { color: q.color ?? BAR_COLOR, fill: q.color ?? BAR_COLOR, layer: 'REBAR' });
}

export { barInfo, barD };
