// design.js - 구조계산 설계조건 (구조 계산 > 설계 조건, 매뉴얼 4.1)
//
// 데이터: project.design (프로젝트 공통). 화면 js/screens/designCond.js 가 소유한다.
// 저장된 값은 사용자가 바꾼 항목만 있어도 되며, getDesign(p) 가 기본값과 병합하고
// 파생값(Ec 자동계산, 지진가속도계수 A, 감소계수 등)을 계산해 돌려준다.
//
// 단위: 강도·탄성계수 MPa, 단위중량 kN/m³, 각도 °(degree), 하중 kN, kN/m², 길이 m (지정 없을 때)
//
// 토압계수 함수 (Rankine / Coulomb / Mononobe-Okabe) 도 여기서 내보낸다.

const RAD = Math.PI / 180;

// ── 선택지 ────────────────────────────────────────────────────────────

export const CODES = ['콘크리트 구조설계기준', '도로교설계기준', '철도교설계기준(철도교편)', '철도교설계기준(노반편)'];
export const KCI = ['KCI2003', 'KCI2007'];
/** 거더검토시 단면력 산정방법 / 전단 검토위치 */
export const GIRDER_METHODS = ['연속보 해석', '계수법 (wL²/n)'];
export const GIRDER_SHEAR_OPTS = ['지점 연단', '지점 연단에서 d 위치'];
export const TOOL2D = ['SAP2000', 'MIDAS', 'ASOLVER'];
export const TOOL3D = ['MIDAS', '해석안함'];
export const EC_FORMULAS = ['8500·∛(fck+8)', 'KCI2007 0.077·mc^1.5·∛fcu', 'KCI2003 0.043·wc^1.5·√fck'];
export const SEIS_METHODS = ['응답변위법', '등가정적하중법', '내진해석 하지않음'];
export const SEIS_PERF = ['붕괴방지', '기능수행', '모두수행'];
export const SEIS_GRADES = ['I 등급', 'II 등급', '특등급'];
export const SEIS_ZONES = ['I 구역', 'II 구역'];
export const ZONE_FACTOR = { 'I 구역': 0.11, 'II 구역': 0.07 };
/** 내진등급 → 위험도계수 (평균재현주기 II:500년 1.0, I:1000년 1.4, 특:2400년 2.0) */
export const RISK_FACTOR = { 'II 등급': 1.0, 'I 등급': 1.4, '특등급': 2.0 };
export const VS_STANDARDS = ['철도설계편람(8편)지하구조물(P8-164)', '지하공동구_내진설계기준(2004,건교부P26)'];
export const CORROSION = ['건조환경', '습윤환경', '부식성환경', '고부식성환경'];
export const EARTH_P = ['정지', '주동', '사용자입력', '(정지+주동)/2'];
export const SITE_CLASSES = [
    { code: 'Sa', name: '경암지반', vs: '1500초과', N: '-', su: '-' },
    { code: 'Sb', name: '보통암지반', vs: '760 에서 1500', N: '-', su: '-' },
    { code: 'Sc', name: '매우조밀한 토사지반 또는 연암지반', vs: '360 에서 760', N: '> 50', su: '> 100' },
    { code: 'Sd', name: '단단한 토사지반', vs: '180 에서 360', N: '15 에서 50', su: '50 에서 100' },
    { code: 'Se', name: '연약한 토사지반', vs: '180미만', N: '< 15', su: '< 50' },
    { code: 'Sf', name: '부지 고유의 특성평가가 요구되는 지반', vs: '', N: '', su: '' },
];
/** 지반종류별 단주기 증폭계수 (근사, 응답변위법 Sv 산정용) */
export const SITE_FA = { Sa: 0.8, Sb: 1.0, Sc: 1.2, Sd: 1.4, Se: 1.7, Sf: 1.7 };

export const LIVE_METHODS = ['상재하중', '이동하중'];
export const LIVE_KINDS = ['도로', '철도', '사용자상재하중'];
export const LIVE_STDS = ['서울지하철공사', '철도교설계기준', '도로설계요령', '편람'];
export const ROAD_GRADES = ['DB24', 'DB18', 'DB13.5'];
export const RAIL_GRADES = ['LS-25', 'LS-22', 'LS-18', 'HL-25', 'EL-18'];
/** 도로 표준트럭 후륜 1개 하중 (kN) */
export const DB_WHEEL = { DB24: 96, DB18: 72, 'DB13.5': 54 };

// ── 철도 표준열차하중 (LS-N: N/18 비례, 매뉴얼 4.1.6 LS-18 예) ──────────

const LS18 = {
    wheels: [
        ['P', 90, 2.4], ['Pd', 180, 1.5], ['Pd', 180, 1.5], ['Pd', 180, 1.5], ['Pd', 180, 2.7],
        ['P', 120, 1.5], ['P', 120, 1.8], ['P', 120, 1.5], ['P', 120, 2.4],
        ['P', 90, 2.4], ['Pd', 180, 1.5], ['Pd', 180, 1.5], ['Pd', 180, 1.5], ['Pd', 180, 2.7],
        ['P', 120, 1.5], ['P', 120, 1.8], ['P', 120, 1.5], ['P', 120, 1.5],
    ],
    front: 0, rear: 60, drive: 180, axle: 1.5, axleMid: 1.5,
};

/** 철도 하중등급의 열차하중 (LS 계열은 LS-18 을 비례 환산, 그 외 근사) */
export function railTrain(grade = 'LS-18') {
    const m = /(\d+(\.\d+)?)/.exec(grade);
    const N = m ? +m[1] : 18;
    const k = N / 18;
    return {
        wheels: LS18.wheels.map(([type, P, d]) => ({ type, P: +(P * k).toFixed(3), d })),
        front: 0, rear: +(LS18.rear * k).toFixed(3), drive: +(LS18.drive * k).toFixed(3), axle: LS18.axle, axleMid: LS18.axleMid,
    };
}

// ── 기본값 ────────────────────────────────────────────────────────────

function seisDefault(u = false) {
    return {
        method: u ? '등가정적하중법' : '응답변위법',
        perf: '붕괴방지',
        grade: 'I 등급',
        adminZone: true,          // 행정구역으로 지진구역 결정 (구역계수 자동)
        zone: 'I 구역',
        zoneFactor: 0.11,
        riskAuto: true,
        riskFactor: 1.4,
        vsStd: VS_STANDARDS[1],
        tgFactor: 1.25,           // 고유주기 할증 (TG = 1.25·TG')
        khRate: 100,              // 등가정적 설계수평지진계수 적용률 (%)
        eqSoil: false,            // 응답변위법 수평토압 적용 (지진시 토압 하중 생성)
    };
}

export const DEFAULT_DESIGN = {
    env: {
        code: CODES[0], kci: 'KCI2007', tool2d: 'SAP2000', tool3d: '해석안함',
        fck: 24, EcAuto: true, ecFormula: EC_FORMULAS[0], Ec: 26986,
        fy: 300, Es: 200000, EsSteel: 81000,
        nuC: 0.17, nuS: 0.40,
        fckRoad: 15, fckBase: 21, fckApproach: 24, fyApproach: 300, fckLean: 15, fckMass: 21,
        gSteel: 77.0, gRC: 24.5, gMortar: 21.5, gBallast: 19.0, gAsphalt: 22.5, gPlain: 23.0, gWater: 10.0,
        phiAuto: true, phiF: 0.85, phiC: 0.70, phiV: 0.75,
        corrosion: '건조환경',
    },
    seisBox: seisDefault(false),
    seisU: seisDefault(true),
    culvert: {
        gFill: 19.0, gFillSub: 10.0, Nfill: 10,
        gBack: 19.0, gBackSub: 10.0, phiBack: 30,
        earthP: '정지', Kuser: 0.5,
        site: 'Sd', bedrock: 20.0,
    },
    wing: {
        gBack: 19.0, phiBack: 30, slope: 0, surcharge: 10.0, liveFactor: 1.6, epFactor: 1.6, earthP: '주동', alpha12: false,
    },
    opt: {
        skew: '고려안함', rigid: true, haunch: true, roadModel: false, traffic: '암거주철근에 직각',
        kvMode: 'Terzaghi 보정식', kvUser: 0, bvDir: '횡방향',
        soil2dStatic: 'Spring', soil2dSeis: 'NLLink', soil3dStatic: 'Spring',
        kvSoil: '사질토층이 우세한 경우', springGap: 500, wallSpringGap: 500, nlFix: 1000,
        hEffTop: true, hEffBot: true, horzCrit: '연단', outerWall: '벽체로 검토', ft: '0.08√fck',
        negMoment: '고려안함', ctcCurve: 'CTC적용', approachShear: '지점에서 d 위치', vcSingle: '1/6√fck',
        minShearWall: true, minShearSlab: true, minShearApp: true, minShearGap: true,
        shearGapWall: true, shearGapSlab: true, shearGapApp: true,
        girderMethod: '연속보 해석', girderShear: '지점 연단에서 d 위치', girderPos: 14, girderNeg: 10, girderV: 1.15,
        pileMode: 'COMB', applyR: false, eqDir: '좌측에서 우측으로 재하',
        railK04: false, railLongWidth: false,
        alphaStatic: 1, alphaSeis: 2, exposedWidth: '2.1m', massBuoy: false, anchorFS: 1.2,
        distBase: '사용철근', pileSoil: false, clayVs: 100,
    },
    ratio: {
        shrink: true,
        slabArea: true, slabMain: false, slabMain20: true, slab300: true,
        wallArea: true, wallMain20: true, wall300: true, wallExposed: false, wall0015: true,
        footArea: true, footMain20: true, foot300: true, foot0015: true,
        wingArea: true, wing300: true, wing0015: true,
    },
    live: {
        method: '상재하중', kind: '도로', std: '도로설계요령', grade: 'DB24', railGrade: 'LS-18',
        vFactor: 1.0, hLive: true, min10: true, userQ: 10.0,
    },
    rail: null,       // null → railTrain(live.railGrade)
    wall: {
        fck: 24, fy: 300,
        gBack: 19.0, phiBack: 30, earthP: '주동',
        kNormal: 'Rankine', kSeis: 'Mononobe Okabe', surFactor: '토압계수',
        delta: { stabN: '0', stabE: '0', wallN: 'Φ/3', wallE: '0' },
        surcharge: 10.0,
        fsOverN: 2.0, fsOverE: 1.5, fsSlideN: 1.5, fsSlideE: 1.2,
        gFound: 19.0, Nfound: 30, cFound: 0, qu: 0, qaMax: 300, qaFormula: 'Hansen', phiFound: 30, gEmbed: 19.0, Df: 1.0,
        foundType: '직접기초', rubbleT: 300,
        heelMoment: '벽체하단의 모멘트적용', shearToe: '저판유효깊이(d)의 1/2 떨어진 지점', shearHeel: '저판벽체연단지점',
        shear: { toe: { gap: true, min: true }, heel: { gap: true, min: true }, wall: { gap: true, min: true }, key: { gap: true, min: true } },
        ratioWall: 0.0015, ratioFoot: 0.0015,
    },
};

// ── 계산 함수 ─────────────────────────────────────────────────────────

/** 콘크리트 탄성계수 (MPa). wc: 무근콘크리트 단위중량 (kN/m³) */
export function calcEc(fck, formula = EC_FORMULAS[0], wc = 23.0) {
    fck = +fck || 0;
    const mc = wc * 100;   // kN/m³ → kg/m³ (근사 ×100)
    if (formula === EC_FORMULAS[1]) {
        const df = fck <= 40 ? 4 : fck >= 60 ? 6 : 4 + (fck - 40) / 10;
        return Math.round(0.077 * Math.pow(mc, 1.5) * Math.cbrt(fck + df));
    }
    if (formula === EC_FORMULAS[2]) return Math.round(0.043 * Math.pow(mc, 1.5) * Math.sqrt(fck));
    return Math.round(8500 * Math.cbrt(fck + 8));
}

/** 강도감소계수 기본값 */
export function defaultPhi(kci) {
    return kci === 'KCI2003' ? { phiF: 0.85, phiC: 0.70, phiV: 0.80 } : { phiF: 0.85, phiC: 0.65, phiV: 0.75 };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function merge(base, over) {
    if (!isObj(over)) return base === undefined ? over : (over === undefined ? base : over);
    const out = { ...(isObj(base) ? base : {}) };
    for (const [k, v] of Object.entries(over)) {
        out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : (v === undefined ? out[k] : v);
    }
    return out;
}

/** 기본값 (깊은 복사) */
export function defaultDesign() {
    return JSON.parse(JSON.stringify(DEFAULT_DESIGN));
}

/**
 * 설계조건 (기본값 병합 + 파생값).
 * 반환값의 추가 필드:
 *   env.Ec           자동계산 시 calcEc 결과
 *   env.phi*         phiAuto 이면 KCI 기준값
 *   seisBox/seisU.A  지진가속도계수 = 구역계수 × 위험도계수
 *   rail             철도 열차하중 (rail 이 없으면 하중등급으로 생성)
 *   rebarMark        'D' (fy<400) | 'H'
 */
export function getDesign(p) {
    const d = merge(defaultDesign(), (p && p.design) || {});
    const e = d.env;
    if (e.EcAuto !== false) e.Ec = calcEc(e.fck, e.ecFormula, e.gPlain);
    if (e.phiAuto !== false) Object.assign(e, defaultPhi(e.kci));
    for (const k of ['seisBox', 'seisU']) {
        const s = d[k];
        if (s.adminZone !== false) s.zoneFactor = ZONE_FACTOR[s.zone] ?? s.zoneFactor;
        if (s.riskAuto !== false) s.riskFactor = RISK_FACTOR[s.grade] ?? s.riskFactor;
        s.A = +(s.zoneFactor * s.riskFactor).toFixed(4);
        s.on = s.method !== '내진해석 하지않음';
    }
    if (!d.rail || !Array.isArray(d.rail.wheels)) d.rail = railTrain(d.live.railGrade);
    d.rebarMark = e.fy >= 400 ? 'H' : 'D';
    d.isRailCode = /철도/.test(e.code);
    return d;
}

/** 단면 형식(BOX/U)에 맞는 내진 조건 */
export function seisFor(d, kind) {
    return kind === 'U' ? d.seisU : d.seisBox;
}

/** 내진 성능목표 → 지진 조합 종류 */
export function seisKinds(d, kind = 'BOX') {
    const s = seisFor(d, kind);
    if (!s || !s.on) return [];
    if (s.perf === '붕괴방지') return ['eqCollapse'];
    if (s.perf === '기능수행') return ['eqFunction'];
    return ['eqCollapse', 'eqFunction'];
}

// ── 토압계수 ──────────────────────────────────────────────────────────

/** 정지토압계수 K0 = 1 − sinφ (Jaky) */
export function K0(phi) { return 1 - Math.sin(phi * RAD); }

/** Rankine 주동토압계수 (배면경사 β) */
export function KaRankine(phi, beta = 0) {
    const p = phi * RAD, b = beta * RAD;
    if (!beta) return Math.tan(Math.PI / 4 - p / 2) ** 2;
    const cb = Math.cos(b), cp = Math.cos(p);
    const r = Math.sqrt(Math.max(0, cb * cb - cp * cp));
    return cb * (cb - r) / (cb + r);
}

/** Rankine 수동토압계수 */
export function KpRankine(phi) { return Math.tan(Math.PI / 4 + phi * RAD / 2) ** 2; }

/**
 * Coulomb 주동토압계수.
 * phi 내부마찰각, delta 벽면마찰각, beta 배면경사, theta 벽면의 연직에 대한 경사 (모두 °)
 */
export function KaCoulomb(phi, delta = 0, beta = 0, theta = 0) {
    const p = phi * RAD, d = delta * RAD, b = beta * RAD, t = theta * RAD;
    const num = Math.cos(p - t) ** 2;
    const s = Math.sqrt(Math.max(0, Math.sin(p + d) * Math.sin(p - b) / (Math.cos(d + t) * Math.cos(t - b))));
    return num / (Math.cos(t) ** 2 * Math.cos(d + t) * (1 + s) ** 2);
}

/**
 * Mononobe-Okabe 지진시 주동토압계수 KAE.
 * kh, kv: 수평/연직 지진계수
 */
export function KaeMO(phi, delta = 0, beta = 0, theta = 0, kh = 0, kv = 0) {
    const p = phi * RAD, d = delta * RAD, b = beta * RAD, t = theta * RAD;
    const psi = Math.atan(kh / (1 - kv));
    if (p - psi - b < 0) return NaN;   // 지진각이 너무 큼
    const num = Math.cos(p - t - psi) ** 2;
    const s = Math.sqrt(Math.max(0, Math.sin(p + d) * Math.sin(p - psi - b) / (Math.cos(d + t + psi) * Math.cos(b - t))));
    return num / (Math.cos(psi) * Math.cos(t) ** 2 * Math.cos(d + t + psi) * (1 + s) ** 2);
}

/**
 * 암거 측벽 적용 토압계수 (설계조건 ▸ 암거 ▸ 적용토압)
 * 반환 { K, K0, Ka, label }
 */
export function culvertK(d) {
    const cu = d.culvert;
    const k0 = K0(cu.phiBack), ka = KaRankine(cu.phiBack);
    let K = k0, label = `K0 = 1 − sin${cu.phiBack}° = ${k0.toFixed(3)}`;
    if (cu.earthP === '주동') { K = ka; label = `Ka = tan²(45° − ${cu.phiBack}°/2) = ${ka.toFixed(3)}`; }
    else if (cu.earthP === '사용자입력') { K = +cu.Kuser || 0; label = `K = ${K.toFixed(3)} (사용자입력)`; }
    else if (cu.earthP === '(정지+주동)/2') { K = (k0 + ka) / 2; label = `K = (K0 + Ka)/2 = (${k0.toFixed(3)} + ${ka.toFixed(3)})/2 = ${K.toFixed(3)}`; }
    return { K, K0: k0, Ka: ka, label };
}

/** 벽면마찰각 선택값 ('0' | 'Φ/3' | 'Φ/2' | '2Φ/3') → ° */
export function deltaValue(sel, phi) {
    switch (sel) {
        case 'Φ/3': return phi / 3;
        case 'Φ/2': return phi / 2;
        case '2Φ/3': return phi * 2 / 3;
        default: return 0;
    }
}

export const DELTA_OPTIONS = ['0', 'Φ/3', 'Φ/2', '2Φ/3'];

/** 저장값 + 기본값 병합 (파생값 없이) — 화면 기본값 채우기용 */
export function designRaw(p) {
    return merge(defaultDesign(), (p && p.design) || {});
}
