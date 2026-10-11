// pile.js - 말뚝기초 기본 계산 (일반 입력 > 기초부 설정 > 말뚝기초/말뚝제원/말뚝특성치)
//
// 참고: 도로교설계기준 해설(2008) 5.8 말뚝기초의 설계
//   Ru = qd·Ap + U·Σ(Li·fi),  qd = (계수, 기본 300) × N
//   Ra = Ru/3 (평상시), Ru/2 (지진시)
//   허용인발력 Pa = U·Σ(Li·fi)/6 (평상시), /3 (지진시)  — 주면마찰력 고려시
//   Kv = a·Ap·Ep/L,  a = 0.014(L/D)+0.78 (타입강관) ...
//   Kh: kH0 = (1/0.3)·α·Eo, BH = √(D/β), kH = kH0·(BH/0.3)^(-3/4), β = ⁴√(kH·D/(4EI)) — 1/β 반복
//
// 단위: 입력 mm → 계산 m, kN

export const PILE_TYPES = ['타입강관말뚝', '매입강관말뚝', 'PHC말뚝', '현장타설말뚝'];
export const PILE_METHODS = ['타입말뚝(타격공법)', '매입말뚝(최종경타)', '매입말뚝(시멘트풀주입)', '현장타설말뚝'];

/** 말뚝 종류별 기본 제원 (mm) */
export function defaultPileSpec(kind = '타입강관말뚝') {
    if (kind === '현장타설말뚝') return { D: 1000, L: 10000, t: 0, corr: 0, Df: 1000, h: 0, autoN: true, Nhead: 10, Ntip: 30, headDia: 'D25', headEa: 12, virtualRC: false };
    if (kind === 'PHC말뚝') return { D: 500, L: 10000, t: 80, corr: 0, Df: 1000, h: 0, autoN: true, Nhead: 10, Ntip: 30, headDia: 'D19', headEa: 6, virtualRC: false };
    return { D: 508, L: 10000, t: 12, corr: 2, Df: 1000, h: 0, autoN: true, Nhead: 10, Ntip: 30, headDia: 'D19', headEa: 8, virtualRC: false };
}

/** 탄성계수 Ep (kN/m²) */
export function pileModulus(kind, fck = 24) {
    if (kind === 'PHC말뚝') return 40000e3;
    if (kind === '현장타설말뚝') return 8500 * Math.cbrt((+fck || 24) + 4) * 1e3;
    return 210000e3;
}

/** 단면 성질 (m) */
export function pileSection(kind, spec) {
    const D = (+spec.D || 0) / 1000;
    const solid = kind === '현장타설말뚝';
    const corr = solid ? 0 : (+spec.corr || 0) / 1000;
    const t = solid ? D / 2 : (+spec.t || 0) / 1000;
    const Do = D - 2 * corr;                          // 부식 고려 외경
    const Di = solid ? 0 : Math.max(0, D - 2 * t);     // 내경
    const A = Math.PI / 4 * (Do * Do - Di * Di);       // 순단면적
    const I = Math.PI / 64 * (Do ** 4 - Di ** 4);
    const Atip = Math.PI / 4 * Do * Do;                // 선단 폐색 면적 (부식 고려 외경)
    const U = Math.PI * Do;                            // 주면장
    return { D, Do, Di, A, I, Atip, U, solid };
}

/** 축방향 스프링정수 계수 a */
export function kvFactor(kind, L, D) {
    const r = L / D;
    switch (kind) {
        case 'PHC말뚝': return 0.013 * r + 0.61;
        case '매입강관말뚝': return 0.010 * r + 0.36;
        case '현장타설말뚝': return Math.max(0.1, 0.031 * r - 0.15);
        default: return 0.014 * r + 0.78;
    }
}

/** 최대 주면마찰력 f (kN/m²) — 토질분류/N */
export function skinFriction(kind, soil, N, bentonite = false) {
    if (!(N > 2)) return 0;                          // N≤2 의 지반에는 주면마찰력을 고려하지 않는다
    if (kind === '현장타설말뚝') {
        if (soil === '점성토') return Math.min(150, 10 * N);
        return Math.min(200, (bentonite ? 2 : 5) * N);
    }
    if (soil === '점성토') return Math.min(150, 10 * N);
    return Math.min(100, 2 * N);
}

/**
 * 허용지지력 / 인발력
 * inp = { kind, spec, coef(qd 계수), friction(bool), group(bool), bentonite, layers:[{soil, N, len(m)}], spacing(m), W(말뚝자중 kN) }
 */
export function pileCapacity(inp) {
    const kind = inp.kind || '타입강관말뚝';
    const sec = pileSection(kind, inp.spec);
    const Ntip = Math.min(50, +inp.spec.Ntip || 0);
    const qd = (+inp.coef || 300) * Ntip;
    const tip = qd * sec.Atip;
    const rows = [];
    let fr = 0;
    if (inp.friction) {
        for (const ly of inp.layers || []) {
            const f = skinFriction(kind, ly.soil, ly.N, inp.bentonite);
            const v = sec.U * f * ly.len;
            rows.push({ U: sec.U, N: ly.N, soil: ly.soil, len: ly.len, f, v });
            fr += v;
        }
    }
    const Ru = tip + fr;
    const W = +inp.W || 0;
    let RaN = Ru / 3, RaE = Ru / 2;
    let groupNote = null;
    const D = sec.D;
    if (inp.group && inp.spacing > 0 && inp.spacing < 3 * D) {
        // 무리말뚝: 단순 효율 (Converse-Labarre 근사, 2열 가정)
        const th = Math.atan(D / inp.spacing) * 180 / Math.PI;
        const eff = Math.max(0.5, 1 - th * ((2 - 1) * 2 + (2 - 1) * 2) / (90 * 2 * 2));
        RaN *= eff; RaE *= eff;
        groupNote = { eff, th };
    }
    const PaN = fr / 6 + W, PaE = fr / 3 + W;
    return { kind, sec, Ntip, qd, tip, fr, rows, Ru, RaN, RaE, PaN, PaE, groupNote };
}

/** 말뚝 특성치 (Kv, Kh, β) */
export function pileProperties(inp) {
    const kind = inp.kind || '타입강관말뚝';
    const sec = pileSection(kind, inp.spec);
    const L = Math.max(0.1, ((+inp.spec.L || 0) - 100) / 1000);   // 기초에 묻힌 100mm 제외
    const Ep = pileModulus(kind, inp.fck);
    const a = kvFactor(kind, L, sec.Do);
    const Kv = a * sec.A * Ep / L;
    const Eo = +inp.EoDirect > 0 ? +inp.EoDirect : (+inp.EoMult || 2800) * (+inp.spec.Nhead || 0);
    const EI = Ep * sec.I;
    const solve = (alpha) => {
        const kH0 = (1 / 0.3) * alpha * Eo;
        let invB = sec.Do;
        const iter = [];
        let kH = 0, beta = 0;
        for (let k = 0; k < 50; k++) {
            const BH = Math.sqrt(sec.Do * invB);
            kH = kH0 * Math.pow(BH / 0.3, -0.75);
            beta = Math.pow(kH * sec.Do / (4 * EI), 0.25);
            const calc = 1 / beta;
            iter.push({ assumed: invB, calc, kH });
            if (Math.abs(calc - invB) < 5e-4) break;
            invB = calc;
        }
        return { kH0, kH, beta, iter, betaL: beta * L };
    };
    const n = solve(+inp.alphaN || 1), e = solve(+inp.alphaE || 2);
    return { kind, sec, L, Ep, a, Kv, Eo, EI, normal: n, seismic: e };
}

/** 말뚝 배치 기본값: 폭 W(mm) × 길이 L(mm) */
export function defaultPileLayout(D, W, L) {
    const S = Math.ceil(3 * D / 10) * 10;          // 3D 이상
    const edge = Math.max(Math.ceil(1.25 * D / 10) * 10, 500);
    const nT = Math.max(2, Math.floor((W - 2 * edge) / S + 1e-9) + 1);
    const eT = Math.round((W - (nT - 1) * S) / 2);
    const SL = Math.ceil(2.7 * D / 10) * 10;
    const nL = Math.max(1, Math.floor((L - 2 * edge) / SL + 1e-9) + 1);
    const eL = Math.round((L - (nL - 1) * SL) / 2);
    const cols = Array.from({ length: nL }, (_, i) => ({
        dist: i === 0 ? eL : SL,
        n: nT,
        D: Array.from({ length: nT }, (_, k) => (k === 0 ? eT : S)),
        len: 10000,
        A: Array.from({ length: nT }, () => 0),
        lens: Array.from({ length: nT }, () => 10000),
    }));
    return { cols };
}
