// etcRebar.js - 기타 철근: 난간벽 / 차수벽·접속저판 연결철근 / 부상방지저판 (배근 입력 > 기타 철근, 매뉴얼 5.13)
//
// 데이터: culverts[i].rebar.etc = {
//   rail: [시점, 종점] { NA1, type:'도로공사타입'|'건교부타입', ctc, dc1, dc2, dc3, L1, hOn, NA2, F1, E, F, F2 },
//   cut:  [시점, 종점] { NA1, ctc, dc1, dc2, dc3, dc4, L1, hOn, NA2, F1, E, F, F2, dcOn, DC, dc5, dcCtc, CL },
//   anti: { dmDia, dmCtc:'주철근CTC'|'주철근CTC/2', bo2Dia, bo2H, bo2V, bo3Dia, bo3Ctc, bo3Type, bo3N } }
// 난간벽 dc1/dc2 = 수직철근 상/하 피복, dc3 = 전면 피복, L1 = 수직철근 하단의 수평 정착길이,
//   수평철근: 상단 피복에서 F1 → E@F (도로공사타입 = 앞뒤가 이어진 ㄷ형, 건교부타입 = 면별 ㄱ형/직선)
// 차수벽 dc1/dc2 = 상/하 피복, dc3 = 전면, dc4 = 배면 피복, L1 = 상단 수평정착, 수평철근: 하단 피복에서 F1 → E@F,
//   접속저판 연결철근: DC 직경, dc5 = 하부슬래브 상면에서의 위치, dcCtc, CL 길이.
// 측면 국부좌표는 calc/parapetGeom.js 와 같다 (x = 단부면에서 암거 안쪽 +, y = 기초 하면 0).

import { getParapet, parapetApplicable } from './parapetGeom.js';
import { sectionGeom } from './sectionGeom.js';
import { blocks } from '../core/model.js';
import { getSettings, devLength, barD, barInfo } from './rebar.js';
import { shapeFromPts } from './barShapes.js';
import { shearDims, SHEAR_TYPES } from './shearBars.js';
import { blockFrame, planCover } from './rebarPlan.js';

export const RAIL_TYPES = ['도로공사타입', '건교부타입'];
export const DM_CTC = ['주철근CTC', '주철근CTC/2'];
export { SHEAR_TYPES };
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

export function defaultRailRebar(e) {
    const Wh = n0(e && e.rail && e.rail.Wh) || 600;
    return { NA1: 'D16', type: RAIL_TYPES[0], ctc: 300, dc1: 50, dc2: 80, dc3: 50, L1: 500, hOn: true, NA2: 'D16', F1: 120, E: Math.max(0, Math.floor((Wh - 50 - 120 - 250) / 150)), F: 150, F2: 0 };
}
export function defaultCutRebar(e) {
    const H = n0(e && e.cut && e.cut.H) || 600;
    return { NA1: 'D16', ctc: 300, dc1: 50, dc2: 80, dc3: 50, dc4: 200, L1: 500, hOn: true, NA2: 'D16', F1: 120, E: Math.max(0, Math.floor((H - 80 - 120 - 100) / 150)), F: 150, F2: 0, dcOn: !!(e && e.apron && e.apron.use), DC: 'D16', dc5: 100, dcCtc: 200, CL: 1500 };
}
export function defaultAntiRebar() {
    return { dmDia: 'D19', dmCtc: DM_CTC[0], bo2Dia: 'D16', bo2H: 150, bo2V: 220, bo3Dia: 'D16', bo3Ctc: 150, bo3Type: '캡형', bo3N: 2 };
}

/** 설치 여부: { rail:[bool,bool], cut:[bool,bool], apron:[bool,bool], anti:bool } */
export function etcExists(c) {
    const par = getParapet(c);
    const ok = parapetApplicable(c);
    const e = par.ends || [];
    const rail = [0, 1].map(i => ok && !!(e[i] && e[i].rail && e[i].rail.use));
    const cut = [0, 1].map(i => ok && !!(e[i] && e[i].cut && e[i].cut.use));
    const apron = [0, 1].map(i => ok && !!(e[i] && e[i].apron && e[i].apron.use));
    let anti = false;
    try { for (const b of blocks(c)) if (sectionGeom(c, b.index).antiFloat) anti = true; } catch { /* 무시 */ }
    return { rail, cut, apron, anti, any: rail.some(Boolean) || cut.some(Boolean) || anti };
}

export function getEtcRebar(c) {
    const par = getParapet(c);
    const s = (c.rebar && c.rebar.etc) || {};
    const ends = par.ends || [];
    return {
        rail: [0, 1].map(i => ({ ...defaultRailRebar(ends[i]), ...((s.rail || [])[i] || {}) })),
        cut: [0, 1].map(i => ({ ...defaultCutRebar(ends[i]), ...((s.cut || [])[i] || {}) })),
        anti: { ...defaultAntiRebar(), ...(s.anti || {}) },
    };
}

/** 난간벽 철근 형상 (측면 좌표). 반환: { vert:[pts..], horz:[[x,y]..] } */
export function railShape(c, end) {
    const g = sectionGeom(c, end === 0 ? 0 : Math.max(0, blocks(c).length - 1));
    const e = getParapet(c).ends[end];
    const r = getEtcRebar(c).rail[end];
    const Wh = n0(e.rail.Wh), t1 = n0(e.rail.Wt1), t2 = n0(e.rail.Wt2) || t1;
    const yt = g.Htot + Wh - n0(r.dc1), yb = g.Htot - g.UT + n0(r.dc2);
    const xf = n0(r.dc3);
    const xbAt = (y) => t2 + (t1 - t2) * Math.max(0, Math.min(1, (y - g.Htot) / Math.max(1, Wh))) - n0(r.dc3);
    const vert = r.type === RAIL_TYPES[0]
        ? [[[xf + n0(r.L1), yb], [xf, yb], [xf, yt], [xbAt(yt), yt], [xbAt(g.Htot), g.Htot - Math.min(g.UT - 2 * n0(r.dc2), devLength(null, r.NA1, {}))]]]
        : [[[xf + n0(r.L1), yb], [xf, yb], [xf, yt]], [[xbAt(yt), yt], [xbAt(g.Htot), g.Htot - Math.min(g.UT - 2 * n0(r.dc2), devLength(null, r.NA1, {}))]]];
    const horz = [];
    if (r.hOn) {
        const d1 = barD(r.NA1) / 2 + barD(r.NA2) / 2;
        let y = yt - n0(r.F1);
        const ys = [y];
        for (let k = 0; k < (r.E | 0); k++) { y -= n0(r.F); ys.push(y); }
        for (const yy of ys) if (yy > g.Htot - g.UT) { horz.push([xf + d1, yy]); horz.push([xbAt(Math.max(yy, g.Htot)) - d1, yy]); }
    }
    return { g, e, r, vert, horz, yt, yb, Wh, t1, t2 };
}

/** 차수벽 철근 형상 (측면 좌표) */
export function cutShape(c, end) {
    const g = sectionGeom(c, end === 0 ? 0 : Math.max(0, blocks(c).length - 1));
    const e = getParapet(c).ends[end];
    const r = getEtcRebar(c).cut[end];
    const H = n0(e.cut.H), c1 = n0(e.cut.CT1);
    const yTop = g.LT - n0(r.dc1), yBot = -H + n0(r.dc2);
    const xf = n0(r.dc3), xb = c1 - n0(r.dc4) > xf + 50 ? c1 - n0(r.dc4) : c1 - 50;
    const vert = [
        [[xf + n0(r.L1), yTop], [xf, yTop], [xf, yBot], [xb, yBot], [xb, Math.min(yTop, yBot + H + devLength(null, r.NA1, {}))]],
    ];
    const horz = [];
    if (r.hOn) {
        const d1 = barD(r.NA1) / 2 + barD(r.NA2) / 2;
        let y = yBot + n0(r.F1);
        const ys = [y];
        for (let k = 0; k < (r.E | 0); k++) { y += n0(r.F); ys.push(y); }
        for (const yy of ys) if (yy < g.LT) { horz.push([xf + d1, yy]); horz.push([xb - d1, yy]); }
    }
    let dc = null;
    if (r.dcOn && e.apron && e.apron.use) {
        const y = g.LT - n0(r.dc5);
        dc = [[n0(r.CL) / 2, y], [-n0(r.CL) / 2, y]];
    }
    return { g, e, r, vert, horz, dc, H, c1 };
}

/** 부상방지저판 철근 (좌측 날개 기준 단면 좌표, x = 0 좌측벽 외면) */
export function antiShape(c, bi = 0) {
    const g = sectionGeom(c, bi);
    if (!g.antiFloat) return null;
    const r = getEtcRebar(c).anti;
    const st = getSettings(c, bi);
    const cv = 80;
    const { brW, t } = g.antiFloat;
    const ld = devLength(null, r.dmDia, {});
    const dm = [[ld, t - cv], [-brW + cv, t - cv], [-brW + cv, cv], [ld, cv]];
    const bo2 = [];
    const nv = Math.max(1, Math.floor((t - 2 * cv) / Math.max(50, n0(r.bo2V))) + 1);
    const nh = Math.max(1, Math.floor((brW - cv) / Math.max(50, n0(r.bo2H))) + 1);
    const d1 = barD(r.dmDia) / 2 + barD(r.bo2Dia) / 2;
    for (let i = 0; i < nh; i++) for (let j = 0; j < nv; j++) {
        const x = -brW + cv + d1 + i * n0(r.bo2H);
        const y = cv + d1 + j * Math.min(n0(r.bo2V), (t - 2 * cv - 2 * d1) / Math.max(1, nv - 1));
        if (x < -d1 && y <= t - cv - d1 + 1) bo2.push([x, y]);
    }
    const bo3 = [];
    for (let x = -brW + cv + n0(r.bo3Ctc) / 2; x < -cv; x += Math.max(50, n0(r.bo3Ctc))) bo3.push([[x, cv - barD(r.dmDia)], [x, t - cv + barD(r.dmDia)]]);
    return { g, r, st, dm, bo2, bo3, brW, t, nv, nh, cv };
}

/** 철근 제원용 목록. bi = 블록. 반환: [{ desc, prefix, dia, shape, dims, count, main, long }] */
export function etcBars(p, c, bi) {
    const ex = etcExists(c);
    const nb = blocks(c).length;
    const out = [];
    const W = (g) => g.W - 160;
    const ends = [];
    if (bi === 0) ends.push(0);
    if (bi === nb - 1) ends.push(1);
    for (const end of ends) {
        const tt = end === 0 ? '시점' : '종점';
        if (ex.rail[end]) {
            const rs = railShape(c, end);
            const n = Math.max(1, Math.floor(W(rs.g) / Math.max(50, n0(rs.r.ctc))) + 1);
            rs.vert.forEach((pts, k) => {
                const sh = shapeFromPts(pts, barInfo(rs.r.NA1).bendR);
                out.push({ desc: `${tt} 난간벽 수직철근${rs.vert.length > 1 ? k + 1 : ''}`, prefix: 'NA', dia: rs.r.NA1, ...sh, count: n, main: true });
            });
            if (rs.horz.length) out.push({ desc: `${tt} 난간벽 수평철근`, prefix: 'NA', dia: rs.r.NA2, shape: 1, dims: { A: Math.round(W(rs.g)) }, count: rs.horz.length, main: false, long: true });
        }
        if (ex.cut[end]) {
            const cs = cutShape(c, end);
            const n = Math.max(1, Math.floor(W(cs.g) / Math.max(50, n0(cs.r.ctc))) + 1);
            for (const pts of cs.vert) {
                const sh = shapeFromPts(pts, barInfo(cs.r.NA1).bendR);
                out.push({ desc: `${tt} 차수벽 수직철근`, prefix: 'CW', dia: cs.r.NA1, ...sh, count: n, main: true });
            }
            if (cs.horz.length) out.push({ desc: `${tt} 차수벽 수평철근`, prefix: 'CW', dia: cs.r.NA2, shape: 1, dims: { A: Math.round(W(cs.g)) }, count: cs.horz.length, main: false, long: true });
            if (cs.dc) out.push({ desc: `${tt} 접속저판 연결철근`, prefix: 'DC', dia: cs.r.DC, shape: 1, dims: { A: Math.round(n0(cs.r.CL)) }, count: Math.max(1, Math.floor(W(cs.g) / Math.max(50, n0(cs.r.dcCtc))) + 1), main: false });
        }
    }
    const as = antiShape(c, bi);
    if (as) {
        const fr = blockFrame(c, bi);
        const L = fr.L0 - 2 * planCover(as.st);
        const ctc = (+as.st.ctc || 250) / (as.r.dmCtc === DM_CTC[1] ? 2 : 1);
        const n = 2 * (Math.floor(L / ctc) + 1);
        const sh = shapeFromPts(as.dm, barInfo(as.r.dmDia).bendR);
        out.push({ desc: '부상방지저판 주철근(DM)', prefix: 'DM', dia: as.r.dmDia, ...sh, count: n, main: true });
        out.push({ desc: '부상방지저판 수평철근(BO2)', prefix: 'BO', dia: as.r.bo2Dia, shape: 1, dims: { A: Math.round(L) }, count: 2 * as.bo2.length, main: false, long: true });
        if (as.r.bo3Dia) {
            const sd = shearDims(p, as.r.bo3Type, { t: as.t, cA: as.cv, cB: as.cv, dm: barD(as.r.dmDia), ds: barD(as.r.bo3Dia), nMain: +as.r.bo3N || 2, sp: ctc, dia: as.r.bo3Dia });
            const cnt = 2 * as.bo3.length * Math.max(1, Math.ceil(L / ((+as.r.bo3N || 2) * ctc)));
            out.push({ desc: '부상방지저판 전단철근(BO3)', prefix: 'BO', dia: as.r.bo3Dia, shape: sd.shape, dims: sd.dims, count: cnt, main: false });
        }
    }
    return out;
}
