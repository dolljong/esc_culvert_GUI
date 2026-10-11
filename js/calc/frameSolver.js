// frameSolver.js - 2D 골조 해석 (직접강성법)
//
// 외부 해석 프로그램(SAP2000/MIDAS) 없이 브라우저 안에서 직접 해석한다.
// 단위는 호출자가 일관되게 정한다 (권장: kN, m).
//
// model = {
//   nodes:   [{ x, y }],
//   members: [{ i, j, E, A, I, alpha? (선팽창계수), h? (단면높이, 온도구배용) }],
//   supports: [{ node, ux:bool, uy:bool, rz:bool }],
//   springs:  [{ node, dir:'x'|'y'|'rz', k, compressionOnly?: bool, sign?: +1|-1 }]
//              compressionOnly: 지반 반력처럼 압축(부재를 미는 방향)만 저항. sign 은 "압축" 변위 방향
//              (예: 하부 지반 스프링은 아래로 내려갈 때 압축 → sign=-1 on uy)
// }
// load = {
//   nodal:   [{ node, fx, fy, mz }],
//   dist:    [{ member, w1, w2, dir:'gx'|'gy'|'lx'|'ly', a?:0, b?:L }]   (단위길이당, 부재 i→j 방향 거리 a~b, 기본 전체)
//   point:   [{ member, P, pos, dir }]                                     (pos: i 단에서 거리)
//   temp:    [{ member, dT, dTg }]   dT 균일온도변화, dTg 상하면 온도차(상면-하면, 부재 국부 +y 면이 상면)
// }
// 반환: { u (전체 변위), reactions, memberForces(member) → {N1,V1,M1,N2,V2,M2}, at(member, x) → {N,V,M}, springForces }

function zeros(n) { return new Float64Array(n); }

function solveDense(K, F, n) {
    // 가우스 소거 (부분피벗). K 는 n×n Float64Array (행우선)
    const A = Float64Array.from(K);
    const b = Float64Array.from(F);
    for (let c = 0; c < n; c++) {
        let p = c, mx = Math.abs(A[c * n + c]);
        for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > mx) { mx = v; p = r; } }
        if (mx < 1e-14) throw new Error('구조물이 불안정합니다 (강성행렬 특이). 지점/스프링 조건을 확인하세요.');
        if (p !== c) {
            for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
            const t = b[c]; b[c] = b[p]; b[p] = t;
        }
        const d = A[c * n + c];
        for (let r = c + 1; r < n; r++) {
            const f = A[r * n + c] / d;
            if (f === 0) continue;
            for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
            b[r] -= f * b[c];
        }
    }
    const x = zeros(n);
    for (let r = n - 1; r >= 0; r--) {
        let s = b[r];
        for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
        x[r] = s / A[r * n + r];
    }
    return x;
}

function memberGeom(model, m) {
    const a = model.nodes[m.i], b = model.nodes[m.j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    return { L, c: dx / L, s: dy / L };
}

function localK(E, A, I, L) {
    const k = new Float64Array(36);
    const EA = E * A / L, EI = E * I;
    const set = (r, c, v) => { k[r * 6 + c] = v; };
    set(0, 0, EA); set(0, 3, -EA); set(3, 0, -EA); set(3, 3, EA);
    const a = 12 * EI / L ** 3, b = 6 * EI / L ** 2, c2 = 4 * EI / L, d = 2 * EI / L;
    set(1, 1, a); set(1, 2, b); set(1, 4, -a); set(1, 5, b);
    set(2, 1, b); set(2, 2, c2); set(2, 4, -b); set(2, 5, d);
    set(4, 1, -a); set(4, 2, -b); set(4, 4, a); set(4, 5, -b);
    set(5, 1, b); set(5, 2, d); set(5, 4, -b); set(5, 5, c2);
    return k;
}

function rot(c, s) {
    const T = new Float64Array(36);
    const blk = (o) => { T[o * 6 + o] = c; T[o * 6 + o + 1] = s; T[(o + 1) * 6 + o] = -s; T[(o + 1) * 6 + o + 1] = c; T[(o + 2) * 6 + o + 2] = 1; };
    blk(0); blk(3);
    return T;
}

function mul6(A, B) {
    const C = new Float64Array(36);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { let s = 0; for (let k = 0; k < 6; k++) s += A[i * 6 + k] * B[k * 6 + j]; C[i * 6 + j] = s; }
    return C;
}
function tr6(A) { const T = new Float64Array(36); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) T[j * 6 + i] = A[i * 6 + j]; return T; }
function mv6(A, v) { const r = zeros(6); for (let i = 0; i < 6; i++) { let s = 0; for (let k = 0; k < 6; k++) s += A[i * 6 + k] * v[k]; r[i] = s; } return r; }

/**
 * 국부좌표 고정단력 (부재 → 절점에 작용하는 힘의 반대 = 고정단 반력).
 * 분포하중 국부 성분 qx(x), qy(x) 를 수치적분 (선형 변화, 구간 a~b).
 */
function fixedEndLocal(L, loads) {
    const f = zeros(6);
    // 수치적분: 형상함수 기반 등가절점하중 (Hermite)
    const N = 160;
    for (const ld of loads) {
        if (ld.type === 'dist') {
            const a = ld.a ?? 0, b = ld.b ?? L;
            if (b <= a) continue;
            const h = (b - a) / N;
            for (let k = 0; k < N; k++) {
                const x = a + (k + 0.5) * h;
                const t = (x - a) / (b - a);
                const qx = ld.qx1 + (ld.qx2 - ld.qx1) * t;
                const qy = ld.qy1 + (ld.qy2 - ld.qy1) * t;
                addPoint(f, L, x, qx * h, qy * h, 0);
            }
        } else if (ld.type === 'point') {
            addPoint(f, L, ld.pos, ld.px, ld.py, ld.m || 0);
        }
    }
    return f;
}

function addPoint(f, L, x, px, py, m) {
    const xi = x / L;
    // 축방향 선형
    f[0] += px * (1 - xi);
    f[3] += px * xi;
    // 횡방향 Hermite
    const N1 = 1 - 3 * xi * xi + 2 * xi ** 3;
    const N2 = L * (xi - 2 * xi * xi + xi ** 3);
    const N3 = 3 * xi * xi - 2 * xi ** 3;
    const N4 = L * (-xi * xi + xi ** 3);
    f[1] += py * N1; f[2] += py * N2; f[4] += py * N3; f[5] += py * N4;
    if (m) {
        const dN1 = (-6 * xi + 6 * xi * xi) / L, dN2 = 1 - 4 * xi + 3 * xi * xi, dN3 = (6 * xi - 6 * xi * xi) / L, dN4 = -2 * xi + 3 * xi * xi;
        f[1] += m * dN1; f[2] += m * dN2; f[4] += m * dN3; f[5] += m * dN4;
    }
}

/** 하중을 부재 국부 성분으로 변환 */
function memberLocalLoads(model, load, mi) {
    const m = model.members[mi];
    const { L, c, s } = memberGeom(model, m);
    const out = [];
    const toLocal = (gx, gy) => [gx * c + gy * s, -gx * s + gy * c];
    for (const d of load.dist || []) {
        if (d.member !== mi) continue;
        let q1, q2;
        if (d.dir === 'lx') { q1 = [d.w1, 0]; q2 = [d.w2, 0]; }
        else if (d.dir === 'ly') { q1 = [0, d.w1]; q2 = [0, d.w2]; }
        else if (d.dir === 'gx') { q1 = toLocal(d.w1, 0); q2 = toLocal(d.w2, 0); }
        else { q1 = toLocal(0, d.w1); q2 = toLocal(0, d.w2); }   // gy (전체 y, 위 +)
        out.push({ type: 'dist', a: d.a ?? 0, b: d.b ?? L, qx1: q1[0], qy1: q1[1], qx2: q2[0], qy2: q2[1] });
    }
    for (const p of load.point || []) {
        if (p.member !== mi) continue;
        let v;
        if (p.dir === 'lx') v = [p.P, 0];
        else if (p.dir === 'ly') v = [0, p.P];
        else if (p.dir === 'gx') v = toLocal(p.P, 0);
        else v = toLocal(0, p.P);
        out.push({ type: 'point', pos: p.pos, px: v[0], py: v[1], m: p.m || 0 });
    }
    return { L, c, s, loads: out };
}

/**
 * 선형 해석. compressionOnly 스프링이 있으면 인장 스프링을 제거하며 반복 (NLLink 대용).
 */
export function solve(model, load, opts = {}) {
    const nn = model.nodes.length;
    const ndof = nn * 3;
    let active = (model.springs || []).map(() => true);
    let result = null;
    for (let iter = 0; iter < (opts.maxIter || 30); iter++) {
        result = solveOnce(model, load, active);
        let changed = false;
        (model.springs || []).forEach((sp, k) => {
            if (!sp.compressionOnly) return;
            const d = result.u[sp.node * 3 + (sp.dir === 'x' ? 0 : sp.dir === 'y' ? 1 : 2)];
            const comp = d * (sp.sign || -1) > -1e-12;   // 압축방향 변위
            if (active[k] && !comp) { active[k] = false; changed = true; }
            else if (!active[k] && comp) { active[k] = true; changed = true; }
        });
        if (!changed) break;
        // 모든 스프링이 빠져 불안정해지는 것을 막는다
        if (!active.some((a, k) => a || !model.springs[k].compressionOnly)) { active = active.map(() => true); break; }
    }
    result.activeSprings = active;
    return result;
}

function solveOnce(model, load, active) {
    const nn = model.nodes.length;
    const n = nn * 3;
    const K = new Float64Array(n * n);
    const F = zeros(n);
    const cache = [];
    model.members.forEach((m, mi) => {
        const { L, c, s, loads } = memberLocalLoads(model, load, mi);
        const kl = localK(m.E, m.A, m.I, L);
        const T = rot(c, s);
        const kg = mul6(mul6(tr6(T), kl), T);
        let fl = fixedEndLocal(L, loads);
        // 온도: 균일 dT → 축력, 구배 dTg → 곡률
        for (const t of load.temp || []) {
            if (t.member !== mi) continue;
            const a = m.alpha ?? 1.0e-5;
            if (t.dT) { const Nt = m.E * m.A * a * t.dT; fl[0] -= Nt; fl[3] += Nt; }
            if (t.dTg && m.h) { const Mt = m.E * m.I * a * t.dTg / m.h; fl[2] += Mt; fl[5] -= Mt; }
        }
        const fg = mv6(tr6(T), fl);
        const dofs = [m.i * 3, m.i * 3 + 1, m.i * 3 + 2, m.j * 3, m.j * 3 + 1, m.j * 3 + 2];
        for (let a = 0; a < 6; a++) {
            F[dofs[a]] += fg[a];
            for (let b = 0; b < 6; b++) K[dofs[a] * n + dofs[b]] += kg[a * 6 + b];
        }
        cache.push({ L, c, s, kl, T, fl, loads, dofs });
    });
    for (const nl of load.nodal || []) {
        F[nl.node * 3] += nl.fx || 0; F[nl.node * 3 + 1] += nl.fy || 0; F[nl.node * 3 + 2] += nl.mz || 0;
    }
    (model.springs || []).forEach((sp, k) => {
        if (!active[k]) return;
        const d = sp.node * 3 + (sp.dir === 'x' ? 0 : sp.dir === 'y' ? 1 : 2);
        K[d * n + d] += sp.k;
    });
    // 지점: 큰 강성으로 구속 (penalty)
    const fixed = new Set();
    for (const s of model.supports || []) {
        if (s.ux) fixed.add(s.node * 3);
        if (s.uy) fixed.add(s.node * 3 + 1);
        if (s.rz) fixed.add(s.node * 3 + 2);
    }
    // 축소 시스템
    const free = [];
    for (let d = 0; d < n; d++) if (!fixed.has(d)) free.push(d);
    const m = free.length;
    const Kr = new Float64Array(m * m), Fr = zeros(m);
    for (let a = 0; a < m; a++) {
        Fr[a] = F[free[a]];
        for (let b = 0; b < m; b++) Kr[a * m + b] = K[free[a] * n + free[b]];
    }
    const ur = solveDense(Kr, Fr, m);
    const u = zeros(n);
    free.forEach((d, a) => { u[d] = ur[a]; });

    // 부재력 (국부): f = kl·T·u - fl
    const memberEnd = cache.map((cc) => {
        const ug = cc.dofs.map(d => u[d]);
        const ul = mv6(cc.T, ug);
        const f = mv6(cc.kl, ul);
        for (let a = 0; a < 6; a++) f[a] -= cc.fl[a];
        // 부호규약: N 인장 +, V·M 은 i 단 기준 (M 하면인장 + 로 변환은 at() 에서)
        return { N1: -f[0], V1: f[1], M1: -f[2], N2: f[3], V2: -f[4], M2: f[5], ul };
    });
    // 반력
    const R = zeros(n);
    for (let a = 0; a < n; a++) {
        let s = -F[a];
        for (let b = 0; b < n; b++) s += K[a * n + b] * u[b];
        R[a] = s;
    }
    const springForces = (model.springs || []).map((sp, k) => {
        if (!active[k]) return 0;
        const d = sp.node * 3 + (sp.dir === 'x' ? 0 : sp.dir === 'y' ? 1 : 2);
        return -sp.k * u[d];
    });
    const reactions = (model.supports || []).map(s => ({
        node: s.node,
        fx: s.ux ? R[s.node * 3] - 0 : 0,
        fy: s.uy ? R[s.node * 3 + 1] : 0,
        mz: s.rz ? R[s.node * 3 + 2] : 0,
    }));

    /**
     * 부재 내 x (i 단에서 거리) 위치의 단면력.
     * 규약: N 인장 +, V = 국부 y 방향 전단, M 은 국부 +y 면(왼쪽→오른쪽 부재의 윗면) 압축 시 + (처짐 아래로 볼록 = 하면인장 +)
     */
    function at(mi, x) {
        const e = memberEnd[mi], cc = cache[mi];
        // i 단 내력에서 하중 적분
        let N = e.N1, V = e.V1, M = e.M1;
        // M(x) = M1 + V1·x + Σ 하중 효과
        let Mx = M + V * x;
        let Vx = V, Nx = N;
        for (const ld of cc.loads) {
            if (ld.type === 'dist') {
                const a = ld.a, b = Math.min(ld.b, x);
                if (b <= a) continue;
                const steps = 24, h = (b - a) / steps;
                for (let k = 0; k < steps; k++) {
                    const xx = a + (k + 0.5) * h;
                    const t = (xx - ld.a) / ((ld.b - ld.a) || 1);
                    const qy = ld.qy1 + (ld.qy2 - ld.qy1) * t;
                    const qx = ld.qx1 + (ld.qx2 - ld.qx1) * t;
                    Vx += qy * h;
                    Mx += qy * h * (x - xx);
                    Nx -= qx * h;
                }
            } else if (ld.type === 'point' && ld.pos <= x) {
                Vx += ld.py;
                Mx += ld.py * (x - ld.pos) + (ld.m || 0);
                Nx -= ld.px;
            }
        }
        return { N: Nx, V: Vx, M: Mx };
    }
    return { u, reactions, memberEnd, springForces, at, cache };
}

/** 여러 하중경우 결과의 선형조합 계수 적용: forces = Σ f_k · r_k.at(m, x) */
export function combineAt(results, factors, mi, x) {
    let N = 0, V = 0, M = 0;
    for (const [key, f] of Object.entries(factors)) {
        const r = results[key];
        if (!r || !f) continue;
        const v = r.at(mi, x);
        N += f * v.N; V += f * v.V; M += f * v.M;
    }
    return { N, V, M };
}
