// rcDesign.js - 철근콘크리트 단면검토 (강도설계법, 콘크리트구조설계기준 KCI 2003 / 2007)
//
// 단위: mm, N, MPa (모멘트 N·mm). 편의 함수는 kN, kN·m 도 받는다.
// 암거 부재는 단위폭 b = 1000 mm 단면으로 검토한다.

export const ES = 200000;

/** β1 (등가응력블록) */
export function beta1(fck) {
    if (fck <= 28) return 0.85;
    return Math.max(0.65, 0.85 - 0.007 * (fck - 28));
}

/** 콘크리트 탄성계수 (MPa). code: 'KCI2003' | 'KCI2007', wc kN/m³ */
export function concreteEc(fck, code = 'KCI2007', wc = 23) {
    const m = wc * 1000 / 9.81;   // kg/m³ 근사
    if (code === 'KCI2003') return 0.043 * Math.pow(m, 1.5) * Math.sqrt(fck);   // 보통중량 ≈ 4700√fck
    const df = fck <= 40 ? 4 : fck >= 60 ? 6 : 4 + (fck - 40) / 10;
    return 0.077 * Math.pow(m, 1.5) * Math.cbrt(fck + df);   // KCI 2007
}

/** 휨 강도감소계수 φ */
export function phiFlexure(code, et, fy) {
    if (code === 'KCI2003') return 0.85;
    const ey = fy / ES;
    if (et >= 0.005) return 0.85;
    if (et <= ey) return 0.65;
    return 0.65 + (et - ey) * (0.85 - 0.65) / (0.005 - ey);
}

/**
 * 단철근(+압축철근) 직사각형 휨강도.
 * s = { b, h, d, As, dc?, Asc?, fck, fy, code }
 */
export function flexure(s) {
    const { b, d, As, fck, fy } = s;
    const code = s.code || 'KCI2007';
    const b1 = beta1(fck);
    const a = As * fy / (0.85 * fck * b);
    const c = a / b1;
    const et = c > 0 ? 0.003 * (d - c) / c : 1;
    const Mn = As * fy * (d - a / 2);
    const phi = phiFlexure(code, et, fy);
    const rho = As / (b * d);
    const rhoMin = Math.max(0.25 * Math.sqrt(fck) / fy, 1.4 / fy);
    const rhoB = 0.85 * b1 * fck / fy * 600 / (600 + fy);
    const rhoMax = code === 'KCI2003' ? 0.75 * rhoB : (0.85 * b1 * fck / fy) * (0.003 / (0.003 + 0.004));
    return { a, c, et, Mn, phi, phiMn: phi * Mn, rho, rhoMin, rhoMax, rhoB };
}

/** 필요 철근량 (Mu: N·mm) */
export function requiredAs(s, Mu) {
    const { b, d, fck, fy } = s;
    const phi = 0.85;
    const Rn = Mu / (phi * b * d * d);
    const disc = 1 - 2 * Rn / (0.85 * fck);
    if (disc <= 0) return Infinity;
    const rho = 0.85 * fck / fy * (1 - Math.sqrt(disc));
    return rho * b * d;
}

/**
 * 축력-휨 단면 (대칭 아님 허용): 변형률 적합.
 * s = { b, h, fck, fy, code, layers: [{ As, d }] }  (d: 압축연단에서 철근까지)
 * Pu 압축 + (N), Mu (N·mm, 압축연단 쪽 압축이 + )
 * 반환: 같은 편심에서의 φPn, φMn 과 안전율
 */
export function pmCheck(s, Pu, Mu) {
    const { b, h, fck, fy } = s;
    const code = s.code || 'KCI2007';
    const b1 = beta1(fck);
    const layers = s.layers;
    const dt = Math.max(...layers.map(l => l.d));
    const capacity = (c) => {
        const a = Math.min(b1 * c, h);
        const Cc = 0.85 * fck * a * b;
        let P = Cc, M = Cc * (h / 2 - a / 2);
        for (const l of layers) {
            const es = 0.003 * (c - l.d) / c;
            let fs = Math.max(-fy, Math.min(fy, es * ES));
            if (l.d < a) fs -= 0.85 * fck;   // 압축철근 위치 콘크리트 중복 제거
            P += fs * l.As;
            M += fs * l.As * (h / 2 - l.d);
        }
        const et = 0.003 * (dt - c) / c;
        let phi;
        if (code === 'KCI2003') {
            // 2003: 0.70 (띠철근) ~ 0.85 선형 (0.1 fck Ag 이하에서 증가)
            const P0 = 0.1 * fck * b * h;
            phi = P <= 0 ? 0.85 : P >= P0 ? 0.70 : 0.85 - 0.15 * P / P0;
        } else {
            phi = et >= 0.005 ? 0.85 : et <= fy / ES ? 0.65 : 0.65 + (et - fy / ES) * 0.2 / (0.005 - fy / ES);
        }
        return { P, M, phi, et, c };
    };
    const Ag = b * h;
    const AsT = layers.reduce((a, l) => a + l.As, 0);
    const P0 = 0.85 * fck * (Ag - AsT) + fy * AsT;
    const PnMax = 0.80 * P0;
    // 편심 e = Mu/Pu, 중립축 c 를 이분탐색하여 M/P = e
    const e = Pu !== 0 ? Math.abs(Mu / Pu) : Infinity;
    let best;
    if (!isFinite(e) || e > 1e7) {
        // 순수 휨: P = 0 인 c 탐색
        let lo = 1e-3, hi = h * 2;
        for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (capacity(mid).P > 0) hi = mid; else lo = mid; }
        best = capacity((lo + hi) / 2);
    } else {
        let lo = 1e-3, hi = h * 10;
        const f = (c) => { const r = capacity(c); return r.M - e * r.P; };
        // f 는 c 증가에 따라 감소
        for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
        best = capacity((lo + hi) / 2);
    }
    let phiPn = best.phi * Math.min(best.P, PnMax);
    let phiMn = best.phi * best.M * (best.P > PnMax ? PnMax / best.P : 1);
    if (Pu <= 0) phiPn = best.phi * best.P;
    const sf = Math.abs(Mu) > 1e-6 ? phiMn / Math.abs(Mu) : (Pu > 0 ? phiPn / Pu : Infinity);
    return { phiPn, phiMn, phi: best.phi, c: best.c, et: best.et, PnMax, P0, sf, ok: sf >= 1 };
}

/** P-M 상관도 점들 [{P, M, phiP, phiM}] (N, N·mm) — 중립축 c 를 변화시켜 계산 */
export function pmCurve(s, n = 40) {
    const out = [];
    const { h } = s;
    for (let k = 0; k <= n; k++) {
        const c = 1 + (h * 4) * Math.pow(k / n, 2);
        const e = 1e9;
        void e;
        const r = pmAtC(s, c);
        out.push(r);
    }
    return out;
}

function pmAtC(s, c) {
    const { b, h, fck, fy } = s;
    const b1 = beta1(fck);
    const a = Math.min(b1 * c, h);
    const Cc = 0.85 * fck * a * b;
    let P = Cc, M = Cc * (h / 2 - a / 2);
    for (const l of s.layers) {
        const es = 0.003 * (c - l.d) / c;
        let fs = Math.max(-fy, Math.min(fy, es * ES));
        if (l.d < a) fs -= 0.85 * fck;
        P += fs * l.As; M += fs * l.As * (h / 2 - l.d);
    }
    const dt = Math.max(...s.layers.map(l => l.d));
    const et = 0.003 * (dt - c) / c;
    const phi = phiFlexure(s.code || 'KCI2007', et, fy);
    return { c, P, M, phi, phiP: phi * P, phiM: phi * M };
}

/**
 * 전단 (KCI): Vc = 1/6 (1 + Nu/(14Ag)) √fck b d, φ = 0.75(2007) / 0.80(2003)
 * opts.coef: 1/6 또는 0.25 (1련 암거 슬래브 옵션)
 */
export function shear(s, Vu, Nu = 0, opts = {}) {
    const { b, h, d, fck } = s;
    const code = s.code || 'KCI2007';
    const phi = code === 'KCI2003' ? 0.80 : 0.75;
    const coef = opts.coef || 1 / 6;
    const Ag = b * h;
    const axial = Nu > 0 ? 1 + Nu / (14 * Ag) : Math.max(0, 1 + 0.3 * Nu / Ag);
    const Vc = coef * axial * Math.sqrt(fck) * b * d;
    let Vs = 0;
    if (opts.Av && opts.s) Vs = opts.Av * (opts.fyt || s.fy) * d / opts.s;
    const phiVn = phi * (Vc + Vs);
    const needStirrup = Vu > phi * Vc / 2;
    return { Vc, Vs, phi, phiVc: phi * Vc, phiVn, sf: Vu > 0 ? phiVn / Vu : Infinity, ok: phiVn >= Vu, needStirrup };
}

/** 사용하중 균열단면 응력 (단철근, 휨 + 축력 무시). M: N·mm */
export function serviceStress(s, M) {
    const { b, d, As, fck } = s;
    const Ec = s.Ec || concreteEc(fck, s.code);
    const n = Math.max(6, Math.round(ES / Ec));
    const rho = As / (b * d);
    const k = Math.sqrt(2 * rho * n + (rho * n) ** 2) - rho * n;
    const x = k * d;
    const j = 1 - k / 3;
    const fs = Math.abs(M) / (As * j * d);
    const fc = 2 * Math.abs(M) / (b * x * j * d);
    return { n, k, x, j, fs, fc };
}

/**
 * 균열검토.
 * KCI2007: 철근간격 s ≤ 375(κcr/fs) - 2.5cc 및 ≤ 300(κcr/fs), κcr = 280(건조) / 210(그외)
 * KCI2003: w = 1.08 βc fs ∛(dc·A) ×1e-5 ≤ wa (환경별 허용균열폭)
 * s = { b, d, h, As, fck, fy, code, cover(cc: 표면~철근표면), dc(표면~철근중심), spacing, env }
 */
export function crack(s, Ms) {
    const code = s.code || 'KCI2007';
    const st = serviceStress(s, Ms);
    const fs = Math.min(st.fs, 2 / 3 * s.fy) || 2 / 3 * s.fy;
    const env = s.env || '건조';
    if (code === 'KCI2007') {
        const kcr = env === '건조' ? 280 : 210;
        const cc = s.cover;
        const s1 = 375 * (kcr / fs) - 2.5 * cc;
        const s2 = 300 * (kcr / fs);
        const sAllow = Math.min(s1, s2);
        return { method: '간격', fs, kcr, sAllow, s: s.spacing, ok: s.spacing <= sAllow, ...st };
    }
    const tc = s.cover;
    const ratio = { 건조: 0.006, 습윤: 0.005, 부식성: 0.004, 고부식성: 0.0035 }[env] || 0.005;
    const wa = ratio * tc;
    const dc = s.dc;
    const bars = 1000 / s.spacing;
    const A = 2 * dc * s.b / bars;
    const betac = (s.h - st.x) / (s.d - st.x);
    const w = 1.08 * betac * fs * Math.cbrt(dc * A) * 1e-5;
    return { method: '균열폭', fs, w, wa, ok: w <= wa, betac, ...st };
}

/** 수축·온도 철근비 (fy 400 이하 0.0020, 초과 0.0018×400/fy, 최소 0.0014) */
export function shrinkageRatio(fy) {
    if (fy <= 400) return 0.002;
    return Math.max(0.0014, 0.0018 * 400 / fy);
}

/** kN, kN·m, mm 입력 편의 함수 */
export function checkMember({ b = 1000, h, d, As, Asc = 0, dc2 = 0, fck, fy, code, Mu, Pu = 0, Vu = 0, Ms = 0, cover, dc, spacing, env }) {
    const sec = { b, h, d, As, fck, fy, code };
    const fl = flexure(sec);
    const MuN = Math.abs(Mu) * 1e6;
    const PuN = Pu * 1e3;
    let pm = null;
    if (Math.abs(Pu) > 1e-6) {
        pm = pmCheck({ b, h, fck, fy, code, layers: [{ As, d }, ...(Asc > 0 ? [{ As: Asc, d: dc2 }] : [])] }, PuN, MuN);
    }
    const sh = shear(sec, Vu * 1e3, PuN);
    const cr = Ms ? crack({ ...sec, cover, dc, spacing, env }, Math.abs(Ms) * 1e6) : null;
    const phiMn = pm ? pm.phiMn : fl.phiMn;
    return {
        flexure: fl, pm, shear: sh, crack: cr,
        phiMn_kNm: phiMn / 1e6, sfM: MuN > 0 ? phiMn / MuN : Infinity,
        okM: phiMn >= MuN, okRho: fl.rho >= Math.min(fl.rhoMin, 4 / 3 * requiredAs(sec, MuN) / (b * d)) && fl.rho <= fl.rhoMax,
        phiVn_kN: sh.phiVn / 1e3, okV: sh.ok,
        AsReq: requiredAs(sec, MuN),
    };
}
