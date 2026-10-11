// 일반 입력 > 횡단 제원 (매뉴얼 2.5)
// 각 련(셀) 내부의 차도부와 측구. 데이터 culverts[i].cross (calc/crossGeom.js)
//  · 마지막 구간 간격 = B − Σ(나머지) (계산값)
//  · 구배(%)는 차도에서만, 측구높이는 측구에서만 입력
//  · 차도부 설치를 체크하지 않으면 전체 읽기전용

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, lbl, dash, custom } from '../ui/cells.js';
import { h, box, button, bNumber, bCheck, alertBox } from '../ui/dom.js';
import { COLOR } from '../cad/drawing.js';
import { sectionOf } from '../core/model.js';
import { sectionDrawing } from '../draw/sectionDraw.js';
import { crossKinds, crossCells, normalizeCross, defaultCross, defaultCrossCell, segLengths, crossShapes } from '../calc/crossGeom.js';

let selCol = 0;

const bi0 = (ctx) => (ctx.c.type === '지하차도' ? ctx.bi : 0);

function ensure(ctx) {
    const c = ctx.c;
    const n = normalizeCross(c, c.cross, bi0(ctx));
    if (JSON.stringify(n) !== JSON.stringify(c.cross)) store.set(`${ctx.cp}.cross`, n, { record: false, silent: true });
    return c.cross;
}

const isDitch = (k) => k === '측구' || k === '측구2';

export default {
    scope: 'culvert',
    perBlock: (ctx) => ctx.c.type === '지하차도',
    hint: '간격 데이터를 입력합니다.',

    header(el, ctx) {
        const cr = ensure(ctx);
        const { cells } = crossCells(ctx.c, bi0(ctx));
        const cp = `${ctx.cp}.cross`;
        const s = h('select', { disabled: cells.length < 2 });
        cells.forEach((_, i) => {
            const o = h('option', { value: i }, `${i + 1} 련`);
            if (i === cr.cur) o.selected = true;
            s.appendChild(o);
        });
        const go = (i) => { if (i >= 0 && i < cells.length) store.set(`${cp}.cur`, i, { record: false }); };
        s.addEventListener('change', () => go(+s.value));
        el.appendChild(h('span', { class: 'sel-group' }, [
            s,
            h('button', { class: 'nav-btn', disabled: cells.length < 2, onclick: () => go(cr.cur - 1) }, '◀'),
            h('button', { class: 'nav-btn', disabled: cells.length < 2, onclick: () => go(cr.cur + 1) }, '▶'),
        ]));
        el.appendChild(bCheck(`${cp}.all`, ' 차도부 전체설치', { title: '모든 련에 차도부를 설치합니다.' }));
        el.appendChild(bCheck(`${cp}.cells.${cr.cur}.use`, ' 차도부 설치', { disabled: cr.all, title: '현재 련에 차도부를 설치합니다.' }));
    },

    render(el, ctx) {
        const cr = ensure(ctx);
        const c = ctx.c;
        const { cells } = crossCells(c, bi0(ctx));
        const k = cr.cur;
        const cc = cells[k];
        const cell = cr.cells[k];
        const cp = `${ctx.cp}.cross.cells.${k}`;
        const use = !!(cr.all || cell.use);
        const lens = segLengths(cell, cc.B);
        const n = cell.segs.length;
        const kinds = crossKinds(c);
        const ro = (v, dec) => lbl(v, { cls: 'ro', dec });
        const rowLen = cell.segs.map((sg, i) => (!use || i === n - 1)
            ? ro(() => lens[i], 0)
            : num(`${cp}.segs.${i}.len`, { dec: 0, hint: '간격 데이터를 입력합니다.', validate: (v) => (v >= 0 ? null : '간격은 0 이상이어야 합니다.') }));
        const rowKind = cell.segs.map((sg, i) => (use
            ? custom('select', () => sg.kind, (v) => setKind(ctx, k, i, v), { options: kinds, hint: '구간의 종류를 선택합니다. (없음, 차도, 방호벽, 측구)' })
            : ro(sg.kind)));
        const rowSlope = cell.segs.map((sg, i) => (use && sg.kind === '차도'
            ? num(`${cp}.segs.${i}.slope`, { dec: 3, hint: '차도부의 횡단구배(%)를 입력합니다.' })
            : ro(+sg.slope || 0, 3)));
        const rowDepth = cell.segs.map((sg, i) => (use && isDitch(sg.kind)
            ? num(`${cp}.segs.${i}.depth`, { dec: 0, hint: '측구높이: 하부슬래브 상면에서 아래 방향으로의 깊이(mm)' })
            : ro(+sg.depth || 0, 0)));
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        new Grid(left, {
            id: 'cross-grid',
            head: [[{ t: '구분' }, ...cell.segs.map((_, i) => ({ t: `L${i + 1}` }))]],
            rows: [
                { head: [{ t: '간격(mm)' }], cells: rowLen },
                { head: [{ t: '종류' }], cells: rowKind },
                { head: [{ t: '구배(%)' }], cells: rowSlope },
                { head: [{ t: '측구높이(mm)' }], cells: rowDepth },
            ],
            colWidths: [100, ...cell.segs.map(() => 80)],
            onSelect: (_, r, col) => { selCol = col; },
        });
        left.appendChild(h('div', { class: 'note' }, `${k + 1} 련 내공폭 B = ${Math.round(cc.B)} mm — 마지막 구간 L${n} = B − Σ(L1~L${n - 1})`));
        wrap.appendChild(left);
        const edgeDitch = isDitch(cell.segs[0].kind) || isDitch(cell.segs[n - 1].kind);
        const detailOn = use && c.type === '지하차도' && cell.segs.some(sg => sg.kind === '측구2');
        wrap.appendChild(h('div', { class: 'dlg-col' }, [
            box(null, [
                h('div', { class: 'opt' }, [bNumber(`${cp}.minT`, { label: '차도부 최소 두께', unit: 'mm', dec: 1, width: 60, disabled: !use })]),
                h('div', { class: 'opt' }, [bNumber(`${cp}.pave`, { label: '포장 두께', unit: 'mm', dec: 1, width: 60, disabled: !use })]),
                h('div', { class: 'opt' }, [bCheck(`${cp}.linkHaunch`, ' 하부헌치를 측구와 연결', { disabled: !use || !edgeDitch, title: '하부헌치의 경사를 측구 바닥까지 연장합니다.' })]),
            ]),
            box('차도부 상세설정', [
                h('div', { class: 'opt' }, [bNumber(`${cp}.detail.B1`, { label: 'B1', dec: 0, width: 50, disabled: !detailOn })]),
                h('div', { class: 'opt' }, [bNumber(`${cp}.detail.b`, { label: 'b', dec: 0, width: 50, disabled: !detailOn }), ' ', bNumber(`${cp}.detail.h`, { label: 'h', dec: 0, width: 50, disabled: !detailOn })]),
            ]),
        ]));
        el.appendChild(wrap);
    },

    footer(el, ctx) {
        el.appendChild(button('구간추가', () => addSeg(ctx)));
        el.appendChild(button('구간삭제', () => delSeg(ctx)));
    },

    defaults(ctx) {
        const cr = ensure(ctx);
        const d = defaultCross(ctx.c, bi0(ctx));
        d.cur = cr.cur;
        store.set(`${ctx.cp}.cross`, d);
    },

    draw(ctx) {
        const cr = ensure(ctx);
        const c = ctx.c;
        const bi = bi0(ctx);
        const sec = sectionOf(c, bi);
        return sectionDrawing(ctx.p, c, bi, {
            names: false,
            cross: (d, g, ox, oy) => {
                const cells = g.cells.filter(cc => cc.floor !== 2);
                cells.forEach((cc, i) => {
                    const cell = cr.cells[i];
                    if (!cell || !(cr.all || cell.use)) return;
                    const T = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
                    const sh = crossShapes(g, cc, cell, sec);
                    // 하부슬래브 상면 (초록 파선)
                    d.line(cc.x0 + ox, cc.y0 + oy, cc.x1 + ox, cc.y0 + oy, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
                    for (const p of sh.road) {
                        d.hatch(T(p), { color: COLOR.GRAY, pattern: 'dots', alpha: 0.25, layer: 'ROAD' });
                        d.pline(T(p.slice(2)), { color: COLOR.CYAN, layer: 'ROAD', width: 2 });
                        d.line(...T([p[0]])[0], ...T([p[p.length - 1]])[0], { color: COLOR.CYAN, layer: 'ROAD' });
                        d.line(...T([p[1]])[0], ...T([p[2]])[0], { color: COLOR.CYAN, layer: 'ROAD' });
                    }
                    for (const p of sh.barriers) d.pline(T(p), { color: COLOR.CYAN, closed: true, layer: 'ROAD' });
                    for (const p of sh.ditches) d.pline(T(p), { color: COLOR.CYAN, layer: 'ROAD' });
                    for (const p of sh.pave) d.pline(T(p), { color: COLOR.YELLOW, dash: 'hidden', layer: 'ROAD' });
                    for (const p of sh.links) d.pline(T(p), { color: COLOR.CYAN, layer: 'ROAD' });
                });
            },
        });
    },
    viewKey: (ctx) => `cross|${ctx.ci}|${bi0(ctx)}`,
};

function setKind(ctx, k, i, v) {
    const cr = clone(ensure(ctx));
    const sg = cr.cells[k].segs[i];
    sg.kind = v;
    if (v === '차도' && !(+sg.slope)) sg.slope = 2.0;
    if (v !== '차도') sg.slope = 0;
    if (isDitch(v) && !(+sg.depth)) sg.depth = 200;
    if (!isDitch(v)) sg.depth = 0;
    store.set(`${ctx.cp}.cross`, cr);
}

function addSeg(ctx) {
    const cr = clone(ensure(ctx));
    const { cells } = crossCells(ctx.c, bi0(ctx));
    const k = cr.cur;
    const cell = cr.cells[k];
    if (!(cr.all || cell.use)) { alertBox('[차도부 설치]를 먼저 체크하십시오.'); return; }
    const lens = segLengths(cell, cells[k].B);
    const i = Math.max(0, Math.min(selCol, cell.segs.length - 1));
    const half = Math.round(lens[i] / 2);
    cell.segs.forEach((s, j) => { s.len = lens[j]; });
    cell.segs[i].len = lens[i] - half;
    cell.segs.splice(i + 1, 0, { len: half, kind: '없음', slope: 0, depth: 0 });
    store.set(`${ctx.cp}.cross`, cr);
}

function delSeg(ctx) {
    const cr = clone(ensure(ctx));
    const { cells } = crossCells(ctx.c, bi0(ctx));
    const k = cr.cur;
    const cell = cr.cells[k];
    if (cell.segs.length <= 1) { alertBox('구간은 최소 1개가 있어야 합니다.'); return; }
    const lens = segLengths(cell, cells[k].B);
    const i = Math.max(0, Math.min(selCol, cell.segs.length - 1));
    cell.segs.forEach((s, j) => { s.len = lens[j]; });
    const nb = i > 0 ? i - 1 : 1;
    cell.segs[nb].len += lens[i];
    cell.segs.splice(i, 1);
    if (!cell.segs.length) cell.segs = defaultCrossCell(cells[k].B).segs;
    store.set(`${ctx.cp}.cross`, cr);
    selCol = Math.max(0, i - 1);
}
