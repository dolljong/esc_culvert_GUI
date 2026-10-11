// 배근 입력 > 철근 배치 (매뉴얼 5.8)
// 평면도상의 주철근 배치범위를 구간(시점경사 / 직구간 / 종점경사)별 '개수@간격' 으로 입력한다.
// 데이터/계산: calc/rebarPlan.js (culverts[i].rebar.plan[bi]). 사보강 배치옵션은 배근설정 > 철근배치 탭.

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, lbl } from '../ui/cells.js';
import { h, button, bSelect } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { getSettings, zonesOf, mainBarLayout, getRebarCommon } from '../calc/rebar.js';
import { horzLayout } from '../calc/rebarHorz.js';
import {
    VIEW_OPTS, REF_OPTS, ZONE_ORDER, ZONE_TITLE, getPlan, defaultPlanZones, planPositions, planBarLine, planCover,
} from '../calc/rebarPlan.js';
import { ensureSettings, ensure, sameBlockPopup, sameKindBlocks } from './rebarSet.js';

const ui = { col: null };
const planPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.plan.${bi}`;

function ensurePlan(ctx) {
    ensureSettings(ctx);
    ensure(planPath(ctx), () => getPlan(ctx.c, ctx.bi));
    const s = store.get(planPath(ctx));
    if (!s.zones) store.set(`${planPath(ctx)}.zones`, getPlan(ctx.c, ctx.bi).zones, { record: false, silent: true });
    for (const z of ZONE_ORDER) {
        if (!store.get(`${planPath(ctx)}.zones.${z}.segs`)) store.set(`${planPath(ctx)}.zones.${z}`, getPlan(ctx.c, ctx.bi).zones[z], { record: false, silent: true });
    }
    return planPath(ctx);
}

function enabledZones(ctx) {
    return zonesOf(ctx.c, ctx.bi, getSettings(ctx.c, ctx.bi)).filter(z => z.enabled).map(z => z.id)
        .sort((a, b) => ZONE_ORDER.indexOf(a) - ZONE_ORDER.indexOf(b));
}

function viewOf(ctx) {
    const g = ctx.c ? planPositions(ctx.c, ctx.bi).fr.g : null;
    let v = (store.get(planPath(ctx)) || {}).view || 'top';
    if (g && g.kind === 'U' && v === 'top') v = 'bottom';
    if (g && g.kind !== 'DOUBLE' && v === 'mid') v = 'top';
    return v;
}

function setSegCount(ctx, zone, n) {
    const p = `${ensurePlan(ctx)}.zones.${zone}.segs`;
    const segs = clone(store.get(p) || []);
    n = Math.max(1, Math.min(30, n | 0));
    const sp = segs.length ? segs[segs.length - 1].s : 125;
    while (segs.length > n) segs.pop();
    while (segs.length < n) segs.push({ n: 0, s: sp });
    store.set(p, segs);
}

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '평면도상의 주철근 배치범위(직구간, 시점경사, 종점경사)의 개수와 간격을 입력합니다.',

    tabs(ctx) {
        return enabledZones(ctx).map(z => ({ id: z, title: ZONE_TITLE[z] }));
    },

    header(el, ctx) {
        ensurePlan(ctx);
        const g = planPositions(ctx.c, ctx.bi).fr.g;
        const opts = VIEW_OPTS.filter(o => !(o.value === 'top' && g.kind === 'U') && !(o.value === 'mid' && g.kind !== 'DOUBLE'));
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [bSelect(`${planPath(ctx)}.view`, opts, { label: '보기옵션' })]));
    },

    render(el, ctx, tab) {
        const pp = ensurePlan(ctx);
        const zone = enabledZones(ctx).includes(tab) ? tab : 'straight';
        const segs = store.get(`${pp}.zones.${zone}.segs`) || [];
        const head = [[{ t: '구간' }, ...segs.map((_, k) => ({ t: `구간 ${k + 1}` }))]];
        const hint = `[${ZONE_TITLE[zone]}] 구간별 철근 개수와 간격을 입력합니다.`;
        new Grid(el, {
            id: `plan-${zone}`, head,
            rows: [
                { head: [{ t: '개수' }], cells: segs.map((_, k) => num(`${pp}.zones.${zone}.segs.${k}.n`, { dec: 0, hint, validate: v => (v >= 0 ? null : '개수는 0 이상') })) },
                { head: [{ t: '간격' }], cells: segs.map((_, k) => num(`${pp}.zones.${zone}.segs.${k}.s`, { dec: 0, hint, validate: v => (v >= 0 ? null : '간격은 0 이상') })) },
            ],
            colWidths: [60, ...segs.map(() => 70)],
            onSelect: (cell, r, c) => { ui.col = c; ctx.redraw(); },
        });
        const P = planPositions(ctx.c, ctx.bi);
        const cnt = {};
        for (const q of P.pos) cnt[q.zone] = (cnt[q.zone] || 0) + 1;
        const used = P.pos.length ? P.pos[P.pos.length - 1].t + P.cov : 0;
        el.appendChild(h('div', { class: 'note' }, [
            `* 기준위치(${(store.get(pp) || {}).ref || REF_OPTS[0]})에서 측정. 평면 배치간격 ${fmtLen(P.sp)} mm (모든 Cycle), 측면피복 ${P.cov} mm.`,
            h('br'),
            `  철근 개수: ${ZONE_ORDER.filter(z => cnt[z]).map(z => `${ZONE_TITLE[z]} ${cnt[z]}`).join(', ') || '-'} / 배치 합계 ${fmtLen(used)} mm, 블록 길이(기준선) ${fmtLen(P.avail)} mm`,
            Math.abs(used - P.avail) > Math.max(5, P.sp) ? h('span', { style: { color: '#c00' } }, '  ← 배치 합계가 블록 길이와 다릅니다.') : '',
        ]));
    },

    footer(el, ctx, tab) {
        const pp = ensurePlan(ctx);
        el.appendChild(h('label', {}, ['기준위치 ', bSelect(`${pp}.ref`, REF_OPTS, {
            onChange: (v) => store.transact(() => { store.set(`${pp}.ref`, v); store.set(`${pp}.zones`, defaultPlanZones(ctx.c, ctx.bi, v)); }),
        })]));
        el.appendChild(button('구간추가', () => setSegCount(ctx, tab, (store.get(`${pp}.zones.${tab}.segs`) || []).length + 1)));
        el.appendChild(button('구간삭제', () => setSegCount(ctx, tab, (store.get(`${pp}.zones.${tab}.segs`) || []).length - 1)));
        el.appendChild(button('모든 블럭 동일 적용', () => {
            const targets = sameKindBlocks(ctx);
            sameBlockPopup(() => { const s = clone(store.get(pp)); for (const b of targets) store.set(planPath(ctx, b), clone(s)); },
                () => { const s = clone(store.get(`${pp}.zones.${tab}`)); for (const b of targets) store.set(`${planPath(ctx, b)}.zones.${tab}`, clone(s)); });
        }, { disabled: ctx.blocks.length < 2 }));
    },

    defaults(ctx) {
        const pp = ensurePlan(ctx);
        store.set(`${pp}.zones`, defaultPlanZones(ctx.c, ctx.bi, store.get(`${pp}.ref`) || REF_OPTS[0]));
    },

    draw(ctx, tab) { return planDrawing(ctx.p, ctx.c, ctx.bi, { view: viewOf(ctx), zone: tab }); },
    viewKey: (ctx) => `rebarPlan|${ctx.ci}|${ctx.bi}|${viewOf(ctx)}`,
};

/**
 * 철근 배치 평면도 (x = u 선형방향, y = -v).
 * opts: { view: 'top'|'bottom'|'mid', zone (강조 구간) }
 */
export function planDrawing(p, c, bi, opts = {}) {
    const P = planPositions(c, bi);
    const { fr, cov, vref } = P;
    const view = opts.view || 'top';
    const th = Math.max(150, Math.max(fr.L0, fr.W) / 55);
    const d = new Drawing({ textHeight: th });
    const T = (u, v) => [u, -v];
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.pline(fr.corners().map(([u, v]) => T(u, v)), { ...cy, closed: true });
    // 내측 벽면 (초록 파선)
    for (const w of fr.g.walls) {
        if (w.floor === 2) continue;
        for (const x of w.kind === 'outer' ? [w.side === 'L' ? w.x1 : w.x0] : [w.x0, w.x1]) {
            const v = fr.vOfX(x);
            d.line(...T(fr.uS(v), v), ...T(fr.uE(v), v), { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        }
    }
    const uMid = (fr.uS(vref) + fr.uE(vref)) / 2;
    const yTop = -fr.vL, yBot = -fr.vR;
    d.line(uMid, yTop + th * 2, uMid, yBot - th * 2, { color: COLOR.CYAN, dash: 'center', layer: 'CENTER' });
    d.text(uMid - th, yTop + th * 0.8, '상 면', { color: COLOR.GREEN, h: th, align: 'right', layer: 'TEXT' });
    d.text(uMid + th, yTop + th * 0.8, '하 면', { color: COLOR.GREEN, h: th, align: 'left', layer: 'TEXT' });
    // 기준선
    d.line(...T(fr.uS(vref) - th, vref), ...T(fr.uE(vref) + th, vref), { color: COLOR.RED, dash: 'center', layer: 'CENTER' });
    d.text(fr.uE(vref) + th * 1.3, -vref, P.st && (getPlan(c, bi).ref), { color: COLOR.GREEN, h: th * 0.7, align: 'left', valign: 'middle', layer: 'TEXT' });

    // 주철근 (현재 슬래브의 1단, 상면 = 왼쪽 절반, 하면 = 오른쪽 절반)
    const lays = {};
    const layOf = (z) => lays[z] || (lays[z] = mainBarLayout(p, c, bi, { zone: z, members: [view], layers: [1] }));
    const xRef = (() => { const g = fr.g; const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells; return g.kind === 'U' ? g.inner.x0 : cells[0].x0; })();
    const marks = new Map();   // mark → { pt, dia, face }
    for (const q of P.pos) {
        const ln = planBarLine(fr, vref, q, cov, cov);
        if (!ln) continue;
        const uq = ln.A + ln.k * vref;
        const face = uq <= uMid ? 'U' : 'L';
        const bars = layOf(q.zone).bars.filter(b => b.member === view && b.face === face && b.cycle === q.cycle && b.layer === 1);
        const cur = q.zone === opts.zone;
        for (const b of bars) {
            const v0 = Math.max(ln.v0, fr.vOfX(b.sFrom + xRef)), v1 = Math.min(ln.v1, fr.vOfX(b.sTo + xRef));
            if (!(v1 > v0 + 1)) continue;
            const du = (b.piece % 2) * th * 0.12;
            d.line(...T(ln.A + ln.k * v0 + du, v0), ...T(ln.A + ln.k * v1 + du, v1), { color: COLOR.MAGENTA, layer: 'REBAR', tip: `${b.mark} ${b.dia}` });
            const mk = b.mark + (q.zone === 'start' ? '-1' : q.zone === 'end' ? '-2' : '');
            if (!marks.has(mk)) marks.set(mk, { pt: T(ln.A + ln.k * (v0 + v1) / 2 + du, (v0 + v1) / 2), dia: b.dia, face, k: marks.size });
        }
        if (cur) {
            d.line(...T(ln.p0[0], ln.p0[1] - th * 0.6), ...T(ln.p0[0], ln.p0[1] + th * 0.3), { color: COLOR.YELLOW, layer: 'SEL' });
            d.line(...T(ln.p1[0], ln.p1[1] + th * 0.6), ...T(ln.p1[0], ln.p1[1] - th * 0.3), { color: COLOR.YELLOW, layer: 'SEL' });
        }
    }
    // 수평(배력)철근: 단면 점 위치의 길이방향 선
    const hl = horzLayout(p, c, bi);
    const hPre = (getRebarCommon(p).marks.horz) || 'D';
    let hn = 0;
    for (const face of ['U', 'L']) {
        const F = hl.faces.find(x => x.member === view && x.face === face);
        if (!F) continue;
        hn++;
        for (const dot of F.dots) {
            const v = fr.vOfX(dot.pt[0]);
            const ua = face === 'U' ? fr.uS(v) + cov / fr.sin0 : uMid;
            const ub = face === 'U' ? uMid : fr.uE(v) - cov / fr.sin1;
            if (ub > ua) d.line(...T(ua, v), ...T(ub, v), { color: COLOR.MAGENTA, layer: 'REBAR' });
        }
        const mid = F.dots[Math.floor(F.dots.length / 2)];
        if (mid) {
            const v = fr.vOfX(mid.pt[0]);
            const u = face === 'U' ? (fr.uS(v) + uMid) / 2 : (uMid + fr.uE(v)) / 2;
            const q = [u + th * 2, yBot - th * 3.5];
            d.line(u, -v, q[0], q[1] + th * 0.7, { color: COLOR.RED, layer: 'MARK' });
            d.bubble(q[0], q[1], `${hPre}${hn}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
            d.text(q[0] + th, q[1], F.dia, { color: COLOR.GREEN, h: th * 0.65, align: 'left', valign: 'middle', layer: 'MARK' });
        }
    }
    // 주철근 기호
    let iL = 0, iR = 0;
    for (const [mk, m] of marks) {
        const left = m.face === 'U';
        const i = left ? iL++ : iR++;
        const x = left ? fr.uS(fr.vL) - th * 4 - (i % 2) * th * 3.2 : fr.uE(fr.vL) + th * 4 + (i % 2) * th * 3.2;
        const y = yTop - th * 1.5 - Math.floor(i / 2) * th * 2.4 - (yTop - yBot) * 0.15;
        d.line(m.pt[0], m.pt[1], x + (left ? th * 0.7 : -th * 0.7), y, { color: COLOR.RED, layer: 'MARK' });
        d.bubble(x, y, mk, { r: th * 0.8, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(x, y - th * 0.9, m.dia, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'MARK' });
    }
    // 치수: 기준선 위치 배치 체인 (위쪽), 블록 길이, 폭
    const plan = getPlan(c, bi);
    const u0 = fr.uS(vref);
    const items = [{ a: 0, b: cov, t: String(cov) }];
    let t = cov, first = true;
    for (const z of ZONE_ORDER) {
        if (!P.pos.some(q => q.zone === z)) continue;
        for (const sg of plan.zones[z].segs) {
            const n = sg.n | 0;
            if (!n) continue;
            const a = t;
            t += n * (+sg.s || 0);
            if (first) first = false;
            items.push({ a, b: t, t: n > 1 ? `${n}@${fmtLen(+sg.s)}=${fmtLen(n * sg.s)}` : fmtLen(+sg.s), z });
        }
    }
    const yRef = yTop, yD = yTop + th * 3.2;
    for (const it of items) {
        if (it.b - it.a < 1) continue;
        d.dimH(u0 + it.a, u0 + it.b, yRef, yD, it.t, { h: th * 0.55, color: it.z && it.z === opts.zone ? COLOR.YELLOW : COLOR.RED });
    }
    const end = fr.uE(vref) - (u0 + t);
    if (end > 1) d.dimH(u0 + t, fr.uE(vref), yRef, yD, fmtLen(end), { h: th * 0.55 });
    d.dimH(fr.uS(fr.vR), fr.uE(fr.vR), yBot, yBot - th * 1.6, undefined, { h: th * 0.7 });
    d.dimV(yBot, yTop, Math.min(fr.uS(fr.vL), fr.uS(fr.vR)), Math.min(fr.uS(fr.vL), fr.uS(fr.vR)) - th * 2, fmtLen(fr.W), { h: th * 0.7 });
    d.text(uMid, yBot - th * 5.8, `BLOCK ${bi + 1}  ${(VIEW_OPTS.find(o => o.value === view) || {}).label || ''} 철근배치도`, { color: COLOR.WHITE, h: th * 1.1, valign: 'top', layer: 'TEXT' });
    void planCover;
    d.legend = '철근배치';
    return d;
}
