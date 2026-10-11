// beamCol.js - 기둥 · 거더 철근 (배근 입력 > 보, 기둥 철근, 매뉴얼 5.10)
//
// 중간벽체가 사각기둥/원형기둥인 경우 블록·벽체별로 기둥 철근과 상부/하부/중간 거더 철근을 입력한다.
// 데이터: culverts[i].rebar.beamCol[bi] = { std: 150, walls: { [wallIndex]: {
//   col: { main:{ layers:[ { use, dist, dia, C1, B, C, C2, F1, E, F, F2, R } ×3 ] },        R: 원형 단면 철근 개수
//          tie: { dia, C1, B, C, C2, F1, E, F, F2 },                                       크로스타이
//          hoop:{ dia, segs:[{n,s}] } },                                                  띠철근 (하단 피복부터 위로)
//   top|bottom|mid: { main:{ U:[layer×3], L:[layer×3] }, horz:{ dia, F1, E, F, F2 },       거더
//                     stir:{ dia, legs, segs:[{n,s}] } } } } }                              스터럽 (블록 시점 피복부터)
// 면 배치 'C1 | B@C | C2': 모서리 철근(피복 dist) → C1 → B 개 × C 간격 → C2 → 반대 모서리. F1/E@F/F2 는 직교 면.

import { sectionGeom, haunchSize } from './sectionGeom.js';
import { getSettings, barArea, barD, materials, lapLength, roundBarLen } from './rebar.js';
import { blockFrame, planCover } from './rebarPlan.js';
import { flexure, pmCheck, shear as rcShear } from './rcDesign.js';

export const MEMBERS = [['col', '기둥'], ['top', '상부거더'], ['bottom', '하부거더'], ['mid', '중간거더']];
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);
export const isColumnType = (t) => t === '사각기둥' || t === '원형기둥';

/** 기둥 벽체 목록 (하층) [{ index, w, round, b, D, H, n, ctc }] */
export function columnWalls(c, bi = 0) {
    const g = sectionGeom(c, bi);
    const mids = g.walls.filter(w => w.kind === 'mid' && w.floor !== 2);
    const cb = c.columns && c.columns.blocks && c.columns.blocks[bi];
    const fr = blockFrame(c, bi);
    return mids.map((w, k) => ({ w, k })).filter(x => isColumnType(x.w.type)).map(({ w, k }) => {
        const cw = cb && cb.walls && cb.walls[k];
        const n = cw ? Math.max(1, cw.n | 0) : Math.max(1, Math.floor((fr.L0 - 2000) / 1800) + 1);
        const tL = cw && cw.t && n0(cw.t[0]) > 0 ? n0(cw.t[0]) : Math.max(600, w.t);
        const ctc = cw && cw.ctc && cw.ctc.length > 1 ? n0(cw.ctc[1]) : (n > 1 ? (fr.L0 - 2000) / (n - 1) : fr.L0);
        const H = g.kind === 'DOUBLE' ? g.MH : g.H;
        return { index: w.index, w, round: w.type === '원형기둥', b: w.t, D: w.type === '원형기둥' ? w.t : tL, H, n, ctc: ctc || fr.L0, g };
    });
}

export function hasColumns(c) {
    try {
        const nb = Math.max(1, (c.joints || []).length - 1);
        for (let bi = 0; bi < nb; bi++) if (columnWalls(c, bi).length) return true;
    } catch { /* 무시 */ }
    return false;
}

/** 거더 부재 사용 여부 */
export function girderMembers(g) {
    const out = [['col', '기둥'], ['top', '상부거더'], ['bottom', '하부거더']];
    if (g.kind === 'DOUBLE') out.push(['mid', '중간거더']);
    if (g.kind === 'U') return out.filter(m => m[0] !== 'top');
    return out;
}

/** 면 배치 기본값 (모서리 피복 dist, 중간 간격 100) */
function faceLayout(Lf, dist = 80, sp = 100) {
    const inner = Lf - 2 * dist;
    const B = Math.max(0, Math.floor((inner - 140) / sp + 1e-9));
    const e = Math.round((inner - B * sp) / 2);
    return { C1: e, B, C: sp, C2: e };
}

const emptyLayer = () => ({ use: false, dist: 0, dia: '', C1: 0, B: 0, C: 0, C2: 0, F1: 0, E: 0, F: 0, F2: 0, R: 0 });

function hoopSegs(H, std, size) {
    const net = H - 160;
    const Le = Math.max(size, H / 6, 450);
    const n1 = Math.max(1, Math.ceil(Le / std));
    const rest = net - 2 * n1 * std;
    const nm = Math.max(0, Math.floor(rest / (2 * std)));
    const r = Math.round(rest - nm * 2 * std);
    const segs = [];
    if (r > 0) segs.push({ n: 1, s: r });
    segs.push({ n: n1, s: std });
    if (nm) segs.push({ n: nm, s: 2 * std });
    segs.push({ n: n1, s: std });
    return segs;
}

export function defaultColumn(cw, std = 150) {
    const L1 = { use: true, dist: 80, dia: 'D22', ...faceLayout(cw.b), R: 0 };
    const fv = faceLayout(cw.D);
    L1.F1 = fv.C1; L1.E = fv.B; L1.F = fv.C; L1.F2 = fv.C2;
    if (cw.round) L1.R = Math.max(6, Math.round(Math.PI * (cw.b - 160) / 150));
    return {
        main: { layers: [L1, emptyLayer(), emptyLayer()] },
        tie: { dia: 'D19', C1: Math.round(cw.b / 2 - 80), B: 0, C: 0, C2: 0, F1: Math.round(cw.D / 2 - 80), E: 0, F: 0, F2: 0 },
        hoop: { dia: 'D16', segs: hoopSegs(cw.H, std, Math.max(cw.b, cw.D)) },
    };
}

/**
 * 거더 높이 = 슬래브 두께 + 기둥(벽체 wi)에 붙은 헌치 높이.
 *   상부거더 UT + 상부 헌치, 하부거더 LT + 하부 헌치, 중간거더 MT + 하층 상부 헌치 + 상층 하부 헌치
 */
export function girderDepth(g, mem, wi = null) {
    const t = mem === 'top' ? g.UT : mem === 'bottom' ? g.LT : g.MT;
    if (wi == null) return t;
    const dbl = g.kind === 'DOUBLE';
    const hsOf = (floor) => (dbl ? ((g.sec.haunch2 || {})[floor] || []) : (g.sec.haunch || []));
    const hh = (floor, a, b) => {
        const hs = hsOf(floor);
        return Math.max(haunchSize((hs[wi] || {})[a]).w || 0, haunchSize((hs[wi + 1] || {})[b]).w || 0);
    };
    if (mem === 'top') return t + hh(dbl ? 'upper' : 'lower', 'UR', 'UL');
    if (mem === 'bottom') return t + hh('lower', 'LR', 'LL');
    return t + hh('lower', 'UR', 'UL') + hh('upper', 'LR', 'LL');
}

export function defaultGirder(cw, mem, Lg, std = 200) {
    const g = cw.g;
    const h = girderDepth(g, mem, cw.index);
    const lay = () => ({ use: true, dist: 80, dia: 'D25', ...faceLayout(cw.b), F1: 0, E: 0, F: 0, F2: 0, R: 0 });
    const n = Math.max(1, Math.floor((Lg - 200) / std + 1e-9));
    const e = Math.round((Lg - n * std) / 2);
    return {
        main: { U: [lay(), emptyLayer(), emptyLayer()], L: [lay(), emptyLayer(), emptyLayer()] },
        horz: { dia: 'D19', F1: 120, E: Math.max(0, Math.floor((h - 160 - 120) / 150)), F: 150, F2: 0 },
        stir: { dia: 'D19', legs: 1, segs: [{ n: 1, s: e }, { n, s: std }, { n: 1, s: e }] },
    };
}

/** 저장값 + 기본값 (벽체 wi 의 부재 mem) */
export function getBeamCol(c, bi, wi, mem) {
    const cw = columnWalls(c, bi).find(x => x.index === wi);
    if (!cw) return null;
    const s = c.rebar && c.rebar.beamCol && c.rebar.beamCol[bi];
    const std = (s && s.std) || 150;
    const v = s && s.walls && s.walls[wi] && s.walls[wi][mem];
    if (v) return v;
    const fr = blockFrame(c, bi);
    const Lg = fr.L0 - 2 * planCover(getSettings(c, bi));
    return mem === 'col' ? defaultColumn(cw, std) : defaultGirder(cw, mem, Lg, 200);
}

/** 면 위치 목록 (dist 부터) : [dist, dist+C1, +C …, +C2] (중복 제거) */
export function facePositions(Lf, ly, keys = ['C1', 'B', 'C', 'C2']) {
    const [k1, kn, ks, k2] = keys;
    const d = n0(ly.dist);
    const out = [d];
    let x = d;
    if (n0(ly[k1]) > 0) { x += n0(ly[k1]); out.push(x); }
    for (let i = 0; i < (ly[kn] | 0); i++) { x += n0(ly[ks]); out.push(x); }
    if (n0(ly[k2]) > 0) { x += n0(ly[k2]); out.push(x); }
    const last = Lf - d;
    if (Math.abs(out[out.length - 1] - last) > 1) out.push(last);
    return out.filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1);
}

/**
 * 기둥 단면 철근 위치 [{ x, y, dia }] (x: 단면 폭 b 방향 0~b, y: 길이방향 0~D)
 */
export function columnBars(cw, col) {
    const out = [];
    for (const ly of col.main.layers) {
        if (!ly || !ly.use || !ly.dia) continue;
        if (cw.round) {
            const r = cw.b / 2 - n0(ly.dist), n = Math.max(3, ly.R | 0);
            for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n + Math.PI / 2; out.push({ x: cw.b / 2 + r * Math.cos(a), y: cw.D / 2 + r * Math.sin(a), dia: ly.dia }); }
            continue;
        }
        const xs = facePositions(cw.b, ly);
        const ys = facePositions(cw.D, ly, ['F1', 'E', 'F', 'F2']);
        const d = n0(ly.dist);
        for (const x of xs) { out.push({ x, y: d, dia: ly.dia }); out.push({ x, y: cw.D - d, dia: ly.dia }); }
        for (const y of ys.slice(1, -1)) { out.push({ x: d, y, dia: ly.dia }); out.push({ x: cw.b - d, y, dia: ly.dia }); }
    }
    return out;
}

/** 거더 단면 철근 위치 [{ x, y, dia, face }] (x: 폭 0~bw, y: 하면 0 ~ h) */
export function girderBars(cw, mem, gd) {
    const h = girderDepth(cw.g, mem, cw.index), bw = cw.b;
    const out = [];
    for (const face of ['U', 'L']) {
        for (const ly of gd.main[face] || []) {
            if (!ly || !ly.use || !ly.dia) continue;
            const y = face === 'U' ? h - n0(ly.dist) : n0(ly.dist);
            for (const x of facePositions(bw, ly)) out.push({ x, y, dia: ly.dia, face });
        }
    }
    const hz = gd.horz || {};
    if (hz.dia) {
        const d = 80;
        let y = h - d - n0(hz.F1);
        const ys = [];
        if (n0(hz.F1) > 0) ys.push(y);
        for (let i = 0; i < (hz.E | 0); i++) { y -= n0(hz.F); ys.push(y); }
        for (const yy of ys) if (yy > d + 1 && yy < h - d - 1) { out.push({ x: d, y: yy, dia: hz.dia, face: 'S' }); out.push({ x: bw - d, y: yy, dia: hz.dia, face: 'S' }); }
    }
    return { h, bw, bars: out };
}

/**
 * 구간 위치. withBase = true 이면 base 에도 철근 (띠철근: 하단 피복 위치부터),
 * limit 를 주면 그 이상(끝 피복 위치)의 위치는 뺀다 (스터럽).
 */
export function segPositions(segs, base = 0, withBase = true, limit = Infinity) {
    const out = withBase ? [base] : [];
    let s = base;
    for (const sg of segs || []) for (let k = 0; k < (sg.n | 0); k++) { s += n0(sg.s); if (s < limit - 50) out.push(s); }
    return out;
}

/**
 * 설계검토. 해석 결과(designForces df)의 중간벽체 부재력(단위폭 kN/m)을 기둥 간격으로 환산한다.
 * ga (girder.js girderAnalysis 결과) 를 주면 거더는 종방향 거더 해석 결과를, 기둥 축력은 거더 반력을 쓴다.
 * 반환: { col:{...}, girders:[{ mem, ... }] }
 */
export function beamColCheck(p, c, bi, wi, df, ga = null) {
    const cw = columnWalls(c, bi).find(x => x.index === wi);
    if (!cw) return null;
    const { fck, fy, code } = materials(p);
    const d = (p.design && p.design.opt) || {};
    const kPos = +d.girderPos || 14, kNeg = +d.girderNeg || 10, kV = +d.girderV || 1.15;
    // 부재력
    let Nline = null, Mline = null, Vline = null;
    const grp = df && df.groups ? df.groups.find(x => x.id === `mid:${wi}`) : null;
    if (grp) {
        Nline = 0; Mline = 0; Vline = 0;
        for (const col of grp.cols) {
            Nline = Math.max(Nline, Math.abs(col.N.A || 0), Math.abs(col.N.B || 0), Math.abs(col.NV || 0));
            Mline = Math.max(Mline, Math.abs(col.M.A || 0), Math.abs(col.M.B || 0));
            Vline = Math.max(Vline, Math.abs(col.V || 0));
        }
    }
    const L = cw.ctc / 1000;
    // 기둥
    const colData = getBeamCol(c, bi, wi, 'col');
    const bars = columnBars(cw, colData);
    const AsT = bars.reduce((a, b) => a + barArea(b.dia), 0);
    const Ag = cw.round ? Math.PI * cw.b * cw.b / 4 : cw.b * cw.D;
    const rho = AsT / Ag;
    // 휨 방향: 단면 폭 b 방향 (암거 횡방향)
    const bEq = cw.round ? Ag / cw.b : cw.D;
    const layerMap = new Map();
    for (const b of bars) { const k = Math.round(b.x); layerMap.set(k, (layerMap.get(k) || 0) + barArea(b.dia)); }
    const layers = [...layerMap.entries()].map(([x, As]) => ({ d: x, As }));
    const Pga = ga && ga.Pcol && ga.Pcol.length ? Math.max(...ga.Pcol) : null;
    const Pu = Pga != null ? Pga : Nline != null ? Nline * L : null, Mu = Mline != null ? Mline * L : null, Vu = Vline != null ? Vline * L : null;
    let pm = null;
    try { pm = pmCheck({ b: bEq, h: cw.b, fck, fy, code, layers }, (Pu || 0) * 1e3, (Mu || 0) * 1e6); } catch { pm = null; }
    const tieA = barArea(colData.hoop.dia) * 2;
    const hoopS = Math.min(...(colData.hoop.segs || []).map(s => n0(s.s)).filter(v => v > 0), 300);
    const dcol = cw.b - 80;
    const vs = rcShear({ b: bEq, h: cw.b, d: dcol, fck, fy, code }, (Vu || 0) * 1e3, (Pu || 0) * 1e3, { Av: tieA, s: hoopS, fyt: fy });
    const sMax = Math.min(16 * barD(colData.main.layers[0].dia || 'D22'), 48 * barD(colData.hoop.dia), Math.min(cw.b, cw.D));
    const col = {
        b: cw.b, D: cw.D, round: cw.round, n: bars.length, As: AsT, Ag, rho, okRho: rho >= 0.01 && rho <= 0.08,
        Pu, Mu, Vu, phiPn: pm ? pm.phiPn / 1e3 : null, phiMn: pm ? pm.phiMn / 1e6 : null, sfPM: pm && Mu ? pm.sf : null, okPM: pm && Mu != null ? pm.ok : null,
        phiVn: vs.phiVn / 1e3, okV: Vu != null ? vs.phiVn / 1e3 >= Vu : null, hoopS, sMax, okS: hoopS <= sMax,
    };
    // 거더
    const girders = [];
    if (ga) {
        for (const g of ga.girders) {
            const span = g.sections.filter(s => s.kind === 'span'), sup = g.sections.filter(s => s.kind === 'support');
            const gov = (list, key) => list.reduce((a, b) => (b[key] != null && (a == null || b[key] > a[key]) ? b : a), null);
            const sP = gov(span, 'Mu'), sN = gov(sup, 'Mu'), sV = gov(sup, 'Vu');
            girders.push({
                mem: g.mem, title: g.title, bw: g.bw, h: g.h, AsU: g.AsU, AsL: g.AsL,
                rhoP: sP ? sP.rho : null, rhoN: sN ? sN.rho : null,
                okRho: g.sections.every(s => s.okRho !== false),
                MuP: sP ? sP.Mu : null, MuN: sN ? sN.Mu : null, phiMnP: sP ? sP.phiMn : null, phiMnN: sN ? sN.phiMn : null,
                okMP: sP ? sP.okM : null, okMN: sN ? sN.okM : null,
                Vu: sV ? sV.Vu : null, phiVn: sV ? sV.phiVn : null, okV: sV ? sV.okV : null,
            });
        }
        return { cw, Nline, Mline, Vline, col, girders, ga };
    }
    for (const [mem, title] of girderMembers(cw.g).filter(m => m[0] !== 'col')) {
        const gd = getBeamCol(c, bi, wi, mem);
        const gb = girderBars(cw, mem, gd);
        const AsU = gb.bars.filter(b => b.face === 'U').reduce((a, b) => a + barArea(b.dia), 0);
        const AsL = gb.bars.filter(b => b.face === 'L').reduce((a, b) => a + barArea(b.dia), 0);
        const dd = gb.h - 80;
        const fP = flexure({ b: gb.bw, h: gb.h, d: dd, As: mem === 'bottom' ? AsU : AsL, fck, fy, code });
        const fN = flexure({ b: gb.bw, h: gb.h, d: dd, As: mem === 'bottom' ? AsL : AsU, fck, fy, code });
        const w = Nline;
        const MuP = w != null ? w * L * L / kPos : null, MuN = w != null ? w * L * L / kNeg : null, VuG = w != null ? kV * w * L / 2 : null;
        const st = gd.stir || {};
        const sS = Math.min(...(st.segs || []).map(s => n0(s.s)).filter(v => v > 0), 300);
        const Av = barArea(st.dia) * 2 * Math.max(1, st.legs | 0);
        const vg = rcShear({ b: gb.bw, h: gb.h, d: dd, fck, fy, code }, (VuG || 0) * 1e3, 0, { Av, s: sS, fyt: fy });
        girders.push({
            mem, title, bw: gb.bw, h: gb.h, d: dd, AsU, AsL,
            rhoP: fP.rho, rhoN: fN.rho, rhoMin: fP.rhoMin, rhoMax: fP.rhoMax,
            okRho: fP.rho >= fP.rhoMin && fP.rho <= fP.rhoMax && fN.rho <= fN.rhoMax,
            MuP, MuN, phiMnP: fP.phiMn / 1e6, phiMnN: fN.phiMn / 1e6,
            okMP: MuP != null ? fP.phiMn / 1e6 >= MuP : null, okMN: MuN != null ? fN.phiMn / 1e6 >= MuN : null,
            Vu: VuG, phiVn: vg.phiVn / 1e3, okV: VuG != null ? vg.phiVn / 1e3 >= VuG : null, s: sS, sMax: Math.min(dd / 2, 600),
        });
    }
    return { cw, Nline, Mline, Vline, col, girders };
}

/** 길이방향 철근 길이 → 겹이음 수 */
export function lapCount(p, len, dia, std = 8000) {
    if (!(len > std)) return { lap: 0, lapN: 0 };
    const lap = lapLength(p, dia, { cls: 'B' });
    return { lap, lapN: Math.ceil((len - std) / Math.max(1000, std - lap)) };
}

export { roundBarLen };
