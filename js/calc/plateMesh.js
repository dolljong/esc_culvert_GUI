// plateMesh.js - 암거 블록 → 3D Plate 해석모델 (구조 계산 > 3D Plate 해석, 매뉴얼 4.7)
//
// 좌표 (m, MIDAS 전체좌표):
//   X = 횡방향 (원점 = 좌측벽 중심선, 2D 프레임 x 와 같음)
//   Y = 블록 종방향 (0 ~ 블록길이, 사각은 직사각형으로 근사)
//   Z = 연직 (원점 = 하부슬래브 중심선, 2D 프레임 y 와 같음)
// 부재군 id 는 loads.js / loadHelpers.frameModel 과 같다 ('top','bottom','middle','left','right','mid:i','midU:i').
//
// buildPlateMesh(c, bi, { mesh (mm), length (m) }) → {
//   nodes: [{ id, x, y, z }], plates: [{ id, n:[4 node id], group, kind:'slab'|'wall', thk (id), t (m), s0, s1, y0, y1, area }],
//   thicknesses: [{ id, t }], groups: { id: [plate id...] }, groupDefs, xsBreaks, ys, Lb, mesh, fm,
//   bottomNodes: [{ node, trib }]  (지반 스프링용 지배면적 m²), nodeAt(group, s, y), signature }
// plateLoads(mesh, lc) → { pres: [{ elem, dir:'GX'|'GZ', p }], conc: [{ node, FX, FZ }], temp: [{ elem, dT, grad }] }
//   loads.js 2D 하중 (단위폭 1 m 당) 을 블록 전체 길이에 걸친 판 압력(kN/m²)/절점하중(kN) 으로 바꾼다.

import { frameModel } from './loadHelpers.js';

const r6 = (v) => Math.round(v * 1e6) / 1e6;

/** a~b 구간을 breaks 에서 끊고 step 이하로 나눈 점들 */
function divide(a, b, breaks, step) {
    const pts = [a, b, ...breaks.filter(v => v > a + 1e-6 && v < b - 1e-6)].sort((p, q) => p - q);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const n = Math.max(1, Math.ceil((pts[i + 1] - pts[i]) / step - 1e-9));
        for (let k = 0; k < n; k++) out.push(r6(pts[i] + (pts[i + 1] - pts[i]) * k / n));
    }
    out.push(r6(b));
    return out;
}

/** 블록 길이 (m) */
export function blockLength(c, bi = 0) {
    const j = (c.joints || [])[bi + 1];
    return j && +j.dist > 0 ? +j.dist : 10;
}

export function buildPlateMesh(c, bi = 0, opts = {}) {
    const fm = frameModel(c, bi);
    const step = Math.max(0.1, (+opts.mesh || 500) / 1000);
    const Lb = opts.length || blockLength(c, bi);
    const ys = divide(0, Lb, [], step);
    const nodes = [];
    const index = new Map();
    const node = (x, y, z) => {
        const k = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
        if (index.has(k)) return index.get(k);
        nodes.push({ id: nodes.length + 1, x: r6(x), y: r6(y), z: r6(z) });
        index.set(k, nodes.length);
        return nodes.length;
    };
    const thicknesses = [];
    const thkId = (t) => {
        let th = thicknesses.find(q => Math.abs(q.t - t) < 1e-6);
        if (!th) { th = { id: thicknesses.length + 1, t }; thicknesses.push(th); }
        return th.id;
    };
    const slabZs = fm.groups.filter(g => g.kind === 'slab').map(g => g.y);
    const plates = [];
    const groups = {};
    const lines = {};      // group → [s 값들] (부재축 방향 절점 위치)
    for (const g of fm.groups) {
        groups[g.id] = [];
        const ss = g.kind === 'slab' ? divide(0, g.L, fm.xs, step) : divide(g.y0, g.y1, slabZs, step);
        lines[g.id] = ss;
        const t = g.t * (g.colFactor || 1);
        const thk = thkId(+t.toFixed(4));
        const P = g.kind === 'slab' ? (s, y) => node(s, y, g.y) : (s, y) => node(g.x, y, s);
        for (let i = 0; i < ss.length - 1; i++) {
            for (let j = 0; j < ys.length - 1; j++) {
                // 판 국부 x = 부재축 방향 (슬래브: +X, 벽: +Z) → Mxx 가 2D 해석의 휨모멘트에 대응
                const n = [P(ss[i], ys[j]), P(ss[i + 1], ys[j]), P(ss[i + 1], ys[j + 1]), P(ss[i], ys[j + 1])];
                plates.push({
                    id: plates.length + 1, n, group: g.id, kind: g.kind, thk, t,
                    s0: ss[i], s1: ss[i + 1], y0: ys[j], y1: ys[j + 1],
                    area: (ss[i + 1] - ss[i]) * (ys[j + 1] - ys[j]),
                });
                groups[g.id].push(plates.length);
            }
        }
    }
    // 하부슬래브 절점 지배면적 (외측벽 외면 + 부상방지저판 포함)
    const geo = fm.g;
    const ext0 = geo.walls[0].t / 2000 + (geo.antiFloat ? geo.antiFloat.brW / 1000 : 0);
    const extN = geo.walls[geo.walls.length - 1].t / 2000 + (geo.antiFloat ? geo.antiFloat.brW / 1000 : 0);
    const bot = fm.group('bottom');
    const xsB = lines.bottom;
    const bottomNodes = [];
    xsB.forEach((x, i) => {
        const xL = i > 0 ? (xsB[i - 1] + x) / 2 : x - ext0;
        const xR = i < xsB.length - 1 ? (xsB[i + 1] + x) / 2 : x + extN;
        ys.forEach((y, j) => {
            const yL = j > 0 ? (ys[j - 1] + y) / 2 : y;
            const yR = j < ys.length - 1 ? (ys[j + 1] + y) / 2 : y;
            bottomNodes.push({ node: index.get(`${x.toFixed(4)},${y.toFixed(4)},${bot.y.toFixed(4)}`), x, y, trib: (xR - xL) * (yR - yL), tribX: xR - xL, tribY: yR - yL });
        });
    });
    const groupDef = (id) => fm.groups.find(q => q.id === id);
    /** 부재군의 축방향 위치 s, 종방향 y 의 절점 id (가장 가까운 절점) */
    const nodeAt = (gid, s, y) => {
        const g = groupDef(gid);
        const ss = lines[gid];
        if (!g || !ss) return null;
        let si = ss[0];
        for (const v of ss) if (Math.abs(v - s) < Math.abs(si - s)) si = v;
        const k = g.kind === 'slab' ? `${si.toFixed(4)},${y.toFixed(4)},${g.y.toFixed(4)}` : `${g.x.toFixed(4)},${y.toFixed(4)},${si.toFixed(4)}`;
        return index.get(k) || null;
    };
    return {
        nodes, plates, thicknesses, groups, groupDefs: fm.groups, lines, ys, Lb, mesh: step * 1000, fm, bottomNodes, nodeAt,
        signature: `${nodes.length}/${plates.length}/${Lb}/${step}`,
    };
}

/** 하중방향 → [전체좌표 방향, 부호 적용 값] (frameModel.dirOf 와 같은 규칙) */
function dirOf(target, dir, val) {
    if (dir === 'gravity') return ['GZ', -val];
    if (dir === 'up') return ['GZ', val];
    if (dir === 'x') return ['GX', val];
    if (dir === 'normal') {
        if (target === 'top' || target === 'middle') return ['GZ', -val];
        if (target === 'bottom') return ['GZ', val];
        if (target === 'right') return ['GX', -val];
        return ['GX', val];
    }
    return ['GZ', -val];
}

/** 2D 하중 케이스 → 판 압력 / 절점 하중 / 요소 온도 */
export function plateLoads(mesh, lc) {
    const pres = [], conc = [], temp = [];
    const presMap = new Map();
    const addP = (elem, dir, p) => {
        const k = `${elem}|${dir}`;
        presMap.set(k, (presMap.get(k) || 0) + p);
    };
    const concMap = new Map();
    const addC = (nd, dir, F) => {
        if (!nd) return;
        const q = concMap.get(nd) || { node: nd, FX: 0, FZ: 0 };
        if (dir === 'GX') q.FX += F; else q.FZ += F;
        concMap.set(nd, q);
    };
    for (const it of lc.items || []) {
        const g = mesh.groupDefs.find(q => q.id === it.target);
        if (!g) continue;
        const L = g.kind === 'slab' ? g.L : g.y1 - g.y0;
        const base = g.kind === 'slab' ? 0 : g.y0;
        if (it.kind === 'dist') {
            const S0 = base + (it.a ?? 0), S1 = base + (it.b ?? L);
            if (S1 <= S0 + 1e-9) continue;
            const wAt = (s) => it.w1 + (it.w2 - it.w1) * ((s - S0) / (S1 - S0));
            for (const pid of mesh.groups[g.id]) {
                const pl = mesh.plates[pid - 1];
                const a = Math.max(S0, pl.s0), b = Math.min(S1, pl.s1);
                if (b <= a + 1e-9) continue;
                // 요소 길이에 대한 등가 등분포 (합력 보존)
                const w = (wAt(a) + wAt(b)) / 2 * (b - a) / (pl.s1 - pl.s0);
                const [d, v] = dirOf(it.target, it.dir, w);
                addP(pid, d, v);
            }
        } else if (it.kind === 'point') {
            const s = base + (+it.pos || 0);
            const [d, v] = dirOf(it.target, it.dir, +it.P || 0);
            mesh.ys.forEach((y, j) => {
                const yL = j > 0 ? (mesh.ys[j - 1] + y) / 2 : y;
                const yR = j < mesh.ys.length - 1 ? (mesh.ys[j + 1] + y) / 2 : y;
                addC(mesh.nodeAt(g.id, s, y), d, v * (yR - yL));
            });
        }
    }
    for (const [k, p] of presMap) {
        if (Math.abs(p) < 1e-9) continue;
        const [e, d] = k.split('|');
        pres.push({ elem: +e, dir: d, p });
    }
    for (const q of concMap.values()) if (Math.abs(q.FX) > 1e-9 || Math.abs(q.FZ) > 1e-9) conc.push(q);
    if (lc.temp) {
        const t = lc.temp;
        const targets = t.targets || Object.keys(mesh.groups);
        for (const id of targets) {
            let sgn = (id === 'bottom' || id === 'right') ? -1 : 1;
            if (id.startsWith('mid')) sgn = 0;
            for (const pid of mesh.groups[id] || []) temp.push({ elem: pid, dT: t.dT || 0, grad: sgn * (t.grad || 0) });
        }
    }
    return { pres, conc, temp };
}

/** 하중 합계 검산 (kN): { FX, FZ } */
export function loadResultant(mesh, ld) {
    let FX = 0, FZ = 0;
    for (const q of ld.pres) {
        const A = mesh.plates[q.elem - 1].area;
        if (q.dir === 'GX') FX += q.p * A; else FZ += q.p * A;
    }
    for (const q of ld.conc) { FX += q.FX; FZ += q.FZ; }
    return { FX, FZ };
}

// ── 투영 (도면용) ────────────────────────────────────────────────────

/**
 * 3D → 2D 축측투영. view: '3D' | 'YZ' | 'XZ' | 'XY'
 * 반환 { P(x,y,z) → [sx, sy, depth] (입력 m, 출력 mm), e, r, u }
 */
export function projector(view = '3D') {
    let e, r, u;
    if (view === 'YZ') { e = [1, 0, 0]; r = [0, 1, 0]; u = [0, 0, 1]; }
    else if (view === 'XZ') { e = [0, -1, 0]; r = [1, 0, 0]; u = [0, 0, 1]; }
    else if (view === 'XY') { e = [0, 0, 1]; r = [1, 0, 0]; u = [0, 1, 0]; }
    else {
        // 앞(−Y)·오른쪽·위에서 내려다보는 축측투영 (방위 30°, 고도 30°) — 종방향(Y)이 오른쪽 위로 들어간다
        const az = 30 * Math.PI / 180, el = 30 * Math.PI / 180;
        e = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
        const n = Math.hypot(e[1], e[0]);
        r = [-e[1] / n, e[0] / n, 0];
        u = [e[1] * r[2] - e[2] * r[1], e[2] * r[0] - e[0] * r[2], e[0] * r[1] - e[1] * r[0]];
    }
    const dot = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;
    return { e, r, u, P: (x, y, z) => [dot(r, x, y, z) * 1000, dot(u, x, y, z) * 1000, dot(e, x, y, z)] };
}
