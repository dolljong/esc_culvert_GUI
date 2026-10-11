// planDraw.js - 평면도 / 종단면도 공용 그리기
//
// 평면 좌표: 선형 좌표(m) × 1000 = mm. 도면 x = 동(Y), y = 북(X).
// 종단 좌표: x = (Station - 기준) × 1000, y = EL × 1000 (mm).

import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { getHorizontal, offsetPoint, elevationAt } from '../calc/alignment.js';
import { jointStations, blocks, fmtSta } from '../core/model.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { getGround, layerPoints, LAYER_STYLE, LAYERS } from '../calc/ground.js';

const K = 1000;

/** 선형 평면 (파란 선, BP/EP 빨간 문자, 측점 눈금) */
export function drawAlignmentPlan(d, al, opts = {}) {
    const h = getHorizontal(al);
    const pts = h.samples.map(s => [s.x * K, s.y * K]);
    d.pline(pts, { color: COLOR.BLUE, layer: 'ALIGN', width: 1.5 });
    const th = d.textHeight;
    const name = al.name || '선형1';
    const p0 = h.samples[0], p1 = h.samples[h.samples.length - 1];
    d.text(p0.x * K, p0.y * K + th * 1.2, `BP(${name})`, { color: COLOR.RED, h: th, align: 'center', layer: 'ALIGN' });
    d.text(p1.x * K, p1.y * K + th * 1.2, `EP(${name})`, { color: COLOR.RED, h: th, align: 'center', layer: 'ALIGN' });
    // 측점 눈금
    const step = opts.tick || 20;
    const s0 = Math.ceil(h.startSta / step) * step;
    for (let s = s0; s <= h.startSta + h.length + 1e-6; s += step) {
        const p = h.pointAt(s);
        const nx = -Math.sin(p.th), ny = Math.cos(p.th);
        d.line(p.x * K, p.y * K, (p.x + nx * 0.0) * K + nx * th * 0.8, p.y * K + ny * th * 0.8, { color: COLOR.WHITE, layer: 'ALIGN' });
        d.line(p.x * K, p.y * K, p.x * K - nx * th * 0.8, p.y * K - ny * th * 0.8, { color: COLOR.CYAN, layer: 'ALIGN' });
        if (opts.staText !== false) {
            const ang = p.th * 180 / Math.PI;
            d.text(p.x * K + nx * th * 1.1, p.y * K + ny * th * 1.1, fmtSta(s).replace(/\.0$/, ''), { color: COLOR.WHITE, h: th * 0.55, rot: ang + 90, align: 'left', valign: 'middle', layer: 'ALIGN' });
        }
    }
    // IP 정보
    if (opts.ip) {
        for (const ip of h.ipInfo) {
            d.circle(ip.E * K, ip.N * K, th * 0.3, { color: COLOR.YELLOW, layer: 'IP' });
            d.text(ip.E * K, ip.N * K + th * 0.6, `${ip.name}${ip.R ? ` R=${ip.R}` : ''}`, { color: COLOR.YELLOW, h: th * 0.7, layer: 'IP' });
        }
    }
    return h;
}

/** 단면 폭 (mm): 외측벽 외면 사이 */
export function culvertWidth(c, bi = 0) {
    try { return sectionGeom(c, bi).W; } catch { return 10000; }
}

/**
 * 암거 평면 (외곽 하늘색, 신축이음, 내측벽면 초록 파선, 블록치수)
 * opts: dims(true), labels(true)
 */
export function drawCulvertPlan(d, p, c, opts = {}) {
    const al = p.alignment;
    const h = getHorizontal(al);
    const th = d.textHeight;
    const st = jointStations(c);
    if (st.length < 2) return;
    const off0 = (+c.offset || 0) / K;     // 암거중심 (m, 우측 +)
    const g = sectionGeom(c, 0);
    const half = g.W / 2 / K;
    // 이음 각도 (선형진행방향에서 반시계, 90 = 직각): 경사 이음선 끝점
    const jointPts = (sta, angle, side) => {
        // side: -1 좌측 외면, +1 우측 외면 (진행방향 기준)
        const a = (angle || 90) * Math.PI / 180;
        const cot = Math.abs(Math.sin(a)) < 1e-6 ? 0 : Math.cos(a) / Math.sin(a);
        // 좌측(진행 왼쪽)으로 갈수록 sta 가 +cot*w 만큼 이동
        const w = off0 + side * half;       // 우측 + 오프셋
        const s = sta - cot * w;
        const q = offsetPoint(h, s, w);
        return [q.x * K, q.y * K];
    };
    const edge = (side, s0, s1, a0, a1, style) => {
        const pts = [];
        const sa = jointPts(s0, a0, side), sb = jointPts(s1, a1, side);
        const w = off0 + side * half;
        const n = Math.max(2, Math.ceil((s1 - s0) / 1));
        pts.push(sa);
        for (let k = 1; k < n; k++) {
            const s = s0 + (s1 - s0) * k / n;
            const q = offsetPoint(h, s, w);
            pts.push([q.x * K, q.y * K]);
        }
        pts.push(sb);
        d.pline(pts, style);
    };
    const joints = c.joints || [];
    const bl = blocks(c);
    for (const b of bl) {
        const j0 = joints[b.index] || {}, j1 = joints[b.index + 1] || {};
        const g0 = (+j0.gap || 0) / 2 / K, g1 = (+j1.gap || 0) / 2 / K;
        const s0 = b.sta0 + (b.index > 0 ? g0 : 0), s1 = b.sta1 - (b.index < bl.length - 1 ? g1 : 0);
        const cy = { color: COLOR.CYAN, layer: 'CONC' };
        edge(-1, s0, s1, j0.angle, j1.angle, cy);
        edge(1, s0, s1, j0.angle, j1.angle, cy);
        const lineAcross = (s, ang, style) => d.line(...jointPts(s, ang, -1), ...jointPts(s, ang, 1), style);
        const startStyle = b.index === 0 && (+j0.angle || 90) !== 90 ? { color: COLOR.YELLOW, layer: 'CONC', width: 2 } : cy;
        lineAcross(s0, j0.angle, startStyle);
        lineAcross(s1, j1.angle, cy);
        // 내측 벽면 (초록 파선)
        const sg = sectionGeom(c, b.index);
        const faces = [];
        for (const w of sg.walls) {
            if (w.floor === 2) continue;
            if (w.kind === 'outer') faces.push(w.side === 'L' ? w.x1 : w.x0);
            else faces.push(w.x0, w.x1);
        }
        for (const fx of faces) {
            const side = (fx - sg.W / 2) / (sg.W / 2);
            const w = off0 + side * half;
            const a = jointPts(s0, j0.angle, side), bb = jointPts(s1, j1.angle, side);
            void w;
            d.line(a[0], a[1], bb[0], bb[1], { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        }
    }
    // 이름 상자
    if (opts.labels !== false) {
        const mid = (st[0] + st[st.length - 1]) / 2;
        const q = offsetPoint(h, mid, off0 - half);
        const ang = q.th * 180 / Math.PI;
        if (opts.nameBox) {
            d.text(q.x * K, q.y * K + th * 0.6, c.name, { color: COLOR.YELLOW, h: th, rot: ang, layer: 'TEXT' });
        }
    }
    if (opts.dims !== false) {
        // 상부: 시종점 태그 + 전체 + 블록 치수 (선형이 직선이라 가정한 투영 치수)
        const pS = offsetPoint(h, st[0], off0 - half), pE = offsetPoint(h, st[st.length - 1], off0 - half);
        const nx = -Math.sin(pS.th), ny = Math.cos(pS.th);
        const base = (q, k) => [q.x * K + nx * k, q.y * K + ny * k];
        d.dimA(base(pS, 0), base(pE, 0), th * 6, fmtLen((st[st.length - 1] - st[0]) * K));
        for (const b of bl) {
            const j0 = joints[b.index] || {}, j1 = joints[b.index + 1] || {};
            const g0 = b.index > 0 ? (+j0.gap || 0) / 2 : 0, g1 = b.index < bl.length - 1 ? (+j1.gap || 0) / 2 : 0;
            const a = jointPts(b.sta0 + g0 / K, j0.angle, -1), e = jointPts(b.sta1 - g1 / K, j1.angle, -1);
            d.dimA(a, e, th * 3, fmtLen(Math.hypot(e[0] - a[0], e[1] - a[1])));
            d.text((a[0] + e[0]) / 2 + nx * th * 2.0, (a[1] + e[1]) / 2 + ny * th * 2.0, `(BLOCK${b.index + 1})`, { color: COLOR.GREEN, h: th * 0.7, rot: pS.th * 180 / Math.PI, valign: 'top', layer: 'DIM' });
            if (b.index < bl.length - 1 && (+j1.gap || 0) > 0) {
                const f = jointPts(b.sta1 + g1 / K, j1.angle, -1);
                d.dimA(e, f, th * 3, String(+j1.gap));
            }
        }
        d.tag(...base(pS, th * 9), '암거시점', `STA. ${fmtSta(st[0])}`, { len: th * 1.5 });
        d.tag(...base(pE, th * 9), '암거종점', `STA. ${fmtSta(st[st.length - 1])}`, { len: th * 1.5 });
    }
}

/** 암거 중심선 (빨간 일점쇄선 + '선형중심') */
export function drawCenterLine(d, p, c, extra = 5) {
    const h = getHorizontal(p.alignment);
    const st = jointStations(c);
    const s0 = st[0] - extra, s1 = st[st.length - 1] + extra;
    const pts = [];
    for (let s = s0; s <= s1 + 1e-6; s += 1) { const q = h.pointAt(s); pts.push([q.x * K, q.y * K]); }
    d.pline(pts, { color: COLOR.RED, dash: 'center', layer: 'CENTER' });
    const q = h.pointAt(s0);
    d.text(q.x * K, q.y * K + d.textHeight * 0.4, '선형중심', { color: COLOR.GREEN, h: d.textHeight * 0.8, align: 'left', rot: q.th * 180 / Math.PI, layer: 'TEXT' });
}

// ── 종단면도 ──────────────────────────────────────────────────────────

/**
 * 종단면도: 암거 상·하단, 신축이음(번호 원 + 기준위치 태그), 지층선, EL 표시
 * 반환: { x(sta), y(el) } 변환 함수
 */
export function drawProfile(d, p, c, opts = {}) {
    const st = jointStations(c);
    const sta0 = st[0];
    const X = (sta) => (sta - sta0) * K;
    const Y = (el) => el * K;
    const th = d.textHeight;
    const al = p.alignment;
    const bl = blocks(c);

    // 암거 형상 (블록별 단면 높이)
    const topPts = [], botPts = [], leanPts = [];
    for (const b of bl) {
        const g = sectionGeom(c, b.index);
        for (const s of [b.sta0, b.sta1]) {
            const ref = elevationAt(al.vip, s);   // 하부슬래브 상면
            const bot = ref - g.refY / K;
            topPts.push([X(s), Y(bot + g.Htot / K)]);
            botPts.push([X(s), Y(bot)]);
            leanPts.push([X(s), Y(bot - (g.lean ? g.lean.t / K : 0))]);
        }
    }
    d.pline(topPts, { color: COLOR.CYAN, layer: 'CONC' });
    d.pline(botPts, { color: COLOR.CYAN, layer: 'CONC' });
    if (opts.lean !== false) d.pline(leanPts, { color: COLOR.CYAN, layer: 'CONC' });
    // 하부슬래브 상면 (흰 파선)
    const refPts = st.map(s => [X(s), Y(elevationAt(al.vip, s))]);
    d.pline(refPts, { color: COLOR.WHITE, dash: 'hidden', layer: 'HIDDEN' });

    const yMax = Math.max(...topPts.map(q => q[1]));
    const yMin = Math.min(...leanPts.map(q => q[1]));
    // 지층선
    if (opts.ground !== false) {
        const gr = getGround(c);
        for (const name of LAYERS) {
            if (!gr.use[name]) continue;
            const pts = layerPoints(gr.layers[name]);
            const sty = { ...LAYER_STYLE[name], layer: 'GROUND' };
            for (let i = 1; i < pts.length; i++) {
                if (pts[i].use === false) continue;
                d.line(X(pts[i - 1].sta), Y(pts[i - 1].el), X(pts[i].sta), Y(pts[i].el), sty);
            }
            if (pts.length) d.text(X(pts[0].sta) - th * 0.5, Y(pts[0].el), name, { color: COLOR.GREEN, h: th * 0.8, align: 'right', valign: 'middle', layer: 'TEXT' });
        }
    }
    // 신축이음: 번호 원, 기준위치 태그, 수직 파선, EL
    const yTag = Math.max(yMax, ...(opts.yTop != null ? [opts.yTop] : [])) + th * 4;
    st.forEach((s, i) => {
        d.line(X(s), yMin - th * 2, X(s), yTag, { color: COLOR.RED, dash: 'hidden', layer: 'JOINT' });
        d.bubble(X(s), yTag + th * 4.6, String(i + 1), { color: COLOR.GREEN, r: th * 0.7 });
        const lbl = i === 0 ? '암거시점' : i === st.length - 1 ? '암거종점' : `기준위치 ${i + 1}`;
        d.text(X(s), yTag + th * 2.6, opts.refLabels ? `기준위치 ${i + 1}` : lbl, { color: COLOR.GREEN, h: th * 0.75, layer: 'TEXT' });
        d.text(X(s), yTag + th * 1.5, `STA. ${fmtSta(s)}`, { color: COLOR.GREEN, h: th * 0.75, layer: 'TEXT' });
        if (opts.el !== false) {
            const top = topPts[Math.min(topPts.length - 1, i * 2 - (i > 0 ? 1 : 0))];
            const bot = botPts[Math.min(botPts.length - 1, i * 2 - (i > 0 ? 1 : 0))];
            if (top) d.elMark(X(s), top[1], top[1] / K, { h: th * 0.65 });
            if (bot) d.elMark(X(s), bot[1], bot[1] / K, { h: th * 0.65, down: true });
        }
    });
    // 블록 치수
    if (opts.dims !== false) {
        const yd = yTag - th * 1.2;
        for (const b of bl) {
            d.dimH(X(b.sta0), X(b.sta1), yMax, yd, fmtLen(b.length * K));
            d.text((X(b.sta0) + X(b.sta1)) / 2, yd - th * 0.3, `(BLOCK${b.index + 1})`, { color: COLOR.GREEN, h: th * 0.65, valign: 'top', layer: 'DIM' });
        }
    }
    return { X, Y, sta0, yMin, yMax };
}

export function newPlanDrawing(p, c) {
    // 문자 높이: 암거 길이 기준
    const st = c ? jointStations(c) : [0, 50];
    const L = Math.max(10, (st[st.length - 1] - st[0])) * K;
    return new Drawing({ textHeight: Math.max(150, Math.min(1500, L / 55)) });
}
