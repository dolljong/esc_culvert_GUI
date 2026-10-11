// rebarHorz.js - 수평철근(배력철근) 데이터와 배치 위치
//
// 데이터: culverts[i].rebar.horz[bi] = {
//   std: 300 (표준배치간격), sameSpacing: false (인장·압축구간 동일간격),
//   faces: { [member]: { [face]: { D, segs:[{ n, s }], R1, BC:{ n, s }, R2 } } }
// }
//   D = 기준위치(주철근 이음 기준과 같음)에서 첫 철근까지, segs = 구간별 '개수@간격' (철근은 각 간격 끝에 놓임)
//   R1/B@C/R2 = 기준위치 바깥(벽체부/슬래브부) 추가 철근 (설정 11·12 활성 시)
// 설정: culverts[i].rebar.horzSet[bi] = { dia:{ top, bottom, outerWall, innerWall, mid, road }, opts:{ ...12개 } }
// 부재/면 키와 s 좌표는 calc/rebar.js 와 같다.

import { sectionGeom } from './sectionGeom.js';
import { getSettings, faceLine, spansOf, mainMembers, pointAt, barD, getMainFace, barArea } from './rebar.js';

export const HORZ_OPTS = [
    ['onHaunch', '헌치철근위에 수평철근 배치'],
    ['onCornerRound', '단절점부 ROUND철근위치에 수평철근 배치'],
    ['slabRound', '슬래브 ROUND위치 수평철근배치'],
    ['wallRound', '벽체 ROUND위치 수평철근배치'],
    ['cross', '슬래브,벽체 주철근 교차부에 수평철근 배치'],
    ['roadStd', '차도부 수평철근을 표준간격으로만 배치'],
    ['road2', '차도부 2단 수평철근 배치'],
    ['topAbove', '상부슬래브 수평철근 상부 배근'],
    ['innerOut', '내측벽체 수평철근 외측배근'],
    ['multiStd', '2, 3단 철근의 수평철근을 표준간격으로만 배치'],
    ['slabExtra', '슬래브배근시 벽체부 추가입력 활성화'],
    ['wallExtra', '벽체부배근시 슬래브 추가입력 활성화'],
];

export function defaultHorzSet() {
    return {
        dia: { top: 'D16', bottom: 'D16', outerWall: 'D16', innerWall: 'D16', mid: 'D10', road: 'D16' },
        opts: Object.fromEntries(HORZ_OPTS.map(([k]) => [k, false])),
    };
}

export function getHorzSet(c, bi = 0) {
    const d = defaultHorzSet();
    const s = c && c.rebar && c.rebar.horzSet && c.rebar.horzSet[bi];
    if (!s) return d;
    return { dia: { ...d.dia, ...(s.dia || {}) }, opts: { ...d.opts, ...(s.opts || {}) } };
}

/** 수평철근 입력 부재 (상부/하부/중간 슬래브, 좌·우측 벽체) */
export function horzMembers(g) {
    return mainMembers(g).filter(m => !/^mid(U)?:/.test(m.key)).map(m => ({
        ...m,
        faces: m.faces.map(f => ({ ...f, seg: m.kind === 'slab' ? f.key : (f.key === 'O' ? 'O' : 'I'), title: m.kind === 'slab' ? f.title : f.title })),
    }));
}

/** 면의 수평철근 직경 */
export function horzDia(set, member, face) {
    if (member === 'top') return set.dia.top;
    if (member === 'bottom') return set.dia.bottom;
    if (member === 'mid') return set.dia.mid;
    return face === 'O' ? set.dia.outerWall : set.dia.innerWall;
}

/** 면이 주철근 외측면인가 (지점부 인장) */
function isOuterFace(member, face) {
    return (member === 'top' && face === 'U') || (member === 'bottom' && face === 'L') || ((member === 'left' || member === 'right') && face === 'O');
}

/**
 * 수평철근 기본 배치 (구간).
 * 인장구간(외측면: 지점부 경간의 20%, 내측면: 중앙부) = 표준간격/2, 압축구간 = 표준간격 (sameSpacing 이면 모두 표준간격).
 */
export function defaultHorzFace(g, member, face, std = 300, same = false) {
    const edge = 200;
    const spans = spansOf(g, member);
    const half = same ? std : Math.max(50, Math.round(std / 2));
    const outer = isOuterFace(member, face);
    const sEnd = outer ? half : std, sMid = outer ? std : half;
    const segs = [];
    spans.forEach((sp, i) => {
        const L = sp.s1 - sp.s0 - 2 * edge;
        if (L <= 0) return;
        const z = 0.2 * (sp.s1 - sp.s0);
        let n1 = Math.max(1, Math.round(z / sEnd));
        if (2 * n1 * sEnd > L) n1 = Math.max(0, Math.floor(L / (2 * sEnd)));
        const mid = L - 2 * n1 * sEnd;
        const n2 = Math.max(0, Math.floor(mid / sMid + 1e-9));
        const r = Math.round(mid - n2 * sMid);
        if (n1) segs.push({ n: n1, s: sEnd });
        if (n2) segs.push({ n: n2, s: sMid });
        if (r > 1) segs.push({ n: 1, s: r });
        if (n1) segs.push({ n: n1, s: sEnd });
        if (i < spans.length - 1) segs.push({ n: 1, s: Math.round(edge + (spans[i + 1].s0 - sp.s1) + edge) });
    });
    return { D: edge, segs, R1: 100, BC: { n: 0, s: 0 }, R2: 0 };
}

export function getHorz(c, bi = 0) {
    return (c && c.rebar && c.rebar.horz && c.rebar.horz[bi]) || null;
}

/** 저장값 또는 기본값 */
export function getHorzFace(c, bi, member, face, g) {
    g = g || sectionGeom(c, bi);
    const hz = getHorz(c, bi) || {};
    const f = hz.faces && hz.faces[member] && hz.faces[member][face];
    if (f && Array.isArray(f.segs)) return { R1: 100, BC: { n: 0, s: 0 }, R2: 0, ...f };
    return defaultHorzFace(g, member, face, hz.std || 300, !!hz.sameSpacing);
}

/** 면의 철근 위치 s 목록 (기본 + 추가) → { main:[s], extra:[s] } */
export function horzPositions(f, span, extra) {
    const main = [];
    let s = +f.D || 0;
    main.push(s);
    for (const sg of f.segs || []) for (let k = 0; k < (sg.n | 0); k++) { s += +sg.s || 0; main.push(s); }
    const ex = [];
    if (extra) {
        const R1 = +f.R1 || 0, BC = f.BC || {}, R2 = +f.R2 || 0;
        const offs = [];
        if (R1 > 0) offs.push(R1);
        let o = R1;
        for (let k = 0; k < (BC.n | 0); k++) { o += +BC.s || 0; offs.push(o); }
        if (R2 > 0) offs.push(o + R2);
        for (const v of offs) { ex.push(-v); ex.push(span + v); }
    }
    return { main, extra: ex };
}

/**
 * 수평철근 배치 (점).
 * 반환: { g, set, faces:[{ member, face, dia, line, f, dots:[{ s, pt, extra }] }] }
 */
export function horzLayout(p, c, bi = 0) {
    const g = sectionGeom(c, bi);
    const st = getSettings(c, bi);
    const set = getHorzSet(c, bi);
    const out = [];
    for (const m of horzMembers(g)) {
        for (const fc of m.faces) {
            const line = faceLine(g, st, m.key, fc.key, 1);
            const f = getHorzFace(c, bi, m.key, fc.key, g);
            const dia = horzDia(set, m.key, fc.key);
            const mainDia = getMainFace(c, bi, 1, 'straight', 1, m.key, fc.key, g).R[0];
            let inw = line.inward;
            if ((m.key === 'top' && fc.key === 'U' && set.opts.topAbove) || ((m.key === 'left' || m.key === 'right') && fc.key === 'I' && set.opts.innerOut)) inw = [-inw[0], -inw[1]];
            const offd = barD(mainDia) / 2 + barD(dia) / 2;
            const span = spansOf(g, m.key).slice(-1)[0].s1;
            const extra = m.kind === 'slab' ? set.opts.slabExtra : set.opts.wallExtra;
            const pos = horzPositions(f, span, extra);
            const dots = [];
            const add = (s, ex) => {
                if (s < line.s0 - 1 || s > line.s1 + 1) return;
                const q = pointAt(line.path, s - line.s0).pt;
                dots.push({ s, pt: [q[0] + inw[0] * offd, q[1] + inw[1] * offd], extra: ex });
            };
            pos.main.forEach(s => add(s, false));
            pos.extra.forEach(s => add(s, true));
            out.push({ member: m.key, face: fc.key, dia, line, f, dots, inward: inw });
        }
    }
    return { g, set, faces: out };
}

/** 위치 s 에서 면의 수평철근량 (mm²/m) — 이웃 철근 간격 기준 */
export function horzAsAt(face, s) {
    const ss = face.dots.filter(d => !d.extra).map(d => d.s).sort((a, b) => a - b);
    if (ss.length < 2) return 0;
    // 간격 목록. 중간벽 등으로 철근이 끊긴 빈 구간(중앙값의 2.5배 초과)은 간격으로 보지 않는다
    const gaps = [];
    for (let i = 1; i < ss.length; i++) gaps.push(ss[i] - ss[i - 1]);
    const med = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const real = (g) => g > 0 && g <= med * 2.5;
    // s 에 가장 가까운 철근의 앞뒤 간격 중 실제 간격
    let k = 0;
    for (let i = 1; i < ss.length; i++) if (Math.abs(ss[i] - s) < Math.abs(ss[k] - s)) k = i;
    const cand = [gaps[k - 1], gaps[k]].filter(g => g != null && real(g));
    const sp = cand.length ? Math.max(...cand) : med;
    return sp > 0 ? barArea(face.dia) * 1000 / sp : 0;
}
