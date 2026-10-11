// 배근 입력 > 차도부 철근 (매뉴얼 5.5)
// [횡단 제원]에서 차도부를 설치한 경우에만 활성. 탭: 차도부 | 중분대 | 측구 (해당 항목이 있을 때)
// 데이터: culverts[i].rebar.road = {
//   plain (차도부 무근 처리), zone ('straight'|'start'),
//   rows: { c1l1, c1l2, c2l1, c2l2 : { use, L:{ n, R:[], D:[] }, R:{ n, R:[], D:[] } } },
//   median: { dia, c1, c2, hDia, C1, B, C, E, F },   gutter: { dia, c1, c2 } }

import store from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, bCheck } from '../ui/dom.js';
import { sectionKind, sectionOf } from '../core/model.js';
import { sectionDrawing } from '../draw/sectionDraw.js';
import { DIAS, getSettings, zonesOf } from '../calc/rebar.js';
import { ensure } from './rebarSet.js';

/** 횡단 제원에서 차도부/중분대/측구 설치 여부 (cross 데이터 형식이 바뀌어도 견디도록 넓게 판정) */
export function roadInfo(c) {
    const cr = (c && c.cross) || {};
    const cells = Array.isArray(cr.cells) ? cr.cells.filter(Boolean) : [];
    const segKinds = cells.filter(x => x.use !== false).flatMap(x => (Array.isArray(x.segs) ? x.segs.map(s => s && s.kind) : []));
    const road = !!(cr.all || cr.allRoad || (cr.road && cr.road.use) || cells.some(x => x.use === true || x.road));
    let median = false;
    try {
        const nb = Math.max(1, (c.joints || []).length - 1);
        for (let bi = 0; bi < nb; bi++) {
            if (sectionKind(c, bi) === 'U') { const s = sectionOf(c, bi); if (s && s.median && s.median.use && (s.B || [])[1] > 0) median = true; }
        }
    } catch { /* 무시 */ }
    median = median || !!(cr.median && cr.median.use) || cells.some(x => x.median);
    const gutter = !!((cr.gutter && cr.gutter.use) || (Array.isArray(cr.gutters) && cr.gutters.length) || cells.some(x => x.gutter)
        || (road && segKinds.some(k => k === '측구' || k === '측구2')));
    return { road, median, gutter };
}

const ROWS = [['c1l1', '1Cycle', '1단'], ['c1l2', '1Cycle', '2단'], ['c2l1', '2Cycle', '1단'], ['c2l2', '2Cycle', '2단']];

function defaultRoad() {
    const side = () => ({ n: 0, R: ['D19'], D: [] });
    const rows = {};
    for (const [k, , l] of ROWS) rows[k] = { use: l === '1단', L: side(), R: side() };
    return {
        plain: false, zone: 'straight', rows,
        median: { dia: 'D19', c1: true, c2: false, hDia: 'D19', C1: 270, B: 1, C: 300, E: 2, F: 300 },
        gutter: { dia: 'D19', c1: true, c2: true },
    };
}

export default {
    scope: 'culvert',
    enabled: (ctx) => !ctx.c || roadInfo(ctx.c).road,
    hint: '차도부(포장 콘크리트) 철근의 배치여부, 열별 직경, 이음개수와 이음간격을 입력합니다.',

    tabs(ctx) {
        const info = roadInfo(ctx.c);
        const t = [{ id: 'road', title: '차도부' }];
        if (info.median) t.push({ id: 'median', title: '중분대' });
        if (info.gutter) t.push({ id: 'gutter', title: '측구' });
        return t;
    },

    header(el, ctx) {
        const rp = ensure(`${ctx.cp}.rebar.road`, defaultRoad);
        const zs = zonesOf(ctx.c, 0).filter(z => z.id !== 'end');
        const name = 'rz' + Math.random().toString(36).slice(2);
        const cur = store.get(`${rp}.zone`) || 'straight';
        const w = h('span', { class: 'radio-group' });
        for (const z of zs) {
            const r = h('input', { type: 'radio', name, value: z.id });
            r.checked = z.id === cur;
            r.disabled = !z.enabled;
            r.addEventListener('change', () => store.set(`${rp}.zone`, z.id));
            w.appendChild(h('label', {}, [r, z.title]));
        }
        el.appendChild(w);
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [bCheck(`${rp}.plain`, ' 차도부 무근 처리', { title: '차도부를 무근 콘크리트로 처리 (철근 없음)' })]));
    },

    render(el, ctx, tab) {
        const rp = ensure(`${ctx.cp}.rebar.road`, defaultRoad);
        const r = store.get(rp);
        if (tab === 'median') {
            const m = `${rp}.median`;
            new Grid(el, {
                id: 'road-median',
                head: [[{ t: '수직철근', cs: 3 }, { t: '수평철근', cs: 6 }], [{ t: '직경' }, { t: '1Cycle' }, { t: '2Cycle' }, { t: '직경' }, { t: 'C1' }, { t: 'B' }, { t: 'C' }, { t: 'E' }, { t: 'F' }]],
                rows: [{
                    cells: [
                        sel(`${m}.dia`, DIAS, { hint: '중분대 수직철근 직경' }), chk(`${m}.c1`, { hint: '1Cycle 배치' }), chk(`${m}.c2`, { hint: '2Cycle 배치' }),
                        sel(`${m}.hDia`, DIAS, { hint: '중분대 수평철근 직경' }),
                        num(`${m}.C1`, { dec: 0, hint: '수평부 간격식 C1 + B@C 의 C1 (mm)' }), num(`${m}.B`, { dec: 0, hint: '수평부 B@C 의 개수 B' }), num(`${m}.C`, { dec: 0, hint: '수평부 B@C 의 간격 C (mm)' }),
                        num(`${m}.E`, { dec: 0, hint: '수직부 E@F 의 개수 E' }), num(`${m}.F`, { dec: 0, hint: '수직부 E@F 의 간격 F (mm)' }),
                    ],
                }],
                colWidths: [70, 55, 55, 70, 60, 50, 60, 50, 60],
            });
            return;
        }
        if (tab === 'gutter') {
            const gp = `${rp}.gutter`;
            new Grid(el, {
                id: 'road-gutter', head: [[{ t: '직경' }, { t: '1Cycle' }, { t: '2Cycle' }]],
                rows: [{ cells: [sel(`${gp}.dia`, DIAS, { hint: '측구 철근 직경' }), chk(`${gp}.c1`), chk(`${gp}.c2`)] }],
                colWidths: [70, 60, 60],
            });
            return;
        }
        // 차도부
        const two = getSettings(ctx.c, ctx.bi).cycle !== '1Cycle';
        const nMax = { L: 0, R: 0 };
        for (const [k] of ROWS) for (const s of ['L', 'R']) nMax[s] = Math.max(nMax[s], ((r.rows[k] || {})[s] || {}).n | 0);
        const sideHead = (s) => {
            const a = [{ t: 'R1' }, { t: '이음개수' }];
            for (let i = 1; i <= nMax[s]; i++) a.push({ t: `D${i}` }, { t: `R${i + 1}` });
            return a;
        };
        const sideCells = (k, s, off) => {
            const base = `${rp}.rows.${k}.${s}`;
            const v = store.get(base) || { n: 0, R: ['D19'], D: [] };
            const cells = [
                off ? lbl(v.R[0], { cls: 'ro', align: 'center' }) : sel(`${base}.R.0`, DIAS, { hint: '첫 열(R1)의 철근직경' }),
                off ? lbl(v.n | 0, { cls: 'ro', align: 'center' }) : custom('num', () => v.n | 0, (n) => {
                    n = Math.max(0, Math.min(10, n | 0));
                    const R = (v.R || []).slice(0, n + 1), D = (v.D || []).slice(0, n);
                    while (R.length < n + 1) R.push(R[R.length - 1] || 'D19');
                    while (D.length < n) D.push(3000);
                    store.set(base, { n, R, D });
                }, { dec: 0, hint: '열마다의 이음개수' }),
            ];
            for (let i = 0; i < nMax[s]; i++) {
                if (i >= (v.n | 0) || off) { cells.push(dash(), dash()); continue; }
                cells.push(num(`${base}.D.${i}`, { dec: 0, hint: `D${i + 1}: 이음사이의 거리 (mm)` }), sel(`${base}.R.${i + 1}`, DIAS, { hint: `R${i + 1}: 철근직경` }));
            }
            return cells;
        };
        const rows = ROWS.map(([k, cy, l], i) => {
            const row = r.rows[k] || {};
            const parentOff = l === '2단' && !(r.rows[k.slice(0, 2) + 'l1'] || {}).use;
            const cycOff = cy === '2Cycle' && !two;
            const disabled = parentOff || cycOff || r.plain;
            const off = disabled || !row.use;
            return {
                head: i % 2 === 0 ? [{ t: cy, rs: 2 }, { t: l }] : [{ t: l }],
                cells: [chk(`${rp}.rows.${k}.use`, { disabled, hint: '해당 Cycle·단의 차도부 철근 배치' }), ...sideCells(k, 'L', off), ...sideCells(k, 'R', off)],
            };
        });
        new Grid(el, {
            id: 'road-main',
            head: [
                [{ t: '구분', cs: 2, rs: 2 }, { t: '배치', rs: 2 }, { t: '좌측', cs: 2 + nMax.L * 2 }, { t: '우측', cs: 2 + nMax.R * 2 }],
                [...sideHead('L'), ...sideHead('R')],
            ],
            rows,
        });
        el.appendChild(h('div', { class: 'note' }, '* R1,2… = 열별 철근직경, 이음개수 = 열마다의 이음수, D1,2… = 이음사이 거리 (mm).' + (r.plain ? ' [차도부 무근 처리] 중: 철근을 배치하지 않습니다.' : '')));
    },

    defaults(ctx, tab) {
        const rp = `${ctx.cp}.rebar.road`;
        const d = defaultRoad();
        if (tab === 'median') store.set(`${rp}.median`, d.median);
        else if (tab === 'gutter') store.set(`${rp}.gutter`, d.gutter);
        else { store.set(`${rp}.rows`, d.rows); store.set(`${rp}.plain`, false); }
    },

    draw(ctx) {
        const d = sectionDrawing(ctx.p, ctx.c, ctx.bi, { sta: ctx.c.startSta, names: false });
        d.legend = '차도부 철근';
        return d;
    },
    viewKey: (ctx) => `roadRebar|${ctx.ci}`,
};
