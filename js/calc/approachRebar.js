// approachRebar.js - 접속슬래브 배근 데이터 · 철근 · 설계검토 (배근 입력 > 접속슬래브 배근, 매뉴얼 5.12)
//
// 데이터: culverts[i].rebar.approach = { list: [ {                         (c.approach.list 와 같은 순서)
//   main: { top:{ ctc, dia }, bottom:{ ctc, dia } },     주철근 (구조물 직각방향 = 접속슬래브 경간방향)
//   horz: { top:{ ctc, dia }, bottom:{ ctc, dia } },     수평(배력)철근 (구조물 길이방향)
//   cover:{ top, bottom, side },                         피복
//   shear:{ ctc, dia, n (묶는 구간), type } } ] }
// 설계: 브래킷과 끝단 지반에 단순지지된 보 (경간 = 접속슬래브 길이 L1+L2+L3), 고정하중 + DB 활하중(후륜 1개),
//       활하중 분포폭 E = 1.2 + 0.06·L ≤ 2.1 m (주철근이 차량진행방향과 평행), 충격계수 i = 15/(40+L) ≤ 0.3,
//       계수하중 1.3·D + 2.15·(L+I)  (도로교설계기준 강도설계법).

import { getApproach, approachSection, approachPlan } from './approachGeom.js';
import { sectionGeom } from './sectionGeom.js';
import { getDesign, DB_WHEEL } from './design.js';
import { barArea, barD, materials } from './rebar.js';
import { flexure, shear as rcShear, crack } from './rcDesign.js';
import { shearDims } from './shearBars.js';

export const CTC_OPTS = [100, 125, 150, 200, 250, 300];
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

/** 접속슬래브가 입력되어 있는가 */
export function hasApproach(c) {
    return !!(c && c.approach && Array.isArray(c.approach.list) && c.approach.list.length);
}

export function defaultApproachRebar(a) {
    const thick = Math.max(n0(a && a.H1), n0(a && a.H2));
    const big = thick >= 400;
    return {
        main: { top: { ctc: 250, dia: big ? 'D22' : 'D19' }, bottom: { ctc: 125, dia: big ? 'D22' : 'D19' } },
        horz: { top: { ctc: 300, dia: 'D19' }, bottom: { ctc: 150, dia: 'D19' } },
        cover: { top: 80, bottom: 80, side: 100 },
        shear: { ctc: 300, dia: 'D19', n: 4, type: '꺽인ㄷ형' },
    };
}

export function getApproachRebar(c, i) {
    const list = getApproach(c).list;
    const a = list[i];
    if (!a) return null;
    const s = c.rebar && c.rebar.approach && c.rebar.approach.list && c.rebar.approach.list[i];
    const d = defaultApproachRebar(a);
    if (!s) return d;
    return {
        main: { top: { ...d.main.top, ...((s.main || {}).top || {}) }, bottom: { ...d.main.bottom, ...((s.main || {}).bottom || {}) } },
        horz: { top: { ...d.horz.top, ...((s.horz || {}).top || {}) }, bottom: { ...d.horz.bottom, ...((s.horz || {}).bottom || {}) } },
        cover: { ...d.cover, ...(s.cover || {}) },
        shear: { ...d.shear, ...(s.shear || {}) },
    };
}

/** 접속슬래브 치수: { Ltot, Wa (길이방향 폭), t (평균 두께), H1, H2, skew (사각 sin) } */
export function approachDims(p, c, i) {
    const a = getApproach(c).list[i];
    const g = sectionGeom(c, 0);
    const sec = approachSection(c, a, g);
    let Wa = 0;
    try { const pl = approachPlan(p, c, a); Wa = Math.abs(pl.staE - pl.staS) * 1000; } catch { Wa = 10000; }
    const ang = n0(a.s && a.s.ang) || 90;
    return { a, sec, Ltot: sec.Ltot, Wa, H1: n0(a.H1), H2: n0(a.H2), t: (n0(a.H1) + n0(a.H2)) / 2, sin: Math.abs(Math.sin(ang * Math.PI / 180)) || 1 };
}

/** 철근 목록 [{ desc, prefix, dia, shape, dims, count, main, long }] */
export function approachBars(p, c, i) {
    const r = getApproachRebar(c, i);
    if (!r) return [];
    const D = approachDims(p, c, i);
    const cv = r.cover;
    const name = `접속슬래브${i + 1}(${D.a.side})`;
    const out = [];
    const nAcross = (W, ctc) => Math.max(1, Math.floor((W - 2 * cv.side) / Math.max(50, n0(ctc))) + 1);
    const Lmain = D.Ltot - 2 * cv.side;
    for (const [k, t] of [['top', '상면'], ['bottom', '하면']]) {
        const m = r.main[k];
        if (m.dia) out.push({ desc: `${name} ${t} 주철근`, prefix: 'AS', dia: m.dia, shape: 1, dims: { A: Math.round(Lmain / D.sin) }, count: nAcross(D.Wa, m.ctc), main: true, long: true });
    }
    for (const [k, t] of [['top', '상면'], ['bottom', '하면']]) {
        const m = r.horz[k];
        if (m.dia) out.push({ desc: `${name} ${t} 수평철근`, prefix: 'AH', dia: m.dia, shape: 1, dims: { A: Math.round(D.Wa - 2 * cv.side) }, count: Math.max(1, Math.floor(Lmain / Math.max(50, n0(m.ctc))) + 1), main: false, long: true });
    }
    const sh = r.shear;
    if (sh.dia) {
        const sp = n0(r.main.bottom.ctc) || 125;
        const sd = shearDims(p, sh.type, { t: D.t, cA: cv.top, cB: cv.bottom, dm: barD(r.main.bottom.dia), ds: barD(sh.dia), nMain: +sh.n || 4, sp, dia: sh.dia });
        const nx = Math.max(1, Math.floor(Lmain / Math.max(50, n0(sh.ctc))) + 1);
        const ny = Math.max(1, Math.ceil((D.Wa - 2 * cv.side) / ((+sh.n || 4) * sp)));
        out.push({ desc: `${name} 전단철근`, prefix: 'AV', dia: sh.dia, shape: sd.shape, dims: sd.dims, count: nx * ny, main: false });
    }
    return out;
}

/**
 * 설계검토 (단면, 균열, 받침부).
 * 반환: { L, t, d, wD, P, E, i, MD, ML, Mu, Ms, Vu, flex, shear, crack, bearing }
 */
export function approachCheck(p, c, i) {
    const r = getApproachRebar(c, i);
    if (!r) return null;
    const Dm = approachDims(p, c, i);
    const des = getDesign(p);
    const { fck, fy, code } = materials(p);
    const fckA = +(des.env && des.env.fckApproach) || fck, fyA = +(des.env && des.env.fyApproach) || fy;
    const L = Dm.Ltot / 1000;
    const t = Math.max(Dm.H1, Dm.H2);
    const gRC = +(des.env && des.env.gRC) || 24.5, gAs = +(des.env && des.env.gAsphalt) || 22.5;
    const wD = gRC * t / 1000 + gAs * 0.08;                         // kN/m² (포장 80 mm)
    const grade = (des.live && des.live.grade) || 'DB24';
    const P = (DB_WHEEL[grade] || 96);                               // 후륜 하중 (kN)
    const E = Math.min(2.1, 1.2 + 0.06 * L);                          // 분포폭 (m)
    const imp = Math.min(0.3, 15 / (40 + L));
    const MD = wD * L * L / 8, ML = P * (1 + imp) * L / 4 / E;
    const VD = wD * L / 2, VL = P * (1 + imp) / E;
    const Mu = 1.3 * MD + 2.15 * ML, Ms = MD + ML;
    const cvB = n0(r.cover.bottom) || 80;
    const d = t - cvB;
    const As = barArea(r.main.bottom.dia) * 1000 / (n0(r.main.bottom.ctc) || 125);
    const sec = { b: 1000, h: t, d, As, fck: fckA, fy: fyA, code };
    const fl = flexure(sec);
    const Vu = 1.3 * VD + 2.15 * VL;
    const Av = barArea(r.shear.dia) * 1000 / (((+r.shear.n || 4) * (n0(r.main.bottom.ctc) || 125)));
    const sv = rcShear(sec, Vu * 1e3, 0, r.shear.dia ? { Av, s: n0(r.shear.ctc) || 300, fyt: fyA } : {});
    let cr = null;
    const env = ((des.env && des.env.corrosion) || '건조환경').replace('환경', '');
    try { cr = crack({ ...sec, cover: cvB - barD(r.main.bottom.dia) / 2, dc: cvB, spacing: n0(r.main.bottom.ctc) || 125, env }, Ms * 1e6); } catch { cr = null; }
    // 받침부 (브래킷 지압): R / (bW × 1m) ≤ φ 0.85 fck
    const sx = Dm.sec;
    const bW = Math.max(100, (sx && sx.bracket ? Math.abs(sx.bracket[1][0] - sx.bracket[0][0]) : 300) - n0(Dm.a.St));
    const Ru = Vu;
    const fb = Ru * 1e3 / (bW * 1000);
    const fbAllow = 0.65 * 0.85 * fckA;
    return {
        L, t, d, wD, P, E, imp, MD, ML, VD, VL, Mu, Ms, Vu, As,
        flex: { phiMn: fl.phiMn / 1e6, ok: fl.phiMn / 1e6 >= Mu, rho: fl.rho, rhoMin: fl.rhoMin, rhoMax: fl.rhoMax, okRho: fl.rho >= fl.rhoMin && fl.rho <= fl.rhoMax },
        shear: { phiVc: sv.phiVc / 1e3, phiVn: sv.phiVn / 1e3, ok: sv.phiVn / 1e3 >= Vu },
        crack: cr,
        bearing: { R: Ru, bW, fb, fbAllow, ok: fb <= fbAllow },
    };
}
