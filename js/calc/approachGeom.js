// approachGeom.js - 접속 슬래브 (상세입력 > 접속 슬래브) — 도면/배근/수량 공용
//
// c.approach = { list: [ {
//   side: '좌측'|'우측',                         암거 진행방향 기준 설치측
//   s: { ref, off, ang }, e: { ref, off, ang },  시점/종점: 기준위치(구간설정 위치번호), 이격거리(mm), 각도(°)
//   L1, L2, L3,                                  종단(구조물 직각방향) 길이 (mm)
//   H1, H2,                                      두께: H1 = 끝단(구조물 반대쪽), H2 = 브래킷쪽
//   S,                                           종단경사 (%) (구조물에서 멀어지는 방향)
//   St,                                          구조물 벽체와 접속슬래브 이격거리 (mm)
//   GH,                                          (매뉴얼 설명 없음 — 값만 보관)
//   bracket: { bD1, bD2, bH1, bH2, bH3, bW },    bD1/bD2: 평면상 시점/종점 기준위치로부터 브래킷 위치
//                                                bH1: 벽체상단~브래킷상단, bH2: 수직부, bH3: 경사부, bW: 돌출길이
//   dowel: { type:'교량타입'|'암거타입', dia, ctc, len },
// } ] }

import { jointStations } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import { getHorizontal, offsetPoint } from './alignment.js';

const n0 = (v) => (isFinite(+v) ? +v : 0);
const K = 1000;

export const AP_SIDES = ['좌측', '우측'];
export const DOWEL_TYPES = ['교량타입', '암거타입'];

export function defaultBracket(kind = '아스콘') {
    return kind === '콘크리트'
        ? { bD1: 0, bD2: 0, bH1: 700, bH2: 300, bH3: 300, bW: 300 }
        : { bD1: 0, bD2: 0, bH1: 880, bH2: 300, bH3: 300, bW: 300 };
}

export function defaultApproachSlab(c, side = '좌측', sRef = 1, eRef = null, kind = '아스콘') {
    const n = jointStations(c).length;
    return {
        side,
        s: { ref: sRef, off: 0, ang: 90 },
        e: { ref: eRef || n, off: 0, ang: 90 },
        L1: 6000, L2: 0, L3: 0,
        H1: kind === '콘크리트' ? 300 : 400, H2: kind === '콘크리트' ? 300 : 400,
        S: -4.0, St: 20, GH: 2500,
        bracket: defaultBracket(kind),
        dowel: { type: '교량타입', dia: 'D25', ctc: 400, len: 1000 },
    };
}

export function defaultApproach(c, kind = '아스콘') {
    return { list: [defaultApproachSlab(c, '좌측', 1, null, kind), defaultApproachSlab(c, '우측', 1, null, kind)] };
}

/** 블록별 좌우 모두 설치 */
export function approachAll(c, kind = '아스콘') {
    const n = jointStations(c).length;
    const list = [];
    for (let b = 1; b < n; b++) {
        for (const side of AP_SIDES) list.push(defaultApproachSlab(c, side, b, b + 1, kind));
    }
    return { list };
}

export function getApproach(c) {
    return c.approach && Array.isArray(c.approach.list) ? c.approach : defaultApproach(c);
}

function refSta(c, r) {
    const st = jointStations(c);
    const i = Math.max(0, Math.min(st.length - 1, (r.ref | 0) - 1));
    return st[i] + n0(r.off) / K;
}

/**
 * 평면 다각형 (도면 좌표 mm) — 구조물 쪽 변 → 바깥 변 순서.
 * 반환: { poly, inner: [[x,y]...], outer: [...], center, staS, staE, vIn, vOut }
 */
export function approachPlan(p, c, a) {
    const h = getHorizontal(p.alignment);
    const g = sectionGeom(c, 0);
    const off = n0(c.offset);
    const left = a.side !== '우측';
    const sgn = left ? -1 : 1;
    const Ltot = n0(a.L1) + n0(a.L2) + n0(a.L3);
    const vIn = off + sgn * (g.W / 2 + n0(a.St));        // 구조물쪽 변 (mm)
    const vOut = vIn + sgn * Ltot;
    const sS = refSta(c, a.s), sE = refSta(c, a.e);
    const cot = (ang) => { const r = (n0(ang) || 90) * Math.PI / 180; return Math.abs(Math.sin(r)) < 1e-6 ? 0 : Math.cos(r) / Math.sin(r); };
    // 끝변: 기준점(구조물 외면 위치)에서 각도 (90 = 선형 직각)
    const vRef = off + sgn * g.W / 2;
    const staOn = (s0, ang, v) => s0 - cot(ang) * (v - vRef) / K;
    const P = (s, v) => { const q = offsetPoint(h, s, v / K); return [q.x * K, q.y * K]; };
    const edge = (v) => {
        const a0 = staOn(sS, a.s.ang, v), a1 = staOn(sE, a.e.ang, v);
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0)));
        const pts = [];
        for (let k = 0; k <= n; k++) pts.push(P(a0 + (a1 - a0) * k / n, v));
        return pts;
    };
    const inner = edge(vIn), outer = edge(vOut);
    const poly = [...inner, ...outer.slice().reverse()];
    const cs = (sS + sE) / 2;
    const center = P(cs, (vIn + vOut) / 2);
    return { poly, inner, outer, center, staS: sS, staE: sE, vIn, vOut, vRef, Ltot, P, staOn };
}

/**
 * 종단(구조물 직각) 단면 — 국부좌표: x = 구조물 외면에서 바깥쪽 +, y = 기초 하면 0 (sectionGeom 과 동일).
 * 반환: { slab: poly, bracket: poly, topNear, topFar, Ltot }
 */
export function approachSection(c, a, g = sectionGeom(c, 0)) {
    const b = a.bracket || defaultBracket();
    const top = g.Htot;
    const yBr = top - n0(b.bH1);                       // 브래킷 상단
    const bW = n0(b.bW), bH2 = n0(b.bH2), bH3 = n0(b.bH3);
    const bracket = [[0, yBr], [bW, yBr], [bW, yBr - bH2], [0, yBr - bH2 - bH3]];
    const St = n0(a.St);
    const L1 = n0(a.L1), L2 = n0(a.L2), L3 = n0(a.L3);
    const Ltot = L1 + L2 + L3;
    const H1 = n0(a.H1), H2 = n0(a.H2);
    const S = n0(a.S) / 100;
    const x0 = St, x1 = St + Ltot;
    const topNear = yBr + H2;
    const topAt = (x) => topNear + S * (x - x0);
    // 두께: 브래킷쪽 H2 → L1 구간에서 H1 로 변화, 이후 H1
    const thick = (x) => (x - x0 <= L1 && L1 > 0 ? H2 + (H1 - H2) * (x - x0) / L1 : H1);
    const xs = [x0, x0 + L1, x1].filter((v, i, arr) => i === 0 || v > arr[i - 1] + 1e-6);
    const topPts = xs.map(x => [x, topAt(x)]);
    const botPts = xs.map(x => [x, topAt(x) - thick(x)]).reverse();
    // 브래킷 위 받침부: 슬래브 하면이 브래킷 상단(yBr)에 놓인다
    const slab = [...topPts, ...botPts];
    return { slab, bracket, topNear, topFar: topAt(x1), yBr, x0, x1, Ltot, thick, topAt };
}
