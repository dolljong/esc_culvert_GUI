// frame2d.js - 2D Frame 해석 실행 (구조 계산 > 2D Frame 해석)
//
// analyze(p, c, checkIndex) → {
//   cond, kv, model (상시), modelEq (지진시), cases [{key, name, cat, eq, res}], combos [{name, kind, res}],
//   force(name, group, s) → {N, V, M}        name = 케이스 key 또는 조합 이름, s = 부재군 시점에서 거리(m)
//   envelope(kinds, group, s) → { Mmax, Mmin, Vmax, Vmin, Nmax, Nmin, at:{...조합 이름} }
//   stations(group) → [s...] (절점 위치)
// }
// 결과는 입력이 바뀌지 않으면 캐시한다.
//
// 단위: kN, m. 모멘트 부호: 하면(부재 국부 +y 반대면) 인장 +.
//   슬래브(왼→오): + = 하면 인장, 벽(아래→위): + = 우측면 인장.

import { solve } from './frameSolver.js';
import { buildModel, toSolverLoad, groupPath, locate } from './frameModel.js';
import { loadCases } from './loads.js';
import { combos as comboList } from './combos.js';
import { getDesign } from './design.js';
import { checkCondition, getChecks } from './loadHelpers.js';
import { verticalSubgrade, deformationModulus } from './bearing.js';

const cache = new Map();

/** 기초 지반의 N 값 (검토단면 보링 → 기초 하면 위치 지층) */
function baseN(cond) {
    const b = cond.row && cond.row.boring;
    if (b && b.layers && b.layers.length) {
        const depth = (+b.topEl || cond.groundEl) - cond.botEl;
        let acc = 0;
        for (const L of b.layers) {
            acc = +L.dH > acc ? +L.dH : acc + (+L.dH || 0);   // dH 누적값 / 두께 모두 허용
            if (acc >= depth - 1e-6) return +L.N || 10;
        }
        return +b.layers[b.layers.length - 1].N || 10;
    }
    return 15;
}

/** 지반반력계수 (상시/지진시) */
export function subgrade(p, c, cond) {
    const d = getDesign(p);
    const o = d.opt;
    const g = cond.g;
    const B = (g.baseX1 - g.baseX0) / 1000;
    const bl = (c.joints && c.joints[cond.bi + 1]) ? +c.joints[cond.bi + 1].dist : 10;
    const L = o.bvDir === '종방향' ? bl : B;
    const N = baseN(cond);
    const Eo = deformationModulus(0, 2800, N);
    if (o.kvMode === '사용하지않음') return { mode: 'fixed', N, Eo, B, kv: 0, kvEq: 0, lines: ['지반반력계수 미사용 (하부 고정지점)'] };
    if (o.kvMode === 'Terzaghi 보정식 사용자입력' && +o.kvUser > 0) {
        return { mode: 'user', N, Eo, B, kv: +o.kvUser, kvEq: +o.kvUser * (+o.alphaSeis || 2) / (+o.alphaStatic || 1), lines: [`kv = ${o.kvUser} kN/m³ (사용자입력)`] };
    }
    const aS = +o.alphaStatic || 1, aE = +o.alphaSeis || 2;
    const kv = verticalSubgrade(Eo, B, L, aS);
    const kvEq = verticalSubgrade(Eo, B, L, aE);
    const Bv = Math.sqrt(B * L);
    return {
        mode: 'calc', N, Eo, B, L, Bv, kv, kvEq,
        lines: [
            `Eo = 2800·N = 2800 × ${N} = ${Eo.toFixed(0)} kN/m²`,
            `Bv = √(B·L) = √(${B.toFixed(3)} × ${L.toFixed(3)}) = ${Bv.toFixed(3)} m`,
            `kv0 = (1/0.3)·α·Eo  (상시 α=${aS}, 지진시 α=${aE})`,
            `kv = kv0·(Bv/0.3)^(-3/4) = ${kv.toFixed(0)} kN/m³ (상시), ${kvEq.toFixed(0)} kN/m³ (지진시)`,
        ],
    };
}

function combineLoads(model, cases, factors) {
    const out = { nodal: [], dist: [], point: [], temp: [] };
    for (const [key, f] of Object.entries(factors)) {
        const cs = cases.find(x => x.key === key);
        if (!cs || !f) continue;
        const ld = toSolverLoad(model, cs);
        for (const d of ld.dist) out.dist.push({ ...d, w1: d.w1 * f, w2: d.w2 * f });
        for (const q of ld.point) out.point.push({ ...q, P: q.P * f });
        for (const t of ld.temp) out.temp.push({ ...t, dT: t.dT * f, dTg: t.dTg * f });
    }
    return out;
}

/** 선형 결과 중첩: parts = [[caseResult, factor]] */
function superpose(parts, m) {
    const n = m.nodes.length * 3;
    const u = new Float64Array(n);
    const springForces = new Array((m.springs || []).length).fill(0);
    for (const [r, f] of parts) {
        for (let i = 0; i < n; i++) u[i] += f * r.res.u[i];
        r.res.springForces.forEach((v, k) => { springForces[k] += f * v; });
    }
    return {
        u, springForces, reactions: [],
        at(mi, x) {
            let N = 0, V = 0, M = 0;
            for (const [r, f] of parts) { const v = r.res.at(mi, x); N += f * v.N; V += f * v.V; M += f * v.M; }
            return { N, V, M };
        },
    };
}

function withSupports(model, sg) {
    if (sg.mode !== 'fixed') return model;
    const bot = [...new Set(model.groups.bottom.flatMap(m => [model.members[m].i, model.members[m].j]))];
    return { ...model, springs: [], supports: bot.map((n, k) => ({ node: n, uy: true, ux: k === 0 })) };
}

export function analyze(p, c, checkIndex = 0, opts = {}) {
    const ch = getChecks(p, c);
    let k = Math.max(0, Math.min(ch.rows.length - 1, checkIndex | 0));
    // opts.block: 해당 블록의 첫 검토단면 사용 (배근 화면)
    if (opts.block != null) {
        const j = ch.rows.findIndex(r => (r.block | 0) === opts.block);
        if (j >= 0) k = j;
    }
    // 해석에 영향을 주는 입력만 키로 사용 (화면 보기 옵션 변경 시 재해석하지 않도록)
    const pickC = (({ type, startSta, joints, zones, offset, section, blockSections, ground, profile, cross, columns, foundType, foundation, checks, loadDef, loadComb, wings }) =>
        ({ type, startSta, joints, zones, offset, section, blockSections, ground, profile, cross, columns, foundType, foundation, checks, loadDef, loadComb, wings }))(c);
    const key = JSON.stringify([p.design, p.alignment.vip, p.alignment.groundLine, pickC, k]);
    if (cache.has(key)) return cache.get(key);
    if (cache.size > 30) cache.clear();

    const cond = checkCondition(p, c, k, 'calc');
    const d = getDesign(p);
    const E = (+d.env.Ec || 26986) * 1000;
    const sg = subgrade(p, c, cond);
    const gap = (+d.opt.springGap || 500) / 1000;
    const wallGap = (+d.opt.wallSpringGap || 500) / 1000;
    const cases = loadCases(p, c, k);
    const seisCase = cases.find(cs => cs.seis && cs.seis.method === '응답변위법');
    const model = withSupports(buildModel(c, cond.bi, { E, springGap: gap, wallGap, kv: sg.kv, springMode: d.opt.soil2dStatic, nlFix: d.opt.nlFix }), sg);
    const modelEq = withSupports(buildModel(c, cond.bi, {
        E, springGap: gap, wallGap, kv: sg.kvEq || sg.kv, springMode: d.opt.soil2dSeis, nlFix: d.opt.nlFix,
        wallKh: seisCase ? seisCase.seis.kh : 0,
    }), sg);

    const caseRes = [];
    for (const cs of cases) {
        const eq = cs.cat === '지진하중';
        const m = eq ? modelEq : model;
        let res = null, error = null;
        try { res = solve(m, toSolverLoad(m, cs)); } catch (e) { error = e.message; }
        caseRes.push({ key: cs.key, name: cs.name, cat: cs.cat, eq, lc: cs, res, error, model: m });
    }
    const cbs = comboList(p, c, k);
    const comboRes = [];
    for (const cb of cbs) {
        const eq = cb.kind === 'eqCollapse' || cb.kind === 'eqFunction';
        const m = eq ? modelEq : model;
        let res = null, error = null;
        const linear = !(m.springs || []).some(sp => sp.compressionOnly);
        if (linear) {
            // 선형 모델: 하중경우 결과를 계수로 중첩 (조합마다 다시 풀지 않는다)
            const parts = Object.entries(cb.factors).map(([key, f]) => [caseRes.find(x => x.key === key), f]).filter(([r, f]) => r && r.res && f && r.model === m);
            const bad = Object.keys(cb.factors).find(key => { const r = caseRes.find(x => x.key === key); return r && r.error; });
            if (bad) error = caseRes.find(x => x.key === bad).error;
            else res = superpose(parts, m);
        } else {
            try { res = solve(m, combineLoads(m, cases, cb.factors)); } catch (e) { error = e.message; }
        }
        comboRes.push({ ...cb, eq, res, error, model: m });
    }

    const find = (name) => caseRes.find(x => x.key === name) || comboRes.find(x => x.name === name);

    const gname = (g) => (g === 'mid' ? 'middle' : g);

    function force(name, group, s) {
        group = gname(group);
        const r = find(name);
        if (!r || !r.res) return { N: 0, V: 0, M: 0 };
        const loc = locate(r.model, group, s);
        if (!loc) return { N: 0, V: 0, M: 0 };
        return r.res.at(loc.m, loc.x);
    }

    function envelope(kinds, group, s) {
        // 호출 형식 2: envelope(group, s, { state: '평상시'|'지진시' })
        if (typeof kinds === 'string' && !Array.isArray(kinds)) {
            const o = (typeof s === 'object' ? s : group && typeof group === 'object' ? group : {}) || {};
            const gx = kinds, sx = typeof group === 'number' ? group : s;
            const eq = o.state === '지진시' || o.seismic;
            return envelope(eq ? ['eqCollapse', 'eqFunction'] : ['factored', 'factoredEcc'], gx, sx);
        }
        group = gname(group);
        const list = comboRes.filter(x => !kinds || kinds.includes(x.kind));
        const out = { Mmax: -Infinity, Mmin: Infinity, Vmax: -Infinity, Vmin: Infinity, Nmax: -Infinity, Nmin: Infinity, at: {} };
        for (const cb of list) {
            const f = force(cb.name, group, s);
            const upd = (key, v, cmp) => { if (cmp(v, out[key])) { out[key] = v; out.at[key] = cb.name; out.at[key + 'N'] = f.N; out.at[key + 'M'] = f.M; } };
            upd('Mmax', f.M, (a, b) => a > b); upd('Mmin', f.M, (a, b) => a < b);
            upd('Vmax', f.V, (a, b) => a > b); upd('Vmin', f.V, (a, b) => a < b);
            upd('Nmax', f.N, (a, b) => a > b); upd('Nmin', f.N, (a, b) => a < b);
        }
        return out;
    }

    function stations(group) {
        const pth = groupPath(model, group);
        const out = [0];
        for (const sgm of pth.segs) out.push(sgm.s1);
        return out;
    }

    const result = { cond, kv: sg, design: d, model, modelEq, cases: caseRes, combos: comboRes, force, envelope, stations, groupPath: (gname) => groupPath(model, gname), checkIndex: k };
    cache.set(key, result);
    return result;
}

export function clearCache() { cache.clear(); }
