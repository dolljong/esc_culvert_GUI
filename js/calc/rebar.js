// rebar.js - 배근 공용 기반 (배근 입력 화면·철근 도면·설계검토·철근재료표 공용)
//
// ── 데이터 위치 ──────────────────────────────────────────────────────
//   project.rebarCommon                       프로젝트 공통 표 (getRebarCommon)
//     { diaTable:{D10:{mass}...}, factors:{alpha,beta,gamma,lambda}, coating, lightweight,
//       lapMethod:'산식에 의한 방법'|'보정계수에 의한 방법', lapRound:'올림'|'반올림'|'반올림안함',
//       formula:{cover, spacing}, devTable:{D10:{basic,normal,top,cBasic,cSpiral}}, lapTable:{D10:{nA,nB,tA,tB,c,cTie,spiral}},
//       marks:{top:'T', bottom:'B', ...} }
//   culverts[i].rebar.settings[bi]            블록별 배근설정 (getSettings)
//     { cycle:'1Cycle'|'2Cycle'|'4Cycle', ctc, lapStdLen, roundLen, upperScope, midWallBend,
//       cover:{top:{U:[1단,2단,3단],L:[]}, mid:{U,L}, bottom:{U,L}, left:{O,I}, midWall:{I}, right:{O,I}, plan:{S:[80]}},
//       skew:'전체'|'절반'|'시점 경사방향'|'종점 경사방향',
//       layers:{ [member]:{ [face]:{l2c1,l2c2,l3c1,l3c2} } } }            (배치단수 설정)
//   culverts[i].rebar.main[bi].c{1..4}[zone]['L'+layer][member][face]   주철근 입력 (getMainFace)
//     face = { n, D:[n], R:[n+1], place:[n+1] }
//       1/3Cycle: n = 겹이음 개수, D = 기준위치부터 이음 중심까지 연속거리, R = 이음 사이 철근 직경
//       2/4Cycle: n = 절단점 개수, D = 절단점 연속거리, R = 조각 직경, place = 조각 배치 여부
//       3Cycle 은 n/R 을 1Cycle 에서, 4Cycle 은 n/R/place 를 2Cycle 에서 상속하고 D 만 따로 가진다.
//     zone: 'straight'(직구간) | 'start'(시점구간) | 'end'(종점구간)
//
// ── 좌표 ─────────────────────────────────────────────────────────────
//   sectionGeom 과 동일: x=0 좌측벽 외면, y=0 하부슬래브 하면 (mm).
//   부재(member) 키는 frameModel 부재군과 같다: 'top' | 'bottom' | 'mid'(복층 중간슬래브) | 'left' | 'right'
//   | 'mid:i'(중간벽체) | 'midU:i'(복층 2층 중간벽체).
//   면(face): 슬래브 'U'(상면) 'L'(하면) / 외측벽 'O'(외측) 'I'(내측) / 중간벽 'L'(좌측면) 'R'(우측면).
//   이음 거리 기준(s=0): 슬래브 = 좌측벽 내면(첫 련 x0), 벽 = 상부슬래브 하면에서 아래로 (U형은 벽 상단).

import { sectionGeom } from './sectionGeom.js';

// ── 철근 제원 ────────────────────────────────────────────────────────

export const DIAS = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32', 'D35', 'D38', 'D41', 'D51'];
/** 고강도(SD400 이상) 표기: 제원은 같은 호칭의 D 와 동일 */
export const H_DIAS = DIAS.map(d => 'H' + d.slice(1));

//            단위질량 kg/m, 단면적 mm², 지름 mm, 둘레 mm, 구부림반지름 mm, 절곡 적용값 mm
const BASE = {
    D10: [0.560, 71.33, 9.53, 30, 100, 157],
    D13: [0.995, 126.7, 12.7, 40, 140, 220],
    D16: [1.560, 198.6, 15.9, 50, 170, 267],
    D19: [2.250, 286.5, 19.1, 60, 200, 314],
    D22: [3.040, 387.1, 22.2, 70, 240, 377],
    D25: [3.980, 506.7, 25.4, 80, 270, 424],
    D29: [5.040, 642.4, 28.6, 90, 310, 487],
    D32: [6.230, 794.2, 31.8, 100, 340, 534],
    D35: [7.510, 956.6, 34.9, 110, 370, 581],
    D38: [8.950, 1140, 38.1, 120, 400, 628],
    D41: [10.50, 1340, 41.3, 130, 440, 691],
    D51: [15.90, 2027, 50.8, 160, 540, 848],
};

/** 기본 철근 제원표 { D10: { mass, area, d, perim, bendR, bendLen } } */
export const DIA_TABLE = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, { mass: v[0], area: v[1], d: v[2], perim: v[3], bendR: v[4], bendLen: v[5] }]));

/** 'H22' / 22 / 'D22' → 'D22' (표에 없으면 null) */
export function normDia(dia) {
    if (dia == null || dia === '') return null;
    if (typeof dia === 'number') dia = 'D' + dia;
    const m = /^[DHdh]?(\d+)$/.exec(String(dia).trim());
    if (!m) return null;
    const k = 'D' + m[1];
    return DIA_TABLE[k] ? k : null;
}

/**
 * 철근 제원 (rebarCommon.diaTable 의 단위질량 수정값 반영).
 * 반환: { name, mass(kg/m), area(mm²), d(mm), perim(mm), bendR(mm), bendLen(mm) } | null
 */
export function barInfo(dia, p) {
    const k = normDia(dia);
    if (!k) return null;
    const base = DIA_TABLE[k];
    const ov = p && p.rebarCommon && p.rebarCommon.diaTable && p.rebarCommon.diaTable[k];
    return { name: String(dia), ...base, ...(ov && ov.mass != null ? { mass: +ov.mass } : {}) };
}
export const barArea = (dia) => (barInfo(dia) || { area: 0 }).area;
export const barD = (dia) => (barInfo(dia) || { d: 0 }).d;
export const diaNum = (dia) => { const k = normDia(dia); return k ? +k.slice(1) : 0; };
export const maxDia = (a, b) => (diaNum(a) >= diaNum(b) ? a : b);
/** 직경 범위 [lo..hi] */
export function diaRange(lo, hi) {
    const a = DIAS.indexOf(normDia(lo)), b = DIAS.indexOf(normDia(hi));
    return DIAS.slice(Math.max(0, a), (b < 0 ? DIAS.length - 1 : b) + 1);
}

// ── 공통 설정 (rebarCommon) ─────────────────────────────────────────

export const MARK_KEYS = [
    ['top', '상부슬래브', 'T'], ['bottom', '하부슬래브', 'B'], ['wall', '벽체철근', 'W'], ['mid', '중간슬래브', 'M'],
    ['midWall', '중간벽체', 'O'], ['column', '기둥철근', 'P'], ['beam', '보철근', 'G'], ['horz', '수평철근', 'D'],
    ['shear', '전단철근', 'S'], ['haunch', '헌치철근', 'H'], ['corner', '단절점부철근', 'R'], ['road', '차도부철근', 'A'],
    ['plate', '신축이음 받침판', 'E'],
];
export const DEFAULT_MARKS = Object.fromEntries(MARK_KEYS.map(([k, , v]) => [k, v]));

export const LAP_METHODS = ['산식에 의한 방법', '보정계수에 의한 방법'];
export const LAP_ROUNDS = ['올림', '반올림', '반올림안함'];

export function defaultRebarCommon() {
    return {
        diaTable: {},                                    // { D19: { mass } } 사용자 수정 단위질량
        factors: {
            alpha: { top: 1.3, normal: 1.0 },
            beta: { coated1: 1.5, coated2: 1.2, none: 1.0 },
            gamma: { large: 1.0, small: 0.8 },
            lambda: { light: 1.3, normal: 1.0 },
        },
        coating: 'none',                                 // 'none' | 'coated1' | 'coated2'
        lightweight: false,
        lapMethod: LAP_METHODS[0],
        lapRound: '반올림',
        formula: { cover: 100, spacing: 125 },           // 산식용 피복두께/철근간격 (mm)
        devTable: {},                                    // 보정계수 모드 사용자 값
        lapTable: {},
        marks: { ...DEFAULT_MARKS },
    };
}

function deepMerge(base, over) {
    if (over == null) return base;
    if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? deepMerge(base[k], v) : v;
    }
    return out;
}

/** 프로젝트 공통 배근 설정 (기본값 병합) */
export function getRebarCommon(p) {
    return deepMerge(defaultRebarCommon(), (p && p.rebarCommon) || {});
}

/** 설계조건의 재료 (MPa). design 화면 데이터가 없으면 fck 24, fy 300 */
export function materials(p) {
    const e = (p && p.design && p.design.env) || {};
    return { fck: +e.fck || 24, fy: +e.fy || 300, code: e.kci || 'KCI2007', phiF: +e.phiF || 0.85 };
}

// ── 블록별 배근설정 ──────────────────────────────────────────────────

export const CYCLE_OPTIONS = ['1Cycle', '2Cycle', '4Cycle'];
export const ROUND_LEN = ['반올림안함', 'MM단위 반올림', 'CM단위 3사4입', 'CM단위 4사5입'];
export const UPPER_SCOPE = ['주철근, 수평철근', '주철근', '수평철근', '적용안함'];
export const MIDWALL_BEND = ['자동(D19이상 곡선)', '곡선', '직선'];
export const SKEW_OPTIONS = ['전체', '절반', '시점 경사방향', '종점 경사방향'];

/** 철근피복 기본값 (철근 중심까지, 1단/2단/3단) */
export function defaultCover() {
    return {
        top: { U: [80, 180, 280], L: [80, 180, 280] },
        mid: { U: [40, 140, 240], L: [40, 140, 240] },
        bottom: { U: [80, 180, 280], L: [80, 180, 280] },
        left: { O: [80, 180, 280], I: [60, 160, 260] },
        midWall: { I: [80, 180, 280] },
        right: { O: [80, 180, 280], I: [60, 160, 260] },
        plan: { S: [80] },
    };
}

export function defaultSettings() {
    return {
        cycle: '2Cycle', ctc: 250, lapStdLen: 8000, roundLen: 'MM단위 반올림',
        upperScope: UPPER_SCOPE[0], midWallBend: MIDWALL_BEND[0],
        cover: defaultCover(), skew: '전체', layers: {},
    };
}

/** 블록 bi 의 배근설정 (기본값 병합) */
export function getSettings(c, bi = 0) {
    const s = c && c.rebar && c.rebar.settings && c.rebar.settings[bi];
    return deepMerge(defaultSettings(), s || {});
}

/** 배치옵션 → 사용 Cycle 목록 */
export function cyclesOf(settings) {
    const o = settings && settings.cycle;
    return o === '1Cycle' ? [1] : o === '4Cycle' ? [1, 2, 3, 4] : [1, 2];
}
export function cycleEnabled(c, bi, cyc) { return cyclesOf(getSettings(c, bi)).includes(cyc); }

/** Cycle 별 단위폭(1m)당 철근 개수. 1C~1C 간격 = ctc. 4Cycle 은 1·3 / 2·4 가 번갈아 놓인다. */
export function barsPerMeter(settings, cyc) {
    const ctc = +settings.ctc || 250;
    const four = settings.cycle === '4Cycle';
    if (cyc === 1 || cyc === 2) return (four ? 500 : 1000) / ctc;
    return 500 / ctc;   // 3, 4
}

/** 피복 (철근 중심까지, mm) */
export function coverOf(settings, member, face, layer = 1) {
    const cv = (settings && settings.cover) || defaultCover();
    const li = Math.max(0, Math.min(2, layer - 1));
    let row;
    if (member === 'top' || member === 'bottom' || member === 'mid') row = (cv[member] || {})[face];
    else if (member === 'left' || member === 'right') row = (cv[member] || {})[face];
    else row = (cv.midWall || {}).I;
    const v = row && row[li];
    return v != null && isFinite(+v) ? +v : 80 + 100 * li;
}

/** 배치단수: 해당 단/주기 사용 여부 (1단은 항상 true). cycKind: 1 (1·3Cycle) | 2 (2·4Cycle) */
export function layerEnabled(settings, member, face, layer, cycKind = 1) {
    if (layer <= 1) return true;
    const o = settings && settings.layers && settings.layers[member] && settings.layers[member][face];
    if (!o) return false;
    const k = cycKind === 2 || cycKind === 4 ? 'c2' : 'c1';
    if (layer === 2) return !!o['l2' + k];
    return !!o['l2' + k] && !!o['l3' + k];
}

/** 블록의 입력 구간 (직구간 / 시점구간 / 종점구간) */
export function zonesOf(c, bi, settings) {
    const st = settings || getSettings(c, bi);
    const j = c.joints || [];
    const a0 = j[bi] ? +j[bi].angle || 90 : 90, a1 = j[bi + 1] ? +j[bi + 1].angle || 90 : 90;
    const out = [{ id: 'straight', title: '직구간', enabled: true }];
    const startOk = Math.abs(a0 - 90) > 1e-6 && st.skew !== '종점 경사방향';
    const endOk = Math.abs(a1 - 90) > 1e-6 && st.skew !== '시점 경사방향';
    out.push({ id: 'start', title: '시점구간', enabled: startOk });
    out.push({ id: 'end', title: '종점구간', enabled: endOk });
    return out;
}

// ── 길이 반올림 ──────────────────────────────────────────────────────

/** 정착장/이음장 반올림 (10mm 단위) */
export function roundDev(v, mode = '반올림') {
    if (!isFinite(v)) return v;
    if (mode === '올림') return Math.ceil(v / 10 - 1e-9) * 10;
    if (mode === '반올림') return Math.round(v / 10) * 10;
    return Math.round(v);
}

/** 철근 길이 반올림 (배근옵션 '철근 길이 반올림 적용') */
export function roundBarLen(v, mode = 'MM단위 반올림') {
    if (!isFinite(v)) return v;
    if (mode === '반올림안함') return Math.round(v * 10) / 10;
    const mm = Math.round(v);
    if (mode === 'CM단위 3사4입') { const r = mm % 10; return r >= 4 ? mm - r + 10 : mm - r; }
    if (mode === 'CM단위 4사5입') return Math.round(mm / 10) * 10;
    return mm;
}

// ── 정착장 / 이음장 (KCI 콘크리트구조설계기준 8장) ─────────────────

function devCalc(p, dia, common) {
    const b = barInfo(dia);
    if (!b) return null;
    const { fck, fy } = materials(p);
    const f = common.factors;
    const db = b.d;
    const lam = common.lightweight ? +f.lambda.light : +f.lambda.normal;
    const beta = +(f.beta[common.coating] ?? f.beta.none);
    const gamma = diaNum(dia) <= 19 ? +f.gamma.small : +f.gamma.large;
    const sq = Math.sqrt(fck);
    let ld;
    if (common.lapMethod === LAP_METHODS[1]) {
        // 보정계수에 의한 방법: ld = ldb × β × γ × λ,  ldb = 0.6·db·fy/√fck
        ld = 0.6 * db * fy / sq * beta * gamma * lam;
    } else {
        // 산식: ld = 0.9·db·fy/√fck × (α·β·γ·λ) / ((c + Ktr)/db),  (c+Ktr)/db ≤ 2.5,  Ktr = 0
        const c = Math.min(+common.formula.cover || 100, (+common.formula.spacing || 125) / 2);
        const cr = Math.min(2.5, c / db);
        ld = 0.9 * db * fy / sq * Math.min(1.7, beta) * gamma * lam / cr;
    }
    const tension = ld;   // 최소값 300 은 표 값에서 적용
    const comp = Math.max(200, 0.25 * db * fy / (lam * sq), 0.043 * db * fy);
    // 압축 이음 (KCI 8.6.3): fy ≤ 400 → 0.072·fy·db, 그 외 (0.13·fy − 24)·db,  fck < 21 → ×4/3
    let lapC = fy <= 400 ? 0.072 * fy * db : (0.13 * fy - 24) * db;
    if (fck < 21) lapC *= 4 / 3;
    return { db, tension, alphaN: +f.alpha.normal, alphaT: Math.min(1.7 / Math.max(1, beta), +f.alpha.top), comp, lapC };
}

/**
 * 정착장 표 (철근정착 탭). 반환: [{ dia, basic, normal, top, cBasic, cSpiral }] (mm)
 * 보정계수 모드에서는 rebarCommon.devTable 사용자 값이 우선.
 */
export function anchorageTable(p) {
    const cm = getRebarCommon(p);
    const R = (v) => roundDev(v, cm.lapRound);
    return DIAS.map(dia => {
        const r = devCalc(p, dia, cm);
        const row = {
            dia,
            basic: R(r.tension),
            normal: R(Math.max(300, r.tension * r.alphaN)),
            top: R(Math.max(300, r.tension * r.alphaT)),
            cBasic: R(r.comp),
            cSpiral: R(Math.max(300, 0.75 * r.lapC)),
        };
        if (cm.lapMethod === LAP_METHODS[1]) Object.assign(row, pickNum(cm.devTable[dia]));
        return row;
    });
}

/**
 * 이음장 표. 반환: [{ dia, nA, nB, tA, tB, c, cTie, spiral }] (mm)
 *  인장 A급 = 1.0·ld, B급 = 1.3·ld (≥300) / 압축 일반, 폐합띠철근(×0.83), 나선철근(×0.75) (≥300)
 */
export function lapTable(p) {
    const cm = getRebarCommon(p);
    const R = (v) => roundDev(v, cm.lapRound);
    return DIAS.map(dia => {
        const r = devCalc(p, dia, cm);
        const ldN = r.tension * r.alphaN, ldT = r.tension * r.alphaT;
        const row = {
            dia,
            nA: R(Math.max(300, ldN)), nB: R(Math.max(300, 1.3 * ldN)),
            tA: R(Math.max(300, ldT)), tB: R(Math.max(300, 1.3 * ldT)),
            c: R(Math.max(300, r.lapC)), cTie: R(Math.max(300, 0.83 * r.lapC)), spiral: R(Math.max(300, 0.75 * r.lapC)),
        };
        if (cm.lapMethod === LAP_METHODS[1]) Object.assign(row, pickNum(cm.lapTable[dia]));
        return row;
    });
}

function pickNum(o) {
    const out = {};
    if (o) for (const [k, v] of Object.entries(o)) if (v != null && isFinite(+v)) out[k] = +v;
    return out;
}

/**
 * 인장/압축 정착장 (mm).
 * o: { top: 상부철근, compression, spiral }
 */
export function devLength(p, dia, o = {}) {
    const k = normDia(dia);
    if (!k) return 0;
    const row = anchorageTable(p).find(r => r.dia === k);
    if (o.compression) return o.spiral ? row.cSpiral : row.cBasic;
    return o.top ? row.top : row.normal;
}

/**
 * 겹이음 길이 (mm).
 * o: { top: 상부철근, cls: 'A'|'B' (기본 B), compression, tie, spiral }
 */
export function lapLength(p, dia, o = {}) {
    const k = normDia(dia);
    if (!k) return 0;
    const row = lapTable(p).find(r => r.dia === k);
    if (o.compression) return o.spiral ? row.spiral : o.tie ? row.cTie : row.c;
    const cls = o.cls === 'A' ? 'A' : 'B';
    return o.top ? row['t' + cls] : row['n' + cls];
}

/** 상부철근 계수 적용 여부 (배근옵션 '상부 이음/정착장 적용 범위') */
export function upperApplies(settings, kind = 'main') {
    const s = (settings && settings.upperScope) || UPPER_SCOPE[0];
    if (s === '적용안함') return false;
    return kind === 'main' ? s.includes('주철근') : s.includes('수평철근');
}

// ── 폴리라인 도구 ────────────────────────────────────────────────────

export function pathLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
}

/** 경로 시점에서 거리 t 인 점과 접선 (범위 밖은 끝 선분 연장) */
export function pointAt(pts, t) {
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-9) continue;
        const last = i === pts.length - 1;
        if (t <= acc + L || last) {
            const u = (t - acc) / L;
            const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
            if (i === 1 && t < 0) return { pt: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir };
            return { pt: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir };
        }
        acc += L;
    }
    return { pt: pts[0].slice(), dir: [1, 0] };
}

/** 경로의 t0~t1 부분 */
export function subPath(pts, t0, t1) {
    if (t1 < t0) [t0, t1] = [t1, t0];
    const out = [pointAt(pts, t0).pt];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        acc += L;
        if (acc > t0 + 1e-6 && acc < t1 - 1e-6 && i < pts.length - 1) out.push(pts[i].slice());
    }
    out.push(pointAt(pts, t1).pt);
    return out;
}

/**
 * 절곡을 고려한 철근 길이. 꺾인점마다 접선길이 2R·tan(θ/2) 를 빼고 호 길이 R·θ 를 더한다.
 * 반환: { length, straight:[각 직선부 길이], bends:[{ angle(deg), arc }] }
 */
export function barLength(pts, bendR = 0) {
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const straight = segs.slice();
    const bends = [];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
        const b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
        const la = Math.hypot(...a), lb = Math.hypot(...b);
        if (la < 1e-9 || lb < 1e-9) continue;
        const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)));
        const th = Math.acos(cos);
        if (th < 1e-6) continue;
        const tang = bendR * Math.tan(th / 2);
        straight[i - 1] -= tang;
        straight[i] -= tang;
        bends.push({ angle: th * 180 / Math.PI, arc: bendR * th });
    }
    const length = straight.reduce((s, v) => s + v, 0) + bends.reduce((s, v) => s + v.arc, 0);
    return { length, straight, bends };
}

// ── 주철근 부재 / 면 ────────────────────────────────────────────────

/**
 * 단면의 주철근 입력 부재 목록 (탭 순서).
 * 반환: [{ key, title, kind:'slab'|'wall', faces:[{ key, title, cnt, D, R, outer }] }]
 *   cnt/D/R = 입력 라벨 ('상면이음', 'UD', 'UR')
 */
export function mainMembers(g) {
    const slabFaces = (outerFace) => [
        { key: 'U', title: '상면', cnt: '상면이음', D: 'UD', R: 'UR', outer: outerFace === 'U' },
        { key: 'L', title: '하면', cnt: '하면이음', D: 'LD', R: 'LR', outer: outerFace === 'L' },
    ];
    const wallFaces = (side) => [
        { key: 'O', title: '외측', cnt: '외측이음', D: side === 'L' ? 'LD' : 'RD', R: side === 'L' ? 'LR' : 'RR', outer: true },
        { key: 'I', title: '내측', cnt: '내측이음', D: side === 'L' ? 'RD' : 'LD', R: side === 'L' ? 'RR' : 'LR', outer: false },
    ];
    const midFaces = () => [
        { key: 'L', title: '좌측면', cnt: '좌측이음', D: 'LD', R: 'LR', outer: false },
        { key: 'R', title: '우측면', cnt: '우측이음', D: 'RD', R: 'RR', outer: false },
    ];
    const out = [];
    if (g.kind !== 'U') out.push({ key: 'top', title: '상부슬래브', kind: 'slab', faces: slabFaces('U') });
    if (g.kind === 'DOUBLE') out.push({ key: 'mid', title: '중간슬래브', kind: 'slab', faces: slabFaces(null) });
    out.push({ key: 'bottom', title: '하부슬래브', kind: 'slab', faces: slabFaces('L') });
    out.push({ key: 'left', title: '좌측 벽체', kind: 'wall', faces: wallFaces('L') });
    out.push({ key: 'right', title: '우측 벽체', kind: 'wall', faces: wallFaces('R') });
    for (const w of g.walls) {
        if (w.kind !== 'mid' || w.type !== '연속벽체') continue;
        if (g.kind === 'DOUBLE') {
            out.push({ key: (w.floor === 2 ? 'midU:' : 'mid:') + w.index, title: `${w.floor === 2 ? '2층' : '1층'} 중간벽체${w.index + 1}`, kind: 'wall', faces: midFaces() });
        } else {
            out.push({ key: 'mid:' + w.index, title: `중간벽체${w.index + 1}`, kind: 'wall', faces: midFaces() });
        }
    }
    return out;
}

function wallOf(g, member) {
    if (member === 'left') return g.walls.find(w => w.kind === 'outer' && w.side === 'L');
    if (member === 'right') return g.walls.find(w => w.kind === 'outer' && w.side === 'R');
    const m = /^mid(U?):(\d+)$/.exec(member);
    if (!m) return null;
    const floor = m[1] ? 2 : (g.kind === 'DOUBLE' ? 1 : undefined);
    return g.walls.find(w => w.kind === 'mid' && w.index === +m[2] && (floor === undefined || w.floor === floor));
}

/** 부재 두께 (mm) */
export function memberThickness(g, member) {
    if (member === 'top') return g.UT;
    if (member === 'bottom') return g.LT;
    if (member === 'mid') return g.MT;
    const w = wallOf(g, member);
    return w ? w.t : 0;
}

/**
 * 면의 철근 경로 (layer 단, 피복 반영).
 * 반환: { member, face, layer, path:[[x,y]..], s0 (경로 시점의 s), len, refPt, inward:[nx,ny] 시점 기준 부재 안쪽,
 *         legs:{ start?:{dir:[dx,dy], base}, end?:{...} }, top (상부철근), thick, axis:'x'|'y' }
 *   s = 이음 기준위치부터의 거리. 경로 위 점 = pointAt(path, s - s0).
 *   legs: 외측면 1단 철근이 모서리에서 꺾여 벽(슬래브)으로 들어가는 다리. 길이 = base + 이음장.
 */
export function faceLine(g, settings, member, face, layer = 1) {
    const cv = (m, f, l = layer) => coverOf(settings, m, f, l);
    const isU = g.kind === 'U', isD = g.kind === 'DOUBLE';
    const W = g.W, Htot = g.Htot, LT = g.LT;
    const yTopIn = isU ? Htot : LT + g.H;                  // 상부슬래브 하면 (U형: 벽 상단)
    const stepL = isD ? g.WL - g.WLu : 0, stepR = isD ? g.WR - g.WRu : 0;
    const out = { member, face, layer, legs: {}, top: false, thick: memberThickness(g, member) };
    const cells = isD ? g.cells.filter(cc => cc.floor === 1) : g.cells;
    const xRef = isU ? g.inner.x0 : cells[0].x0;
    // 슬래브 x 범위 (외측벽 외측 피복까지)
    const xa = (m) => (m === 'top' ? stepL : 0) + cv('left', 'O');
    const xb = (m) => W - (m === 'top' ? stepR : 0) - cv('right', 'O');
    const yTopBar = Htot - cv('top', 'U', 1), yBotBar = cv('bottom', 'L', 1);
    if (member === 'top' || member === 'bottom' || member === 'mid') {
        const c = cv(member, face);
        let y;
        if (member === 'top') y = face === 'U' ? Htot - c : yTopIn + c;
        else if (member === 'bottom') y = face === 'U' ? LT - c : c;
        else y = face === 'U' ? LT + g.MH + g.MT - c : LT + g.MH + c;
        const x0 = xa(member), x1 = xb(member);
        out.path = [[x0, y], [x1, y]];
        out.s0 = x0 - xRef;
        out.refPt = [xRef, y];
        out.axis = 'x';
        out.inward = face === 'U' ? [0, -1] : [0, 1];
        out.top = face === 'U' && out.thick - c > 300;   // 아래 콘크리트 300mm 초과 → 상부철근
        if (layer === 1 && member === 'top' && face === 'U') {
            out.legs.start = { dir: [0, -1], base: g.UT - c };
            out.legs.end = { dir: [0, -1], base: g.UT - c };
        }
        if (layer === 1 && member === 'bottom' && face === 'L') {
            out.legs.start = { dir: [0, 1], base: g.LT - c };
            out.legs.end = { dir: [0, 1], base: g.LT - c };
        }
    } else if (member === 'left' || member === 'right') {
        const c = cv(member, face);
        const R = member === 'right';
        const mx = (x) => (R ? W - x : x);
        let pts;
        const yT = isU ? Htot - cv('left', 'O', 1) : yTopBar;
        const yB = yBotBar;
        if (face === 'O') {
            if (isU) {
                const WB = g.WB, WT = g.WT, xi0 = g.inner.x0;
                const yA = LT + g.H1, yB2 = LT + g.H1 + g.H2;
                pts = [[xi0 - WT + c, yT], [xi0 - WT + c, yB2], [xi0 - WB + c, yA], [xi0 - WB + c, yB]];
            } else if (isD && (R ? stepR : stepL) > 0) {
                const st = R ? stepR : stepL, ys = LT + g.MH + g.MT;
                pts = [[st + c, yT], [st + c, ys], [c, ys - st], [c, yB]];
            } else pts = [[c, yT], [c, yB]];
        } else {
            const wInner = isU ? g.inner.x0 : (R ? W - g.WR : g.WL);
            const xin = R ? W - wInner : wInner;   // 좌측 기준 내면 x
            let top = yT;
            if (isU && g.cut) top = Math.min(top, Htot - g.cut.h - c);
            pts = [[xin - c, top], [xin - c, yB]];
        }
        out.path = pts.map(([x, y]) => [mx(x), y]);
        out.s0 = yTopIn - out.path[0][1];
        out.refPt = [out.path[0][0], yTopIn];
        out.axis = 'y';
        const inSign = face === 'O' ? 1 : -1;
        out.inward = [R ? -inSign : inSign, 0];
        if (isU) out.thick = g.WB;
    } else {
        const w = wallOf(g, member);
        const c = cv(member, face);
        const x = face === 'L' ? w.x0 + c : w.x1 - c;
        let y0 = yBotBar, y1 = yTopBar, ref = yTopIn;
        if (isD) {
            const ys0 = LT + g.MH, ys1 = LT + g.MH + g.MT;
            if (/^mid:/.test(member)) { y1 = ys1 - cv('mid', 'U', 1); ref = ys0; }
            else { y0 = ys0 + cv('mid', 'L', 1); }
        }
        out.path = [[x, y1], [x, y0]];
        out.s0 = ref - y1;
        out.refPt = [x, ref];
        out.axis = 'y';
        out.inward = face === 'L' ? [1, 0] : [-1, 0];
    }
    out.len = pathLength(out.path);
    out.s1 = out.s0 + out.len;
    return out;
}

/** 이음 기준 길이 (슬래브: 내공 전체폭, 벽: 내공 높이) */
export function faceRefSpan(g, member) {
    if (member === 'top' || member === 'bottom' || member === 'mid') {
        if (g.kind === 'U') return g.inner.x1 - g.inner.x0;
        const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
        return cells[cells.length - 1].x1 - cells[0].x0;
    }
    if (g.kind === 'U') return g.H;
    if (g.kind === 'DOUBLE') {
        if (/^mid:/.test(member)) return g.MH;
        if (/^midU:/.test(member)) return g.H - g.MH - g.MT;
    }
    return g.H;
}

/** 슬래브 경간 (s 좌표) [{ s0, s1 }] / 벽은 [{0, H}] */
export function spansOf(g, member) {
    if (member === 'top' || member === 'bottom' || member === 'mid') {
        if (g.kind === 'U') return [{ s0: 0, s1: g.inner.x1 - g.inner.x0 }];
        const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === (member === 'top' ? 2 : 1)) : g.cells;
        const x0 = (g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells)[0].x0;
        return cells.map(cc => ({ s0: cc.x0 - x0, s1: cc.x1 - x0 }));
    }
    return [{ s0: 0, s1: faceRefSpan(g, member) }];
}

/** 부재 두께에 따른 기본 직경 */
export function defaultDiaFor(t) {
    return t <= 350 ? 'D16' : t <= 500 ? 'D19' : t <= 700 ? 'D22' : 'D25';
}

const cum2d = (pts) => pts.map((v, i) => Math.round(i === 0 ? v : v - pts[i - 1]));

/**
 * 주철근 면 입력 기본값.
 * cyc 1/3: 외측면은 경간 중앙, 내측면은 중간벽 위치에서 겹이음 (외측벽: 높이 1/2)
 * cyc 2/4: 외측면은 경간 1/3·2/3 절단 (지점부 조각 배치), 내측면은 벽면에서 300 절단 (중앙부 조각 배치)
 */
export function defaultMainFace(g, member, face, cyc = 1) {
    const members = mainMembers(g);
    const mem = members.find(m => m.key === member);
    const f = mem && mem.faces.find(x => x.key === face);
    const outer = !!(f && f.outer);
    const t = memberThickness(g, member);
    const dia = defaultDiaFor(t);
    const spans = spansOf(g, member);
    const isSlab = mem && mem.kind === 'slab';
    const isMidWall = /^mid(U)?:/.test(member);
    let pts = [], place = null;
    if (cyc === 1 || cyc === 3) {
        if (isSlab) {
            if (outer) pts = spans.map(sp => (sp.s0 + sp.s1) / 2);
            else pts = spans.slice(0, -1).map((sp, i) => (sp.s1 + spans[i + 1].s0) / 2);
        } else if (!isMidWall && outer) pts = [spans[0].s1 / 2];
    } else {
        if (isSlab) {
            if (outer) {
                for (const sp of spans) { const L = sp.s1 - sp.s0; pts.push(sp.s0 + L / 3, sp.s0 + 2 * L / 3); }
                place = pts.concat([0]).map((_, j) => j % 2 === 0);
            } else {
                for (const sp of spans) pts.push(sp.s0 + 300, sp.s1 - 300);
                place = pts.concat([0]).map((_, j) => j % 2 === 1);
            }
        } else if (!isMidWall) {
            const L = spans[0].s1;
            if (outer) { pts = [L / 3, 2 * L / 3]; place = [true, false, true]; }
            else { pts = [300, L - 300]; place = [false, true, false]; }
        }
    }
    const n = pts.length;
    return {
        n,
        D: cum2d(pts),
        R: Array.from({ length: n + 1 }, () => dia),
        place: place || Array.from({ length: n + 1 }, () => true),
    };
}

/** 저장 경로 */
export function mainFacePath(cp, bi, cyc, zone, layer, member, face) {
    return `${cp}.rebar.main.${bi}.c${cyc}.${zone}.L${layer}.${member}.${face}`;
}

function rawFace(c, bi, cyc, zone, layer, member, face) {
    const m = c && c.rebar && c.rebar.main && c.rebar.main[bi];
    const z = m && m['c' + cyc] && m['c' + cyc][zone];
    const l = z && z['L' + layer];
    return l && l[member] && l[member][face];
}

/** 길이 맞춤 */
export function normalizeFace(f) {
    const n = Math.max(0, f.n | 0);
    const fit = (arr, len, fill) => {
        const a = (arr || []).slice(0, len);
        while (a.length < len) a.push(typeof fill === 'function' ? fill(a) : fill);
        return a;
    };
    const last = (f.R || []).filter(Boolean).slice(-1)[0] || 'D19';
    return {
        n,
        D: fit(f.D, n, (a) => 1000),
        R: fit(f.R, n + 1, last),
        place: fit(f.place, n + 1, true).map(v => v !== false),
    };
}

/**
 * 주철근 면 데이터 (저장값 또는 기본값, Cycle 상속 반영).
 * 시점/종점구간에 값이 없으면 직구간 값을, 2·3단에 값이 없으면 1단 값을 쓴다.
 */
export function getMainFace(c, bi, cyc, zone, layer, member, face, g) {
    g = g || sectionGeom(c, bi);
    const own = (cy) => rawFace(c, bi, cy, zone, layer, member, face)
        || (zone !== 'straight' ? rawFace(c, bi, cy, 'straight', layer, member, face) : null)
        || (layer > 1 ? rawFace(c, bi, cy, zone, 1, member, face) || rawFace(c, bi, cy, 'straight', 1, member, face) : null);
    if (cyc === 3 || cyc === 4) {
        const base = getMainFace(c, bi, cyc === 3 ? 1 : 2, zone, layer, member, face, g);
        const o = own(cyc);
        const D = o && Array.isArray(o.D) ? o.D : base.D;
        return normalizeFace({ ...base, D });
    }
    const o = own(cyc);
    return normalizeFace(o || defaultMainFace(g, member, face, cyc));
}

// ── 주철근 배치 형상 ─────────────────────────────────────────────────

/**
 * 주철근 배치 (단면 좌표 폴리라인).
 *
 * opts: { cycles:[1..4] (기본: 배치옵션의 모든 Cycle), zone:'straight', members:[key..], layers:[1,2,3] }
 * 반환: {
 *   g, settings, common,
 *   faces:  [{ cycle, layer, member, face, line (faceLine), data (getMainFace), labels:{cnt,D,R} }],
 *   bars:   [{ id, cycle, layer, member, face, piece, name ('UR1'), dia, pts:[[x,y]..], sFrom, sTo,
 *              length (반올림), lengthRaw, straight:[..], bends:[..], bendR, perMeter, mark ('T1'), lapStart, lapEnd }],
 *   splices:[{ cycle, layer, member, face, k, name ('UD1'), s, pt:[x,y], lap (mm, 2·4Cycle 절단점은 0), dia }],
 * }
 */
export function mainBarLayout(p, c, bi = 0, opts = {}) {
    const g = sectionGeom(c, bi);
    const settings = getSettings(c, bi);
    const common = getRebarCommon(p);
    const cycles = opts.cycles || cyclesOf(settings);
    const zone = opts.zone || 'straight';
    const layers = opts.layers || [1, 2, 3];
    const members = mainMembers(g).filter(m => !opts.members || opts.members.includes(m.key));
    const upper = upperApplies(settings, 'main');
    const faces = [], bars = [], splices = [];
    for (const cyc of cycles) {
        const kind = cyc === 1 || cyc === 3 ? 1 : 2;
        for (const mem of members) {
            for (const fc of mem.faces) {
                for (const layer of layers) {
                    if (!layerEnabled(settings, mem.key, fc.key, layer, kind)) continue;
                    const line = faceLine(g, settings, mem.key, fc.key, layer);
                    const data = getMainFace(c, bi, cyc, zone, layer, mem.key, fc.key, g);
                    faces.push({ cycle: cyc, layer, member: mem.key, face: fc.key, line, data, labels: { cnt: fc.cnt, D: fc.D, R: fc.R } });
                    const isTop = upper && line.top;
                    // 이음/절단 위치 (s)
                    const pos = [];
                    let acc = 0;
                    for (let k = 0; k < data.n; k++) { acc += +data.D[k] || 0; pos.push(acc); }
                    const laps = pos.map((s, k) => (kind === 1 ? lapLength(p, maxDia(data.R[k], data.R[k + 1]), { top: isTop, cls: 'B' }) : 0));
                    pos.forEach((s, k) => splices.push({
                        cycle: cyc, layer, member: mem.key, face: fc.key, k, name: `${fc.D}${k + 1}`, s,
                        pt: pointAt(line.path, s - line.s0).pt, lap: laps[k], dia: maxDia(data.R[k], data.R[k + 1]),
                    }));
                    for (let j = 0; j <= data.n; j++) {
                        const dia = data.R[j];
                        if (!normDia(dia)) continue;
                        if (kind === 2 && !data.place[j]) continue;
                        let a = j === 0 ? line.s0 : pos[j - 1] - laps[j - 1] / 2;
                        let b = j === data.n ? line.s1 : pos[j] + laps[j] / 2;
                        a = Math.max(line.s0, Math.min(line.s1, a));
                        b = Math.max(line.s0, Math.min(line.s1, b));
                        if (b - a < 1) continue;
                        const pts = subPath(line.path, a - line.s0, b - line.s0);
                        const info = barInfo(dia, p);
                        const legLap = lapLength(p, dia, { top: false, cls: 'B' });
                        if (j === 0 && line.legs.start && a <= line.s0 + 1e-6) {
                            const L = line.legs.start.base + legLap, d = line.legs.start.dir;
                            pts.unshift([pts[0][0] + d[0] * L, pts[0][1] + d[1] * L]);
                        }
                        if (j === data.n && line.legs.end && b >= line.s1 - 1e-6) {
                            const L = line.legs.end.base + legLap, d = line.legs.end.dir, e = pts[pts.length - 1];
                            pts.push([e[0] + d[0] * L, e[1] + d[1] * L]);
                        }
                        const bl = barLength(pts, info.bendR);
                        bars.push({
                            id: `c${cyc}.L${layer}.${mem.key}.${fc.key}.${j}`,
                            cycle: cyc, layer, member: mem.key, face: fc.key, piece: j, name: `${fc.R}${j + 1}`,
                            dia, pts, sFrom: a, sTo: b,
                            lengthRaw: bl.length, length: roundBarLen(bl.length, settings.roundLen),
                            straight: bl.straight, bends: bl.bends, bendR: info.bendR,
                            perMeter: barsPerMeter(settings, cyc),
                            lapStart: j > 0 && kind === 1 ? laps[j - 1] : 0, lapEnd: j < data.n && kind === 1 ? laps[j] : 0,
                        });
                    }
                }
            }
        }
    }
    assignMarks(bars, common);
    return { g, settings, common, faces, bars, splices };
}

/** 부재 → 철근기호 접두어 */
export function markPrefix(member, common) {
    const mk = (common && common.marks) || DEFAULT_MARKS;
    if (member === 'top') return mk.top;
    if (member === 'bottom') return mk.bottom;
    if (member === 'mid') return mk.mid;
    if (member === 'left' || member === 'right') return mk.wall;
    return mk.midWall;
}

/**
 * 도면 철근기호 부여: 접두어별 일련번호. 직경·길이·꺾임수가 같은 철근은 같은 기호.
 * bars[i].mark 에 기록하고 bars 를 반환.
 */
export function assignMarks(bars, common, startNo = {}) {
    const seen = new Map();
    const counter = { ...startNo };
    for (const b of bars) {
        const pre = b.prefix || markPrefix(b.member, common);
        const key = `${pre}|${normDia(b.dia)}|${Math.round(b.length)}|${b.pts.length}|${b.cycle === 1 || b.cycle === 3 ? 1 : 2}`;
        if (!seen.has(key)) {
            counter[pre] = (counter[pre] || 0) + 1;
            seen.set(key, `${pre}${counter[pre]}`);
        }
        b.mark = seen.get(key);
    }
    return bars;
}

/**
 * 위치 s 에서 면의 철근량 (mm²/m) 과 철근 도심 피복.
 * layout: mainBarLayout 결과, member/face, s (이음 기준 좌표)
 * 반환: { As, cover (도심까지), bars:[...] }
 */
export function steelAt(layout, member, face, s) {
    let As = 0, mom = 0;
    const used = [];
    for (const b of layout.bars) {
        if (b.member !== member || b.face !== face) continue;
        if (s < b.sFrom - 1e-6 || s > b.sTo + 1e-6) continue;
        const a = barArea(b.dia) * b.perMeter;
        const c = coverOf(layout.settings, member, face, b.layer);
        As += a; mom += a * c;
        used.push(b);
    }
    return { As, cover: As > 0 ? mom / As : coverOf(layout.settings, member, face, 1), bars: used };
}

/**
 * 설계검토 위치 (매뉴얼 5.2.6 행 순서).
 * 반환: [{ member, title, label, s, face (인장면), group (frame 부재군), x (m, 부재군 시점부터) }]
 */
export function checkPositions(g) {
    const out = [];
    const slab = (member, title, supFace, midFace) => {
        const sp = spansOf(g, member);
        const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
        const xRef = g.kind === 'U' ? g.inner.x0 : cells[0].x0;
        const xs0 = (g.walls[0].x0 + g.walls[0].x1) / 2;
        const toX = (s) => (s + xRef - xs0) / 1000;
        const n = sp.length;
        out.push({ member, title, label: '단지점부(좌측)', s: sp[0].s0, face: supFace, group: member, x: toX(sp[0].s0) });
        sp.forEach((x, i) => {
            if (i > 0) out.push({ member, title, label: `제 ${i + 1}경간 지점부`, s: x.s0, face: supFace, group: member, x: toX(x.s0) });
            out.push({ member, title, label: `제 ${i + 1}경간 중앙부`, s: (x.s0 + x.s1) / 2, face: midFace, group: member, x: toX((x.s0 + x.s1) / 2) });
            if (i < n - 1) out.push({ member, title, label: `제 ${i + 1}경간 지점부`, s: x.s1, face: supFace, group: member, x: toX(x.s1) });
        });
        out.push({ member, title, label: '단지점부(우측)', s: sp[n - 1].s1, face: supFace, group: member, x: toX(sp[n - 1].s1) });
    };
    if (g.kind !== 'U') slab('top', '상부슬래브', 'U', 'L');
    if (g.kind === 'DOUBLE') slab('mid', '중간슬래브', 'U', 'L');
    slab('bottom', '하부슬래브', 'L', 'U');
    const H = faceRefSpan(g, 'left');
    const yTopIn = g.kind === 'U' ? g.Htot : g.LT + g.H;
    const yBotAx = g.LT / 2;
    for (const [member, title] of [['left', '좌측벽체'], ['right', '우측벽체']]) {
        const toX = (s) => (yTopIn - s - yBotAx) / 1000;
        out.push({ member, title, label: '상부', s: 0, face: 'O', group: member, x: toX(0) });
        out.push({ member, title, label: '중앙부', s: H / 2, face: 'I', group: member, x: toX(H / 2) });
        out.push({ member, title, label: '하부', s: H, face: 'O', group: member, x: toX(H) });
    }
    return out;
}

/** 면의 모든 위치 s 목록에서 철근 조각 수 (철근재료표용 개수 = 블록길이/간격) */
export function barCountAlong(lengthMm, settings, cyc) {
    const ctc = +settings.ctc || 250;
    const step = settings.cycle === '4Cycle' ? ctc * 2 : ctc;
    return Math.max(1, Math.floor(lengthMm / step) + (cyc === 1 ? 1 : 0));
}
