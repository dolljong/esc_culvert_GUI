// girder.js - 종방향 거더 구조계산 (중간벽체가 사각기둥/원형기둥인 경우)
//
// 횡방향 2D Frame 해석에서 중간벽체가 받는 축력 N (kN/m, 단위폭) 을 기둥 위치 선(거더)의
// 등분포하중 w 로 보고, 기둥 중심을 지점으로 하는 종방향 연속보를 직접강성법으로 해석한다.
//   상부거더 : w = 벽체 상단 압축력          (아래 방향)
//   하부거더 : w = 벽체 하단 압축력          (위 방향 — 지반반력이 거더를 거쳐 기둥으로 전달)
//   중간거더 : w = 하층 벽체 상단 − 상층 벽체 하단 압축력 (복층형, 아래 방향)
// 하중이 전 경간에 같은 비율로 걸리므로 단위하중 해석 1 회로 모든 조합의 단면력을 얻는다 (M = w·m).
// 단면력 산정 방법은 [설계 조건]의 '거더검토시 단면력산정방법' 을 따른다
// ('연속보 해석' 또는 '계수법 (wL²/n)').
//
// 부호: M > 0 → 하면 인장 (주철근 하면 L), M < 0 → 상면 인장 (상면 U).

import { solve } from './frameSolver.js';
import { analyze } from './frame2d.js';
import { getDesign, GIRDER_METHODS, GIRDER_SHEAR_OPTS } from './design.js';

export { GIRDER_METHODS, GIRDER_SHEAR_OPTS };
import { materials, barArea, barD } from './rebar.js';
import { blockFrame } from './rebarPlan.js';
import { flexure, shear as rcShear, crack as rcCrack } from './rcDesign.js';
import { columnWalls, girderMembers, getBeamCol, girderBars, girderDepth } from './beamCol.js';

const ULT_KINDS = ['factored', 'factoredEcc', 'eqCollapse', 'eqFunction'];
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

function envName(corrosion) {
    return /고부식/.test(corrosion) ? '고부식성' : /부식/.test(corrosion) ? '부식성' : /습윤/.test(corrosion) ? '습윤' : '건조';
}

/** 기둥 배치 (mm, 블록 시점 기준): { L, cols:[{ u, t }] } */
export function girderLayout(c, bi, wi) {
    const fr = blockFrame(c, bi);
    const L = fr.L0;
    const cw = columnWalls(c, bi).find(x => x.index === wi);
    const wc = c.columns && c.columns.blocks && c.columns.blocks[bi] && c.columns.blocks[bi].walls && c.columns.blocks[bi].walls[wi];
    const cols = [];
    if (wc && Array.isArray(wc.ctc) && wc.ctc.length) {
        let u = 0;
        wc.ctc.forEach((v, k) => { u += n0(v); cols.push({ u, t: n0(wc.t && wc.t[k]) || (cw ? cw.D : 600) }); });
    } else if (cw) {
        const n = Math.max(1, cw.n | 0);
        const e = (L - (n - 1) * cw.ctc) / 2;
        for (let k = 0; k < n; k++) cols.push({ u: e + k * cw.ctc, t: cw.D });
    }
    return { L, cols: cols.filter(q => q.u > 0 && q.u < L) };
}

/**
 * 단위 등분포하중 (1 kN/m, 아래) 연속보 해석. 단위 m.
 * 반환: { xs (m), m[], v[], R[] (기둥별 반력 kN), spans }
 */
export function unitBeam(layout, bw, h, E) {
    const L = layout.L / 1000;
    const us = layout.cols.map(q => q.u / 1000);
    const faces = layout.cols.flatMap(q => [(q.u - q.t / 2) / 1000, (q.u + q.t / 2) / 1000]);
    const brk = [0, L, ...us, ...faces.filter(x => x > 0 && x < L)].sort((a, b) => a - b);
    const xs = [];
    for (let i = 0; i < brk.length - 1; i++) {
        const a = brk[i], b = brk[i + 1];
        if (b - a < 1e-6) continue;
        const n = Math.max(1, Math.ceil((b - a) / 0.2 - 1e-9));
        for (let k = 0; k < n; k++) xs.push(a + (b - a) * k / n);
    }
    xs.push(L);
    const nodes = xs.map(x => ({ x, y: 0 }));
    const A = bw * h / 1e6, I = bw * h ** 3 / 12 / 1e12;
    const members = xs.slice(0, -1).map((_, i) => ({ i, j: i + 1, E, A, I }));
    const near = (x) => xs.reduce((best, v, k) => (Math.abs(v - x) < Math.abs(xs[best] - x) ? k : best), 0);
    const supNodes = us.map(near);
    const supports = supNodes.map((nd, k) => ({ node: nd, ux: k === 0, uy: true, rz: false }));
    if (supports.length === 1) supports[0].rz = true;     // 기둥 1 개: 캔틸레버 양측 (기둥 고정)
    const res = solve({ nodes, members, supports }, { dist: members.map((_, mi) => ({ member: mi, w1: -1, w2: -1, dir: 'gy' })) });
    const m = [], v = [];
    xs.forEach((x, k) => {
        const mi = Math.min(k, members.length - 1);
        const f = res.at(mi, k === xs.length - 1 ? x - xs[k - 1] : 0);
        m.push(f.M); v.push(f.V);
    });
    // 지점 좌·우 전단 (불연속)
    const vL = supNodes.map(nd => (nd > 0 ? res.at(nd - 1, xs[nd] - xs[nd - 1]).V : 0));
    const vR = supNodes.map(nd => (nd < xs.length - 1 ? res.at(nd, 0).V : 0));
    // 부재 양단 전단 (전단력도: 지점에서 수직으로 뛰도록 부재별 시·종점 값을 따로 둔다)
    const vSeg = members.map((_, mi) => [res.at(mi, 0).V, res.at(mi, xs[mi + 1] - xs[mi]).V]);
    const R = res.reactions.map(r => r.fy);
    return { xs, m, v, vL, vR, vSeg, R, supNodes, at: (x) => interp(xs, m, v, x) };
}

function interp(xs, m, v, x) {
    let k = xs.findIndex(q => q >= x - 1e-9);
    if (k <= 0) return { M: m[0], V: v[0] };
    const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1] || 1);
    return { M: m[k - 1] + (m[k] - m[k - 1]) * t, V: v[k - 1] + (v[k] - v[k - 1]) * t };
}

/** 조합별 거더 하중 w (kN/m, 거더 기준 하중방향 +) */
function girderLoads(r, wi, mem, double) {
    const len = (grp) => { try { return r.groupPath(grp).length; } catch { return 0; } };
    const comp = (name, grp, s) => -r.force(name, grp, s).N;       // 압축 +
    const lower = `mid:${wi}`, upper = `midU:${wi}`;
    const Hl = len(lower), Hu = len(upper);
    return r.combos.filter(cb => cb.res).map(cb => {
        let w;
        if (mem === 'top') w = double ? comp(cb.name, upper, Hu) : comp(cb.name, lower, Hl);
        else if (mem === 'bottom') w = comp(cb.name, lower, 0);
        else w = comp(cb.name, lower, Hl) - (Hu > 0 ? comp(cb.name, upper, 0) : 0);
        return { name: cb.name, kind: cb.kind, w };
    });
}

/**
 * 거더 하나의 해석 + 설계검토.
 * 반환: { mem, title, bw, h, d, layout, method, loads, ult:{wMax, wMin, at}, sv:{...}, beam, sections:[...], ok }
 */
export function girderCheck(p, c, bi, wi, mem, r) {
    const cw = columnWalls(c, bi).find(x => x.index === wi);
    if (!cw) return null;
    const dsg = getDesign(p);
    const o = dsg.opt || {};
    const { fck, fy, code } = materials(p);
    const env = envName(dsg.env.corrosion);
    const title = (girderMembers(cw.g).find(m => m[0] === mem) || [, mem])[1];
    const gd = getBeamCol(c, bi, wi, mem);
    const gb = girderBars(cw, mem, gd);
    const bw = gb.bw, h = girderDepth(cw.g, mem, cw.index);
    const layU = (gd.main.U || [])[0] || {}, layL = (gd.main.L || [])[0] || {};
    const dU = h - n0(layU.dist || 80), dL = h - n0(layL.dist || 80);
    const AsU = gb.bars.filter(b => b.face === 'U').reduce((a, b) => a + barArea(b.dia), 0);
    const AsL = gb.bars.filter(b => b.face === 'L').reduce((a, b) => a + barArea(b.dia), 0);
    const layout = girderLayout(c, bi, wi);
    const E = (+dsg.env.Ec || 26986) * 1000;
    const method = GIRDER_METHODS.includes(o.girderMethod) ? o.girderMethod : GIRDER_METHODS[0];
    const sgn = mem === 'bottom' ? -1 : 1;        // 하부거더는 위 방향 하중

    // 조합별 하중
    const loads = r ? girderLoads(r, wi, mem, cw.g.kind === 'DOUBLE') : [];
    const pick = (kinds) => {
        const ls = loads.filter(x => kinds.includes(x.kind));
        if (!ls.length) return null;
        const mx = ls.reduce((a, b) => (b.w > a.w ? b : a)), mn = ls.reduce((a, b) => (b.w < a.w ? b : a));
        return { wMax: Math.max(0, mx.w), wMin: Math.max(0, mn.w), at: mx.name, atMin: mn.name };
    };
    const ult = pick(ULT_KINDS), sv = pick(['service']);

    let beam = null, err = null;
    try { beam = unitBeam(layout, bw, h, E); } catch (e) { err = e.message; }

    const us = layout.cols.map(q => q.u / 1000);
    const Lm = layout.L / 1000;
    const spans = [];
    for (let k = 0; k < us.length - 1; k++) spans.push({ k, a: us[k], b: us[k + 1], L: us[k + 1] - us[k] });
    const Lmax = spans.length ? Math.max(...spans.map(s => s.L)) : Math.max(us[0] || 0, Lm - (us[us.length - 1] || 0));

    // 설계 단면력 (단위하중 m, v → w 배)
    const Mof = (mUnit, w) => sgn * w * mUnit;
    const sec = (label, x, mUnit, vUnit, kind) => ({ label, x, mUnit, vUnit, kind });
    const pts = [];
    if (method === GIRDER_METHODS[0] && beam) {
        const faceOf = (k, side) => (layout.cols[k].u + side * layout.cols[k].t / 2) / 1000;
        // 경간 정모멘트 최대 (단위하중 기준 최대 m)
        for (const s of spans) {
            let best = null;
            beam.xs.forEach((x, i) => { if (x > s.a + 1e-6 && x < s.b - 1e-6 && (!best || beam.m[i] > best.m)) best = { x, m: beam.m[i] }; });
            if (best) pts.push(sec(`경간${s.k + 1} 중앙부`, best.x, best.m, 0, 'span'));
        }
        // 지점 연단 부모멘트, 전단
        const dV = o.girderShear === GIRDER_SHEAR_OPTS[0] ? 0 : Math.max(dU, dL) / 1000;
        layout.cols.forEach((q, k) => {
            for (const side of [-1, 1]) {
                const xf = faceOf(k, side);
                if (xf <= 1e-6 || xf >= Lm - 1e-6) continue;
                const f = beam.at(xf);
                const xv = Math.max(0, Math.min(Lm, xf + side * dV));
                const fv = beam.at(xv);
                pts.push(sec(`지점${k + 1} ${side < 0 ? '좌측' : '우측'} 연단`, xf, f.M, fv.V, 'support'));
            }
        });
    } else {
        const kP = +o.girderPos || 14, kN = +o.girderNeg || 10, kV = +o.girderV || 1.15;
        const L2 = Lmax * Lmax;
        pts.push(sec(`경간 중앙부 (wL²/${kP})`, null, L2 / kP, 0, 'span'));
        pts.push(sec(`지점부 (wL²/${kN})`, null, -L2 / kN, kV * Lmax / 2, 'support'));
    }

    const crackS = (lay) => Math.max(50, n0(lay.C) || 100);
    for (const s of pts) {
        const Mu = ult ? Mof(s.mUnit, ult.wMax) : null;
        const tensionL = Mu != null ? Mu >= 0 : s.mUnit * sgn >= 0;
        const As = tensionL ? AsL : AsU, d = tensionL ? dL : dU, lay = tensionL ? layL : layU;
        const fl = flexure({ b: bw, d, As, fck, fy, code });
        const Vu = ult ? Math.abs(s.vUnit) * ult.wMax : null;
        const st = gd.stir || {};
        const sS = Math.min(...(st.segs || []).map(x => n0(x.s)).filter(v => v > 0), 300);
        const Av = barArea(st.dia) * 2 * Math.max(1, st.legs | 0);
        const vs = rcShear({ b: bw, h, d, fck, fy, code }, (Vu || 0) * 1e3, 0, { Av, s: sS, fyt: fy });
        const Ms = sv ? Math.abs(Mof(s.mUnit, sv.wMax)) : null;
        let cr = null;
        if (Ms && As > 0) {
            const dia = lay.dia || 'D25';
            const cover = Math.max(10, n0(lay.dist || 80) - barD(dia) / 2);
            try { cr = rcCrack({ b: bw, h, d, As, fck, fy, code, cover, dc: n0(lay.dist || 80), spacing: crackS(lay), env, Ec: dsg.env.Ec }, Ms * 1e6); } catch { cr = null; }
        }
        Object.assign(s, {
            face: tensionL ? '하면' : '상면', As, d, rho: fl.rho, rhoMin: fl.rhoMin, rhoMax: fl.rhoMax, okRho: fl.rho >= fl.rhoMin && fl.rho <= fl.rhoMax,
            Mu: Mu != null ? Math.abs(Mu) : null, phiMn: fl.phiMn / 1e6, okM: Mu != null ? fl.phiMn / 1e6 >= Math.abs(Mu) : null,
            Vu, phiVc: vs.phiVc / 1e3, phiVn: vs.phiVn / 1e3, okV: Vu != null && s.vUnit ? vs.phiVn / 1e3 >= Vu : null,
            stirS: sS, sMax: Math.min(d / 2, 600), okS: s.vUnit ? sS <= Math.min(d / 2, 600) : null,
            Ms, cr, okCr: cr ? cr.ok : null,
        });
    }
    const ok = pts.every(s => s.okM !== false && s.okV !== false && s.okCr !== false && s.okS !== false && s.okRho !== false);
    return {
        mem, title, bw, h, AsU, AsL, dU, dL, layout, method, spans, Lmax, loads, ult, sv, beam, err,
        sections: pts, ok, sgn, env, fck, fy,
        reactions: beam && ult ? beam.R.map(R => R * ult.wMax) : null,
    };
}

/**
 * 벽체 wi 의 모든 거더 검토 + 기둥 축력 (거더 반력 기준).
 * opts.r: 이미 계산한 analyze 결과 (없으면 해당 블록 첫 검토단면으로 해석)
 */
export function girderAnalysis(p, c, bi, wi, opts = {}) {
    const cw = columnWalls(c, bi).find(x => x.index === wi);
    if (!cw) return null;
    let r = opts.r || null, err = null;
    if (!r) { try { r = analyze(p, c, 0, { block: bi }); } catch (e) { err = e.message; } }
    const girders = girderMembers(cw.g).filter(m => m[0] !== 'col').map(([mem]) => girderCheck(p, c, bi, wi, mem, r));
    // 기둥 축력: 하부거더 반력 (기둥 하단 = 상부 반력 + 기둥 자중)
    const pick = (mem) => girders.find(g => g && g.mem === mem);
    const top = pick('top'), bot = pick('bottom');
    const Pcol = (bot && bot.reactions) || (top && top.reactions) || null;
    return { cw, r, err, girders: girders.filter(Boolean), Pcol };
}
