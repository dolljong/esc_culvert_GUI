// loadHelpers.js - 검토위치(checks) 기본값·조건 조회와 2D 프레임 부재군 정의
//
// 검토위치 데이터 (구조 계산 > 검토 위치 설정, 화면 checkPos 소유)
//   c.checks = {
//     manualCalc: false,      // 계산검토용 토피/지하수위 직접입력 (false → 종단자료에서 자동)
//     manualBuoy: false,      // 부력검토용 직접입력
//     view: { profile, all, boring },
//     rows: [{
//       name: '단면 A-A', sta (m), block (0-based),
//       cover (mm, 지표~구조물 상단), gwOn, gwl (mm, 지표 기준 +위/−아래),
//       coverB, gwOnB, gwlB (부력검토용), mortar (mm, 방수몰탈),
//       boring: { topEl, hatch, split2, vsIn, layers: [{ soil, name, dH(m, 누적), N, gamma, mu, vs, part }] },
//       pave: { type:'아스팔트 포장'|'콘크리트 포장', t (mm), detail, buoy, layers: [{ name, on, t, gamma }] },
//       inner: { dead:{on,q}, live:{on, kind:'도로하중'|'철도하중', b,t,a,P, B,B1,D,H,Pr}, water:{on,h} },
//     }]
//   }
//
// 좌표/단위: EL (m), 두께 (mm 저장 → 계산 시 m), 하중 kN/m² · kN/m.

import { jointStations, blocks, fmtSta } from '../core/model.js';
import { sectionGeom, frameAxes, polyArea, haunchProfile } from './sectionGeom.js';
import { elevationAt, interpTable } from './alignment.js';
import { boringAt, layerAt } from './ground.js';
import { getDesign } from './design.js';

export const PAVE_LAYERS = [
    { name: '표층', on: false, t: 150, gamma: 23.0 },
    { name: '기층', on: false, t: 300, gamma: 23.0 },
    { name: '중간층', on: false, t: 100, gamma: 20.0 },
    { name: '보조기층', on: false, t: 300, gamma: 20.0 },
    { name: '동상방지층', on: false, t: 150, gamma: 19.0 },
    { name: 'EPS블럭', on: false, t: 3000, gamma: 2.0 },
];

export const SOIL_NAMES = {
    토사: '실트', 풍화암: '풍화암(WR)', 연암: '연암(SR)', 경암: '경암(HR)',
};

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const sectionName = (i) => {
    const s = i < 26 ? ABC[i] : ABC[Math.floor(i / 26) - 1] + ABC[i % 26];
    return `단면 ${s}-${s}`;
};

// ── 종단 위치 조회 ───────────────────────────────────────────────────

/** sta 위치의 블록 번호 (0-based) */
export function blockAt(c, sta) {
    const bl = blocks(c);
    for (const b of bl) if (sta < b.sta1 - 1e-9) return b.index;
    return Math.max(0, bl.length - 1);
}

/** 지반고 EL (선형 지반선 → 없으면 지반정보 최상층) */
export function groundElAt(p, c, sta) {
    const gl = (p.alignment && p.alignment.groundLine) || [];
    if (gl.length) return interpTable(gl, sta, 'el');
    const b = boringAt(c, sta);
    return b.groundEl ?? 0;
}

/** 구조물 상단/하단 EL (선형 종단고 = 하부슬래브 상면) */
export function structureEl(p, c, sta, bi) {
    const g = sectionGeom(c, bi);
    const ref = elevationAt((p.alignment || {}).vip, sta);
    const bot = ref - g.refY / 1000;
    return { g, refEl: ref, botEl: bot, topEl: bot + g.Htot / 1000 };
}

/** 자동(종단자료) 토피·지하수위 (mm) */
export function autoCover(p, c, sta, bi) {
    const G = groundElAt(p, c, sta);
    const { topEl } = structureEl(p, c, sta, bi);
    const gw = layerAt(c, '지하수위', sta);
    return {
        cover: Math.round((G - topEl) * 1000),
        gwOn: !!gw,
        gwl: gw ? Math.round((gw.el - G) * 1000) : -1000,
    };
}

/** 기본 주상도 (지반정보 층에서) */
export function defaultBoring(p, c, sta) {
    const b = boringAt(c, sta);
    const G = groundElAt(p, c, sta);
    const top = b.groundEl ?? G;
    const layers = [];
    const L = b.layers;
    for (let i = 0; i < L.length; i++) {
        const bottom = i < L.length - 1 ? L[i + 1].top : L[i].top - 10;
        const rock = /암/.test(L[i].name);
        layers.push({
            soil: '사질토', name: SOIL_NAMES[L[i].name] || L[i].name,
            dH: +(top - bottom).toFixed(3), N: L[i].N ?? (rock ? 50 : 15),
            gamma: rock ? 21.0 : 20.0, mu: 0.4, vs: 0, part: 1,
        });
    }
    if (!layers.length) layers.push({ soil: '사질토', name: '실트', dH: 10, N: 15, gamma: 20, mu: 0.4, vs: 0, part: 1 });
    return { topEl: +top.toFixed(3), hatch: false, split2: false, vsIn: false, layers };
}

export function defaultPave() {
    return { type: '아스팔트 포장', t: 500, detail: false, buoy: false, layers: PAVE_LAYERS.map(l => ({ ...l })) };
}

export function defaultInner() {
    return {
        dead: { on: true, q: 10.0 },
        live: { on: true, kind: '도로하중', b: 500, t: 80, a: 200, P: 96, B: 2400, B1: 200, D: 306, H: 200, Pr: 220 },
        water: { on: true, h: 3.0 },
    };
}

/** 검토단면 한 행 기본값 */
export function defaultCheckRow(p, c, i, sta, bi) {
    const a = autoCover(p, c, sta, bi);
    return {
        name: sectionName(i), sta: +sta.toFixed(3), block: bi,
        cover: a.cover, gwOn: a.gwOn, gwl: a.gwl,
        coverB: a.cover, gwOnB: a.gwOn, gwlB: a.gwl,
        mortar: i === 0 ? 50 : 50,
        boring: defaultBoring(p, c, sta),
        pave: defaultPave(),
        inner: defaultInner(),
    };
}

/** 기본 검토단면: 암거 시점, 각 신축이음, 종점 */
export function defaultChecks(p, c) {
    const st = jointStations(c);
    const nb = Math.max(1, st.length - 1);
    const rows = st.map((s, k) => defaultCheckRow(p, c, k, s, Math.min(k, nb - 1)));
    return { manualCalc: false, manualBuoy: false, view: { profile: true, all: false, boring: false }, rows };
}

/** 저장값 또는 기본값 */
export function getChecks(p, c) {
    const ch = c.checks;
    if (ch && Array.isArray(ch.rows) && ch.rows.length) return ch;
    return defaultChecks(p, c);
}

/** 포장 하중 (kN/m²) 과 두께 (m) */
export function paveLoad(d, pave) {
    pave = pave || defaultPave();
    if (pave.detail) {
        const on = (pave.layers || []).filter(l => l.on);
        const t = on.reduce((s, l) => s + (+l.t || 0), 0) / 1000;
        const q = on.reduce((s, l) => s + (+l.t || 0) / 1000 * (+l.gamma || 0), 0);
        const lines = on.map(l => `${l.name} ${(+l.t / 1000).toFixed(3)} × ${(+l.gamma).toFixed(1)} = ${((+l.t / 1000) * l.gamma).toFixed(3)}`);
        return { t, q, lines, label: '세부포장' };
    }
    const g = pave.type === '콘크리트 포장' ? d.env.gPlain : d.env.gAsphalt;
    const t = (+pave.t || 0) / 1000;
    return { t, q: t * g, gamma: g, lines: [`${pave.type} ${t.toFixed(3)} × ${g.toFixed(1)} = ${(t * g).toFixed(3)}`], label: pave.type };
}

/**
 * 검토단면 k 의 하중 조건.
 * purpose: 'calc' (구조계산) | 'buoy' (부력검토)
 * 반환: { row, name, sta, bi, g, groundEl, topEl, botEl, cover(m), gwOn, gwlEl, mortar(m), pave{t,q}, user(하중조건 사용자입력 여부), surcharge }
 */
export function checkCondition(p, c, k = 0, purpose = 'calc') {
    const ch = getChecks(p, c);
    const rows = ch.rows;
    const row = rows[Math.max(0, Math.min(rows.length - 1, k | 0))];
    const d = getDesign(p);
    const sta = +row.sta || 0;
    const nb = blocks(c).length;
    const bi = Math.max(0, Math.min(nb - 1, row.block | 0));
    const s = structureEl(p, c, sta, bi);
    const G = groundElAt(p, c, sta);
    const auto = autoCover(p, c, sta, bi);
    const buoy = purpose === 'buoy';
    const manual = buoy ? ch.manualBuoy : ch.manualCalc;
    let cover = (manual ? (buoy ? row.coverB : row.cover) : auto.cover) / 1000;
    let gwOn = manual ? !!(buoy ? row.gwOnB : row.gwOn) : auto.gwOn;
    let gwRel = (manual ? (buoy ? row.gwlB : row.gwl) : auto.gwl) / 1000;
    // 구조물 상단 EL 은 형상에서, 지반고는 토피로부터
    let topEl = s.topEl, groundEl = topEl + cover, gwlEl = groundEl + gwRel;
    let surcharge = 0, user = false;
    const ld = c.loadDef && c.loadDef.cond && c.loadDef.cond[k];
    if (!buoy && c.loadDef && c.loadDef.condUser && ld) {
        user = true;
        if (isFinite(+ld.groundEl)) groundEl = +ld.groundEl;
        if (isFinite(+ld.topEl)) topEl = +ld.topEl;
        if (isFinite(+ld.gwlEl)) gwlEl = +ld.gwlEl;
        cover = groundEl - topEl;
    }
    if (!buoy && c.loadDef && ld && ld.surOn) surcharge = +ld.sur || 0;
    const botEl = topEl - s.g.Htot / 1000;
    const pv = paveLoad(d, row.pave);
    const usePave = buoy ? (row.pave ? row.pave.buoy !== false || !row.pave.detail : true) : true;
    return {
        row, name: row.name, sta, bi, g: s.g, groundEl, topEl, botEl, cover, gwOn, gwlEl: gwOn ? gwlEl : -1e9,
        gwlElRaw: gwlEl, autoGround: G,
        mortar: (+row.mortar || 0) / 1000, pave: usePave ? pv : { t: 0, q: 0, lines: [], label: '' },
        user, surcharge, d,
    };
}

// ── 2D 프레임 부재군 ─────────────────────────────────────────────────

/**
 * 프레임 부재군 (하중 target 정의).
 * 좌표 (m): 원점 = 좌측벽 중심선 × 하부슬래브 중심선.
 *   슬래브: 왼쪽→오른쪽, 위치 a = 좌측벽 중심선에서의 거리
 *   벽체: 아래→위, 위치 a = 하부슬래브 중심선에서의 높이
 * groups: [{ id, kind:'slab'|'wall', L, x0,x1 (slab y) | x, y0,y1 (wall), t(m), label, colFactor }]
 * elements: 하중정의 화면의 Element 번호 ↔ (target, a, b) — 슬래브는 지간(련)별, 벽체는 층별
 */
export function frameModel(c, bi = 0) {
    const g = sectionGeom(c, bi);
    const ax = frameAxes(g);
    const m = (v) => v / 1000;
    const x0 = ax.xs[0], x1 = ax.xs[ax.xs.length - 1];
    const L = m(x1 - x0);
    const yB = ax.yBot, yT = ax.yTop;
    const groups = [];
    const slab = (id, y, t, label) => groups.push({ id, kind: 'slab', L, x0: 0, x1: L, y: m(y - yB), t: m(t), label });
    slab('bottom', yB, g.LT, '하부슬래브');
    if (g.kind !== 'U') slab('top', yT, g.UT, '상부슬래브');
    if (g.kind === 'DOUBLE') slab('middle', ax.yMid, g.MT, '중간슬래브');
    const cols = c.columns || {};
    const colFactor = (w) => {
        if (!w || w.type === '연속벽체') return 1;
        const ctc = +cols.ctc || 3000;
        const bw = +(cols.width || cols.b) || w.t;
        return Math.min(1, bw / ctc);
    };
    const walls = g.walls.filter(w => w.floor !== 2);
    let mi = 0;
    walls.forEach((w, i) => {
        const xc = m((w.x0 + w.x1) / 2 - x0);
        const id = w.kind === 'outer' ? (w.side === 'L' ? 'left' : 'right') : `mid:${mi++}`;
        const yTop = g.kind === 'DOUBLE' && w.kind === 'mid' ? ax.yMid : yT;
        groups.push({ id, kind: 'wall', x: xc, y0: 0, y1: m(yTop - yB), L: m(yTop - yB), t: m(w.t), label: w.kind === 'outer' ? (w.side === 'L' ? '좌측벽' : '우측벽') : `중간벽${mi}`, colFactor: colFactor(w), wtype: w.type });
    });
    if (g.kind === 'DOUBLE') {
        g.walls.filter(w => w.floor === 2).forEach((w, i) => {
            const xc = m((w.x0 + w.x1) / 2 - x0);
            groups.push({ id: `midU:${i}`, kind: 'wall', x: xc, y0: m(ax.yMid - yB), y1: m(yT - yB), L: m(yT - ax.yMid), t: m(w.t), label: `2층 중간벽${i + 1}`, colFactor: colFactor(w), wtype: w.type });
        });
    }
    // 요소 (지간/층 단위)
    const xsRel = ax.xs.map(x => m(x - x0));
    const elements = [];
    const pushSpans = (target, label) => {
        for (let i = 0; i < xsRel.length - 1; i++) elements.push({ no: elements.length + 1, target, a: xsRel[i], b: xsRel[i + 1], label: `${label} ${i + 1}지간` });
    };
    pushSpans('bottom', '하부슬래브');
    if (g.kind === 'DOUBLE') pushSpans('middle', '중간슬래브');
    if (g.kind !== 'U') pushSpans('top', '상부슬래브');
    for (const gr of groups.filter(q => q.kind === 'wall')) {
        if (g.kind === 'DOUBLE' && (gr.id === 'left' || gr.id === 'right')) {
            const ym = m(ax.yMid - yB);
            elements.push({ no: elements.length + 1, target: gr.id, a: 0, b: ym, label: `${gr.label} 1층` });
            elements.push({ no: elements.length + 1, target: gr.id, a: ym, b: gr.L, label: `${gr.label} 2층` });
        } else {
            elements.push({ no: elements.length + 1, target: gr.id, a: 0, b: gr.L, label: gr.label });
        }
    }
    return { g, ax, x0mm: x0, yBmm: yB, L, groups, elements, xs: xsRel, group: (id) => groups.find(q => q.id === id) };
}

/** 헌치 면적 (mm²) 과 수평/수직 크기 */
export function haunchArea(hc) {
    const prof = haunchProfile(hc);
    if (prof.length < 2) return { A: 0, s: 0, w: 0 };
    const pts = [[0, 0], ...prof];
    return { A: polyArea(pts), s: prof[prof.length - 1][0], w: prof[0][1] };
}

export { fmtSta };
