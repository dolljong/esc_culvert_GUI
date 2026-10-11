// shearBars.js - 전단철근 데이터 · 배치 · 설계검토 (배근 입력 > 전단 철근, 매뉴얼 5.9)
//
// 데이터:
//   culverts[i].rebar.shear[bi] = { std: 300, sameSpacing: false, faces: { [member]: { segs:[{ n, s }] } } }
//     member = 'top' | 'mid' | 'bottom' | 'left' | 'right'. 위치 s 는 주철근 이음 기준과 같다
//     (슬래브: 좌측벽 내면부터, 벽: 상부슬래브 하면부터 아래로). 첫 구간 U1 이 기준위치에서 첫 철근까지.
//   culverts[i].rebar.shearSet[bi] = { rows:{ top|bottom|outer|inner: { dia, type, nMain } }, haunch:{ top, bottom } }
//     type: SHEAR_TYPES, nMain: 전단철근 1개가 감싸는 주철근 간격 수 (길이방향)
//
// 형상 (calc/barShapes.js): 캡형 7, 겹침형 8, ㄷ형/간격재 9, 꺽인ㄷ형 10.

import { sectionGeom } from './sectionGeom.js';
import {
    getSettings, faceLine, pointAt, mainMembers, memberThickness, coverOf, barD, barArea, devLength, lapLength, materials,
    getMainFace, spansOf,
} from './rebar.js';
import { defaultHorzFace } from './rebarHorz.js';
import { planSpacing, blockFrame, planCover } from './rebarPlan.js';
import { shear as rcShear } from './rcDesign.js';

export const SHEAR_TYPES = ['캡형', '겹침형', 'ㄷ형', '꺽인ㄷ형', '캡형(정착장)', '간격재'];
export const SHEAR_ROWS = [['top', '상부슬래브'], ['bottom', '하부슬래브'], ['outer', '외측벽체'], ['inner', '내측벽체']];
export const N_MAIN = [1, 2, 3, 4, 5, 6, 7, 8];

/** 형상 번호 / 다리 수 */
export const SHEAR_SHAPE = { 캡형: [7, 2], '캡형(정착장)': [7, 2], 겹침형: [8, 2], ㄷ형: [9, 1], 간격재: [9, 0], 꺽인ㄷ형: [10, 1] };

export function defaultShearSet() {
    const r = () => ({ dia: 'D16', type: '캡형', nMain: 4 });
    return { rows: { top: r(), bottom: r(), outer: r(), inner: r() }, haunch: { top: false, bottom: false } };
}

export function getShearSet(c, bi = 0) {
    const d = defaultShearSet();
    const s = c && c.rebar && c.rebar.shearSet && c.rebar.shearSet[bi];
    if (!s) return d;
    const rows = {};
    for (const [k] of SHEAR_ROWS) rows[k] = { ...d.rows[k], ...((s.rows || {})[k] || {}) };
    return { rows, haunch: { ...d.haunch, ...(s.haunch || {}) } };
}

/** 전단철근 입력 부재 (탭) */
export function shearMembers(g) {
    return mainMembers(g).filter(m => !/^mid(U)?:/.test(m.key)).map(m => ({
        key: m.key, title: m.title, kind: m.kind,
        faces: m.kind === 'slab' ? ['U', 'L'] : ['O', 'I'],
        seg: m.key === 'left' || m.key === 'right' ? (m.key === 'left' ? 'L' : 'R') : m.key === 'bottom' ? 'B' : 'U',
    }));
}

/** 부재 → 설정 행 */
export function rowKeyOf(member) {
    if (member === 'top' || member === 'mid') return 'top';
    if (member === 'bottom') return 'bottom';
    if (member === 'left' || member === 'right') return 'outer';
    return 'inner';
}

/** 인장측(지점부) 면 */
const outerFace = (member) => (member === 'top' ? 'U' : member === 'bottom' ? 'L' : member === 'mid' ? 'U' : 'O');

/** 기본 배치: 지점부(경간 20%) = 표준간격/2, 중앙부 = 표준간격 (sameSpacing 이면 모두 표준간격) */
export function defaultShearFace(g, member, std = 300, same = false) {
    const f = defaultHorzFace(g, member, outerFace(member), std, same);
    return { segs: [{ n: 1, s: f.D }, ...f.segs] };
}

export function getShear(c, bi = 0) {
    return (c && c.rebar && c.rebar.shear && c.rebar.shear[bi]) || null;
}

export function getShearFace(c, bi, member, g) {
    g = g || sectionGeom(c, bi);
    const sh = getShear(c, bi) || {};
    const f = sh.faces && sh.faces[member];
    if (f && Array.isArray(f.segs)) return f;
    return defaultShearFace(g, member, sh.std || 300, !!sh.sameSpacing);
}

/** 위치 목록 (s) */
export function shearPositions(f) {
    const out = [];
    let s = 0;
    for (const sg of (f && f.segs) || []) for (let k = 0; k < (sg.n | 0); k++) { s += +sg.s || 0; out.push(s); }
    return out;
}

/**
 * 전단철근 형상 치수.
 * 반환: { shape, dims, legs }
 */
export function shearDims(p, type, o) {
    const { t, cA, cB, dm, ds, nMain, sp } = o;
    const hb = t - cA - cB;
    const Bout = Math.round(hb + dm + ds);
    const Aw = Math.round(nMain * sp + dm + ds);
    const [shape, legs] = SHEAR_SHAPE[type] || SHEAR_SHAPE['캡형'];
    let dims;
    switch (type) {
        case '캡형(정착장)': dims = { A: Aw, B: Bout, C: devLength(p, o.dia, {}) }; break;
        case '겹침형': dims = { A: Aw, B: Bout, C: lapLength(p, o.dia, { cls: 'B' }) }; break;
        case 'ㄷ형': dims = { A: Bout, B: Aw, C: Aw }; break;
        case '간격재': dims = { A: Math.round(hb - dm - ds), B: 100, C: 100 }; break;
        case '꺽인ㄷ형': dims = { A: Aw, B: Bout, C: Math.round(Aw / 2) }; break;
        default: dims = { A: Aw, B: Bout, C: 100 };
    }
    return { shape, dims, legs };
}

/**
 * 전단철근 배치 (단면 좌표).
 * 반환: { g, st, set, sp (주철근 평면간격), members:[{ member, title, cfg, f, pos:[s], ties:[{ s, p0, p1 }], shape, dims, legs,
 *          perPos (위치당 길이방향 개수), lineA, lineB, t }] }
 */
export function shearLayout(p, c, bi = 0) {
    const g = sectionGeom(c, bi);
    const st = getSettings(c, bi);
    const set = getShearSet(c, bi);
    const sp = planSpacing(st);
    const fr = blockFrame(c, bi);
    const Leff = Math.max(0, fr.L0 - 2 * planCover(st));
    const out = [];
    for (const m of shearMembers(g)) {
        const cfg = set.rows[rowKeyOf(m.key)];
        const [fa, fb] = m.faces;
        const lineA = faceLine(g, st, m.key, fa, 1), lineB = faceLine(g, st, m.key, fb, 1);
        const f = getShearFace(c, bi, m.key, g);
        const pos = shearPositions(f);
        const t = memberThickness(g, m.key);
        const dm = barD(getMainFace(c, bi, 1, 'straight', 1, m.key, fa, g).R[0]);
        const ds = barD(cfg.dia);
        const cA = coverOf(st, m.key, fa, 1), cB = coverOf(st, m.key, fb, 1);
        const sd = shearDims(p, cfg.type, { t, cA, cB, dm, ds, nMain: +cfg.nMain || 4, sp, dia: cfg.dia });
        const ties = [];
        for (const s of pos) {
            if (s < Math.max(lineA.s0, lineB.s0) - 1 || s > Math.min(lineA.s1, lineB.s1) + 1) continue;
            ties.push({ s, p0: pointAt(lineA.path, s - lineA.s0).pt, p1: pointAt(lineB.path, s - lineB.s0).pt });
        }
        const pitch = (+cfg.nMain || 4) * sp;
        const perPos = Math.max(1, Math.ceil(Leff / pitch));
        out.push({ member: m.key, title: m.title, kind: m.kind, cfg, f, pos, ties, ...sd, perPos, pitch, lineA, lineB, t, dm, ds });
    }
    return { g, st, set, sp, members: out };
}

/** 위치 s 의 전단철근 간격 (이웃 철근 사이), 철근이 없으면 null */
export function spacingAt(pos, s) {
    if (pos.length < 2) return null;
    const ss = pos.slice().sort((a, b) => a - b);
    if (s < ss[0] - 1e-6 || s > ss[ss.length - 1] + 1e-6) return null;
    for (let i = 1; i < ss.length; i++) if (s >= ss[i - 1] - 1e-6 && s <= ss[i] + 1e-6) return ss[i] - ss[i - 1];
    return null;
}

/** 해석 부재군 좌표 x(m) → 철근 s(mm) */
export function groupXToS(g, member, x) {
    if (member === 'top' || member === 'bottom' || member === 'mid') {
        const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
        const xRef = g.kind === 'U' ? g.inner.x0 : cells[0].x0;
        const xs0 = (g.walls[0].x0 + g.walls[0].x1) / 2;
        return x * 1000 + xs0 - xRef;
    }
    const yTopIn = g.kind === 'U' ? g.Htot : g.LT + g.H;
    return yTopIn - (g.LT / 2 + x * 1000);
}

/**
 * 전단 설계검토.
 * df: designForces(p, c, 0) 결과 (없으면 Vu 없이 강도만)
 * 반환: [{ title, label, member, s, t, d, Vu, phiVc, phiVs, phiVn, sf, ok, need, spacing, Av, AvMin, okMin, smax, okS }]
 */
export function shearCheck(p, c, bi, df) {
    const lay = shearLayout(p, c, bi);
    const { fck, fy, code } = materials(p);
    const rows = [];
    for (const M of lay.members) {
        const gid = M.member === 'mid' ? 'middle' : M.member;
        const grp = df && df.groups ? df.groups.find(x => x.id === gid) : null;
        const cols = grp ? grp.cols.map(col => ({ label: col.label + (grp.isSlab && col.span != null ? ` (${col.span + 1}경간)` : ''), x: col.sV ?? col.s, V: col.V }))
            : spansOf(lay.g, M.member).flatMap((sp, i) => [{ label: `제${i + 1}경간 지점부`, s: sp.s0 }, { label: `제${i + 1}경간 중앙부`, s: (sp.s0 + sp.s1) / 2 }]);
        for (const col of cols) {
            const s = col.s != null ? col.s : groupXToS(lay.g, M.member, col.x);
            const t = M.t;
            const cv = Math.max(coverOf(lay.st, M.member, M.member === 'left' || M.member === 'right' ? 'O' : 'U', 1), coverOf(lay.st, M.member, M.member === 'left' || M.member === 'right' ? 'I' : 'L', 1));
            const d = t - cv;
            const spacing = spacingAt(M.pos, s);
            const Av = M.legs > 0 && spacing ? M.legs * barArea(M.cfg.dia) * 1000 / M.pitch : 0;
            const Vu = col.V != null ? Math.abs(col.V) : null;
            const r = rcShear({ b: 1000, h: t, d, fck, fy, code }, (Vu || 0) * 1e3, 0, Av && spacing ? { Av, s: spacing, fyt: fy } : {});
            const AvMin = spacing ? Math.max(0.0625 * Math.sqrt(fck), 0.35) * 1000 * spacing / fy : null;
            const big = r.Vs > Math.sqrt(fck) * 1000 * d / 3;
            const smax = big ? Math.min(d / 4, 300) : Math.min(d / 2, 600);
            const need = Vu != null ? Vu * 1e3 > r.phiVc / 2 : null;
            rows.push({
                title: M.title, label: col.label, member: M.member, s, t, d, Vu,
                phiVc: r.phiVc / 1e3, phiVs: r.phi * r.Vs / 1e3, phiVn: r.phiVn / 1e3,
                sf: Vu ? r.phiVn / 1e3 / Vu : null, ok: Vu == null ? null : r.phiVn / 1e3 >= Vu,
                need, spacing, Av, AvMin, okMin: spacing ? Av >= AvMin : (need === false ? true : null),
                smax, okS: spacing ? (need === false ? true : spacing <= smax) : null,
            });
        }
    }
    return rows;
}
