// girderDraw.js - 종방향 거더 종단 (기둥·하중·경간 치수) + 휨모멘트도/전단력도
// g: calc/girder.js girderCheck 결과

import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';

const f = (v, n = 1) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(n));

/** 거더 종단 + BMD/SFD */
export function girderDrawing(g, diag = 'BMD') {
    const L = g.layout.L;
    const d = new Drawing({ textHeight: Math.max(120, L / 60) });
    const th = d.textHeight;
    const hh = g.h;
    const cy = { color: COLOR.YELLOW, layer: 'CONC' };
    // 거더 + 기둥
    d.rect(0, 0, L, hh, cy);
    const colH = hh * 2.5;
    const top = g.mem !== 'bottom';
    for (const q of g.layout.cols) {
        const y0 = top ? -colH : hh, y1 = top ? 0 : hh + colH;
        d.line(q.u - q.t / 2, y0, q.u - q.t / 2, y1, cy);
        d.line(q.u + q.t / 2, y0, q.u + q.t / 2, y1, cy);
        d.line(q.u, y0 - th * 0.5, q.u, y1 + th * 0.5, { color: COLOR.RED, layer: 'CENTER', dash: 'center' });
    }
    // 하중
    const wy = top ? hh + th * 1.2 : -th * 1.2;
    const arrow = top ? -1 : 1;
    for (let u = 0; u <= L + 1; u += L / 20) {
        d.line(u, wy, u, wy + arrow * th * 0.9, { color: COLOR.GREEN, layer: 'LOAD' });
    }
    d.line(0, wy, L, wy, { color: COLOR.GREEN, layer: 'LOAD' });
    d.text(L / 2, top ? wy + th * 0.4 : wy - th * 1.6, `w = ${f(g.ult && g.ult.wMax, 2)} kN/m (${g.ult ? g.ult.at : '-'})`, { color: COLOR.GREEN, h: th, layer: 'LOAD' });
    // 지점 치수
    const xs = [0, ...g.layout.cols.map(q => q.u), L];
    const yd = top ? -colH - th * 2 : hh + colH + th * 2;
    for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > 1) d.dimH(xs[i], xs[i + 1], top ? -colH : hh + colH, yd, fmtLen(xs[i + 1] - xs[i]), { h: th * 0.8 });
    // 단면력도
    const w = g.ult ? g.ult.wMax : 0;
    const vals = g.beam.xs.map((_, i) => g.sgn * w * g.beam.m[i]);
    // 전단력도: 부재마다 시·종점 두 점 → 지점(집중반력)에서 수직으로 뛴다
    const sfd = [];
    g.beam.vSeg.forEach(([v1, v2], i) => { sfd.push([g.beam.xs[i], g.sgn * w * v1], [g.beam.xs[i + 1], g.sgn * w * v2]); });
    const vmax = Math.max(1e-9, ...(diag === 'BMD' ? vals : sfd.map(q => q[1])).map(Math.abs));
    const base = top ? -colH - th * 8 : -th * 8;
    const amp = Math.max(hh * 2, L / 8);
    // BMD 는 인장측(하면 인장 +)을 아래로 그린다
    const sc = (diag === 'BMD' ? -1 : 1) * amp / vmax;
    const pts = diag === 'BMD' ? g.beam.xs.map((x, i) => [x * 1000, base + vals[i] * sc]) : sfd.map(([x, v]) => [x * 1000, base + v * sc]);
    const col = diag === 'BMD' ? COLOR.MAGENTA : COLOR.CYAN;
    d.line(0, base, L, base, { color: COLOR.WHITE, layer: 'DIAG' });
    d.pline([[0, base], ...pts, [L, base]], { color: col, layer: 'DIAG' });
    // 극값 표기
    const marks = [];
    if (diag === 'BMD') vals.forEach((v, i) => {
        if (i === 0 || i === vals.length - 1) return;
        if (Math.abs(v) >= Math.abs(vals[i - 1]) && Math.abs(v) >= Math.abs(vals[i + 1]) && Math.abs(v) > vmax * 0.05) marks.push(i);
    });
    for (const i of marks) {
        const [x, y] = pts[i];
        d.text(x, y + Math.sign(vals[i] * sc || 1) * th * 0.3, f(vals[i], 1), { color: COLOR.WHITE, h: th * 0.8, layer: 'DIAG', valign: vals[i] * sc >= 0 ? 'bottom' : 'top' });
    }
    if (diag === 'SFD') {
        g.beam.supNodes.forEach((nd, k) => {
            const x = g.beam.xs[nd] * 1000;
            for (const [v, dx] of [[g.beam.vL[k], -1], [g.beam.vR[k], 1]]) {
                const val = g.sgn * w * v;
                d.text(x + dx * th * 1.5, base + val * sc, f(val, 1), { color: COLOR.WHITE, h: th * 0.8, layer: 'DIAG' });
            }
        });
    }
    d.text(L / 2, base - amp - th * 2, `${g.title} ${diag === 'BMD' ? '휨모멘트도 (kN·m)' : '전단력도 (kN)'} — 극한 최대 하중 기준`, { color: COLOR.WHITE, h: th, layer: 'TEXT' });
    d.legend = `${g.title} ${diag}`;
    return d;
}
