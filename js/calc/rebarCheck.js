// rebarCheck.js - 배근 입력 화면의 간이 설계검토 (주철근 휨 / 수평철근 철근량)
//
// 강도설계법, 단위폭 b = 1000 mm. 단위: mm, N, MPa → 결과 모멘트 kN·m.
// rcDesign.js 의 flexure(s) 가 있으면 opts.flexure 로 넘겨 그것을 쓰고, 없으면 내부 식을 쓴다.
// 부재력(Mu)은 선택: opts.moment(pos) → kN·m (없으면 안전도 '-').

import { mainBarLayout, materials, checkPositions, steelAt, memberThickness, barArea } from './rebar.js';

/** 단철근 직사각형 휨강도 (KCI 2007: 인장지배 φ, ρmax = εt 0.004) */
export function simpleFlexure({ b = 1000, d, As, fck, fy, phi = 0.85 }) {
    const b1 = fck <= 28 ? 0.85 : Math.max(0.65, 0.85 - 0.007 * (fck - 28));
    const a = As * fy / (0.85 * fck * b);
    const Mn = As * fy * (d - a / 2);
    const rho = As / (b * d);
    const rhoMin = Math.max(0.25 * Math.sqrt(fck) / fy, 1.4 / fy);
    const rhoMax = 0.85 * b1 * fck / fy * (0.003 / (0.003 + 0.004));
    return { a, Mn, phi, phiMn: phi * Mn, rho, rhoMin, rhoMax };
}

/**
 * 주철근 설계검토 표.
 * opts: { cycles, zone, flexure (rcDesign.flexure), moment(pos) → kN·m | null }
 * 반환: [{ title, label, member, face, h, d, As, rho, rhoMin, rhoMax, okRho, phiMn (kN·m), Mu, sf, okM }]
 */
export function mainFlexureCheck(p, c, bi, opts = {}) {
    const lay = opts.layout || mainBarLayout(p, c, bi, { cycles: opts.cycles, zone: opts.zone });
    const { fck, fy, code, phiF } = materials(p);
    const rows = [];
    for (const pos of checkPositions(lay.g)) {
        const h = memberThickness(lay.g, pos.member);
        const st = steelAt(lay, pos.member, pos.face, pos.s);
        const d = h - st.cover;
        let r;
        if (opts.flexure) {
            const f = opts.flexure({ b: 1000, h, d, As: st.As, fck, fy, code });
            r = { rho: f.rho, rhoMin: f.rhoMin, rhoMax: f.rhoMax, phiMn: f.phiMn };
        } else r = simpleFlexure({ d, As: st.As, fck, fy, phi: phiF });
        let Mu = null;
        try { Mu = opts.moment ? opts.moment(pos) : null; } catch { Mu = null; }
        const phiMn = r.phiMn / 1e6;
        const sf = Mu != null && Math.abs(Mu) > 1e-9 ? phiMn / Math.abs(Mu) : null;
        rows.push({
            title: pos.title, label: pos.label, member: pos.member, face: pos.face, s: pos.s, h, d, As: st.As,
            rho: r.rho, rhoMin: r.rhoMin, rhoMax: r.rhoMax, okRho: r.rho >= r.rhoMin && r.rho <= r.rhoMax,
            phiMn, Mu: Mu != null ? Math.abs(Mu) : null, sf, okM: sf == null ? null : sf >= 1,
        });
    }
    return rows;
}

/** 수축·온도 철근비 (슬래브), 벽체 수평철근비 */
export function shrinkRatio(fy, kind = 'slab', dia = 'D16') {
    if (kind === 'wall') return fy >= 400 && (+String(dia).replace(/\D/g, '') || 16) <= 16 ? 0.0020 : 0.0025;
    return fy < 400 ? 0.0020 : Math.max(0.0014, 0.0018 * 400 / fy);
}

/**
 * 수평철근 설계검토.
 * positions: checkPositions 결과 (member/face/s 포함)
 * horzAt(member, face, s) → { As (mm²/m, 해당 면) }, horzBoth(member, s) → As 양면 합
 * ratio2: 주철근 대비 배력철근 비율 (기본 0.2)
 */
export function horzCheck(p, c, bi, horzAt, opts = {}) {
    const lay = opts.layout || mainBarLayout(p, c, bi, {});
    const { fy } = materials(p);
    const ratio2 = opts.ratio ?? 0.2;
    return checkPositions(lay.g).map(pos => {
        const h = memberThickness(lay.g, pos.member);
        const kind = pos.member === 'left' || pos.member === 'right' ? 'wall' : 'slab';
        const req1 = shrinkRatio(fy, kind, opts.dia) * 1000 * h;
        const both = horzAt(pos.member, null, pos.s);
        const main = steelAt(lay, pos.member, pos.face, pos.s).As;
        const req2 = main * ratio2;
        const use2 = horzAt(pos.member, pos.face, pos.s);
        return { title: pos.title, label: pos.label, req1, use1: both, ok1: both >= req1, req2, use2, ok2: use2 >= req2 };
    });
}

export { barArea };
