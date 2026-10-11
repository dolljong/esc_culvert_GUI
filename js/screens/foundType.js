// 일반 입력 > 기초 형식 (매뉴얼 2.7)
// 구간별 기초형식(직접/잡석/말뚝), 시·종점 기준위치와 이격거리, 버림(매스)콘크리트 두께·너비.
// 데이터 culverts[i].foundType (calc/foundType.js). 버림 두께/너비는 단면(section.lean,
// blockSections[*].lean)에도 반영하여 sectionGeom 이 버림콘크리트를 그리도록 한다.

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bNumber, alertBox } from '../ui/dom.js';
import { COLOR } from '../cad/drawing.js';
import { jointStations, blocks } from '../core/model.js';
import { drawProfile, newPlanDrawing } from '../draw/planDraw.js';
import { sectionDrawing } from '../draw/sectionDraw.js';
import { FOUND_TYPES, FOUND_PILE_TYPES, defaultFoundType, normalizeFoundType, foundRowRange } from '../calc/foundType.js';
import { sectionPath } from './section.js';

let selRow = 0;

function ensure(ctx) {
    const c = ctx.c;
    const n = normalizeFoundType(c, c.foundType);
    if (JSON.stringify(n) !== JSON.stringify(c.foundType)) store.set(`${ctx.cp}.foundType`, n, { record: false, silent: true });
    return c.foundType;
}

/** 버림 두께/너비 → 단면 lean */
export function syncLean(ctx) {
    const c = ctx.c;
    const ft = normalizeFoundType(c, c.foundType);
    const rowOf = (bi) => ft.rows.find(r => bi >= r.s.ref && bi < r.e.ref) || ft.rows[ft.rows.length - 1];
    const leanOf = (r) => ({ t: +r.t || 0, w: +r.w || 0 });
    const r0 = rowOf(0);
    if (JSON.stringify((c.section || {}).lean) !== JSON.stringify(leanOf(r0))) store.set(`${ctx.cp}.section.lean`, leanOf(r0));
    if (c.type === '지하차도') {
        for (const b of blocks(c)) {
            const sp = sectionPath({ c, cp: ctx.cp, bi: b.index });
            const ln = leanOf(rowOf(b.index));
            if (JSON.stringify(store.get(`${sp}.lean`)) !== JSON.stringify(ln)) store.set(`${sp}.lean`, ln);
        }
    }
}

function setSync(ctx, path, v) {
    store.transact(() => { store.set(path, v); syncLean(ctx); });
}

export default {
    scope: 'culvert',
    hint: '기초형식 데이터를 입력합니다.',

    header(el, ctx) {
        ensure(ctx);
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [
            bNumber(`${ctx.cp}.foundType.slope`, { label: '버림콘크리트 사면경사  1 :', dec: 3, width: 60 }),
        ]));
    },

    render(el, ctx) {
        const ft = ensure(ctx);
        const c = ctx.c;
        const nJ = (c.joints || []).length;
        const fp = `${ctx.cp}.foundType`;
        const refOpts = (lo, hi) => Array.from({ length: nJ }, (_, k) => k).filter(k => k >= lo && k <= hi).map(k => ({ value: k, label: String(k + 1) }));
        const rows = ft.rows.map((r, i) => {
            const rp = `${fp}.rows.${i}`;
            const last = i === ft.rows.length - 1;
            const nextE = last ? nJ - 1 : ft.rows[i + 1].e.ref - 1;
            const rubble = r.type === '잡석기초', pile = r.type === '말뚝기초';
            return {
                head: [{ t: String(i + 1) }],
                cells: [
                    custom('select', () => r.type, (v) => store.set(`${rp}.type`, v), { options: FOUND_TYPES, hint: '기초형식을 선택합니다. (직접기초, 잡석기초, 말뚝기초)' }),
                    lbl(r.s.ref + 1, { cls: 'ro', align: 'center', hint: '시점 기준위치 (암거시점 = 1, 신축이음 순서대로 번호)' }),
                    num(`${rp}.s.off`, { dec: 0, hint: '기준위치로부터의 이격거리(mm). + 선형진행방향, − 반대방향' }),
                    last ? lbl(r.e.ref + 1, { cls: 'ro', align: 'center' })
                        : custom('select', () => r.e.ref, (v) => store.set(`${rp}.e.ref`, +v), { options: refOpts(r.s.ref + 1, nextE), hint: '종점 기준위치를 선택합니다.' }),
                    num(`${rp}.e.off`, { dec: 0, hint: '기준위치로부터의 이격거리(mm). + 선형진행방향, − 반대방향' }),
                    custom('num', () => r.t, (v) => setSync(ctx, `${rp}.t`, v), { dec: 0, hint: '버림/매스콘크리트의 두께(mm)를 입력합니다.' }),
                    custom('num', () => r.w, (v) => setSync(ctx, `${rp}.w`, v), { dec: 0, hint: '기초 연단에서 버림/매스콘크리트의 돌출 너비(mm)를 입력합니다.' }),
                    rubble ? num(`${rp}.rubble`, { dec: 0, hint: '잡석기초의 잡석 높이(mm)를 입력합니다.' }) : dash(),
                    pile ? custom('select', () => r.pile, (v) => store.set(`${rp}.pile`, v), { options: FOUND_PILE_TYPES, hint: '말뚝형식을 선택합니다.' }) : dash(),
                ],
            };
        });
        new Grid(el, {
            id: 'foundType-grid',
            head: [
                [{ t: '구간', rs: 2 }, { t: '기초형식', rs: 2 }, { t: '시점', cs: 2 }, { t: '종점', cs: 2 }, { t: '버림/매스콘크리트', cs: 3 }, { t: '말뚝형식', rs: 2 }],
                [{ t: '기준위치' }, { t: '이격거리' }, { t: '기준위치' }, { t: '이격거리' }, { t: '두께' }, { t: '너비' }, { t: '잡석높이' }],
            ],
            rows,
            colWidths: [40, 90, 65, 70, 65, 70, 60, 60, 65, 110],
            onSelect: (_, r) => { selRow = r; },
        });
        const st = jointStations(c);
        el.appendChild(h('div', { class: 'note' }, '기준위치 : ' + st.map((s, k) => `${k + 1}(${s.toFixed(3)})`).join('  ') + '  — 이격거리 단위 mm'));
    },

    footer(el, ctx) {
        el.appendChild(button('구간추가', () => addRow(ctx)));
        el.appendChild(button('구간삭제', () => delRow(ctx)));
    },

    defaults(ctx) {
        const d = defaultFoundType(ctx.c);
        d.rows[0].t = 100; d.rows[0].w = 100;
        store.set(`${ctx.cp}.foundType`, d);
        syncLean(ctx);
    },

    apply(ctx) { store.transact(() => syncLean(ctx)); },

    draw(ctx) {
        const ft = ensure(ctx);
        const c = ctx.c, p = ctx.p;
        const d = newPlanDrawing(p, c);
        const th = d.textHeight;
        const pf = drawProfile(d, p, c, { refLabels: true });
        // 기초 구간 브래킷
        const yb = pf.yMin - th * 3;
        ft.rows.forEach((r) => {
            const rg = foundRowRange(c, r);
            const x0 = pf.X(rg.s), x1 = pf.X(rg.e);
            const st = { color: COLOR.RED, layer: 'DIM' };
            d.line(x0, yb, x1, yb, st);
            d.line(x0, yb, x0, yb + th * 0.8, st);
            d.line(x1, yb, x1, yb + th * 0.8, st);
            const lab = r.type === '말뚝기초' ? `말뚝기초 (${r.pile})` : r.type;
            d.text((x0 + x1) / 2, yb - th * 0.3, lab, { color: COLOR.GREEN, h: th * 0.75, valign: 'top', layer: 'TEXT' });
            d.text((x0 + x1) / 2, yb - th * 1.4, `(L=${rg.L.toFixed(3)}m)`, { color: COLOR.GREEN, h: th * 0.7, valign: 'top', layer: 'TEXT' });
        });
        // 횡단면 (아래)
        const sd = sectionDrawing(p, c, 0, { names: false });
        const bb = sd.bbox();
        const pb = d.bbox();
        if (bb && pb) {
            const scale = Math.min(1, (pb.w * 0.45) / bb.w);
            const dx = (pb.minX + pb.maxX) / 2 - (bb.minX + bb.maxX) / 2 * scale;
            const dy = (yb - th * 4) - bb.maxY * scale;
            d.merge(sd, dx, dy, scale);
        }
        return d;
    },
    viewKey: (ctx) => `foundType|${ctx.ci}`,
};

function addRow(ctx) {
    const ft = clone(ensure(ctx));
    const i = Math.max(0, Math.min(selRow, ft.rows.length - 1));
    const r = ft.rows[i];
    if (r.e.ref - r.s.ref < 2) { alertBox('선택한 구간이 하나의 블록이므로 나눌 수 없습니다.\n(구간은 신축이음 위치에서 나뉩니다)'); return; }
    const m = Math.floor((r.s.ref + r.e.ref) / 2);
    const nr = clone(r);
    nr.s = { ref: m, off: 0 };
    r.e = { ref: m, off: 0 };
    ft.rows.splice(i + 1, 0, nr);
    store.transact(() => { store.set(`${ctx.cp}.foundType`, ft); syncLean(ctx); });
}

function delRow(ctx) {
    const ft = clone(ensure(ctx));
    if (ft.rows.length <= 1) { alertBox('구간은 최소 1개가 있어야 합니다.'); return; }
    const i = Math.max(0, Math.min(selRow, ft.rows.length - 1));
    if (i > 0) { ft.rows[i - 1].e = ft.rows[i].e; ft.rows.splice(i, 1); }
    else { ft.rows[1].s = ft.rows[0].s; ft.rows.splice(0, 1); }
    selRow = Math.max(0, i - 1);
    store.transact(() => { store.set(`${ctx.cp}.foundType`, ft); syncLean(ctx); });
}
