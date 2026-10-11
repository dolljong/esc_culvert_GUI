// 상세입력 > 토공 상세 (매뉴얼 3.6)
// 일반사항 (경사비, 굴착깊이, 소단제원) / 좌측구간 / 우측구간 (토공형태, 시종점, 이격거리)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl } from '../ui/cells.js';
import { h, button, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { jointStations, fmtSta } from '../core/model.js';
import { drawProfile } from '../draw/planDraw.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { LAYER_STYLE } from '../calc/ground.js';
import {
    EW_TYPES, EW_REFS, SOILS, defaultEarthwork, defaultEwSection, excavationAt, blockEnds,
} from '../calc/earthwork.js';

const selRow = { left: 0, right: 0 };

export function ensureEarthwork(ctx) {
    const c = ctx.c;
    if (!c.earthwork || !c.earthwork.slope) {
        store.set(`${ctx.cp}.earthwork`, defaultEarthwork(c), { record: false, silent: true });
    }
    return store.get(`${ctx.cp}.earthwork`);
}

const HINT = {
    slope: (s) => `${s} - 경사비를 입력합니다. (수직 1 : 수평)`,
    first: '최초 굴착깊이를 입력합니다. (mm)', unit: '이후 단위별 굴착깊이를 입력합니다. (mm)',
    bH: '터파기 기준위치에서 소단이 시작되는 수직높이 (mm)', bW: '소단 폭 (mm)', bS: '소단 경사 (%)',
    type: '횡단면상 토공형태를 선택합니다. (터파기 / 가시설)',
    ref: '종단면상 기준위치 ([구간 설정]의 위치 번호)', off: '기준위치에서의 이격거리 (mm)',
    gap: '횡단면상 구조물 좌·우측으로의 이격거리 (기초 끝단에서 터파기 하단까지, mm)',
};

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '토사 - 경사비를 입력합니다.',

    tabs: () => [{ id: 'gen', title: '일반사항' }, { id: 'left', title: '좌측구간' }, { id: 'right', title: '우측구간' }],

    header(el, ctx) {
        ensureEarthwork(ctx);
        const s = h('select', {});
        const cur = store.get(`${ctx.cp}.earthwork.ref`);
        EW_REFS.forEach(r => { const o = h('option', { value: r }, r); if (r === cur) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', () => store.set(`${ctx.cp}.earthwork.ref`, s.value));
        el.appendChild(h('label', { style: { marginLeft: 'auto' } }, ['터파기 하면 기준위치 ', s]));
    },

    render(el, ctx, tab) {
        const ew = ensureEarthwork(ctx);
        const ep = `${ctx.cp}.earthwork`;
        if (tab === 'gen') {
            new Grid(el, {
                id: 'ew-gen',
                head: [
                    [{ t: '경사비(수직:수평)', cs: 4 }, { t: '굴착 깊이', cs: 2 }, { t: '소단 제원', cs: 3 }],
                    [...SOILS.map(s => ({ t: s })), { t: '최초굴착' }, { t: '단위굴착' }, { t: '높이' }, { t: '폭' }, { t: '경사' }],
                ],
                rows: [{
                    cells: [
                        ...SOILS.map(s => num(`${ep}.slope.${s}`, { dec: 2, hint: HINT.slope(s), validate: v => (v >= 0 ? null : '경사비는 0 이상이어야 합니다.') })),
                        num(`${ep}.dig.first`, { dec: 0, hint: HINT.first }),
                        num(`${ep}.dig.unit`, { dec: 0, hint: HINT.unit }),
                        num(`${ep}.berm.H`, { dec: 0, hint: HINT.bH }),
                        num(`${ep}.berm.W`, { dec: 0, hint: HINT.bW }),
                        num(`${ep}.berm.S`, { dec: 2, hint: HINT.bS }),
                    ],
                }],
                colWidths: [60, 60, 60, 60, 70, 70, 60, 60, 60],
            });
            return;
        }
        const n = jointStations(ctx.c).length;
        const refs = Array.from({ length: n }, (_, i) => i + 1);
        const list = ew[tab] || [];
        new Grid(el, {
            id: 'ew-' + tab,
            onSelect: (cell, r) => { selRow[tab] = r; },
            head: [
                [{ t: '구간', rs: 2 }, { t: '토공형태', rs: 2 }, { t: '시점', cs: 2 }, { t: '종점', cs: 2 }, { t: '이격거리 (mm)', html: '이격거리<br>(mm)', rs: 2 }],
                [{ t: '기준위치' }, { t: '이격거리' }, { t: '기준위치' }, { t: '이격거리' }],
            ],
            rows: list.map((r, i) => {
                const p = `${ep}.${tab}.${i}`;
                return {
                    cells: [
                        lbl(i + 1, { align: 'center' }),
                        sel(`${p}.type`, EW_TYPES, { hint: HINT.type }),
                        sel(`${p}.s.ref`, refs, { hint: HINT.ref }),
                        num(`${p}.s.off`, { dec: 0, hint: HINT.off }),
                        sel(`${p}.e.ref`, refs, { hint: HINT.ref }),
                        num(`${p}.e.off`, { dec: 0, hint: HINT.off }),
                        num(`${p}.gap`, { dec: 0, hint: HINT.gap }),
                    ],
                };
            }),
            colWidths: [40, 80, 70, 80, 70, 80, 80],
        });
        el.appendChild(h('div', { class: 'note' }, '* [기본값] 후 구간을 선택하여 추가/삭제하면 종방향으로 다른 토공상세를 적용할 수 있습니다.'));
    },

    footer(el, ctx, tab) {
        const off = tab === 'gen';
        el.appendChild(button('구간추가', () => addRow(ctx, tab), { disabled: off }));
        el.appendChild(button('구간삭제', () => delRow(ctx, tab), { disabled: off }));
        el.appendChild(button('좌우측 동일 적용', () => {
            const other = tab === 'left' ? 'right' : 'left';
            store.set(`${ctx.cp}.earthwork.${other}`, clone(store.get(`${ctx.cp}.earthwork.${tab}`)));
            ctx.setHint(`${tab === 'left' ? '좌측' : '우측'}구간 데이터를 ${tab === 'left' ? '우측' : '좌측'}구간에 적용했습니다.`);
        }, { disabled: off }));
    },

    defaults(ctx, tab) {
        const cur = clone(ensureEarthwork(ctx));
        const d = defaultEarthwork(ctx.c);
        if (tab === 'gen') { cur.slope = d.slope; cur.dig = d.dig; cur.berm = d.berm; cur.ref = d.ref; } else cur[tab] = d[tab];
        store.set(`${ctx.cp}.earthwork`, cur);
    },

    draw(ctx) {
        ensureEarthwork(ctx);
        const p = ctx.p, c = ctx.c;
        const th = sectionTextHeight(c, ctx.bi) * 1.1;
        // 상단: 종단면도
        const dP = new Drawing({ textHeight: th });
        drawProfile(dP, p, c, {});
        // 하단: 블록 시점/종점 터파기 횡단
        const [s0, s1] = blockEnds(c, ctx.bi);
        const dA = new Drawing({ textHeight: th });
        drawExcavation(dA, p, c, ctx.bi, s0, `BLOCK ${ctx.bi + 1} (시점)`);
        const dB = new Drawing({ textHeight: th });
        drawExcavation(dB, p, c, ctx.bi, s1, `BLOCK ${ctx.bi + 1} (종점)`);
        const a = dA.bbox(), b = dB.bbox();
        if (a && b) dA.merge(dB, a.maxX + th * 6 - b.minX, 0);
        const pb = dP.bbox(), ab = dA.bbox();
        if (pb && ab) dP.merge(dA, pb.minX + pb.w / 2 - (ab.minX + ab.w / 2), pb.minY - th * 6 - ab.maxY);
        return dP;
    },
    viewKey: (ctx) => `earthwork|${ctx.ci}|${ctx.bi}`,
};

/** 터파기 횡단면 (단면좌표, y 는 단면좌표 그대로) */
export function drawExcavation(d, p, c, bi, sta, title) {
    const th = d.textHeight;
    const ex = excavationAt(p, c, bi, sta);
    const g = drawSection(d, c, bi, { dims: false, alignment: p.alignment, alignName: p.alignment.name, sta });
    const xs = [ex.left ? Math.min(ex.left.xTop, ex.left.x0) : g.baseX0 - th * 8, ex.right ? Math.max(ex.right.xTop, ex.right.x0) : g.baseX1 + th * 8];
    const xL = xs[0] - th * 3, xR = xs[1] + th * 3;
    // 지층선
    for (const L of ex.layers) {
        const y = ex.toY(L.top);
        const st = LAYER_STYLE[L.name] || { color: 6 };
        d.line(xL, y, xR, y, { ...st, layer: 'GROUND' });
        d.text(xL, y + th * 0.25, L.name, { color: COLOR.GREEN, h: th * 0.7, align: 'left', layer: 'TEXT' });
    }
    if (ex.gwl != null) {
        const y = ex.toY(ex.gwl);
        d.line(xL, y, xR, y, { ...LAYER_STYLE['지하수위'], layer: 'GROUND' });
        d.text(xR, y + th * 0.25, '지하수위', { color: COLOR.GREEN, h: th * 0.7, align: 'right', layer: 'TEXT' });
    }
    // 터파기선 / 가시설
    const yB = ex.yBottom;
    for (const side of ['left', 'right']) {
        const e = ex[side];
        if (!e) continue;
        if (e.type === '가시설') {
            d.pline(e.pts, { color: COLOR.RED, layer: 'EARTH', width: 2 });
            d.text(e.x0 + (side === 'left' ? -th * 0.4 : th * 0.4), (yB + ex.yGround) / 2, '가시설', { color: COLOR.GREEN, h: th * 0.7, rot: 90, layer: 'TEXT', valign: side === 'left' ? 'bottom' : 'top' });
        } else d.pline(e.pts, { color: COLOR.RED, layer: 'EARTH' });
    }
    // 터파기 하면
    const xb0 = ex.left ? ex.left.x0 : g.baseX0, xb1 = ex.right ? ex.right.x0 : g.baseX1;
    d.line(xb0, yB, xb1, yB, { color: COLOR.RED, layer: 'EARTH' });
    // 치수: 하단 체인
    const yDim = Math.min(yB, ...['left', 'right'].map(s => (ex[s] ? Math.min(...ex[s].pts.map(q => q[1])) : yB))) - th * 3;
    const chain = [];
    if (ex.left) chain.push(ex.left.xTop, ex.left.x0);
    chain.push(g.baseX0 - (g.lean ? g.lean.w : 0), g.baseX1 + (g.lean ? g.lean.w : 0));
    if (ex.right) chain.push(ex.right.x0, ex.right.xTop);
    const cs = [...new Set(chain.map(v => Math.round(v * 10) / 10))].sort((a, b) => a - b);
    for (let i = 0; i < cs.length - 1; i++) d.dimH(cs[i], cs[i + 1], yB, yDim);
    d.dimH(cs[0], cs[cs.length - 1], yB, yDim - th * 2.6);
    // 좌우 높이 (하면 → 소단 → 지표)
    for (const side of ['left', 'right']) {
        const e = ex[side];
        if (!e || e.type === '가시설') continue;
        const x = side === 'left' ? e.xTop - th * 2.5 : e.xTop + th * 2.5;
        const ys = [yB, ...e.berms, ex.yGround];
        for (let i = 0; i < ys.length - 1; i++) d.dimV(ys[i], ys[i + 1], e.xTop, x);
    }
    // 지반고 EL
    d.elMark(xR - th * 6, ex.yGround, ex.groundEl, { h: th * 0.6 });
    d.text((cs[0] + cs[cs.length - 1]) / 2, yDim - th * 5.5, title, { color: COLOR.GREEN, h: th * 1.1, layer: 'TEXT' });
    d.text((cs[0] + cs[cs.length - 1]) / 2, yDim - th * 7, `STA. ${fmtSta(sta)}`, { color: COLOR.GREEN, h: th * 0.7, layer: 'TEXT' });
    return ex;
}

function addRow(ctx, tab) {
    const list = clone(store.get(`${ctx.cp}.earthwork.${tab}`) || []);
    const i = Math.min(selRow[tab] ?? list.length - 1, list.length - 1);
    const base = list[i] || defaultEwSection(ctx.c);
    // 선택 구간을 둘로 나눈다: 기준위치의 중간
    const a = base.s.ref, b = base.e.ref;
    const mid = Math.round((a + b) / 2);
    const r1 = { ...clone(base), e: { ref: mid, off: 0 } };
    const r2 = { ...clone(base), s: { ref: mid, off: 0 } };
    if (mid === a || mid === b) list.splice(i + 1, 0, clone(base));
    else list.splice(i, 1, r1, r2);
    store.set(`${ctx.cp}.earthwork.${tab}`, list);
}

function delRow(ctx, tab) {
    const list = clone(store.get(`${ctx.cp}.earthwork.${tab}`) || []);
    if (list.length <= 1) { alertBox('구간은 최소 1개 이상이어야 합니다.', '토공 상세'); return; }
    const i = Math.min(selRow[tab] ?? 0, list.length - 1);
    // 삭제한 구간 범위를 앞(또는 뒤) 구간이 이어받는다
    if (i > 0) list[i - 1].e = clone(list[i].e);
    else if (list[1]) list[1].s = clone(list[0].s);
    list.splice(i, 1);
    store.set(`${ctx.cp}.earthwork.${tab}`, list);
}
