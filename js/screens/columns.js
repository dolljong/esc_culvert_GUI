// 일반 입력 > 기둥 배치 (매뉴얼 2.6)
// 단면제원의 중간벽체가 원형기둥/사각기둥인 경우 블록별 기둥 개수·간격(CTC)·두께를 입력한다.
// 데이터 culverts[i].columns = { sameT, showAll, blocks: [{ walls: [{ n, ctc:[], t:[] }] }] }
//   ctc[0] = 블록 시점에서 첫 기둥 중심까지, ctc[k] = 기둥 중심간 거리 (mm)
//   t[k]   = 기둥의 종방향(암거 길이방향) 두께 (mm)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { lbl, dash, custom } from '../ui/cells.js';
import { h, bCheck } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { blocks } from '../core/model.js';
import { sectionGeom } from '../calc/sectionGeom.js';

const isCol = (t) => t === '사각기둥' || t === '원형기둥';
const MAXN = 30;

/** 블록의 중간벽체 (하층) */
function midWalls(c, bi) {
    return sectionGeom(c, bi).walls.filter(w => w.kind === 'mid' && w.floor !== 2);
}

/** 블록 평면 길이 (mm, 신축이음 폭 제외) */
export function blockPlanLength(c, bi) {
    const bl = blocks(c);
    const b = bl[bi];
    if (!b) return 0;
    const j = c.joints || [];
    const g0 = bi > 0 ? (+(j[bi] || {}).gap || 0) / 2 : 0;
    const g1 = bi < bl.length - 1 ? (+(j[bi + 1] || {}).gap || 0) / 2 : 0;
    return b.length * 1000 - g0 - g1;
}

export function layoutColumns(Lb, n, S = 1800, t = 600) {
    n = Math.max(1, n | 0);
    let sp = S;
    let e = (Lb - (n - 1) * sp) / 2;
    if (n > 1 && e < Math.max(t, 500)) {
        sp = Math.floor((Lb - 2 * Math.max(t, 700)) / (n - 1) / 10) * 10;
        e = (Lb - (n - 1) * sp) / 2;
    }
    const ctc = Array.from({ length: n }, (_, k) => (k === 0 ? Math.round(e) : sp));
    return { n, ctc, t: Array.from({ length: n }, () => t) };
}

export function defaultWallColumns(Lb, C) {
    const S = 1800;
    const n = Math.max(1, Math.floor((Lb - 2000) / S + 1e-9) + 1);
    return layoutColumns(Lb, n, S, Math.max(600, C || 0));
}

function defaultBlock(c, bi) {
    const Lb = blockPlanLength(c, bi);
    return { walls: midWalls(c, bi).map(w => defaultWallColumns(Lb, w.t)) };
}

export function defaultColumns(c) {
    return { sameT: false, showAll: false, blocks: blocks(c).map(b => defaultBlock(c, b.index)) };
}

function ensure(ctx) {
    const c = ctx.c;
    const cur = c.columns;
    const out = cur ? clone(cur) : defaultColumns(c);
    if (!Array.isArray(out.blocks)) out.blocks = [];
    const bl = blocks(c);
    out.blocks = bl.map(b => {
        const x = out.blocks[b.index];
        const mw = midWalls(c, b.index);
        const Lb = blockPlanLength(c, b.index);
        const walls = (x && Array.isArray(x.walls) ? x.walls : []).slice(0, mw.length);
        while (walls.length < mw.length) walls.push(defaultWallColumns(Lb, mw[walls.length].t));
        return { walls: walls.map(w => (w && Array.isArray(w.ctc) && w.ctc.length === w.n ? w : defaultWallColumns(Lb, 600))) };
    });
    if (out.sameT == null) out.sameT = false;
    if (out.showAll == null) out.showAll = false;
    if (JSON.stringify(out) !== JSON.stringify(cur)) store.set(`${ctx.cp}.columns`, out, { record: false, silent: true });
    return c.columns;
}

export function hasColumns(c) {
    return blocks(c).some(b => midWalls(c, b.index).some(w => isCol(w.type)));
}

export default {
    scope: 'culvert',
    perBlock: true,
    enabled: (ctx) => !!ctx.c && hasColumns(ctx.c),
    hint: '벽체에서 기둥의 갯수를 선택 합니다.',

    header(el, ctx) {
        ensure(ctx);
        const cp = `${ctx.cp}.columns`;
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [
            bCheck(`${cp}.sameT`, ' 벽체별 동일두께 입력', { onChange: (v) => setSameT(ctx, v) }),
            ' ',
            bCheck(`${cp}.showAll`, ' 전체 블럭 보기'),
        ]));
    },

    render(el, ctx) {
        const cols = ensure(ctx);
        const c = ctx.c, bi = ctx.bi;
        const mw = midWalls(c, bi);
        if (!mw.length) { el.appendChild(h('div', { class: 'note' }, '중간벽체가 없는 단면입니다.')); return; }
        const bp = `${ctx.cp}.columns.blocks.${bi}`;
        const blk = cols.blocks[bi];
        const maxN = Math.max(1, ...mw.map((w, i) => (isCol(w.type) ? blk.walls[i].n : 1)));
        const Lb = blockPlanLength(c, bi);
        const rows = [];
        mw.forEach((w, i) => {
            const wc = blk.walls[i];
            const wp = `${bp}.walls.${i}`;
            if (!isCol(w.type)) {
                rows.push({ head: [{ t: `벽체 ${w.index + 1}`, rs: 2 }], cells: [lbl('연속벽체', { cls: 'ro' }), lbl('CTC', { cls: 'ro' }), ...Array.from({ length: maxN }, () => dash())] });
                rows.push({ cells: [dash(), lbl('두께', { cls: 'ro' }), ...Array.from({ length: maxN }, () => dash())] });
                return;
            }
            const opts = Array.from({ length: MAXN }, (_, k) => ({ value: k + 1, label: `${k + 1} 개` }));
            const nCell = custom('select', () => wc.n, (v) => {
                const n = +v;
                const S = wc.ctc[1] || 1800;
                store.set(wp, layoutColumns(Lb, n, S, wc.t[0] || 600));
            }, { options: opts, hint: '벽체에서 기둥의 갯수를 선택 합니다.' });
            const ctcCells = [], tCells = [];
            for (let k = 0; k < maxN; k++) {
                if (k >= wc.n) { ctcCells.push(dash()); tCells.push(dash()); continue; }
                ctcCells.push(custom('num', () => wc.ctc[k], (v) => store.set(`${wp}.ctc.${k}`, v), {
                    dec: 0, hint: k === 0 ? '블록 시점에서 첫 번째 기둥 중심까지의 거리(mm)를 입력합니다.' : '기둥 중심간 거리(mm)를 입력합니다.',
                    validate: (v) => (v >= 0 ? null : '간격은 0 이상이어야 합니다.'),
                }));
                tCells.push(cols.sameT && k > 0
                    ? lbl(() => wc.t[0], { dec: 0, cls: 'ro' })
                    : custom('num', () => wc.t[k], (v) => setT(ctx, i, k, v), { dec: 0, hint: '기둥의 종방향(암거 길이방향) 두께(mm)를 입력합니다.' }));
            }
            rows.push({ head: [{ t: `벽체 ${w.index + 1}`, rs: 2 }], cells: [nCell, lbl('CTC', { cls: 'ro', align: 'center' }), ...ctcCells] });
            rows.push({ cells: [lbl(w.type, { cls: 'ro' }), lbl('두께', { cls: 'ro', align: 'center' }), ...tCells] });
        });
        new Grid(el, {
            id: 'columns-grid',
            head: [[{ t: '구분' }, { t: '기둥개수' }, { t: '' }, ...Array.from({ length: maxN }, (_, k) => ({ t: String(k + 1) }))]],
            rows,
            colWidths: [70, 80, 50, ...Array.from({ length: maxN }, () => 64)],
        });
        const rest = mw.map((w, i) => (isCol(w.type) ? `벽체 ${w.index + 1}: 종점측 연단 ${fmtLen(Lb - blk.walls[i].ctc.reduce((a, b) => a + b, 0))}` : null)).filter(Boolean);
        el.appendChild(h('div', { class: 'note' }, `BLOCK ${bi + 1} 길이 ${fmtLen(Lb)} mm  —  ${rest.join(',  ')}`));
    },

    defaults(ctx) {
        const cols = clone(ensure(ctx));
        cols.blocks[ctx.bi] = defaultBlock(ctx.c, ctx.bi);
        store.set(`${ctx.cp}.columns`, cols);
    },

    draw(ctx) {
        const cols = ensure(ctx);
        const c = ctx.c;
        const W = sectionGeom(c, ctx.bi).W;
        const list = cols.showAll ? blocks(c).map(b => b.index) : [ctx.bi];
        let Ltot = 0;
        list.forEach(bi => { Ltot += blockPlanLength(c, bi); });
        const d = new Drawing({ textHeight: Math.max(120, Math.min(600, Math.max(Ltot, W) / 50)) });
        let ox = 0;
        const bl = blocks(c);
        list.forEach((bi, k) => {
            if (k > 0) ox += +((c.joints || [])[bi] || {}).gap || 0;
            drawBlockPlan(d, c, bi, cols, ox, { dimsSide: k === 0, dimsRight: k === list.length - 1 });
            ox += blockPlanLength(c, bi);
        });
        void bl;
        d.legend = cols.showAll ? '전체 블럭 기둥 배치' : `BLOCK ${ctx.bi + 1} 기둥 배치`;
        return d;
    },
    viewKey: (ctx) => `columns|${ctx.ci}|${ctx.bi}|${(ctx.c.columns || {}).showAll ? 'all' : ''}`,
};

function setT(ctx, i, k, v) {
    const cols = ctx.c.columns;
    const wp = `${ctx.cp}.columns.blocks.${ctx.bi}.walls.${i}`;
    if (cols.sameT) {
        const wc = cols.blocks[ctx.bi].walls[i];
        store.set(`${wp}.t`, wc.t.map(() => v));
    } else store.set(`${wp}.t.${k}`, v);
}

function setSameT(ctx, on) {
    const cols = clone(ensure(ctx));
    cols.sameT = !!on;
    if (on) cols.blocks.forEach(b => b.walls.forEach(w => { w.t = w.t.map(() => w.t[0]); }));
    store.set(`${ctx.cp}.columns`, cols);
}

/** 블록 평면 (x = 암거 길이방향, y = 횡방향; 좌측벽이 위) */
function drawBlockPlan(d, c, bi, cols, ox, opt) {
    const th = d.textHeight;
    const g = sectionGeom(c, bi);
    const W = g.W;
    const Lb = blockPlanLength(c, bi);
    const j = c.joints || [];
    const cot = (a) => { const r = (+a || 90) * Math.PI / 180; return Math.abs(Math.sin(r)) < 1e-6 ? 0 : Math.cos(r) / Math.sin(r); };
    const k0 = cot((j[bi] || {}).angle), k1 = cot((j[bi + 1] || {}).angle);
    const Y = (sx) => W - sx;                       // 단면 x → 평면 y
    const xs = (y) => ox + (y - W / 2) * k0;          // 시점면 x
    const xe = (y) => ox + Lb + (y - W / 2) * k1;     // 종점면 x
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.pline([[xs(0), 0], [xe(0), 0], [xe(W), W], [xs(W), W]], { ...cy, closed: true });
    // 벽면 (파선)
    for (const w of g.walls) {
        if (w.floor === 2) continue;
        const faces = w.kind === 'outer' ? [w.side === 'L' ? w.x1 : w.x0] : [w.x0, w.x1];
        if (w.kind === 'mid' && isCol(w.type)) continue;
        for (const fx of faces) d.line(xs(Y(fx)), Y(fx), xe(Y(fx)), Y(fx), { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    }
    // 기둥
    const blk = (cols.blocks || [])[bi] || { walls: [] };
    const mw = g.walls.filter(w => w.kind === 'mid' && w.floor !== 2);
    mw.forEach((w, i) => {
        if (!isCol(w.type)) return;
        const wc = blk.walls[i];
        if (!wc) return;
        const yc = Y((w.x0 + w.x1) / 2);
        d.line(xs(yc) - th * 1.5, yc, xe(yc) + th * 1.5, yc, { color: COLOR.RED, dash: 'center', layer: 'CENTER' });
        d.text(xs(yc) - th * 1.7, yc, `벽체${w.index + 1}`, { color: COLOR.GREEN, h: th * 0.6, align: 'right', valign: 'middle', layer: 'TEXT' });
        const chain = [xs(yc)];
        let x = xs(yc);
        const names = [];
        wc.ctc.forEach((v, k) => {
            x += +v || 0;
            chain.push(x);
            const t = +wc.t[k] || 0, C = w.t;
            const st = { color: COLOR.CYAN, dash: 'hidden', layer: 'COL' };
            if (w.type === '원형기둥') {
                d.circle(x, yc, C / 2, st);
            } else {
                d.rect(x - t / 2, yc - C / 2, t, C, st);
                d.line(x - t / 2, yc - C / 2, x + t / 2, yc + C / 2, st);
                d.line(x - t / 2, yc + C / 2, x + t / 2, yc - C / 2, st);
            }
            names.push(`B${bi + 1}W${w.index + 1}C${k + 1}`);
        });
        chain.push(xe(yc));
        const yDim = yc + w.t / 2 + th * 2.2;
        for (let k = 0; k < chain.length - 1; k++) {
            d.dimH(chain[k], chain[k + 1], yc + w.t / 2, yDim);
            if (k < names.length) d.text(chain[k + 1], yDim + th * 1.3, names[k], { color: COLOR.GREEN, h: th * 0.55, layer: 'TEXT' });
        }
        d.dimH(chain[0], chain[chain.length - 1], yc + w.t / 2, yDim + th * 2.8);
        // 첫 기둥 지시선
        if (wc.n > 0) {
            const x1 = chain[1];
            const lab = w.type === '원형기둥' ? `원형기둥` : '사각기둥';
            const sz = w.type === '원형기둥' ? `Ø${fmtLen(w.t)}` : `${fmtLen(w.t)}x${fmtLen(+wc.t[0] || 0)}`;
            d.line(x1, yc - w.t / 2, x1 + th * 1.5, yc - w.t / 2 - th * 2, { color: COLOR.RED, layer: 'DIM' });
            d.line(x1 + th * 1.5, yc - w.t / 2 - th * 2, x1 + th * 6, yc - w.t / 2 - th * 2, { color: COLOR.RED, layer: 'DIM' });
            d.text(x1 + th * 1.7, yc - w.t / 2 - th * 1.85, lab, { color: COLOR.GREEN, h: th * 0.6, align: 'left', layer: 'TEXT' });
            d.text(x1 + th * 1.7, yc - w.t / 2 - th * 2.15, sz, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'top', layer: 'TEXT' });
        }
    });
    // 횡방향 치수 (좌·우)
    const ys = [0];
    for (const w of g.walls) { if (w.floor === 2) continue; ys.push(Y(w.x0), Y(w.x1)); }
    ys.push(W);
    const yy = [...new Set(ys.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
    if (opt.dimsSide) {
        const xl = Math.min(xs(0), xs(W)) - th * 3;
        d.dimChainV(yy, Math.min(xs(0), xs(W)), xl);
        d.dimV(0, W, Math.min(xs(0), xs(W)), xl - th * 2.6);
    }
    if (opt.dimsRight) {
        const xr = Math.max(xe(0), xe(W)) + th * 3;
        d.dimChainV(yy, Math.max(xe(0), xe(W)), xr);
        d.dimV(0, W, Math.max(xe(0), xe(W)), xr + th * 2.6);
    }
    // 블록 길이 (하단, 직각측)
    d.dimH(xs(0), xe(0), 0, -th * 3, fmtLen(Lb));
    d.text((xs(0) + xe(0)) / 2, -th * 3.3, `(BLOCK${bi + 1})`, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'DIM' });
}
