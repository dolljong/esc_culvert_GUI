// sectionPieces.js - 암거 단면을 구역(슬래브 · 벽체 · 헌치 · 부상방지저판)으로 나눠 면적·도심을 구한다
// (구조계산서 7장 부력 및 지지력 검토의 '구체 자중 산정' 표와 그림).
//
//   슬래브 : 전폭 직사각형 (상부 / 중간 / 하부)
//   벽체   : 슬래브 사이 직사각형 (벽 두께 × 내공 높이)
//   헌치   : 내공 직사각형 모서리에서 내공 다각형을 뺀 부분 (내공 사분면별)
//   부상방지저판 : 좌·우 다각형
//   나머지 (U형 헌치·중분대 등 위 구분에 들지 않는 부분) 는 '기타' 한 조각으로 보정해
//   합계가 concreteArea(g) 와 항상 같게 한다.
//
// 반환: { pieces: [{ no, name, shape, b, h, A, cx, cy }], A, cx, cy, splits: [[x0,y0,x1,y1]] }  (mm, mm²)

import { polyArea, polyCentroid, concreteArea } from './sectionGeom.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** 다각형을 축 정렬 사각형으로 자른다 (Sutherland–Hodgman, 오목 다각형도 면적은 맞다) */
function clipRect(poly, x0, y0, x1, y1) {
    let out = poly;
    const edges = [
        (p) => p[0] >= x0 - 1e-9, (p) => p[0] <= x1 + 1e-9, (p) => p[1] >= y0 - 1e-9, (p) => p[1] <= y1 + 1e-9,
    ];
    const cut = [
        (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; },
        (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; },
        (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y0]; },
        (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, y1]; },
    ];
    for (let k = 0; k < 4 && out.length; k++) {
        const inp = out;
        out = [];
        for (let i = 0; i < inp.length; i++) {
            const a = inp[i], b = inp[(i + 1) % inp.length];
            const ia = edges[k](a), ib = edges[k](b);
            if (ia) out.push(a);
            if (ia !== ib) out.push(cut[k](a, b));
        }
    }
    return out;
}

/** 다각형 면적·1차모멘트 (면적 부호 무시) */
function moments(poly) {
    const A = polyArea(poly);
    if (A < 1e-9) return { A: 0, Mx: 0, My: 0 };
    const c = polyCentroid(poly);
    return { A, Mx: A * c.x, My: A * c.y };
}

export function sectionPieces(g) {
    const pieces = [];
    const splits = [];
    const add = (name, shape, b, h, m) => { if (m.A > 1) pieces.push({ name, shape, b, h, A: m.A, cx: m.Mx / m.A, cy: m.My / m.A }); };
    const W = g.W;
    // 슬래브
    const slabName = { top: '상부슬래브', middle: '중간슬래브', bottom: '하부슬래브' };
    for (const s of [...(g.slabs || [])].sort((a, b) => a.y0 - b.y0)) {
        // 외곽이 층마다 들어갈 수 있어(복층형 상층) 외곽 다각형의 해당 높이 띠를 잘라 쓴다
        const m = moments(clipRect(g.outer, -1e9, s.y0, 1e9, s.y1));
        add(slabName[s.kind] || '슬래브', '사각형', m.A / ((s.y1 - s.y0) || 1), s.y1 - s.y0, m);
    }
    // 벽체 (같은 층의 이웃 내공 높이)
    const wallNm = (w) => (w.kind === 'outer' ? (w.side === 'R' ? '우측벽체' : '좌측벽체') : `중간벽체 ${w.index + 1}`);
    const floorNm = (f) => (g.kind === 'DOUBLE' ? (f === 2 ? ' (상층)' : ' (하층)') : '');
    const wallRect = (nm, x0, x1, y0, y1) => {
        add(nm, '사각형', x1 - x0, y1 - y0, moments(rect(x0, y0, x1, y1)));
        splits.push([x0, y0, x1, y0], [x0, y1, x1, y1]);
    };
    const cellOf = (floor) => g.cells.find(c => (floor ? c.floor === floor : true));
    for (const w of g.walls || []) {
        if (g.kind === 'U') {
            // U형 측벽 (경사·단차 포함): 외곽 다각형에서 측벽 영역만 잘라낸다
            const L = w.side !== 'R';
            const pl = clipRect(g.outer, L ? -1e9 : g.inner.x1, g.LT, L ? g.inner.x0 : 1e9, g.Htot);
            add(wallNm(w), Math.abs((w.tTop ?? w.t) - w.t) > 1 ? '사다리꼴' : '사각형', w.t, g.Htot - g.LT, moments(pl));
            splits.push([w.x0, g.LT, w.x1, g.LT]);
            continue;
        }
        if (w.kind === 'outer') {
            // 외측벽: 외곽 다각형에서 내공 바깥쪽을 잘라낸다 (층마다, 복층형 상·하층 두께가 다를 수 있다)
            const floors = g.kind === 'DOUBLE' ? [1, 2] : [null];
            for (const floor of floors) {
                const cs = g.cells.filter(c => (floor ? c.floor === floor : true)).sort((a, b) => a.x0 - b.x0);
                if (!cs.length) continue;
                const c = w.side === 'R' ? cs[cs.length - 1] : cs[0];
                const pl = w.side === 'R' ? clipRect(g.outer, c.x1, c.y0, 1e9, c.y1) : clipRect(g.outer, -1e9, c.y0, c.x0, c.y1);
                const m = moments(pl);
                add(wallNm(w) + floorNm(floor), '사각형', m.A / ((c.y1 - c.y0) || 1), c.y1 - c.y0, m);
                const xa = w.side === 'R' ? c.x1 : c.x0 - m.A / ((c.y1 - c.y0) || 1), xb = w.side === 'R' ? c.x1 + m.A / ((c.y1 - c.y0) || 1) : c.x0;
                splits.push([xa, c.y0, xb, c.y0], [xa, c.y1, xb, c.y1]);
            }
            continue;
        }
        const cs = g.cells.filter(c => (w.floor ? c.floor === w.floor : true));
        const near = cs.find(c => Math.abs(c.x0 - w.x1) < 1 || Math.abs(c.x1 - w.x0) < 1) || cs[0];
        if (!near) continue;
        wallRect(wallNm(w) + floorNm(w.floor), w.x0, w.x1, near.y0, near.y1);
    }
    // U형 바닥 헌치 · 중분대 (내공 폭, 하부슬래브 위)
    if (g.kind === 'U' && g.inner) {
        add(g.median ? '헌치 · 중분대' : '헌치', '삼각형', null, null, moments(clipRect(g.outer, g.inner.x0, g.LT, g.inner.x1, g.Htot)));
    }
    // 헌치 (내공 사분면 − 내공 다각형)
    for (const c of g.cells) {
        if (!c.poly) continue;
        const xm = (c.x0 + c.x1) / 2, ym = (c.y0 + c.y1) / 2;
        const quads = [['좌하', c.x0, c.y0, xm, ym], ['우하', xm, c.y0, c.x1, ym], ['좌상', c.x0, ym, xm, c.y1], ['우상', xm, ym, c.x1, c.y1]];
        for (const [nm, a, b, e, f] of quads) {
            const q = moments(rect(a, b, e, f));
            const k = moments(clipRect(c.poly, a, b, e, f));
            const m = { A: q.A - k.A, Mx: q.Mx - k.Mx, My: q.My - k.My };
            if (m.A <= 1) continue;
            add(`헌치 (내공${c.index + 1}${g.kind === 'DOUBLE' ? (c.floor === 2 ? '상' : '하') : ''} ${nm})`, '삼각형', null, null, m);
        }
        splits.push([c.x0, c.y0, c.x1, c.y0], [c.x1, c.y0, c.x1, c.y1], [c.x1, c.y1, c.x0, c.y1], [c.x0, c.y1, c.x0, c.y0]);
    }
    // 부상방지저판
    if (g.antiFloat) {
        add('부상방지저판 (좌)', '사다리꼴', g.antiFloat.brW, g.antiFloat.t, moments(g.antiFloat.left));
        add('부상방지저판 (우)', '사다리꼴', g.antiFloat.brW, g.antiFloat.t, moments(g.antiFloat.right));
    }
    // 전체 (외곽 − 내공 + 부상방지저판) 와의 차이 → 기타
    const tot = moments(g.outer);
    if (g.kind !== 'U') for (const c of g.cells) { const m = moments(c.poly); tot.A -= m.A; tot.Mx -= m.Mx; tot.My -= m.My; }
    if (g.antiFloat) for (const pl of [g.antiFloat.left, g.antiFloat.right]) { const m = moments(pl); tot.A += m.A; tot.Mx += m.Mx; tot.My += m.My; }
    const sum = pieces.reduce((s, p) => ({ A: s.A + p.A, Mx: s.Mx + p.A * p.cx, My: s.My + p.A * p.cy }), { A: 0, Mx: 0, My: 0 });
    const rA = tot.A - sum.A;
    if (Math.abs(rA) > Math.max(1, tot.A * 1e-6)) {
        pieces.push({ name: g.kind === 'U' ? '기타 (헌치 · 중분대 등)' : '기타 (보정)', shape: '-', b: null, h: null, A: rA, cx: (tot.Mx - sum.Mx) / rA, cy: (tot.My - sum.My) / rA });
    }
    pieces.forEach((p, i) => { p.no = i + 1; });
    const A = concreteArea(g);
    return { pieces, A, cx: tot.A ? tot.Mx / tot.A : 0, cy: tot.A ? tot.My / tot.A : 0, splits };
}
