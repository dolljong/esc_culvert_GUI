// 배근 입력 > 보, 기둥 철근 (매뉴얼 5.10)
// 중간벽체가 기둥(사각/원형)인 경우: 부재명 기둥 → 탭 주철근 | 크로스타이 | 띠철근,
//                                      상부/하부/중간거더 → 탭 주철근 | 수평철근 | 전단철근.
// 데이터/계산: calc/beamCol.js (culverts[i].rebar.beamCol[bi])

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bNumber, modal } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { DIAS, barD, getRebarCommon, getSettings } from '../calc/rebar.js';
import { blockFrame, planCover } from '../calc/rebarPlan.js';
import {
    hasColumns, columnWalls, girderMembers, getBeamCol, defaultColumn, defaultGirder, columnBars, girderBars, segPositions,
    facePositions, beamColCheck, girderDepth,
} from '../calc/beamCol.js';
import { ensureSettings, ensure } from './rebarSet.js';

const ui = { mem: 'col', wi: null };
const bcPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.beamCol.${bi}`;
const DIA_OPT = ['', ...DIAS];
const NSEG = Array.from({ length: 20 }, (_, i) => i + 1);

function walls(ctx) { return ctx.c ? columnWalls(ctx.c, ctx.bi) : []; }

function cur(ctx) {
    const ws = walls(ctx);
    if (!ws.length) return null;
    let cw = ws.find(w => w.index === ui.wi);
    if (!cw) { cw = ws[0]; ui.wi = cw.index; }
    const mems = girderMembers(cw.g).map(m => m[0]);
    if (!mems.includes(ui.mem)) ui.mem = 'col';
    return cw;
}

/** 현재 벽체·부재 데이터 경로 (없으면 기본값 기록) */
function memPath(ctx) {
    ensureSettings(ctx);
    ensure(bcPath(ctx), () => ({ std: 150, walls: {} }));
    const cw = cur(ctx);
    const p = `${bcPath(ctx)}.walls.${cw.index}.${ui.mem}`;
    if (store.get(p) == null) store.set(p, getBeamCol(ctx.c, ctx.bi, cw.index, ui.mem), { record: false, silent: true });
    return p;
}

function defaultFor(ctx, cw, mem) {
    const std = store.get(`${bcPath(ctx)}.std`) || 150;
    if (mem === 'col') return defaultColumn(cw, std);
    const fr = blockFrame(ctx.c, ctx.bi);
    return defaultGirder(cw, mem, fr.L0 - 2 * planCover(getSettings(ctx.c, ctx.bi)), 200);
}

function segCountCell(path, hint) {
    return custom('select', () => (store.get(path) || []).length, (v) => {
        const segs = clone(store.get(path) || []);
        const n = Math.max(1, Math.min(20, +v | 0));
        const last = segs.length ? segs[segs.length - 1] : { n: 1, s: 150 };
        while (segs.length > n) segs.pop();
        while (segs.length < n) segs.push({ n: 1, s: last.s });
        store.set(path, segs);
    }, { options: NSEG.map(n => ({ value: n, label: `${n}` })), hint });
}

const MEM_TITLE = { col: '기둥', top: '상부거더', bottom: '하부거더', mid: '중간거더' };

export default {
    scope: 'culvert',
    perBlock: true,
    enabled: (ctx) => !ctx.c || hasColumns(ctx.c),
    hint: '기둥과 거더(상부/하부/중간)의 주철근, 띠철근(스터럽), 수평철근 배치를 입력합니다.',

    tabs(ctx) {
        cur(ctx);
        return ui.mem === 'col'
            ? [{ id: 'main', title: '주철근' }, { id: 'tie', title: '크로스타이' }, { id: 'hoop', title: '띠철근' }]
            : [{ id: 'main', title: '주철근' }, { id: 'horz', title: '수평철근' }, { id: 'stir', title: '전단철근' }];
    },

    header(el, ctx) {
        const cw = cur(ctx);
        if (!cw) { el.appendChild(h('span', { class: 'note' }, '이 블록에는 기둥이 없습니다.')); return; }
        memPath(ctx);
        const mems = girderMembers(cw.g);
        const ms = h('select', {});
        for (const [k, t] of mems) { const o = h('option', { value: k }, t); if (k === ui.mem) o.selected = true; ms.appendChild(o); }
        ms.addEventListener('change', () => { ui.mem = ms.value; ctx.rerender(); });
        const navM = (dl) => { const i = mems.findIndex(m => m[0] === ui.mem) + dl; if (i >= 0 && i < mems.length) { ui.mem = mems[i][0]; ctx.rerender(); } };
        el.appendChild(h('label', {}, ['부재명 ', ms]));
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => navM(-1) }, '◀'));
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => navM(1) }, '▶'));
        const ws = walls(ctx);
        const wsel = h('select', {});
        for (const w of ws) { const o = h('option', { value: w.index }, `벽체 ${w.index + 1}`); if (w.index === ui.wi) o.selected = true; wsel.appendChild(o); }
        wsel.addEventListener('change', () => { ui.wi = +wsel.value; ctx.rerender(); });
        const navW = (dl) => { const i = ws.findIndex(w => w.index === ui.wi) + dl; if (i >= 0 && i < ws.length) { ui.wi = ws[i].index; ctx.rerender(); } };
        el.appendChild(wsel);
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => navW(-1) }, '◀'));
        el.appendChild(h('button', { class: 'nav-btn', onclick: () => navW(1) }, '▶'));
        if (ui.mem === 'col') el.appendChild(h('span', { class: 'ro-box', style: { padding: '1px 6px', border: '1px solid #9ab', background: '#fffbe6' } }, cw.round ? `원형 : D = ${cw.b}` : `사각 : ${cw.b} × ${cw.D}`));
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [bNumber(`${bcPath(ctx)}.std`, { label: '표준배치간격', dec: 0, width: 50 })]));
    },

    render(el, ctx, tab) {
        const cw = cur(ctx);
        if (!cw) { el.appendChild(h('div', { class: 'note' }, '현재 블록의 중간벽체가 기둥(사각기둥/원형기둥)이 아닙니다. [일반 입력 > 단면 제원]에서 벽체 형식을 기둥으로 지정하세요.')); return; }
        const p = memPath(ctx);
        const v = store.get(p);
        if (ui.mem === 'col') {
            if (tab === 'tie') {
                const ks = ['C1', 'B', 'C', 'C2', 'F1', 'E', 'F', 'F2'];
                new Grid(el, {
                    id: 'bc-tie', head: [[{ t: '직경' }, ...ks.map(k => ({ t: k }))]],
                    rows: [{ cells: [sel(`${p}.tie.dia`, DIA_OPT, { hint: '크로스타이 직경' }), ...ks.map(k => num(`${p}.tie.${k}`, { dec: 0, disabled: cw.round, field: 'T' + k, hint: k[0] === 'C' || k === 'B' ? 'C1: 주철근에서 크로스타이 위치까지 (B@C 반복)' : 'F1: 주철근에서 크로스타이 위치까지 (E@F 반복)' }))] }],
                    colWidths: [70, ...ks.map(() => 55)],
                });
                if (cw.round) el.appendChild(h('div', { class: 'note' }, '* 원형기둥에는 크로스타이를 두지 않습니다.'));
            } else if (tab === 'hoop') {
                const segs = v.hoop.segs || [];
                new Grid(el, {
                    id: 'bc-hoop',
                    head: [[{ t: '구분' }, { t: '직경' }, { t: '구간수' }, ...segs.map((_, k) => ({ t: `S${k + 1}` }))]],
                    rows: [
                        { head: [{ t: '개수' }], cells: [sel(`${p}.hoop.dia`, DIAS, { hint: '띠철근 직경' }), segCountCell(`${p}.hoop.segs`, '띠철근 배치 구간 수'), ...segs.map((_, k) => num(`${p}.hoop.segs.${k}.n`, { dec: 0, hint: `S${k + 1} 개수` }))] },
                        { head: [{ t: '간격' }], cells: [lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), ...segs.map((_, k) => num(`${p}.hoop.segs.${k}.s`, { dec: 0, field: `S${k + 1}`, hint: `S${k + 1} 간격 (하단 피복 위치부터 위로)` }))] },
                    ],
                    colWidths: [50, 70, 60, ...segs.map(() => 55)],
                });
                const tot = segs.reduce((a, s) => a + (s.n | 0) * (+s.s || 0), 0);
                el.appendChild(h('div', { class: 'note' }, `* 배치 합계 ${tot} mm / 기둥 순높이 ${cw.H} − 피복 160 = ${cw.H - 160} mm, 띠철근 ${segPositions(segs, 80).length}단`));
            } else {
                const rows = [0, 1, 2].map(li => {
                    const lp = `${p}.main.layers.${li}`;
                    const use = li === 0 || !!store.get(`${lp}.use`);
                    const n = (k, hint) => num(`${lp}.${k}`, { dec: 0, disabled: !use, field: li === 0 ? k : undefined, hint });
                    const cells = [li === 0 ? lbl('사용', { cls: 'ro', align: 'center' }) : chk(`${lp}.use`, { hint: `${li + 1}단 철근 사용` }), n('dist', '기둥 외면에서 철근 중심까지 거리'), sel(`${lp}.dia`, DIA_OPT, { disabled: !use, hint: '주철근 직경' })];
                    if (cw.round) cells.push(n('R', '원형단면: 단별 철근 개수'));
                    else for (const k of ['C1', 'B', 'C', 'C2', 'F1', 'E', 'F', 'F2']) cells.push(n(k, k[0] === 'C' || k === 'B' ? '교직방향(단면 폭) 면: 모서리 → C1 → B@C → C2' : '길이방향 면: 모서리 → F1 → E@F → F2'));
                    return { head: [{ t: `${li + 1}단` }], cells };
                });
                const head = [{ t: '구분' }, { t: '' }, { t: '거리' }, { t: '직경' }, ...(cw.round ? [{ t: 'R' }] : ['C1', 'B', 'C', 'C2', 'F1', 'E', 'F', 'F2'].map(t => ({ t })))];
                new Grid(el, { id: `bc-main-${cw.round ? 'r' : 's'}`, head: [head], rows, colWidths: [46, 40, 55, 65, ...(cw.round ? [55] : Array(8).fill(50))] });
                const bars = columnBars(cw, v);
                el.appendChild(h('div', { class: 'note' }, `* 주철근 ${bars.length} EA / 기둥 (기둥 ${cw.n}개, CTC ${fmtLen(cw.ctc)})`));
            }
            return;
        }
        // 거더
        const hgt = girderDepth(cw.g, ui.mem, cw.index);
        if (tab === 'horz') {
            const ks = ['F1', 'E', 'F', 'F2'];
            new Grid(el, {
                id: 'bc-ghorz', head: [[{ t: '직경' }, ...ks.map(k => ({ t: k }))]],
                rows: [{ cells: [sel(`${p}.horz.dia`, DIA_OPT, { hint: '측면 수평철근 직경' }), ...ks.map(k => num(`${p}.horz.${k}`, { dec: 0, field: k, hint: 'F1, F2: 상·하 피복에서 수평철근까지, E@F: 개수@간격' }))] }],
                colWidths: [70, 55, 55, 55, 55],
            });
            el.appendChild(h('div', { class: 'note' }, `* 거더 높이 ${hgt} mm, 폭 ${cw.b} mm`));
        } else if (tab === 'stir') {
            const segs = v.stir.segs || [];
            new Grid(el, {
                id: 'bc-stir',
                head: [[{ t: '직경' }, { t: '스터럽' }, { t: '구간수' }, { t: '배치' }, ...segs.map((_, k) => ({ t: `S${k + 1}` }))]],
                rows: [
                    { cells: [sel(`${p}.stir.dia`, DIAS, { hint: '스터럽 직경' }), sel(`${p}.stir.legs`, [1, 2, 3, 4], { hint: '단면 내 스터럽 개수' }), segCountCell(`${p}.stir.segs`, '스터럽 배치 구간 수 (거더 길이방향)'), lbl('개수', { cls: 'ro', align: 'center' }), ...segs.map((_, k) => num(`${p}.stir.segs.${k}.n`, { dec: 0, hint: `S${k + 1} 개수` }))] },
                    { cells: [lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), lbl('', { cls: 'ro' }), lbl('간격', { cls: 'ro', align: 'center' }), ...segs.map((_, k) => num(`${p}.stir.segs.${k}.s`, { dec: 0, field: `S${k + 1}`, hint: `S${k + 1} 간격 (블록 시점 피복부터)` }))] },
                ],
                colWidths: [65, 55, 55, 45, ...segs.map(() => 55)],
            });
            const fr = blockFrame(ctx.c, ctx.bi);
            const tot = segs.reduce((a, s) => a + (s.n | 0) * (+s.s || 0), 0);
            el.appendChild(h('div', { class: 'note' }, `* 배치 합계 ${tot} mm / 거더 길이(블록 − 피복) ${Math.round(fr.L0 - 2 * planCover(getSettings(ctx.c, ctx.bi)))} mm`));
        } else {
            const rows = [];
            for (const [face, ft] of [['U', '상면'], ['L', '하면']]) {
                [0, 1, 2].forEach(li => {
                    const lp = `${p}.main.${face}.${li}`;
                    const use = li === 0 || !!store.get(`${lp}.use`);
                    const n = (k) => num(`${lp}.${k}`, { dec: 0, disabled: !use, hint: 'C1, C2: 좌우 피복에서 주철근까지, B@C: 개수@간격' });
                    const head = li === 0 ? [{ t: ft, rs: 3 }, { t: `${li + 1}단` }] : [{ t: `${li + 1}단` }];
                    rows.push({ head, cells: [li === 0 ? lbl('사용', { cls: 'ro', align: 'center' }) : chk(`${lp}.use`, { hint: `${ft} ${li + 1}단 사용` }), n('dist'), sel(`${lp}.dia`, DIA_OPT, { disabled: !use, hint: '주철근 직경' }), n('C1'), n('B'), n('C'), n('C2')] });
                });
            }
            new Grid(el, { id: 'bc-gmain', head: [[{ t: '구분', cs: 2 }, { t: '' }, { t: '거리' }, { t: '직경' }, { t: 'C1' }, { t: 'B' }, { t: 'C' }, { t: 'C2' }]], rows, colWidths: [46, 40, 40, 55, 65, 50, 50, 50, 50] });
            el.appendChild(h('div', { class: 'note' }, `* ${MEM_TITLE[ui.mem]}: 폭 ${cw.b} (기둥 폭) × 높이 ${hgt} (슬래브 두께), 블록 전장 연속`));
        }
    },

    footer(el, ctx) {
        el.appendChild(button('설계검토', () => checkPopup(ctx), { disabled: !walls(ctx).length }));
    },

    defaults(ctx, tab) {
        const cw = cur(ctx);
        if (!cw) return;
        const p = memPath(ctx);
        const d = defaultFor(ctx, cw, ui.mem);
        const key = ui.mem === 'col' ? { main: 'main', tie: 'tie', hoop: 'hoop' }[tab] : { main: 'main', horz: 'horz', stir: 'stir' }[tab];
        if (key) store.set(`${p}.${key}`, d[key]);
        else store.set(p, d);
    },

    draw(ctx, tab) {
        const cw = cur(ctx);
        if (!cw) return new Drawing();
        memPath(ctx);
        return ui.mem === 'col' ? columnDrawing(ctx, cw, tab) : girderDrawing(ctx, cw, tab);
    },
    viewKey: (ctx) => `beamCol|${ctx.ci}|${ctx.bi}|${ui.wi}|${ui.mem}`,
};

// ── 도면 ──────────────────────────────────────────────────────────────

function chainH(d, xs, yRef, yDim, labels, th) {
    for (let i = 0; i < xs.length - 1; i++) if (xs[i + 1] - xs[i] > 1e-6) d.dimH(xs[i], xs[i + 1], yRef, yDim, labels ? labels[i] : undefined, { h: th * 0.55 });
}
function chainV(d, ys, xRef, xDim, labels, th) {
    for (let i = 0; i < ys.length - 1; i++) if (ys[i + 1] - ys[i] > 1e-6) d.dimV(ys[i], ys[i + 1], xRef, xDim, labels ? labels[i] : undefined, { h: th * 0.55 });
}

/** 위치 목록 → 치수 문자 (같은 간격 묶음 n@s) */
function groupGaps(pos) {
    const xs = [pos[0]], labels = [];
    let i = 1;
    while (i < pos.length) {
        const g = pos[i] - pos[i - 1];
        let j = i;
        while (j + 1 < pos.length && Math.abs(pos[j + 1] - pos[j] - g) < 0.5) j++;
        const n = j - i + 1;
        xs.push(pos[j]);
        labels.push(n > 1 ? `${n}@${fmtLen(g)}` : fmtLen(g));
        i = j + 1;
    }
    return { xs, labels };
}

function keyPlan(d, ctx, cw, ox, oy, scale, mark) {
    const fr = blockFrame(ctx.c, ctx.bi);
    const th = d.textHeight;
    const T = (u, v) => [ox + u * scale, oy - (v - fr.off) * scale];
    d.pline(fr.corners().map(([u, v]) => T(u, v)), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    const v = fr.vOfX((cw.w.x0 + cw.w.x1) / 2);
    const cb = ctx.c.columns && ctx.c.columns.blocks && ctx.c.columns.blocks[ctx.bi];
    const cdat = cb && cb.walls && cb.walls.filter(Boolean)[0] ? null : null;
    void cdat;
    const k = walls(ctx).findIndex(w => w.index === cw.index);
    const mids = cw.g.walls.filter(w => w.kind === 'mid' && w.floor !== 2);
    const kk = mids.indexOf(cw.w);
    const wd = cb && cb.walls && cb.walls[kk];
    let u = fr.uS(v);
    const ctcs = wd && wd.ctc ? wd.ctc : [fr.L0 / 2];
    ctcs.forEach((c, i) => {
        u += +c || 0;
        const t = wd && wd.t ? +wd.t[i] || cw.D : cw.D;
        const [x, y] = T(u, v);
        if (cw.round) d.circle(x, y, cw.b / 2 * scale, { color: COLOR.CYAN, layer: 'CONC' });
        else d.rect(x - t / 2 * scale, y - cw.b / 2 * scale, t * scale, cw.b * scale, { color: COLOR.CYAN, layer: 'CONC' });
    });
    void k;
    // 거더선 / 단면 표시
    const a = T(fr.uS(v), v), b = T(fr.uE(v), v);
    d.line(a[0], a[1], b[0], b[1], { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    const mx = (a[0] + b[0]) / 2;
    const yA = T(0, fr.vL)[1] + th, yB = T(0, fr.vR)[1] - th;
    d.line(mx, yA, mx, yA - th * 0.8, { color: COLOR.MAGENTA, layer: 'MARK' });
    d.line(mx, yB, mx, yB + th * 0.8, { color: COLOR.MAGENTA, layer: 'MARK' });
    d.text(mx, yA + th * 0.2, 'A', { color: COLOR.MAGENTA, h: th, layer: 'MARK' });
    d.text(mx, yB - th * 1.2, 'A', { color: COLOR.MAGENTA, h: th, layer: 'MARK' });
    d.line(a[0] - th, a[1], a[0] - th * 2, a[1], { color: COLOR.MAGENTA, layer: 'MARK' });
    d.text(a[0] - th * 2.5, a[1], 'B', { color: COLOR.MAGENTA, h: th, valign: 'middle', layer: 'MARK' });
    d.text(ox, oy + (fr.W / 2) * scale + th * 2.5, `KEY PLAN (BLOCK ${ctx.bi + 1}, ${mark})`, { color: COLOR.WHITE, h: th * 0.8, align: 'left', layer: 'TEXT' });
}

function columnDrawing(ctx, cw, tab) {
    const col = store.get(memPath(ctx));
    const th = Math.max(40, Math.max(cw.b, cw.D) / 14, cw.H / 45);
    const d = new Drawing({ textHeight: th });
    const pre = getRebarCommon(ctx.p).marks.column || 'P';
    const ly0 = col.main.layers[0];
    // 단면 (원점 = 왼쪽 아래)
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    if (cw.round) d.circle(cw.b / 2, cw.D / 2, cw.b / 2, cy); else d.rect(0, 0, cw.b, cw.D, cy);
    const bars = columnBars(cw, col);
    for (const b of bars) d.circle(b.x, b.y, Math.max(8, barD(b.dia) / 2), { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
    const dist = +ly0.dist || 80, dh = barD(col.hoop.dia);
    const hs = { color: tab === 'hoop' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' };
    if (cw.round) d.circle(cw.b / 2, cw.D / 2, cw.b / 2 - dist + dh, hs);
    else d.rect(dist - dh, dist - dh, cw.b - 2 * dist + 2 * dh, cw.D - 2 * dist + 2 * dh, hs);
    if (!cw.round && col.tie && col.tie.dia) {
        const ts = { color: tab === 'tie' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' };
        if (+col.tie.C1 > 0) for (let k = 0, x = dist + +col.tie.C1; k <= (col.tie.B | 0); k++, x += +col.tie.C || 0) d.line(x, dist - dh, x, cw.D - dist + dh, ts);
        if (+col.tie.F1 > 0) for (let k = 0, y = dist + +col.tie.F1; k <= (col.tie.E | 0); k++, y += +col.tie.F || 0) d.line(dist - dh, y, cw.b - dist + dh, y, ts);
    }
    if (!cw.round) {
        const xs = facePositions(cw.b, ly0);
        const gx = groupGaps(xs);
        chainH(d, [0, ...gx.xs, cw.b], cw.D, cw.D + th * 2.2, [String(dist), ...gx.labels, String(dist)], th);
        d.dimH(0, cw.b, cw.D, cw.D + th * 3.8, undefined, { h: th * 0.6 });
        const ys = facePositions(cw.D, ly0, ['F1', 'E', 'F', 'F2']);
        const gy = groupGaps(ys);
        chainV(d, [0, ...gy.xs, cw.D], 0, -th * 2.2, [String(dist), ...gy.labels, String(dist)], th);
        d.dimV(0, cw.D, 0, -th * 3.8, undefined, { h: th * 0.6 });
    } else d.dimH(0, cw.b, cw.D, cw.D + th * 2.2, `D=${fmtLen(cw.b)}`, { h: th * 0.6 });
    const q = [cw.b + th * 2.2, -th * 1.6];
    const b0 = bars[bars.length - 1] || { x: cw.b - dist, y: dist };
    d.line(b0.x, b0.y, q[0] - th * 0.7, q[1], { color: COLOR.RED, layer: 'MARK' });
    d.bubble(q[0], q[1], `${pre}1`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
    d.text(q[0] + th, q[1], `${ly0.dia}  ${bars.length} EA`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    d.text(cw.b / 2, -th * 3.6, '단면 A-A', { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    // 입면 (오른쪽)
    const ox = cw.b + th * 9, H = cw.H;
    d.rect(ox, 0, cw.b, H, cy);
    const g = cw.g;
    d.line(ox - th * 2, 0, ox + cw.b + th * 2, 0, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    d.line(ox - th * 2, H, ox + cw.b + th * 2, H, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    const xs = cw.round ? [dist, cw.b / 2, cw.b - dist] : facePositions(cw.b, ly0);
    const topT = g.kind === 'DOUBLE' ? g.MT : g.UT;
    for (const x of xs) d.line(ox + x, -(g.LT - 80), ox + x, H + topT - 80, { color: COLOR.MAGENTA, layer: 'REBAR' });
    const hp = segPositions(col.hoop.segs, 80);
    for (const y of hp) d.line(ox + dist - dh, y, ox + cw.b - dist + dh, y, { color: tab === 'hoop' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' });
    const gh = groupGaps(hp);
    chainV(d, [0, ...gh.xs, H], ox + cw.b, ox + cw.b + th * 2.2, ['80', ...gh.labels, fmtLen(H - hp[hp.length - 1])], th);
    d.dimV(0, H, ox + cw.b, ox + cw.b + th * 3.8, undefined, { h: th * 0.6 });
    const qb = [ox - th * 2.2, H * 0.6];
    d.line(ox + dist, H * 0.55, qb[0] + th * 0.7, qb[1], { color: COLOR.RED, layer: 'MARK' });
    d.bubble(qb[0], qb[1], `${pre}2`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
    d.text(qb[0], qb[1] - th, col.hoop.dia, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'MARK' });
    d.text(ox + cw.b / 2, -th * 3.6, '기둥 입면 B-B', { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    // KEY PLAN (위)
    const fr = blockFrame(ctx.c, ctx.bi);
    const sc = (ox + cw.b + th * 6) / fr.L0;
    keyPlan(d, ctx, cw, 0, H + th * 6 + fr.W / 2 * sc, sc, `벽체 ${cw.index + 1}`);
    d.legend = '기둥 철근';
    return d;
}

function girderDrawing(ctx, cw, tab) {
    const gd = store.get(memPath(ctx));
    const gb = girderBars(cw, ui.mem, gd);
    const th = Math.max(40, Math.max(gb.bw, gb.h) / 14);
    const d = new Drawing({ textHeight: th });
    const pre = getRebarCommon(ctx.p).marks.beam || 'G';
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.rect(0, 0, gb.bw, gb.h, cy);
    for (const b of gb.bars) d.circle(b.x, b.y, Math.max(8, barD(b.dia) / 2), { color: (tab === 'horz' && b.face === 'S') || (tab === 'main' && b.face !== 'S') ? COLOR.MAGENTA : COLOR.RED, fill: COLOR.MAGENTA, layer: 'REBAR' });
    const ds = barD(gd.stir.dia);
    d.rect(80 - ds, 80 - ds, gb.bw - 160 + 2 * ds, gb.h - 160 + 2 * ds, { color: tab === 'stir' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' });
    for (const [face, y0, sgn] of [['U', gb.h, 1], ['L', 0, -1]]) {
        const ly = gd.main[face][0];
        if (!ly || !ly.dia) continue;
        const xs = facePositions(gb.bw, ly);
        const gx = groupGaps(xs);
        chainH(d, [0, ...gx.xs, gb.bw], y0, y0 + sgn * th * 2.2, [String(ly.dist), ...gx.labels, String(ly.dist)], th);
        const q = [gb.bw + th * 2.5, y0 + sgn * th * 1.2];
        d.line(xs[xs.length - 1], y0 - sgn * (+ly.dist || 80), q[0] - th * 0.7, q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], `${pre}${face === 'U' ? 1 : 2}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + th, q[1], `${ly.dia}  ${xs.length} EA`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    }
    d.dimV(0, gb.h, 0, -th * 2.2, undefined, { h: th * 0.6 });
    d.text(gb.bw / 2, -th * 3.6, `${MEM_TITLE[ui.mem]} 단면 A-A`, { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    // 종단 (스터럽 배치), 길이 축척
    const fr = blockFrame(ctx.c, ctx.bi);
    const Lg = fr.L0 - 2 * planCover(getSettings(ctx.c, ctx.bi));
    const ox = gb.bw + th * 10;
    const sx = Math.min(1, (gb.h * 8) / Lg);
    const X = (u) => ox + u * sx;
    d.rect(X(0), 0, Lg * sx, gb.h, cy);
    const sp = segPositions(gd.stir.segs, 0, false, Lg);
    for (const u of sp) d.line(X(u), 80 - ds, X(u), gb.h - 80 + ds, { color: tab === 'stir' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' });
    d.line(X(0), gb.h - 80, X(Lg), gb.h - 80, { color: COLOR.MAGENTA, layer: 'REBAR' });
    d.line(X(0), 80, X(Lg), 80, { color: COLOR.MAGENTA, layer: 'REBAR' });
    const gs = groupGaps([0, ...sp, Lg]);
    for (let i = 0; i < gs.xs.length - 1; i++) d.dimH(X(gs.xs[i]), X(gs.xs[i + 1]), 0, -th * 2.2, gs.labels[i], { h: th * 0.5 });
    d.dimH(X(0), X(Lg), 0, -th * 3.8, fmtLen(Lg), { h: th * 0.6 });
    d.text(X(Lg / 2), gb.h + th * 1.5, `${MEM_TITLE[ui.mem]} 종단 B-B (길이 축척 1:${Math.round(1 / sx)})`, { color: COLOR.WHITE, h: th, layer: 'TEXT' });
    const sc = (X(Lg) + th * 2) / fr.L0;
    keyPlan(d, ctx, cw, 0, gb.h + th * 8 + fr.W / 2 * sc, sc, `벽체 ${cw.index + 1}`);
    d.legend = MEM_TITLE[ui.mem];
    return d;
}

// ── 설계검토 ─────────────────────────────────────────────────────────

async function checkPopup(ctx) {
    const cw = cur(ctx);
    if (!cw) return;
    const p = store.project, c = p.culverts[ctx.ci];
    let df = null, err = null;
    try { df = (await import('../calc/designForces.js')).designForces(p, c, 0); } catch (e) { err = e; }
    let ga = null;
    try { ga = (await import('../calc/girder.js')).girderAnalysis(p, c, ctx.bi, cw.index); } catch (e) { console.error(e); }
    const r = beamColCheck(p, c, ctx.bi, cw.index, df, ga);
    const coefM = ga && ga.girders[0] && ga.girders[0].method !== '연속보 해석';
    const f = (v, n = 1) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(n));
    const ok = (v) => (v == null ? lbl('-', { align: 'center' }) : lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' }));
    const body = h('div', { style: { minWidth: '720px' } });
    if (!df) body.appendChild(h('div', { class: 'note', style: { color: '#c00' } }, `* 2D Frame 해석 결과가 없어 부재력을 표시하지 못합니다${err ? ` (${err.message})` : ''}.`));
    body.appendChild(h('div', { style: { fontWeight: 'bold', margin: '4px' } }, `기둥 (벽체 ${cw.index + 1}, ${cw.round ? `원형 D=${cw.b}` : `${cw.b}×${cw.D}`}, 기둥간격 ${fmtLen(cw.ctc)} mm)`));
    const C = r.col;
    new Grid(body, {
        id: 'bc-chk-col',
        head: [[{ t: '철근비', cs: 3 }, { t: '휨강도 (P-M)', cs: 5 }, { t: '전단강도', cs: 3 }, { t: '띠철근 간격', cs: 3 }],
            [{ t: 'ρ' }, { t: '0.01~0.08' }, { t: '판정' }, { t: 'Pu (kN)' }, { t: 'Mu (kN·m)' }, { t: 'φPn' }, { t: 'φMn' }, { t: '판정' }, { t: 'Vu (kN)' }, { t: 'φVn' }, { t: '판정' }, { t: 's' }, { t: 's max' }, { t: '판정' }]],
        rows: [{ cells: [lbl(f(C.rho, 4)), lbl('-'), ok(C.okRho), lbl(f(C.Pu)), lbl(f(C.Mu)), lbl(f(C.phiPn)), lbl(f(C.phiMn)), ok(C.okPM), lbl(f(C.Vu)), lbl(f(C.phiVn)), ok(C.okV), lbl(f(C.hoopS, 0)), lbl(f(C.sMax, 0)), ok(C.okS)] }],
    });
    body.appendChild(h('div', { style: { fontWeight: 'bold', margin: '8px 4px 4px' } }, '거더'));
    new Grid(body, {
        id: 'bc-chk-gir',
        head: [[{ t: '부재' }, { t: '철근비', cs: 2 }, { t: coefM || !ga ? '정모멘트 (wL²/' + ((p.design && p.design.opt && p.design.opt.girderPos) || 14) + ')' : '정모멘트 (경간)', cs: 3 }, { t: coefM || !ga ? '부모멘트 (wL²/' + ((p.design && p.design.opt && p.design.opt.girderNeg) || 10) + ')' : '부모멘트 (지점 연단)', cs: 3 }, { t: '전단', cs: 3 }],
            [{ t: '' }, { t: 'ρ (정/부)' }, { t: '판정' }, { t: 'Mu' }, { t: 'φMn' }, { t: '판정' }, { t: 'Mu' }, { t: 'φMn' }, { t: '판정' }, { t: 'Vu' }, { t: 'φVn' }, { t: '판정' }]],
        rows: r.girders.map(g => ({ cells: [lbl(g.title), lbl(`${f(g.rhoP, 4)} / ${f(g.rhoN, 4)}`), ok(g.okRho), lbl(f(g.MuP)), lbl(f(g.phiMnP)), ok(g.okMP), lbl(f(g.MuN)), lbl(f(g.phiMnN)), ok(g.okMN), lbl(f(g.Vu)), lbl(f(g.phiVn)), ok(g.okV)] })),
    });
    body.appendChild(h('div', { class: 'note' }, `* 해석(단위폭) 중간벽체 축력 N = ${f(r.Nline)} kN/m, 모멘트 M = ${f(r.Mline)} kN·m/m, 전단 V = ${f(r.Vline)} kN/m 을 기둥간격 L = ${f(cw.ctc / 1000, 3)} m 로 환산 (Pu = N·L, Mu = M·L).`
        + (ga ? ' 거더는 기둥을 지점으로 한 종방향 연속보 해석 결과 (상세: [구조 계산 > 종방향 거더 해석]), 기둥 Pu 는 거더 반력 최대값.' : ' 거더 하중 w = N (kN/m), 전단 Vu = 계수·wL/2.')
        + '  기둥 P-M 은 변형률 적합 (rcDesign.pmCheck).'));
    modal({ title: '보, 기둥 설계검토', body, buttons: [{ text: '확인', primary: true }], width: 820 });
}
