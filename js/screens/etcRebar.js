// 배근 입력 > 기타 철근 (매뉴얼 5.13)
// 탭(설치된 것만): 난간벽 | 차수벽/접속저판 | 부상방지저판. 난간벽·차수벽은 시점/종점 행.
// 데이터/계산: calc/etcRebar.js (culverts[i].rebar.etc)

import store from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash } from '../ui/cells.js';
import { h } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { DIAS, barD, getSettings } from '../calc/rebar.js';
import { filletPts } from '../draw/rebarDraw.js';
import { parapetSide } from '../calc/parapetGeom.js';
import {
    RAIL_TYPES, DM_CTC, SHEAR_TYPES, etcExists, getEtcRebar, defaultRailRebar, defaultCutRebar, defaultAntiRebar, railShape, cutShape, antiShape,
} from '../calc/etcRebar.js';
import { getParapet } from '../calc/parapetGeom.js';

const ui = { end: 0 };
const ePath = (ctx) => `${ctx.cp}.rebar.etc`;
const N_MAIN = [1, 2, 3, 4, 5, 6];

function ensureEtc(ctx) {
    const cur = store.get(ePath(ctx));
    const full = getEtcRebar(ctx.c);
    if (!cur || !cur.rail || !cur.cut || !cur.anti) store.set(ePath(ctx), full, { record: false, silent: true });
    return ePath(ctx);
}

export default {
    scope: 'culvert',
    enabled: (ctx) => !ctx.c || etcExists(ctx.c).any,
    hint: '난간벽, 차수벽(접속저판 연결철근), 부상방지저판의 철근을 입력합니다.',

    tabs(ctx) {
        const ex = etcExists(ctx.c);
        const t = [];
        if (ex.rail.some(Boolean)) t.push({ id: 'rail', title: '난간벽' });
        if (ex.cut.some(Boolean)) t.push({ id: 'cut', title: '차수벽/접속저판' });
        if (ex.anti) t.push({ id: 'anti', title: '부상방지저판' });
        return t;
    },

    render(el, ctx, tab) {
        const ex = etcExists(ctx.c);
        if (!ex.any) { el.appendChild(h('div', { class: 'note' }, '[상세입력 > 난간벽 및 차수벽] 또는 단면의 부상방지저판이 없습니다.')); return; }
        const ep = ensureEtc(ctx);
        const onSelect = (cell, r) => { if (r !== ui.end && r < 2) { ui.end = r; ctx.redraw(); } };
        const D = ['', ...DIAS];
        if (tab === 'rail') {
            const row = (i) => {
                const p = `${ep}.rail.${i}`;
                if (!ex.rail[i]) return { head: [{ t: i ? '종점' : '시점' }], cells: Array.from({ length: 14 }, () => dash()) };
                const on = !!store.get(`${p}.hOn`);
                return {
                    head: [{ t: i ? '종점' : '시점' }],
                    cells: [
                        sel(`${p}.NA1`, D, { hint: 'NA1: 수직철근 직경' }), sel(`${p}.type`, RAIL_TYPES, { hint: '도로공사타입 = 앞뒤가 이어진 ㄷ형, 건교부타입 = 면별 철근' }),
                        num(`${p}.ctc`, { dec: 0, hint: '수직철근 간격' }), num(`${p}.dc1`, { dec: 0, field: 'dc1', hint: 'dc1: 수직철근 상단 피복' }), num(`${p}.dc2`, { dec: 0, field: 'dc2', hint: 'dc2: 수직철근 하단 피복' }),
                        num(`${p}.dc3`, { dec: 0, field: 'dc3', hint: 'dc3: 전면 피복' }), dash(), num(`${p}.L1`, { dec: 0, field: 'L1', hint: 'L1: 수직철근 하단의 수평 정착길이' }),
                        chk(`${p}.hOn`, { hint: '수평철근 배치' }), sel(`${p}.NA2`, D, { disabled: !on, hint: 'NA2: 수평철근 직경' }),
                        num(`${p}.F1`, { dec: 0, disabled: !on, field: 'F1', hint: 'F1: 상단 피복에서 첫 수평철근까지' }), num(`${p}.E`, { dec: 0, disabled: !on, hint: 'E@F: F1 부터 개수@간격' }),
                        num(`${p}.F`, { dec: 0, disabled: !on, hint: 'E@F: 간격' }), num(`${p}.F2`, { dec: 0, disabled: !on, hint: 'F2: 하단 피복에서 마지막 수평철근까지' }),
                    ],
                };
            };
            new Grid(el, {
                id: 'etc-rail',
                head: [[{ t: '구분', rs: 2 }, { t: '수직철근', cs: 8 }, { t: '수평철근', cs: 6 }],
                    [{ t: 'NA1' }, { t: '철근타입' }, { t: 'CTC' }, { t: 'dc1' }, { t: 'dc2' }, { t: 'dc3' }, { t: 'dc4' }, { t: 'L1' }, { t: '배치' }, { t: 'NA2' }, { t: 'F1' }, { t: 'E' }, { t: 'F' }, { t: 'F2' }]],
                rows: [row(0), row(1)],
                colWidths: [46, 60, 100, 50, 46, 46, 46, 46, 50, 40, 60, 46, 40, 46, 46],
                onSelect,
            });
        } else if (tab === 'cut') {
            const row = (i) => {
                const p = `${ep}.cut.${i}`;
                if (!ex.cut[i]) return { head: [{ t: i ? '종점' : '시점' }], cells: Array.from({ length: 18 }, () => dash()) };
                const on = !!store.get(`${p}.hOn`), dc = !!store.get(`${p}.dcOn`) && ex.apron[i];
                return {
                    head: [{ t: i ? '종점' : '시점' }],
                    cells: [
                        sel(`${p}.NA1`, D, { hint: 'NA1: 수직철근 직경' }), num(`${p}.ctc`, { dec: 0, hint: '수직철근 간격' }),
                        num(`${p}.dc1`, { dec: 0, hint: 'dc1: 상단 피복 (하부슬래브 상면에서)' }), num(`${p}.dc2`, { dec: 0, hint: 'dc2: 하단 피복' }),
                        num(`${p}.dc3`, { dec: 0, hint: 'dc3: 전면 피복' }), num(`${p}.dc4`, { dec: 0, hint: 'dc4: 배면(하부 정착부) 피복' }), num(`${p}.L1`, { dec: 0, hint: 'L1: 상단 수평 정착길이' }),
                        chk(`${p}.hOn`, { hint: '수평철근 배치' }), sel(`${p}.NA2`, D, { disabled: !on }),
                        num(`${p}.F1`, { dec: 0, disabled: !on, hint: 'F1: 하단 피복에서 첫 수평철근까지' }), num(`${p}.E`, { dec: 0, disabled: !on }), num(`${p}.F`, { dec: 0, disabled: !on }), num(`${p}.F2`, { dec: 0, disabled: !on }),
                        ex.apron[i] ? chk(`${p}.dcOn`, { hint: '접속저판 연결철근 배치' }) : dash(),
                        sel(`${p}.DC`, D, { disabled: !dc, hint: 'DC: 연결철근 직경' }), num(`${p}.dc5`, { dec: 0, disabled: !dc, hint: 'dc5: 하부슬래브 상면에서 연결철근 위치' }),
                        num(`${p}.dcCtc`, { dec: 0, disabled: !dc, hint: '연결철근 간격' }), num(`${p}.CL`, { dec: 0, disabled: !dc, hint: 'CL: 연결철근 길이' }),
                    ],
                };
            };
            new Grid(el, {
                id: 'etc-cut',
                head: [[{ t: '구분', rs: 2 }, { t: '수직철근', cs: 7 }, { t: '수평철근', cs: 6 }, { t: '접속저판 연결철근', cs: 5 }],
                    [{ t: 'NA1' }, { t: 'CTC' }, { t: 'dc1' }, { t: 'dc2' }, { t: 'dc3' }, { t: 'dc4' }, { t: 'L1' }, { t: '배치' }, { t: 'NA2' }, { t: 'F1' }, { t: 'E' }, { t: 'F' }, { t: 'F2' }, { t: '배치' }, { t: 'DC' }, { t: 'dc5' }, { t: 'CTC' }, { t: 'CL' }]],
                rows: [row(0), row(1)],
                onSelect,
            });
        } else {
            const p = `${ep}.anti`;
            new Grid(el, {
                id: 'etc-anti',
                head: [[{ t: 'DM', cs: 2 }, { t: 'BO2', cs: 3 }, { t: 'BO3', cs: 4 }],
                    [{ t: '직경' }, { t: 'CTC' }, { t: '직경' }, { t: '수평 CTC' }, { t: '수직 CTC' }, { t: '직경' }, { t: 'CTC' }, { t: '타입' }, { t: '주철근 구간수' }]],
                rows: [{ cells: [
                    sel(`${p}.dmDia`, DIAS, { hint: 'DM: 부상방지저판 주철근 직경' }), sel(`${p}.dmCtc`, DM_CTC, { hint: `CTC-${store.get(`${p}.dmDia`)}의 DM 데이터를 입력합니다. (주철근 CTC 또는 그 절반)` }),
                    sel(`${p}.bo2Dia`, DIAS, { hint: 'BO2: 수평(길이방향) 철근 직경' }), num(`${p}.bo2H`, { dec: 0, hint: 'BO2 수평방향 간격' }), num(`${p}.bo2V`, { dec: 0, hint: 'BO2 수직방향 간격' }),
                    sel(`${p}.bo3Dia`, D, { hint: 'BO3: 전단철근 직경 (공란 = 배치 안함)' }), num(`${p}.bo3Ctc`, { dec: 0 }), sel(`${p}.bo3Type`, SHEAR_TYPES), sel(`${p}.bo3N`, N_MAIN, { hint: '전단철근이 감싸는 주철근 구간 수' }),
                ] }],
                colWidths: [60, 100, 60, 70, 70, 60, 60, 100, 90],
            });
            const st = getSettings(ctx.c, ctx.bi);
            el.appendChild(h('div', { class: 'note' }, `* 주철근 CTC = 배근설정 CTC ${st.ctc} mm. 좌·우측 날개 동일.`));
        }
    },

    defaults(ctx, tab) {
        const ep = ensureEtc(ctx);
        const ends = getParapet(ctx.c).ends || [];
        if (tab === 'rail') store.set(`${ep}.rail`, [0, 1].map(i => defaultRailRebar(ends[i])));
        else if (tab === 'cut') store.set(`${ep}.cut`, [0, 1].map(i => defaultCutRebar(ends[i])));
        else store.set(`${ep}.anti`, defaultAntiRebar());
    },

    draw(ctx, tab) {
        const ex = etcExists(ctx.c);
        if (!ex.any) return new Drawing();
        ensureEtc(ctx);
        if (tab === 'rail') { const e = ex.rail[ui.end] ? ui.end : ex.rail.indexOf(true); return e >= 0 ? railDrawing(ctx, e) : new Drawing(); }
        if (tab === 'cut') { const e = ex.cut[ui.end] ? ui.end : ex.cut.indexOf(true); return e >= 0 ? cutDrawing(ctx, e) : new Drawing(); }
        return antiDrawing(ctx);
    },
    viewKey: (ctx, tab) => `etcRebar|${ctx.ci}|${tab}|${ui.end}|${ctx.bi}`,
};

const BAR = { color: COLOR.MAGENTA, layer: 'REBAR' };
const CY = { color: COLOR.CYAN, layer: 'CONC' };

function dots(d, pts, dia) { for (const q of pts) d.circle(q[0], q[1], Math.max(8, barD(dia) / 2), { ...BAR, fill: COLOR.MAGENTA }); }

function bubble(d, pt, q, txt, sub) {
    const th = d.textHeight;
    d.line(pt[0], pt[1], q[0], q[1], { color: COLOR.RED, layer: 'MARK' });
    d.bubble(q[0], q[1], txt, { r: th * 0.9, color: COLOR.RED, textColor: COLOR.GREEN });
    d.text(q[0] + th * 1.2, q[1], sub, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
}

/** 단부 측면: x = 단부면에서 안쪽 + → 도면에서는 왼쪽(-)이 바깥 */
function railDrawing(ctx, end) {
    const S = railShape(ctx.c, end);
    const { g, r } = S;
    const th = Math.max(30, (S.Wh + g.UT) / 30);
    const d = new Drawing({ textHeight: th });
    const sd = parapetSide(S.e, g);
    d.pline(sd.rail, { ...CY, closed: true });
    const xin = Math.max(1500, +r.L1 + 600);
    d.pline([[xin, g.Htot], [0, g.Htot], [0, g.Htot - g.UT], [xin, g.Htot - g.UT]], CY);
    d.line(xin, g.Htot + th, xin, g.Htot - g.UT - th, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    const R = barD(r.NA1) * 3;
    for (const pts of S.vert) d.pline(filletPts(pts, R), BAR);
    dots(d, S.horz, r.NA2);
    // 치수
    const yt = S.yt;
    const hp = S.horz.filter((q, i) => i % 2 === 0).map(q => q[1]).sort((a, b) => b - a);
    const ys = [g.Htot + S.Wh, yt, ...hp, S.yb, g.Htot - g.UT];
    const labels = ['dc1', 'F1', ...hp.slice(1).map(() => (+r.F ? `F` : '')), '', 'dc2'];
    for (let i = 0; i < ys.length - 1; i++) if (ys[i] - ys[i + 1] > 1) d.dimV(ys[i + 1], ys[i], 0, -th * 2.5, fmtLen(ys[i] - ys[i + 1]), { h: th * 0.55, name: labels[i] || undefined });
    d.dimV(g.Htot, g.Htot + S.Wh, 0, -th * 4.5, undefined, { h: th * 0.6 });
    d.dimH(0, S.t1, g.Htot + S.Wh, g.Htot + S.Wh + th * 2, undefined, { h: th * 0.6 });
    d.dimH(0, +r.dc3, g.Htot - g.UT, g.Htot - g.UT - th * 2, String(r.dc3), { h: th * 0.55, name: 'dc3' });
    d.dimH(+r.dc3, +r.dc3 + +r.L1, g.Htot - g.UT, g.Htot - g.UT - th * 2, String(r.L1), { h: th * 0.55, name: 'L1' });
    if (S.horz.length) bubble(d, S.horz[0], [S.t1 + th * 3, yt + th], 'NA2', r.NA2);
    bubble(d, [+r.dc3 + +r.L1 * 0.6, S.yb], [+r.dc3 + +r.L1 + th * 3, S.yb - th * 2], 'NA1', `${r.NA1} C.T.C ${r.ctc}`);
    d.text(S.t1 / 2, g.Htot - g.UT - th * 4.5, `${end ? '종점' : '시점'} 난간벽 (${r.type})`, { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    d.legend = '난간벽';
    return d;
}

function cutDrawing(ctx, end) {
    const S = cutShape(ctx.c, end);
    const { g, r } = S;
    const th = Math.max(30, (S.H + g.LT) / 28);
    const d = new Drawing({ textHeight: th });
    const sd = parapetSide(S.e, g);
    d.pline(sd.cut, CY);
    const xin = Math.max(1500, +r.L1 + 600);
    d.pline([[xin, g.LT], [0, g.LT], [0, 0]], CY);
    d.line(S.c1, 0, xin, 0, CY);
    d.line(xin, g.LT + th, xin, -th, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    if (sd.apron) d.pline(sd.apron.map(([x, y]) => [x, y]).filter(q => q[0] > -Math.max(3000, +r.CL)), CY);
    const R = barD(r.NA1) * 3;
    for (const pts of S.vert) d.pline(filletPts(pts, R), BAR);
    dots(d, S.horz, r.NA2);
    if (S.dc) d.pline(S.dc, { ...BAR, color: COLOR.MAGENTA });
    const ys = [g.LT, g.LT - +r.dc1, ...S.horz.filter((q, i) => i % 2 === 0).map(q => q[1]).sort((a, b) => b - a), -S.H + +r.dc2, -S.H];
    for (let i = 0; i < ys.length - 1; i++) if (ys[i] - ys[i + 1] > 1) d.dimV(ys[i + 1], ys[i], 0, -th * 2.5, fmtLen(ys[i] - ys[i + 1]), { h: th * 0.55 });
    d.dimV(-S.H, g.LT, 0, -th * 4.5, undefined, { h: th * 0.6 });
    d.dimH(0, S.c1, -S.H, -S.H - th * 2, undefined, { h: th * 0.6 });
    d.dimH(+r.dc3, +r.dc3 + +r.L1, g.LT, g.LT + th * 2, String(r.L1), { h: th * 0.55, name: 'L1' });
    if (S.dc) {
        bubble(d, S.dc[1], [S.dc[1][0] - th * 2, S.dc[1][1] + th * 3], 'DC', `${r.DC},L=${fmtLen(+r.CL)},C.T.C ${r.dcCtc}`);
        d.dimV(S.dc[0][1], g.LT, S.dc[0][0], S.dc[0][0] + th * 2, String(r.dc5), { h: th * 0.55, name: 'dc5' });
    }
    bubble(d, [+r.dc3, (-S.H + g.LT) / 2], [S.c1 + th * 3, -S.H / 2], 'NA1', `${r.NA1} C.T.C ${r.ctc}`);
    if (S.horz.length) bubble(d, S.horz[1] || S.horz[0], [S.c1 + th * 3, -S.H * 0.85], 'NA2', r.NA2);
    d.text(S.c1 / 2, -S.H - th * 4, `${end ? '종점' : '시점'} 차수벽`, { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    d.legend = '차수벽';
    return d;
}

function antiDrawing(ctx) {
    let bi = ctx.bi;
    let A = antiShape(ctx.c, bi);
    if (!A) { for (const b of ctx.blocks) { A = antiShape(ctx.c, b.index); if (A) { bi = b.index; break; } } }
    if (!A) return new Drawing();
    const { g, r, brW, t } = A;
    const th = Math.max(25, (brW + 1500) / 40);
    const d = new Drawing({ textHeight: th });
    // 벽체 (위로 끊김), 하부슬래브 (오른쪽 끊김), 날개 (왼쪽)
    const wH = Math.max(t + 600, 1200);
    d.pline(g.antiFloat.left, CY);
    d.pline([[0, t + (g.antiFloat.t1 || 0)], [0, wH]], CY);
    d.pline([[g.WL, wH], [g.WL, g.LT], [g.WL + 900, g.LT]], CY);
    d.line(0, 0, g.WL + 900, 0, CY);
    d.line(-th * 0.5, wH, g.WL + th * 0.5, wH, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    d.line(g.WL + 900, -th * 0.5, g.WL + 900, g.LT + th * 0.5, { color: COLOR.CYAN, dash: 'hidden', layer: 'HIDDEN' });
    d.pline(filletPts(A.dm, barD(r.dmDia) * 3), BAR);
    dots(d, A.bo2, r.bo2Dia);
    if (r.bo3Dia) for (const s of A.bo3) d.pline(s, { color: COLOR.MAGENTA, layer: 'REBAR' });
    bubble(d, A.dm[1], [-brW - th * 3, t + th * 3], 'DM', `${r.dmDia}  C.T.C ${(+getSettings(ctx.c, bi).ctc || 250) / (r.dmCtc === DM_CTC[1] ? 2 : 1)}`);
    if (A.bo2.length) bubble(d, A.bo2[0], [-brW - th * 3, t * 0.5], 'BO2', r.bo2Dia);
    if (A.bo3.length && r.bo3Dia) bubble(d, A.bo3[0][0], [-brW - th * 3, -th * 2.5], 'BO3', r.bo3Dia);
    const ys = [0, A.cv, ...Array.from({ length: Math.max(0, A.nv - 2) }, (_, k) => A.cv + (k + 1) * (t - 2 * A.cv) / Math.max(1, A.nv - 1)), t - A.cv, t].filter((v, i, a) => i === 0 || v > a[i - 1] + 1);
    for (let i = 0; i < ys.length - 1; i++) d.dimV(ys[i], ys[i + 1], -brW, -brW - th * 2, fmtLen(ys[i + 1] - ys[i]), { h: th * 0.55 });
    d.dimV(0, t, -brW, -brW - th * 3.6, undefined, { h: th * 0.6 });
    d.dimH(-brW, -brW + A.cv, 0, -th * 2, String(A.cv), { h: th * 0.55 });
    d.dimH(-brW + A.cv, 0, 0, -th * 2, undefined, { h: th * 0.55 });
    d.text(-brW / 2, -th * 4.5, `부상방지저판 (BLOCK ${bi + 1}, 좌측 — 우측 동일)`, { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    d.legend = '부상방지저판';
    return d;
}
