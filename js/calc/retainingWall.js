// retainingWall.js - 옹벽식 날개벽 구조계산 (설계조건 4.1.7, 하중조합(옹벽) 4.5)
//
// wallDesign(p, c, wingId) → {
//   key, name, ok, error?, params (설계정수), sections: [Section, Section] (시점 단면 / 종점 단면), lines (계산서 문장) }
//   Section = { label, row, geom, earth, weight (자중 분할표), items (작용력), stability: [...], members: [...], ok }
// showWallReport(p, c, wingId)  모달(class "report") 로 계산서 표시
// wallReportHtml(result)        계산서 HTML (출력 화면 재사용)
// weightRows(sec.weight) / weightFigure(sec)  자중 분할표 행 / 분할 그림 (Section.weight = 사각형·삼각형 분할, 안정검토 D 하중의 출처)
//
// 단위: 길이 m (입력 mm 를 변환), 힘 kN (단위길이 1 m 당), 모멘트 kN·m, 응력 kN/m².
// 좌표: x = 뒷굽 끝 0 → 앞굽 끝 B (wingGeom.wallSection 과 같음), y = 기초 하면 0 위로 +.
// 모멘트 중심 = 앞굽 끝 (x = B). 수평력은 앞굽 쪽(활동 방향) +.
//
// 하중 분류 (하중조합 옹벽의 열): D 고정하중 (콘크리트·뒷굽 위 흙), L 활하중 (상재하중),
//   H 토압 (정적 토압, '토압계수' 선택시 상재하중 토압 포함), E 지진 (관성력 + 지진시 토압 증분).
// 안정검토 = 사용하중조합 중 '기초 검토시' 행, 단면검토 = 계수하중조합 중 '벽체 검토시' 행 (균열은 사용하중조합).

import { getDesign, K0, KaRankine, KaCoulomb, KaeMO, KpRankine, deltaValue } from './design.js';
import { wallSection, defaultWallDim, defaultWingPosFor, WING_NAMES } from './wingGeom.js';
import { polyArea, polyCentroid } from './sectionGeom.js';
import { allowableBearing, phiFromN } from './bearing.js';
import { checkMember, requiredAs } from './rcDesign.js';
import { barArea, barD } from './rebar.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { drawingToSvg } from '../draw/svgExport.js';

const RAD = Math.PI / 180;
const n0 = (v) => (isFinite(+v) ? +v : 0);
const f2 = (v) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(2));
const f3 = (v) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(3));
const COVER = 80;   // 흙에 접하는 면 피복 (mm)
const BARS = ['D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32'];
const CTCS = [250, 200, 150, 125];

// ── 하중조합 (loadCombWall.js 와 같은 기본값, 방어적으로 읽기) ──────────

const R = (name, D, L, H, E) => { const f = {}; if (D) f.D = D; if (L) f.L = L; if (H) f.H = H; if (E) f.E = E; return { name, f, found: true, wall: true }; };
function defaultComb() {
    return {
        use: { D: true, L: true, H: true, E: true },
        factored: [R('LC 01', 1.2, 0, 1.6, 0), R('LC 02', 1.2, 1.6, 1.6, 0), R('LC 03', 0.9, 0, 1.6, 1.0)],
        service: [R('LC 01', 1.0, 0, 1.0, 0), R('LC 02', 1.0, 1.0, 1.0, 0), R('LC 03', 0.9, 0, 1.6, 1.0)],
    };
}
export function wallCombOf(c, key) {
    const w = c && c.wallComb && c.wallComb.walls && c.wallComb.walls[key];
    const d = defaultComb();
    if (!w) return d;
    return {
        use: { ...d.use, ...(w.use || {}) },
        factored: Array.isArray(w.factored) ? w.factored : d.factored,
        service: Array.isArray(w.service) ? w.service : d.service,
    };
}
function rowFactors(row, use) {
    const f = {};
    for (const k of ['D', 'L', 'H', 'E']) f[k] = use[k] === false ? 0 : n0(row.f && row.f[k]);
    return f;
}

// ── 형상 ─────────────────────────────────────────────────────────────

function geometry(r, fill) {
    const s = wallSection(r);
    const m = (v) => v / 1000;
    const B = m(s.W), WH = m(s.WH);
    const xb0 = m(s.stem.xb0), xb1 = m(s.stem.xb1), xt0 = m(s.stem.xt0), xt1 = m(s.stem.xt1);
    const BF1 = m(s.BF1), BF2 = m(s.BF2), BB1 = m(s.BB1), BB2 = m(s.BB2), yJ = m(s.yJ);
    const poly = s.poly.map(([x, y]) => [m(x), m(y)]);
    const keyPoly = s.key ? s.key.map(([x, y]) => [m(x), m(y)]) : null;
    const ftop = (x) => (x <= xb0 ? BF2 + (BF1 - BF2) * x / (xb0 || 1) : x >= xb1 ? BB1 + (BB2 - BB1) * (x - xb1) / ((B - xb1) || 1) : yJ);
    const backX = (y) => xb0 + (xt0 - xb0) * (y - BF1) / ((WH - BF1) || 1);
    const frontX = (y) => xb1 + (xt1 - xb1) * (y - BB1) / ((WH - BB1) || 1);
    const fl = fill || {};
    const SD = m(n0(fl.SD)), SL = m(n0(fl.SL)), SH = m(n0(fl.SH)), s1 = n0(fl.slope1) || 1.5;
    const inf = !!fl.inf;
    // 배면 지표 (u = 벽체 상단 배면에서 뒤쪽으로의 거리)
    const ysU = (u) => {
        const base = WH - SD;
        if (u <= SL) return base;
        let rise = (u - SL) / s1;
        if (!inf) rise = Math.min(rise, SH);
        return base + rise;
    };
    const ys = (x) => ysU(xt0 - x);
    const beta = inf ? Math.atan(1 / s1) / RAD : 0;
    return { s, B, WH, xb0, xb1, xt0, xt1, BF1, BF2, BB1, BB2, yJ, poly, keyPoly, ftop, backX, frontX, ysU, ys, beta, SD, SL, SH, s1, inf, hStem: WH - yJ, B1: B - xb1, B2: xb0, B3: xb1 - xb0 };
}

/** 뒷굽 위 흙 (x0 ~ x1 구간): { A, x (도심) } */
function soilOnHeel(G, x0 = 0, x1 = G.xt0, n = 300) {
    let A = 0, Mx = 0;
    const dx = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * dx;
        let bot = G.ftop(Math.min(x, G.xb0));
        if (x > G.xb0) {
            // 벽체 배면 아래 (배면이 앞쪽으로 기운 경우의 삼각형 부분)
            const t = (x - G.xb0) / ((G.xt0 - G.xb0) || 1);
            bot = G.BF1 + t * (G.WH - G.BF1);
        }
        const h = Math.max(0, G.ys(x) - bot);
        A += h * dx; Mx += h * dx * x;
    }
    return { A, x: A > 0 ? Mx / A : (x0 + x1) / 2 };
}

// ── 자중 분할 (사각형·삼각형) ────────────────────────────────────────
// 영역을 꺾임점마다 연직 띠로 자르면 띠 안에서 하변·상변이 직선(사다리꼴)이 되고,
// 사다리꼴은 사각형 + 직각삼각형으로 나뉜다. 안정검토의 구체 자중·뒷굽 위 흙은 이 분할표의 합계를 쓴다.
//   콘크리트: 기초 (하면 ~ 기초 상면선: 뒷굽 BF2→BF1, 벽체 아래 min(BF1,BB1), 앞굽 BB1→BB2) — 전폭 저판 사각형 + 경사부,
//            벽체 (기초 상면 위, 배면·전면 경사 포함), 헌치 삼각형, 활동방지벽 사각형.
//   흙: 뒷굽 끝(x=0) ~ 벽체 배면 상단(xt0), 하변 = 기초 상면선·벽체 배면, 상변 = 배면 지표. 헌치가 차지한 부분은 (−) 공제.

const EPS = 1e-9;
const CIRC = (i) => (i < 20 ? String.fromCharCode(0x2460 + i) : `(${i + 1})`);

/** x-단조 다각형을 연직선 x 로 자른 구간 [하단, 상단] */
function sliceAt(poly, x) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
        if (x1 === x2 || (x1 - x) * (x2 - x) > 0) continue;
        const y = y1 + (y2 - y1) * (x - x1) / (x2 - x1);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
    }
    return lo <= hi ? [lo, hi] : [0, 0];
}

/** 띠 안에서 직선인 함수 fn 의 양 끝 값 (띠 내부 두 점에서 외삽 → 꺾임점 경계값의 모호함 회피) */
function ends(fn, xa, xb) {
    const a1 = xa + (xb - xa) / 4, a2 = xb - (xb - xa) / 4;
    const v1 = fn(a1), v2 = fn(a2), k = (v2 - v1) / (a2 - a1);
    return [v1 - k * (a1 - xa), v2 + k * (xb - a2)];
}

/** 정렬된 꺾임점 xs 에 g(x) = 0 인 점을 더한다 (g 는 띠마다 직선) */
function addRoots(xs, g) {
    const out = [xs[0]];
    for (let i = 1; i < xs.length; i++) {
        const xa = xs[i - 1], xb = xs[i];
        if (xb - xa > EPS) {
            const [ga, gb] = ends(g, xa, xb);
            if ((ga > EPS && gb < -EPS) || (ga < -EPS && gb > EPS)) out.push(xa + (xb - xa) * ga / (ga - gb));
        }
        out.push(xb);
    }
    return out;
}

const uniqSorted = (xs, x0, x1) => [...new Set(xs.filter(x => x >= x0 - EPS && x <= x1 + EPS).map(x => Math.min(x1, Math.max(x0, x))))]
    .sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-7);

function rectPiece(x0, x1, y0, y1) {
    return { shape: '사각형', b: x1 - x0, h: y1 - y0, A: (x1 - x0) * (y1 - y0), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
}
/** 삼각형 (b = 수평폭, h = 2A/b — 연직변이 있으면 그 길이) */
function triPiece(pts) {
    const A = polyArea(pts);
    const xs = pts.map(p => p[0]);
    const b = Math.max(...xs) - Math.min(...xs);
    return { shape: '삼각형', b, h: b > EPS ? 2 * A / b : 0, A, cx: (xs[0] + xs[1] + xs[2]) / 3, cy: (pts[0][1] + pts[1][1] + pts[2][1]) / 3, pts };
}

/** 띠 [xa, xb] 의 하변 (bl→br) ~ 상변 (tl→tr) 사다리꼴 → 사각형 + 삼각형 */
function stripPieces(xa, xb, bl, br, tl, tr) {
    const out = [];
    if (xb - xa < EPS) return out;
    const bM = Math.max(bl, br), tm = Math.min(tl, tr);
    if (bM <= tm + EPS) {
        if (tm - bM > EPS) out.push(rectPiece(xa, xb, bM, tm));
        if (Math.abs(tl - tr) > EPS) out.push(triPiece(tl < tr ? [[xa, tl], [xb, tl], [xb, tr]] : [[xa, tl], [xa, tr], [xb, tr]]));
        if (Math.abs(bl - br) > EPS) out.push(triPiece(bl < br ? [[xa, bl], [xa, br], [xb, br]] : [[xa, bl], [xb, bl], [xb, br]]));
    } else {
        // 상·하변이 함께 기울어 사각형이 안 생기는 띠: 대각선으로 두 삼각형
        if (tr - br > EPS) out.push(triPiece([[xa, bl], [xb, br], [xb, tr]]));
        if (tl - bl > EPS) out.push(triPiece([[xa, bl], [xb, tr], [xa, tl]]));
    }
    return out;
}

/** 이웃한 같은 높이 구간의 사각형을 하나로 */
function mergeRects(list) {
    const out = [];
    for (const p of list) {
        const q = out[out.length - 1];
        if (q && q.shape === '사각형' && p.shape === '사각형' && Math.abs(q.pts[1][0] - p.pts[0][0]) < 1e-7
            && Math.abs(q.pts[0][1] - p.pts[0][1]) < 1e-7 && Math.abs(q.pts[2][1] - p.pts[2][1]) < 1e-7) {
            out[out.length - 1] = rectPiece(q.pts[0][0], p.pts[1][0], q.pts[0][1], q.pts[2][1]);
        } else out.push(p);
    }
    return out;
}

/** 영역 { bot(x) ≤ y ≤ top(x) } (x0~x1) 을 띠별로 분할 */
function regionPieces(xs0, x0, x1, bot, top) {
    const xs = addRoots(uniqSorted([x0, x1, ...xs0], x0, x1), (x) => top(x) - bot(x));
    const list = [];
    for (let i = 1; i < xs.length; i++) {
        const xa = xs[i - 1], xb = xs[i];
        if (xb - xa < 1e-7) continue;
        const [bl, br] = ends(bot, xa, xb), [tl, tr] = ends(top, xa, xb);
        if (tl - bl < EPS && tr - br < EPS) continue;
        list.push(...stripPieces(xa, xb, bl, br, Math.max(tl, bl), Math.max(tr, br)));
    }
    return mergeRects(list);
}

/**
 * 구체 자중·뒷굽 위 흙의 사각형/삼각형 분할표.
 * 반환 { pieces: [{ no, mark, kind:'conc'|'soil', part, shape, b, h, A, g, W, x (앞굽 끝에서), y, M (=W·x), pts }],
 *        conc: { A, W, x, y }, soil: { A, W, x, y }, total: { W, M, x } }  (conc/soil 의 x 는 뒷굽 끝 기준 좌표)
 */
function weightPieces(G, P) {
    const { B, xb0, xb1, xt0, xt1, WH, BF1, BF2, BB1, BB2 } = G;
    const yF = Math.min(BF1, BB1);
    const heelTop = (x) => BF2 + (BF1 - BF2) * x / (xb0 || 1);
    const ftop = (x) => (x <= xb0 ? heelTop(x) : x >= xb1 ? BB1 + (BB2 - BB1) * (x - xb1) / ((B - xb1) || 1) : yF);
    const backL = (x) => BF1 + (WH - BF1) * (x - xb0) / ((xt0 - xb0) || 1);
    const frontL = (x) => BB1 + (WH - BB1) * (xb1 - x) / ((xb1 - xt1) || 1);
    const stemTop = (x) => (x < xt0 ? backL(x) : x > xt1 ? frontL(x) : WH);
    // 헌치 (wallSection 다각형: 헌치가 있으면 꼭짓점 9개, [6] 배면쪽, [7] 뒷굽쪽)
    const hp = G.poly.length === 9 ? [G.poly[7], [xb0, BF1], G.poly[6]] : null;
    const conc = [];
    // 기초: 전폭 저판 + 경사부
    const h0 = Math.min(yF, BF2, BB2);
    if (h0 > EPS) conc.push({ ...rectPiece(0, B, 0, h0), part: '기초 저판' });
    conc.push(...regionPieces([xb0, xb1], 0, B, () => h0, ftop).map(p => ({ ...p, part: p.cx < xb0 ? '뒷굽' : p.cx > xb1 ? '앞굽' : '기초' })));
    // 벽체 (기초 상면 위)
    conc.push(...regionPieces([xt0, xt1], xb0, xb1, () => yF, stemTop).map(p => ({ ...p, part: '벽체' })));
    if (hp) conc.push({ ...triPiece(hp), part: '헌치' });
    if (G.keyPoly) {
        const kx = G.keyPoly.map(p => p[0]), ky = G.keyPoly.map(p => p[1]);
        conc.push({ ...rectPiece(Math.min(...kx), Math.max(...kx), Math.min(...ky), Math.max(...ky)), part: '활동방지벽' });
    }
    // 검산: 분할 합계 = 다각형 면적 (전면이 앞굽 쪽으로 넘어간 형상 등 분할이 안 맞으면 다각형 하나로)
    const aPoly = polyArea(G.poly) + (G.keyPoly ? polyArea(G.keyPoly) : 0);
    if (Math.abs(conc.reduce((a, p) => a + p.A, 0) - aPoly) > 1e-6 * Math.max(1, aPoly)) {
        const c = polyCentroid(G.poly);
        conc.splice(0, conc.length, { shape: '다각형', b: B, h: WH, A: polyArea(G.poly), cx: c.x, cy: c.y, pts: G.poly, part: '구체 전체' });
        if (G.keyPoly) {
            const ck = polyCentroid(G.keyPoly);
            conc.push({ shape: '다각형', b: 0, h: 0, A: polyArea(G.keyPoly), cx: ck.x, cy: ck.y, pts: G.keyPoly, part: '활동방지벽' });
        }
    }
    // 뒷굽 위 흙 (지표 꺾임점: 벽체 상단 배면에서 SL, SL + SH·경사)
    const gx = [xt0 - n0(G.SL)];
    if (!G.inf) gx.push(xt0 - n0(G.SL) - n0(G.SH) * G.s1);
    const soilBot = (x) => (x <= xb0 ? heelTop(x) : backL(x));
    let soil = xt0 > EPS ? regionPieces([xb0, ...gx], 0, xt0, soilBot, G.ys).map(p => ({ ...p, part: '뒷채움 흙' })) : [];
    if (hp) {
        if (hp.every(([x, y]) => y <= G.ys(x) + EPS)) {
            const t = triPiece(hp);
            soil.push({ ...t, A: -t.A, part: '헌치 공제 (−)' });
        } else {
            // 헌치가 지표 위로 나오는 경우: 콘크리트 상면(헌치 포함)을 하변으로 다시 분할
            const top = (x) => sliceAt(G.poly, x)[1];
            soil = regionPieces([...G.poly.map(p => p[0]), ...gx], 0, xt0, top, G.ys).map(p => ({ ...p, part: '뒷채움 흙' }));
        }
    }
    // 표 (x = 앞굽 끝에서의 거리)
    const pieces = [];
    const sum = (list, kind, g) => {
        let A = 0, Ax = 0, Ay = 0;
        for (const p of list) {
            if (Math.abs(p.A) < 1e-9) continue;
            const W = p.A * g, x = B - p.cx;
            pieces.push({ ...p, no: pieces.length + 1, mark: CIRC(pieces.length), kind, g, W, x, y: p.cy, M: W * x });
            A += p.A; Ax += p.A * p.cx; Ay += p.A * p.cy;
        }
        return { A, W: A * g, x: A > 0 ? Ax / A : 0, y: A > 0 ? Ay / A : 0 };
    };
    const cc = sum(conc, 'conc', P.gc);
    const so = sum(soil, 'soil', P.gamma);
    const W = pieces.reduce((a, p) => a + p.W, 0), M = pieces.reduce((a, p) => a + p.M, 0);
    // 그림용 외곽 (구체 다각형, 활동방지벽, 뒷굽 위 지표)
    const ground = uniqSorted([0, xt0, ...gx], 0, xt0).map(x => [x, G.ys(x)]);
    return { pieces, conc: cc, soil: so, total: { W, M, x: W > 0 ? M / W : 0 }, outline: { B, poly: G.poly, key: G.keyPoly, ground } };
}

/**
 * 자중 분할 그림 (Drawing, mm, y 위로 +). sec = wallDesign 결과의 단면 하나.
 * 조각마다 외곽선·해치·번호(①②…), 들어가지 않는 번호는 지시선으로 밖에 둔다. 앞굽 끝 = 모멘트 기준점, x̄ = 자중 합력 위치.
 */
export function weightFigure(sec) {
    const wt = sec && sec.weight;
    if (!wt || !wt.pieces.length) return null;
    const K = 1000;
    const { B, poly, key, ground } = wt.outline;
    const Bm = B * K;
    const Hmax = Math.max(...poly.map(p => p[1]), ...ground.map(p => p[1])) * K;
    const d = new Drawing({ textHeight: Math.max(80, Math.max(Bm, Hmax) / 28) });
    const th = d.textHeight, r = th * 0.85;
    const T = (pts) => pts.map(([x, y]) => [x * K, y * K]);
    const yLow = (key ? Math.min(...key.map(p => p[1])) : 0) * K;
    // 조각 (흙 → 콘크리트 순으로 해치, 공제 조각은 번호만)
    for (const p of wt.pieces) {
        if (p.A < 0) continue;
        const soil = p.kind === 'soil';
        d.hatch(T(p.pts), { color: soil ? COLOR.ORANGE : COLOR.GRAY, layer: 'HATCH', pattern: soil ? 'dots' : 'ansi31', spacing: th * 1.2 });
        d.pline(T(p.pts), { color: soil ? COLOR.ORANGE : COLOR.CYAN, layer: soil ? 'SOIL' : 'PIECE', closed: true, dash: soil ? 'dash' : null });
    }
    d.pline(T(poly), { color: COLOR.WHITE, layer: 'CONC', closed: true, width: 2 });
    if (key) d.pline(T(key), { color: COLOR.WHITE, layer: 'CONC', closed: true, width: 2 });
    if (ground.length > 1) d.pline(T(ground), { color: COLOR.GREEN, layer: 'GROUND', width: 2 });
    // 번호: 조각 안에 원이 들어가면 도심에, 아니면 지시선
    const placed = [];
    const free = (x, y) => placed.every(([px, py]) => Math.hypot(px - x, py - y) >= r * 2.2);
    // 지시선 번호 자리: 원 둘레가 한 조각 안에 다 들거나, 어느 조각과도 겹치지 않아야 한다
    const regions = [...wt.pieces.filter(p => p.A > 0).map(p => T(p.pts)), ...(key ? [T(key)] : [])];
    const pip = (pts, x, y) => {
        let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
    };
    const clear = (x, y) => {
        const ring = [[x, y], ...Array.from({ length: 16 }, (_, i) => [x + r * 1.15 * Math.cos(i * Math.PI / 8), y + r * 1.15 * Math.sin(i * Math.PI / 8)])];
        const hit = regions.map(g => ring.filter(([u, v]) => pip(g, u, v)).length);
        if (y - r * 1.2 < yLow - th * 1.5) return false;                                         // 치수선 자리
        if (x + r > Bm && x - r < Bm + th * 8 && y - r < th * 0.5 && y + r > -th * 1.4) return false;   // 기준점 문자
        return hit.every(n => n === 0) || hit.some(n => n === ring.length);
    };
    const inside = (pts, x, y) => {
        for (let i = 0; i < pts.length; i++) {
            const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
            const L = Math.hypot(x2 - x1, y2 - y1) || 1;
            if (((x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)) / L * Math.sign(polySign(pts)) < r * 1.05) return false;
        }
        return true;
    };
    const late = [];
    for (const p of wt.pieces) {
        const pts = T(p.pts), cx = p.cx * K, cy = p.cy * K;
        if (p.A > 0 && inside(pts, cx, cy) && free(cx, cy)) { d.bubble(cx, cy, String(p.no), { r, color: p.kind === 'soil' ? COLOR.ORANGE : COLOR.YELLOW }); placed.push([cx, cy]); }
        else late.push({ p, cx, cy });
    }
    const midX = (poly[4][0] + poly[5][0]) / 2 * K;   // 벽체 상단 중앙: 이보다 왼쪽 조각은 왼쪽으로 지시선
    for (const { p, cx, cy } of late) {
        const xs = p.pts.map(q => q[0] * K), ys = p.pts.map(q => q[1] * K);
        const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
        const low = p.kind === 'conc' && cy < 0.2 * Hmax;
        const dirs = wide ? [low ? [0, -1] : [0, 1], [cx > midX ? 1 : -1, 0], [0, low ? 1 : -1]] : [[cx > midX ? 1 : -1, 0], [cx > midX ? -1 : 1, 0], [0, 1]];
        let at = null;
        for (let k = 2; k < 24 && !at; k++) {
            for (const [ux, uy] of dirs) {
                const x = cx + ux * k * r * 1.6, y = cy + uy * k * r * 1.6;
                if (free(x, y) && clear(x, y)) { at = [x, y, ux, uy]; break; }
            }
        }
        if (!at) at = [cx + r * 3, cy + r * 3, 0.7, 0.7];
        const [x, y, ux, uy] = at;
        const col = p.A < 0 ? COLOR.RED : p.kind === 'soil' ? COLOR.ORANGE : COLOR.YELLOW;
        const L = Math.hypot(ux, uy) || 1;
        d.circle(cx, cy, r * 0.12, { color: col, layer: 'MARK', fill: col });
        d.line(cx, cy, x - ux / L * r, y - uy / L * r, { color: col, layer: 'MARK' });
        d.bubble(x, y, String(p.no), { r, color: col });
        placed.push([x, y]);
    }
    // 기준점 (앞굽 끝) 과 합력 위치 x̄
    const xbar = wt.total.x * K;
    const yb = yLow - th * 3;
    d.line(Bm - xbar, yLow - th * 0.5, Bm - xbar, Hmax + th, { color: COLOR.RED, layer: 'DIM', dash: 'center' });
    d.text(Bm - xbar, Hmax + th * 1.3, `ΣW = ${wt.total.W.toFixed(2)} kN/m`, { color: COLOR.RED, h: th, layer: 'TEXT' });
    d.dimH(Bm - xbar, Bm, yLow, yb, `x̄ = ${(wt.total.x).toFixed(3)} m`);
    d.circle(Bm, 0, r * 0.35, { color: COLOR.RED, layer: 'MARK', fill: COLOR.RED });
    d.text(Bm + th * 0.6, -th * 0.2, '기준점 (앞굽 끝)', { color: COLOR.RED, h: th * 0.85, align: 'left', valign: 'top', layer: 'TEXT' });
    d.dimH(0, Bm, yLow, yb - th * 3);
    if (sec.label) d.text(Bm / 2, yb - th * 6.5, `${sec.label} 자중 분할`, { color: COLOR.GREEN, h: th * 1.1, layer: 'TEXT' });
    return d;
}

/** 자중 분할표 머리글 / 열별 소수 자리 (계산서 HTML·Excel 공용) */
export const WEIGHT_HEAD = ['구분', '부위', '형상', '치수 b × h (m)', '면적 A (m²)', '단위중량 γ (kN/m³)', '중량 W (kN/m)', '거리 x (m)', '모멘트 W·x (kN·m/m)'];
export const WEIGHT_DIGITS = [null, null, null, null, 3, 1, 2, 3, 2];

/** 자중 분할표 행: 조각 → 소계(콘크리트, 흙) → 합계. 숫자는 그대로 (null = 빈칸), kind: 'piece' | 'sub' | 'total' */
export function weightRows(wt) {
    const dim = (p) => (p.shape === '사각형' ? `${f3(p.b)} × ${f3(p.h)}` : p.shape === '삼각형' ? `½ × ${f3(p.b)} × ${f3(p.h)}` : '-');
    const rows = wt.pieces.map(p => ({ kind: 'piece', cells: [p.mark, p.part, p.shape, dim(p), p.A, p.g, p.W, p.x, p.M] }));
    const sub = (kind, name, c) => {
        const M = wt.pieces.filter(p => p.kind === kind).reduce((a, p) => a + p.M, 0);
        if (c.A) rows.push({ kind: 'sub', cells: ['소계', name, '', '', c.A, null, c.W, c.W ? M / c.W : null, M] });
    };
    sub('conc', '콘크리트', wt.conc);
    sub('soil', '뒷채움 흙', wt.soil);
    rows.push({ kind: 'total', cells: ['합계', '', '', '', null, null, wt.total.W, wt.total.x, wt.total.M] });
    return rows;
}

/** 다각형 부호 면적 (+ 반시계) */
function polySign(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a || 1;
}

// ── 토압 ─────────────────────────────────────────────────────────────

/**
 * 연직 가상배면 (u = uPlane, 하단 yBase) 에 작용하는 토압.
 * method: 'Rankine' | 'Coulomb' | '시행쐐기토압' (평상시), seisMethod: 'Mononobe Okabe' | '시행쐐기토압'
 * 반환: { H, K, Ph, Pv, yP, Pqh, Pqv, yq, dPh, dPv, yE, KAE, qEq, lines }  (y 는 yBase 위 높이)
 */
function earthPressure(G, P, uPlane, yBase, delta, deltaE, kh) {
    const H = Math.max(0, G.ysU(uPlane) - yBase);
    const { gamma, phi, q, method, seisMethod, earthP } = P;
    const beta = G.beta;
    const lines = [];
    const out = { H, K: 0, Ph: 0, Pv: 0, yP: H / 3, Pqh: 0, Pqv: 0, yq: H / 2, dPh: 0, dPv: 0, yE: 0.6 * H, KAE: 0, qEq: 0, lines };
    if (H <= 1e-6) return out;
    const wedge = (dlt, khv, qq) => trialWedge(G, uPlane, yBase, phi, dlt, gamma, qq, khv);
    let incl = 0;   // 토압 경사각 (수평에서)
    if (earthP === '정지') {
        out.K = K0(phi); incl = 0;
        lines.push(`정지토압계수 K0 = 1 − sin${phi}° = ${f3(out.K)}`);
    } else if (method === 'Coulomb') {
        out.K = KaCoulomb(phi, delta, beta, 0); incl = delta;
        lines.push(`Coulomb 주동토압계수 Ka = ${f3(out.K)} (φ=${phi}°, δ=${f2(delta)}°, β=${f2(beta)}°)`);
    } else if (method === '시행쐐기토압') {
        const w0 = wedge(delta, 0, 0);
        out.K = 2 * w0.P / (gamma * H * H); incl = delta;
        lines.push(`시행쐐기: 최대 토압 P = ${f2(w0.P)} kN (활동면각 ω = ${f2(w0.w)}°), 등가 K = ${f3(out.K)}`);
    } else {
        out.K = KaRankine(phi, beta); incl = beta;
        lines.push(`Rankine 주동토압계수 Ka = ${f3(out.K)} (φ=${phi}°, β=${f2(beta)}°)`);
    }
    // 유한 성토사면 (β=0 으로 본 경우): 쐐기폭 안의 성토 증가분을 등가 상재하중으로
    if (!beta && method !== '시행쐐기토압') {
        const Lw = H * Math.tan((45 - phi / 2) * RAD);
        let s = 0; const n = 50;
        for (let i = 0; i < n; i++) s += Math.max(0, G.ysU(uPlane + (i + 0.5) * Lw / n) - G.ysU(uPlane));
        out.qEq = gamma * s / n;
        if (out.qEq > 1e-6) lines.push(`배면 성토 등가상재하중 qe = γ·Δh(평균) = ${f2(out.qEq)} kN/m² (토압으로 취급)`);
    }
    const P0 = 0.5 * gamma * H * H * out.K + out.K * out.qEq * H;
    out.Ph = P0 * Math.cos(incl * RAD); out.Pv = P0 * Math.sin(incl * RAD);
    out.yP = (0.5 * gamma * H * H * out.K * H / 3 + out.K * out.qEq * H * H / 2) / (P0 || 1);
    // 상재하중
    let Pq;
    if (method === '시행쐐기토압' && earthP !== '정지') Pq = wedge(delta, 0, q).P - wedge(delta, 0, 0).P;
    else Pq = out.K * q * H;
    out.Pqh = Pq * Math.cos(incl * RAD); out.Pqv = Pq * Math.sin(incl * RAD);
    // 지진시 토압 증분
    if (kh > 0) {
        let dP;
        if (seisMethod === '시행쐐기토압') {
            dP = wedge(deltaE, kh, q).P - wedge(deltaE, 0, q).P;
            out.KAE = 2 * wedge(deltaE, kh, 0).P / (gamma * H * H);
            lines.push(`지진시 시행쐐기 (kh=${f3(kh)}): 등가 KAE = ${f3(out.KAE)}, 증분 ΔPAE = ${f2(dP)} kN`);
        } else {
            out.KAE = KaeMO(phi, deltaE, beta, 0, kh, 0);
            const KA = KaCoulomb(phi, deltaE, beta, 0);
            if (!isFinite(out.KAE)) { out.KAE = KA; lines.push('※ φ − ψ − β < 0: Mononobe-Okabe 적용 불가 (증분 0)'); }
            dP = (out.KAE - KA) * (0.5 * gamma * H * H + (q + out.qEq) * H);
            lines.push(`Mononobe-Okabe KAE = ${f3(out.KAE)} (kh=${f3(kh)}, δ=${f2(deltaE)}°), KA = ${f3(KA)}, ΔPAE = (KAE−KA)(½γH² + qH) = ${f2(dP)} kN`);
        }
        out.dPh = Math.max(0, dP) * Math.cos(deltaE * RAD); out.dPv = Math.max(0, dP) * Math.sin(deltaE * RAD);
    }
    return out;
}

/** 시행쐐기 — 연직배면, 임의 지표, 상재하중 q, 수평진도 kh. 반환 { P (kN, δ 경사 합력), w (°) } */
function trialWedge(G, uPlane, yBase, phi, delta, gamma, q, kh) {
    const H = G.ysU(uPlane) - yBase;
    let best = { P: 0, w: 45 + phi / 2 };
    for (let w = phi + 0.5; w < 89.6; w += 0.5) {
        const t = Math.tan(w * RAD);
        const umax = Math.max(H / t * 3 + 1, 1);
        const n = 200, du = umax / n;
        let A = 0, width = 0;
        for (let i = 0; i < n; i++) {
            const u = (i + 0.5) * du;
            const hh = G.ysU(uPlane + u) - (yBase + u * t);
            if (hh > 0) { A += hh * du; width = (i + 1) * du; }
        }
        const W = gamma * A + q * width;
        const P = W * (Math.sin((w - phi) * RAD) + kh * Math.cos((w - phi) * RAD)) / Math.cos((w - phi - delta) * RAD);
        if (P > best.P) best = { P, w };
    }
    return best;
}

// ── 지반반력 ─────────────────────────────────────────────────────────

/** 지반반력 분포 q(x) (x: 뒷굽 끝 0 기준). V 연직합력, xr: 앞굽 끝에서 합력 위치 */
function reaction(B, V, xr) {
    const e = B / 2 - xr;     // + : 앞굽 쪽 편심
    if (V <= 0) return { e, q1: 0, q2: 0, at: () => 0 };
    if (Math.abs(e) <= B / 6) {
        const qt = V / B * (1 + 6 * e / B), qh = V / B * (1 - 6 * e / B);
        return { e, q1: qt, q2: qh, at: (x) => qh + (qt - qh) * x / B };
    }
    if (e > 0) {
        const Lc = 3 * xr, qm = 2 * V / Lc;
        return { e, q1: qm, q2: 0, Lc, at: (x) => { const t = B - x; return t < Lc ? qm * (1 - t / Lc) : 0; } };
    }
    const xh = B - xr, Lc = 3 * xh, qm = 2 * V / Lc;
    return { e, q1: 0, q2: qm, Lc, at: (x) => (x < Lc ? qm * (1 - x / Lc) : 0) };
}

function integ(fn, a, b, n = 200) {
    if (b <= a) return { F: 0, M: 0 };
    const dx = (b - a) / n;
    let F = 0, M = 0;
    for (let i = 0; i < n; i++) { const x = a + (i + 0.5) * dx; const v = fn(x) * dx; F += v; M += v * x; }
    return { F, x: F ? M / F : (a + b) / 2 };
}

// ── 메인 ─────────────────────────────────────────────────────────────

function params(p) {
    const d = getDesign(p);
    const w = d.wall;
    const phiF = n0(w.phiFound) || phiFromN(n0(w.Nfound));
    const seis = d.seisBox || {};
    return {
        d, w,
        fck: n0(w.fck) || 24, fy: n0(w.fy) || 300, code: d.env.kci, gc: n0(d.env.gRC) || 24.5,
        gamma: n0(w.gBack) || 19, phi: n0(w.phiBack) || 30, q: n0(w.surcharge),
        method: w.kNormal || 'Rankine', seisMethod: w.kSeis || 'Mononobe Okabe', earthP: w.earthP || '주동',
        surFactor: w.surFactor || '토압계수',
        delta: {
            stabN: deltaValue(w.delta && w.delta.stabN, n0(w.phiBack) || 30), stabE: deltaValue(w.delta && w.delta.stabE, n0(w.phiBack) || 30),
            wallN: deltaValue(w.delta && w.delta.wallN, n0(w.phiBack) || 30), wallE: deltaValue(w.delta && w.delta.wallE, n0(w.phiBack) || 30),
        },
        fs: { overN: n0(w.fsOverN) || 2, overE: n0(w.fsOverE) || 1.5, slideN: n0(w.fsSlideN) || 1.5, slideE: n0(w.fsSlideE) || 1.2 },
        found: {
            gamma: n0(w.gFound) || 19, N: n0(w.Nfound), c: n0(w.cFound), qu: n0(w.qu), qaMax: n0(w.qaMax) || 0, method: w.qaFormula || 'Hansen',
            phi: phiF, gEmbed: n0(w.gEmbed) || 19, Df: n0(w.Df), type: w.foundType || '직접기초', rubbleT: n0(w.rubbleT),
        },
        seisOn: !!seis.on, A: n0(seis.A), kh: seis.on ? 0.5 * n0(seis.A) : 0,
        heelMoment: w.heelMoment || '벽체하단의 모멘트적용',
        shearToe: w.shearToe || '저판유효깊이(d)의 1/2 떨어진 지점', shearHeel: w.shearHeel || '저판벽체연단지점',
        ratioWall: n0(w.ratioWall) || 0.0015, ratioFoot: n0(w.ratioFoot) || 0.0015,
        env: ({ 건조환경: '건조', 습윤환경: '습윤', 부식성환경: '부식성', 고부식성환경: '고부식성' })[d.env.corrosion] || '건조',
    };
}

/** 단면 하나의 작용력 목록: [{ name, cat, V, H, x (연직력 위치), y (수평력 높이) }] */
function forceItems(G, P, wingLen) {
    const items = [];
    // 자중: 사각형·삼각형 분할표의 합계 (계산서 '자중 및 합력 위치' 표와 같은 값)
    const wp = weightPieces(G, P);
    const cc = wp.conc;
    items.push({ name: '구체 자중', cat: 'D', V: cc.W, H: 0, x: cc.x, y: cc.y });
    const so = wp.soil;
    const Ws = so.W;
    items.push({ name: '뒷굽 위 흙', cat: 'D', V: Ws, H: 0, x: so.x, y: 0 });
    if (P.q > 0) items.push({ name: '상재하중 (연직)', cat: 'L', V: P.q * G.xt0, H: 0, x: G.xt0 / 2, y: 0 });
    const ep = earthPressure(G, P, G.xt0, 0, P.delta.stabN, P.delta.stabE, P.kh);
    items.push({ name: '토압 (수평)', cat: 'H', V: 0, H: ep.Ph, x: 0, y: ep.yP });
    if (ep.Pv > 1e-9) items.push({ name: '토압 (연직)', cat: 'H', V: ep.Pv, H: 0, x: 0, y: 0 });
    const sc = P.surFactor === '각각하중계수' ? 'L' : 'H';
    if (ep.Pqh > 1e-9) items.push({ name: '상재하중 토압 (수평)', cat: sc, V: 0, H: ep.Pqh, x: 0, y: ep.yq });
    if (ep.Pqv > 1e-9) items.push({ name: '상재하중 토압 (연직)', cat: sc, V: ep.Pqv, H: 0, x: 0, y: 0 });
    if (P.kh > 0) {
        items.push({ name: '구체 관성력', cat: 'E', V: 0, H: P.kh * cc.W, x: 0, y: cc.y });
        // 흙 도심 높이 = 분할표의 도심
        items.push({ name: '뒷굽 위 흙 관성력', cat: 'E', V: 0, H: P.kh * Ws, x: 0, y: so.y });
        if (ep.dPh > 1e-9) items.push({ name: '지진시 토압 증분 (수평)', cat: 'E', V: 0, H: ep.dPh, x: 0, y: ep.yE });
        if (ep.dPv > 1e-9) items.push({ name: '지진시 토압 증분 (연직)', cat: 'E', V: ep.dPv, H: 0, x: 0, y: 0 });
    }
    void wingLen;
    return { items, conc: cc, soil: so, weight: wp, earth: ep };
}

function sums(G, items, f) {
    let V = 0, H = 0, Mr = 0, Mo = 0;
    for (const it of items) {
        const k = f[it.cat] || 0;
        if (!k) continue;
        V += k * it.V; H += k * it.H;
        Mr += k * it.V * (G.B - it.x);
        Mo += k * it.H * it.y;
    }
    return { V, H, Mr, Mo };
}

function stabilityCheck(G, P, items, row, use, wingLen) {
    const f = rowFactors(row, use);
    const seis = f.E > 0;
    const S = sums(G, items, f);
    const FSo = S.Mo > 0 ? S.Mr / S.Mo : Infinity;
    const xr = (S.Mr - S.Mo) / (S.V || 1);
    const e = G.B / 2 - xr;
    const eAllow = seis ? G.B / 3 : G.B / 6;
    // 활동
    const F = P.found;
    let mu = Math.tan(F.phi * RAD);
    if (F.type === '잡석기초') mu = Math.min(mu, 0.6);
    let Pp = 0;
    const key = G.s.key ? { T: n0(G.s.key[2] && -G.s.key[2][1]) / 1000 } : null;
    if (key && key.T > 0) {
        const Kp = KpRankine(F.phi);
        Pp = 0.5 * F.gEmbed * Kp * ((F.Df + key.T) ** 2 - F.Df ** 2);
    }
    const Hr = Math.max(0, S.V) * mu + F.c * G.B + Pp;
    const FSs = S.H > 0 ? Hr / S.H : Infinity;
    // 지지력
    const rc = reaction(G.B, S.V, xr);
    const qmax = Math.max(rc.q1, rc.q2);
    let qa, qaLine;
    if (F.qu > 0) { qa = F.qu / (seis ? 2 : 3); qaLine = `qa = qu/${seis ? 2 : 3} = ${f2(qa)}`; }
    else {
        const Be = Math.max(0.1, G.B - 2 * Math.abs(e));
        const ab = allowableBearing({ method: /식$/.test(F.method) ? F.method : `${F.method} 식`, B: Be, L: Math.max(Be, wingLen), Df: F.Df, g1: F.gamma, g2: F.gEmbed, c: F.c, phi: F.phi, cap: F.qaMax });
        qa = seis ? ab.qaE : ab.qaN;
        qaLine = `${ab.method} B'=${f3(Be)} m: qu = ${f2(ab.qu)}, qa = ${f2(qa)} kN/m²${ab.capped ? ` (상한 ${F.qaMax})` : ''}`;
    }
    const fsO = seis ? P.fs.overE : P.fs.overN, fsS = seis ? P.fs.slideE : P.fs.slideN;
    return {
        name: row.name, seis, f, ...S, FSo, fsO, okO: FSo >= fsO, e, eAllow, okE: Math.abs(e) <= eAllow,
        mu, Pp, Hr, FSs, fsS, okS: FSs >= fsS, q1: rc.q1, q2: rc.q2, qmax, qa, qaLine, okB: qmax <= qa,
        ok: FSo >= fsO && FSs >= fsS && qmax <= qa,
    };
}

/** 부재 단면력 (조합 계수 f) */
function memberForces(G, P, items, f, stemYs) {
    const out = {};
    // 벽체: 단면 y0 위의 토압 (가상배면이 아닌 벽체 배면, u = 0)
    for (const y0 of stemYs) {
        const ep = earthPressure(G, P, 0, y0, P.delta.wallN, P.delta.wallE, f.E > 0 ? P.kh : 0);
        const sc = P.surFactor === '각각하중계수' ? f.L : f.H;
        let M = f.H * ep.Ph * ep.yP + sc * ep.Pqh * ep.yq;
        let V = f.H * ep.Ph + sc * ep.Pqh;
        // 벽체 자중 (y0 위)
        const hh = G.WH - y0;
        const tb = G.frontX(y0) - G.backX(y0), tt = G.xt1 - G.xt0;
        const Wst = (tb + tt) / 2 * hh * P.gc;
        if (f.E > 0) {
            M += f.E * (ep.dPh * ep.yE + P.kh * Wst * hh * (tb + 2 * tt) / (3 * (tb + tt)));
            V += f.E * (ep.dPh + P.kh * Wst);
        }
        const N = f.D * Wst + f.H * ep.Pv;
        out[`stem@${y0.toFixed(3)}`] = { M, V, N, t: tb };
    }
    // 지반반력 (계수하중)
    const S = sums(G, items, f);
    const xr = (S.Mr - S.Mo) / (S.V || 1);
    const rc = reaction(G.B, S.V, xr);
    // 뒷굽: 0 ~ xs 하향 하중
    const heelDown = (xs) => {
        const conc = integ((x) => G.ftop(x) * P.gc, 0, xs);
        const so = soilOnHeel(G, 0, xs, 120);
        let F = f.D * conc.F + f.D * so.A * P.gamma;
        let M = f.D * conc.F * (xs - conc.x) + f.D * so.A * P.gamma * (xs - so.x);
        const wq = (P.surFactor === '각각하중계수' ? f.L : f.L) * P.q * xs;
        F += wq; M += wq * xs / 2;
        // 토압 연직성분 (가상배면 x = 0)
        const pv = items.filter(it => it.x === 0 && it.V > 0).reduce((a, it) => a + (f[it.cat] || 0) * it.V, 0);
        F += pv; M += pv * xs;
        const up = integ(rc.at, 0, xs);
        return { M: M - up.F * (xs - up.x), V: F - up.F };
    };
    const dHeel = G.BF1 * 1000 - COVER - 10;
    const xvH = P.shearHeel.includes('1/2') ? Math.max(0.01, G.xb0 - dHeel / 2000) : G.xb0;
    const hm = heelDown(G.xb0), hv = heelDown(xvH);
    out.heel = { M: hm.M, V: Math.abs(hv.V), N: 0, t: G.BF1 };
    // 앞굽: xs ~ B
    const toe = (xs) => {
        const conc = integ((x) => G.ftop(x) * P.gc, xs, G.B);
        const up = integ(rc.at, xs, G.B);
        return { M: up.F * (up.x - xs) - f.D * conc.F * (conc.x - xs), V: up.F - f.D * conc.F };
    };
    const dToe = G.BB1 * 1000 - COVER - 10;
    const xvT = P.shearToe.includes('1/2') ? Math.min(G.B - 0.01, G.xb1 + dToe / 2000) : G.xb1;
    out.toe = { M: toe(G.xb1).M, V: Math.abs(toe(xvT).V), N: 0, t: G.BB1 };
    out.reaction = rc;
    return out;
}

/** 철근 선택 (필요량 이상 최소) */
function pickBar(AsNeed) {
    let best = null;
    for (const ctc of CTCS) for (const dia of BARS) {
        const As = barArea(dia) * 1000 / ctc;
        if (As + 1e-6 < AsNeed) continue;
        if (!best || As < best.As - 1e-6) best = { dia, ctc, As };
    }
    return best || { dia: 'D32', ctc: 125, As: barArea('D32') * 8 };
}

function designMember(P, name, t, env, svc, ratio, given) {
    const h = t * 1000;
    const b = 1000;
    const Mu = Math.abs(env.M), Vu = env.V, Pu = Math.max(0, env.N || 0);
    let rb = given && given.dia && +given.ctc > 0 ? { dia: given.dia, ctc: +given.ctc, As: barArea(given.dia) * 1000 / +given.ctc, user: true } : null;
    const dTry = h - COVER - (rb ? barD(rb.dia) / 2 : 11);
    const sec = { b, d: dTry, fck: P.fck, fy: P.fy };
    const AsReq = requiredAs(sec, Mu * 1e6);
    const rhoMin = Math.max(0.25 * Math.sqrt(P.fck) / P.fy, 1.4 / P.fy);
    const AsNeed = Math.max(AsReq, Math.min(4 / 3 * AsReq, rhoMin * b * dTry), ratio * b * h);
    if (!rb) rb = pickBar(AsNeed);
    const db = barD(rb.dia);
    const d = h - COVER - db / 2;
    const chk = checkMember({ b, h, d, As: rb.As, fck: P.fck, fy: P.fy, code: P.code, Mu, Pu, Vu, Ms: Math.abs(svc || 0), cover: COVER - db / 2, dc: COVER, spacing: rb.ctc, env: P.env });
    const okCrack = chk.crack ? chk.crack.ok : true;
    return {
        name, h, d, Mu, Vu, Pu, Ms: Math.abs(svc || 0), combo: env.combo, comboV: env.comboV, rebar: rb, AsReq, AsNeed, AsMinRatio: ratio * b * h,
        phiMn: chk.phiMn_kNm, sfM: chk.sfM, okM: chk.okM && rb.As >= AsNeed - 1e-6, phiVc: chk.shear.phiVc / 1e3, okV: chk.okV, crack: chk.crack, okCrack,
        ok: chk.okM && chk.okV && okCrack && rb.As >= AsNeed - 1e-6,
    };
}

export function wallDesign(p, c, wingId) {
    const pos = (c.wings && c.wings.pos && c.wings.pos[wingId]) || defaultWingPosFor(c)[wingId];
    const name = `${WING_NAMES[wingId] || wingId}-옹벽식`;
    if (!pos || pos.type !== '옹벽식') return { key: wingId, name, ok: false, error: '옹벽식 날개벽이 아닙니다.', sections: [], lines: [] };
    const dim = (c.wings && c.wings.dim && c.wings.dim[wingId] && c.wings.dim[wingId].wall) || defaultWallDim(c);
    const rows = Array.isArray(dim.rows) && dim.rows.length ? dim.rows : defaultWallDim(c).rows;
    const P = params(p);
    const comb = wallCombOf(c, wingId);
    const wingLen = n0(pos.len) / 1000 || 5;
    const rebarIn = dim.rebar || {};
    const seisAllowed = (row) => P.seisOn || !(n0(row.f && row.f.E) > 0);
    const foundRows = (comb.service || []).filter(r => r.found !== false && seisAllowed(r));
    const wallRowsF = (comb.factored || []).filter(r => r.wall !== false && seisAllowed(r));
    const wallRowsS = (comb.service || []).filter(r => r.wall !== false && !(n0(r.f && r.f.E) > 0));
    const lines = [];
    const sections = rows.slice(0, 2).map((r, ri) => {
        const label = ri === 0 ? '시점 단면' : '종점 단면';
        const G = geometry(r, dim.fill);
        const F = forceItems(G, P, wingLen);
        const stability = foundRows.map(row => stabilityCheck(G, P, F.items, row, comb.use, wingLen));
        // 단면력
        const stemYs = [G.yJ];
        if (n0(r.addH) > 0 && n0(r.addH) < G.hStem) stemYs.push(G.yJ + n0(r.addH));
        const envOf = (rowsX, kind) => {
            const env = {};
            for (const row of rowsX) {
                const f = rowFactors(row, comb.use);
                const mf = memberForces(G, P, F.items, f, stemYs);
                for (const [k, v] of Object.entries(mf)) {
                    if (k === 'reaction') continue;
                    const e = env[k] || (env[k] = { M: 0, V: 0, N: 0, t: v.t, combo: null, comboV: null });
                    if (Math.abs(v.M) > Math.abs(e.M)) { e.M = v.M; e.N = v.N; e.combo = row.name; }
                    if (Math.abs(v.V) > Math.abs(e.V)) { e.V = Math.abs(v.V); e.comboV = row.name; }
                }
            }
            void kind;
            return env;
        };
        const envU = envOf(wallRowsF, 'U');
        const envS = envOf(wallRowsS, 'S');
        const members = [];
        const baseKey = `stem@${G.yJ.toFixed(3)}`;
        for (const k of Object.keys(envU)) {
            if (!k.startsWith('stem')) continue;
            const y0 = +k.split('@')[1];
            const nm = Math.abs(y0 - G.yJ) < 1e-6 ? '벽체 하단' : `벽체 (기초상단 +${f3(y0 - G.yJ)} m)`;
            members.push(designMember(P, nm, envU[k].t, envU[k], envS[k] && envS[k].M, P.ratioWall, rebarIn.stem));
        }
        if (envU.heel) {
            const e = { ...envU.heel };
            let note = '';
            if (P.heelMoment === '벽체하단의 모멘트적용' && envU[baseKey] && Math.abs(e.M) > Math.abs(envU[baseKey].M)) {
                note = `뒷굽 모멘트 ${f2(e.M)} > 벽체하단 ${f2(envU[baseKey].M)} → 벽체하단 모멘트 적용`;
                e.M = envU[baseKey].M;
            }
            const m = designMember(P, '뒷굽', e.t, e, envS.heel && envS.heel.M, P.ratioFoot, rebarIn.heel);
            m.note = note;
            members.push(m);
        }
        if (envU.toe) members.push(designMember(P, '앞굽', envU.toe.t, envU.toe, envS.toe && envS.toe.M, P.ratioFoot, rebarIn.toe));
        const ok = stability.every(s => s.ok) && members.every(m => m.ok);
        return {
            label, row: r, ok,
            geom: { B: G.B, WH: G.WH, hStem: G.hStem, B1: G.B1, B2: G.B2, B3: G.B3, BF1: G.BF1, BB1: G.BB1, beta: G.beta, key: !!G.s.key },
            conc: F.conc, soil: F.soil, weight: F.weight, earth: F.earth, items: F.items, stability, members,
        };
    });
    // 계산서 문장
    lines.push(`■ ${c.name || ''} ${name} 구조계산`);
    lines.push(`설계정수: fck = ${P.fck} MPa, fy = ${P.fy} MPa, γc = ${P.gc} kN/m³, 뒷채움 γ = ${P.gamma} kN/m³, φ = ${P.phi}°, 상재하중 q = ${P.q} kN/m²`);
    lines.push(`토압: ${P.earthP} / 평상시 ${P.method}, 지진시 ${P.seisMethod} (δ 안정 ${f2(P.delta.stabN)}°/${f2(P.delta.stabE)}°, 벽체 ${f2(P.delta.wallN)}°/${f2(P.delta.wallE)}°)`);
    lines.push(P.seisOn ? `지진: A = ${P.A}, kh = A/2 = ${f3(P.kh)}` : '지진: 내진해석 하지않음');
    lines.push(`기초지반: γ = ${P.found.gamma}, φ = ${f2(P.found.phi)}°, c = ${P.found.c}, Df = ${P.found.Df} m, ${P.found.type}`);
    for (const s of sections) {
        lines.push('', `[${s.label}] B = ${f3(s.geom.B)} m, H = ${f3(s.geom.WH)} m, 벽체높이 ${f3(s.geom.hStem)} m`);
        lines.push(...s.earth.lines.map(l => '  ' + l));
        if (s.weight) lines.push(`  자중 (단면 분할 ${s.weight.pieces.length}개): ΣW = ${f2(s.weight.total.W)} kN, ΣW·x = ${f2(s.weight.total.M)} kN·m, x̄ = ${f3(s.weight.total.x)} m (앞굽 끝에서)`);
        for (const st of s.stability) {
            lines.push(`  ${st.name}${st.seis ? ' (지진시)' : ''}: ΣV=${f2(st.V)} ΣH=${f2(st.H)} Mr=${f2(st.Mr)} Mo=${f2(st.Mo)} kN·m`);
            lines.push(`    전도 FS = ${f2(st.FSo)} ${st.okO ? '≥' : '<'} ${st.fsO} ${st.okO ? 'O.K' : 'N.G'}, e = ${f3(st.e)} m (허용 ${f3(st.eAllow)})`);
            lines.push(`    활동 FS = ${f2(st.FSs)} ${st.okS ? '≥' : '<'} ${st.fsS} ${st.okS ? 'O.K' : 'N.G'} (μ = ${f3(st.mu)}${st.Pp ? `, 활동방지벽 Pp = ${f2(st.Pp)}` : ''})`);
            lines.push(`    지지력 qmax = ${f2(st.qmax)} ${st.okB ? '≤' : '>'} qa = ${f2(st.qa)} kN/m² ${st.okB ? 'O.K' : 'N.G'}`);
        }
        for (const m of s.members) {
            lines.push(`  ${m.name}: h=${m.h.toFixed(0)} Mu=${f2(m.Mu)} Vu=${f2(m.Vu)} → ${m.rebar.dia}@${m.rebar.ctc} (As=${f2(m.rebar.As)}, 필요 ${f2(m.AsNeed)}) φMn=${f2(m.phiMn)} ${m.okM ? 'O.K' : 'N.G'}, φVc=${f2(m.phiVc)} ${m.okV ? 'O.K' : 'N.G'}${m.crack ? `, 균열 ${m.okCrack ? 'O.K' : 'N.G'}` : ''}`);
            if (m.note) lines.push(`    ※ ${m.note}`);
        }
    }
    return { key: wingId, name, ok: sections.every(s => s.ok), params: P, comb, sections, lines };
}

// ── 계산서 HTML ──────────────────────────────────────────────────────

const OK = (b) => (b ? '<span style="color:#060">O.K</span>' : '<span style="color:#c00;font-weight:bold">N.G</span>');

/** 자중 분할 그림 + 표 (모달 계산서) */
function weightHtml(s) {
    const wt = s.weight;
    let h = '<h3>자중 및 합력 위치 (단면 분할, 기준점 = 앞굽 끝)</h3>';
    const fig = weightFigure(s);
    if (fig) h += `<div style="text-align:center;margin:4px 0">${drawingToSvg(fig, { width: 560, maxHeight: 520 })}</div>`;
    h += `<table><tr>${WEIGHT_HEAD.map(t => `<th>${t}</th>`).join('')}</tr>`;
    for (const row of weightRows(wt)) {
        const st = row.kind === 'piece' ? '' : ' style="font-weight:bold"';
        h += `<tr${st}>${row.cells.map((v, i) => (WEIGHT_DIGITS[i] == null ? `<td>${v}</td>` : `<td class="num">${v == null ? '' : (+v).toFixed(WEIGHT_DIGITS[i])}</td>`)).join('')}</tr>`;
    }
    h += `</table><p>자중 합력 위치 x̄ = ΣW·x / ΣW = ${f2(wt.total.M)} / ${f2(wt.total.W)} = ${f3(wt.total.x)} m (앞굽 끝에서) — 안정검토의 구체 자중·뒷굽 위 흙 (D) 은 이 표의 소계를 사용</p>`;
    return h;
}

export function wallReportHtml(r) {
    if (r.error) return `<div class="report"><p>${r.name}: ${r.error}</p></div>`;
    const P = r.params;
    let h = `<h1>${r.name} 구조계산</h1>`;
    h += '<h2>1. 설계조건</h2><table>';
    h += `<tr><th>재료</th><td>fck = ${P.fck} MPa, fy = ${P.fy} MPa, γc = ${P.gc} kN/m³</td></tr>`;
    h += `<tr><th>뒷채움</th><td>γ = ${P.gamma} kN/m³, φ = ${P.phi}°, 상재하중 q = ${P.q} kN/m² (${P.surFactor})</td></tr>`;
    h += `<tr><th>토압</th><td>${P.earthP} — 평상시 ${P.method}, 지진시 ${P.seisMethod}<br>벽면마찰각 δ: 안정검토 ${f2(P.delta.stabN)}° / ${f2(P.delta.stabE)}°, 벽체검토 ${f2(P.delta.wallN)}° / ${f2(P.delta.wallE)}° (평상시/지진시)</td></tr>`;
    h += `<tr><th>지진</th><td>${P.seisOn ? `A = ${P.A}, kh = A/2 = ${f3(P.kh)}` : '내진해석 하지않음'}</td></tr>`;
    h += `<tr><th>안전율</th><td>전도 ${P.fs.overN} (지진시 ${P.fs.overE}), 활동 ${P.fs.slideN} (지진시 ${P.fs.slideE})</td></tr>`;
    h += `<tr><th>기초지반</th><td>γ = ${P.found.gamma} kN/m³, φ = ${f2(P.found.phi)}°, c = ${P.found.c} kN/m², Df = ${P.found.Df} m, ${P.found.type}${P.found.qu > 0 ? `, qu = ${P.found.qu} kN/m²` : `, ${P.found.method}, 상한 ${P.found.qaMax} kN/m²`}</td></tr>`;
    h += '</table>';
    h += '<h3>하중조합</h3><table><tr><th>구분</th><th>조합</th><th>D</th><th>L</th><th>H</th><th>E</th><th>기초</th><th>벽체</th></tr>';
    for (const [k, t] of [['factored', '계수'], ['service', '사용']]) {
        for (const row of r.comb[k] || []) h += `<tr><td>${t}</td><td>${row.name}</td>${['D', 'L', 'H', 'E'].map(x => `<td class="num">${n0(row.f && row.f[x]) ? f2(row.f[x]) : ''}</td>`).join('')}<td>${row.found !== false ? '●' : ''}</td><td>${row.wall !== false ? '●' : ''}</td></tr>`;
    }
    h += '</table>';
    r.sections.forEach((s, i) => {
        const g = s.geom;
        h += `<h2>${i + 2}. ${s.label}</h2>`;
        h += `<p>기초폭 B = ${f3(g.B)} m (앞굽 ${f3(g.B1)}, 벽체 ${f3(g.B3)}, 뒷굽 ${f3(g.B2)}), 전체높이 H = ${f3(g.WH)} m, 벽체높이 ${f3(g.hStem)} m${g.beta ? `, 배면경사 β = ${f2(g.beta)}°` : ''}${g.key ? ', 활동방지벽 있음' : ''}</p>`;
        h += `<h3>토압</h3><p>${s.earth.lines.join('<br>')}<br>가상배면 높이 H' = ${f3(s.earth.H)} m: Ph = ${f2(s.earth.Ph)} kN (y = ${f3(s.earth.yP)} m), Pv = ${f2(s.earth.Pv)} kN, 상재 Pqh = ${f2(s.earth.Pqh)} kN${s.earth.dPh ? `, 지진 증분 ΔPh = ${f2(s.earth.dPh)} kN (y = 0.6H)` : ''}</p>`;
        h += '<h3>작용력 (단위길이당, 모멘트 중심 = 앞굽 끝)</h3><table><tr><th>항목</th><th>구분</th><th>V (kN)</th><th>H (kN)</th><th>x (m)</th><th>y (m)</th><th>Mr (kN·m)</th><th>Mo (kN·m)</th></tr>';
        for (const it of s.items) h += `<tr><td>${it.name}</td><td>${it.cat}</td><td class="num">${f2(it.V)}</td><td class="num">${f2(it.H)}</td><td class="num">${f3(g.B - it.x)}</td><td class="num">${f3(it.y)}</td><td class="num">${f2(it.V * (g.B - it.x))}</td><td class="num">${f2(it.H * it.y)}</td></tr>`;
        h += '</table>';
        if (s.weight) h += weightHtml(s);
        h += '<h3>안정검토</h3><table><tr><th>조합</th><th>ΣV</th><th>ΣH</th><th>Mr</th><th>Mo</th><th>전도 FS</th><th>e (허용)</th><th>활동 FS</th><th>qmax / qmin</th><th>qa</th><th>판정</th></tr>';
        for (const st of s.stability) {
            h += `<tr><td>${st.name}${st.seis ? ' (지진)' : ''}</td><td class="num">${f2(st.V)}</td><td class="num">${f2(st.H)}</td><td class="num">${f2(st.Mr)}</td><td class="num">${f2(st.Mo)}</td>`;
            h += `<td class="num">${f2(st.FSo)} ≥ ${st.fsO} ${OK(st.okO)}</td><td class="num">${f3(st.e)} (${f3(st.eAllow)})</td><td class="num">${f2(st.FSs)} ≥ ${st.fsS} ${OK(st.okS)}</td>`;
            h += `<td class="num">${f2(Math.max(st.q1, st.q2))} / ${f2(Math.min(st.q1, st.q2))}</td><td class="num">${f2(st.qa)} ${OK(st.okB)}</td><td>${OK(st.ok)}</td></tr>`;
        }
        h += '</table>';
        if (s.stability[0]) h += `<p>활동저항 Hr = ΣV·μ + c·B + Pp (μ = ${f3(s.stability[0].mu)})<br>허용지지력: ${s.stability.map(st => `${st.name} ${st.qaLine}`).join('<br>')}</p>`;
        h += '<h3>단면검토 (계수하중 포락, b = 1000 mm, 피복 80 mm)</h3><table><tr><th>부재</th><th>h (mm)</th><th>d (mm)</th><th>Mu (kN·m)</th><th>조합</th><th>Vu (kN)</th><th>사용철근</th><th>As / 필요</th><th>φMn</th><th>φVc</th><th>균열</th><th>판정</th></tr>';
        for (const m of s.members) {
            h += `<tr><td>${m.name}</td><td class="num">${m.h.toFixed(0)}</td><td class="num">${m.d.toFixed(0)}</td><td class="num">${f2(m.Mu)}</td><td>${m.combo || '-'}</td><td class="num">${f2(m.Vu)}</td>`;
            h += `<td>${m.rebar.dia}@${m.rebar.ctc}${m.rebar.user ? '' : ' (자동)'}</td><td class="num">${f2(m.rebar.As)} / ${f2(m.AsNeed)}</td><td class="num">${f2(m.phiMn)} ${OK(m.okM)}</td><td class="num">${f2(m.phiVc)} ${OK(m.okV)}</td>`;
            h += `<td>${m.crack ? `${m.crack.method === '간격' ? `s ${m.rebar.ctc} ≤ ${f2(m.crack.sAllow)}` : `w ${f3(m.crack.w)} ≤ ${f3(m.crack.wa)}`} ${OK(m.okCrack)}` : '-'}</td><td>${OK(m.ok)}</td></tr>`;
        }
        h += '</table>';
        const notes = s.members.filter(m => m.note).map(m => `※ ${m.name}: ${m.note}`);
        if (notes.length) h += `<p>${notes.join('<br>')}</p>`;
    });
    h += `<h2>결과</h2><p>${r.name}: ${OK(r.ok)}</p>`;
    return h;
}

/** 계산서 모달 */
export async function showWallReport(p, c, wingId) {
    const { modal, h } = await import('../ui/dom.js');
    let r;
    try { r = wallDesign(p, c, wingId); } catch (e) { console.error(e); r = { name: wingId, error: e.message, sections: [] }; }
    return modal({ title: `옹벽식 날개벽 구조계산 — ${r.name}`, width: 980, height: 680, body: h('div', { class: 'report', html: r.error ? `<p>${r.error}</p>` : wallReportHtml(r) }) });
}
