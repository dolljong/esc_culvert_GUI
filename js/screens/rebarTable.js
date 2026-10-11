// 배근 입력 > 철근 제원 (매뉴얼 5.14)
// 블록(탭)별 철근 제원표. 분류 버튼 [암거본체][암거기타][암거상세부][보,기둥철근][날개벽][접속슬래브].
// [기본값] = 현재 블록을 배근 입력값으로 다시 생성 (잠금 행 보존), [전체 기본값] = 모든 블록.
// 데이터: culverts[i].rebar.table[bi].rows, 할증률 culverts[i].rebar.waste. 생성/집계: calc/barSchedule.js

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, txt } from '../ui/cells.js';
import { h, button, modal, bSelect, bNumber, bRadio } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { drawBars, OTHER_COLOR } from '../draw/rebarDraw.js';
import { drawBarShape } from '../draw/barShapes.js';
import { DIAS, mainBarLayout, normDia } from '../calc/rebar.js';
import { SHAPES, SHAPE_NOS } from '../calc/barShapes.js';
import { CATS, buildSchedule, computeRow, getWaste, defaultWaste, wasteFactor, blankRow } from '../calc/barSchedule.js';
import { getSettings } from '../calc/rebar.js';
import { ensureSettings } from './rebarSet.js';

const ui = { cat: CATS[0], sel: null };
const tPath = (ctx, bi) => `${ctx.cp}.rebar.table.${bi}`;
const biOf = (ctx, tab) => { const m = /^b(\d+)$/.exec(tab || ''); const n = m ? +m[1] : 0; return Math.min(n, Math.max(0, ctx.blocks.length - 1)); };
const SHAPE_OPT = SHAPE_NOS.map(n => ({ value: n, label: String(n) }));

/** 저장된 표가 없으면 생성해 넣는다 (기록 없음) */
function ensureTable(ctx, bi) {
    ensureSettings(ctx);
    const p = tPath(ctx, bi);
    if (!store.get(`${p}.rows`)) store.set(p, { rows: stripRows(buildSchedule(ctx.p, ctx.c, bi)) }, { record: false, silent: true });
    return p;
}

/** 저장용: 계산 필드 제거 */
function stripRows(rows) {
    return rows.map(r => { const o = { ...r }; delete o.length; delete o.unitMass; delete o.weight; delete o.weightF; return o; });
}

function regenerate(ctx, bi) {
    store.set(`${tPath(ctx, bi)}.rows`, stripRows(buildSchedule(store.project, store.project.culverts[ctx.ci], bi)));
}

export default {
    scope: 'culvert',
    perBlock: false,
    hint: '철근상세별 마다 표현되는 철근제원에 대한 수치를 설정합니다.',

    tabs(ctx) { return ctx.blocks.map(b => ({ id: 'b' + b.index, title: `BLOCK ${b.index + 1}` })); },

    render(el, ctx, tab) {
        const bi = biOf(ctx, tab);
        const tp = ensureTable(ctx, bi);
        const all = store.get(`${tp}.rows`) || [];
        const mode = getSettings(ctx.c, bi).roundLen;
        const idx = all.map((r, i) => i).filter(i => all[i].cat === ui.cat);
        let prev = null;
        const rows = idx.map(i => {
            const rp = `${tp}.rows.${i}`;
            const r = all[i];
            const cr = computeRow(ctx.p, r, mode);
            const user = !!r.user;
            const first = r.desc !== prev;
            prev = r.desc;
            const d = (k) => num(`${rp}.dims.${k}`, { dec: 0, hint: `${k}: 상세 ${r.shape} (${(SHAPES[r.shape] || SHAPES[1]).name}) 치수` });
            const v = (k) => num(`${rp}.vars.${k}`, { dec: 0, hint: `${k}: 변화하는 철근의 ${k.toUpperCase()} 다른 끝 값 (길이는 평균으로 계산)` });
            return {
                head: [{ t: '' }],
                cells: [
                    txt(`${rp}.desc`, { cls: first ? '' : 'sub-desc', hint: '구분 (도면에 표현되지 않음)' }),
                    chk(`${rp}.lock`, { hint: '잠금: 기본값/전체기본값 실행 시 이 철근을 다시 계산하지 않습니다.' }),
                    user ? txt(`${rp}.mark`, { hint: '철근 기호' }) : lbl(r.mark, { cls: 'ro' }),
                    user ? sel(`${rp}.dia`, DIAS, { hint: '직경' }) : lbl(r.dia, { cls: 'ro' }),
                    d('A'), d('B'), d('C'), d('D'), d('E'), d('R'),
                    num(`${rp}.lap`, { dec: 0, hint: '이음: 철근을 이을 때의 이음장' }), num(`${rp}.lapN`, { dec: 0, hint: '이음수' }),
                    sel(`${rp}.shape`, SHAPE_OPT, { hint: `상세: ${SHAPE_NOS.map(n => `${n} ${SHAPES[n].name}`).join(', ')}` }),
                    num(`${rp}.count`, { dec: 0, hint: '개수' }), num(`${rp}.factor`, { dec: 2, hint: '할증 (1.03 = 3%)' }),
                    v('a'), v('b'), v('c'), v('d'),
                    chk(`${rp}.main`, { hint: '주철근 여부 (철근 종류별 할증률 적용 시 사용)' }),
                    lbl(Math.round(cr.length), { cls: 'ro', hint: '철근 1개 길이 (이음 포함, mm)' }),
                    lbl(cr.weight.toFixed(1), { cls: 'ro', hint: '중량 (kg, 할증 제외)' }),
                ],
                _i: i,
            };
        });
        const head = [[{ t: '' }, ...['구분', '잠금', '기호', '직경', 'A', 'B', 'C', 'D', 'E', 'R', '이음', '이음수', '상세', '개수', '할증', 'a', 'b', 'c', 'd', '주철근', '길이', '중량(kg)'].map(t => ({ t }))]];
        new Grid(el, {
            id: `rt-${bi}-${ui.cat}`, head, rows,
            colWidths: [14, 190, 34, 50, 46, 52, 46, 46, 46, 46, 40, 46, 40, 40, 46, 46, 40, 40, 40, 40, 46, 56, 64],
            onSelect: (cell, r) => { const i = rows[r] && rows[r]._i; if (i !== ui.sel) { ui.sel = i; ctx.redraw(); } },
        });
        // 합계 (현재 블록)
        const comp = all.map(r => computeRow(ctx.p, r, mode));
        const by = {};
        for (const r of comp) { const k = normDia(r.dia); if (!k) continue; by[k] = (by[k] || 0) + r.weight; }
        const catW = comp.filter(r => r.cat === ui.cat).reduce((a, r) => a + r.weight, 0);
        const tot = comp.reduce((a, r) => a + r.weight, 0), totF = comp.reduce((a, r) => a + r.weightF, 0);
        el.appendChild(h('div', { class: 'note' }, [
            `* ${ui.cat} ${idx.length}종 ${fmtLen(Math.round(catW))} kg.  BLOCK ${bi + 1} 합계 ${fmtLen(Math.round(tot))} kg (할증 포함 ${fmtLen(Math.round(totF))} kg): `,
            DIAS.filter(k => by[k]).map(k => `${k} ${fmtLen(Math.round(by[k]))}`).join(', '),
        ]));
    },

    footer(el, ctx, tab) {
        const bi = biOf(ctx, tab);
        const grp = h('span', { class: 'radio-group', style: { display: 'inline-flex', gap: '2px' } });
        for (const c of CATS) {
            const on = c === ui.cat;
            grp.appendChild(h('button', {
                class: 'btn', style: on ? { background: '#f7b25c', borderColor: '#d98a2b', fontWeight: 'bold' } : {},
                onclick: () => { ui.cat = c; ui.sel = null; ctx.rerender(); },
            }, c));
        }
        el.appendChild(grp);
        el.appendChild(button('전체 기본값', () => store.transact(() => { for (const b of ctx.blocks) { ensureTable(ctx, b.index); regenerate(ctx, b.index); } }), { title: '모든 블록·모든 분류를 배근입력값으로 다시 생성 (잠금 행 보존)' }));
        el.appendChild(button('할증율설정(R)', () => wastePopup(ctx)));
        el.appendChild(button('철근추가', () => {
            const tp = ensureTable(ctx, bi);
            const rows = clone(store.get(`${tp}.rows`) || []);
            const ws = getWaste(ctx.c);
            const at = ui.sel != null && rows[ui.sel] && rows[ui.sel].cat === ui.cat ? ui.sel + 1 : (() => { let k = rows.length; rows.forEach((r, i) => { if (r.cat === ui.cat) k = i + 1; }); return k; })();
            const nr = blankRow(ui.cat, ws);
            const n = rows.filter(r => r.user).length + 1;
            nr.mark = `X${n}`;
            rows.splice(at, 0, nr);
            store.set(`${tp}.rows`, rows);
            ui.sel = at;
        }, { title: '선택한 철근 아래에 철근을 추가합니다 (잠금 상태로 추가).' }));
        el.appendChild(button('철근제거', () => {
            const tp = ensureTable(ctx, bi);
            const rows = clone(store.get(`${tp}.rows`) || []);
            if (ui.sel == null || !rows[ui.sel]) return;
            rows.splice(ui.sel, 1);
            store.set(`${tp}.rows`, rows);
            ui.sel = null;
        }, { title: '선택한 철근을 삭제합니다. (기본값을 실행하면 잠금이 아닌 철근은 다시 생성됩니다)' }));
    },

    defaults(ctx, tab) {
        const bi = biOf(ctx, tab);
        ensureTable(ctx, bi);
        regenerate(ctx, bi);
    },

    draw(ctx, tab) {
        const bi = biOf(ctx, tab);
        const tp = ensureTable(ctx, bi);
        const rows = store.get(`${tp}.rows`) || [];
        const d = new Drawing({ textHeight: sectionTextHeight(ctx.c, bi) });
        const th = d.textHeight;
        drawSection(d, ctx.c, bi, { simple: true });
        const lay = mainBarLayout(ctx.p, ctx.c, bi, { cycles: [1], layers: [1] });
        const r = ui.sel != null ? rows[ui.sel] : null;
        const base = r ? String(r.mark).replace(/-\d+$/, '') : null;
        drawBars(d, lay, lay.bars, { colorOf: (b) => (base && b.mark === base ? COLOR.YELLOW : OTHER_COLOR), lapOffset: 0 });
        if (r) {
            const g = lay.g;
            const cr = computeRow(ctx.p, r, getSettings(ctx.c, bi).roundLen);
            drawBarShape(d, cr, { x: 0, y: g.Htot + th * 6, w: Math.max(3000, g.W * 0.45), th });
            d.text(0, g.Htot + th * 4, `${r.cat} / ${r.desc}`, { color: COLOR.GREEN, h: th * 0.7, align: 'left', layer: 'TEXT' });
        } else {
            d.text(lay.g.W / 2, lay.g.Htot + th * 3, '철근을 선택하면 철근상세가 표시됩니다.', { color: COLOR.GREEN, h: th * 0.8, layer: 'TEXT' });
        }
        d.legend = '철근 제원';
        return d;
    },
    viewKey: (ctx, tab) => `rebarTable|${ctx.ci}|${tab}|${ui.sel}`,
};

function wastePopup(ctx) {
    const wp = `${ctx.cp}.rebar.waste`;
    if (!store.get(wp)) store.set(wp, defaultWaste(), { record: false, silent: true });
    const snap = clone(store.get(wp));
    const body = h('div', { style: { minWidth: '380px' } });
    const paint = () => {
        body.innerHTML = '';
        const ws = getWaste(store.get(`culverts.${ctx.ci}`));
        body.appendChild(h('div', { style: { margin: '4px 0 8px' } }, [bRadio(`${wp}.mode`, [{ value: 'dia', label: '직경별 설정' }, { value: 'kind', label: '철근 종류별 설정' }], { onChange: (v) => { store.set(`${wp}.mode`, v); paint(); } })]));
        if (ws.mode === 'kind') {
            body.appendChild(h('div', { style: { margin: '6px' } }, ['주철근에 대하여 ', bNumber(`${wp}.main`, { width: 40, onChange: (v) => { store.set(`${wp}.main`, v); paint(); } }), ' % 할증률 적용']));
            body.appendChild(h('div', { style: { margin: '6px' } }, ['기타철근에 대하여 ', bNumber(`${wp}.other`, { width: 40, onChange: (v) => { store.set(`${wp}.other`, v); paint(); } }), ' % 할증률 적용']));
        } else {
            const i = DIAS.indexOf(normDia(ws.diaLimit));
            const next = DIAS[Math.min(DIAS.length - 1, i + 1)];
            body.appendChild(h('div', { style: { margin: '6px' } }, [bSelect(`${wp}.diaLimit`, DIAS.slice(0, -1), { onChange: (v) => { store.set(`${wp}.diaLimit`, v); paint(); } }), ' 이하 철근에 대하여 ', bNumber(`${wp}.lo`, { width: 40, onChange: (v) => { store.set(`${wp}.lo`, v); paint(); } }), ' % 할증률 적용']));
            body.appendChild(h('div', { style: { margin: '6px' } }, [h('select', { disabled: true }, [h('option', {}, next)]), ' 이상 철근에 대하여 ', bNumber(`${wp}.hi`, { width: 40, onChange: (v) => { store.set(`${wp}.hi`, v); paint(); } }), ' % 할증률 적용']));
        }
        body.appendChild(h('div', { class: 'note' }, '* [확인] 시 모든 블록의 잠금이 아닌 철근에 할증률을 다시 적용합니다.'));
    };
    paint();
    modal({
        title: '철근 할증율 설정', body,
        buttons: [
            {
                text: '확인', primary: true, onClick: () => {
                    const c = store.project.culverts[ctx.ci];
                    const ws = getWaste(c);
                    store.transact(() => {
                        for (const b of ctx.blocks) {
                            const tp = tPath(ctx, b.index);
                            const rows = store.get(`${tp}.rows`);
                            if (!rows) continue;
                            store.set(`${tp}.rows`, rows.map(r => (r.lock ? r : { ...r, factor: wasteFactor(ws, r.dia, !!r.main) })));
                        }
                    });
                },
            },
            { text: '취소', onClick: () => store.set(wp, snap) },
        ],
    });
}
