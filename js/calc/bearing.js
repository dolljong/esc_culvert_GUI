// bearing.js - 직접기초 허용지지력 자동계산 (일반 입력 > 기초부 설정 > 기초지반)
//
// 참고: 구조물기초설계기준 해설(한국지반공학회 2008) 4.2 지지력산정,
//       도로교설계기준 해설(2008) 5.6.4.1 허용연직지지력
// 허용지지력 qa = qu / FS  (FS = 3 평상시, 2 지진시), 상한값(기본 600 kN/m²) 이하.
//
// 단위: B, L, Df m / γ kN/m³ / c kN/m² / q kN/m²

export const BEARING_METHODS = ['Terzaghi 식', 'Meyerhof 식', 'Hansen 식'];
export const FS_NORMAL = 3;
export const FS_SEISMIC = 2;

const rad = (d) => d * Math.PI / 180;

/** N 값 → 내부마찰각 φ (°) : φ = √(15N) + 15 ≤ 45 (도로교설계기준 해설) */
export function phiFromN(N) {
    if (!(N > 0)) return 0;
    return Math.min(45, Math.sqrt(15 * N) + 15);
}

/** 지지력계수 {Nc, Nq, Ng} */
export function bearingFactors(phiDeg, method = 'Hansen 식') {
    const f = rad(phiDeg);
    if (method.startsWith('Terzaghi')) {
        if (phiDeg < 1e-6) return { Nc: 5.7, Nq: 1.0, Ng: 0 };
        const a = Math.exp((0.75 * Math.PI - f / 2) * Math.tan(f));
        const Nq = a * a / (2 * Math.cos(rad(45) + f / 2) ** 2);
        const Nc = (Nq - 1) / Math.tan(f);
        const Ng = 2 * (Nq + 1) * Math.tan(f) / (1 + 0.4 * Math.sin(4 * f));   // Coduto 근사
        return { Nc, Nq, Ng };
    }
    if (phiDeg < 1e-6) return { Nc: 5.14, Nq: 1.0, Ng: 0 };
    const Nq = Math.exp(Math.PI * Math.tan(f)) * Math.tan(rad(45) + f / 2) ** 2;
    const Nc = (Nq - 1) / Math.tan(f);
    const Ng = method.startsWith('Meyerhof') ? (Nq - 1) * Math.tan(1.4 * f) : 1.5 * (Nq - 1) * Math.tan(f);
    return { Nc, Nq, Ng };
}

/**
 * 극한지지력 qu (kN/m²)
 * inp = { method, B, L, Df, g1 (기초지반 γ), g2 (근입지반 γ), c, phi }
 */
export function ultimateBearing(inp) {
    const method = inp.method || 'Hansen 식';
    const B = Math.max(0.01, +inp.B || 0), L = Math.max(B, +inp.L || B);
    const Df = Math.max(0, +inp.Df || 0), g1 = +inp.g1 || 0, g2 = +inp.g2 || 0, c = +inp.c || 0, phi = +inp.phi || 0;
    const { Nc, Nq, Ng } = bearingFactors(phi, method);
    const q = g2 * Df;
    const r = B / L;
    let sc = 1, sq = 1, sg = 1, dc = 1, dq = 1, dg = 1, terms;
    if (method.startsWith('Terzaghi')) {
        // 도로교설계기준 형상계수: α = 1 + 0.3 B/L, β = 0.5 - 0.1 B/L
        const alpha = 1 + 0.3 * r, beta = 0.5 - 0.1 * r;
        terms = { c: alpha * c * Nc, g: beta * g1 * B * Ng, q: q * Nq };
        sc = alpha; sg = beta * 2;
    } else if (method.startsWith('Meyerhof')) {
        const Kp = Math.tan(rad(45 + phi / 2)) ** 2;
        sc = 1 + 0.2 * Kp * r;
        dc = 1 + 0.2 * Math.sqrt(Kp) * Df / B;
        if (phi > 10) { sq = sg = 1 + 0.1 * Kp * r; dq = dg = 1 + 0.1 * Math.sqrt(Kp) * Df / B; }
        terms = { c: c * Nc * sc * dc, q: q * Nq * sq * dq, g: 0.5 * g1 * B * Ng * sg * dg };
    } else {
        // Hansen
        const k = Df / B <= 1 ? Df / B : Math.atan(Df / B);
        sc = 1 + (Nq / Nc) * r;
        sq = 1 + r * Math.tan(rad(phi));
        sg = Math.max(0.6, 1 - 0.4 * r);
        dc = 1 + 0.4 * k;
        dq = 1 + 2 * Math.tan(rad(phi)) * (1 - Math.sin(rad(phi))) ** 2 * k;
        dg = 1;
        terms = { c: c * Nc * sc * dc, q: q * Nq * sq * dq, g: 0.5 * g1 * B * Ng * sg * dg };
    }
    const qu = terms.c + terms.q + terms.g;
    return { method, B, L, Df, g1, g2, c, phi, Nc, Nq, Ng, sc, sq, sg, dc, dq, dg, terms, qu };
}

/**
 * 허용지지력 (평상시/지진시) — 상한값 적용
 * 반환 { ...ultimate, qaN, qaE, qaNraw, qaEraw, cap, capped }
 */
export function allowableBearing(inp) {
    const u = ultimateBearing(inp);
    const cap = inp.cap > 0 ? +inp.cap : Infinity;
    const qaNraw = u.qu / FS_NORMAL, qaEraw = u.qu / FS_SEISMIC;
    return {
        ...u, cap, qaNraw, qaEraw,
        qaN: Math.min(cap, qaNraw), qaE: Math.min(cap, qaEraw),
        capped: qaNraw > cap || qaEraw > cap,
    };
}

/** 수직 지반변형계수 Eo (kN/m²): 직접값 > 0 이면 그 값, 0 이면 계수 × N */
export function deformationModulus(direct, mult, N) {
    if (+direct > 0) return +direct;
    return (+mult || 2800) * (+N || 0);
}

/**
 * 연직 지반반력계수 kv (kN/m³) — 도로교설계기준 해설 5.6
 * kv = kv0 (Bv/0.3)^(-3/4), kv0 = (1/0.3) α Eo, Bv = √Av
 */
export function verticalSubgrade(Eo, B, L, alpha = 1) {
    const kv0 = (1 / 0.3) * alpha * Eo;
    const Bv = Math.sqrt(Math.max(1e-6, B * L));
    return kv0 * Math.pow(Bv / 0.3, -0.75);
}
