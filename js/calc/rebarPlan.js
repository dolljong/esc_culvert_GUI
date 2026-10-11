// rebarPlan.js - 평면상 주철근 배치 (배근 입력 > 철근 배치, 매뉴얼 5.8)
//
// 데이터: culverts[i].rebar.plan[bi] = {
//   view: 'top'|'bottom'|'mid'          보기옵션 (그릴 슬래브)
//   ref:  '암거중심'|'선형중심'|'R이 큰쪽중심'   기준위치 (배치 거리를 재는 평면 기준선)
//   zones: { start:{ segs:[{n,s}] }, straight:{ segs }, end:{ segs } }
// }
// 배치 규칙: 기준선 위에서 블록 시점 이음선부터 피복(배근설정 철근피복 '평면도 측면')만큼 떨어진 곳에 첫 철근,
// 이후 시점경사 → 직구간 → 종점경사 순서로 각 구간의 '개수@간격' 만큼 이어서 놓는다.
// 각 위치의 철근은 배치옵션 Cycle 을 1, 2, (3, 4) 순서로 돌아가며 맡는다 (간격 = 1000 / Σ 단위폭당 개수).
// 시점경사 구간 철근은 시점 이음선과 평행, 종점경사 구간은 종점 이음선과 평행, 직구간은 선형에 직각.
//
// 평면 국부좌표 (mm): u = 선형 진행방향 (블록 시점 이음선이 선형중심과 만나는 점 = 0, 이음 유간 제외),
//                     v = 선형중심에서 우측 +. 시점 이음선 u = -cot(a0)·v, 종점 이음선 u = L0 - cot(a1)·v.

import { blocks } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import { getSettings, cyclesOf, barsPerMeter, zonesOf } from './rebar.js';

export const VIEW_OPTS = [{ value: 'top', label: '상부슬래브' }, { value: 'bottom', label: '하부슬래브' }, { value: 'mid', label: '중간슬래브' }];
export const REF_OPTS = ['암거중심', '선형중심', 'R이 큰쪽중심'];
export const ZONE_ORDER = ['start', 'straight', 'end'];
export const ZONE_TITLE = { start: '시점경사', straight: '직구간', end: '종점경사' };

const n0 = (v) => (isFinite(+v) ? +v : 0);
const cotOf = (deg) => { const a = (n0(deg) || 90) * Math.PI / 180; return Math.abs(Math.sin(a)) < 1e-6 ? 0 : Math.cos(a) / Math.sin(a); };
const sinOf = (deg) => Math.abs(Math.sin((n0(deg) || 90) * Math.PI / 180)) || 1;

/** 블록 평면 틀 */
export function blockFrame(c, bi = 0) {
    const bl = blocks(c);
    const b = bl[bi] || bl[0] || { length: 10, index: 0 };
    const j = c.joints || [];
    const gap0 = bi > 0 ? n0((j[bi] || {}).gap) / 2 : 0;
    const gap1 = bi < bl.length - 1 ? n0((j[bi + 1] || {}).gap) / 2 : 0;
    const L0 = b.length * 1000 - gap0 - gap1;
    const a0 = n0((j[bi] || {}).angle) || 90, a1 = n0((j[bi + 1] || {}).angle) || 90;
    const g = sectionGeom(c, bi);
    const off = n0(c.offset);
    const cot0 = cotOf(a0), cot1 = cotOf(a1);
    return {
        bi, g, L0, a0, a1, cot0, cot1, sin0: sinOf(a0), sin1: sinOf(a1), off,
        W: g.W, vL: off - g.W / 2, vR: off + g.W / 2,
        uS: (v) => -cot0 * v,
        uE: (v) => L0 - cot1 * v,
        lenAt: (v) => L0 - cot1 * v + cot0 * v,
        /** 단면 x (좌측벽 외면 0) → v */
        vOfX: (x) => off - g.W / 2 + x,
        corners() { return [[this.uS(this.vL), this.vL], [this.uE(this.vL), this.vL], [this.uE(this.vR), this.vR], [this.uS(this.vR), this.vR]]; },
    };
}

/** 기준선 v */
export function refV(fr, ref) {
    if (ref === '선형중심') return 0;
    if (ref === 'R이 큰쪽중심') {
        const left = fr.lenAt(fr.vL) >= fr.lenAt(fr.vR);
        return fr.off + (left ? -1 : 1) * fr.W / 4;
    }
    return fr.off;
}

/** 평면 배치 간격 (모든 Cycle 철근 사이) */
export function planSpacing(st) {
    const tot = cyclesOf(st).reduce((a, cy) => a + barsPerMeter(st, cy), 0);
    return tot > 0 ? 1000 / tot : (+st.ctc || 250);
}

/** 평면 측면 피복 */
export function planCover(st) {
    const v = st && st.cover && st.cover.plan && st.cover.plan.S && st.cover.plan.S[0];
    return isFinite(+v) && +v > 0 ? +v : 80;
}

function zoneLens(c, bi, st, fr, ref) {
    const zs = zonesOf(c, bi, st);
    const en = Object.fromEntries(zs.map(z => [z.id, z.enabled]));
    const cov = planCover(st);
    const Ltot = Math.max(0, fr.lenAt(refV(fr, ref)) - 2 * cov);
    const f = st.skew === '절반' ? 0.5 : 1;
    let Ls = en.start ? fr.W * Math.abs(fr.cot0) * f : 0;
    let Le = en.end ? fr.W * Math.abs(fr.cot1) * f : 0;
    if (st.skew === '시점 경사방향' && en.start) { Ls = Ltot; Le = 0; }
    if (st.skew === '종점 경사방향' && en.end) { Le = Ltot; Ls = 0; }
    if (Ls + Le > Ltot) { const k = Ltot / (Ls + Le); Ls *= k; Le *= k; }
    return { Ltot, Ls, Le, en };
}

/** 기본 배치 (구간별 개수@간격) */
export function defaultPlanZones(c, bi = 0, ref = '암거중심') {
    const st = getSettings(c, bi);
    const fr = blockFrame(c, bi);
    const sp = Math.round(planSpacing(st) * 10) / 10;
    const { Ltot, Ls, Le } = zoneLens(c, bi, st, fr, ref);
    const ns = Math.round(Ls / sp), ne = Math.round(Le / sp);
    const Lst = Ltot - (ns + ne) * sp;
    const nst = Math.max(0, Math.floor(Lst / sp + 1e-6));
    const r = Math.round(Lst - nst * sp);
    const straight = [];
    if (nst > 0) straight.push({ n: nst, s: sp });
    if (r > 1) straight.push({ n: 1, s: r });
    return {
        start: { segs: ns > 0 ? [{ n: ns, s: sp }] : [{ n: 0, s: sp }] },
        straight: { segs: straight.length ? straight : [{ n: 0, s: sp }] },
        end: { segs: ne > 0 ? [{ n: ne, s: sp }] : [{ n: 0, s: sp }] },
    };
}

export function defaultPlan(c, bi = 0) {
    return { view: 'top', ref: REF_OPTS[0], zones: defaultPlanZones(c, bi, REF_OPTS[0]) };
}

/** 저장값 + 기본값 */
export function getPlan(c, bi = 0) {
    const s = c && c.rebar && c.rebar.plan && c.rebar.plan[bi];
    const ref = (s && s.ref) || REF_OPTS[0];
    const d = { view: 'top', ref, zones: defaultPlanZones(c, bi, ref) };
    if (!s) return d;
    const zones = {};
    for (const z of ZONE_ORDER) zones[z] = s.zones && s.zones[z] && Array.isArray(s.zones[z].segs) ? s.zones[z] : d.zones[z];
    return { view: s.view || 'top', ref, zones };
}

/**
 * 철근 위치 목록.
 * 반환: { fr, st, sp, cov, vref, pos:[{ t, zone, cycle, k }] }   t = 기준선 위 시점 이음선부터 거리
 */
export function planPositions(c, bi = 0, plan) {
    plan = plan || getPlan(c, bi);
    const st = getSettings(c, bi);
    const fr = blockFrame(c, bi);
    const cov = planCover(st);
    const vref = refV(fr, plan.ref);
    const en = Object.fromEntries(zonesOf(c, bi, st).map(z => [z.id, z.enabled]));
    const cycles = cyclesOf(st);
    const pos = [];
    let t = cov;
    let first = true;
    for (const z of ZONE_ORDER) {
        if (!en[z]) continue;
        for (const sg of (plan.zones[z] && plan.zones[z].segs) || []) {
            for (let k = 0; k < (sg.n | 0); k++) {
                if (first) { pos.push({ t, zone: z }); first = false; }
                t += n0(sg.s);
                pos.push({ t, zone: z });
            }
        }
    }
    pos.forEach((q, i) => { q.cycle = cycles[i % cycles.length]; q.k = i; });
    return { fr, st, sp: planSpacing(st), cov, vref, pos, total: t + cov, avail: fr.lenAt(vref) };
}

/** 구간·Cycle 별 철근 개수 { start:{1:n,2:n}, straight:{..}, end:{..} } */
export function planCounts(c, bi = 0, plan) {
    const { pos } = planPositions(c, bi, plan);
    const out = { start: {}, straight: {}, end: {} };
    for (const q of pos) out[q.zone][q.cycle] = (out[q.zone][q.cycle] || 0) + 1;
    return out;
}

/** 구간 철근의 사보강 sin (슬래브 철근 길이 = 단면 길이 / sin) */
export function zoneSin(fr, zone) {
    return zone === 'start' ? fr.sin0 : zone === 'end' ? fr.sin1 : 1;
}

/**
 * 위치 q 의 철근 평면선 (u = A + k·v), 블록 안쪽 피복으로 자른 v 범위.
 * 반환: { A, k, v0, v1, p0:[u,v], p1:[u,v], len } | null
 */
export function planBarLine(fr, vref, q, cov = 80, side = 80) {
    const u0 = fr.uS(vref) + q.t;
    const k = q.zone === 'start' ? -fr.cot0 : q.zone === 'end' ? -fr.cot1 : 0;
    const A = u0 - k * vref;
    let lo = fr.vL + side, hi = fr.vR - side;
    // A + k v ≥ -cot0 v + cov/sin0  →  (k + cot0) v ≥ cov/sin0 - A
    const ge = (a, b) => { if (Math.abs(a) < 1e-12) { if (0 < b - 1e-9) lo = Infinity; return; } if (a > 0) lo = Math.max(lo, b / a); else hi = Math.min(hi, b / a); };
    const le = (a, b) => ge(-a, -b);
    ge(k + fr.cot0, cov / fr.sin0 - A);
    le(k + fr.cot1, fr.L0 - cov / fr.sin1 - A);
    if (!(hi > lo + 1)) return null;
    const p0 = [A + k * lo, lo], p1 = [A + k * hi, hi];
    return { A, k, v0: lo, v1: hi, p0, p1, len: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) };
}

/** 길이방향 철근(수평/배력철근) 한 개의 평면 길이 (v 위치) */
export function longBarLength(fr, v, cov = 80) {
    return Math.max(0, fr.lenAt(v) - cov / fr.sin0 - cov / fr.sin1);
}
