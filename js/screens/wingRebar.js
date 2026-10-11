// 배근 입력 > 날개벽 배근 (매뉴얼 5.11)
// [상세입력 > 날개벽 위치]에서 설치한 날개벽별 배근. 일체식: 전면 | 배면 | 전단철근, 옹벽식: 주철근 | 수평철근 | 전단철근.
// 데이터/계산: calc/wingRebar.js (culverts[i].rebar.wing)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, txt, custom } from '../ui/cells.js';
import { h, button, bCheck, modal } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { DIAS, barD } from '../calc/rebar.js';
import { installedWings, integralElevation, wallSection, defaultWallRow, wingPlan } from '../calc/wingGeom.js';
import {
    CTC_OPTS, COVER_ROWS, MARK_ROWS, defaultWingCommon, getWingCommon, wingCoverOf, defaultIntegralRebar, defaultWallRebar,
    getWingRebar, zonePositions, wingCheck,
    haunchBarLine, bodyWallPlan, horzBarPlan, wingPlanView,
} from '../calc/wingRebar.js';
import { SHEAR_TYPES } from '../calc/shearBars.js';
import { liveModal, ensure } from './rebarSet.js';

const ui = { key: null };
const DIA_OPT = ['', ...DIAS];
const NSEG = Array.from({ length: 30 }, (_, i) => ({ value: i + 1, label: `${i + 1}구간` }));
const N_WRAP = [1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: `${n}개` }));
const wPath = (ctx) => `${ctx.cp}.rebar.wing`;

function cur(ctx) {
    const ws = ctx.c ? installedWings(ctx.c) : [];
    if (!ws.length) return null;
    let w = ws.find(x => x.key === ui.key);
    if (!w) { w = ws[0]; ui.key = w.key; }
    return w;
}

function itemPath(ctx) {
    ensure(wPath(ctx), defaultWingCommon);
    const w = cur(ctx);
    const p = `${wPath(ctx)}.items.${w.key}`;
    const v = store.get(p);
    if (!v || v.kind !== w.type) store.set(p, getWingRebar(ctx.c, w.key), { record: false, silent: true });
    return p;
}

function segCountCell(path, hint) {
    return custom('select', () => (store.get(path) || []).length, (v) => {
        const segs = clone(store.get(path) || []);
        const n = Math.max(1, Math.min(30, +v | 0));
        const last = segs.length ? segs[segs.length - 1] : { n: 1, s: 300 };
        while (segs.length > n) segs.pop();
        while (segs.length < n) segs.push({ n: 1, s: last.s });
        store.set(path, segs);
    }, { options: NSEG, hint });
}

export default {
    scope: 'culvert',
    enabled: (ctx) => !ctx.c || installedWings(ctx.c).length > 0,
    hint: '날개벽의 수직·수평철근 배치간격과 직경, 전단철근을 입력합니다.',

    tabs(ctx) {
        const w = cur(ctx);
        if (!w) return [];
        return w.type === '일체식'
            ? [{ id: 'front', title: '전면' }, { id: 'back', title: '배면' }, { id: 'shear', title: '전단철근' }]
            : [{ id: 'main', title: '주철근' }, { id: 'horz', title: '수평철근' }, { id: 'shear', title: '전단철근' }];
    },

    header(el, ctx) {
        const w = cur(ctx);
        if (!w) { el.appendChild(h('span', { class: 'note' }, '설치된 날개벽이 없습니다.')); return; }
        const ip = itemPath(ctx);
        const ws = installedWings(ctx.c);
        const s = h('select', {});
        for (const x of ws) { const o = h('option', { value: x.key }, x.name); if (x.key === w.key) o.selected = true; s.appendChild(o); }
        s.addEventListener('change', () => { ui.key = s.value; ctx.rerender(); });
        const nav = (dl) => { const i = ws.findIndex(x => x.key === ui.key) + dl; if (i >= 0 && i < ws.length) { ui.key = ws[i].key; ctx.rerender(); } };
        el.appendChild(s);
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => nav(-1) }, '◀'));
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => nav(1) }, '▶'));
        const std = h('select', {});
        const cv = store.get(`${ip}.std`);
        for (const v of CTC_OPTS) { const o = h('option', { value: v }, `CTC ${v}`); if (v === +cv) o.selected = true; std.appendChild(o); }
        std.addEventListener('change', () => {
            const v = +std.value;
            const d = w.type === '일체식' ? defaultIntegralRebar(ctx.c, w.key, v) : defaultWallRebar(ctx.c, w.key, v);
            store.set(ip, d);   // 자동권고안 다시 적용
        });
        el.appendChild(h('label', { title: '표준간격을 바꾸면 자동권고안을 다시 적용합니다.' }, ['표준간격 ', std]));
        if (w.type === '옹벽식') {
            el.appendChild(bCheck(`${ip}.view.foot`, ' 저판'));
            el.appendChild(bCheck(`${ip}.view.wall`, ' 벽체'));
        }
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [button('철근덮개, 기호(Y)', () => coverPopup(ctx))]));
    },

    render(el, ctx, tab) {
        const w = cur(ctx);
        if (!w) { el.appendChild(h('div', { class: 'note' }, '[상세입력 > 날개벽 위치]에서 날개벽을 설치하면 입력할 수 있습니다.')); return; }
        const ip = itemPath(ctx);
        const v = store.get(ip);
        if (w.type === '일체식') {
            if (tab === 'shear') {
                const segs = v.shear.segs || [];
                new Grid(el, {
                    id: 'wing-sh',
                    head: [[{ t: '구분' }, { t: '직경' }, { t: '주철근구간수' }, { t: '철근형태' }, { t: '구간수' }, ...segs.map((_, k) => ({ t: `S${k + 1}` }))]],
                    rows: [
                        { head: [{ t: '개수' }], cells: [sel(`${ip}.shear.dia`, DIA_OPT, { hint: '전단철근 직경 (공란 = 배치 안함)' }), sel(`${ip}.shear.nMain`, [1, 2, 3, 4, 5, 6, 7, 8], { hint: '전단철근이 감싸는 주철근 수' }), sel(`${ip}.shear.type`, SHEAR_TYPES, { hint: '전단철근 형태 (전단 철근 화면과 같음)' }), segCountCell(`${ip}.shear.segs`, '구간 수 (선택하면 세부 구간이 생성됩니다)'), ...segs.map((_, k) => num(`${ip}.shear.segs.${k}.n`, { dec: 0 }))] },
                        { head: [{ t: '간격' }], cells: [lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), ...segs.map((_, k) => num(`${ip}.shear.segs.${k}.s`, { dec: 0, hint: '근단부터 전단철근 열 간격' }))] },
                    ],
                    colWidths: [50, 60, 80, 90, 70, ...segs.map(() => 55)],
                });
                return;
            }
            const fp = `${ip}.${tab}`;
            const f = v[tab];
            const nV = f.V.length, nH = f.H.length, nR = (f.rail && f.rail.H || []).length;
            const back = tab === 'back';
            const head = [
                [{ t: '구분', rs: 3 }, { t: '날개벽', cs: 1 + nV + 1 + nH + 4 + (back ? 1 : 0) }, { t: '난간벽', cs: 1 + nR + 1 + 2 }],
                [{ t: '수직철근 배치간격', cs: 1 + nV }, { t: '수평철근 배치간격', cs: 1 + nH }, { t: '철근 직경', cs: 4 }, ...(back ? [{ t: '생략', rs: 1 }] : []), { t: '수평철근 배치간격', cs: 1 + nR }, { t: '수직철근' }, { t: '철근 직경', cs: 2 }],
                [{ t: '구간' }, ...f.V.map((_, k) => ({ t: `V${k + 1}` })), { t: '구간' }, ...f.H.map((_, k) => ({ t: `H${k + 1}` })), { t: '수직' }, { t: '수평1' }, { t: '수평2' }, { t: '헌치' }, ...(back ? [{ t: 'M' }] : []),
                    { t: '구간' }, ...Array.from({ length: nR }, (_, k) => ({ t: `H${k + 1}` })), { t: '길이' }, { t: '수직' }, { t: '수평' }],
            ];
            const ro = () => lbl('', { cls: 'ro' });
            const cnt = [
                segCountCell(`${fp}.V`, '수직철근 배치 구간 수'), ...f.V.map((_, k) => num(`${fp}.V.${k}.n`, { dec: 0, hint: `V${k + 1}: 근단(본체 접합부)부터 수직철근 개수` })),
                segCountCell(`${fp}.H`, '수평철근 배치 구간 수'), ...f.H.map((_, k) => num(`${fp}.H.${k}.n`, { dec: 0, hint: `H${k + 1}: 하단부터 수평철근 개수` })),
                sel(`${fp}.dia.v`, DIA_OPT, { hint: '수직철근 직경' }), sel(`${fp}.dia.h1`, DIA_OPT, { hint: '수평철근(수평1) 직경' }), sel(`${fp}.dia.h2`, DIA_OPT, { hint: '수평2 철근 직경 (배면 M 구간)' }), sel(`${fp}.dia.hu`, DIA_OPT, { hint: '헌치철근 직경' }),
                ...(back ? [num(`${fp}.M`, { dec: 0, hint: 'M: 날개벽 끝단에서 수평2 철근의 생략 길이 (0 = 수평2 없음)' })] : []),
                segCountCell(`${fp}.rail.H`, '난간벽 수평철근 구간 수'), ...Array.from({ length: nR }, (_, k) => num(`${fp}.rail.H.${k}.n`, { dec: 0 })),
                num(`${fp}.rail.len`, { dec: 0, hint: '난간벽 수직철근 길이' }), sel(`${fp}.rail.dia.v`, DIA_OPT, { hint: '난간벽 수직철근 직경' }), sel(`${fp}.rail.dia.h`, DIA_OPT, { hint: '난간벽 수평철근 직경' }),
            ];
            const gap = [
                ro(), ...f.V.map((_, k) => num(`${fp}.V.${k}.s`, { dec: 0, field: `V${k + 1}`, hint: `V${k + 1} 간격` })),
                ro(), ...f.H.map((_, k) => num(`${fp}.H.${k}.s`, { dec: 0, field: `H${k + 1}`, hint: `H${k + 1} 간격` })),
                ro(), ro(), ro(), ro(), ...(back ? [ro()] : []),
                ro(), ...Array.from({ length: nR }, (_, k) => num(`${fp}.rail.H.${k}.s`, { dec: 0 })), ro(), ro(), ro(),
            ];
            new Grid(el, { id: `wing-${tab}`, head, rows: [{ head: [{ t: '개수' }], cells: cnt }, { head: [{ t: '간격' }], cells: gap }] });
            const ev = integralElevation(ctx.c, w.key);
            const sV = zonePositions(f.V, 0), sH = zonePositions(f.H, 0);
            el.appendChild(h('div', { class: 'note' }, `* 수직철근 ${sV.length}개 (합계 ${Math.round(sV[sV.length - 1] || 0)} / 날개벽 길이 ${fmtLen(ev.L1)}), 수평철근 ${sH.length}단 (합계 ${Math.round(sH[sH.length - 1] || 0)} / 근단 높이 ${fmtLen(ev.hRoot)})`));
            return;
        }
        // 옹벽식
        if (tab === 'main') {
            new Grid(el, {
                id: 'wing-wmain',
                head: [[{ t: '벽 체', cs: 4 }, { t: '기 초', cs: 4 }], [{ t: '배치' }, { t: '직경(전면)' }, { t: '직경(배면)' }, { t: 'dR' }, { t: '배치' }, { t: '직경(상면)' }, { t: '직경(하면)' }, { t: '이격' }]],
                rows: [{ cells: [
                    chk(`${ip}.main.wall.place`, { hint: '벽체 주철근 배치' }), sel(`${ip}.main.wall.front`, DIA_OPT), sel(`${ip}.main.wall.back`, DIA_OPT),
                    num(`${ip}.main.wall.dR`, { dec: 0, hint: 'dR: 2Cycle 철근의 상단 생략 길이' }),
                    chk(`${ip}.main.foot.place`, { hint: '기초 주철근 배치' }), sel(`${ip}.main.foot.top`, DIA_OPT), sel(`${ip}.main.foot.bottom`, DIA_OPT),
                    chk(`${ip}.main.foot.gap`, { hint: '이격: 체크하면 앞굽 위에는 기초 상면철근을 배치하지 않습니다.' }),
                ] }],
            });
        } else if (tab === 'horz') {
            new Grid(el, {
                id: 'wing-whorz',
                head: [[{ t: '벽 체', cs: 3 }, { t: '기 초', cs: 3 }, { t: '활동방지벽', cs: 3 }], [{ t: '전면' }, { t: '배면' }, { t: 'CTC' }, { t: '전면' }, { t: '배면' }, { t: 'CTC' }, { t: '수직' }, { t: '수평' }, { t: 'CTC' }]],
                rows: [{ cells: [
                    sel(`${ip}.horz.wall.front`, DIA_OPT), sel(`${ip}.horz.wall.back`, DIA_OPT), num(`${ip}.horz.wall.ctc`, { dec: 0 }),
                    sel(`${ip}.horz.foot.front`, DIA_OPT, { hint: '기초 하면 배력철근' }), sel(`${ip}.horz.foot.back`, DIA_OPT, { hint: '기초 상면 배력철근' }), num(`${ip}.horz.foot.ctc`, { dec: 0 }),
                    sel(`${ip}.horz.key.v`, DIA_OPT), sel(`${ip}.horz.key.h`, DIA_OPT), num(`${ip}.horz.key.ctc`, { dec: 0 }),
                ] }],
            });
        } else {
            const part = (k) => [sel(`${ip}.shear.${k}.dia`, DIA_OPT, { hint: '전단철근 직경 (공란 = 배치 안함)' }), sel(`${ip}.shear.${k}.type`, SHEAR_TYPES), sel(`${ip}.shear.${k}.n`, N_WRAP, { hint: '묶는 수: 전단철근이 감싸는 주철근 수' }), num(`${ip}.shear.${k}.ctc`, { dec: 0 })];
            const sub = [{ t: '직경' }, { t: '철근형태' }, { t: '묶는 수' }, { t: 'CTC' }];
            new Grid(el, {
                id: 'wing-wshear',
                head: [[{ t: '벽 체', cs: 4 }, { t: '기 초', cs: 4 }, { t: '활동방지벽', cs: 4 }], [...sub, ...sub, ...sub]],
                rows: [{ cells: [...part('wall'), ...part('foot'), ...part('key')] }],
            });
        }
        const rows = (ctx.c.wings && ctx.c.wings.dim && ctx.c.wings.dim[w.key] && ctx.c.wings.dim[w.key].wall && ctx.c.wings.dim[w.key].wall.rows) || [defaultWallRow(ctx.c)];
        const s = wallSection(rows[0]);
        el.appendChild(h('div', { class: 'note' }, `* 시점측 단면: 벽체높이 ${fmtLen(s.hStem)}, 벽체 하단폭 ${s.B3}, 기초폭 ${fmtLen(s.W)} / 표준간격 CTC ${v.std}`));
    },

    footer(el, ctx) {
        el.appendChild(button('설계검토', () => checkPopup(ctx), { disabled: !cur(ctx) }));
    },

    defaults(ctx, tab) {
        const w = cur(ctx);
        if (!w) return;
        const ip = itemPath(ctx);
        const std = store.get(`${ip}.std`);
        const d = w.type === '일체식' ? defaultIntegralRebar(ctx.c, w.key, std || 150) : defaultWallRebar(ctx.c, w.key, std || 250);
        if (d[tab] !== undefined) store.set(`${ip}.${tab}`, d[tab]);
        else store.set(ip, d);
    },

    draw(ctx, tab) {
        const w = cur(ctx);
        if (!w) return new Drawing();
        itemPath(ctx);
        return w.type === '일체식' ? integralDrawing(ctx, w, tab) : wallDrawing(ctx, w, tab);
    },
    viewKey: (ctx) => `wingRebar|${ctx.ci}|${ui.key}`,
};

// ── 도면 ──────────────────────────────────────────────────────────────

function groupChain(pos, base = 0) {
    const xs = [base], labels = [];
    let i = 0;
    const all = [base, ...pos];
    i = 1;
    while (i < all.length) {
        const g = all[i] - all[i - 1];
        let j = i;
        while (j + 1 < all.length && Math.abs(all[j + 1] - all[j] - g) < 0.5) j++;
        const n = j - i + 1;
        xs.push(all[j]);
        labels.push(n > 1 ? `${n}@${fmtLen(g)}` : fmtLen(g));
        i = j + 1;
    }
    return { xs, labels };
}

function elevation(d, ctx, w, face, ox, oy, active) {
    const ev = integralElevation(ctx.c, w.key);
    const r = store.get(itemPath(ctx));
    const f = r[face];
    const { cover: cv, marks } = wingCoverOf(ctx.c, w.key);
    const th = d.textHeight;
    const mir = face === 'back';
    const X = (x) => (mir ? ox + ev.L1 - x : ox + x);
    const P = ([x, y]) => [X(x), oy + y];
    d.pline(ev.poly.map(P), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    // 본체 측 (접합부) 표시
    d.line(X(0), oy, X(0), oy + ev.hRoot, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    const col = COLOR.MAGENTA;
    const xs = zonePositions(f.V, 0).filter(x => x < ev.L1 - 1);
    for (const x of xs) d.line(X(x), oy + cv.bottom, X(x), oy + ev.topAt(x) - cv.top, { color: col, layer: 'REBAR' });
    const ys = zonePositions(f.H, 0).filter(y => y < ev.hRoot - 1);
    const ext = (y) => (y <= ev.hTip ? ev.L1 : ev.L1 * (ev.hRoot - y) / Math.max(1, ev.hRoot - ev.hTip));
    for (const y of ys) d.line(X(-th * 1.5), oy + y, X(Math.max(0, ext(y) - cv.end)), oy + y, { color: col, layer: 'REBAR' });
    if (face === 'back' && +f.M > 0) for (const y of ys) { const e = ext(y) - +f.M; if (e > 0) d.line(X(0), oy + y + th * 0.15, X(e), oy + y + th * 0.15, { color: COLOR.MAGENTA, layer: 'REBAR' }); }
    // 치수 체인 (아래: V, 측면: H)
    const gV = groupChain(xs, 0);
    for (let i = 0; i < gV.xs.length - 1; i++) {
        const a = X(gV.xs[i]), b = X(gV.xs[i + 1]);
        d.dimH(Math.min(a, b), Math.max(a, b), oy, oy - th * 2, gV.labels[i], { h: th * 0.5, name: `V${i + 1}` });
    }
    d.dimH(ox, ox + ev.L1, oy, oy - th * 3.6, undefined, { h: th * 0.6 });
    const gH = groupChain(ys, 0);
    const xr = mir ? ox + ev.L1 : ox;
    const xd = mir ? xr + th * 2 : xr - th * 2;
    for (let i = 0; i < gH.xs.length - 1; i++) d.dimV(oy + gH.xs[i], oy + gH.xs[i + 1], xr, xd, gH.labels[i], { h: th * 0.5, name: `H${i + 1}` });
    d.dimV(oy, oy + ev.hRoot, xr, mir ? xr + th * 3.6 : xr - th * 3.6, undefined, { h: th * 0.6 });
    // 기호
    const bub = (pt, txt, dia, dx) => {
        const q = [pt[0] + dx, pt[1] + th * 1.6];
        d.line(pt[0], pt[1], q[0], q[1] - th * 0.7, { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], txt, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + th, q[1], dia, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    };
    if (xs.length) { const x = xs[Math.floor(xs.length / 2)]; bub([X(x), oy + ev.topAt(x) * 0.6], `${marks.main}1`, f.dia.v, th * 2); }
    if (ys.length) { const y = ys[Math.floor(ys.length / 3)]; bub([X(ext(y) * 0.4), oy + y], `${marks.main}2`, f.dia.h1, th * 2); }
    d.text(ox + ev.L1 / 2, oy + ev.hRoot + th * 1.4, face === 'front' ? '전 면' : '배 면', { color: active ? COLOR.YELLOW : COLOR.WHITE, h: th * 1.1, layer: 'TEXT' });
    return ev;
}

function integralDrawing(ctx, w, tab) {
    const ev = integralElevation(ctx.c, w.key);
    const th = Math.max(80, Math.max(ev.L1, ev.hRoot) / 40);
    const d = new Drawing({ textHeight: th });
    const r = store.get(itemPath(ctx));
    const { cover: cv, marks } = wingCoverOf(ctx.c, w.key);
    const gapX = th * 10;
    elevation(d, ctx, w, 'front', 0, 0, tab === 'front');
    elevation(d, ctx, w, 'back', ev.L1 + gapX, 0, tab === 'back');
    // 단면 A-A (근단 수직단면)
    const oy = -ev.hRoot - th * 9;
    const T1 = ev.T1 || 300, T2 = ev.T2 || 300, H = ev.hRoot;
    const ox = 0;
    d.pline([[ox, oy], [ox + T2, oy], [ox + T1, oy + H], [ox, oy + H]], { color: COLOR.CYAN, layer: 'CONC', closed: true });
    const xb = (y) => ox + T2 + (T1 - T2) * y / H;
    d.line(ox + cv.front, oy + cv.bottom, ox + cv.front, oy + H - cv.top, { color: COLOR.MAGENTA, layer: 'REBAR' });
    d.line(xb(cv.bottom) - cv.back, oy + cv.bottom, xb(H - cv.top) - cv.back, oy + H - cv.top, { color: COLOR.MAGENTA, layer: 'REBAR' });
    const rr = Math.max(10, th * 0.12);
    for (const y of zonePositions(r.front.H, 0).filter(y => y < H)) d.circle(ox + cv.front + barD(r.front.dia.v), oy + y, rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
    for (const y of zonePositions(r.back.H, 0).filter(y => y < H)) d.circle(xb(y) - cv.back - barD(r.back.dia.v), oy + y, rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
    if (r.shear.dia) for (const y of zonePositions(r.back.H, 0).filter((y, i) => i % 3 === 1 && y < H)) d.line(ox + cv.front - barD(r.shear.dia), oy + y, xb(y) - cv.back + barD(r.shear.dia), oy + y, { color: COLOR.MAGENTA, layer: 'REBAR' });
    d.dimH(ox, ox + T1, oy + H, oy + H + th * 2, undefined, { h: th * 0.6 });
    d.dimH(ox, ox + T2, oy, oy - th * 2, undefined, { h: th * 0.6 });
    d.dimV(oy, oy + H, ox, ox - th * 2, undefined, { h: th * 0.6 });
    d.text(ox + T2 / 2, oy - th * 3.5, '단면 A-A', { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    // 단면 B-B (평면)
    try {
        const wp = wingPlan(ctx.p, ctx.c, w.key);
        // 평면 배치 그대로 회전만 해서 날개벽을 수평으로 (calc/wingRebar.wingPlanView)
        const pv = wingPlanView(wp);
        const L = wp.len, T = wp.thick;
        const bx = T1 + th * 12 + (pv.sx < 0 ? L + th * 4 : 0), by = oy + H / 2;
        const Q = (p) => { const q = pv.Q(p); return [bx + q[0], by + q[1]]; };
        d.pline(wp.poly.map(Q), { color: COLOR.CYAN, layer: 'CONC', closed: true });
        if (wp.haunch) d.line(...Q(wp.haunch[0]), ...Q(wp.haunch[1]), { color: COLOR.CYAN, layer: 'CONC' });
        drawBodyWall(d, wp, Q, r.back.dia.hu ? haunchBarLine(wp, cv) : null);
        // 수평철근: 암거 벽체 내측 피복까지 연장, 끝 100 꺾음 (calc/wingRebar.horzBarPlan)
        for (const fk of ['front', 'back']) {
            const hp = horzBarPlan(wp, cv, fk);
            if (hp) d.pline(hp.pts.map(Q), { color: COLOR.MAGENTA, layer: 'REBAR' });
        }
        for (const x of zonePositions(r.front.V, 0).filter(x => x < L)) d.circle(...Q(pv.at(x, cv.front + barD(r.front.dia.h1))), rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
        for (const x of zonePositions(r.back.V, 0).filter(x => x < L)) d.circle(...Q(pv.at(x, T - cv.back - barD(r.back.dia.h1))), rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
        if (wp.haunch && r.back.dia.hu) {
            // 헌치면과 평행, 양 끝은 외면 수평철근 위치까지 (calc/wingRebar.haunchBarLine)
            const hb = haunchBarLine(wp, cv);
            if (hb) {
                d.pline(hb.pts.map(Q), { color: COLOR.MAGENTA, layer: 'REBAR' });
                const m = Q(wp.haunch[1]);
                d.text(m[0] + th * pv.sx, m[1] + th * pv.sy, `${marks.haunch}1 ${r.back.dia.hu}`, { color: COLOR.GREEN, h: th * 0.6, align: pv.sx > 0 ? 'left' : 'right', layer: 'MARK' });
            }
        }
        // 길이 치수는 전면 쪽, 제목은 배면 쪽
        const [xa] = Q(wp.root), [xb] = Q(pv.at(L, 0));
        d.dimH(Math.min(xa, xb), Math.max(xa, xb), by, by - pv.sy * th * 2, undefined, { h: th * 0.6 });
        d.text((xa + xb) / 2, by + pv.sy * (T + th * 3.5), '단면 B-B', { color: COLOR.WHITE, h: th, valign: pv.sy < 0 ? 'top' : 'bottom', layer: 'TEXT' });
    } catch (e) { void e; }
    d.legend = '날개벽 배근';
    return d;
}

/** 단면 B-B 의 암거 벽체 (일부, 끝은 절단선) */
function drawBodyWall(d, wp, Q, hb) {
    const bw = bodyWallPlan(wp, hb);
    for (const sg of [bw.outer, bw.inner, bw.end]) d.line(...Q(sg[0]), ...Q(sg[1]), { color: COLOR.CYAN, layer: 'CONC' });
    d.line(...Q(bw.cut[0]), ...Q(bw.cut[1]), { color: COLOR.GRAY, layer: 'CUT', dash: 'center' });
}

function wallDrawing(ctx, w, tab) {
    const rows = (ctx.c.wings && ctx.c.wings.dim && ctx.c.wings.dim[w.key] && ctx.c.wings.dim[w.key].wall && ctx.c.wings.dim[w.key].wall.rows) || [defaultWallRow(ctx.c), defaultWallRow(ctx.c, true)];
    const r = store.get(itemPath(ctx));
    const { marks } = wingCoverOf(ctx.c, w.key);
    const s = wallSection(rows[0]);
    const th = Math.max(80, Math.max(s.W, s.WH) / 35);
    const d = new Drawing({ textHeight: th });
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.pline(s.poly, { ...cy, closed: true });
    if (s.key) d.pline(s.key, cy);
    if (s.lean) d.pline(s.lean, { ...cy, closed: true });
    const c = 80;
    const st = s.stem;
    const backAt = (y) => st.xb0 + (st.xt0 - st.xb0) * (y - s.BF1) / ((s.WH - s.BF1) || 1);
    const frontAt = (y) => st.xb1 + (st.xt1 - st.xb1) * (y - s.yJ) / ((s.WH - s.yJ) || 1);
    const view = r.view || {};
    const wCol = COLOR.MAGENTA;
    const fCol = COLOR.MAGENTA;
    const m = r.main;
    const pts = [];
    if (m.wall.place) {
        const yb = c, yt = s.WH - c;
        d.pline([[backAt(yt) + c, yt], [st.xb0 + c, Math.max(yb, s.BF1)], [st.xb0 + c, yb], [st.xb0 + c - 400, yb]], { color: wCol, layer: 'REBAR' });
        d.pline([[frontAt(yt) - c, yt], [st.xb1 - c, s.yJ], [st.xb1 - c, yb], [st.xb1 - c + 400, yb]], { color: wCol, layer: 'REBAR' });
        pts.push([[backAt(s.WH * 0.6) + c, s.WH * 0.6], `${marks.main}1`, m.wall.back, -1], [[frontAt(s.WH * 0.6) - c, s.WH * 0.6], `${marks.main}2`, m.wall.front, 1]);
    }
    if (m.foot.place) {
        const yT = (x) => (x <= st.xb0 ? s.BF2 + (s.BF1 - s.BF2) * x / (st.xb0 || 1) : s.BB1 + (s.BB2 - s.BB1) * (x - st.xb1) / ((s.W - st.xb1) || 1)) - c;
        d.pline([[c, yT(c)], [st.xb0, yT(st.xb0)], [m.foot.gap ? st.xb1 : s.W - c, m.foot.gap ? s.BB1 - c : yT(s.W - c)]], { color: fCol, layer: 'REBAR' });
        d.line(c, c, s.W - c, c, { color: fCol, layer: 'REBAR' });
        pts.push([[s.W * 0.2, yT(s.W * 0.2)], `${marks.main}3`, m.foot.top, -1], [[s.W * 0.75, c], `${marks.main}4`, m.foot.bottom, 1]);
    }
    const hz = r.horz;
    const rr = Math.max(10, th * 0.12);
    const hc = COLOR.MAGENTA;
    for (let y = s.yJ + 100; y < s.WH - c; y += +hz.wall.ctc || 300) {
        d.circle(backAt(y) + c + 25, y, rr, { color: hc, fill: hc, layer: 'REBAR' });
        d.circle(frontAt(y) - c - 25, y, rr, { color: hc, fill: hc, layer: 'REBAR' });
    }
    for (let x = c + 100; x < s.W - c; x += +hz.foot.ctc || 300) {
        d.circle(x, c + 25, rr, { color: hc, fill: hc, layer: 'REBAR' });
    }
    if (tab === 'shear' && r.shear.wall.dia) for (let y = s.yJ + 300; y < s.WH - 300; y += +r.shear.wall.ctc || 500) d.line(backAt(y) + c - 20, y, frontAt(y) - c + 20, y, { color: COLOR.MAGENTA, layer: 'REBAR' });
    if (tab === 'shear' && r.shear.foot.dia) for (let x = c + 250; x < s.W - c; x += +r.shear.foot.ctc || 500) d.line(x, c - 20, x, Math.min(s.BF1, s.BB1) - c + 20, { color: COLOR.MAGENTA, layer: 'REBAR' });
    for (const [pt, t, dia, sg] of pts) {
        const q = [pt[0] + sg * th * 3, pt[1] + th * 1.5];
        d.line(pt[0], pt[1], q[0] - sg * th * 0.7, q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], t, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + sg * th, q[1], dia, { color: COLOR.GREEN, h: th * 0.6, align: sg > 0 ? 'left' : 'right', valign: 'middle', layer: 'MARK' });
    }
    d.dimH(0, s.W, 0, -th * 2.5, undefined, { h: th * 0.6 });
    d.dimV(0, s.WH, s.W, s.W + th * 2.5, undefined, { h: th * 0.6 });
    d.text(s.W / 2, s.WH + th * 1.5, `옹벽식 날개벽 단면 (시점측) — ${tab === 'main' ? '주철근' : tab === 'horz' ? '수평철근' : '전단철근'}`, { color: COLOR.WHITE, h: th, layer: 'TEXT' });
    d.legend = '날개벽 배근';
    return d;
}

// ── 팝업 ──────────────────────────────────────────────────────────────

function coverPopup(ctx) {
    const w = cur(ctx);
    if (!w) return;
    const base = wPath(ctx);
    ensure(base, defaultWingCommon);
    const snap = clone(store.get(base));
    liveModal('철근덮개 및 기호설정', (body) => {
        const same = getWingCommon(store.get(`culverts.${ctx.ci}`)).sameAll;
        const bp = same ? base : `${base}.own.${w.key}`;
        if (!same && !store.get(`${bp}.cover`)) {
            const cm = getWingCommon(store.get(`culverts.${ctx.ci}`));
            store.set(bp, { cover: clone(cm.cover), marks: clone(cm.marks) }, { record: false, silent: true });
        }
        body.appendChild(h('div', { class: 'note' }, '註) 피복은 입력 편의상 콘크리트 표면과 철근 중심 사이의 거리를 의미함.'));
        const wrap = h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } });
        const a = h('div'), b = h('div');
        new Grid(a, { id: 'wing-cov', head: [[{ t: '철근위치' }, { t: '설정값' }]], rows: COVER_ROWS.map(([k, t]) => ({ head: [{ t }], cells: [num(`${bp}.cover.${k}`, { dec: 0 })] })), colWidths: [100, 70] });
        new Grid(b, { id: 'wing-mark', head: [[{ t: '철근위치' }, { t: '설정기호' }]], rows: MARK_ROWS.map(([k, t]) => ({ head: [{ t }], cells: [txt(`${bp}.marks.${k}`)] })), colWidths: [100, 70] });
        wrap.appendChild(a); wrap.appendChild(b);
        body.appendChild(wrap);
        body.appendChild(h('div', { class: 'inline-opts' }, [
            button('기본값', () => { const d = defaultWingCommon(); store.transact(() => { store.set(`${bp}.cover`, d.cover); store.set(`${bp}.marks`, d.marks); }); }),
            bCheck(`${base}.sameAll`, ' 모든 날개벽에 현재의 설정을 적용', { onChange: (v) => store.set(`${base}.sameAll`, v) }),
        ]));
        body.appendChild(h('div', { class: 'note' }, same ? '* 모든 날개벽 공통 설정을 편집합니다.' : `* ${w.name} 의 개별 설정을 편집합니다.`));
    }, { buttons: [{ text: '확인(O)', primary: true }, { text: '취소(C)', onClick: () => store.set(base, snap) }], minWidth: 400 });
}

function checkPopup(ctx) {
    const w = cur(ctx);
    if (!w) return;
    const rows = wingCheck(store.project, store.project.culverts[ctx.ci], w.key);
    const f = (v, n = 1) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(n));
    const ok = (v) => (v == null ? lbl('-', { align: 'center' }) : lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' }));
    const body = h('div', { style: { minWidth: '760px' } });
    new Grid(body, {
        id: 'wing-check',
        head: [[{ t: '구분', cs: 2, rs: 2 }, { t: '단면', cs: 3 }, { t: '휨', cs: 3 }, { t: '전단', cs: 3 }, { t: '균열', cs: 3 }],
            [{ t: 'H' }, { t: 'd' }, { t: 'As (mm²)' }, { t: 'Mu' }, { t: 'φMn' }, { t: '판정' }, { t: 'Vu' }, { t: 'φVn' }, { t: '판정' }, { t: 'fs' }, { t: '허용' }, { t: '판정' }]],
        rows: rows.map(r => ({
            head: [{ t: r.part }, { t: r.pos }],
            cells: [lbl(f(r.h, 0)), lbl(f(r.d, 0)), lbl(f(r.As)), lbl(f(r.Mu)), lbl(f(r.phiMn)), ok(r.okM), lbl(f(r.Vu)), lbl(f(r.phiVn)), ok(r.okV),
                lbl(r.crack ? f(r.crack.fs) : '-'), lbl(r.crack ? (r.crack.method === '간격' ? `s≤${f(r.crack.sAllow, 0)}` : `w≤${f(r.crack.wa, 3)}`) : '-'), ok(r.crack ? r.crack.ok : null)],
        })),
    });
    body.appendChild(h('div', { class: 'note' }, '* 간이검토: 주동토압(Rankine, 설계조건 > 날개벽 뒷채움) + 상재하중, 하중계수 = 설계조건 날개벽 토압/활하중 계수. '
        + '일체식은 본체에 고정된 수평 캔틸레버(높이 1 m 띠)로 배면 수평철근을, 옹벽식은 벽체 하단 배면 주철근과 뒷굽 상면철근을 검토합니다. (kN, kN·m, MPa)'));
    modal({ title: `날개벽 설계검토 - ${w.name}`, body, buttons: [{ text: '확인', primary: true }], width: 860 });
}
