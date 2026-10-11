// buoyancy.js - 부력 및 지지력 검토 (구조 계산 > 검토 위치 설정 ▸ [부력 및 지지력 검토], 매뉴얼 4.2.2)
//
// 이전 앱(단일 단면판)의 부력검토를 개선:
//  · 단면 형상은 sectionGeom/concreteArea (헌치·부상방지저판·Box/U/복층 공통) 사용
//  · 지하수위 아래 흙은 포화단위중량(γsub + γw)으로 전체 양압력(γw·hw·B)과 일관되게 산정
//  · 측면마찰력 (지하수위 위/아래 분리), 부상방지턱(저판 날개) 위 흙 하중 포함
//  · 기초 지지력: Hansen 식 허용지지력 vs 최대 지반반력 (구체자중 + 상부하중 + 포장 + 활하중 + 내부하중)

import { getDesign, K0 } from './design.js';
import { checkCondition, getChecks, paveLoad } from './loadHelpers.js';
import { concreteArea } from './sectionGeom.js';
import { liveSurcharge } from './loads.js';

const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const RAD = Math.PI / 180;

/** 측면 수평응력 적분 (z0 ~ z1 깊이, 지하수위 zw 위/아래 분리) — 유효응력 기준 */
function sideFriction(K, mu, gt, gsub, q0, z0, z1, zw) {
    // σv'(z) = q0 + γt·min(z,zw) + γsub·max(0, z − zw)
    const sv = (z) => q0 + gt * Math.min(z, zw) + gsub * Math.max(0, z - zw);
    const integ = (a, b) => (b > a ? (sv(a) + sv(b)) / 2 * (b - a) : 0);
    const above = integ(z0, Math.max(z0, Math.min(z1, zw)));
    const below = integ(Math.max(z0, Math.min(z1, zw)), z1);
    return { above: K * mu * above, below: K * mu * below };
}

/**
 * 검토단면 k 의 부력 검토. 반환 { fs, ok, total, U, lines }
 */
export function buoyancyCheck(p, c, k = 0) {
    const d = getDesign(p);
    const cond = checkCondition(p, c, k, 'buoy');
    const g = cond.g;
    const env = d.env, cu = d.culvert;
    const gw = env.gWater;
    const W = g.W / 1000;
    const wing = g.antiFloat ? { w: g.antiFloat.brW / 1000, t: g.antiFloat.t / 1000 } : null;
    const B = W + (wing ? 2 * wing.w : 0);
    const G = cond.groundEl, top = cond.topEl, bot = cond.botEl;
    const zw = cond.gwOn ? Math.max(0, G - cond.gwlEl) : Infinity;
    const lines = [];
    const add = (s = '') => lines.push(s);
    add(`<< 부력검토 >>  ${cond.name} (STA. ${f3(cond.sta)})`);
    add(`지반고 EL.${f3(G)}, 구조물 상단 EL.${f3(top)}, 하단 EL.${f3(bot)}, 지하수위 ${cond.gwOn ? 'EL.' + f3(cond.gwlEl) : '미고려'}`);
    add('');
    const Ac = concreteArea(g) / 1e6;
    const Wc = Ac * env.gRC;
    add(`구체자중 = A × γc = ${Ac.toFixed(4)} m² × ${env.gRC} = ${f3(Wc)} kN/m`);
    // 상부 슬래브 하중 (포장 + 몰탈 + 흙, 지하수위 아래는 포화단위중량)
    const pv = cond.pave, tm = cond.mortar;
    const hs = Math.max(0, cond.cover - pv.t - tm);
    const gsat = cu.gFillSub + gw;
    const dryS = Math.max(0, Math.min(hs, zw - pv.t));
    const wetS = hs - dryS;
    const qTop = pv.q + tm * env.gMortar + cu.gFill * dryS + gsat * wetS;
    const Wtop = g.kind === 'U' ? 0 : qTop * W;
    add(`상부 슬래브에 작용하는 하중 = (포장 ${f3(pv.q)} + 몰탈 ${f3(tm * env.gMortar)} + γt×${f3(dryS)} + γsat×${f3(wetS)}) × ${f3(W)} = ${f3(Wtop)} kN/m`);
    // 부상방지턱 (저판 날개) 위 흙기둥
    let Wwing = 0;
    if (wing) {
        const z = G - (bot + wing.t);
        const dry = Math.max(0, Math.min(z, zw) - pv.t);
        const wet = Math.max(0, z - Math.max(zw, pv.t));
        const q = pv.q + cu.gBack * dry + (cu.gBackSub + gw) * wet;
        Wwing = 2 * q * wing.w;
        add(`부상방지턱에 작용하는 하중 = 2 × (포장 ${f3(pv.q)} + γt×${f3(dry)} + γsat×${f3(wet)}) × ${f3(wing.w)} = ${f3(Wwing)} kN/m`);
    }
    // 측면마찰력 (구조물 측면, 상단 ~ 하단 또는 저판 상면)
    const K = K0(cu.phiBack), mu = Math.tan(cu.phiBack * 2 / 3 * RAD);
    const zA = G - top, zB = wing ? G - (bot + wing.t) : G - bot;
    const sf = sideFriction(K, mu, cu.gBack, cu.gBackSub, pv.q, zA, zB, zw);
    const Fs = 2 * (sf.above + sf.below);
    add(`측면마찰력 = 2 × K0 × tan(2Φ/3) × ∫σv'dz = ${f3(2 * sf.above)}(지하수위 이상) + ${f3(2 * sf.below)}(지하수위 이하) = ${f3(Fs)} kN/m`);
    add(`   (K0 = ${K.toFixed(3)}, tan(2/3×${cu.phiBack}°) = ${mu.toFixed(3)}, 깊이 ${f3(zA)} ~ ${f3(zB)} m)`);
    add('='.repeat(64));
    const total = Wc + Wtop + Wwing + Fs;
    add(`Total = ${f3(total)} kN/m`);
    const hw = cond.gwOn ? Math.max(0, cond.gwlEl - bot) : 0;
    const U = gw * hw * B;
    add(`부력 = γw × hw × B = ${gw} × ${f3(hw)} × ${f3(B)} = ${f3(U)} kN/m`);
    const req = 1.2;
    let fs = Infinity, ok = true;
    if (U > 0) {
        fs = total / U;
        ok = fs >= req;
        add(`☞ 안전률 : ${f3(fs)} ${ok ? '>' : '<'} ${req} =============> ${ok ? 'O.K !' : 'N.G !'}`);
    } else add('☞ 지하수위가 구조물 하단보다 낮아 부력이 발생하지 않음 =====> O.K !');
    return { fs, ok, total, U, Wc, Wtop, Wwing, Fs, lines };
}

/** Hansen 지지력계수 */
export function hansenFactors(phi) {
    const t = Math.tan(phi * RAD);
    const Nq = Math.exp(Math.PI * t) * Math.tan((45 + phi / 2) * RAD) ** 2;
    const Nc = phi > 0 ? (Nq - 1) / t : 5.14;
    const Ng = 1.5 * (Nq - 1) * t;
    return { Nq, Nc, Ng };
}

/**
 * 검토단면 k 의 기초 지지력 검토. 반환 { qa, qmax, ok, lines }
 */
export function bearingCheck(p, c, k = 0) {
    const d = getDesign(p);
    const cond = checkCondition(p, c, k, 'calc');
    const g = cond.g;
    const env = d.env, cu = d.culvert;
    const W = g.W / 1000;
    const wing = g.antiFloat ? g.antiFloat.brW / 1000 : 0;
    const B = W + 2 * wing;
    const lines = [];
    const add = (s = '') => lines.push(s);
    add(`<< 기초 지지력 검토 >>  ${cond.name}`);
    add('기초지반 허용 지지력 산정식 : Hansen 식 사용');
    add('');
    const items = [];
    const Wc = concreteArea(g) / 1e6 * env.gRC;
    items.push(['구체 자중', Wc / B]);
    const pv = cond.pave, tm = cond.mortar;
    const hs = Math.max(0, cond.cover - pv.t - tm);
    if (g.kind !== 'U') {
        items.push(['상부연직하중', (cu.gFill * hs + tm * env.gMortar) * W / B]);
        if (pv.q > 0) items.push([pv.label || '포장', pv.q * W / B]);
        items.push(['도로 노면 활하중', liveSurcharge(d, cond.cover).q * W / B]);
    }
    const inn = (cond.row && cond.row.inner) || {};
    const inner = g.cells.reduce((s, cc) => s + cc.B / 1000, 0);
    if (inn.dead && inn.dead.on) items.push(['암거 내부 고정하중', (+inn.dead.q || 0) * inner / B]);
    if (inn.live && inn.live.on) {
        const lv = inn.live;
        const t = (+lv.t || 0) / 1000, LT = g.LT / 1000;
        let q;
        if (lv.kind === '철도하중') {
            const bw = (+lv.B + 2 * (+lv.D + +lv.H)) / 1000 + 2 * LT, aw = (+lv.B1 + 2 * (+lv.D + +lv.H)) / 1000 + 2 * LT;
            q = (+lv.Pr || 0) / (bw * aw);
        } else {
            const bw = (+lv.b || 0) / 1000 + 2 * (t + LT), aw = (+lv.a || 0) / 1000 + 2 * (t + LT);
            q = (+lv.P || 0) * 1.3 / (bw * aw);
        }
        items.push(['암거 내부 활하중', q]);
    }
    if (inn.water && inn.water.on) items.push(['암거 내부 수압', env.gWater * (+inn.water.h || 0) * inner / B]);
    for (const [n, v] of items) add(`* ${n} = ${f3(v)} kN/m²`);
    const qmax = items.reduce((s, x) => s + x[1], 0);
    // 기초지반 (기초 하면 위치의 지층)
    const bo = (cond.row && cond.row.boring) || { layers: [] };
    const zBase = cond.groundEl - cond.botEl;
    let lay = null, acc = 0;
    for (const l of bo.layers || []) { if (zBase <= (+l.dH || 0) + 1e-9) { lay = l; break; } acc = +l.dH; }
    if (!lay) lay = (bo.layers || [])[Math.max(0, (bo.layers || []).length - 1)] || { N: 30, gamma: 19 };
    const N = Math.min(50, +lay.N || 0);
    const phi = Math.min(45, Math.sqrt(15 * N) + 15);
    const sub = cond.gwOn && cond.gwlEl > cond.botEl;
    const gam = (+lay.gamma || 19) - (sub ? env.gWater : 0);
    const { Nq, Nc, Ng } = hansenFactors(phi);
    const Df = Math.max(0, zBase);
    const qOver = gam * Df;
    const kD = Df / B <= 1 ? Df / B : Math.atan(Df / B);
    const dq = 1 + 2 * Math.tan(phi * RAD) * (1 - Math.sin(phi * RAD)) ** 2 * kD;
    const qu = qOver * Nq * dq + 0.5 * gam * B * Ng;
    let qa = qu / 3;
    const fq = c.foundation && (+c.foundation.qa || +c.foundation.qaAllow);
    const qaUser = fq > 0 ? fq : null;
    add('='.repeat(64));
    add(`기초지반: ${lay.name || ''} N = ${N}, Φ = √(15N)+15 = ${phi.toFixed(1)}°, γ' = ${f3(gam)} kN/m³, Df = ${f3(Df)} m, B = ${f3(B)} m`);
    add(`Nq = ${Nq.toFixed(2)}, Nγ = ${Ng.toFixed(2)}, dq = ${dq.toFixed(3)} → qu = q·Nq·dq + ½γ'BNγ = ${f3(qu)} kN/m²`);
    if (qaUser) { add(`허용지지력: 기초부 설정 입력값 ${f3(qaUser)} kN/m² 적용 (Hansen qu/3 = ${f3(qa)})`); qa = qaUser; }
    const ok = qa >= qmax;
    add(`Qa = ${qaUser ? '' : 'qu/3 = '}${f3(qa)} kN/m² ${ok ? '>' : '<'} Qmax = ${f3(qmax)} kN/m²   ======> ${ok ? 'O.K !' : 'N.G !'}`);
    return { qa, qmax, ok, lines, Nc };
}

/** 모든 검토단면 */
export function buoyancyAll(p, c) {
    return getChecks(p, c).rows.map((r, k) => ({ name: r.name, buoy: buoyancyCheck(p, c, k), bear: bearingCheck(p, c, k) }));
}

export { paveLoad };
