// earthwork.js - 토공 상세 (터파기 경사·소단, 구간별 토공형태) — 도면/토공수량 공용
//
// c.earthwork = {
//   ref: '기초 하면' | '구조물 하면',          터파기 하면 기준위치 (기초 하면 = 버림콘크리트 하면)
//   slope: { 토사, 풍화암, 연암, 경암 },        경사비 (수직 1 : 수평 m)
//   dig: { first, unit },                       최초굴착 / 단위굴착 깊이 (mm)
//   berm: { H, W, S },                          소단 높이(터파기 하면에서, 반복 간격) / 폭 / 경사(%)
//   left:  [{ type:'터파기'|'가시설', s:{ref, off}, e:{ref, off}, gap }],   좌측구간
//   right: [ ... ]                                                          우측구간
// }
// ref 는 [구간 설정]의 기준위치 번호 (1 = 암거시점 ... n = 암거종점), off 는 mm.

import { jointStations, blocks } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import { boringAt } from './ground.js';
import { elevationAt } from './alignment.js';

const n0 = (v) => (isFinite(+v) ? +v : 0);

export const EW_TYPES = ['터파기', '가시설'];
export const EW_REFS = ['기초 하면', '구조물 하면'];
export const SOILS = ['토사', '풍화암', '연암', '경암'];

export function defaultEwSection(c) {
    const n = jointStations(c).length;
    return { type: '터파기', s: { ref: 1, off: 0 }, e: { ref: Math.max(1, n), off: 0 }, gap: 500 };
}

export function defaultEarthwork(c) {
    return {
        ref: '기초 하면',
        slope: { 토사: 1.0, 풍화암: 0.5, 연암: 0.3, 경암: 0.1 },
        dig: { first: 4000, unit: 2000 },
        berm: { H: 5000, W: 1000, S: 4.0 },
        left: [defaultEwSection(c)],
        right: [defaultEwSection(c)],
    };
}

export function getEarthwork(c) {
    const e = c.earthwork;
    if (!e || !e.slope) return defaultEarthwork(c);
    return e;
}

/** 기준위치 번호 + 이격거리(mm) → Station (m) */
export function refStation(c, ref, off = 0) {
    const st = jointStations(c);
    const i = Math.max(0, Math.min(st.length - 1, (ref | 0) - 1));
    return st[i] + n0(off) / 1000;
}

/** sta 에 적용되는 구간 (side 'left'|'right') */
export function ewSectionAt(c, side, sta) {
    const ew = getEarthwork(c);
    for (const r of ew[side] || []) {
        const a = refStation(c, r.s.ref, r.s.off), b = refStation(c, r.e.ref, r.e.off);
        if (sta >= Math.min(a, b) - 1e-6 && sta <= Math.max(a, b) + 1e-6) return r;
    }
    return null;
}

/** 기준 EL 에서의 지층 (경사비 결정용) */
function soilAt(layers, el) {
    // layers: 위에서 아래 [{name, top}] — el 아래로 가장 가까운 상단을 가진 층
    let cur = null;
    for (const L of layers) if (L.top >= el - 1e-9) cur = L;
    return cur ? cur.name : (layers[0] ? layers[0].name : '토사');
}

/**
 * 블록 bi, Station sta 의 터파기선.
 * 반환: { g, refEl, toEl(y), toY(el), groundEl, yGround, yBottom, layers, left, right }
 *   left/right = { type, gap, pts: [[x,y]...] (하면 → 지표), x0, xTop, berms:[y...] } | null
 * 좌표는 sectionGeom 단면좌표 (mm).
 */
export function excavationAt(p, c, bi, sta) {
    const g = sectionGeom(c, bi);
    const ew = getEarthwork(c);
    let refEl = 0;
    try { refEl = elevationAt(p.alignment.vip, sta); } catch { refEl = 0; }
    const toEl = (y) => refEl + (y - g.refY) / 1000;
    const toY = (el) => g.refY + (el - refEl) * 1000;
    const bor = boringAt(c, sta);
    const layers = bor.layers.filter(L => SOILS.includes(L.name));
    const topEl = toEl(g.Htot);
    const groundEl = bor.groundEl != null ? bor.groundEl : topEl + 1;
    const yG = toY(groundEl);
    const leanT = g.lean ? g.lean.t : 0, leanW = g.lean ? g.lean.w : 0;
    const yB = ew.ref === '구조물 하면' ? 0 : -leanT;
    const out = { g, refEl, toEl, toY, groundEl, yGround: yG, yBottom: yB, layers, gwl: bor.gwl, left: null, right: null };
    for (const side of ['left', 'right']) {
        const r = ewSectionAt(c, side, sta);
        if (!r) continue;
        const s = side === 'left' ? -1 : 1;
        const gap = n0(r.gap);
        const x0 = (s < 0 ? g.baseX0 - leanW : g.baseX1 + leanW) + s * gap;
        if (r.type === '가시설') {
            const emb = Math.max(1000, (yG - yB) * 0.4);
            out[side] = { type: r.type, gap, pts: [[x0, yB - emb], [x0, yG]], x0, xTop: x0, berms: [], embed: emb };
            continue;
        }
        const pts = [[x0, yB]];
        const berms = [];
        let x = x0, y = yB;
        const bH = n0(ew.berm.H), bW = n0(ew.berm.W), bS = n0(ew.berm.S) / 100;
        let nextBerm = bH > 0 ? yB + bH : Infinity;
        let guard = 0;
        while (y < yG - 1e-6 && guard++ < 200) {
            const el = toEl(y) + 1e-6;
            const soil = soilAt(layers, el);
            const m = n0(ew.slope[soil]);
            // 다음 경계: 지층 상단 / 소단 / 지표
            let yn = yG;
            for (const L of layers) { const yl = toY(L.top); if (yl > y + 1e-6 && yl < yn) yn = yl; }
            if (nextBerm > y + 1e-6 && nextBerm < yn) yn = nextBerm;
            x += s * m * (yn - y);
            y = yn;
            pts.push([x, y]);
            if (Math.abs(y - nextBerm) < 1e-6 && y < yG - 1e-6) {
                berms.push(y);
                x += s * bW;
                y = Math.min(yG, y + bW * bS);
                pts.push([x, y]);
                nextBerm = y + bH;
            }
        }
        out[side] = { type: r.type, gap, pts, x0, xTop: x, berms };
    }
    return out;
}

/** 굴착 단계 깊이 (지표에서 아래로, mm): 최초굴착 후 단위굴착 반복 */
export function digStages(ew, depth) {
    const out = [];
    const f = n0(ew.dig.first), u = n0(ew.dig.unit);
    if (depth <= 0) return out;
    let d = Math.min(depth, f > 0 ? f : depth);
    out.push(d);
    while (d < depth - 1e-6 && u > 0 && out.length < 100) { d = Math.min(depth, d + u); out.push(d); }
    if (d < depth - 1e-6) out.push(depth);
    return out;
}

/** 블록 bi 시점/종점 Station */
export function blockEnds(c, bi) {
    const b = blocks(c)[bi] || blocks(c)[0];
    return b ? [b.sta0, b.sta1] : [c.startSta || 0, (c.startSta || 0) + 10];
}
