// quantity.js - 수량산출 (출력 > 수량산출서 일반 / 공통 / 토공, 매뉴얼 m3 3장)
//
// ── 공개 API ────────────────────────────────────────────────────────────
//   defaultQuantityOptions()            수량산출 옵션 기본값
//   getQuantityOptions(p, ci)           project.output.quantity.byCulvert[ci] 를 기본값에 병합
//   quantities(p, opts)                 opts = { ci, ...옵션 덮어쓰기 }
//     → { ci, name, opts, trees:{ 일반, 공통, 토공 }, totals, sheets:[sheet], sheet(id) }
//        sheet = { id, name, kind:'집계'|'산근', tab, rows (표시용 2차원 배열), fig, ... }
//          집계: cols:[열 이름], items:[{ key, group, spec, sub, unit, vals:[], refs:[{sheet,key}|null], total }]
//          산근: items:[{ no, key, group, spec, sub, unit, qty, caps:[{ cap, lines:[{ mark, text, expr, value }] }] }]
//        tree node = { id (sheet id), label, kind, children }
//   quantityToExcelXml(result, { sheets:[id] (선택), refSummary, refBasis })  → SpreadsheetML 2003 XML
//   evalExpr('10.500 x 0.500 x (9.990 + 9.990) / 2')  산출근거 식 계산 ('x' = 곱하기, { } = 괄호)
//
// 산출근거 식은 m 단위 소수 3자리 숫자로 쓰고, 수량은 그 식을 계산한 값이다 (엑셀 수식과 같은 값).
// 형상은 sectionGeom / blockFrame(사각 포함 블록 길이) / earthwork / wingGeom / approachGeom / parapetGeom 을 그대로 쓴다.

import { blocks, fmtSta } from '../core/model.js';
import { sectionGeom, concreteArea, polyArea, haunchProfile } from './sectionGeom.js';
import { normalizeCross, crossShapes, crossCells, BARRIER_H } from './crossGeom.js';
import { foundRowOfBlock } from './foundType.js';
import { installedWings, integralElevation, wallSection, defaultWallDim, defaultIntegral, WING_NAMES } from './wingGeom.js';
import { getApproach, approachSection, approachPlan } from './approachGeom.js';
import { hasApproach } from './approachRebar.js';
import { getParapet, parapetSide, parapetApplicable } from './parapetGeom.js';
import { excavationAt } from './earthwork.js';
import { scheduleSummary } from './barSchedule.js';
import { normDia, barInfo, DIAS } from './rebar.js';
import { getDesign } from './design.js';
import { blockFrame } from './rebarPlan.js';
import { columnWalls } from './beamCol.js';

const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);
const K = 1000;
const f3 = (v) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
const f4 = (v) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
const m = (mm) => f3(mm / K);

// ── 옵션 ─────────────────────────────────────────────────────────────

export const BASIS = ['일반수량 산출기준', '실적수량 산출기준'];
export const REBAR_MODES = ['철근직경별로 구분하여 집계', '가공조립별로 구분하여 집계'];
export const ASSEMBLY = ['보통', '복잡', '매우복잡'];
export const FORM_TYPES = ['합판3회', '합판4회', '합판6회', '유로폼', '문양거푸집', '강재거푸집', '원형거푸집'];

/** 거푸집수량옵션 [그룹, 키, 부위, 기본값] */
export const FORM_PARTS = [
    ['본체', 'slab', '슬래브/헌치', '합판3회'],
    ['본체', 'wallIn', '외측벽체(내측)', '합판3회'],
    ['본체', 'wallOut', '외측벽체(외측)', '합판3회'],
    ['본체', 'mid', '기둥(중간벽체)', '합판3회'],
    ['본체', 'mass', "Mass Con'c", '합판3회'],
    ['본체', 'cut', '차수벽', '합판3회'],
    ['본체', 'rail', '난간벽', '합판3회'],
    ['본체', 'lean', '버림콘크리트', '합판6회'],
    ['본체', 'apron', '유출입부 접속판', '합판3회'],
    ['접속슬래브', 'approach', '접속슬래브', '합판4회'],
    ['날개벽', 'wingFront', '전면', '합판3회'],
    ['날개벽', 'wingBack', '배면', '합판3회'],
    ['옹벽', 'wallFront', '벽체(전면)', '합판3회'],
    ['옹벽', 'wallBack', '벽체(배면)', '합판3회'],
    ['옹벽', 'wallFoot', '저판', '합판4회'],
    ['옹벽', 'wallKey', '전단키', '합판4회'],
    ['옹벽', 'wallLean', '버림콘크리트', '합판6회'],
    ['옹벽', 'wallFinish', '마감', '합판3회'],
];
const PART_LABEL = Object.fromEntries(FORM_PARTS.map(([, k, l]) => [k, l]));

/** 출력선택사항 [키, 이름, 기본] */
export const OUTPUT_ITEMS = [
    ['concrete', '콘크리트', true], ['pour', '콘크리트 타설', true], ['scaffold', '비계', true], ['waterstop', '지수판', true],
    ['nonwoven', '부직포', true], ['spacer', '스페이서', true], ['sealant', '실런트', true], ['waterproof', '아스팔트 방수', true],
    ['form', '거푸집', true], ['dowel', 'DOWEL BAR', true], ['styro', '스티로폼', true], ['mortar', '보호몰탈', false],
    ['shore', '본체 동바리', true], ['cjoint', '시공이음 면정리', true], ['swell', '팽창성 지수재', true], ['pvc', 'PVC Pipe', true],
];

/** 콘크리트 부위 [키, 이름] (굵은골재최대치수 / 슬럼프) */
export const CONC_PARTS = [['base', '기초'], ['body', '구체'], ['approach', '접속슬래브'], ['lean', '버림콘크리트'], ['mass', 'MASS'], ['cip', '현장타설말뚝']];

export function defaultQuantityOptions() {
    return {
        basis: BASIS[0],
        groundFig: false,               // 삽도출력시 지반정보 출력
        rebarMode: REBAR_MODES[0],
        refSummary: false,              // 엑셀: 집계표간 셀 참조
        refBasis: true,                 // 엑셀: 산출근거 셀 참조
        rebarWaste: true,               // 철근 할증율 적용
        wallInTotal: false,             // 옹벽수량을 총괄집계표에 합산
        items: Object.fromEntries(OUTPUT_ITEMS.map(([k, , v]) => [k, v])),
        general: {
            shore: '강관', scaffold: '강관', scaffoldDeduct: 500,
            waterstop: '230 x 9.5', sealant: '20 x 25', styro: 20,
            assembly: { body: '복잡', approach: '복잡', wall: '복잡', wing: '복잡' },
            agg: { base: 25, body: 25, approach: 25, lean: 40, mass: 40, cip: 25 },
            slump: { base: 15, body: 15, approach: 15, lean: 8, mass: 15, cip: 15 },
        },
        form: Object.fromEntries(FORM_PARTS.map(([, k, , v]) => [k, v])),
        formUser: {},                   // 사용자입력 (설정값이 '사용자입력' 일 때 이름)
    };
}

function merge(a, b) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
    const out = Array.isArray(a) ? a.slice() : { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = (a && typeof a[k] === 'object' && a[k] && !Array.isArray(a[k])) ? merge(a[k], v) : v;
    return out;
}

export function getQuantityOptions(p, ci = 0) {
    const q = (p && p.output && p.output.quantity) || {};
    return merge(defaultQuantityOptions(), (q.byCulvert && q.byCulvert[ci]) || {});
}

// ── 식 계산 ──────────────────────────────────────────────────────────

/** '10.500 x 0.500 x (9.990 + 9.990) / 2' → 수치 */
export function evalExpr(expr) {
    const s = String(expr).replace(/,/g, '').replace(/[{[]/g, '(').replace(/[}\]]/g, ')').replace(/\s[x×]\s/g, ' * ');
    let i = 0;
    const ws = () => { while (s[i] === ' ') i++; };
    const num = () => {
        ws();
        if (s[i] === '(') { i++; const v = add(); ws(); if (s[i] === ')') i++; return v; }
        if (s[i] === '-') { i++; return -num(); }
        if (s[i] === '+') { i++; return num(); }
        const m0 = /^[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?/i.exec(s.slice(i));
        if (!m0) return NaN;
        i += m0[0].length;
        return +m0[0];
    };
    const mul = () => {
        let v = num();
        for (;;) {
            ws();
            if (s[i] === '*') { i++; v *= num(); } else if (s[i] === '/') { i++; v /= num(); } else return v;
        }
    };
    const add = () => {
        let v = mul();
        for (;;) {
            ws();
            if (s[i] === '+') { i++; v += mul(); } else if (s[i] === '-') { i++; v -= mul(); } else return v;
        }
    };
    const v = add();
    return isFinite(v) ? v : 0;
}

/** 엑셀 수식 (= 없이) */
export function exprFormula(expr) {
    return String(expr).replace(/,/g, '').replace(/[{[]/g, '(').replace(/[}\]]/g, ')').replace(/\s[x×]\s/g, '*').replace(/\s+/g, '');
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿';
export const circled = (k) => (k >= 1 && k <= 50 ? [...CIRCLED][k - 1] : `(${k})`);

// ── 항목 묶음 (한 산출근거 시트) ─────────────────────────────────────

/** 공종 순서 (집계표 정렬) */
export const GROUP_ORDER = [
    '콘크리트', '콘크리트 타설', '거푸집', '동바리', '비계', '스페이서', '다웰바', '시공이음 면정리', '팽창성 지수재', '지수판', '실런트',
    '스티로폼', '아스팔트 방수', '보호몰탈', 'PVC Pipe', '부직포', '철근', '철근가공,조립',
    '터파기', '되메우기', '잔토처리', '가시설', '기초잡석', '잡석채움',
];
const gIdx = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 999 : i; };
export const itemKey = (d) => `${d.group}|${d.spec || ''}|${d.sub || ''}|${d.unit || ''}`;

class QSet {
    constructor(id, name, tab, fig) { this.id = id; this.name = name; this.tab = tab; this.fig = fig; this.items = []; this.map = new Map(); }
    /** def = { group, spec, sub, unit }, cap = '(본체)', expr = 식, opt = { text } (표시문자가 식과 다를 때) */
    add(def, cap, expr, opt = {}) {
        const key = itemKey(def);
        let it = this.map.get(key);
        if (!it) { it = { ...def, key, caps: [], qty: 0, n: 0 }; this.map.set(key, it); this.items.push(it); }
        let cp = it.caps.find(x => x.cap === cap);
        if (!cp) { cp = { cap, lines: [] }; it.caps.push(cp); }
        const value = evalExpr(expr);
        it.n++;
        cp.lines.push({ expr: String(expr), text: opt.text || String(expr), value });
        it.qty += value;
        return value;
    }
    qty(def) { const it = this.map.get(itemKey(def)); return it ? it.qty : 0; }
    /** 집계용 정렬 + 번호 */
    finish() {
        this.items.sort((a, b) => gIdx(a.group) - gIdx(b.group));
        let no = 0;
        for (const it of this.items) {
            it.no = ++no;
            let k = 0;
            for (const cp of it.caps) for (const ln of cp.lines) ln.mark = circled(++k);
        }
        return this.toSheet();
    }
    toSheet() {
        const rows = [];
        for (const it of this.items) {
            rows.push([`${it.no}. ${it.group}`, '', it.sub ? `[${it.sub}]` : '', '', '']);
            let first = true;
            for (const cp of it.caps) {
                rows.push([first && it.spec ? `(${it.spec})` : '', '', cp.cap, '', '']);
                first = false;
                for (const ln of cp.lines) rows.push(['', ln.mark, ln.text, ln.value, '']);
            }
            rows.push(['', '', '계', it.qty, it.unit]);
        }
        return { id: this.id, name: this.name, kind: '산근', tab: this.tab, fig: this.fig, items: this.items, rows };
    }
}

// ── 공용 수치 ─────────────────────────────────────────────────────────

function concSpec(o, d, part) {
    const e = d.env;
    const fck = { base: e.fckBase, body: e.fck, approach: e.fckApproach, lean: e.fckLean, mass: e.fckMass, road: e.fckRoad, cip: e.fck }[part];
    const k = part === 'road' ? 'mass' : part;     // 차도부 무근: 골재·슬럼프는 MASS 값
    return `${o.general.agg[k]}-${fck}-${o.general.slump[k]}`;
}
function formName(o, part) {
    const t = o.form[part] || '합판3회';
    return t === '사용자입력' ? (o.formUser[part] || '사용자입력') : t;
}
function band(hmm) { return hmm <= 7000 ? '0~7m' : hmm <= 10000 ? '7~10m' : '10m 이상'; }

/** 블록 길이 문자열 (사각이면 양단 평균): x0~x1 (단면 x mm) */
function spanL(fr, x0, x1) {
    const a = fr.lenAt(fr.vOfX(x0)) / K, b = fr.lenAt(fr.vOfX(x1 == null ? x0 : x1)) / K;
    return Math.abs(a - b) < 5e-4 ? f3(a) : `(${f3(a)} + ${f3(b)}) / 2`;
}

// ── 거푸집 면 분류 ───────────────────────────────────────────────────

/**
 * 단면의 거푸집 면. 반환 [{ part, len(mm), x0, x1, y0, y1 }]
 *   상향 수평면(상면/바닥)과 기초 하면은 제외. 실적 기준이면 하부 헌치 경사면도 제외.
 */
export function formEdges(g, opts = {}) {
    const out = [];
    const colX = new Set();
    for (const w of opts.colWalls || []) { colX.add(Math.round(w.x0)); colX.add(Math.round(w.x1)); }
    const af = g.antiFloat;
    const afH = af ? af.t + af.t1 : 0;
    const edges = (pts, hole, fn) => {
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            const dx = q[0] - p[0], dy = q[1] - p[1];
            const L = Math.hypot(dx, dy);
            if (L < 1e-6) continue;
            // 콘크리트 → 공기 방향 법선 (반시계 외곽: (dy,-dx), 반시계 구멍: (-dy,dx))
            let nx = dy / L, ny = -dx / L;
            if (hole) { nx = -nx; ny = -ny; }
            fn({ p, q, L, nx, ny });
        }
    };
    const orient = (pts) => {           // 반시계로
        let a = 0;
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
        return a < 0 ? pts.slice().reverse() : pts;
    };
    const push = (part, e, len = e.L) => { if (len > 1e-6) out.push({ part, len, x0: e.p[0], x1: e.q[0], y0: e.p[1], y1: e.q[1], nx: e.nx, ny: e.ny }); };
    const isU = g.kind === 'U';
    edges(orient(g.outer), false, (e) => {
        if (e.ny > 0.95) return;                                     // 상면
        if (e.ny < -0.95 && Math.max(e.p[1], e.q[1]) < 1) return;   // 기초 하면
        const xm = (e.p[0] + e.q[0]) / 2, ym = (e.p[1] + e.q[1]) / 2;
        if (isU && g.inner && xm > g.inner.x0 - 1 && xm < g.inner.x1 + 1 && ym > g.LT - 1) {
            // U형 내측 (벽 내면 / 헌치 / 중분대)
            if (Math.abs(e.nx) > 0.95) push('wallIn', e);
            else if (opts.basis !== 1 || e.ny < 0) push('slab', e);
            return;
        }
        let len = e.L;
        if (af && Math.abs(e.nx) > 0.95 && Math.min(e.p[1], e.q[1]) < 1 && (Math.abs(xm) < 1 || Math.abs(xm - g.W) < 1)) len = Math.max(0, len - afH);
        push('wallOut', e, len);
    });
    if (!isU) {
        const wl = g.WL, wr = g.W - g.WR;
        for (const cell of g.cells) {
            edges(orient(cell.poly), true, (e) => {
                if (e.ny > 0.95) return;                              // 바닥 (상향)
                const xm = (e.p[0] + e.q[0]) / 2;
                if (Math.abs(e.nx) > 0.95) {
                    if (colX.has(Math.round(xm))) return;             // 기둥 열: 기둥 거푸집으로 따로
                    push(Math.abs(xm - wl) < 1 || Math.abs(xm - wr) < 1 ? 'wallIn' : 'mid', e);
                } else if (e.ny < -0.95) push('slab', e);            // 슬래브 하면
                else if (e.ny < 0 || opts.basis !== 1) push('slab', e);  // 헌치 경사면 (실적: 하부헌치 제외)
            });
        }
    }
    if (af) {
        for (const poly of [af.left, af.right]) {
            edges(orient(poly), false, (e) => {
                const xm = (e.p[0] + e.q[0]) / 2;
                if (e.ny > 0.95 || (e.ny < -0.95 && Math.max(e.p[1], e.q[1]) < 1)) return;
                if (Math.abs(e.nx) > 0.95 && (Math.abs(xm) < 1 || Math.abs(xm - g.W) < 1)) return;
                if (e.ny > 0.3) return;                               // 경사 상면
                push('wallOut', e);
            });
        }
    }
    return out;
}

// ── 본체 블록 (일반) ─────────────────────────────────────────────────

function cellsOf(g) { return g.cells || []; }

function bodyGeneral(ctx, bi) {
    const { p, c, o, d, nb } = ctx;
    const fr = blockFrame(c, bi);
    const g = fr.g;
    const S = new QSet(`g-b${bi}`, `블럭${bi + 1} 산출근거`, '일반', { type: 'body', bi });
    const it = o.items;
    const L = spanL(fr, 0, g.W);
    const Lv = evalExpr(L);
    const bnd = band(g.Htot);
    const cBody = { group: '콘크리트', spec: concSpec(o, d, 'body'), unit: 'm³' };
    const cMass = { group: '콘크리트', spec: concSpec(o, d, 'road'), sub: '무근(차도부)', unit: 'm³' };
    const cBase = { group: '콘크리트', spec: concSpec(o, d, 'base'), sub: '접속저판', unit: 'm³' };
    const cLean = { group: '콘크리트', spec: concSpec(o, d, 'lean'), sub: '버림', unit: 'm³' };
    const F = (part) => ({ group: '거푸집', spec: formName(o, part), sub: bnd, unit: 'm²' });
    const formLines = [];   // [part, cap, expr]
    let cols = [];
    try { cols = g.kind === 'BOX' ? columnWalls(c, bi) : []; } catch { cols = []; }
    const colIdx = new Set(cols.map(x => x.index));
    const reinf = [];       // 철근콘크리트 수량 (타설)
    const plain = [];

    // ── 콘크리트 (본체) ──
    let bodyConc = 0;
    if (g.kind === 'BOX') {
        const cap = '(본체)';
        bodyConc += S.add(cBody, cap, `${m(g.W)} x ${m(g.UT)} x ${L}`, { text: `${m(g.W)} x ${m(g.UT)} x ${L}  (상부슬래브)` });
        bodyConc += S.add(cBody, cap, `${m(g.W)} x ${m(g.LT)} x ${L}`, { text: `${m(g.W)} x ${m(g.LT)} x ${L}  (하부슬래브)` });
        for (const w of g.walls) {
            if (w.kind === 'mid' && colIdx.has(w.index)) continue;
            const nm = w.kind === 'outer' ? (w.side === 'L' ? '좌측벽' : '우측벽') : `중간벽${w.index + 1}`;
            const e = `${m(w.t)} x ${m(g.H)} x ${spanL(fr, w.x0, w.x1)}`;
            bodyConc += S.add(cBody, cap, e, { text: `${e}  (${nm})` });
        }
        // 헌치
        const hmap = new Map();
        cellsOf(g).forEach((cell, i) => {
            const hs = (g.sec.haunch || [])[i] || {};
            for (const [k, x] of [['UL', cell.x0], ['UR', cell.x1], ['LL', cell.x0], ['LR', cell.x1]]) {
                const hc = hs[k];
                if (!hc || !hc.use) continue;
                const prof = haunchProfile(hc);
                const A = polyArea([[0, 0], ...prof]);
                if (A < 1) continue;
                const s = prof[prof.length - 1][0], w = prof[0][1];
                const tri = (hc.type || '삼각형') === '삼각형';
                const Lx = spanL(fr, x);
                const e = tri ? `{${m(s)} x ${m(w)} / 2 x ${Lx}}` : `{${f4(A / 1e6)} x ${Lx}}`;
                hmap.set(e, (hmap.get(e) || 0) + 1);
            }
        });
        for (const [e, n] of hmap) bodyConc += S.add(cBody, '(헌치)', n > 1 ? `${e} x ${n}` : e);
        // 기둥
        for (const cw of cols) {
            const e = cw.round ? `{3.1416 x ${m(cw.b)} x ${m(cw.b)} / 4 x ${m(cw.H)}} x ${cw.n}` : `{${m(cw.b)} x ${m(cw.D)} x ${m(cw.H)}} x ${cw.n}`;
            bodyConc += S.add(cBody, cw.round ? '(원형기둥)' : '(사각기둥)', e);
        }
    } else {
        const A = concreteArea(g) - (g.antiFloat ? polyArea(g.antiFloat.left) + polyArea(g.antiFloat.right) : 0);
        bodyConc += S.add(cBody, '(본체)', `${f4(A / 1e6)} x ${L}`, { text: `${f4(A / 1e6)} x ${L}  (단면적 x 길이)` });
    }
    if (g.antiFloat) {
        const af = g.antiFloat;
        const A = polyArea(af.left);
        const e = af.t1 > 0 ? `{${f4(A / 1e6)} x ${L}} x 2` : `{${m(af.brW)} x ${m(af.t)} x ${L}} x 2`;
        bodyConc += S.add(cBody, '(부상방지저판)', e);
    }
    // 차도부 / 측구
    try {
        const cr = normalizeCross(c, c.cross, bi);
        const { cells } = crossCells(c, bi);
        cells.forEach((cc, i) => {
            const cell = cr.cells[i];
            if (!cell || !(cr.all || cell.use)) return;
            const sh = crossShapes(g, cc, cell, g.sec);
            for (const poly of sh.road) { const A = polyArea(poly); if (A > 1) plain.push(S.add(cMass, '(차도부)', `${f4(A / 1e6)} x ${L}`)); }
            for (const poly of sh.barriers) { const A = polyArea(poly); if (A > 1) plain.push(S.add(cMass, '(방호벽)', `${f4(A / 1e6)} x ${L}`)); }
            for (const poly of sh.ditches) {
                const A = polyArea(poly);
                if (A > 1) bodyConc += S.add(cBody, '(측구 공제)', `-${f4(A / 1e6)} x ${L}`);
            }
            for (const poly of sh.barriers) {
                const hgt = (n0(cell.minT) + BARRIER_H);
                formLines.push(['mass', '(방호벽)', `${m(hgt)} x ${L} x 2`]);
                void poly;
            }
        });
    } catch (e) { /* 횡단 데이터 없음 */ }
    reinf.push(bodyConc);

    // ── 단부: 난간벽 / 차수벽 / 유출입부 접속판 ──
    const ends = [];
    if (bi === 0) ends.push(0);
    if (bi === nb - 1) ends.push(1);
    let apronConc = 0;
    if (parapetApplicable(c)) {
        const pr = getParapet(c);
        for (const ei of ends) {
            const e = pr.ends[ei];
            if (!e) continue;
            const j = (c.joints || [])[ei === 0 ? 0 : (c.joints || []).length - 1] || {};
            const sn = Math.sin((n0(j.angle) || 90) * Math.PI / 180) || 1;
            const Wl = g.W / sn;
            const nm = ei === 0 ? '시점' : '종점';
            const sd = parapetSide(e, g);
            if (sd.rail) {
                const Wh = n0(e.rail.Wh), t1 = n0(e.rail.Wt1), t2 = n0(e.rail.Wt2) || t1;
                const ex = t1 === t2 ? `(${m(t1)} x ${m(Wh)}) x ${m(Wl)}` : `{(${m(t1)} + ${m(t2)}) / 2 x ${m(Wh)}} x ${m(Wl)}`;
                reinf.push(S.add(cBody, `(난간벽-${nm})`, ex));
                formLines.push(['rail', `(난간벽-${nm})`, `${m(Wh)} x ${m(Wl)} x 2`]);
                formLines.push(['rail', `(난간벽-${nm} 마구리)`, `{(${m(t1)} + ${m(t2)}) / 2 x ${m(Wh)}} x 2`]);
            }
            if (sd.cut) {
                const H = n0(e.cut.H), c1 = n0(e.cut.CT1), c2 = n0(e.cut.CT2);
                const ex = c2 > 0 ? `{(${m(c1)} + ${m(c1 + c2)}) / 2 x ${m(H)}} x ${m(Wl)}` : `(${m(H)} x ${m(c1)}) x ${m(Wl)}`;
                reinf.push(S.add(cBody, `(차수벽-${nm})`, ex));
                formLines.push(['cut', `(차수벽-${nm})`, `${m(H)} x ${m(Wl)} x 2`]);
            }
            if (sd.apron) {
                const T = n0(e.apron.T), L1 = n0(e.apron.L1), L2 = n0(e.apron.L2);
                apronConc += S.add(cBase, `(유출입부접속저판-${nm})`, `${m(Wl)} x (${m(L1)} + ${m(L2)}) / 2 x ${m(T)}`);
                formLines.push(['apron', `(유출입부접속저판-${nm})`, `${m(T)} x (${m(Wl)} + ${m(L1)} + ${m(L2)})`]);
            }
        }
    }
    if (apronConc) plain.push(apronConc);
    // ── 버림콘크리트 ──
    if (g.lean) {
        const Wl = g.baseX1 - g.baseX0 + 2 * g.lean.w;
        plain.push(S.add(cLean, '(버림콘크리트)', `${m(Wl)} x ${m(g.lean.t)} x ${L}`));
        if (g.H4 > 0) plain.push(S.add(cLean, '(측면 버림)', `{${m(g.lean.t)} x ${m(g.H4)} x ${L}} x 2`));
        formLines.push(['lean', '(버림콘크리트)', `${m(g.lean.t)} x ${L} x 2`]);
    }
    if (!it.concrete) for (const k of [...S.map.keys()]) if (k.startsWith('콘크리트|')) { S.items = S.items.filter(x => x.key !== k); S.map.delete(k); }

    // ── 콘크리트 타설 ──
    if (it.pour) {
        const rs = reinf.filter(v => v), ps = plain.filter(v => v);
        if (rs.length) S.add({ group: '콘크리트 타설', spec: '펌프카타설', sub: '0~15m', unit: 'm³' }, '(철근콘크리트)', rs.map(f3).join(' + '));
        if (ps.length) S.add({ group: '콘크리트 타설', spec: '무근', sub: 'VIB제외', unit: 'm³' }, '(무근콘크리트)', ps.map(f3).join(' + '));
    }

    // ── 거푸집 ──
    const fe = formEdges(g, { basis: o.basis === BASIS[1] ? 1 : 0, colWalls: g.walls.filter(w => w.kind === 'mid' && colIdx.has(w.index)) });
    const byPart = {};
    for (const e of fe) {
        const Lx = spanL(fr, (e.x0 + e.x1) / 2);
        const k = `${e.part}|${Lx}`;
        (byPart[k] || (byPart[k] = { part: e.part, Lx, lens: [] })).lens.push(e.len);
    }
    const wallArea = { wallOut: 0, wallIn: 0, mid: 0 };
    const formOrder = ['wallOut', 'wallIn', 'mid', 'slab'];
    const pieces = Object.values(byPart).sort((a, b) => formOrder.indexOf(a.part) - formOrder.indexOf(b.part));
    const formVals = [];
    for (const pc of pieces) {
        const sum = pc.lens.length > 1 ? `(${pc.lens.map(m).join(' + ')})` : m(pc.lens[0]);
        const v = it.form ? S.add(F(pc.part), `(${PART_LABEL[pc.part]})`, `${sum} x ${pc.Lx}`) : evalExpr(`${sum} x ${pc.Lx}`);
        if (wallArea[pc.part] != null) wallArea[pc.part] += v;
        formVals.push(v);
    }
    for (const cw of cols) {
        const per = cw.round ? `3.1416 x ${m(cw.b)}` : `(${m(cw.b)} + ${m(cw.D)}) x 2`;
        const v = it.form ? S.add(F('mid'), cw.round ? '(원형기둥)' : '(사각기둥)', `${per} x ${m(cw.H)} x ${cw.n}`) : 0;
        wallArea.mid += v;
    }
    if (it.form) {
        // 단부 마구리 (블록 양단, 실적기준 제외)
        if (o.basis !== BASIS[1]) {
            const A = concreteArea(g) / 1e6;
            const sn0 = fr.sin0 || 1, sn1 = fr.sin1 || 1;
            const ex = Math.abs(sn0 - sn1) < 1e-6 ? (Math.abs(sn0 - 1) < 1e-9 ? `${f4(A)} x 2` : `${f4(A)} / ${f4(sn0)} x 2`) : `${f4(A)} / ${f4(sn0)} + ${f4(A)} / ${f4(sn1)}`;
            S.add(F('wallOut'), '(단부 마구리)', ex);
        }
        for (const [part, cap, ex] of formLines) S.add(F(part), cap, ex);
    }

    // ── 동바리 ──
    if (it.shore && g.kind !== 'U') {
        const shoreDef = { group: '동바리', spec: `${o.general.shore}동바리`, unit: '공m³' };
        for (const cell of cellsOf(g)) {
            if (cell.floor === 1 && g.kind === 'DOUBLE') { /* 하층도 중간슬래브 동바리 필요 */ }
            S.add(shoreDef, '(본체 내공)', `${m(cell.B)} x ${m(cell.y1 - cell.y0)} x ${spanL(fr, cell.x0, cell.x1)}`);
        }
    }
    // ── 비계 ──
    if (it.scaffold) {
        const ded = n0(o.general.scaffoldDeduct);
        S.add({ group: '비계', spec: `${o.general.scaffold}비계`, unit: 'm²' }, '(외측면)', `(${m(g.Htot)} - ${m(ded)}) x ${L} x 2`);
    }
    // ── 스페이서 ──
    if (it.spacer) {
        const wa = [wallArea.wallOut, wallArea.wallIn, wallArea.mid].filter(v => v > 0);
        if (wa.length) S.add({ group: '스페이서', spec: '벽체용', unit: 'm²' }, '(벽체 거푸집면적)', wa.map(f3).join(' + '));
        const ns = g.kind === 'U' ? 1 : g.kind === 'DOUBLE' ? 3 : 2;
        S.add({ group: '스페이서', spec: '슬래브 및 기초용', unit: 'm²' }, '(슬래브 평면적)', `${m(g.W)} x ${L} x ${ns}`);
    }
    // ── 이음부 (블록 종점 신축이음: 마지막 블록 제외) ──
    const hasJoint = bi < nb - 1;
    if (hasJoint && it.dowel && c.dowel && c.dowel.use) {
        const dw = c.dowel, ctc = n0(dw.ctc) || 300;
        const cnt = (len) => Math.floor(len / ctc + 1e-9) + 1;
        const def = { group: '다웰바', spec: `${dw.dia}, L=${(n0(dw.len)).toLocaleString('en-US')}mm`, unit: 'EA' };
        S.add(def, '(하부슬래브)', String(cnt(g.W)), { text: `INT(${m(g.W)} / ${m(ctc)}) + 1 = ${cnt(g.W)}` });
        if (dw.top && g.kind !== 'U') S.add(def, '(상부슬래브)', String(cnt(g.W)), { text: `INT(${m(g.W)} / ${m(ctc)}) + 1 = ${cnt(g.W)}` });
        if (dw.wall) {
            const ws = g.walls.filter(w => !(w.kind === 'mid' && colIdx.has(w.index)));
            const hw = g.kind === 'U' ? g.H : g.H;
            const n = cnt(hw) * ws.length;
            S.add(def, '(벽체)', String(n), { text: `{INT(${m(hw)} / ${m(ctc)}) + 1} x ${ws.length} = ${n}` });
        }
    }
    // 시공이음
    const cj = c.cjoint && Array.isArray(c.cjoint.walls) ? c.cjoint.walls : null;
    const wallsLow = g.walls.filter(w => w.floor !== 2);
    const nAll = wallsLow.reduce((s, w, i) => s + (cj ? n0(cj[i] && cj[i].n) : 2), 0);
    const nOut = wallsLow.reduce((s, w, i) => s + (w.kind === 'outer' ? (cj ? n0(cj[i] && cj[i].n) : 2) : 0), 0);
    if (it.cjoint && nAll > 0) S.add({ group: '시공이음 면정리', unit: 'm' }, '(벽체 수평 시공이음)', `${nAll} x ${L}`);
    if (it.swell && nOut > 0) S.add({ group: '팽창성 지수재', unit: 'm' }, '(외측벽체 시공이음)', `${nOut} x ${L}`);
    if (hasJoint) {
        if (it.waterstop) {
            const ex = g.kind === 'U'
                ? `${m(g.W - g.WL / 2 - g.WR / 2)} + ${m(g.Htot - g.LT / 2)} x 2`
                : `(${m(g.W - g.WL / 2 - g.WR / 2)} + ${m(g.Htot - g.UT / 2 - g.LT / 2)}) x 2`;
            S.add({ group: '지수판', spec: o.general.waterstop, unit: 'm' }, '(신축이음 - 부재 중심선)', ex);
        }
        if (it.sealant) {
            const inner = g.kind === 'U' ? [g.H * 2 + (g.inner ? g.inner.x1 - g.inner.x0 : 0)] : cellsOf(g).map(cc => perimeter(cc.poly));
            const outerEx = g.kind === 'U' ? `${m(g.Htot)} x 2` : `${m(g.W)} + ${m(g.Htot)} x 2`;
            S.add({ group: '실런트', spec: o.general.sealant, unit: 'm' }, '(신축이음 - 외면 + 내면)', `${outerEx} + ${inner.map(m).join(' + ')}`);
        }
        if (it.styro) S.add({ group: '스티로폼', spec: `${o.general.styro} mm`, unit: 'm²' }, '(신축이음 단면)', f4(concreteArea(g) / 1e6));
    }
    // 방수 / 보호몰탈
    if (it.waterproof) {
        const ex = g.kind === 'U' ? `${m(g.Htot)} x 2 x ${L}` : `(${m(g.W)} + ${m(g.Htot)} x 2) x ${L}`;
        S.add({ group: '아스팔트 방수', spec: '2회', unit: 'm²' }, '(상면 + 외측면)', ex);
    }
    if (it.mortar && g.kind !== 'U') S.add({ group: '보호몰탈', spec: 't=50mm', unit: 'm²' }, '(상면)', `${m(g.W)} x ${L}`);
    S.Lv = Lv;
    return S;
}

function perimeter(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    return s;
}

// ── 날개벽 ───────────────────────────────────────────────────────────

const SHORT = { SL: '시·좌', SR: '시·우', EL: '종·좌', ER: '종·우' };

function wingGeneral(ctx, w) {
    const { c, o, d } = ctx;
    const pos = (c.wings && c.wings.pos && c.wings.pos[w.key]) || {};
    const dim = (c.wings && c.wings.dim && c.wings.dim[w.key]) || {};
    const S = new QSet(`g-w-${w.key}`, `날개벽(${SHORT[w.key]}) 산출근거`, '일반', { type: w.type === '일체식' ? 'wingI' : 'wingW', key: w.key });
    const it = o.items;
    const cBody = { group: '콘크리트', spec: concSpec(o, d, 'body'), unit: 'm³' };
    const cLean = { group: '콘크리트', spec: concSpec(o, d, 'lean'), sub: '버림', unit: 'm³' };
    const conc = [], plain = [];
    if (w.type === '일체식') {
        const el = integralElevation(c, w.key);
        const it2 = dim.integral || defaultIntegral(c);
        const T1 = n0(it2.T1), T2 = n0(it2.T2) || T1;
        const F = (part) => ({ group: '거푸집', spec: formName(o, part), sub: band(el.hRoot), unit: 'm²' });
        const Aex = `(${m(el.hRoot)} + ${m(el.hTip)}) / 2 x ${m(el.L1)}`;
        const tex = T1 === T2 ? m(T1) : `(${m(T1)} + ${m(T2)}) / 2`;
        if (it.concrete) conc.push(S.add(cBody, '(날개벽)', `{${Aex}} x ${tex}`));
        const hu1 = n0(it2.Hu1), hu2 = n0(it2.Hu2);
        if (it.concrete && hu1 > 0 && hu2 > 0) conc.push(S.add(cBody, '(평면헌치)', `${m(hu1)} x ${m(hu2)} / 2 x ${m(el.hRoot)}`));
        if (it.form) {
            S.add(F('wingFront'), '(전면)', Aex);
            S.add(F('wingBack'), '(배면)', Aex);
            S.add(F('wingFront'), '(끝단 마구리)', `${m(el.hTip)} x ${tex}`);
        }
        if (it.spacer) S.add({ group: '스페이서', spec: '벽체용', unit: 'm²' }, '(전면 + 배면)', `${Aex} x 2`);
        if (it.scaffold) S.add({ group: '비계', spec: `${o.general.scaffold}비계`, unit: 'm²' }, '(전면 + 배면)', `${Aex} x 2`);
    } else {
        const wd = dim.wall || defaultWallDim(c);
        const rows = (wd.rows && wd.rows.length ? wd.rows : defaultWallDim(c).rows);
        const s0 = wallSection(rows[0]), s1 = wallSection(rows[1] || rows[0]);
        const len = n0(pos.len) || 5000;
        const Lm = m(len);
        const hmax = Math.max(s0.WH, s1.WH);
        const F = (part) => ({ group: '거푸집', spec: formName(o, part), sub: band(hmax), unit: 'm²' });
        const avg = (a, b, f = m) => (Math.abs(a - b) < 0.5 ? f(a) : `(${f(a)} + ${f(b)}) / 2`);
        const A0 = polyArea(s0.poly) / 1e6, A1 = polyArea(s1.poly) / 1e6;
        if (it.concrete) {
            conc.push(S.add(cBody, '(옹벽 벽체+저판)', `${Math.abs(A0 - A1) < 5e-5 ? f4(A0) : `(${f4(A0)} + ${f4(A1)}) / 2`} x ${Lm}`));
            if (s0.key || s1.key) {
                const k0 = s0.key ? polyArea(s0.key) : 0, k1 = s1.key ? polyArea(s1.key) : 0;
                conc.push(S.add(cBody, '(전단키)', `${avg(k0 / 1e6, k1 / 1e6, f4)} x ${Lm}`));
            }
            if (s0.lean || s1.lean) {
                const l0 = s0.lean ? polyArea(s0.lean) : 0, l1 = s1.lean ? polyArea(s1.lean) : 0;
                plain.push(S.add(cLean, '(버림콘크리트)', `${avg(l0 / 1e6, l1 / 1e6, f4)} x ${Lm}`));
            }
        }
        if (it.form) {
            const stemF = (s) => Math.hypot(s.stem.xb1 - s.stem.xt1, s.WH - s.BB1);
            const stemB = (s) => Math.hypot(s.stem.xb0 - s.stem.xt0, s.WH - s.BF1);
            S.add(F('wallFront'), '(벽체 전면)', `${avg(stemF(s0), stemF(s1))} x ${Lm}`);
            S.add(F('wallBack'), '(벽체 배면)', `${avg(stemB(s0), stemB(s1))} x ${Lm}`);
            S.add(F('wallFoot'), '(저판 앞굽 + 뒷굽)', `(${avg(s0.BB2, s1.BB2)} + ${avg(s0.BF2, s1.BF2)}) x ${Lm}`);
            if (s0.key) S.add(F('wallKey'), '(전단키)', `${m(n0(rows[0].key.T))} x ${Lm} x 2`);
            if (s0.lean) S.add(F('wallLean'), '(버림콘크리트)', `${m(n0(rows[0].IH))} x ${Lm} x 2`);
            S.add(F('wallFinish'), '(마구리)', `${f4(A0)} + ${f4(A1)}`);
        }
        if (it.spacer) S.add({ group: '스페이서', spec: '벽체용', unit: 'm²' }, '(벽체 양면)', `(${avg(s0.WH, s1.WH)} x 2) x ${Lm}`);
        const dr = wd.drain;
        if (dr && dr.use) {
            const ctcH = n0(dr.ctcH) || 3000;
            const n = Math.max(1, Math.floor(len / ctcH + 1e-9));
            if (it.pvc) S.add({ group: 'PVC Pipe', spec: `φ${n0(dr.dia)}mm`, unit: 'm' }, '(배수공)', `${n} x ${avg(s0.WT + s0.B3, s1.WT + s1.B3)} / 2`, {});
            if (it.nonwoven) S.add({ group: '부직포', spec: '300 x 300mm', unit: 'EA' }, '(배수공)', String(n));
        }
    }
    if (it.pour) {
        const rs = conc.filter(v => v), ps = plain.filter(v => v);
        if (rs.length) S.add({ group: '콘크리트 타설', spec: '펌프카타설', sub: '0~15m', unit: 'm³' }, '(철근콘크리트)', rs.map(f3).join(' + '));
        if (ps.length) S.add({ group: '콘크리트 타설', spec: '무근', sub: 'VIB제외', unit: 'm³' }, '(무근콘크리트)', ps.map(f3).join(' + '));
    }
    return S;
}

// ── 접속슬래브 ───────────────────────────────────────────────────────

function approachGeneral(ctx, a, i) {
    const { p, c, o, d } = ctx;
    const S = new QSet(`g-a${i}`, `접속슬래브${i + 1} 산출근거`, '일반', { type: 'approach', idx: i });
    const g = sectionGeom(c, 0);
    const sec = approachSection(c, a, g);
    let Lw = 0;
    try { const pl = approachPlan(p, c, a); Lw = Math.abs(pl.staE - pl.staS) * K; } catch { Lw = 0; }
    if (!(Lw > 0)) Lw = g.W;
    const A = polyArea(sec.slab) / 1e6;
    const it = o.items;
    const cAp = { group: '콘크리트', spec: concSpec(o, d, 'approach'), unit: 'm³' };
    let v = 0;
    if (it.concrete) v = S.add(cAp, `(접속슬래브-${a.side})`, `${f4(A)} x ${m(Lw)}`);
    if (it.form) {
        const H1 = n0(a.H1), H2 = n0(a.H2);
        S.add({ group: '거푸집', spec: formName(o, 'approach'), sub: '0~7m', unit: 'm²' }, `(접속슬래브-${a.side})`, `(${m(H1)} + ${m(H2)}) x ${m(Lw)} + ${f4(A)} x 2`);
    }
    if (it.pour && v) S.add({ group: '콘크리트 타설', spec: '펌프카타설', sub: '0~15m', unit: 'm³' }, '(철근콘크리트)', f3(v));
    if (it.spacer) S.add({ group: '스페이서', spec: '슬래브 및 기초용', unit: 'm²' }, '(평면적)', `${m(sec.Ltot)} x ${m(Lw)}`);
    return S;
}

// ── 집계표 ───────────────────────────────────────────────────────────

/** parts = [{ sheet (산근 또는 집계), name }] → 집계 시트 */
function summarySheet(id, name, tab, parts, fig) {
    const keys = [], meta = new Map();
    for (const pt of parts) for (const itm of pt.sheet.items) if (!meta.has(itm.key)) { meta.set(itm.key, itm); keys.push(itm.key); }
    keys.sort((a, b) => gIdx(meta.get(a).group) - gIdx(meta.get(b).group));
    const items = keys.map(k => {
        const mt = meta.get(k);
        const vals = [], refs = [];
        for (const pt of parts) {
            const x = pt.sheet.items.find(y => y.key === k);
            const v = x ? (x.qty != null ? x.qty : x.total) : null;
            vals.push(v);
            refs.push(x ? { sheet: pt.sheet.id, key: k } : null);
        }
        const total = vals.reduce((s, v) => s + (v || 0), 0);
        return { key: k, group: mt.group, spec: mt.spec || '', sub: mt.sub || '', unit: mt.unit || '', vals, refs, total };
    });
    const cols = parts.map(pt => pt.name);
    const rows = items.map(r => [r.group, r.spec, r.sub, r.unit, ...r.vals.map(v => (v == null ? '-' : v)), r.total]);
    return { id, name, kind: '집계', tab, cols, items, rows, fig, parts: parts.map(pt => pt.sheet.id) };
}

// ── 공통 (철근) ──────────────────────────────────────────────────────

const BODY_CATS = ['암거본체', '암거기타', '암거상세부', '보,기둥철근'];

function rebarSheets(ctx, sum) {
    const { o } = ctx;
    const byDiaMode = o.rebarMode !== REBAR_MODES[1];
    const gradeOf = (cat) => (cat === '날개벽' ? o.general.assembly.wing : cat === '접속슬래브' ? o.general.assembly.approach : o.general.assembly.body);
    const sets = [];
    for (const b of sum.blocks) {
        const S = new QSet(`c-b${b.bi}`, `블럭${b.bi + 1} 철근 산출근거`, '공통', { type: 'rebar', bi: b.bi });
        // (cat, dia, factor) 묶음
        const grp = new Map();
        for (const r of b.rows) {
            const dk = normDia(r.dia);
            if (!dk) continue;
            const f = o.rebarWaste ? (n0(r.factor) || 1) : 1;
            const k = `${r.cat}|${dk}|${f}`;
            const e = grp.get(k) || { cat: r.cat, dia: dk, f, kg: 0, len: 0, mass: r.unitMass };
            e.kg += r.weight; e.len += r.length / K * n0(r.count);
            grp.set(k, e);
        }
        const list = [...grp.values()].sort((a, b2) => DIAS.indexOf(a.dia) - DIAS.indexOf(b2.dia));
        for (const e of list) {
            const def = byDiaMode ? { group: '철근', spec: e.dia, unit: 'TON' } : { group: '철근', spec: gradeOf(e.cat), unit: 'TON' };
            const ex = e.f !== 1 ? `${f3(e.len)} x ${f3(e.mass)} x ${e.f} / 1000` : `${f3(e.len)} x ${f3(e.mass)} / 1000`;
            S.add(def, `(${e.cat}${byDiaMode ? '' : ' ' + e.dia})`, ex, { text: `${e.dia} : ${ex}  (길이 m x 단위중량 kg/m${e.f !== 1 ? ' x 할증' : ''} / 1000)` });
        }
        // 가공조립 (할증 제외 순중량)
        const asm = new Map();
        for (const e of list) { const gk = gradeOf(e.cat); asm.set(`${gk}|${e.cat}`, (asm.get(`${gk}|${e.cat}`) || 0) + e.kg); }
        for (const [k, kg] of asm) {
            const [gk, cat] = k.split('|');
            S.add({ group: '철근가공,조립', spec: gk, unit: 'TON' }, `(${cat})`, `${f3(kg)} / 1000`);
        }
        sets.push(S.finish());
    }
    return sets;
}

function rebarMatrix(sum, o) {
    const cats = Object.keys(sum.byCat);
    const dias = Object.keys(sum.byDia);
    const items = dias.map(dk => {
        const vals = cats.map(cat => {
            let kg = 0;
            for (const b of sum.blocks) for (const r of b.rows) if (normDia(r.dia) === dk && r.cat === cat) kg += o.rebarWaste ? r.weightF : r.weight;
            return kg ? kg / K : null;
        });
        const total = vals.reduce((s, v) => s + (v || 0), 0);
        const bi = barInfo(dk);
        return { key: `철근|${dk}||TON`, group: '철근', spec: dk, sub: bi ? `${bi.mass.toFixed(3)} kg/m` : '', unit: 'TON', vals, refs: vals.map(() => null), total };
    });
    const rows = items.map(r => [r.group, r.spec, r.sub, r.unit, ...r.vals.map(v => (v == null ? '-' : v)), r.total]);
    return { id: 'c-matrix', name: '철근집계', kind: '집계', tab: '공통', cols: cats, items, rows, fig: { type: 'rebar', bi: 0 } };
}

// ── 토공 ─────────────────────────────────────────────────────────────

/** 다각형을 ylo ≤ y ≤ yhi 띠로 자른 다각형 */
export function clipBand(poly, ylo, yhi) {
    const clip = (pts, keep, yc) => {
        const out = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            const pin = keep(p[1]), qin = keep(q[1]);
            if (pin) out.push(p);
            if (pin !== qin) {
                const t = (yc - p[1]) / (q[1] - p[1]);
                out.push([p[0] + t * (q[0] - p[0]), yc]);
            }
        }
        return out;
    };
    let pts = poly || [];
    if (pts.length >= 3 && isFinite(ylo)) pts = clip(pts, (y) => y >= ylo, ylo);
    if (pts.length >= 3 && isFinite(yhi)) pts = clip(pts, (y) => y <= yhi, yhi);
    return pts.length >= 3 ? pts : [];
}

/** 다각형을 ylo ≤ y ≤ yhi 로 자른 면적 */
export function clipBandArea(poly, ylo, yhi) {
    const pts = clipBand(poly, ylo, yhi);
    return pts.length ? polyArea(pts) : 0;
}

/** 블록 bi, Station sta 의 토공 단면 */
export function earthSection(p, c, bi, sta) {
    const ex = excavationAt(p, c, bi, sta);
    const g = ex.g;
    const yB = ex.yBottom, yG = ex.yGround;
    const sideX = (s, sgn) => {
        if (!s) {
            const x = sgn < 0 ? g.baseX0 - (g.lean ? g.lean.w : 0) : g.baseX1 + (g.lean ? g.lean.w : 0);
            return [[x, yB], [x, yG]];
        }
        if (s.type === '가시설') return [[s.x0, yB], [s.x0, yG]];
        return s.pts;
    };
    const L = sideX(ex.left, -1), R = sideX(ex.right, 1);
    const poly = yG > yB ? [...L.slice().reverse(), ...R] : [];
    // 지층 띠 (위에서 아래)
    const bands = [];
    const layers = ex.layers;
    for (let i = 0; i < layers.length; i++) {
        const yhi = Math.min(yG, ex.toY(layers[i].top));
        const ylo = i + 1 < layers.length ? ex.toY(layers[i + 1].top) : -Infinity;
        if (yhi <= ylo) continue;
        bands.push({ name: layers[i].name, ylo, yhi, area: poly.length ? clipBandArea(poly, ylo, yhi) : 0 });
    }
    if (!layers.length && poly.length) bands.push({ name: '토사', ylo: -Infinity, yhi: yG, area: polyArea(poly) });
    const excArea = bands.reduce((s, b) => s + b.area, 0);
    // 구조물 (지표 아래) 면적
    const solids = [g.kind === 'DOUBLE' ? g.outer : [[0, 0], [g.W, 0], [g.W, g.Htot], [0, g.Htot]]];
    if (g.antiFloat) solids.push(g.antiFloat.left, g.antiFloat.right);
    if (g.lean) solids.push(g.lean.poly);
    const structArea = solids.reduce((s, pl) => s + clipBandArea(pl, Math.max(yB, -Infinity), yG), 0);
    const sideH = (s) => (s && s.type === '가시설' ? (yG - yB + (s.embed || 0)) : 0);
    return { ex, g, poly, bands, excArea, structArea, backArea: Math.max(0, excArea - structArea), yB, yG, shoreL: sideH(ex.left), shoreR: sideH(ex.right), sta };
}

function earthBlock(ctx, b) {
    const { p, c, o } = ctx;
    const S = new QSet(`e-b${b.index}`, `블럭${b.index + 1} 토공 산출근거`, '토공', { type: 'earth', bi: b.index, sta: b.sta0 });
    const s0 = earthSection(p, c, b.index, b.sta0), s1 = earthSection(p, c, b.index, b.sta1);
    const Lm = f3(b.length);
    const cap = `(STA. ${fmtSta(b.sta0)} ~ STA. ${fmtSta(b.sta1)})`;
    const names = [];
    for (const bd of [...s0.bands, ...s1.bands]) if (!names.includes(bd.name)) names.push(bd.name);
    const exc = [];
    for (const nm of names) {
        const a0 = (s0.bands.find(x => x.name === nm) || { area: 0 }).area / 1e6;
        const a1 = (s1.bands.find(x => x.name === nm) || { area: 0 }).area / 1e6;
        if (a0 + a1 < 1e-6) continue;
        exc.push(S.add({ group: '터파기', spec: nm, unit: 'm³' }, cap, `(${f3(a0)} + ${f3(a1)}) / 2 x ${Lm}`));
    }
    const back = S.add({ group: '되메우기', unit: 'm³' }, cap, `(${f3(s0.backArea / 1e6)} + ${f3(s1.backArea / 1e6)}) / 2 x ${Lm}`,
        { text: `{(${f3(s0.excArea / 1e6)} - ${f3(s0.structArea / 1e6)}) + (${f3(s1.excArea / 1e6)} - ${f3(s1.structArea / 1e6)})} / 2 x ${Lm}` });
    if (exc.length) S.add({ group: '잔토처리', unit: 'm³' }, '(터파기 - 되메우기)', `${exc.map(f3).join(' + ')} - ${f3(back)}`);
    for (const [side, k] of [['좌측', 'shoreL'], ['우측', 'shoreR']]) {
        if (s0[k] > 0 || s1[k] > 0) S.add({ group: '가시설', spec: 'H-Pile + 토류판', unit: 'm²' }, `(${side})`, `(${m(s0[k])} + ${m(s1[k])}) / 2 x ${Lm}`);
    }
    // 기초잡석
    const fr = foundRowOfBlock(c, b.index);
    const g = s0.g;
    if (fr.type === '잡석기초' && n0(fr.rubble) > 0) {
        const W = g.baseX1 - g.baseX0 + 2 * (g.lean ? g.lean.w : 0);
        S.add({ group: '기초잡석', spec: `t=${n0(fr.rubble)}mm`, unit: 'm³' }, '(기초 하부)', `${m(W)} x ${m(n0(fr.rubble))} x ${Lm}`);
    }
    // 유출입부 접속판 하부 잡석채움
    if (parapetApplicable(c)) {
        const pr = getParapet(c);
        const nb = ctx.nb;
        for (const ei of [0, 1]) {
            if ((ei === 0 && b.index !== 0) || (ei === 1 && b.index !== nb - 1)) continue;
            const e = pr.ends[ei];
            if (!e || !e.apron || !e.apron.use || !e.rubble || !e.rubble.use || !(n0(e.rubble.T) > 0)) continue;
            S.add({ group: '잡석채움', spec: `t=${n0(e.rubble.T)}mm`, unit: 'm³' }, `(유출입부-${ei === 0 ? '시점' : '종점'})`,
                `${m(g.W)} x (${m(n0(e.apron.L1))} + ${m(n0(e.apron.L2))}) / 2 x ${m(n0(e.rubble.T))}`);
        }
    }
    void o;
    const sh = S.finish();
    sh.sections = [s0, s1];
    return sh;
}

// ── 전체 ─────────────────────────────────────────────────────────────

/**
 * 수량산출.  opts = { ci, ...옵션 덮어쓰기 }
 */
export function quantities(p, opts = {}) {
    const ci = opts.ci | 0;
    const c = p.culverts[ci];
    const o = merge(getQuantityOptions(p, ci), opts);
    const d = getDesign(p);
    const bl = blocks(c);
    const ctx = { p, c, ci, o, d, nb: bl.length };
    const sheets = [];
    const cname = c.name || `암거${ci + 1}`;

    // ── 일반 ──
    const bodySets = bl.map(b => bodyGeneral(ctx, b.index).finish());
    sheets.push(...bodySets);
    const gBody = summarySheet('g-body', `${cname} 일반수량 집계표`, '일반', bodySets.map((s, i) => ({ sheet: s, name: `Block${i + 1}` })), { type: 'body', bi: 0 });
    sheets.push(gBody);
    const groups = [{ sheet: gBody, name: cname }];
    const treeG = [{ id: gBody.id, label: gBody.name, kind: '집계', children: bodySets.map(s => ({ id: s.id, label: s.name, kind: '산근' })) }];
    const wings = installedWings(c);
    for (const type of ['일체식', '옹벽식']) {
        const ws = wings.filter(w => w.type === type);
        if (!ws.length) continue;
        const sets = ws.map(w => wingGeneral(ctx, w).finish());
        sheets.push(...sets);
        const id = type === '일체식' ? 'g-wi' : 'g-ww';
        const sm = summarySheet(id, `${type} 날개벽 집계표`, '일반', sets.map((s, i) => ({ sheet: s, name: `${WING_NAMES[ws[i].key]}` })), sets[0].fig);
        sm.isWall = type === '옹벽식';
        sheets.push(sm);
        groups.push({ sheet: sm, name: `${type} 날개벽`, isWall: sm.isWall });
        treeG.push({ id, label: sm.name, kind: '집계', children: sets.map(s => ({ id: s.id, label: s.name, kind: '산근' })) });
    }
    if (hasApproach(c)) {
        const list = getApproach(c).list;
        const sets = list.map((a, i) => approachGeneral(ctx, a, i).finish());
        sheets.push(...sets);
        const sm = summarySheet('g-ap', '접속슬래브 집계표', '일반', sets.map((s, i) => ({ sheet: s, name: `접속슬래브${i + 1}` })), sets[0] && sets[0].fig);
        sheets.push(sm);
        groups.push({ sheet: sm, name: '접속슬래브' });
        treeG.push({ id: 'g-ap', label: sm.name, kind: '집계', children: sets.map(s => ({ id: s.id, label: s.name, kind: '산근' })) });
    }
    const gTot = summarySheet('g-total', '일반수량 총괄집계표', '일반', groups.filter(x => o.wallInTotal || !x.isWall), { type: 'body', bi: 0 });
    sheets.push(gTot);

    // ── 공통 (철근) ──
    let sum = { blocks: [], byDia: {}, byCat: {}, total: { net: 0, gross: 0 } };
    try { sum = scheduleSummary(p, c); } catch (e) { console.warn('[quantity] 철근', e); }
    // 철근은 철근 제원(블록별 행, 날개벽·접속슬래브 포함)을 그대로 집계한다
    const rSets = rebarSheets(ctx, sum);
    sheets.push(...rSets);
    const cBody = summarySheet('c-body', `${cname} 철근 집계표`, '공통', rSets.map((s, i) => ({ sheet: s, name: `Block${i + 1}` })), { type: 'rebar', bi: 0 });
    sheets.push(cBody);
    const cMat = rebarMatrix(sum, o);
    sheets.push(cMat);
    const cTot = summarySheet('c-total', '공통수량 총괄집계표', '공통', [{ sheet: cBody, name: cname }], { type: 'rebar', bi: 0 });
    sheets.push(cTot);
    const treeC = [{ id: 'c-body', label: cBody.name, kind: '집계', children: rSets.map(s => ({ id: s.id, label: s.name, kind: '산근' })) }, { id: 'c-matrix', label: '철근집계 (직경 x 부위)', kind: '집계', children: [] }];

    // ── 토공 ──
    let eSets = [];
    try { eSets = bl.map(b => earthBlock(ctx, b)); } catch (e) { console.warn('[quantity] 토공', e); }
    sheets.push(...eSets);
    const eBody = summarySheet('e-body', `${cname} 토공 집계표`, '토공', eSets.map((s, i) => ({ sheet: s, name: `Block${i + 1}` })), { type: 'earth', bi: 0, sta: bl[0] && bl[0].sta0 });
    sheets.push(eBody);
    const eTot = summarySheet('e-total', '토공수량 총괄집계표', '토공', [{ sheet: eBody, name: cname }], eBody.fig);
    sheets.push(eTot);
    const treeE = [{ id: 'e-body', label: eBody.name, kind: '집계', children: eSets.map(s => ({ id: s.id, label: s.name, kind: '산근' })) }];

    const trees = {
        일반: [{ id: 'g-total', label: gTot.name, kind: '집계', children: treeG }],
        공통: [{ id: 'c-total', label: cTot.name, kind: '집계', children: treeC }],
        토공: [{ id: 'e-total', label: eTot.name, kind: '집계', children: treeE }],
    };
    const sumGroup = (sh, grp) => sh.items.filter(r => r.group === grp).reduce((s, r) => s + r.total, 0);
    const totals = {
        concrete: sumGroup(gTot, '콘크리트'),
        concreteBody: bodySets.reduce((s, x) => s + x.items.filter(r => r.group === '콘크리트' && !r.sub).reduce((a, r) => a + r.qty, 0), 0),
        formwork: sumGroup(gTot, '거푸집'),
        rebar: sumGroup(cBody, '철근'),
        rebarNet: sum.total.net / K, rebarGross: sum.total.gross / K,
        excavation: sumGroup(eTot, '터파기'),
        backfill: sumGroup(eTot, '되메우기'),
        surplus: sumGroup(eTot, '잔토처리'),
        length: bl.reduce((s, b) => s + b.length, 0),
    };
    const map = new Map(sheets.map(s => [s.id, s]));
    return { ci, name: cname, opts: o, trees, totals, sheets, sheet: (id) => map.get(id) };
}

// ── Excel (SpreadsheetML 2003) ───────────────────────────────────────

const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

function sheetName(name, used) {
    let s = String(name).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';
    let k = 2;
    const base = s;
    while (used.has(s)) s = `${base.slice(0, 27)}(${k++})`;
    used.add(s);
    return s;
}

/**
 * opts: { sheets:[id] (없으면 전체), refSummary, refBasis, title }
 * 산근: A 공종 | B 번호 | C 산출근거 | D 수량 | E 단위   ('계' 행 = SUM)
 * 집계: A 공종 | B 규격 | C 구분 | D 단위 | E.. 구조물/블록 | 합계
 */
export function quantityToExcelXml(result, opts = {}) {
    const o = { refSummary: result.opts.refSummary, refBasis: result.opts.refBasis, ...opts };
    const want = opts.sheets ? new Set(opts.sheets) : null;
    // 시트 순서: 탭별 (총괄 → 집계 → 산근)
    const rank = (s) => ({ 일반: 0, 공통: 1, 토공: 2 }[s.tab] ?? 3) * 10 + (s.id.endsWith('total') ? 0 : s.kind === '집계' ? 1 : 2);
    const list = result.sheets.filter(s => !want || want.has(s.id)).slice().sort((a, b) => rank(a) - rank(b));
    const used = new Set();
    const names = new Map(list.map(s => [s.id, sheetName(s.name, used)]));
    // 1차: 주소 (행 번호) 배치
    const addr = new Map();   // `${sheetId}|${key}` → { r, c }
    for (const s of list) {
        if (s.kind === '산근') {
            let r = 4;           // 1 제목, 2 빈 줄, 3 머리
            for (const it of s.items) {
                r++;              // 공종
                for (const cp of it.caps) { r++; r += cp.lines.length; }
                r++;              // 계
                addr.set(`${s.id}|${it.key}`, { r: r - 1, c: 4 });
                r++;              // 빈 줄
            }
        } else {
            s.items.forEach((it, i) => addr.set(`${s.id}|${it.key}`, { r: 4 + i, c: 5 + s.cols.length }));
        }
    }
    const ref = (rf) => {
        if (!rf || !names.has(rf.sheet)) return null;
        const a = addr.get(`${rf.sheet}|${rf.key}`);
        if (!a) return null;
        const target = result.sheet(rf.sheet);
        if (target.kind === '산근' && !o.refBasis) return null;
        if (target.kind === '집계' && !o.refSummary) return null;
        return `='${names.get(rf.sheet).replace(/'/g, "''")}'!R${a.r}C${a.c}`;
    };
    const cell = (v, style, extra = '') => {
        if (v == null || v === '') return `<Cell ss:StyleID="${style}"${extra}/>`;
        if (typeof v === 'number') return `<Cell ss:StyleID="${style}"${extra}><Data ss:Type="Number">${+v.toFixed(6)}</Data></Cell>`;
        return `<Cell ss:StyleID="${style}"${extra}><Data ss:Type="String">${xesc(v)}</Data></Cell>`;
    };
    const fcell = (formula, v, style) => `<Cell ss:StyleID="${style}" ss:Formula="${xesc(formula)}"><Data ss:Type="Number">${+(+v || 0).toFixed(6)}</Data></Cell>`;
    const ws = [];
    for (const s of list) {
        const rows = [];
        let widths;
        if (s.kind === '산근') {
            widths = [130, 34, 380, 90, 50];
            rows.push(`<Row ss:Height="22">${cell(s.name, 'title', ' ss:MergeAcross="4"')}</Row>`, '<Row/>');
            rows.push(`<Row>${['공 종', '', '산 출 근 거', '수 량', '단위'].map(t => cell(t, 'th')).join('')}</Row>`);
            let r = 4;
            for (const it of s.items) {
                rows.push(`<Row>${cell(`${it.no}. ${it.group}`, 'grp')}${cell('', 'tx')}${cell(it.sub ? `[${it.sub}]` : '', 'tx')}${cell('', 'tx')}${cell('', 'tx')}</Row>`); r++;
                const first = r + 1;
                let firstCap = true;
                for (const cp of it.caps) {
                    rows.push(`<Row>${cell(firstCap && it.spec ? `(${it.spec})` : '', 'tx')}${cell('', 'tx')}${cell(cp.cap, 'cap')}${cell('', 'tx')}${cell('', 'tx')}</Row>`); r++;
                    firstCap = false;
                    for (const ln of cp.lines) {
                        r++;
                        const val = o.refBasis ? fcell(`=${exprFormula(ln.expr)}`, ln.value, 'num') : cell(ln.value, 'num');
                        rows.push(`<Row>${cell('', 'tx')}${cell(ln.mark, 'mark')}${cell(ln.text, 'tx')}${val}${cell('', 'tx')}</Row>`);
                    }
                }
                r++;
                const sumF = `=SUM(R${first}C4:R${r - 1}C4)`;
                rows.push(`<Row>${cell('', 'tx')}${cell('', 'tx')}${cell('계', 'sum')}${o.refBasis ? fcell(sumF, it.qty, 'sumnum') : cell(it.qty, 'sumnum')}${cell(it.unit, 'sum')}</Row>`);
                rows.push('<Row/>'); r++;
            }
        } else {
            const nc = s.cols.length;
            widths = [110, 100, 80, 40, ...s.cols.map(() => 80), 90];
            rows.push(`<Row ss:Height="22">${cell(s.name, 'title', ` ss:MergeAcross="${4 + nc}"`)}</Row>`, '<Row/>');
            rows.push(`<Row>${['공 종', '규 격', '구 분', '단위', ...s.cols, '합 계'].map(t => cell(t, 'th')).join('')}</Row>`);
            s.items.forEach((it, i) => {
                const r = 4 + i;
                const vals = it.vals.map((v, k) => {
                    const f = ref(it.refs[k]);
                    if (v == null) return cell('-', 'numc');
                    return f ? fcell(f, v, 'num') : cell(v, 'num');
                }).join('');
                const tot = nc ? fcell(`=SUM(R${r}C5:R${r}C${4 + nc})`, it.total, 'sumnum') : cell(it.total, 'sumnum');
                rows.push(`<Row>${cell(it.group, 'grp')}${cell(it.spec, 'tx')}${cell(it.sub, 'tx')}${cell(it.unit, 'txc')}${vals}${tot}</Row>`);
            });
        }
        ws.push(`<Worksheet ss:Name="${xesc(names.get(s.id))}"><Table>${widths.map(w => `<Column ss:Width="${w}"/>`).join('')}${rows.join('')}</Table>`
            + '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/></PageSetup><FitToPage/></WorksheetOptions></Worksheet>');
    }
    const bd = '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>';
    const font = 'ss:FontName="맑은 고딕" x:CharSet="129"';
    const styles = `<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Font ${font} ss:Size="10"/></Style>
<Style ss:ID="title"><Font ${font} ss:Size="14" ss:Bold="1"/></Style>
<Style ss:ID="th"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${bd}<Font ${font} ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style>
<Style ss:ID="grp">${bd}<Font ${font} ss:Bold="1"/></Style>
<Style ss:ID="cap">${bd}<Font ${font} ss:Color="#1F4E79"/></Style>
<Style ss:ID="tx">${bd}</Style>
<Style ss:ID="txc"><Alignment ss:Horizontal="Center"/>${bd}</Style>
<Style ss:ID="mark"><Alignment ss:Horizontal="Center"/>${bd}</Style>
<Style ss:ID="num"><Alignment ss:Horizontal="Right"/>${bd}<NumberFormat ss:Format="#,##0.000"/></Style>
<Style ss:ID="numc"><Alignment ss:Horizontal="Center"/>${bd}</Style>
<Style ss:ID="sum"><Alignment ss:Horizontal="Center"/>${bd}<Font ${font} ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
<Style ss:ID="sumnum"><Alignment ss:Horizontal="Right"/>${bd}<Font ${font} ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.000"/></Style>
</Styles>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${xesc(opts.title || `${result.name} 수량산출서`)}</Title></DocumentProperties>
${styles}
${ws.join('\n')}
</Workbook>`;
}

/** 시트 그대로 텍스트 표 (미리보기/검증용) */
export function sheetText(sheet) {
    const fmt = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v ?? ''));
    const head = sheet.kind === '산근' ? ['공 종', '', '산 출 근 거', '수 량', '단위'] : ['공 종', '규 격', '구 분', '단위', ...sheet.cols, '합 계'];
    return [head, ...sheet.rows].map(r => r.map(fmt).join('\t')).join('\n');
}
