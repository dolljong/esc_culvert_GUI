// loads.js - 하중 정의 (구조 계산 > 하중 정의, 매뉴얼 4.4) — 2D 프레임 하중 케이스
//
// ── 계약 ──────────────────────────────────────────────────────────────
// loadCases(p, c, checkIndex) → LoadCase[]
//
//   LoadCase = {
//     key, mark,     SAP 하중 이름 (SW, PAVE, PAVEW, WATERV, LIVEFU, LIVEFUH, SOILBO, SOILBOW, WATERH,
//                    TEMPPLUS, TEMPMINUS, SHRINK, BUOYANCY, EQ, … , 사용자 하중 마크)
//     name,          '상부고정하중 : 지하수無' 등
//     cat,           하중 분류 ('고정하중' | '토압' | '수압' | '활하중' | '온도하중' | '지진하중' | '사용자하중')
//     item,          설계항목 (하중조합 열): 'D'|'Hv'|'L'|'Hh'|'T'|'F'|'E'|'U1'…  (하중정의 ▸ 설계항목 변경 반영)
//     gw,            'no' 지하수 無 조합에만 | 'yes' 지하수 有 조합에만 | 'any'
//     alt,           null | { group, opt }  같은 group 의 케이스는 서로 다른 조합으로 분리 (온도 ±, 편재 좌/우 …)
//     ecc,           true → 계수하중(최대편심) 조합에서만 사용 (편토압 / 편재활하중)
//     items: [
//       { target, kind:'dist', w1, w2, dir, a?, b? }     분포하중 kN/m (단위폭 1 m)
//       { target, kind:'point', pos, P, dir }            집중하중 kN (pos: 부재 시점에서 m)
//     ],
//     temp,          null | { dT (°C, 균일온도변화 + 팽창), grad (°C, 상하면 온도차 = 외측 − 내측), targets: [...] }
//     seis,          지진 케이스 부가정보 (응답변위법: { method, kh(지반 kN/m³), Tg, Sv, H, A }) — 해석기가 벽체 스프링에 사용
//     text: [..]     계산서용 산정식 줄
//     user,          사용자 추가 케이스 여부
//   }
//
//   target (부재군, loadHelpers.frameModel 참조):
//     'top' | 'bottom' | 'middle'(복층 중간슬래브) | 'left' | 'right' | 'mid:i'(중간벽 i, 복층은 1층) | 'midU:i'(복층 2층 중간벽)
//   부재 좌표: 원점 = 좌측벽 중심선 × 하부슬래브 중심선 (m).
//     슬래브는 왼쪽→오른쪽 (시점 = 좌측벽 중심선), 벽은 아래→위 (시점 = 하부슬래브 중심선).
//     w1/w2 = 구간 시점/종점 값. a/b 를 생략하면 부재군 전체 길이(0 ~ L), 주면 그 구간만 (부분 분포하중).
//     슬래브의 pos=0 / pos=L 점하중은 벽 중심선 바깥 내민부분(벽 두께/2, 부상방지저판)의 하중을 절점에 옮긴 것.
//   dir: 'gravity' (아래로 +) | 'x' (오른쪽 +) | 'normal' (구조물 안쪽 +: 상부슬래브 ↓, 하부슬래브 ↑, 좌측벽 →, 우측벽 ←)
//   지반반력(스프링)은 하중이 아니다 — 해석기가 처리.
//
// 데이터 c.loadDef (화면 loadDef 소유):
//   { condUser, cond: {k: {groundEl, gwlEl, topEl, surOn, sur}},
//     temp: { on, dT, gradOn, grad, shrinkOn, shrink, shrinkBottom, tempBottom },
//     itemOver: {key: 'Hv'}, over: {key: items[]}, user: [{key, name, cat, item, items[]}] }

import { getDesign, culvertK, K0, KaRankine, KaeMO, seisFor, DB_WHEEL, SITE_FA } from './design.js';
import { checkCondition, frameModel, haunchArea } from './loadHelpers.js';

export const LOAD_CATS = ['고정하중', '토압', '수압', '활하중', '온도하중', '지진하중', '사용자하중'];

export const DEFAULT_TEMP = { on: true, dT: 10, gradOn: false, grad: 5, shrinkOn: true, shrink: 15, shrinkBottom: false, tempBottom: false };

const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const G_ACC = 9.81;

/** 깊이별 토층 연직응력 계산기 */
function stressFn({ tp, qp, gamma, gammaSub, zw, extra = 0 }) {
    // z: 지표에서의 깊이 (m). 포장 (두께 tp, 하중 qp) 아래는 흙 (지하수위 zw 아래는 수중단위중량)
    return (z) => {
        if (z <= 0) return extra;
        if (z <= tp) return extra + qp * z / (tp || 1);
        const dry = Math.max(0, Math.min(z, zw) - tp);
        const wet = Math.max(0, z - Math.max(tp, zw));
        return extra + qp + gamma * dry + (gammaSub ?? gamma) * wet;
    };
}

/** 벽체 분포하중 (꺾임점에서 분할) */
function wallItems(target, L, fn, breaks = [], dir = 'normal') {
    const pts = [0, ...breaks.filter(b => b > 1e-6 && b < L - 1e-6).sort((a, b) => a - b), L];
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const it = { target, kind: 'dist', w1: +fn(a).toFixed(4), w2: +fn(b).toFixed(4), dir };
        if (pts.length > 2) { it.a = +a.toFixed(4); it.b = +b.toFixed(4); }
        if (Math.abs(it.w1) > 1e-9 || Math.abs(it.w2) > 1e-9) out.push(it);
    }
    return out;
}

/** 도로 활하중 충격계수 (흙깊이 D, m) */
export function impactByDepth(D) {
    if (D < 0.3) return 0.3;
    if (D < 0.6) return 0.2;
    if (D < 0.9) return 0.1;
    return 0;
}

/**
 * 상재 활하중 (kN/m²) 과 산정식
 * 도로: Pvl = 2·P·(1+i) / (2.75·(0.2 + 2·D))   (P = 후륜하중, 2.75 = 차량점유폭, 0.2 = 접지길이)
 * 철도: q = Pd·(1+i) / (축거 × (2.4 + 2·D))     (침목길이 2.4 m 에서 1:1 분포)
 */
export function liveSurcharge(d, D) {
    const lv = d.live;
    const lines = [];
    let q = 0;
    const i = impactByDepth(D);
    if (lv.kind === '사용자상재하중') {
        q = +lv.userQ || 0;
        lines.push(`사용자 상재하중 q = ${f3(q)} kN/m²`);
    } else if (lv.kind === '철도') {
        const Pd = +d.rail.drive || 180, ax = +d.rail.axle || 1.5;
        q = Pd * (1 + i) / (ax * (2.4 + 2 * D));
        lines.push(`철도하중 ${lv.railGrade}: 동륜하중 Pd = ${f3(Pd)} kN, 축거 = ${f3(ax)} m, 토피 D = ${f3(D)} m, i = ${i.toFixed(2)}`);
        lines.push(`q = Pd·(1+i) / (축거 × (2.4 + 2D)) = ${f3(Pd)}×${(1 + i).toFixed(2)} / (${f3(ax)} × ${f3(2.4 + 2 * D)}) = ${f3(q)} kN/m²`);
    } else {
        const P = DB_WHEEL[lv.grade] || 96;
        q = 2 * P * (1 + i) / (2.75 * (0.2 + 2 * D));
        lines.push(`도로하중 ${lv.grade}: 후륜하중 P = ${f3(P)} kN, 토피 D = ${f3(D)} m, 충격계수 i = ${i.toFixed(2)}`);
        lines.push(`Pvl = 2·P·(1+i) / (2.75·(0.2 + 2D)) = 2×${f3(P)}×${(1 + i).toFixed(2)} / (2.75 × ${f3(0.2 + 2 * D)}) = ${f3(q)} kN/m²`);
    }
    if (lv.min10 && q < 10) {
        lines.push(`활하중산정시 최소 10 kN/m² 적용 → q = 10.000 kN/m²`);
        q = 10;
    }
    return { q, lines, impact: i };
}

/** 전단파속도 (m/s): 입력값 또는 N 치 경험식 (사질토 80·N^(1/3), 점성토 100·N^(1/3)) */
function layerVs(l, clayCoef = 100) {
    if (+l.vs > 0) return +l.vs;
    const N = Math.max(1, Math.min(50, +l.N || 1));
    return (l.soil === '점성토' ? clayCoef : 80) * Math.cbrt(N);
}

/**
 * 응답변위법 지반 변수.
 * 반환 { H, Tg0, Tg, Vs, G, E0, Sv, Sa, A, Fa, u(z), tau(z), acc(z), lines }
 */
export function responseDisp(d, cond, kind = 'BOX') {
    const s = seisFor(d, kind);
    const cu = d.culvert;
    const H = Math.max(1, +cu.bedrock || 20);
    const bo = (cond.row && cond.row.boring) || { layers: [] };
    const layers = (bo.layers || []).length ? bo.layers : [{ soil: '사질토', N: 15, gamma: 19, dH: H }];
    let z = 0, sumT = 0, sumG = 0;
    const lines = [];
    for (let i = 0; i < layers.length && z < H - 1e-9; i++) {
        const l = layers[i];
        const bot = i === layers.length - 1 ? H : Math.min(H, +l.dH || 0);
        const h = Math.max(0, bot - z);
        if (h <= 0) continue;
        const vs = layerVs(l, d.opt.clayVs);
        sumT += 4 * h / vs;
        sumG += (+l.gamma || 19) * h;
        lines.push(`  층${i + 1} ${l.name || ''}: H=${f3(h)} m, N=${l.N}, Vs=${vs.toFixed(1)} m/s`);
        z = bot;
    }
    const Tg0 = sumT;
    const Tg = Tg0 * (+s.tgFactor || 1);
    const Vs = 4 * H / Tg;
    const gam = sumG / H;
    const Gm = gam / G_ACC * Vs * Vs;
    const E0 = 2 * (1 + (+d.env.nuS || 0.4)) * Gm;
    const Fa = SITE_FA[cu.site] || 1.4;
    const Sa = 2.5 * Fa * s.A * G_ACC;
    const Sv = Sa * Tg / (2 * Math.PI);
    const u = (zz) => 2 / (Math.PI ** 2) * Sv * Tg * Math.cos(Math.PI * zz / (2 * H));
    const tau = (zz) => Gm / (Math.PI * H) * Sv * Tg * Math.sin(Math.PI * zz / (2 * H));
    const acc = (zz) => (2 * Math.PI / Tg) ** 2 * u(zz);
    lines.unshift(`응답변위법: 기반면 깊이 H = ${f3(H)} m, 지진가속도계수 A = ${s.A}, 지반종류 ${cu.site} (Fa = ${Fa})`);
    lines.push(`  TG' = Σ4Hi/Vsi = ${f3(Tg0)} s, TG = ${s.tgFactor}·TG' = ${f3(Tg)} s, 평균 Vs = 4H/TG = ${Vs.toFixed(1)} m/s`);
    lines.push(`  G = γ/g·Vs² = ${Gm.toFixed(0)} kN/m², Sa = 2.5·Fa·A·g = ${f3(Sa)} m/s², Sv = Sa·TG/2π = ${f3(Sv)} m/s`);
    return { H, Tg0, Tg, Vs, G: Gm, E0, Sv, Sa, A: s.A, Fa, u, tau, acc, lines };
}

// ── 메인 ─────────────────────────────────────────────────────────────

/**
 * 검토단면 checkIndex 의 하중 케이스 목록 (계약은 파일 머리 참조)
 */
export function loadCases(p, c, checkIndex = 0) {
    const d = getDesign(p);
    const cond = checkCondition(p, c, checkIndex, 'calc');
    const fm = frameModel(c, cond.bi);
    const g = fm.g;
    const ld = c.loadDef || {};
    const T = { ...DEFAULT_TEMP, ...(ld.temp || {}) };
    const env = d.env, cu = d.culvert;
    const gc = env.gRC, gw = env.gWater;
    const mm = (v) => v / 1000;
    const L = fm.L;
    const hasTop = !!fm.group('top');
    const WLh = mm(g.WL) / 2, WRh = mm(g.WR) / 2;       // 벽 중심선 바깥 슬래브 길이
    const wing = g.antiFloat ? { w: mm(g.antiFloat.brW), t: mm(g.antiFloat.t) } : null;
    const Gel = cond.groundEl, topEl = cond.topEl, botEl = cond.botEl;
    const zTop = Gel - topEl;                 // 토피
    const zw = cond.gwOn ? Math.max(0, Gel - cond.gwlEl) : Infinity;   // 지하수위 깊이
    const gwlAbove = (el) => cond.gwOn ? Math.max(0, cond.gwlEl - el) : 0;
    const zOfY = (y) => Gel - (botEl + mm(fm.yBmm) + y);   // 프레임 높이 y (하부슬래브 중심선 기준) → 깊이
    const wallH = (gr) => gr.L;
    const walls = fm.groups.filter(q => q.kind === 'wall');
    const outerWalls = walls.filter(q => q.id === 'left' || q.id === 'right');
    const cases = [];
    const add = (cs) => { cases.push({ alt: null, ecc: false, gw: 'any', temp: null, seis: null, user: false, text: [], ...cs, mark: cs.key }); };

    // 상재 연직하중 성분
    const tp = cond.pave.t, qp = cond.pave.q;
    const tm = cond.mortar, qm = tm * env.gMortar;
    const hs = Math.max(0, zTop - tp - tm);        // 상부 흙 두께
    const alpha = +d.live.vFactor || 1;
    const sur = cond.surcharge || 0;

    // ── SW 구체자중 ──
    {
        const items = [], text = [`γc = ${gc} kN/m³ (철근콘크리트)`];
        const slabSW = (id, t, label, hKey) => {
            const w = gc * t;
            items.push({ target: id, kind: 'dist', w1: +w.toFixed(4), w2: +w.toFixed(4), dir: 'gravity' });
            items.push({ target: id, kind: 'point', pos: 0, P: +(w * WLh).toFixed(4), dir: 'gravity' });
            items.push({ target: id, kind: 'point', pos: L, P: +(w * WRh).toFixed(4), dir: 'gravity' });
            text.push(`${label}: w = γc × t = ${gc} × ${f3(t)} = ${f3(w)} kN/m (벽 바깥 내민부 절점하중 ${f3(w * WLh)} / ${f3(w * WRh)} kN)`);
            // 헌치
            if (g.kind === 'BOX' || g.kind === 'DOUBLE' || g.kind === 'U') {
                const hsArr = g.kind === 'DOUBLE' ? null : (g.sec.haunch || []);
                const cells = g.kind === 'DOUBLE' ? [] : g.cells;
                cells.forEach((cell, i) => {
                    const hc = (hsArr || [])[i] || {};
                    const keys = hKey === 'top' ? ['UL', 'UR'] : ['LL', 'LR'];
                    keys.forEach((k, j) => {
                        const ha = haunchArea(hc[k]);
                        if (!(ha.A > 0 && ha.s > 0)) return;
                        const wMax = gc * 2 * mm(mm(ha.A)) / mm(ha.s);
                        const xFace = mm((j === 0 ? cell.x0 : cell.x1) - fm.x0mm);
                        const a = j === 0 ? xFace : xFace - mm(ha.s), b = j === 0 ? xFace + mm(ha.s) : xFace;
                        items.push({ target: id, kind: 'dist', a: +a.toFixed(4), b: +b.toFixed(4), w1: +(j === 0 ? wMax : 0).toFixed(4), w2: +(j === 0 ? 0 : wMax).toFixed(4), dir: 'gravity' });
                        text.push(`  헌치 ${i + 1}련 ${k}: A = ${mm(mm(ha.A)).toFixed(4)} m², 삼각분포 w = 2γA/s = ${f3(wMax)} kN/m (구간 ${f3(a)}~${f3(b)} m)`);
                    });
                });
            }
        };
        slabSW('bottom', mm(g.LT), '하부슬래브', 'bot');
        if (hasTop) slabSW('top', mm(g.UT), '상부슬래브', 'top');
        if (fm.group('middle')) slabSW('middle', mm(g.MT), '중간슬래브', 'mid');
        for (const w of walls) {
            const clear = w.id.startsWith('midU') ? mm(g.H - g.MH - g.MT) : g.kind === 'DOUBLE' && w.id.startsWith('mid:') ? mm(g.MH) : g.kind === 'U' ? mm(g.H) : mm(g.H);
            const tAvg = g.kind === 'U' ? (mm(g.WB) + mm(g.WT)) / 2 : w.t;
            const ww = gc * tAvg * w.colFactor * clear / wallH(w);
            items.push({ target: w.id, kind: 'dist', w1: +ww.toFixed(4), w2: +ww.toFixed(4), dir: 'gravity' });
            text.push(`${w.label}: w = γc × t${w.colFactor < 1 ? ' × (기둥폭/CTC)' : ''} × (순높이/부재길이) = ${gc} × ${f3(tAvg)}${w.colFactor < 1 ? ' × ' + w.colFactor.toFixed(3) : ''} × ${f3(clear)}/${f3(wallH(w))} = ${f3(ww)} kN/m`);
        }
        if (wing) {
            const P = gc * wing.w * wing.t;
            items.push({ target: 'bottom', kind: 'point', pos: 0, P: +P.toFixed(4), dir: 'gravity' });
            items.push({ target: 'bottom', kind: 'point', pos: L, P: +P.toFixed(4), dir: 'gravity' });
            text.push(`부상방지저판 (양측): P = γc × brW × t = ${gc} × ${f3(wing.w)} × ${f3(wing.t)} = ${f3(P)} kN (하부슬래브 양 끝 절점)`);
        }
        add({ key: 'SW', name: '구체자중', cat: '고정하중', item: 'D', items, text });
    }

    // ── PAVE / PAVEW 상부고정하중 ──
    const paveCase = (withGW) => {
        const items = [], text = [];
        const hDry = withGW ? Math.max(0, Math.min(hs, zw - tp - (zw < Infinity ? 0 : 0))) : hs;
        const hWet = withGW ? Math.max(0, hs - hDry) : 0;
        const qsoil = alpha * (cu.gFill * hDry + cu.gFillSub * hWet);
        const q = qp + qm + qsoil + sur;
        text.push(`검토단면 ${cond.name}: 토피 = ${f3(zTop)} m (지반고 EL.${f3(Gel)} − 구조물상단 EL.${f3(topEl)})`);
        if (qp > 0) text.push(`포장: ${cond.pave.lines.join(', ')} kN/m²`);
        if (qm > 0) text.push(`방수몰탈: ${f3(tm)} × ${env.gMortar} = ${f3(qm)} kN/m²`);
        if (withGW && hWet > 0) text.push(`토사: α × (γt × ${f3(hDry)} + γsub × ${f3(hWet)}) = ${alpha} × (${cu.gFill} × ${f3(hDry)} + ${cu.gFillSub} × ${f3(hWet)}) = ${f3(qsoil)} kN/m²`);
        else text.push(`토사: α × γt × h = ${alpha} × ${cu.gFill} × ${f3(hDry)} = ${f3(qsoil)} kN/m²${alpha !== 1 ? ' (연직토압할증계수 α)' : ''}`);
        if (sur) text.push(`상재고정하중: ${f3(sur)} kN/m²`);
        text.push(`합계 q = ${f3(q)} kN/m²`);
        if (hasTop) {
            items.push({ target: 'top', kind: 'dist', w1: +q.toFixed(4), w2: +q.toFixed(4), dir: 'gravity' });
            items.push({ target: 'top', kind: 'point', pos: 0, P: +(q * WLh).toFixed(4), dir: 'gravity' });
            items.push({ target: 'top', kind: 'point', pos: L, P: +(q * WRh).toFixed(4), dir: 'gravity' });
        }
        if (wing) {
            // 부상방지저판 위 흙기둥 (지표 ~ 저판 상면)
            const zWing = Gel - (botEl + wing.t);
            const sv = stressFn({ tp, qp, gamma: cu.gBack, gammaSub: withGW ? cu.gBackSub : cu.gBack, zw: withGW ? zw : Infinity, extra: sur })(zWing);
            const P = sv * wing.w;
            items.push({ target: 'bottom', kind: 'point', pos: 0, P: +P.toFixed(4), dir: 'gravity' });
            items.push({ target: 'bottom', kind: 'point', pos: L, P: +P.toFixed(4), dir: 'gravity' });
            text.push(`부상방지저판 상부 흙: σv(${f3(zWing)} m) × brW = ${f3(sv)} × ${f3(wing.w)} = ${f3(P)} kN (양측)`);
        }
        return { items, text };
    };
    {
        const a = paveCase(false);
        add({ key: 'PAVE', name: '상부고정하중 : 지하수無', cat: '고정하중', item: 'Hv', gw: 'no', ...a });
        const b = paveCase(true);
        add({ key: 'PAVEW', name: '상부고정하중 : 지하수有', cat: '고정하중', item: 'Hv', gw: 'yes', ...b });
    }

    // ── WATERV 연직수압 (상부) ──
    {
        const items = [], text = [];
        const hTop = gwlAbove(topEl);
        if (hasTop && hTop > 0) {
            const q = gw * hTop;
            items.push({ target: 'top', kind: 'dist', w1: +q.toFixed(4), w2: +q.toFixed(4), dir: 'gravity' });
            items.push({ target: 'top', kind: 'point', pos: 0, P: +(q * WLh).toFixed(4), dir: 'gravity' });
            items.push({ target: 'top', kind: 'point', pos: L, P: +(q * WRh).toFixed(4), dir: 'gravity' });
            text.push(`상부 연직수압 = γw × hw = ${gw} × ${f3(hTop)} = ${f3(q)} kN/m²`);
        } else text.push('지하수위가 구조물 상단보다 낮으므로 상부 연직수압 없음');
        if (wing && gwlAbove(botEl + wing.t) > 0) {
            const P = gw * gwlAbove(botEl + wing.t) * wing.w;
            items.push({ target: 'bottom', kind: 'point', pos: 0, P: +P.toFixed(4), dir: 'gravity' });
            items.push({ target: 'bottom', kind: 'point', pos: L, P: +P.toFixed(4), dir: 'gravity' });
            text.push(`부상방지저판 상면 수압 = ${gw} × ${f3(gwlAbove(botEl + wing.t))} × ${f3(wing.w)} = ${f3(P)} kN (양측)`);
        }
        add({ key: 'WATERV', name: '연직수압', cat: '수압', item: 'Hv', gw: 'yes', items, text });
    }

    // ── 활하중 ──
    const live = liveSurcharge(d, zTop);
    if (hasTop) {
        const q = live.q;
        const mk = (a, b) => {
            const it = [{ target: 'top', kind: 'dist', w1: +q.toFixed(4), w2: +q.toFixed(4), dir: 'gravity' }];
            if (a != null) Object.assign(it[0], { a: +a.toFixed(4), b: +b.toFixed(4) });
            if (a == null || a <= 1e-9) it.push({ target: 'top', kind: 'point', pos: 0, P: +(q * WLh).toFixed(4), dir: 'gravity' });
            if (b == null || b >= L - 1e-9) it.push({ target: 'top', kind: 'point', pos: L, P: +(q * WRh).toFixed(4), dir: 'gravity' });
            return it;
        };
        add({ key: 'LIVEFU', name: '활하중', cat: '활하중', item: 'L', items: mk(), text: [...live.lines, `상부슬래브 전폭 재하 q = ${f3(q)} kN/m²`] });
        add({ key: 'LIVEFUL', name: '편재활하중(좌)', cat: '활하중', item: 'L', ecc: true, alt: { group: 'live', opt: 'L' }, items: mk(0, L / 2), text: [...live.lines, `상부슬래브 좌측 1/2 (0 ~ ${f3(L / 2)} m) 재하`] });
        add({ key: 'LIVEFUR', name: '편재활하중(우)', cat: '활하중', item: 'L', ecc: true, alt: { group: 'live', opt: 'R' }, items: mk(L / 2, L), text: [...live.lines, `상부슬래브 우측 1/2 (${f3(L / 2)} ~ ${f3(L)} m) 재하`] });
    }
    const kk = culvertK(d);
    {
        const Kh = d.live.kind === '철도' && d.opt.railK04 ? 0.4 : kk.K0;
        const q = d.live.hLive ? (live.q > 0 ? 10 : 0) * Kh : 0;
        const items = [];
        if (q > 0) for (const w of outerWalls) items.push({ target: w.id, kind: 'dist', w1: +q.toFixed(4), w2: +q.toFixed(4), dir: 'normal' });
        add({
            key: 'LIVEFUH', name: '활하중에 의한 수평토압', cat: '토압', item: 'Hh', items,
            text: d.live.hLive ? [`활하중에 의한 수평토압 = 10 × K${d.live.kind === '철도' && d.opt.railK04 ? '(0.4)' : 'o'} = 10 × ${f3(Kh)} = ${f3(q)} kN/m² (양측벽)`] : ['활하중에 의한 수평토압 적용 안함'],
        });
    }

    // ── 수평토압 ──
    const yTopFrame = Math.max(...walls.map(w => w.y1));
    const soilCase = (withGW, side = 'both') => {
        const sv = stressFn({ tp, qp, gamma: cu.gBack, gammaSub: withGW ? cu.gBackSub : cu.gBack, zw: withGW ? zw : Infinity, extra: sur });
        const K = kk.K;
        const items = [];
        const text = [`토압계수: ${kk.label}`, `σh(z) = K × σv(z), σv = 포장 ${f3(qp)} kN/m² + γ${withGW ? '(지하수위 아래 γsub)' : ''} × z${sur ? ' + 상재 ' + f3(sur) : ''}`];
        for (const w of outerWalls) {
            const factor = side === 'both' ? 1 : ((side === 'L') === (w.id === 'left') ? 1 : 0.5);
            const yw = withGW && zw < Infinity ? (Gel - zw) - (botEl + mm(fm.yBmm)) : null;
            const fn = (y) => K * factor * sv(zOfY(y));
            items.push(...wallItems(w.id, w.L, fn, yw != null ? [yw] : [], 'normal'));
            text.push(`${w.label}${factor !== 1 ? ' (편토압 50%)' : ''}: 하단 z=${f3(zOfY(0))} m → ${f3(fn(0))} kN/m², 상단 z=${f3(zOfY(w.L))} m → ${f3(fn(w.L))} kN/m²`);
        }
        return { items, text };
    };
    add({ key: 'SOILBO', name: '양토압 : 지하수無', cat: '토압', item: 'Hh', gw: 'no', ...soilCase(false) });
    add({ key: 'SOILBOW', name: '양토압 : 지하수有', cat: '토압', item: 'Hh', gw: 'yes', ...soilCase(true) });
    add({ key: 'SOILUL', name: '편토압(좌) : 지하수無', cat: '토압', item: 'Hh', gw: 'no', ecc: true, alt: { group: 'soil', opt: 'L' }, ...soilCase(false, 'L') });
    add({ key: 'SOILUR', name: '편토압(우) : 지하수無', cat: '토압', item: 'Hh', gw: 'no', ecc: true, alt: { group: 'soil', opt: 'R' }, ...soilCase(false, 'R') });
    add({ key: 'SOILULW', name: '편토압(좌) : 지하수有', cat: '토압', item: 'Hh', gw: 'yes', ecc: true, alt: { group: 'soil', opt: 'L' }, ...soilCase(true, 'L') });
    add({ key: 'SOILURW', name: '편토압(우) : 지하수有', cat: '토압', item: 'Hh', gw: 'yes', ecc: true, alt: { group: 'soil', opt: 'R' }, ...soilCase(true, 'R') });

    // ── WATERH 수평수압 ──
    {
        const items = [], text = [];
        if (cond.gwOn) {
            const yw = (cond.gwlEl) - (botEl + mm(fm.yBmm));    // 지하수위의 프레임 높이
            for (const w of outerWalls) {
                const fn = (y) => gw * Math.max(0, yw - y);
                items.push(...wallItems(w.id, w.L, fn, [yw], 'normal'));
                text.push(`${w.label}: p = γw × (GWL − y): 하단 ${f3(fn(0))} kN/m², 상단 ${f3(fn(w.L))} kN/m²`);
            }
        } else text.push('지하수위 미고려');
        add({ key: 'WATERH', name: '수평수압', cat: '수압', item: 'Hh', gw: 'yes', items, text });
    }

    // ── BUOYANCY 부력 (양압력) ──
    {
        const items = [], text = [];
        const hw = gwlAbove(botEl);
        if (hw > 0) {
            const u = gw * hw;
            items.push({ target: 'bottom', kind: 'dist', w1: +(-u).toFixed(4), w2: +(-u).toFixed(4), dir: 'gravity' });
            const ext = wing ? wing.w : 0;
            items.push({ target: 'bottom', kind: 'point', pos: 0, P: +(-u * (WLh + ext)).toFixed(4), dir: 'gravity' });
            items.push({ target: 'bottom', kind: 'point', pos: L, P: +(-u * (WRh + ext)).toFixed(4), dir: 'gravity' });
            text.push(`양압력 u = γw × hw = ${gw} × ${f3(hw)} = ${f3(u)} kN/m² (상향)`);
        } else text.push('지하수위가 구조물 하단보다 낮으므로 부력 없음');
        add({ key: 'BUOYANCY', name: '부력', cat: '수압', item: 'F', gw: 'yes', items, text });
    }

    // ── 온도 / 건조수축 ──
    {
        const tTargets = (bottom) => fm.groups.filter(q => bottom || q.id !== 'bottom').map(q => q.id);
        if (T.on) {
            const grad = T.gradOn ? +T.grad || 0 : 0;
            add({ key: 'TEMPPLUS', name: '온도변화(+)', cat: '온도하중', item: 'T', alt: { group: 'temp', opt: '+' }, items: [], temp: { dT: +T.dT, grad, targets: tTargets(T.tempBottom) }, text: [`균일 온도변화 +${T.dT} °C${grad ? `, 상하면 온도차 ${grad} °C` : ''}${T.tempBottom ? '' : ' (하부슬래브 제외)'}`] });
            add({ key: 'TEMPMINUS', name: '온도변화(-)', cat: '온도하중', item: 'T', alt: { group: 'temp', opt: '-' }, items: [], temp: { dT: -T.dT, grad: -grad, targets: tTargets(T.tempBottom) }, text: [`균일 온도변화 −${T.dT} °C${grad ? `, 상하면 온도차 −${grad} °C` : ''}`] });
        }
        if (T.shrinkOn) {
            add({ key: 'SHRINK', name: '건조수축', cat: '온도하중', item: 'T', items: [], temp: { dT: -(+T.shrink), grad: 0, targets: tTargets(T.shrinkBottom) }, text: [`건조수축: 등가 온도강하 −${T.shrink} °C${T.shrinkBottom ? '' : ' (하부슬래브 제외)'}`] });
        }
    }

    // ── 지진 ──
    const kind = g.kind === 'U' ? 'U' : 'BOX';
    const s = seisFor(d, kind);
    if (s && s.on) {
        const dirs = d.opt.eqDir === '양쪽에서 재하' ? ['L', 'R'] : d.opt.eqDir === '우측에서 좌측으로 재하' ? ['R'] : ['L'];
        const multi = dirs.length > 1;
        const method = kind === 'U' ? '등가정적하중법' : s.method;
        if (method === '응답변위법') {
            const rd = responseDisp(d, cond, kind);
            const Hs = mm(g.Htot);
            const khSoil = rd.E0 / 0.3 * Math.pow(Math.max(0.3, Hs) / 0.3, -0.75);
            const zB = Gel - botEl, zT = Gel - topEl;
            for (const dirLR of dirs) {
                const sg = dirLR === 'L' ? 1 : -1;
                const items = [];
                const text = [...rd.lines, `  지반반력계수 kh = E0/0.3 × (H/0.3)^(-3/4) = ${rd.E0.toFixed(0)}/0.3 × (${f3(Hs)}/0.3)^(-3/4) = ${khSoil.toFixed(0)} kN/m³`];
                const uB = rd.u(zB);
                for (const w of outerWalls) {
                    const fn = (y) => sg * khSoil * (rd.u(zOfY(y)) - uB);
                    items.push(...wallItems(w.id, w.L, fn, [], 'x'));
                }
                text.push(`  지반 상대변위 Δu = u(z) − u(zB): 상단 ${f3((rd.u(zT) - uB) * 1000)} mm → 벽체 하중 kh·Δu (양측벽, 수평)`);
                const tU = rd.tau(zT), tB = rd.tau(zB), tS = (tU + tB) / 2;
                if (hasTop) items.push({ target: 'top', kind: 'dist', w1: +(sg * tU).toFixed(4), w2: +(sg * tU).toFixed(4), dir: 'x' });
                items.push({ target: 'bottom', kind: 'dist', w1: +(-sg * tB).toFixed(4), w2: +(-sg * tB).toFixed(4), dir: 'x' });
                if (outerWalls[0]) items.push({ target: 'left', kind: 'dist', w1: +(-sg * tS).toFixed(4), w2: +(-sg * tS).toFixed(4), dir: 'gravity' });
                if (outerWalls[1]) items.push({ target: 'right', kind: 'dist', w1: +(sg * tS).toFixed(4), w2: +(sg * tS).toFixed(4), dir: 'gravity' });
                text.push(`  주면전단력 τ = G/(πH)·Sv·TG·sin(πz/2H): 상면 τU = ${f3(tU)}, 하면 τB = ${f3(tB)}, 측면 τS = (τU+τB)/2 = ${f3(tS)} kN/m²`);
                // 관성력
                for (const gr of fm.groups) {
                    const zc = gr.kind === 'slab' ? zOfY(gr.y) : zOfY((gr.y0 + gr.y1) / 2);
                    const kh = rd.acc(zc) / G_ACC;
                    const t = gr.kind === 'wall' ? gr.t * gr.colFactor : gr.t;
                    const w = sg * kh * gc * t;
                    items.push({ target: gr.id, kind: 'dist', w1: +w.toFixed(4), w2: +w.toFixed(4), dir: 'x' });
                }
                text.push(`  관성력: kh(z) = a(z)/g, a = (2π/TG)²·u(z) → 각 부재 kh × γc × t (수평)`);
                add({ key: multi ? `EQ${dirLR}` : 'EQ', name: `지진하중(응답변위법${multi ? (dirLR === 'L' ? ', 좌→우' : ', 우→좌') : ''})`, cat: '지진하중', item: 'E', alt: multi ? { group: 'eq', opt: dirLR } : null, items, text, seis: { method, kh: khSoil, Tg: rd.Tg, Sv: rd.Sv, H: rd.H, A: rd.A, dir: dirLR } });
            }
        } else {
            const kh = s.A * (+s.khRate || 100) / 100;
            const phi = cu.phiBack;
            const kae = KaeMO(phi, 0, 0, 0, kh, 0);
            const ka = KaRankine(phi);
            const dK = isFinite(kae) ? Math.max(0, kae - ka) : 0;
            const sv = stressFn({ tp, qp, gamma: cu.gBack, gammaSub: cu.gBack, zw: Infinity });
            for (const dirLR of dirs) {
                const sg = dirLR === 'L' ? 1 : -1;
                const items = [], text = [`등가정적하중법: kh = A × 적용률 = ${s.A} × ${s.khRate}% = ${kh.toFixed(4)}`];
                for (const gr of fm.groups) {
                    const t = gr.kind === 'wall' ? gr.t * gr.colFactor : gr.t;
                    const w = sg * kh * gc * t;
                    items.push({ target: gr.id, kind: 'dist', w1: +w.toFixed(4), w2: +w.toFixed(4), dir: 'x' });
                }
                if (hasTop) {
                    const qv = qp + qm + cu.gFill * hs;
                    const w = sg * kh * qv;
                    items.push({ target: 'top', kind: 'dist', w1: +w.toFixed(4), w2: +w.toFixed(4), dir: 'x' });
                    text.push(`상부 토피 관성력 = kh × ${f3(qv)} = ${f3(Math.abs(w))} kN/m`);
                }
                text.push(`구체 관성력 = kh × γc × t (각 부재, 수평)`);
                const push = outerWalls.find(w => w.id === (dirLR === 'L' ? 'left' : 'right'));
                if (push && dK > 0) {
                    items.push(...wallItems(push.id, push.L, (y) => dK * sv(zOfY(y)), [], 'normal'));
                    text.push(`지진시 토압증분 (Mononobe-Okabe): KAE = ${f3(kae)}, Ka = ${f3(ka)}, ΔK = ${f3(dK)} → ${push.label}`);
                }
                add({ key: multi ? `EQ${dirLR}` : 'EQ', name: `지진하중(등가정적${multi ? (dirLR === 'L' ? ', 좌→우' : ', 우→좌') : ''})`, cat: '지진하중', item: 'E', alt: multi ? { group: 'eq', opt: dirLR } : null, items, text, seis: { method: '등가정적하중법', kh, A: s.A, dir: dirLR } });
            }
        }
        if (method === '응답변위법' && s.eqSoil) {
            const sv = stressFn({ tp, qp, gamma: cu.gBack, gammaSub: cu.gBack, zw: Infinity });
            const kh = s.A;
            const kae = KaeMO(cu.phiBack, 0, 0, 0, kh, 0), ka = KaRankine(cu.phiBack);
            const dK = isFinite(kae) ? Math.max(0, kae - ka) : 0;
            const items = [];
            const w0 = outerWalls[0];
            if (w0 && dK > 0) items.push(...wallItems(w0.id, w0.L, (y) => dK * sv(zOfY(y)), [], 'normal'));
            add({ key: 'EQSOIL', name: '지진시 토압', cat: '토압', item: 'E', items, text: [`지진시 토압증분 ΔK = KAE − Ka = ${f3(kae)} − ${f3(ka)} = ${f3(dK)} (kh = A = ${kh})`] });
        }
    }

    // ── 사용자 하중 / 덮어쓰기 ──
    for (const u of ld.user || []) {
        if (!u || !u.key) continue;
        add({ key: u.key, name: u.name || u.key, cat: u.cat || '사용자하중', item: u.item || 'D', items: (u.items || []).map(x => ({ ...x })), text: ['사용자 정의 하중'], user: true });
    }
    for (const cs of cases) {
        if (ld.itemOver && ld.itemOver[cs.key]) cs.item = ld.itemOver[cs.key];
        if (ld.over && Array.isArray(ld.over[cs.key])) {
            cs.items = ld.over[cs.key].map(x => ({ ...x }));
            cs.text = [...cs.text, '※ 사용자 입력 하중으로 대체됨'];
            cs.overridden = true;
        }
    }
    return cases;
}

/** 하중 케이스 메타데이터만 (조합 생성용) */
export function caseCatalog(p, c, checkIndex = 0) {
    return loadCases(p, c, checkIndex).map(({ items, text, ...m }) => m);
}

/** 보고서용 텍스트 */
export function loadReport(p, c, checkIndex = 0) {
    const cs = loadCases(p, c, checkIndex);
    const out = [];
    for (const k of cs) {
        out.push(`■ ${k.name} (${k.mark}) [${k.item}]`);
        for (const t of k.text) out.push('   ' + t);
    }
    return out.join('\n');
}

/** 하중 케이스 합력 검산 (연직 kN/m, 수평 kN/m) */
export function caseResultant(cs, fm) {
    let V = 0, Hx = 0;
    for (const it of cs.items) {
        const gr = fm.group(it.target);
        if (!gr) continue;
        let F;
        if (it.kind === 'point') F = it.P;
        else {
            const a = it.a ?? 0, b = it.b ?? gr.L;
            F = (it.w1 + it.w2) / 2 * (b - a);
        }
        if (it.dir === 'gravity') V += F;
        else if (it.dir === 'x') Hx += F;
        else if (it.dir === 'normal') {
            if (it.target === 'top') V += F;
            else if (it.target === 'bottom') V -= F;
            else if (it.target === 'left') Hx += F;
            else if (it.target === 'right') Hx -= F;
        }
    }
    return { V, H: Hx };
}

export { K0 };
