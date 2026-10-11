// frameModel.js - 암거 단면 → 2D 골조 해석모델 (단위 m, kN, 단위폭 1 m)
//
// 부재군과 좌표는 loads.js 계약(loadHelpers.frameModel)과 같다:
//   원점 = 좌측벽 중심선 × 하부슬래브 중심선
//   'top' | 'bottom' | 'middle' 슬래브: 좌측벽 중심선 → 우측벽 중심선
//   'left' | 'right' | 'mid:i' | 'midU:i' 벽: 아래 → 위
// 벽 중심선 바깥 내민부분(벽두께/2, 부상방지저판) 하중은 loads.js 가 끝 절점 점하중으로 준다.

import { frameModel as groupDefs } from './loadHelpers.js';

/**
 * opts: { E (kN/m²), springGap (m), wallSeg, kv (kN/m³), kvH (수평, 기본 kv/3),
 *         springMode: 'Spring'|'NLLink', wallKh (지진시 벽체 스프링 kN/m³), wallGap (m) }
 */
export function buildModel(c, bi = 0, opts = {}) {
    const fm = groupDefs(c, bi);
    const E = opts.E || 2.7e7;
    const gap = Math.max(0.1, opts.springGap || 0.5);
    const wallGap = Math.max(0.1, opts.wallGap || gap);
    const nodes = [];
    const members = [];
    const groups = {};
    const nodeIndex = new Map();
    const node = (x, y) => {
        const k = `${x.toFixed(5)},${y.toFixed(5)}`;
        if (nodeIndex.has(k)) return nodeIndex.get(k);
        nodes.push({ x, y });
        nodeIndex.set(k, nodes.length - 1);
        return nodes.length - 1;
    };
    // 분할점: 벽(또는 슬래브) 교차 위치 + 간격
    const wallXs = fm.xs;                        // 벽 중심 x (m)
    const slabYs = fm.groups.filter(g => g.kind === 'slab').map(g => g.y);
    const divide = (a, b, breaks, step) => {
        const pts = [a, b, ...breaks.filter(v => v > a + 1e-6 && v < b - 1e-6)].sort((p, q) => p - q);
        const out = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const n = Math.max(1, Math.ceil((pts[i + 1] - pts[i]) / step - 1e-9));
            for (let k = 0; k < n; k++) out.push(pts[i] + (pts[i + 1] - pts[i]) * k / n);
        }
        out.push(b);
        return out;
    };
    for (const g of fm.groups) {
        groups[g.id] = [];
        let pts;
        if (g.kind === 'slab') pts = divide(0, g.L, wallXs, gap).map(x => [x, g.y]);
        else pts = divide(g.y0, g.y1, slabYs, opts.wallSeg ? (g.y1 - g.y0) / opts.wallSeg : wallGap).map(y => [g.x, y]);
        const ratio = g.colFactor || 1;
        for (let k = 0; k < pts.length - 1; k++) {
            const i = node(...pts[k]), j = node(...pts[k + 1]);
            members.push({ i, j, E, A: g.t * ratio, I: Math.pow(g.t, 3) / 12 * ratio, h: g.t, group: g.id, alpha: 1.0e-5, s0: k === 0 ? 0 : null });
            groups[g.id].push(members.length - 1);
        }
    }
    // 지반 스프링 (하부슬래브 절점, 연직 압축 + 수평)
    const springs = [];
    const kv = opts.kv || 50000;
    const kvH = opts.kvH || kv / 3;
    const botNodes = [...new Set(groups.bottom.flatMap(m => [members[m].i, members[m].j]))].sort((a, b) => nodes[a].x - nodes[b].x);
    // 기초 폭: 외측벽 외면 + 부상방지저판 (끝 절점 지배폭에 내민 길이 포함)
    const ext0 = fm.g.walls[0].t / 2000 + (fm.g.antiFloat ? fm.g.antiFloat.brW / 1000 : 0);
    const extN = fm.g.walls[fm.g.walls.length - 1].t / 2000 + (fm.g.antiFloat ? fm.g.antiFloat.brW / 1000 : 0);
    botNodes.forEach((n, k) => {
        const xL = k > 0 ? (nodes[botNodes[k - 1]].x + nodes[n].x) / 2 : nodes[n].x - ext0;
        const xR = k < botNodes.length - 1 ? (nodes[botNodes[k + 1]].x + nodes[n].x) / 2 : nodes[n].x + extN;
        const trib = xR - xL;
        springs.push({ node: n, dir: 'y', k: kv * trib, compressionOnly: opts.springMode === 'NLLink', sign: -1, ground: true, trib });
        springs.push({ node: n, dir: 'x', k: kvH * trib, ground: true, trib });
    });
    if (opts.springMode === 'NLLink') {
        // 외적 불안정 정정용 약한 스프링 (매뉴얼: NLLINK 로 인한 외적 불안정 발생시 정정 조건)
        const fix = opts.nlFix || 1000;
        botNodes.forEach(n => springs.push({ node: n, dir: 'y', k: fix * 1e-3, ground: true, stab: true }));
    }
    // 지진시 벽체 스프링 (응답변위법)
    if (opts.wallKh) {
        for (const id of ['left', 'right']) {
            if (!groups[id]) continue;
            const ns = [...new Set(groups[id].flatMap(m => [members[m].i, members[m].j]))].sort((a, b) => nodes[a].y - nodes[b].y);
            ns.forEach((n, k) => {
                const yL = k > 0 ? (nodes[ns[k - 1]].y + nodes[n].y) / 2 : nodes[n].y;
                const yU = k < ns.length - 1 ? (nodes[ns[k + 1]].y + nodes[n].y) / 2 : nodes[n].y;
                springs.push({ node: n, dir: 'x', k: opts.wallKh * (yU - yL), wall: id });
            });
        }
    }
    return { nodes, members, groups, springs, supports: [], fm, geom: fm.g };
}

/** 부재군 경로 [{m, s0, s1, L}] — 부재군 시점(왼쪽/아래)에서의 거리 */
export function groupPath(model, name) {
    const segs = [];
    let s = 0;
    for (const mi of model.groups[name] || []) {
        const m = model.members[mi];
        const a = model.nodes[m.i], b = model.nodes[m.j];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        segs.push({ m: mi, s0: s, s1: s + L, L });
        s += L;
    }
    return { segs, length: s };
}

/** 부재군 시점에서 거리 s 위치의 [부재, 부재 내 거리] */
export function locate(model, name, s) {
    const p = groupPath(model, name);
    if (!p.segs.length) return null;
    const sg = p.segs.find(q => s >= q.s0 - 1e-9 && s <= q.s1 + 1e-9) || (s < 0 ? p.segs[0] : p.segs[p.segs.length - 1]);
    return { m: sg.m, x: Math.max(0, Math.min(sg.L, s - sg.s0)), path: p };
}

/** 하중방향 → 해석기 방향/부호 */
function dirOf(target, dir, val) {
    if (dir === 'gravity') return ['gy', -val];
    if (dir === 'up') return ['gy', val];
    if (dir === 'x') return ['gx', val];
    if (dir === 'normal') {
        if (target === 'top' || target === 'middle') return ['gy', -val];
        if (target === 'bottom') return ['gy', val];
        if (target === 'left') return ['gx', val];
        if (target === 'right') return ['gx', -val];
        return ['gx', val];
    }
    return ['gy', -val];
}

/** loads.js 하중 케이스 → frameSolver 하중 */
export function toSolverLoad(model, lc) {
    const load = { nodal: [], dist: [], point: [], temp: [] };
    for (const it of lc.items || []) {
        const path = groupPath(model, it.target);
        if (!path.segs.length) continue;
        if (it.kind === 'dist') {
            const S0 = it.a ?? 0, S1 = it.b ?? path.length;
            if (S1 <= S0) continue;
            const wAt = (s) => it.w1 + (it.w2 - it.w1) * ((s - S0) / (S1 - S0));
            for (const sg of path.segs) {
                const a = Math.max(S0, sg.s0), b = Math.min(S1, sg.s1);
                if (b <= a + 1e-9) continue;
                const [d, v1] = dirOf(it.target, it.dir, wAt(a));
                const [, v2] = dirOf(it.target, it.dir, wAt(b));
                load.dist.push({ member: sg.m, w1: v1, w2: v2, dir: d, a: a - sg.s0, b: b - sg.s0 });
            }
        } else if (it.kind === 'point') {
            const loc = locate(model, it.target, it.pos);
            const [d, v] = dirOf(it.target, it.dir, it.P);
            load.point.push({ member: loc.m, P: v, pos: loc.x, dir: d });
        }
    }
    if (lc.temp) {
        const t = lc.temp;
        const targets = t.targets || Object.keys(model.groups);
        for (const id of targets) {
            for (const mi of model.groups[id] || []) {
                // grad = 외측 − 내측. 해석기 dTg = 국부 +y 면 − 반대면.
                //  상부/중간슬래브(왼→오): +y = 윗면 = 외측, 하부슬래브: +y = 윗면 = 내측
                //  좌측벽(아래→위): +y = 왼쪽 = 외측, 우측벽: +y = 왼쪽 = 내측
                let sgn = 1;
                if (id === 'bottom' || id === 'right') sgn = -1;
                if (id.startsWith('mid')) sgn = 0;
                load.temp.push({ member: mi, dT: t.dT || 0, dTg: sgn * (t.grad || 0) });
            }
        }
    }
    return load;
}
