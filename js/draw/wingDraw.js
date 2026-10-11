// wingDraw.js - 날개벽 도면 (평면 / 일체식 전개도 / 옹벽식 단면·전개도)
//
// 색 규칙: 일체식 = 하늘색 벽체 외곽, 옹벽식(평면) = 노란 단선, 각도 호 빨강 + 초록 문자,
// 치수선 빨강 + 치수문자 초록, 변수명 노랑(클릭 시 입력셀 이동).

import { COLOR, fmtLen } from '../cad/drawing.js';
import { installedWings, wingPlan, integralElevation, wallSection, culvertTopEl, WING_LABELS } from '../calc/wingGeom.js';

const CY = { color: COLOR.CYAN, layer: 'CONC' };

function ang(v) { return Math.atan2(v[1], v[0]) * 180 / Math.PI; }

/**
 * 평면에 설치된 날개벽을 그린다 (drawCulvertPlan 위에 덧그림).
 * opts: dims(true), names(true), only: key (해당 날개벽만 강조)
 */
export function drawWingsPlan(d, p, c, opts = {}) {
    const th = d.textHeight;
    const out = [];
    for (const w of installedWings(c)) {
        const wp = wingPlan(p, c, w.key);
        const T = wp.frame.toG;
        const G = (q) => T(q[0], q[1]);
        const hl = opts.only && opts.only !== w.key;
        if (w.type === '옹벽식') {
            d.line(...G(wp.root), ...G(wp.tip), { color: hl ? COLOR.GRAY : COLOR.YELLOW, layer: 'WING', width: 2 });
        } else {
            d.pline([G(wp.backRoot), G(wp.backTip), G(wp.tip), G(wp.root)], { color: hl ? COLOR.GRAY : COLOR.CYAN, layer: 'WING' });
            if (wp.haunch) d.line(...G(wp.haunch[0]), ...G(wp.haunch[1]), { color: hl ? COLOR.GRAY : COLOR.CYAN, layer: 'WING' });
        }
        out.push(wp);
        if (opts.dims === false || hl) continue;
        const [side, lr] = [WING_LABELS[w.key][0], WING_LABELS[w.key][1]];
        // 각도 호: 본체 벽 방향(암거 안쪽) → 날개벽 방향
        const r0 = G(wp.root);
        const wallDirL = w.key[0] === 'S' ? [1, 0] : [-1, 0];
        const gw = G([wp.root[0] + wallDirL[0], wp.root[1] + wallDirL[1]]);
        const gd = G([wp.root[0] + wp.dir[0], wp.root[1] + wp.dir[1]]);
        let a0 = ang([gw[0] - r0[0], gw[1] - r0[1]]), a1 = ang([gd[0] - r0[0], gd[1] - r0[1]]);
        let sweep = ((a1 - a0) % 360 + 360) % 360;
        if (sweep > 180) { const t = a0; a0 = a1; a1 = t; sweep = 360 - sweep; }
        const R = Math.min(th * 3.2, wp.len * 0.35 || th * 3);
        d.arc(r0[0], r0[1], R, a0, a0 + sweep, { color: COLOR.RED, layer: 'DIM' });
        const am = (a0 + sweep / 2) * Math.PI / 180;
        const tx = r0[0] + Math.cos(am) * (R + th * 0.9), ty = r0[1] + Math.sin(am) * (R + th * 0.9);
        d.text(tx, ty, `${+wp.angleDeg.toFixed(3)}°`, { color: COLOR.GREEN, h: th * 0.75, valign: 'middle', layer: 'DIM' });
        if (opts.names !== false) d.varLabel(tx, ty - th * 0.9, `${side}${lr}각도`, { h: th * 0.6, valign: 'top', field: `${w.key}.angle` });
        // 길이 치수 (전면 쪽으로)
        const a = G(wp.root), b = G(wp.tip);
        const nx = -(b[1] - a[1]), ny = b[0] - a[0];
        const fb = G([wp.root[0] - wp.back[0], wp.root[1] - wp.back[1]]);
        const s = (nx * (fb[0] - a[0]) + ny * (fb[1] - a[1])) >= 0 ? 1 : -1;
        d.dimA(a, b, s * th * 2.2, fmtLen(wp.len));
        if (opts.names !== false) {
            const L = Math.hypot(nx, ny) || 1;
            let rot = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
            if (rot > 90) rot -= 180;
            if (rot < -90) rot += 180;
            const off = s * th * 2.2 - s * th * 0.5;
            d.varLabel((a[0] + b[0]) / 2 + nx / L * off, (a[1] + b[1]) / 2 + ny / L * off, `${side}${lr}길이`, { h: th * 0.6, rot, valign: 'middle', field: `${w.key}.len` });
        }
    }
    return out;
}

/**
 * 일체식 날개벽 전개도 (원점 ox, oy)
 */
export function drawIntegralElevation(d, c, key, ox = 0, oy = 0, opts = {}) {
    const e = integralElevation(c, key);
    const th = d.textHeight;
    const T = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
    d.pline(T(e.poly), { ...CY, closed: true });
    // 본체 접합부 (상부슬래브 상면) 표시
    d.line(ox, e.Htot + oy, ox + Math.min(e.L1, th * 3), e.Htot + oy, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    if (opts.dims === false) return e;
    const yb = oy - th * 2.5;
    d.dimH(ox, ox + e.L1, oy, yb, undefined, { name: 'L1' });
    const xl = ox - th * 2.5;
    d.dimV(oy, oy + e.hRoot, ox, xl);
    const xr = ox + e.L1 + th * 2.5;
    d.dimV(oy, oy + e.H3, ox + e.L1, xr, undefined, { name: 'H3' });
    d.dimV(oy + e.H3, oy + e.hTip, ox + e.L1, xr, undefined, { name: 'H2' });
    d.text(ox + e.L1 / 2, oy + e.hRoot + th * 1.5, opts.title || '전개도', { color: COLOR.GREEN, h: th, layer: 'TEXT' });
    // 상단 EL (암거쪽 / 단부쪽): 암거 상단 EL 기준 (opts.p 가 있을 때)
    if (opts.p) {
        const topEl = culvertTopEl(c, key[0], opts.p);
        const elRoot = topEl, elTip = topEl + (e.hTip - e.Htot) / 1000;
        // 표시 위치는 모서리 조금 안쪽의 상단선 위
        const xr = Math.min(th * 0.8, e.L1 / 4), xt = Math.max(e.L1 - th * 0.8, e.L1 * 3 / 4);
        d.elMark(ox + xr, oy + e.topAt(xr), elRoot, { h: th * 0.7 });
        d.elMark(ox + xt, oy + e.topAt(xt), elTip, { h: th * 0.7 });
    }
    return e;
}

/** 일체식 날개벽 단면 (두께 T1 상단, T2 하단) */
export function drawIntegralSection(d, c, key, ox = 0, oy = 0) {
    const e = integralElevation(c, key);
    const th = d.textHeight;
    const H = e.hRoot;
    const pts = [[0, 0], [e.T2, 0], [e.T1, H], [0, H]].map(([x, y]) => [x + ox, y + oy]);
    d.pline(pts, { ...CY, closed: true });
    d.dimH(ox, ox + e.T1, oy + H, oy + H + th * 2.2, undefined, { name: 'T1' });
    d.dimH(ox, ox + e.T2, oy, oy - th * 2.2, undefined, { name: 'T2' });
    d.dimV(oy, oy + H, ox, ox - th * 2.2);
    d.text(ox + e.T2 / 2, oy + H + th * 4.8, '단면', { color: COLOR.GREEN, h: th, layer: 'TEXT' });
}

/**
 * 옹벽식 날개벽 단면 (row: 단면 설정 한 행), sfx '_s' | '_e'
 */
export function drawWallSection(d, row, ox = 0, oy = 0, sfx = '', opts = {}) {
    const s = wallSection(row);
    const th = d.textHeight;
    const T = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
    d.pline(T(s.poly), { ...CY, closed: true });
    if (s.key) d.pline(T(s.key), { ...CY, closed: false });
    if (s.lean) d.pline(T(s.lean), { ...CY, closed: true });
    // 전면경사 표기
    if (s.batter > 0) {
        const xm = (s.stem.xt1 + s.stem.xb1) / 2 + ox + th * 0.6, ym = (s.stem.y0 + s.stem.y1) / 2 + oy;
        d.text(xm, ym, `1:${s.batter.toFixed(3)}`, { color: COLOR.GREEN, h: th * 0.6, rot: 90, valign: 'top', layer: 'TEXT' });
    }
    // 배수공
    if (opts.drain && opts.drain.use) {
        const dv = +opts.drain.dV || 0, r = Math.max(30, (+opts.drain.dia || 100) / 2);
        const y = s.yJ + dv;
        d.line(s.stem.xb0 + ox, y + oy, s.stem.xb1 + ox, y - (s.stem.xb1 - s.stem.xb0) * 0.03 + oy, { color: COLOR.YELLOW, layer: 'DRAIN' });
        d.circle(s.stem.xb0 + ox, y + oy, r, { color: COLOR.YELLOW, layer: 'DRAIN' });
    }
    if (opts.dims === false) return s;
    const n = (k) => (opts.names === false ? undefined : k + sfx);
    // 상단 WT
    const yt = oy + s.WH + th * 2.2;
    d.dimH(s.stem.xt0 + ox, s.stem.xt1 + ox, oy + s.WH, yt, undefined, { name: n('WT') });
    // 좌측 (뒷굽): BF2, BF1, WH
    const xl = ox - (s.lean ? (+row.IO || 0) : 0) - th * 2.4;
    d.dimV(oy, oy + s.BF2, ox, xl, undefined, { name: n('BF2') });
    d.dimV(oy + s.BF2, oy + s.WH, ox, xl);
    d.dimV(oy, oy + s.WH, ox, xl - th * 2.4, undefined, { name: n('WH') });
    // 우측 (앞굽): BB2, BB1
    const xr = ox + s.W + (s.lean ? (+row.IO || 0) : 0) + th * 2.4;
    d.dimV(oy, oy + s.BB2, ox + s.W, xr, undefined, { name: n('BB2') });
    d.dimV(oy + s.BB2, oy + s.BB1, ox + s.W, xr, undefined, { name: n('BB1') });
    d.dimV(oy + s.BB1, oy + s.WH, ox + s.W, xr);
    if (s.BF1 !== s.BF2) d.dimV(oy, oy + s.BF1, ox + s.stem.xb0, ox + s.stem.xb0 - th * 1.2, undefined, { name: n('BF1') });
    // 하단: B2 | B3 | B1, 전체
    const yLow = oy - (s.key ? (+row.key.T || 0) : 0) - (s.lean ? (+row.IH || 0) : 0);
    const yb = yLow - th * 2.4;
    d.dimH(ox, ox + s.B2, yLow, yb, undefined, { name: n('B2') });
    d.dimH(ox + s.B2, ox + s.B2 + s.B3, yLow, yb, undefined, { name: n('B3') });
    d.dimH(ox + s.B2 + s.B3, ox + s.W, yLow, yb, undefined, { name: n('B1') });
    d.dimH(ox, ox + s.W, yLow, yb - th * 2.4);
    if (s.key) d.dimH(ox, ox + (+row.key.D || 0), yLow, yb - th * 4.8, undefined, { name: n('D') });
    if (opts.title) d.text(ox + s.W / 2, yb - th * 7.2, opts.title, { color: COLOR.GREEN, h: th, layer: 'TEXT' });
    return s;
}

/**
 * 옹벽식 날개벽 전개 정면도: 시점(EL_s, WH_s) → 종점(EL_e, WH_e), 길이 L
 */
export function drawWallElevation(d, rows, L, ox = 0, oy = 0, opts = {}) {
    const th = d.textHeight;
    const [rs, re] = rows;
    const Ks = 1000;
    const topS = (+rs.EL || 0) * Ks, topE = (+re.EL || 0) * Ks;
    const botS = topS - (+rs.WH || 0), botE = topE - (+re.WH || 0);
    const fS = Math.max(+rs.BF1 || 0, +rs.BB1 || 0), fE = Math.max(+re.BF1 || 0, +re.BB1 || 0);
    const Y = (y) => y + oy;
    const pts = [[ox, Y(botS)], [ox + L, Y(botE)], [ox + L, Y(topE)], [ox, Y(topS)]];
    d.pline(pts, { ...CY, closed: true });
    d.line(ox, Y(botS + fS), ox + L, Y(botE + fE), { ...CY });
    // 버림
    const IO = +rs.IO || 0, IH = +rs.IH || 0;
    if (IH > 0) d.pline([[ox - IO, Y(botS)], [ox + L + IO, Y(botE)], [ox + L + IO, Y(botE - IH)], [ox - IO, Y(botS - IH)]], { ...CY, closed: true });
    // 배수공 (정면도)
    if (opts.drain && opts.drain.use) {
        const dH = +opts.drain.dH || 0, ctc = Math.max(100, +opts.drain.ctcH || 3000), r = Math.max(30, (+opts.drain.dia || 100) / 2);
        for (let x = dH; x < L - r; x += ctc) {
            const t = x / (L || 1);
            const yb = botS + fS + (botE + fE - botS - fS) * t + (+opts.drain.dV || 0);
            d.circle(ox + x, Y(yb), r, { color: COLOR.YELLOW, layer: 'DRAIN' });
        }
    }
    d.elMark(ox, Y(topS), topS / Ks, { h: th * 0.7, align: 'right' });
    d.elMark(ox + L, Y(topE), topE / Ks, { h: th * 0.7 });
    d.elMark(ox, Y(botS), botS / Ks, { h: th * 0.7, align: 'right', down: true });
    d.elMark(ox + L, Y(botE), botE / Ks, { h: th * 0.7, down: true });
    const yTop = Math.max(topS, topE);
    d.dimH(ox, ox + L, Y(yTop), Y(yTop) + th * 3.5);
    d.dimV(Y(botS), Y(botS + fS), ox, ox - th * 2.5);
    d.dimV(Y(botS + fS), Y(topS), ox, ox - th * 2.5);
    d.dimV(Y(botS), Y(topS), ox, ox - th * 5);
    d.dimV(Y(botE), Y(botE + fE), ox + L, ox + L + th * 2.5);
    d.dimV(Y(botE + fE), Y(topE), ox + L, ox + L + th * 2.5);
    d.dimV(Y(botE), Y(topE), ox + L, ox + L + th * 5);
    if (opts.title) d.text(ox + L / 2, Y(Math.min(botS, botE)) - th * 3, opts.title, { color: COLOR.GREEN, h: th, layer: 'TEXT' });
    return { topS, topE, botS, botE };
}

/**
 * 옹벽 평면도 (end: 'S' 시점 / 'E' 종점). 도면 좌표(전역)로 그린다.
 * 옹벽식 날개벽: 기초 외곽 · 벽체 상단 전·배면 · 벽체 하단 전면(실선), 배면 하단 · 전단키(은선),
 * 시·종점 단면(rows[0], rows[1]) 사이는 직선 보간. 평면의 날개벽 선(root→tip)을 벽체 상단 전면으로 본다.
 * 일체식 날개벽은 평면 외곽만, 암거 본체는 단부에서 일부만 그린다.
 * rowsOf(key) → [시점단면, 종점단면] 행
 * 반환: 그린 날개벽 수
 */
export function drawWallPlan(d, p, c, end, rowsOf) {
    const th = d.textHeight;
    const ws = installedWings(c).filter(w => w.key[0] === end);
    if (!ws.some(w => w.type === '옹벽식')) return 0;
    const hid = { ...CY, dash: 'hidden' };
    let F = null;
    for (const w of ws) {
        const wp = wingPlan(p, c, w.key);
        F = wp.frame;
        const T = wp.frame.toG;
        const G = (q) => T(q[0], q[1]);
        if (w.type !== '옹벽식') {
            // 일체식: 평면 외곽 + 배면 헌치 (drawWingsPlan 과 같은 표현)
            d.pline([G(wp.backRoot), G(wp.backTip), G(wp.tip), G(wp.root)], CY);
            if (wp.haunch) d.line(...G(wp.haunch[0]), ...G(wp.haunch[1]), CY);
            continue;
        }
        const rows = rowsOf(w.key);
        const S0 = wallSection(rows[0]), S1 = wallSection(rows[1] || rows[0]);
        const L = wp.len;
        // 단면 x (뒷굽 끝 0 → 앞굽 끝) 를 평면 좌표로: 날개벽 선에서 배면 방향으로 (xt1 - x)
        const at = (S, s, x) => G([wp.root[0] + wp.dir[0] * s + wp.back[0] * (S.stem.xt1 - x), wp.root[1] + wp.dir[1] * s + wp.back[1] * (S.stem.xt1 - x)]);
        const seg = (f0, f1, st) => { const a = at(S0, 0, f0(S0)), b = at(S1, L, f1(S1)); d.line(a[0], a[1], b[0], b[1], st); };
        const both = (f, st) => seg(f, f, st);
        // 기초 외곽
        d.pline([at(S0, 0, 0), at(S1, L, 0), at(S1, L, S1.W), at(S0, 0, S0.W)], { ...CY, closed: true });
        // 벽체 상단 (배면, 전면) 과 단부
        both(S => S.stem.xt0, CY);
        both(S => S.stem.xt1, CY);
        for (const [S, s] of [[S0, 0], [S1, L]]) { const a = at(S, s, S.stem.xt0), b = at(S, s, S.stem.xt1); d.line(a[0], a[1], b[0], b[1], CY); }
        // 벽체 하단 전면 (전면 경사가 있으면 보임), 배면 하단 (은선)
        if (Math.abs(S0.stem.xb1 - S0.stem.xt1) > 1 || Math.abs(S1.stem.xb1 - S1.stem.xt1) > 1) both(S => S.stem.xb1, CY);
        if (Math.abs(S0.stem.xb0 - S0.stem.xt0) > 1 || Math.abs(S1.stem.xb0 - S1.stem.xt0) > 1) both(S => S.stem.xb0, hid);
        // 전단키 (은선)
        if (S0.key && S1.key) { both(S => S.key[0][0], hid); both(S => S.key[1][0], hid); }
        // 치수: 길이 (앞굽 쪽), 폭 (끝 단면, 뒷굽 → 앞굽)
        const toe0 = at(S0, 0, S0.W), toe1 = at(S1, L, S1.W);
        const outN = (a, b, ref) => { const nx = -(b[1] - a[1]), ny = b[0] - a[0]; return (nx * (ref[0] - a[0]) + ny * (ref[1] - a[1])) >= 0 ? 1 : -1; };
        const fwd = at(S0, 0, S0.W + 1000);
        d.dimA(toe0, toe1, outN(toe0, toe1, fwd) * th * 2.2, fmtLen(L));
        const xs = [0, S1.B2, S1.B2 + S1.B3, S1.W];
        const past = G([wp.tip[0] + wp.dir[0] * 1000, wp.tip[1] + wp.dir[1] * 1000]);
        for (let i = 0; i < xs.length - 1; i++) {
            if (xs[i + 1] - xs[i] < 1) continue;
            const a = at(S1, L, xs[i]), b = at(S1, L, xs[i + 1]);
            d.dimA(a, b, outN(a, b, past) * th * 2.2, fmtLen(xs[i + 1] - xs[i]));
        }
        { const a = at(S1, L, 0), b = at(S1, L, S1.W); d.dimA(a, b, outN(a, b, past) * th * 4.4, fmtLen(S1.W)); }
        // 이름
        const mid = at(S1, L / 2, (S1.stem.xt0 + S1.stem.xt1) / 2);
        const r0 = G(wp.root), r1 = G(wp.tip);
        let rot = Math.atan2(r1[1] - r0[1], r1[0] - r0[0]) * 180 / Math.PI;
        if (rot > 90) rot -= 180;
        if (rot < -90) rot += 180;
        const [side, lr] = WING_LABELS[w.key];
        d.text(mid[0], mid[1], `${side}${lr} 옹벽`, { color: COLOR.WHITE, h: th * 0.8, rot, valign: 'middle', layer: 'TEXT' });
    }
    // 암거 본체 단부 (일부)
    if (F) {
        const G = (u, v) => F.toG(u, v);
        const sg = end === 'S' ? 1 : -1;
        const ext = Math.max(3000, th * 12);
        const pL = G(F.endU(F.vL), F.vL), pR = G(F.endU(F.vR), F.vR);
        const qL = G(F.endU(F.vL) + sg * ext, F.vL), qR = G(F.endU(F.vR) + sg * ext, F.vR);
        d.line(pL[0], pL[1], pR[0], pR[1], CY);
        d.line(pL[0], pL[1], qL[0], qL[1], CY);
        d.line(pR[0], pR[1], qR[0], qR[1], CY);
        d.line(qL[0], qL[1], qR[0], qR[1], { color: COLOR.GRAY, layer: 'CUT', dash: 'center' });
        const cm = G(F.endU(F.off) + sg * ext * 0.5, F.off);
        d.text(cm[0], cm[1], '암거 본체', { color: COLOR.WHITE, h: th * 0.8, valign: 'middle', layer: 'TEXT' });
    }
    return ws.length;
}
