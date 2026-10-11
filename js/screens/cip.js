// 일반 입력 > 현장 타설 말뚝 제원 (매뉴얼 2.9)
// [기초 형식]의 말뚝형식이 현장타설말뚝인 블록에서만 사용. 말뚝의 상세 철근 배치.
// 탭: 주철근 배치 / 띠철근 배치 / 크로스 타이 배치
// 데이터 culverts[i].cip = { horiz, blocks: [{ zones, layers, main, hoop, tie }] }

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, custom } from '../ui/cells.js';
import { h, box, bCheck, modal } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { REBAR_DIAS, blocks } from '../core/model.js';
import { blockPileType } from '../calc/foundType.js';
import { defaultPileSpec } from '../calc/pile.js';

const TABS = [{ id: 'main', title: '주철근 배치' }, { id: 'hoop', title: '띠철근 배치' }, { id: 'tie', title: '크로스 타이 배치' }];
const BAR_D = { D10: 9.53, D13: 12.7, D16: 15.9, D19: 19.1, D22: 22.2, D25: 25.4, D29: 28.6, D32: 31.8, D35: 34.9, D38: 38.1, D41: 41.3, D51: 50.8 };
const barD = (d) => BAR_D[d] || 22;
const barA = (d) => Math.PI / 4 * barD(d) ** 2;

const isCipBlock = (c, bi) => blockPileType(c, bi) === '현장타설말뚝';

/** 블록 말뚝 제원 (기초부 설정) */
function pileOf(c, bi) {
    const s = c.foundation && c.foundation.blocks && c.foundation.blocks[bi] && c.foundation.blocks[bi].spec;
    const d = defaultPileSpec('현장타설말뚝');
    return { D: +(s && s.D) || d.D, L: +(s && s.L) || d.L };
}

export function defaultCipBlock(c, bi) {
    const { D, L } = pileOf(c, bi);
    const dc = 150;
    const ea = Math.max(6, Math.round(Math.PI * (D - 2 * dc) / 200));
    const L1 = 3000;
    const half = Math.round((D - 2 * dc) / 2);
    return {
        zones: 2, layers: 1,
        main: { fck: 24, fy: 300, dc1: dc, dia1: 'D25', ea1: ea, uL: 1200, dc2: dc + 100, dia2: 'D22', ea2: Math.max(6, ea - 4), L: [L1, Math.max(0, L - 100 - dc - L1)], dia: ['D22', 'D22'] },
        hoop: { dia: 'D16', L1: 2 * D, L2: 3000, ctc: [150, 300, 500] },
        tie: { dia: 'D16', C1: half, B: 0, C: 0, F1: half, E: 0, F: 0, ctc: [150, 300, 500] },
    };
}

function ensure(ctx) {
    const c = ctx.c;
    const cur = c.cip;
    const out = cur && Array.isArray(cur.blocks) ? clone(cur) : { horiz: false, blocks: [] };
    out.blocks = blocks(c).map(b => {
        const x = out.blocks[b.index];
        if (!isCipBlock(c, b.index)) return x || null;
        return x && x.main && x.hoop && x.tie ? x : defaultCipBlock(c, b.index);
    });
    if (out.horiz == null) out.horiz = false;
    if (JSON.stringify(out) !== JSON.stringify(cur)) store.set(`${ctx.cp}.cip`, out, { record: false, silent: true });
    return c.cip;
}

function setZones(ctx, n) {
    const cp = clone(ensure(ctx));
    const b = cp.blocks[ctx.bi];
    const { L } = pileOf(ctx.c, ctx.bi);
    const m = b.main;
    while (m.L.length < n) { m.L.push(1000); m.dia.push(m.dia[m.dia.length - 1] || 'D22'); }
    m.L = m.L.slice(0, n); m.dia = m.dia.slice(0, n);
    const rest = L - 100 - (+m.dc1 || 0) - m.L.slice(0, n - 1).reduce((a, v) => a + (+v || 0), 0);
    m.L[n - 1] = Math.max(0, Math.round(rest));
    b.zones = n;
    store.set(`${ctx.cp}.cip`, cp);
}

export default {
    scope: 'culvert',
    perBlock: true,
    enabled: (ctx) => !!ctx.c && blocks(ctx.c).some(b => isCipBlock(ctx.c, b.index)),
    hint: '주철근1구간(L1)에 사용되는 철근의 길이를 설정합니다.',
    tabs: () => TABS,

    render(el, ctx, tab) {
        const cp = ensure(ctx);
        if (!isCipBlock(ctx.c, ctx.bi)) {
            el.appendChild(h('div', { class: 'note' }, `BLOCK ${ctx.bi + 1} 은(는) 현장타설말뚝 기초가 아닙니다. [기초 형식]에서 말뚝형식을 확인하십시오.`));
            return;
        }
        const bp = `${ctx.cp}.cip.blocks.${ctx.bi}`;
        const b = cp.blocks[ctx.bi];
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        if (tab === 'main') {
            const m = b.main, mp = `${bp}.main`;
            const head = [{ t: 'fck' }, { t: 'fy' }, { t: 'dc1' }, { t: 'Dia1' }, { t: 'EA1' }];
            const cells = [
                num(`${mp}.fck`, { dec: 0, hint: '말뚝 콘크리트 설계기준강도 fck (MPa)' }),
                num(`${mp}.fy`, { dec: 0, hint: '철근 항복강도 fy (MPa)' }),
                num(`${mp}.dc1`, { dec: 0, hint: '주철근 피복 (mm, 철근 중심까지)' }),
                sel(`${mp}.dia1`, REBAR_DIAS, { hint: '정착구간(uL) 주철근 직경' }),
                num(`${mp}.ea1`, { dec: 0, hint: '주철근 개수' }),
            ];
            if (b.layers === 2) {
                head.push({ t: 'dc2' }, { t: 'Dia2' }, { t: 'EA2' });
                cells.push(num(`${mp}.dc2`, { dec: 0, hint: '2단 주철근 피복 (mm)' }), sel(`${mp}.dia2`, REBAR_DIAS, { hint: '2단 주철근 직경' }), num(`${mp}.ea2`, { dec: 0, hint: '2단 주철근 개수' }));
            }
            head.push({ t: 'uL' });
            cells.push(num(`${mp}.uL`, { dec: 0, hint: '정착구간 길이 uL (mm) — 말뚝 머리에서 기초 안으로' }));
            for (let k = 0; k < b.zones; k++) {
                head.push({ t: `L${k + 1}` }, { t: `Dia1${k + 1}` });
                cells.push(num(`${mp}.L.${k}`, { dec: 0, hint: `주철근${k + 1}구간(L${k + 1})에 사용되는 철근의 길이를 설정합니다.` }), sel(`${mp}.dia.${k}`, REBAR_DIAS, { hint: `주철근${k + 1}구간(L${k + 1})에 사용되는 철근의 직경을 설정합니다.` }));
            }
            new Grid(left, { id: 'cip-main', head: [head], rows: [{ cells }], colWidths: head.map(() => 62) });
        } else if (tab === 'hoop') {
            const o = b.hoop, op = `${bp}.hoop`;
            new Grid(left, {
                id: 'cip-hoop',
                head: [[{ t: 'Dia' }, { t: 'L1' }, { t: 'L2' }, { t: 'CTC1' }, { t: 'CTC2' }, { t: 'CTC3' }]],
                rows: [{
                    cells: [
                        sel(`${op}.dia`, REBAR_DIAS, { hint: '띠철근 직경' }),
                        num(`${op}.L1`, { dec: 0, hint: '띠철근 1구간 길이 (말뚝 머리부터, mm)' }),
                        num(`${op}.L2`, { dec: 0, hint: '띠철근 2구간 길이 (mm). 나머지는 3구간' }),
                        num(`${op}.ctc.0`, { dec: 0, hint: '1구간 띠철근 간격 (mm)' }),
                        num(`${op}.ctc.1`, { dec: 0, hint: '2구간 띠철근 간격 (mm)' }),
                        num(`${op}.ctc.2`, { dec: 0, hint: '3구간(나머지) 띠철근 간격 (mm)' }),
                    ],
                }],
                colWidths: [70, 70, 70, 70, 70, 70],
            });
        } else {
            const t = b.tie, tp = `${bp}.tie`;
            new Grid(left, {
                id: 'cip-tie',
                head: [[{ t: 'Dia' }, { t: 'C1' }, { t: 'B' }, { t: 'C' }, { t: 'F1' }, { t: 'E' }, { t: 'F' }, { t: 'CTC1' }, { t: 'CTC2' }, { t: 'CTC3' }]],
                rows: [{
                    cells: [
                        sel(`${tp}.dia`, REBAR_DIAS, { hint: '크로스 타이 직경' }),
                        num(`${tp}.C1`, { dec: 0, hint: '좌측 피복에서 첫 크로스 타이까지의 수평거리 (mm)' }),
                        num(`${tp}.B`, { dec: 0, hint: '추가 크로스 타이 개수 (B@C)' }),
                        num(`${tp}.C`, { dec: 0, hint: '추가 크로스 타이 간격 (B@C, mm)' }),
                        num(`${tp}.F1`, { dec: 0, hint: '하단 피복에서 첫 크로스 타이까지의 수직거리 (mm)' }),
                        num(`${tp}.E`, { dec: 0, hint: '추가 크로스 타이 개수 (E@F)' }),
                        num(`${tp}.F`, { dec: 0, hint: '추가 크로스 타이 간격 (E@F, mm)' }),
                        num(`${tp}.ctc.0`, { dec: 0, hint: '1구간 간격 (mm)' }),
                        num(`${tp}.ctc.1`, { dec: 0, hint: '2구간 간격 (mm)' }),
                        num(`${tp}.ctc.2`, { dec: 0, hint: '3구간 간격 (mm)' }),
                    ],
                }],
                colWidths: [70, 60, 50, 50, 60, 50, 50, 60, 60, 60],
            });
        }
        wrap.appendChild(left);
        const on = tab === 'main';
        const zs = h('select', { disabled: !on });
        for (let k = 1; k <= 4; k++) { const o = h('option', { value: k }, `${k}구간`); if (k === b.zones) o.selected = true; zs.appendChild(o); }
        zs.addEventListener('change', () => setZones(ctx, +zs.value));
        const ls = h('select', { disabled: !on });
        for (let k = 1; k <= 2; k++) { const o = h('option', { value: k }, `${k}단`); if (k === b.layers) o.selected = true; ls.appendChild(o); }
        ls.addEventListener('change', () => store.set(`${bp}.layers`, +ls.value));
        wrap.appendChild(h('div', { class: 'dlg-col' }, [box('주철근 설정', [
            h('div', { class: 'opt' }, [h('label', {}, ['주철근변화구간 ', zs])]),
            h('div', { class: 'opt' }, [h('label', {}, ['주철근 배치 ', ls])]),
        ])]));
        el.appendChild(wrap);
        const { D, L } = pileOf(ctx.c, ctx.bi);
        el.appendChild(h('div', { class: 'note' }, `말뚝 직경 D = ${fmtLen(D)} mm, 길이 L = ${fmtLen(L)} mm ([기초부 설정] 말뚝제원)`));
    },

    footer(el, ctx) {
        ensure(ctx);
        el.appendChild(bCheck(`${ctx.cp}.cip.horiz`, ' 수평 방향으로 도면 보기'));
        el.appendChild(h('button', { class: 'btn', onclick: () => report(ctx), disabled: !isCipBlock(ctx.c, ctx.bi) }, '설계검토'));
    },

    defaults(ctx, tab) {
        const cp = clone(ensure(ctx));
        if (!isCipBlock(ctx.c, ctx.bi)) return;
        const d = defaultCipBlock(ctx.c, ctx.bi);
        const b = cp.blocks[ctx.bi];
        if (tab === 'main') { b.main = d.main; b.zones = d.zones; b.layers = d.layers; }
        else if (tab === 'hoop') b.hoop = d.hoop;
        else if (tab === 'tie') b.tie = d.tie;
        else cp.blocks[ctx.bi] = d;
        store.set(`${ctx.cp}.cip`, cp);
    },

    draw(ctx) {
        const cp = ensure(ctx);
        if (!isCipBlock(ctx.c, ctx.bi)) { const d = new Drawing(); d.emptyMessage = '현장타설말뚝 블록이 아닙니다.'; return d; }
        return drawPile(ctx, cp.blocks[ctx.bi], !!cp.horiz);
    },
    viewKey: (ctx) => `cip|${ctx.ci}|${ctx.bi}|${(ctx.c.cip || {}).horiz ? 'h' : 'v'}`,
};

function report(ctx) {
    const b = ctx.c.cip.blocks[ctx.bi];
    const { D, L } = pileOf(ctx.c, ctx.bi);
    const Ag = Math.PI / 4 * D * D;
    const m = b.main;
    const rows = [];
    let z0 = 0;
    for (let k = 0; k < b.zones; k++) {
        const dia = m.dia[k];
        const ea = (+m.ea1 || 0) + (b.layers === 2 ? (+m.ea2 || 0) : 0);
        const As = barA(dia) * (+m.ea1 || 0) + (b.layers === 2 ? barA(m.dia2) * (+m.ea2 || 0) : 0);
        const rho = As / Ag * 100;
        rows.push([`${k + 1}구간 (${fmtLen(z0)}~${fmtLen(z0 + (+m.L[k] || 0))})`, dia, ea, As.toFixed(0), rho.toFixed(3), rho >= 0.4 && rho <= 8 ? 'O.K' : 'N.G']);
        z0 += +m.L[k] || 0;
    }
    const tb = h('table', {});
    tb.appendChild(h('tr', {}, ['구간', '직경', '개수', 'As (mm²)', 'ρ (%)', '0.4% ≤ ρ ≤ 8%'].map(t => h('th', {}, t))));
    rows.forEach(r => tb.appendChild(h('tr', {}, r.map(x => h('td', { class: 'num' }, String(x))))));
    const cage = D - 2 * (+m.dc1 || 0);
    const clear = Math.PI * cage / Math.max(1, +m.ea1 || 1) - barD(m.dia1);
    modal({
        title: '현장 타설 말뚝 설계검토',
        body: h('div', { class: 'report', style: { minWidth: '520px' } }, [
            h('h3', {}, `BLOCK ${ctx.bi + 1} 현장타설말뚝 D = ${fmtLen(D)} mm, L = ${fmtLen(L)} mm (fck ${m.fck} MPa, fy ${m.fy} MPa)`),
            tb,
            h('p', {}, `주철근 순간격 = π×${fmtLen(cage)}/${m.ea1} − ${barD(m.dia1)} = ${clear.toFixed(0)} mm ${clear >= 2.5 * barD(m.dia1) && clear >= 40 ? '≥ max(2.5db, 40) O.K' : '— 순간격 부족 N.G'}`),
            h('p', {}, `띠철근 ${b.hoop.dia} : CTC ${b.hoop.ctc.join(' / ')} mm (구간 L1 = ${fmtLen(b.hoop.L1)}, L2 = ${fmtLen(b.hoop.L2)})`),
        ]),
        buttons: [{ text: '닫기' }],
    });
}

// ── 도면: 말뚝 측면도 + 단면도 ────────────────────────────────────────

function drawPile(ctx, b, horiz) {
    const { D, L } = pileOf(ctx.c, ctx.bi);
    const m = b.main;
    const th = Math.max(60, Math.min(400, L / 40));
    const d = new Drawing({ textHeight: th });
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const bar = { color: COLOR.MAGENTA, layer: 'REBAR' };
    // 측면도 국부좌표: u = 말뚝 머리에서 아래로(+), v = 횡방향
    const P = (u, v) => (horiz ? [u, v] : [v, -u]);
    const ln = (u1, v1, u2, v2, st) => d.line(...P(u1, v1), ...P(u2, v2), st);
    const dimAx = (u1, u2, vRef, vDim, text, st) => {
        if (horiz) d.dimH(u1, u2, vRef, vDim, text, st);
        else d.dimV(-u1, -u2, vRef, vDim, text, st);
    };
    const R = D / 2;
    const dc = +m.dc1 || 0;
    // 말뚝 몸체
    d.pline([P(0, -R), P(L, -R), P(L, R), P(0, R)], { ...cy, closed: true });
    // 기초 하면 (머리)
    ln(-150, -R - th * 2, -150, R + th * 2, cy);
    ln(0, -R - th * 2, 0, -R, cy);
    ln(0, R, 0, R + th * 2, cy);
    // 주철근 (정착 uL 포함)
    const vb = R - dc;
    const uTop = -(+m.uL || 0);
    const uBot = L - dc;
    for (const v of [-vb, vb]) ln(uTop, v, uBot, v, bar);
    if (b.layers === 2) { const v2 = R - (+m.dc2 || dc + 100); for (const v of [-v2, v2]) ln(0, v, uBot, v, { ...bar, dash: 'hidden' }); }
    // 띠철근
    const hz = b.hoop;
    const zoneEnds = [+hz.L1 || 0, (+hz.L1 || 0) + (+hz.L2 || 0), uBot];
    let u = 50;
    let guard = 0;
    while (u < uBot && guard++ < 2000) {
        ln(u, -vb, u, vb, bar);
        const z = u < zoneEnds[0] ? 0 : u < zoneEnds[1] ? 1 : 2;
        u += Math.max(50, +hz.ctc[z] || 300);
    }
    // 치수 (우측: 주철근 구간)
    const chain = [uTop, 0];
    let acc = 0;
    for (let k = 0; k < b.zones; k++) { acc += +m.L[k] || 0; chain.push(acc); }
    const vD1 = R + th * 3, vD2 = R + th * 6;
    for (let k = 0; k < chain.length - 1; k++) {
        const name = k === 0 ? 'uL' : `L${k}`;
        dimAx(chain[k], chain[k + 1], R, vD1, undefined, { name });
    }
    if (acc < L) dimAx(acc, L, R, vD1);
    dimAx(0, L, R, vD2, undefined, {});
    d.text(...P(L / 2, vD2 + th * 1.4), '말뚝 길이', { color: COLOR.GREEN, h: th * 0.8, rot: horiz ? 0 : 90, layer: 'TEXT' });
    // 치수 (좌측: 띠철근 구간)
    const hz3 = Math.max(0, uBot - zoneEnds[1]);
    const vL = -R - th * 3;
    dimAx(0, zoneEnds[0], -R, vL, `CTC${hz.ctc[0]}`);
    dimAx(zoneEnds[0], zoneEnds[1], -R, vL, `CTC${hz.ctc[1]}`);
    if (hz3 > 0) dimAx(zoneEnds[1], uBot, -R, vL, `CTC${hz.ctc[2]}`);
    d.text(...P(L + th * 2, 0), `${m.dia1}-${m.ea1}EA`, { color: COLOR.GREEN, h: th * 0.8, valign: horiz ? 'middle' : 'top', layer: 'TEXT' });

    // 단면도 (측면도 옆)
    const sc = Math.max(1, Math.min(4, (L * 0.25) / D));    // 단면 확대 배율
    const cx = horiz ? L / 2 : -(R + th * 10 + R * sc);
    const cyy = horiz ? -(R + th * 10 + R * sc) : -L * 0.3;
    const S = (x, y) => [cx + x * sc, cyy + y * sc];
    d.circle(...S(0, 0), R * sc, cy);
    d.circle(...S(0, 0), vb * sc, bar);
    const n = Math.max(1, +m.ea1 || 1);
    for (let k = 0; k < n; k++) {
        const a = 2 * Math.PI * k / n + Math.PI / 2;
        d.circle(...S(vb * Math.cos(a), vb * Math.sin(a)), barD(m.dia1) / 2 * sc, { ...bar, fill: COLOR.MAGENTA });
    }
    // 크로스 타이
    const t = b.tie;
    const xsT = [];
    let xx = -vb + (+t.C1 || 0);
    xsT.push(xx);
    for (let k = 0; k < (+t.B || 0); k++) { xx += +t.C || 0; xsT.push(xx); }
    const ysT = [];
    let yy = -vb + (+t.F1 || 0);
    ysT.push(yy);
    for (let k = 0; k < (+t.E || 0); k++) { yy += +t.F || 0; ysT.push(yy); }
    for (const x of xsT) { if (Math.abs(x) < vb) { const hh = Math.sqrt(vb * vb - x * x); d.line(...S(x, -hh), ...S(x, hh), bar); } }
    for (const y of ysT) { if (Math.abs(y) < vb) { const ww = Math.sqrt(vb * vb - y * y); d.line(...S(-ww, y), ...S(ww, y), bar); } }
    // 지시선 R1
    const pa = S(vb * Math.cos(Math.PI / 4), vb * Math.sin(Math.PI / 4));
    d.line(...pa, pa[0] + th * 3, pa[1] + th * 3, { color: COLOR.RED, layer: 'DIM' });
    d.bubble(pa[0] + th * 3.8, pa[1] + th * 3.6, 'R1', { color: COLOR.RED, textColor: COLOR.GREEN, r: th * 0.8 });
    d.text(pa[0] + th * 5, pa[1] + th * 3.6, `${m.dia1}`, { color: COLOR.GREEN, h: th * 0.8, align: 'left', valign: 'middle', layer: 'TEXT' });
    // 단면 치수 (하부) — 실제 치수 표기
    const yb = cyy - R * sc - th * 2.5;
    const xsDim = [-R, -vb, ...xsT.filter(x => Math.abs(x) < vb), vb, R].sort((a, b2) => a - b2);
    for (let k = 0; k < xsDim.length - 1; k++) d.dimH(cx + xsDim[k] * sc, cx + xsDim[k + 1] * sc, cyy, yb, fmtLen(xsDim[k + 1] - xsDim[k]));
    d.dimH(cx - R * sc, cx + R * sc, cyy, yb - th * 2.6, fmtLen(D));
    // 단면 치수 (좌측)
    const xl = cx - R * sc - th * 2.5;
    const ysDim = [-R, -vb, ...ysT.filter(y => Math.abs(y) < vb), vb, R].sort((a, b2) => a - b2);
    for (let k = 0; k < ysDim.length - 1; k++) d.dimV(cyy + ysDim[k] * sc, cyy + ysDim[k + 1] * sc, cx, xl, fmtLen(ysDim[k + 1] - ysDim[k]));
    d.text(cx, yb - th * 4.5, `단면도 (×${sc.toFixed(1)} 확대)`, { color: COLOR.GREEN, h: th * 0.8, valign: 'top', layer: 'TEXT' });
    d.text(cx + R * sc + th, cyy - R * sc, 'dc1', { color: COLOR.YELLOW, h: th * 0.7, align: 'left', layer: 'VAR', field: 'dc1' });
    d.legend = `BLOCK ${ctx.bi + 1} 현장타설말뚝 D${fmtLen(D)} L=${fmtLen(L)} — 주철근 ${m.dia1} ${m.ea1}EA, 띠철근 ${hz.dia}`;
    return d;
}
