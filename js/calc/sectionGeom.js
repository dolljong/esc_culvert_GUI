// sectionGeom.js - 암거 횡단면 형상 (Box / U / 복층)
//
// 좌표 (mm): x=0 은 좌측벽 외면, y=0 은 하부슬래브 하면(기초 하면, 버림 상면).
// refY = 하부슬래브 상면 (선형 종단고 기준, 매뉴얼 1.3).
// 모든 도면/해석/수량 모듈은 이 함수의 결과만 사용해 형상을 일치시킨다.

import { sectionKind, sectionOf } from '../core/model.js';

const n0 = (v) => (isFinite(+v) ? +v : 0);

/**
 * 모서리 헌치 윤곽 (국부좌표: u = 벽면에서 내공쪽, v = 슬래브면에서 내공쪽).
 * 벽면 위의 점에서 시작해 슬래브 면 위의 점에서 끝난다.
 *   삼각형: S2×W2 / 사각형: S1×W1 (+S3×W3) / 혼합형: 사각 S1×W1 + 삼각 S2×W2 + 사각 S3×W3
 */
export function haunchProfile(hc) {
    if (!hc || !hc.use) return [[0, 0]];
    const t = hc.type || '삼각형';
    let S1 = n0(hc.S1), S2 = n0(hc.S2), S3 = n0(hc.S3), W1 = n0(hc.W1), W2 = n0(hc.W2), W3 = n0(hc.W3);
    if (t === '삼각형') { S1 = W1 = S3 = W3 = 0; }
    if (t === '사각형') { S2 = W2 = 0; }
    const pts = [];
    const push = (u, v) => {
        const l = pts[pts.length - 1];
        if (!l || Math.abs(l[0] - u) > 1e-6 || Math.abs(l[1] - v) > 1e-6) pts.push([u, v]);
    };
    push(0, W1 + W2 + W3);
    push(S1, W1 + W2 + W3);
    push(S1, W2 + W3);
    push(S1 + S2, W3);
    push(S1 + S2 + S3, W3);
    push(S1 + S2 + S3, 0);
    return pts;
}

/** 헌치 크기 (가로 합, 세로 합) */
export function haunchSize(hc) {
    const p = haunchProfile(hc);
    return { s: p[p.length - 1][0], w: p[0][1] };
}

/**
 * 직사각형 내공(x0..x1, y0..y1)에 네 모서리 헌치를 넣은 다각형 (반시계)
 * hs = {UL, UR, LL, LR}
 */
export function cellPolygon(x0, x1, y0, y1, hs = {}) {
    const pts = [];
    // 좌하 (LL): 벽면(x0) → 슬래브면(y0). 벽 위 점에서 시작해 아래로 내려가며 반시계
    const LL = haunchProfile(hs.LL); // u→+x, v→+y
    const LR = haunchProfile(hs.LR); // u→-x, v→+y
    const UR = haunchProfile(hs.UR); // u→-x, v→-y
    const UL = haunchProfile(hs.UL); // u→+x, v→-y
    // 반시계 순서: 좌하 모서리(LL)부터 하면 → 우측벽(LR) → 상면(UR) → 좌측벽(UL)
    const llCCW = LL.map(([u, v]) => [x0 + u, y0 + v]);             // 벽점(위) → 하면점(오른쪽)
    const lrCCW = LR.map(([u, v]) => [x1 - u, y0 + v]).reverse();  // 하면점(왼쪽) → 벽점(위)
    const urCCW = UR.map(([u, v]) => [x1 - u, y1 - v]);             // 벽점(아래) → 상면점(왼쪽)
    const ulCCW = UL.map(([u, v]) => [x0 + u, y1 - v]).reverse();  // 상면점(오른쪽) → 벽점(아래)
    pts.push(...llCCW, ...lrCCW, ...urCCW, ...ulCCW);
    return dedupe(pts);
}

function dedupe(pts) {
    const out = [];
    for (const p of pts) {
        const l = out[out.length - 1];
        if (!l || Math.abs(l[0] - p[0]) > 1e-6 || Math.abs(l[1] - p[1]) > 1e-6) out.push(p);
    }
    if (out.length > 1) {
        const a = out[0], b = out[out.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
    }
    return out;
}

export function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
}

export function polyCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const k = p[0] * q[1] - q[0] * p[1];
        a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
    }
    a /= 2;
    if (Math.abs(a) < 1e-9) return { x: 0, y: 0 };
    return { x: cx / (6 * a), y: cy / (6 * a) };
}

// ── Box ───────────────────────────────────────────────────────────────

function boxGeom(sec) {
    const n = sec.cells || (sec.B || []).length || 1;
    const B = (sec.B || []).slice(0, n).map(n0);
    const walls = (sec.walls || []).slice(0, n - 1);
    const H = n0(sec.H), UT = n0(sec.UT), LT = n0(sec.LT), WL = n0(sec.WL), WR = n0(sec.WR);
    const xs = [];   // 각 련 내공 [x0, x1]
    let x = WL;
    for (let i = 0; i < n; i++) {
        xs.push([x, x + B[i]]);
        x += B[i];
        if (i < n - 1) x += n0(walls[i] && walls[i].C);
    }
    const W = x + WR;
    const Htot = LT + H + UT;
    const y0 = LT, y1 = LT + H;
    const cells = xs.map(([a, b], i) => ({
        index: i, x0: a, x1: b, y0, y1, B: B[i],
        poly: cellPolygon(a, b, y0, y1, (sec.haunch || [])[i] || {}),
    }));
    const wallList = [{ kind: 'outer', side: 'L', x0: 0, x1: WL, t: WL, type: '연속벽체' }];
    for (let i = 0; i < n - 1; i++) {
        wallList.push({ kind: 'mid', index: i, x0: xs[i][1], x1: xs[i + 1][0], t: n0(walls[i] && walls[i].C), type: (walls[i] && walls[i].type) || '연속벽체' });
    }
    wallList.push({ kind: 'outer', side: 'R', x0: W - WR, x1: W, t: WR, type: '연속벽체' });
    const outer = [[0, 0], [W, 0], [W, Htot], [0, Htot]];
    return {
        kind: 'BOX', n, W, Htot, H, UT, LT, WL, WR, refY: LT, topY: Htot,
        cells, walls: wallList, outer,
        slabs: [{ kind: 'top', y0: y1, y1: Htot, t: UT }, { kind: 'bottom', y0: 0, y1: LT, t: LT }],
    };
}

// ── U형 ───────────────────────────────────────────────────────────────

function uGeom(sec) {
    const H1 = n0(sec.H1), H2 = n0(sec.H2), H3 = n0(sec.H3);
    const Hw = H1 + H2 + H3;
    const LT = n0(sec.LT), WT = n0(sec.WT), WB = n0(sec.WB) || WT;
    const B1 = n0((sec.B || [])[0]), B2 = n0((sec.B || [])[1]);
    const med = sec.median && sec.median.use && B2 > 0 ? sec.median : null;
    const Gw = med ? n0(med.Gw) : 0, Gh = med ? n0(med.Gh) : 0;
    const inner = B1 + (B2 > 0 ? Gw + B2 : 0);
    const W = WB + inner + WB;
    const Htot = LT + Hw;
    const xi0 = WB, xi1 = WB + inner;     // 내면 (수직)
    // 외면: 하단 H1 은 두께 WB, H2 구간에서 WB → WT, 상단 H3 는 WT
    const yA = LT + H1, yB = LT + H1 + H2;
    const cut = sec.cover && sec.cover.use ? { b: n0(sec.cover.Cb), h: n0(sec.cover.Ch) } : null;      // 내측 상단 절취 (덮개)
    const brk = sec.bracket && sec.bracket.use ? { b: n0(sec.bracket.Bb), h: n0(sec.bracket.Bh) } : null; // 외측 상단 절취 (브래킷)
    const leftWall = (mirror) => {
        // 좌측벽 단면 (외면 x 는 xo(y), 내면 x = xi0)
        const xo = (t) => xi0 - t;
        const pts = [
            [xo(WB), 0 + LT],
            [xo(WB), yA],
            [xo(WT), yB],
            [xo(WT), Htot - (brk ? brk.h : 0)],
        ];
        if (brk) pts.push([xo(WT) + brk.b, Htot - brk.h], [xo(WT) + brk.b, Htot]);
        else pts.push([xo(WT), Htot]);
        if (cut) pts.push([xi0 - cut.b, Htot], [xi0 - cut.b, Htot - cut.h], [xi0, Htot - cut.h]);
        else pts.push([xi0, Htot]);
        pts.push([xi0, LT]);
        return mirror ? pts.map(([x, y]) => [W - x, y]).reverse() : pts;
    };
    // 전체 외곽 (하부슬래브 + 양측벽)
    const L = leftWall(false), R = leftWall(true);
    const hs = (sec.haunch || [])[0] || {};
    const llProf = haunchProfile(hs.LL).map(([u, v]) => [xi0 + u, LT + v]);           // 벽점 → 바닥점
    const lrProf = haunchProfile(hs.LR).map(([u, v]) => [xi1 - u, LT + v]).reverse(); // 바닥점 → 벽점
    // 외곽선: 좌하 → 우하 → 우측벽 외면 위로 → 우측벽 상단 → 내면 아래로 → 바닥(헌치) → 좌측 내면 위로 → 좌측벽 상단 → 좌측 외면 아래로
    const outer = [[0, 0], [W, 0]];
    // 우측벽: R 은 [내면 하단 ... 외면 하단] 순서 (mirror reverse). 외면부터 위로 가야 함
    const Rrev = R.slice().reverse().slice(0, -1); // 외면 하단(LT) → ... → 내면 상단 (내면 하단점은 바닥이 담당)
    outer.push(...Rrev);
    // 바닥: 우측 내면 하단 → 우측 헌치 → (중분대) → 좌측 헌치 → 좌측 내면 하단
    const floor = [];
    floor.push(...lrProf.slice().reverse()); // 벽점 → 바닥점 (우측)
    if (med && Gw > 0) {
        const mx0 = xi0 + B1, mx1 = mx0 + Gw;
        floor.push([mx1, LT], [mx1, LT + Gh], [mx0, LT + Gh], [mx0, LT]);
    }
    floor.push(...llProf.slice().reverse()); // 바닥점 → 벽점 (좌측)
    outer.push(...floor);
    // 좌측벽: L 은 [외면 하단 ... 내면 하단]. 내면 하단 → 위 → ... → 외면 하단 순서로
    outer.push(...L.slice().reverse().slice(1));
    const cleaned = dedupe(outer);
    return {
        kind: 'U', n: 1, W, Htot, H: Hw, H1, H2, H3, LT, WT, WB, UT: 0, WL: WB, WR: WB, refY: LT, topY: Htot,
        inner: { x0: xi0, x1: xi1 }, B1, B2, Gw, Gh,
        cells: [{ index: 0, x0: xi0, x1: xi1, y0: LT, y1: Htot, B: inner, poly: null }],
        walls: [
            { kind: 'outer', side: 'L', x0: xi0 - WB, x1: xi0, t: WB, tTop: WT, type: '연속벽체' },
            { kind: 'outer', side: 'R', x0: xi1, x1: xi1 + WB, t: WB, tTop: WT, type: '연속벽체' },
        ],
        outer: cleaned, open: true,
        slabs: [{ kind: 'bottom', y0: 0, y1: LT, t: LT }],
        cut, brk, median: med ? { x0: xi0 + B1, x1: xi0 + B1 + Gw, h: Gh } : null,
    };
}

// ── 복층 ─────────────────────────────────────────────────────────────

function doubleGeom(sec) {
    const n = sec.cells || (sec.B || []).length || 1;
    const B = (sec.B || []).slice(0, n).map(n0);
    const lo = sec.lower || { LT: sec.LT, WL: sec.WL, WR: sec.WR, walls: sec.walls || [] };
    const up = sec.upper || lo;
    const H = n0(sec.H), UT = n0(sec.UT), LT = n0(lo.LT), MH = n0(sec.MH), MT = n0(sec.MT);
    const WLl = n0(lo.WL), WRl = n0(lo.WR), WLu = n0(up.WL), WRu = n0(up.WR);
    // 내공 위치는 하층 기준
    const xs = [];
    let x = WLl;
    for (let i = 0; i < n; i++) {
        xs.push([x, x + B[i]]);
        x += B[i];
        if (i < n - 1) x += n0(lo.walls[i] && lo.walls[i].C);
    }
    const W = x + WRl;
    const Htot = LT + H + UT;
    const yL0 = LT, yL1 = LT + MH, yU0 = LT + MH + MT, yU1 = LT + H;
    const centers = xs.map(([a, b], i) => (i < n - 1 ? (b + xs[i + 1][0]) / 2 : null)).slice(0, n - 1);
    // 상층 내공: 중간벽 중심을 유지하고 두께만 상층값
    const xsU = xs.map(([a, b], i) => {
        // 외측벽 내면은 상·하층 동일 (외면이 단차)
        const ua = i === 0 ? a : centers[i - 1] + n0(up.walls[i - 1] && up.walls[i - 1].C) / 2;
        const ub = i === n - 1 ? b : centers[i] - n0(up.walls[i] && up.walls[i].C) / 2;
        return [ua, ub];
    });
    const h2 = sec.haunch2 || {};
    const cells = [];
    xs.forEach(([a, b], i) => cells.push({ index: i, floor: 1, x0: a, x1: b, y0: yL0, y1: yL1, B: b - a, poly: cellPolygon(a, b, yL0, yL1, (h2.lower || [])[i] || {}) }));
    xsU.forEach(([a, b], i) => cells.push({ index: i, floor: 2, x0: a, x1: b, y0: yU0, y1: yU1, B: b - a, poly: cellPolygon(a, b, yU0, yU1, (h2.upper || [])[i] || {}) }));
    // 외곽: 하층 벽이 두꺼우면 중간슬래브 높이에서 외면이 단차
    const stepL = WLl - WLu, stepR = WRl - WRu;
    const ys = yU0; // 단차 위치 (중간슬래브 상면)
    const outer = dedupe([
        [0, 0], [W, 0], [W, ys], [W - stepR, ys], [W - stepR, Htot], [stepL, Htot], [stepL, ys], [0, ys],
    ]);
    const walls = [{ kind: 'outer', side: 'L', x0: 0, x1: WLl, t: WLl, tUp: WLu, type: '연속벽체' }];
    for (let i = 0; i < n - 1; i++) {
        walls.push({ kind: 'mid', index: i, x0: xs[i][1], x1: xs[i + 1][0], t: n0(lo.walls[i] && lo.walls[i].C), type: (lo.walls[i] && lo.walls[i].type) || '연속벽체', floor: 1 });
        walls.push({ kind: 'mid', index: i, x0: xsU[i][1], x1: xsU[i + 1][0], t: n0(up.walls[i] && up.walls[i].C), type: (up.walls[i] && up.walls[i].type) || '연속벽체', floor: 2 });
    }
    walls.push({ kind: 'outer', side: 'R', x0: W - WRl, x1: W, t: WRl, tUp: WRu, type: '연속벽체' });
    return {
        kind: 'DOUBLE', n, W, Htot, H, UT, LT, MH, MT, WL: WLl, WR: WRl, WLu, WRu, refY: LT, topY: Htot,
        cells, walls, outer, xsLower: xs, xsUpper: xsU,
        slabs: [{ kind: 'top', y0: yU1, y1: Htot, t: UT }, { kind: 'middle', y0: yL1, y1: yU0, t: MT }, { kind: 'bottom', y0: 0, y1: LT, t: LT }],
    };
}

// ── 공통 ─────────────────────────────────────────────────────────────

/**
 * 암거 c 의 블록 bi 단면 형상.
 * 결과: { kind, W, Htot, refY, cells, walls, outer, slabs, antiFloat, lean, cx, ... }
 */
export function sectionGeom(c, bi = 0) {
    const sec = sectionOf(c, bi);
    const kind = sectionKind(c, bi);
    let g;
    if (kind === 'U') g = uGeom(sec);
    else if (kind === 'DOUBLE') g = doubleGeom(sec);
    else g = boxGeom(sec);
    g.sec = sec;
    g.cx = g.W / 2;
    // 부상방지저판 (측면 날개)
    const af = sec.antiFloat;
    if (af && af.use && n0(af.brW) > 0) {
        const brW = n0(af.brW), t = n0(af.brH2) || g.LT, t1 = n0(af.brH1);
        g.antiFloat = {
            brW, t, t1,
            left: [[0, 0], [-brW, 0], [-brW, t], [0, t + t1]],
            right: [[g.W, 0], [g.W + brW, 0], [g.W + brW, t], [g.W, t + t1]],
        };
    } else g.antiFloat = null;
    // 기초 하면 폭 (부상방지저판 포함)
    const ext = g.antiFloat ? g.antiFloat.brW : 0;
    g.baseX0 = -ext;
    g.baseX1 = g.W + ext;
    // 버림콘크리트
    const lean = sec.lean || { t: 100, w: 100 };
    const lt = n0(lean.t), lw = n0(lean.w);
    g.lean = lt > 0 ? { t: lt, w: lw, poly: [[g.baseX0 - lw, -lt], [g.baseX1 + lw, -lt], [g.baseX1 + lw, 0], [g.baseX0 - lw, 0]] } : null;
    g.H4 = n0(sec.H4);
    return g;
}

/** 단면 콘크리트 면적 (mm²) — 외곽 - 내공 + 부상방지저판 */
export function concreteArea(g) {
    let A = polyArea(g.outer);
    if (g.kind !== 'U') for (const c of g.cells) A -= polyArea(c.poly);
    if (g.antiFloat) A += polyArea(g.antiFloat.left) + polyArea(g.antiFloat.right);
    return A;
}

/**
 * 2D 프레임 해석용 부재 중심선 (mm)
 * 반환: { xs: [벽 중심 x...], yTop, yBot, yMid?, kind }
 */
export function frameAxes(g) {
    const xs = g.walls.filter(w => w.floor !== 2).map(w => (w.x0 + w.x1) / 2);
    const out = { kind: g.kind, xs, yBot: g.LT / 2 };
    if (g.kind === 'U') {
        out.yTop = g.Htot;     // 벽 상단 (자유단)
        out.open = true;
    } else {
        out.yTop = g.Htot - g.UT / 2;
    }
    if (g.kind === 'DOUBLE') out.yMid = g.LT + g.MH + g.MT / 2;
    return out;
}
