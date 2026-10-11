// 일반 입력 > 기초부 설정 (매뉴얼 2.8)
// 블록별. [기초 형식]의 형식에 따라 탭이 바뀐다.
//   직접기초/잡석기초 : 기초지반 (허용지지력 자동계산 — Terzaghi/Meyerhof/Hansen, 상한 600 kN/m², FS 3/2)
//   말뚝기초         : 말뚝기초 / 말뚝제원 / 말뚝특성치 / 말뚝배치
// 데이터 culverts[i].foundation = { blocks: [{ kind, method, direct, pile, spec, prop, layout }] }

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bCheck, modal, alertBox } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { REBAR_DIAS, blocks, jointStations } from '../core/model.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { elevationAt } from '../calc/alignment.js';
import { boringAt, getGround } from '../calc/ground.js';
import { BEARING_METHODS, allowableBearing, phiFromN, deformationModulus, verticalSubgrade } from '../calc/bearing.js';
import { PILE_METHODS, defaultPileSpec, pileCapacity, pileProperties, defaultPileLayout, pileSection } from '../calc/pile.js';
import { foundRowOfBlock, FOUND_PILE_TYPES } from '../calc/foundType.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';

const K = 1000;

// ── 데이터 ───────────────────────────────────────────────────────────

function defaultDirect() {
    return { auto: true, qaN: 0, qaE: 0, cap: 600, method: 'Hansen 식', g1: 20, g2: 20, Df: 1, c: 0, EoDirect: 0, EoMult: 2800 };
}
function defaultPileOpt() {
    return { auto: true, RaN: 0, RaE: 0, PaN: 0, PaE: 0, coef: 300, group: false, friction: false, consol: 0, gamma: 20, bentonite: false, stressInc: '적용안함' };
}
function defaultProp() {
    return { auto: true, Kv: 0, KhN: 0, KhE: 0, betaN: 0, betaE: 0, EoDirect: 0, EoMult: 2800, alphaN: 1, alphaE: 2 };
}

/** 기초 폭 (부상방지저판 포함, mm) / 블록 길이 (mm) */
function footing(c, bi) {
    const g = sectionGeom(c, bi);
    const bl = blocks(c)[bi];
    const j = c.joints || [];
    const nb = blocks(c).length;
    const g0 = bi > 0 ? (+(j[bi] || {}).gap || 0) / 2 : 0;
    const g1 = bi < nb - 1 ? (+(j[bi + 1] || {}).gap || 0) / 2 : 0;
    return { g, W: g.baseX1 - g.baseX0, L: (bl ? bl.length * K : 10000) - g0 - g1 };
}

export function defaultFoundBlock(c, bi) {
    const row = foundRowOfBlock(c, bi);
    const kind = row.type === '말뚝기초' ? row.pile : null;
    const spec = defaultPileSpec(kind || '타입강관말뚝');
    const f = footing(c, bi);
    return {
        kind,
        method: { use: false, kind: kind === '현장타설말뚝' ? '현장타설말뚝' : '타입말뚝(타격공법)' },
        direct: defaultDirect(),
        pile: defaultPileOpt(),
        spec,
        prop: defaultProp(),
        layout: { ...defaultPileLayout(spec.D, f.W, f.L), interfere: false, perLen: false },
    };
}

function ensure(ctx) {
    const c = ctx.c;
    const cur = c.foundation;
    const out = cur && Array.isArray(cur.blocks) ? clone(cur) : { blocks: [] };
    out.blocks = blocks(c).map(b => {
        const x = out.blocks[b.index];
        const row = foundRowOfBlock(c, b.index);
        const kind = row.type === '말뚝기초' ? row.pile : null;
        if (!x || !x.direct || !x.layout) return defaultFoundBlock(c, b.index);
        if ((x.kind || null) !== kind && kind) {
            // 말뚝 종류가 바뀌면 말뚝 제원/배치를 새로
            const d = defaultFoundBlock(c, b.index);
            return { ...x, kind, spec: d.spec, layout: d.layout, method: d.method };
        }
        return { ...x, kind };
    });
    if (JSON.stringify(out) !== JSON.stringify(cur)) store.set(`${ctx.cp}.foundation`, out, { record: false, silent: true });
    return c.foundation;
}

// ── 계산 ─────────────────────────────────────────────────────────────

/** 블록 중앙의 기초 하면 EL 과 지반 */
function baseInfo(ctx, bi) {
    const c = ctx.c;
    const b = blocks(c)[bi];
    const sta = b ? (b.sta0 + b.sta1) / 2 : c.startSta;
    const g = sectionGeom(c, bi);
    const ref = elevationAt(ctx.p.alignment.vip, sta);
    const footBot = ref - g.refY / K;                          // 기초(하부슬래브) 하면
    const leanBot = footBot - (g.lean ? g.lean.t / K : 0);
    const bor = boringAt(c, sta);
    return { sta, footBot, leanBot, bor };
}

/** EL 위치의 지층 */
function layerAtEl(bor, el) {
    const ls = bor.layers;
    if (!ls.length) return null;
    let hit = ls[0];
    for (const l of ls) if (l.top >= el - 1e-9) hit = l;
    return hit;
}
const nOf = (l) => (l ? (l.N != null && l.N !== '' ? +l.N : (l.name === '토사' ? 10 : 50)) : 10);

function directCalc(ctx, bi) {
    const blk = ctx.c.foundation.blocks[bi];
    const dr = blk.direct;
    const f = footing(ctx.c, bi);
    const bi0 = baseInfo(ctx, bi);
    const ly = layerAtEl(bi0.bor, bi0.leanBot);
    const N = nOf(ly);
    const phi = phiFromN(N);
    const r = allowableBearing({ method: dr.method, B: f.W / K, L: f.L / K, Df: dr.Df, g1: dr.g1, g2: dr.g2, c: dr.c, phi, cap: dr.cap });
    const Eo = deformationModulus(dr.EoDirect, dr.EoMult, N);
    const kv = verticalSubgrade(Eo, f.W / K, f.L / K, 1);
    return { ...r, N, layer: ly ? ly.name : '-', footEl: bi0.leanBot, Eo, kv, W: f.W, Lb: f.L };
}

function effSpec(ctx, bi) {
    const blk = ctx.c.foundation.blocks[bi];
    const sp = { ...blk.spec };
    const info = baseInfo(ctx, bi);
    const head = info.footBot;
    const tip = head - ((+sp.L || 0) - 100) / K;
    if (sp.autoN) {
        sp.Nhead = nOf(layerAtEl(info.bor, head));
        sp.Ntip = nOf(layerAtEl(info.bor, tip));
    }
    return { sp, head, tip, info };
}

/** 말뚝 주면 지층 [{soil, N, len}] */
function pileLayers(info, head, tip) {
    const ls = info.bor.layers;
    const out = [];
    for (let i = 0; i < ls.length; i++) {
        const top = Math.min(ls[i].top, head);
        const bot = Math.max(i + 1 < ls.length ? ls[i + 1].top : -Infinity, tip);
        if (top > bot) out.push({ name: ls[i].name, soil: '사질토', N: nOf(ls[i]), len: top - bot });
    }
    return out;
}

function pileCalc(ctx, bi) {
    const c = ctx.c;
    const blk = c.foundation.blocks[bi];
    const kind = blk.kind || '타입강관말뚝';
    const { sp, head, tip, info } = effSpec(ctx, bi);
    const layers = pileLayers(info, head, tip);
    const cols = blk.layout.cols || [];
    const spacing = cols.length && cols[0].D.length > 1 ? cols[0].D[1] / K : 0;
    const sec = pileSection(kind, sp);
    const unitW = kind === '현장타설말뚝' || kind === 'PHC말뚝' ? 24.5 : 77;
    const W = sec.A * ((+sp.L || 0) / K) * unitW;
    const cap = pileCapacity({ kind, spec: sp, coef: blk.pile.coef, friction: blk.pile.friction, group: blk.pile.group, bentonite: blk.pile.bentonite, layers, spacing, W });
    const prop = pileProperties({ kind, spec: sp, fck: (c.cip && c.cip.blocks && c.cip.blocks[bi] && c.cip.blocks[bi].main) ? c.cip.blocks[bi].main.fck : 24, EoDirect: blk.prop.auto ? 0 : blk.prop.EoDirect, EoMult: blk.prop.EoMult, alphaN: blk.prop.alphaN, alphaE: blk.prop.alphaE });
    return { kind, sp, head, tip, layers, cap, prop };
}

// ── 속성 그리드 (다단 라벨) ───────────────────────────────────────────

/** items: [{ labels:[...], cell, unit, bold }] */
function propTable(el, id, levels, items, unitHead = '단 위') {
    const rows = items.map((it, i) => {
        const head = [];
        const L = it.labels;
        for (let k = 0; k < L.length; k++) {
            const leaf = k === L.length - 1;
            const prev = items[i - 1];
            const same = (a) => a && a.labels.length - 1 > k && a.labels.slice(0, k + 1).join('|') === L.slice(0, k + 1).join('|');
            if (!leaf && same(prev)) continue;   // 위 행에 병합됨
            let rs = 1;
            if (!leaf) while (i + rs < items.length && same(items[i + rs])) rs++;
            head.push({ t: L[k], rs: rs > 1 ? rs : undefined, cs: leaf && L.length < levels ? levels - k : undefined, cls: it.bold ? 'grp' : (k === 0 ? 'grp' : (leaf ? 'sub' : '')) });
        }
        return { head, cells: [it.cell, lbl(it.unit || '', { cls: 'unitcell' })] };
    });
    new Grid(el, {
        id, cls: 'ag-prop',
        head: [[{ t: '구 분', cs: levels }, { t: '설정값' }, { t: unitHead }]],
        rows,
        colWidths: [...Array.from({ length: levels }, (_, k) => (k === levels - 1 ? 190 : 130)), 110, 70],
    });
}

const chkText = (path, o = {}) => chk(path, { text: store.get(path) ? '적용' : '적용안함', ...o });
const roNum = (fn, dec = 2) => lbl(fn, { dec, cls: 'ro' });

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '기초부 데이터를 입력합니다.',

    tabs(ctx) {
        const row = foundRowOfBlock(ctx.c, ctx.bi);
        if (row.type === '말뚝기초') return [{ id: 'pile', title: '말뚝기초' }, { id: 'spec', title: '말뚝제원' }, { id: 'prop', title: '말뚝특성치' }, { id: 'layout', title: '말뚝배치' }];
        return [{ id: 'ground', title: '기초지반' }];
    },

    header(el, ctx) {
        const fd = ensure(ctx);
        const blk = fd.blocks[ctx.bi];
        const row = foundRowOfBlock(ctx.c, ctx.bi);
        const isPile = row.type === '말뚝기초';
        const kindSel = h('select', { disabled: !isPile });
        (isPile ? FOUND_PILE_TYPES : ['-']).forEach(k => { const o = h('option', { value: k }, k); if (k === row.pile) o.selected = true; kindSel.appendChild(o); });
        kindSel.addEventListener('change', () => store.set(`${ctx.cp}.foundType.rows.${row.index}.pile`, kindSel.value));
        el.appendChild(h('label', {}, ['말뚝종류 ', kindSel]));
        const mp = `${ctx.cp}.foundation.blocks.${ctx.bi}.method`;
        const cb = h('input', { type: 'checkbox', disabled: !isPile });
        cb.checked = !!blk.method.use;
        cb.addEventListener('change', () => store.set(`${mp}.use`, cb.checked));
        const ms = h('select', { disabled: !isPile || !blk.method.use });
        PILE_METHODS.forEach(k => { const o = h('option', { value: k }, k); if (k === blk.method.kind) o.selected = true; ms.appendChild(o); });
        ms.addEventListener('change', () => store.set(`${mp}.kind`, ms.value));
        el.appendChild(h('label', { title: '말뚝 시공방법' }, [cb, ' ', ms]));
    },

    render(el, ctx, tab) {
        const fd = ensure(ctx);
        const bp = `${ctx.cp}.foundation.blocks.${ctx.bi}`;
        const blk = fd.blocks[ctx.bi];
        if (tab === 'ground') renderDirect(el, ctx, bp, blk);
        else if (tab === 'pile') renderPile(el, ctx, bp, blk);
        else if (tab === 'spec') renderSpec(el, ctx, bp, blk);
        else if (tab === 'prop') renderProp(el, ctx, bp, blk);
        else if (tab === 'layout') renderLayout(el, ctx, bp, blk);
    },

    footer(el, ctx, tab) {
        const fd = ensure(ctx);
        const blk = fd.blocks[ctx.bi];
        const isPile = !!blk.kind;
        const bp = `${ctx.cp}.foundation.blocks.${ctx.bi}`;
        el.appendChild(button('전체블럭동일적용', () => applyAll(ctx)));
        el.appendChild(button('PHC 제원 참조', () => phcTable(ctx), { disabled: blk.kind !== 'PHC말뚝' }));
        el.appendChild(bCheck(`${bp}.layout.interfere`, ' 말뚝거리 간섭 체크', { disabled: !isPile }));
        el.appendChild(bCheck(`${bp}.layout.perLen`, ' 말뚝별 길이 입력', { disabled: !isPile }));
        el.appendChild(button('설계검토', () => designReport(ctx)));
    },

    defaults(ctx, tab) {
        const fd = clone(ensure(ctx));
        const d = defaultFoundBlock(ctx.c, ctx.bi);
        const blk = fd.blocks[ctx.bi];
        if (tab === 'ground') blk.direct = d.direct;
        else if (tab === 'pile') blk.pile = d.pile;
        else if (tab === 'spec') blk.spec = d.spec;
        else if (tab === 'prop') blk.prop = d.prop;
        else if (tab === 'layout') blk.layout = { ...d.layout, interfere: blk.layout.interfere, perLen: blk.layout.perLen };
        else fd.blocks[ctx.bi] = d;
        store.set(`${ctx.cp}.foundation`, fd);
    },

    draw(ctx) {
        ensure(ctx);
        return drawFoundation(ctx);
    },
    viewKey: (ctx) => `foundation|${ctx.ci}|${ctx.bi}`,
};

// ── 탭: 기초지반 ──────────────────────────────────────────────────────

function renderDirect(el, ctx, bp, blk) {
    const dp = `${bp}.direct`;
    const dr = blk.direct;
    const auto = !!dr.auto;
    const r = directCalc(ctx, ctx.bi);
    const items = [
        { labels: ['허용지지력 자동계산'], bold: true, cell: chkText(`${dp}.auto`, { hint: '허용지지력 = 극한지지력 / 안전율 (평상시 3, 지진시 2). 해제시 별도 산정값을 직접 입력합니다.' }) },
        { labels: ['계산된 허용지지력', '평상시'], unit: 'kN/m²', cell: auto ? roNum(() => r.qaN) : num(`${dp}.qaN`, { dec: 2, hint: '평상시 허용지지력을 입력합니다.' }) },
        { labels: ['계산된 허용지지력', '지진시'], unit: 'kN/m²', cell: auto ? roNum(() => r.qaE) : num(`${dp}.qaE`, { dec: 2, hint: '지진시 허용지지력을 입력합니다.' }) },
        { labels: ['허용지지력산정시', '허용지지력의 상한값'], unit: 'kN/m²', cell: auto ? num(`${dp}.cap`, { dec: 2, hint: '계산된 허용지지력이 상한값을 넘으면 상한값을 사용합니다. (기본 600 kN/m²)' }) : roNum(() => dr.cap) },
        { labels: ['허용지지력산정시', '산정식'], cell: auto ? sel(`${dp}.method`, BEARING_METHODS, { hint: '극한지지력 산정식 (Terzaghi / Meyerhof / Hansen)' }) : lbl(dr.method, { cls: 'ro' }) },
        { labels: ['허용지지력산정시', '기초지반의 단위중량(r1)'], unit: 'kN/m³', cell: auto ? num(`${dp}.g1`, { dec: 2, hint: '기초지반의 단위중량' }) : roNum(() => dr.g1) },
        { labels: ['허용지지력산정시', '근입지반의 단위중량(r2)'], unit: 'kN/m³', cell: auto ? num(`${dp}.g2`, { dec: 2, hint: '근입지반의 단위중량' }) : roNum(() => dr.g2) },
        { labels: ['허용지지력산정시', '유효 근입깊이(Df)'], unit: 'm', cell: auto ? num(`${dp}.Df`, { dec: 3, hint: '유효 근입깊이 (m)' }) : roNum(() => dr.Df, 3) },
        { labels: ['허용지지력산정시', '기초지반의 점착력(c)'], unit: 'kN/m²', cell: num(`${dp}.c`, { dec: 2, hint: '기초지반의 점착력 (도로설계기준해설 하부구조편 5.5.6 설계를 위한 지반정수)' }) },
        { labels: ['수직 지반변형계수(Eo)', '(Eo = 설정값) , 0 : 자동계산'], unit: 'kN/m²', cell: num(`${dp}.EoDirect`, { dec: 0, hint: '수직 지반변형계수를 직접 입력합니다. 0 이면 설정값×N 으로 계산합니다.' }) },
        { labels: ['수직 지반변형계수(Eo)', '(Eo = 설정값xN)'], unit: 'N', cell: num(`${dp}.EoMult`, { dec: 0, hint: 'Eo = 설정값 × N (기본 2800)' }) },
    ];
    const wrap = h('div', { class: 'dlg-row' });
    const left = h('div');
    propTable(left, 'found-direct', 2, items);
    wrap.appendChild(left);
    wrap.appendChild(h('div', { class: 'note', style: { whiteSpace: 'pre-line', minWidth: '260px' } },
        `[자동계산 근거] BLOCK ${ctx.bi + 1}\n` +
        `기초하면 EL ${r.footEl.toFixed(3)} m, 지층 ${r.layer}, N = ${r.N}\n` +
        `φ = √(15N)+15 = ${r.phi.toFixed(2)}°, c = ${(+r.c).toFixed(1)} kN/m²\n` +
        `B = ${(r.W / K).toFixed(3)} m, L = ${(r.Lb / K).toFixed(3)} m, Df = ${(+r.Df).toFixed(2)} m\n` +
        `Nc = ${r.Nc.toFixed(2)}, Nq = ${r.Nq.toFixed(2)}, Nγ = ${r.Ng.toFixed(2)}\n` +
        `qu = ${r.qu.toFixed(1)} kN/m² (${r.method})\n` +
        `qa = qu/3 = ${r.qaNraw.toFixed(1)}, qu/2 = ${r.qaEraw.toFixed(1)}${r.capped ? `  → 상한 ${r.cap} 적용` : ''}\n` +
        `Eo = ${r.Eo.toFixed(0)} kN/m², kv = ${r.kv.toFixed(0)} kN/m³`));
    el.appendChild(wrap);
}

// ── 탭: 말뚝기초 ──────────────────────────────────────────────────────

function renderPile(el, ctx, bp, blk) {
    const pp = `${bp}.pile`;
    const po = blk.pile;
    const auto = !!po.auto;
    const r = pileCalc(ctx, ctx.bi);
    const cip = blk.kind === '현장타설말뚝';
    const items = [
        { labels: ['지지력', '허용지지력 자동계산'], bold: true, cell: chkText(`${pp}.auto`, { hint: '이전 입력값으로 허용지지력을 자동 계산합니다. (도로교설계기준 해설 5.8)' }) },
        { labels: ['지지력', '계산된 허용지지력', '평상시'], unit: 'kN', cell: auto ? roNum(() => r.cap.RaN) : num(`${pp}.RaN`, { dec: 2 }) },
        { labels: ['지지력', '계산된 허용지지력', '지진시'], unit: 'kN', cell: auto ? roNum(() => r.cap.RaE) : num(`${pp}.RaE`, { dec: 2 }) },
        { labels: ['지지력', '계산된 허용인발력', '평상시'], unit: 'kN', cell: auto ? roNum(() => r.cap.PaN) : num(`${pp}.PaN`, { dec: 2 }) },
        { labels: ['지지력', '계산된 허용인발력', '지진시'], unit: 'kN', cell: auto ? roNum(() => r.cap.PaE) : num(`${pp}.PaE`, { dec: 2 }) },
        { labels: ['허용지지력 산정시', '선단지지력산정시 계수 (qd = 00N)', '(qd = 설정값xN)'], unit: 'kN/m²', cell: auto ? num(`${pp}.coef`, { dec: 0, hint: '선단지지력 qd = 설정값 × N (SI 단위 기본 300)' }) : roNum(() => po.coef, 0) },
        { labels: ['허용지지력 산정시', '설계선택사항', '군말뚝영향 고려'], cell: auto ? chkText(`${pp}.group`, { hint: '무리말뚝의 영향을 고려합니다. (도로교설계기준해설 5.8.5.4)' }) : lbl(po.group ? '적용' : '적용안함', { cls: 'ro' }) },
        { labels: ['허용지지력 산정시', '설계선택사항', '주면 마찰력 고려'], cell: auto ? chkText(`${pp}.friction`, { hint: '주면마찰력을 고려합니다. 인발 검토시에도 주면마찰력으로 허용인발력을 계산합니다.' }) : lbl(po.friction ? '적용' : '적용안함', { cls: 'ro' }) },
        { labels: ['허용지지력 산정시', '설계선택사항', '압밀층의 두께'], unit: 'm', cell: auto && po.friction ? num(`${pp}.consol`, { dec: 3, hint: '압밀층 두께 — 부주면마찰력 15m 조건 비교 (해설 5.8.5.3)' }) : roNum(() => po.consol, 3) },
        { labels: ['허용지지력 산정시', '설계선택사항', '기초지반의 단위중량'], unit: 'kN/m³', cell: auto && po.friction && po.group ? num(`${pp}.gamma`, { dec: 2, hint: '가상케이슨 선단 극한지지력 산정시 r1, r2 공통값' }) : roNum(() => po.gamma) },
        { labels: ['허용지지력 산정시', '설계선택사항', '벤토나이트사용'], cell: auto && cip ? chkText(`${pp}.bentonite`, { hint: '현장타설말뚝 사질토 최대주면마찰력: 벤토나이트 적용 2N, 비적용 5N (kN/m²)' }) : lbl(po.bentonite ? '적용' : '비적용', { cls: 'ro' }) },
        { labels: ['본체검토', '말뚝응력 검토시', '허용응력 증가계수 적용'], cell: sel(`${pp}.stressInc`, ['적용안함', '적용'], { hint: '말뚝 휨응력 검토시 허용응력 증가계수 적용 여부 (기본 비적용)' }) },
    ];
    const wrap = h('div', { class: 'dlg-row' });
    const left = h('div');
    propTable(left, 'found-pile', 3, items);
    wrap.appendChild(left);
    const c = r.cap;
    wrap.appendChild(h('div', { class: 'note', style: { whiteSpace: 'pre-line', minWidth: '260px' } },
        `[자동계산 근거] ${r.kind}\n` +
        `Ap = π×${c.sec.D.toFixed(3)}²/4 = ${c.sec.Atip.toFixed(4)} m²\n` +
        `qd = ${po.coef} × N(${c.Ntip}) = ${c.qd.toFixed(1)} kN/m²\n` +
        `Ru = qd·Ap + U·Σ(Li·fi) = ${c.tip.toFixed(3)} + ${c.fr.toFixed(3)} = ${c.Ru.toFixed(3)} kN\n` +
        `Ra = Ru/3 = ${c.RaN.toFixed(3)} kN (평상시), Ru/2 = ${c.RaE.toFixed(3)} kN (지진시)` +
        (c.groupNote ? `\n무리말뚝 효율 E = ${c.groupNote.eff.toFixed(3)}` : '')));
    el.appendChild(wrap);
}

// ── 탭: 말뚝제원 ──────────────────────────────────────────────────────

function renderSpec(el, ctx, bp, blk) {
    const sp = `${bp}.spec`;
    const s = blk.spec;
    const cip = blk.kind === '현장타설말뚝';
    const eff = effSpec(ctx, ctx.bi).sp;
    const items = [
        { labels: ['말뚝본체', '말뚝제원', '말뚝의 직경(D)'], unit: 'mm', cell: num(`${sp}.D`, { dec: 0, hint: '말뚝의 직경' }) },
        { labels: ['말뚝본체', '말뚝제원', '말뚝의 길이(L)'], unit: 'mm', cell: num(`${sp}.L`, { dec: 0, hint: '말뚝의 길이 (계산서에서는 기초에 묻힌 100mm 를 제외)' }) },
        { labels: ['말뚝본체', '말뚝제원', '말뚝의 두께(t)'], unit: 'mm', cell: cip ? dash() : num(`${sp}.t`, { dec: 0, hint: '말뚝의 두께' }) },
        { labels: ['말뚝본체', '말뚝제원', '말뚝의 부식두께'], unit: 'mm', cell: cip ? dash() : num(`${sp}.corr`, { dec: 0, hint: '부식두께 (단면 계산시 외경에서 제외)' }) },
        { labels: ['말뚝본체', '말뚝설치조건', '말뚝선단의 근입깊이(Df)'], unit: 'mm', cell: num(`${sp}.Df`, { dec: 0, hint: '말뚝선단의 근입깊이' }) },
        { labels: ['말뚝본체', '말뚝설치조건', '원지반으로부터 돌출된 길이(h)'], unit: 'mm', cell: num(`${sp}.h`, { dec: 0, hint: '원지반으로부터 돌출된 길이' }) },
        { labels: ['말뚝본체', '말뚝지반특성', '말뚝지반 자동설정'], cell: chkText(`${sp}.autoN`, { hint: '[지반 정보]에서 말뚝머리/선단의 평균 N 값을 자동 설정합니다.' }) },
        { labels: ['말뚝본체', '말뚝지반특성', '말뚝머리의 평균 N치'], cell: s.autoN ? roNum(() => eff.Nhead, 0) : num(`${sp}.Nhead`, { dec: 0 }) },
        { labels: ['말뚝본체', '말뚝지반특성', '말뚝선단의 평균 N치'], cell: s.autoN ? roNum(() => eff.Ntip, 0) : num(`${sp}.Ntip`, { dec: 0 }) },
        { labels: ['기초결합부', '두부보강철근', '직경(D)'], cell: sel(`${sp}.headDia`, REBAR_DIAS, { hint: '말뚝과 확대기초 결합부 두부보강철근 직경 (방법B)' }) },
        { labels: ['기초결합부', '두부보강철근', '개수(Ea)'], cell: num(`${sp}.headEa`, { dec: 0, hint: '두부보강철근 개수' }) },
        { labels: ['기초결합부', '가상철근콘크리트', '단면응력검토'], cell: chkText(`${sp}.virtualRC`, { hint: '말뚝머리 가상철근콘크리트 단면의 콘크리트/철근 응력 검토 (그림 5.8.34)' }) },
    ];
    propTable(el, 'found-spec', 3, items);
}

// ── 탭: 말뚝특성치 ────────────────────────────────────────────────────

function renderProp(el, ctx, bp, blk) {
    const pp = `${bp}.prop`;
    const pr = blk.prop;
    const auto = !!pr.auto;
    const r = pileCalc(ctx, ctx.bi).prop;
    const items = [
        { labels: ['설정값 자동계산'], bold: true, cell: chkText(`${pp}.auto`, { hint: 'Kv, Kh, β, Eo 를 도로교설계기준 해설 5.8.8 의 식으로 자동 계산합니다.' }) },
        { labels: ['말뚝의 축방향 스프링정수(Kv)'], unit: 'kN/m', cell: auto ? roNum(() => r.Kv, 3) : num(`${pp}.Kv`, { dec: 3 }) },
        { labels: ['수평방향 지반반력 계수 (Kh)', '평상시'], unit: 'kN/m³', cell: auto ? roNum(() => r.normal.kH, 5) : num(`${pp}.KhN`, { dec: 5 }) },
        { labels: ['수평방향 지반반력 계수 (Kh)', '지진시'], unit: 'kN/m³', cell: auto ? roNum(() => r.seismic.kH, 5) : num(`${pp}.KhE`, { dec: 5 }) },
        { labels: ['말뚝의 탄성치 (β)', '평상시'], unit: 'm-1', cell: auto ? roNum(() => r.normal.beta, 5) : num(`${pp}.betaN`, { dec: 5 }) },
        { labels: ['말뚝의 탄성치 (β)', '지진시'], unit: 'm-1', cell: auto ? roNum(() => r.seismic.beta, 5) : num(`${pp}.betaE`, { dec: 5 }) },
        { labels: ['수평 지반변형계수(Eo)', '(Eo = 설정값)'], unit: 'kN/m²', cell: auto ? roNum(() => r.Eo, 0) : num(`${pp}.EoDirect`, { dec: 0 }) },
        { labels: ['수평 지반변형계수(Eo)', '(Eo = 설정값xN)'], unit: 'N', cell: auto ? num(`${pp}.EoMult`, { dec: 0, hint: 'Eo = 설정값 × N (기본 2800)' }) : roNum(() => pr.EoMult, 0) },
        { labels: ['지반반력계수 계산시 α값 적용', '평상시'], cell: num(`${pp}.alphaN`, { dec: 0, hint: 'α (평상시 기본 1)' }) },
        { labels: ['지반반력계수 계산시 α값 적용', '지진시'], cell: num(`${pp}.alphaE`, { dec: 0, hint: 'α (지진시 기본 2)' }) },
    ];
    const wrap = h('div', { class: 'dlg-row' });
    const left = h('div');
    propTable(left, 'found-prop', 2, items);
    wrap.appendChild(left);
    wrap.appendChild(h('div', { class: 'note', style: { whiteSpace: 'pre-line', minWidth: '260px' } },
        `Ap = ${r.sec.A.toFixed(4)} m², a = 0.014(L/D)+0.78 계열 = ${r.a.toFixed(3)}\n` +
        `Kv = a·Ap·Ep/L = ${r.Kv.toFixed(3)} kN/m (L = ${r.L.toFixed(3)} m)\n` +
        `Eo = ${r.Eo.toFixed(0)} kN/m², EI = ${r.EI.toFixed(1)} kN·m²\n` +
        `βL = ${r.normal.betaL.toFixed(3)} ${r.normal.betaL >= 3 ? '≥ 3 ∴ 반무한장 말뚝' : '< 3 ∴ 유한장 말뚝'}`));
    el.appendChild(wrap);
}

// ── 탭: 말뚝배치 ──────────────────────────────────────────────────────

function renderLayout(el, ctx, bp, blk) {
    const lp = `${bp}.layout`;
    const lay = blk.layout;
    const cols = lay.cols || [];
    const f = footing(ctx.c, ctx.bi);
    const nMax = Math.max(1, ...cols.map(c => c.n));
    // 말뚝수 선택
    const nL = h('select', {});
    for (let i = 1; i <= 30; i++) { const o = h('option', { value: i }, String(i)); if (i === cols.length) o.selected = true; nL.appendChild(o); }
    nL.addEventListener('change', () => setLongCount(ctx, +nL.value));
    const nT = h('select', {});
    for (let i = 1; i <= 30; i++) { const o = h('option', { value: i }, String(i)); if (i === nMax) o.selected = true; nT.appendChild(o); }
    nT.addEventListener('change', () => setTransCount(ctx, +nT.value));
    el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '4px' } }, [
        h('label', {}, ['길이방향 말뚝수 ', nL]), h('label', {}, ['단면방향 말뚝수 ', nT]),
        h('span', {}, `기초폭 ${fmtLen(f.W)} mm, 블록길이 ${fmtLen(f.L)} mm`),
    ]));
    const rows = [];
    rows.push({ head: [{ t: '거리', cs: 2 }], cells: cols.map((c, i) => num(`${lp}.cols.${i}.dist`, { dec: 0, hint: i === 0 ? '기초 시점에서 첫 번째 말뚝열까지의 거리(mm)' : '말뚝열 간격(mm)' })) });
    rows.push({
        head: [{ t: '본수', cs: 2 }], cells: cols.map((c, i) => custom('select', () => c.n, (v) => setColN(ctx, i, +v), {
            options: Array.from({ length: nMax }, (_, k) => ({ value: k + 1, label: `${k + 1}본` })), hint: '해당 열의 말뚝 본수를 선택합니다.',
        })),
    });
    for (let k = 0; k < nMax; k++) {
        const dCells = cols.map((c, i) => (k < c.n ? num(`${lp}.cols.${i}.D.${k}`, { dec: 0, hint: k === 0 ? 'D1: 기초 연단에서 첫 말뚝까지의 거리(mm)' : `D${k + 1}: 말뚝 간격(mm)` }) : dash()));
        if (lay.perLen) {
            rows.push({ head: [{ t: String(k + 1), rs: lay.interfere ? 3 : 2 }, { t: `D${k + 1}` }], cells: dCells });
            rows.push({ head: [{ t: `L${k + 1}` }], cells: cols.map((c, i) => (k < c.n ? num(`${lp}.cols.${i}.lens.${k}`, { dec: 0, hint: '말뚝 길이(mm)' }) : dash())) });
            if (lay.interfere) rows.push({ head: [{ t: `A${k + 1}` }], cells: cols.map((c, i) => (k < c.n ? num(`${lp}.cols.${i}.A.${k}`, { dec: 1, hint: '경사말뚝 각도(°) — 연직 0' }) : dash())) });
        } else {
            rows.push({ head: [{ t: `D${k + 1}`, cs: 2 }], cells: dCells });
            if (lay.interfere) rows.push({ head: [{ t: `A${k + 1}`, cs: 2 }], cells: cols.map((c, i) => (k < c.n ? num(`${lp}.cols.${i}.A.${k}`, { dec: 1, hint: '경사말뚝 각도(°) — 연직 0' }) : dash())) });
        }
    }
    rows.push({ head: [{ t: '우측연단', cs: 2 }], cells: cols.map(c => lbl(() => Math.round(f.W - c.D.slice(0, c.n).reduce((a, b) => a + (+b || 0), 0)), { cls: 'ro', dec: 0, hint: '뒷굽연단 = 기초폭 − ΣD (자동계산)' })) });
    if (!lay.perLen) rows.push({ head: [{ t: '길이', cs: 2 }], cells: cols.map((c, i) => num(`${lp}.cols.${i}.len`, { dec: 0, hint: '말뚝 길이(mm)' })) });
    new Grid(el, {
        id: 'found-layout',
        head: [[{ t: '구분', cs: 2 }, ...cols.map((_, i) => ({ t: `L${i + 1}` }))]],
        rows,
        colWidths: [40, 60, ...cols.map(() => 70)],
    });
    const restL = f.L - cols.reduce((a, c) => a + (+c.dist || 0), 0);
    el.appendChild(h('div', { class: 'note' }, `종점측 연단거리 = ${fmtLen(restL)} mm`));
}

function mutLayout(ctx, fn) {
    const fd = clone(ensure(ctx));
    fn(fd.blocks[ctx.bi].layout, fd.blocks[ctx.bi]);
    store.set(`${ctx.cp}.foundation`, fd);
}

function setLongCount(ctx, n) {
    mutLayout(ctx, (lay) => {
        const cols = lay.cols;
        while (cols.length > n) cols.pop();
        while (cols.length < n) {
            const last = cols[cols.length - 1] || { dist: 1000, n: 2, D: [1000, 1500], len: 10000, A: [0, 0], lens: [10000, 10000] };
            cols.push({ ...clone(last), dist: cols.length ? (cols[1] ? cols[1].dist : last.dist) : last.dist });
        }
    });
}

function setTransCount(ctx, n) {
    mutLayout(ctx, (lay) => {
        lay.cols.forEach(c => {
            const S = c.D[1] || c.D[0] || 1500;
            while (c.D.length < n) c.D.push(S);
            while ((c.A || (c.A = [])).length < n) c.A.push(0);
            while ((c.lens || (c.lens = [])).length < n) c.lens.push(c.len || 10000);
            c.D = c.D.slice(0, n); c.A = c.A.slice(0, n); c.lens = c.lens.slice(0, n);
            c.n = n;
        });
    });
}

function setColN(ctx, i, n) {
    mutLayout(ctx, (lay) => {
        const c = lay.cols[i];
        const S = c.D[1] || c.D[0] || 1500;
        while (c.D.length < n) c.D.push(S);
        while ((c.A || (c.A = [])).length < n) c.A.push(0);
        while ((c.lens || (c.lens = [])).length < n) c.lens.push(c.len || 10000);
        c.n = n;
    });
}

function applyAll(ctx) {
    const fd = clone(ensure(ctx));
    const src = fd.blocks[ctx.bi];
    const kind = src.kind || null;
    let n = 0;
    fd.blocks = fd.blocks.map((b, i) => {
        if (i === ctx.bi || (b.kind || null) !== kind) return b;
        n++;
        return clone(src);
    });
    store.set(`${ctx.cp}.foundation`, fd);
    ctx.setHint && ctx.setHint(`BLOCK ${ctx.bi + 1} 의 기초부 설정을 같은 기초형식의 ${n}개 블록에 적용했습니다.`);
}

const PHC = [
    // D, t(mm), 종별 A/B/C 유효프리스트레스(MPa)
    [350, 60], [400, 65], [450, 70], [500, 80], [600, 90], [700, 100], [800, 110],
];

function phcTable(ctx) {
    const tb = h('table', { class: 'report' });
    tb.appendChild(h('tr', {}, ['직경 D(mm)', '두께 t(mm)', '단면적(cm²)', '단면2차모멘트(cm⁴)', 'A종 σe(MPa)', 'B종 σe(MPa)', 'C종 σe(MPa)', ''].map(t => h('th', {}, t))));
    for (const [D, t] of PHC) {
        const A = Math.PI / 4 * (D * D - (D - 2 * t) ** 2) / 100;
        const I = Math.PI / 64 * (D ** 4 - (D - 2 * t) ** 4) / 1e4;
        tb.appendChild(h('tr', {}, [
            h('td', { class: 'num' }, String(D)), h('td', { class: 'num' }, String(t)), h('td', { class: 'num' }, A.toFixed(1)), h('td', { class: 'num' }, I.toFixed(0)),
            h('td', { class: 'num' }, '4.0'), h('td', { class: 'num' }, '8.0'), h('td', { class: 'num' }, '10.0'),
            h('td', {}, [button('선택', () => {
                store.transact(() => {
                    store.set(`${ctx.cp}.foundation.blocks.${ctx.bi}.spec.D`, D);
                    store.set(`${ctx.cp}.foundation.blocks.${ctx.bi}.spec.t`, t);
                });
                dlg.close();
            })]),
        ]));
    }
    const dlg = modal({ title: 'PHC 제원 참조 (KS F 4306)', body: h('div', {}, [tb]), buttons: [{ text: '닫기' }] });
}

function designReport(ctx) {
    const fd = ensure(ctx);
    const blk = fd.blocks[ctx.bi];
    const lines = [];
    const box = h('div', { class: 'report', style: { maxHeight: '520px', overflow: 'auto', minWidth: '560px' } });
    const add = (tag, txt) => box.appendChild(h(tag, {}, txt));
    const table = (head, rows) => {
        const t = h('table', {});
        t.appendChild(h('tr', {}, head.map(x => h('th', {}, x))));
        rows.forEach(r => t.appendChild(h('tr', {}, r.map(x => h('td', { class: typeof x === 'number' ? 'num' : '' }, typeof x === 'number' ? x.toFixed(3) : String(x))))));
        box.appendChild(t);
    };
    if (!blk.kind) {
        const r = directCalc(ctx, ctx.bi);
        const dr = blk.direct;
        add('h2', `BLOCK ${ctx.bi + 1} 직접기초 지지력 검토`);
        add('h3', '1) 기초지반');
        table(['항목', '값', '단위'], [
            ['기초하면 EL', r.footEl, 'm'], ['지층', r.layer, ''], ['N 값', r.N, ''], ['내부마찰각 φ = √(15N)+15', r.phi, '°'],
            ['점착력 c', +dr.c, 'kN/m²'], ['기초폭 B', r.W / K, 'm'], ['기초길이 L', r.Lb / K, 'm'], ['근입깊이 Df', +dr.Df, 'm'],
        ]);
        add('h3', `2) 극한지지력 (${r.method})`);
        table(['Nc', 'Nq', 'Nγ', 'c 항', 'q 항', 'γ 항', 'qu (kN/m²)'], [[r.Nc, r.Nq, r.Ng, r.terms.c, r.terms.q, r.terms.g, r.qu]]);
        add('h3', '3) 허용지지력');
        const qaN = dr.auto ? r.qaN : +dr.qaN, qaE = dr.auto ? r.qaE : +dr.qaE;
        table(['구분', 'qu/FS', '상한값', '허용지지력 qa (kN/m²)'], [
            ['평상시 (FS=3)', r.qaNraw, r.cap, qaN], ['지진시 (FS=2)', r.qaEraw, r.cap, qaE],
        ]);
        add('p', `수직 지반변형계수 Eo = ${r.Eo.toFixed(0)} kN/m², 연직 지반반력계수 kv = ${r.kv.toFixed(0)} kN/m³`);
    } else {
        const r = pileCalc(ctx, ctx.bi);
        const c = r.cap;
        add('h2', `BLOCK ${ctx.bi + 1} 말뚝기초 검토 (${r.kind})`);
        add('h3', '1) 말뚝의 제원');
        table(['말뚝 종류', '직경(mm)', '두께(mm)', '부식두께(mm)', '길이(m)'], [[r.kind, +r.sp.D, +r.sp.t || 0, +r.sp.corr || 0, ((+r.sp.L || 0) - 100) / K]]);
        add('p', `말뚝머리 평균 N = ${r.sp.Nhead}, 말뚝선단 평균 N = ${r.sp.Ntip}, 말뚝머리 EL ${r.head.toFixed(3)} m, 선단 EL ${r.tip.toFixed(3)} m`);
        add('h3', '2) 말뚝의 허용지지력');
        add('p', `Ru = qd × Ap + U × Σ(Li × fi) ; qd = ${blk.pile.coef} × N = ${c.qd.toFixed(1)} kN/m², Ap = ${c.sec.Atip.toFixed(4)} m², U = ${c.sec.U.toFixed(3)} m`);
        if (c.rows.length) table(['U', 'N-치', '토질분류', '토층심도', 'f(kN/m²)', '주면마찰력(U*f*L)'], [...c.rows.map(x => [x.U, x.N, x.soil, x.len, x.f, x.v]), ['계', '-', '-', '-', '-', c.fr]]);
        table(['구분', 'Ru (kN)', 'Ra (kN)', '허용인발력 (kN)'], [['평상시', c.Ru, c.RaN, c.PaN], ['지진시', c.Ru, c.RaE, c.PaE]]);
        const pr = r.prop;
        add('h3', '3) 말뚝의 특성치');
        add('p', `Kv = a × Ap × Ep / L = ${pr.a.toFixed(3)} × ${pr.sec.A.toFixed(4)} × ${(pr.Ep / 1e3).toFixed(0)}×10³ / ${pr.L.toFixed(3)} = ${pr.Kv.toFixed(3)} kN/m`);
        add('p', `Eo = ${pr.Eo.toFixed(0)} kN/m² — 수평저항에 관여하는 지반의 깊이 (평상시)`);
        table(['가정된 1/β(m)', '계산치 1/β(m)', 'Kh(kN/m³)'], pr.normal.iter.map(x => [x.assumed, x.calc, x.kH]));
        add('p', `Kh = ${pr.normal.kH.toFixed(2)} kN/m³ ; β = ${pr.normal.beta.toFixed(3)} m⁻¹ ; βL = ${pr.normal.betaL.toFixed(3)} ${pr.normal.betaL >= 3 ? '≥ 3 ∴ 반무한장 말뚝으로 설계한다.' : '< 3 ∴ 유한장 말뚝으로 설계한다.'}`);
        add('p', `지진시 : Kh = ${pr.seismic.kH.toFixed(2)} kN/m³ ; β = ${pr.seismic.beta.toFixed(3)} m⁻¹`);
    }
    void lines;
    modal({ title: '기초부 설계검토', body: box, buttons: [{ text: '닫기' }], width: 680 });
}

// ── 입력결과 확인창 ───────────────────────────────────────────────────

function drawFoundation(ctx) {
    const c = ctx.c, bi = ctx.bi;
    const blk = c.foundation.blocks[bi];
    const f = footing(c, bi);
    const g = f.g;
    const th = Math.max(120, Math.min(500, Math.max(f.L, f.W, g.Htot * 2) / 45));
    const d = new Drawing({ textHeight: th });
    const piles = blk.kind ? pilePositions(blk.layout) : [];
    const D = blk.kind ? +blk.spec.D || 500 : 0;
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const pileSt = { color: COLOR.YELLOW, layer: 'PILE' };
    const j = c.joints || [];
    const cot = (a) => { const r = (+a || 90) * Math.PI / 180; return Math.abs(Math.sin(r)) < 1e-6 ? 0 : Math.cos(r) / Math.sin(r); };
    const k0 = cot((j[bi] || {}).angle), k1 = cot((j[bi + 1] || {}).angle);
    const W = f.W, L = f.L;
    // 1) 평면 (위)
    const xs = (y) => (y - W / 2) * k0, xe = (y) => L + (y - W / 2) * k1;
    d.pline([[xs(0), 0], [xe(0), 0], [xe(W), W], [xs(W), W]], { ...cy, closed: true });
    const ext = g.antiFloat ? g.antiFloat.brW : 0;
    for (const yy of [ext, W - ext]) if (ext > 0) d.line(xs(yy), yy, xe(yy), yy, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    d.line(xs(W / 2) - th * 2, W / 2, xe(W / 2) + th * 2, W / 2, { color: COLOR.RED, dash: 'center', layer: 'CENTER' });
    for (const p of piles) {
        const y = W - p.y;   // 단면 좌측 = 평면 위
        d.circle(xs(y) + p.x, y, D / 2, pileSt);
    }
    d.dimH(xs(W), xe(W), W, W + th * 2.5, fmtLen(L));
    d.dimV(0, W, Math.min(xs(0), xs(W)), Math.min(xs(0), xs(W)) - th * 2.5, fmtLen(W));
    d.text(L / 2, W + th * 5, `BLOCK ${bi + 1} 평면도 — ${blk.kind ? `말뚝기초 (${blk.kind}, ${piles.length}본)` : foundRowOfBlock(c, bi).type}`, { color: COLOR.YELLOW, h: th, layer: 'TEXT' });

    // 2) 아래 줄: 시점 단면 / 종단면 / 종점 단면
    const rowTop = -th * 6;
    const secH = g.Htot + (g.lean ? g.lean.t : 0);
    const pileLen = blk.kind ? Math.max(...(piles.length ? piles.map(p => p.len) : [10000])) : 0;
    const yBase = rowTop - secH - th * 4;               // 단면 하면(y=0) 위치
    const sub = (x0, draw) => { const s = new Drawing({ textHeight: sectionTextHeight(c, bi) }); draw(s); return s; };
    const sectionWithPiles = (s) => {
        drawSection(s, c, bi, { names: false });
        if (blk.kind) {
            const col0 = blk.layout.cols[0];
            if (col0) {
                let x = g.baseX0;
                for (let k = 0; k < col0.n; k++) {
                    x += +col0.D[k] || 0;
                    const len = blk.layout.perLen ? +(col0.lens || [])[k] || col0.len : col0.len;
                    const y0 = -(g.lean ? g.lean.t : 0);
                    s.rect(x - D / 2, y0 - len, D, len, pileSt);
                }
            }
        }
    };
    const s1 = sub(0, sectionWithPiles), s3 = sub(0, sectionWithPiles);
    const b1 = s1.bbox();
    const gapX = th * 8;
    // 종단면
    const s2 = new Drawing({ textHeight: sectionTextHeight(c, bi) });
    {
        const lt = g.lean ? g.lean.t : 0;
        s2.rect(0, 0, L, g.Htot, cy);
        if (lt) s2.rect(-100, -lt, L + 200, lt, cy);
        if (g.kind !== 'U') {
            s2.line(0, g.LT, L, g.LT, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
            s2.line(0, g.Htot - g.UT, L, g.Htot - g.UT, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        }
        const info = baseInfo(ctx, bi);
        const gw = getGround(c);
        const toY = (el) => (el - info.footBot) * K;
        if (gw.use['지하수위'] && info.bor.gwl != null) s2.line(-L * 0.1, toY(info.bor.gwl), L * 1.1, toY(info.bor.gwl), { color: COLOR.GREEN, layer: 'GROUND' });
        for (const ly of info.bor.layers) s2.line(-L * 0.1, toY(ly.top), L * 1.1, toY(ly.top), { color: ly.name === '토사' ? COLOR.MAGENTA : COLOR.RED, dash: ly.name === '토사' ? null : 'dash', layer: 'GROUND' });
        if (blk.kind) {
            let x = 0;
            blk.layout.cols.forEach(col => {
                x += +col.dist || 0;
                s2.rect(x - D / 2, -lt - col.len, D, col.len, pileSt);
            });
        }
        const sth = s2.textHeight;
        s2.dimH(0, L, g.Htot, g.Htot + sth * 3, fmtLen(L));
        s2.elMark(0, g.Htot, info.footBot + g.Htot / K, { h: sth * 0.7, align: 'right' });
        s2.elMark(L, g.Htot, info.footBot + g.Htot / K, { h: sth * 0.7 });
        s2.elMark(0, 0, info.footBot, { h: sth * 0.7, down: true, align: 'right' });
        s2.text(L / 2, -lt - sth * 1.5 - pileLen, '종단면', { color: COLOR.GREEN, h: sth, valign: 'top', layer: 'TEXT' });
    }
    const b2 = s2.bbox();
    const b3 = s3.bbox();
    let x = 0;
    const put = (s, b, title) => {
        const dx = x - b.minX, dy = yBase;
        d.merge(s, dx, dy, 1);
        if (title) d.text(dx + (b.minX + b.maxX) / 2, dy + b.minY - th * 0.5, title, { color: COLOR.GREEN, h: th * 0.8, valign: 'top', layer: 'TEXT' });
        x += b.w + gapX;
    };
    put(s1, b1, `시점 단면 (STA. ${(blocks(c)[bi] ? blocks(c)[bi].sta0 : c.startSta).toFixed(3)})`);
    put(s2, b2, null);
    put(s3, b3, `종점 단면 (STA. ${(blocks(c)[bi] ? blocks(c)[bi].sta1 : c.startSta).toFixed(3)})`);
    d.legend = `BLOCK ${bi + 1} : ${blk.kind ? `말뚝기초 (${blk.kind})` : foundRowOfBlock(c, bi).type}`;
    void jointStations;
    return d;
}

/** 말뚝 위치 (x: 블록 시점에서, y: 기초 좌측연단에서, mm) */
function pilePositions(lay) {
    const out = [];
    let x = 0;
    (lay.cols || []).forEach(col => {
        x += +col.dist || 0;
        let y = 0;
        for (let k = 0; k < col.n; k++) {
            y += +col.D[k] || 0;
            out.push({ x, y, len: lay.perLen ? +(col.lens || [])[k] || col.len : col.len });
        }
    });
    return out;
}
