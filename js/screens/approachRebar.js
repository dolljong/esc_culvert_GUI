// 배근 입력 > 접속슬래브 배근 (매뉴얼 5.12)
// [상세입력 > 접속 슬래브]에서 입력한 접속슬래브별 주철근/수평철근 CTC·직경 (철근배치 탭), 피복·전단철근 (배근설정 탭).
// 데이터/계산: calc/approachRebar.js (culverts[i].rebar.approach.list[k])

import store from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl } from '../ui/cells.js';
import { h, button, modal } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { DIAS, barD } from '../calc/rebar.js';
import { getApproach, approachSection } from '../calc/approachGeom.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { CTC_OPTS, hasApproach, defaultApproachRebar, getApproachRebar, approachDims, approachCheck } from '../calc/approachRebar.js';
import { SHEAR_TYPES } from '../calc/shearBars.js';

const ui = { row: 0 };
const N_WRAP = [1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: `${n}구간` }));
const lp = (ctx, i) => `${ctx.cp}.rebar.approach.list.${i}`;

function ensureAll(ctx) {
    const list = getApproach(ctx.c).list;
    list.forEach((a, i) => { if (store.get(lp(ctx, i)) == null) store.set(lp(ctx, i), getApproachRebar(ctx.c, i), { record: false, silent: true }); });
    if (ui.row >= list.length) ui.row = 0;
    return list;
}

export default {
    scope: 'culvert',
    enabled: (ctx) => !ctx.c || hasApproach(ctx.c),
    hint: '접속슬래브의 주철근/수평철근 배치 간격과 직경, 피복과 전단철근을 입력합니다.',
    tabs: () => [{ id: 'place', title: '철근배치' }, { id: 'set', title: '배근설정' }],

    render(el, ctx, tab) {
        if (!hasApproach(ctx.c)) { el.appendChild(h('div', { class: 'note' }, '[상세입력 > 접속 슬래브]에서 접속슬래브를 입력하면 배근할 수 있습니다.')); return; }
        const list = ensureAll(ctx);
        const onSelect = (cell, r) => { if (r !== ui.row) { ui.row = r; ctx.redraw(); } };
        if (tab === 'set') {
            new Grid(el, {
                id: 'ap-set',
                head: [[{ t: '구분', rs: 2 }, { t: '피복', cs: 3 }, { t: '전단철근', cs: 4 }], [{ t: '상면' }, { t: '하면' }, { t: '측면' }, { t: 'CTC' }, { t: '직경' }, { t: '묶는 구간' }, { t: '형태' }]],
                rows: list.map((a, i) => ({
                    head: [{ t: `${i + 1}` }],
                    cells: [
                        num(`${lp(ctx, i)}.cover.top`, { dec: 0, hint: '상면 피복 (철근 중심까지)' }), num(`${lp(ctx, i)}.cover.bottom`, { dec: 0, hint: '하면 피복' }), num(`${lp(ctx, i)}.cover.side`, { dec: 0, hint: '측면(끝단) 피복' }),
                        sel(`${lp(ctx, i)}.shear.ctc`, CTC_OPTS, { hint: '전단철근 배치 간격' }), sel(`${lp(ctx, i)}.shear.dia`, ['', ...DIAS], { hint: '전단철근 직경 (공란 = 배치 안함)' }),
                        sel(`${lp(ctx, i)}.shear.n`, N_WRAP, { hint: '묶는 구간: 전단철근이 감싸는 주철근 간격 수' }), sel(`${lp(ctx, i)}.shear.type`, SHEAR_TYPES, { hint: '전단철근 형태' }),
                    ],
                })),
                colWidths: [40, 55, 55, 55, 60, 60, 70, 90],
                onSelect,
            });
        } else {
            new Grid(el, {
                id: 'ap-place',
                head: [
                    [{ t: '구분', rs: 3 }, { t: '주철근', cs: 4 }, { t: '수평철근', cs: 4 }],
                    [{ t: '상면', cs: 2 }, { t: '하면', cs: 2 }, { t: '상면', cs: 2 }, { t: '하면', cs: 2 }],
                    [{ t: 'CTC' }, { t: '직경' }, { t: 'CTC' }, { t: '직경' }, { t: 'CTC' }, { t: '직경' }, { t: 'CTC' }, { t: '직경' }],
                ],
                rows: list.map((a, i) => ({
                    head: [{ t: `${i + 1}` }],
                    cells: [
                        sel(`${lp(ctx, i)}.main.top.ctc`, CTC_OPTS, { hint: '상면 주철근 배치 간격' }), sel(`${lp(ctx, i)}.main.top.dia`, DIAS, { hint: '상면 주철근 직경' }),
                        sel(`${lp(ctx, i)}.main.bottom.ctc`, CTC_OPTS, { hint: '하면 주철근 배치 간격' }), sel(`${lp(ctx, i)}.main.bottom.dia`, DIAS, { hint: '하면 주철근 직경' }),
                        sel(`${lp(ctx, i)}.horz.top.ctc`, CTC_OPTS, { hint: '상면 수평철근 배치 간격' }), sel(`${lp(ctx, i)}.horz.top.dia`, DIAS, { hint: '상면 수평철근 직경' }),
                        sel(`${lp(ctx, i)}.horz.bottom.ctc`, CTC_OPTS, { hint: '하면 수평철근 배치 간격' }), sel(`${lp(ctx, i)}.horz.bottom.dia`, DIAS, { hint: '하면 수평철근 직경' }),
                    ],
                })),
                colWidths: [40, 60, 60, 60, 60, 60, 60, 60, 60],
                onSelect,
            });
        }
        const D = approachDims(ctx.p, ctx.c, ui.row);
        el.appendChild(h('div', { class: 'note' }, `* ${ui.row + 1}번 (${D.a.side}): 길이 ${fmtLen(D.Ltot)} × 폭 ${fmtLen(D.Wa)}, 두께 ${D.H2}~${D.H1} mm${Math.abs(D.sin - 1) > 1e-3 ? `, 사각 ${(Math.asin(D.sin) * 180 / Math.PI).toFixed(1)}° (주철근 사보강)` : ''}`));
    },

    footer(el, ctx) {
        el.appendChild(button('설계검토', () => checkPopup(ctx), { disabled: !hasApproach(ctx.c) }));
    },

    defaults(ctx, tab) {
        const list = getApproach(ctx.c).list;
        list.forEach((a, i) => {
            const d = defaultApproachRebar(a);
            if (tab === 'set') { store.set(`${lp(ctx, i)}.cover`, d.cover); store.set(`${lp(ctx, i)}.shear`, d.shear); }
            else { store.set(`${lp(ctx, i)}.main`, d.main); store.set(`${lp(ctx, i)}.horz`, d.horz); }
        });
    },

    draw(ctx, tab) {
        if (!hasApproach(ctx.c)) return new Drawing();
        ensureAll(ctx);
        return approachDrawing(ctx, ui.row, tab);
    },
    viewKey: (ctx) => `approachRebar|${ctx.ci}|${ui.row}`,
};

function approachDrawing(ctx, i, tab) {
    const D = approachDims(ctx.p, ctx.c, i);
    const r = getApproachRebar(ctx.c, i);
    const W = D.Wa, L = D.Ltot;
    const th = Math.max(120, Math.max(W, L) / 45);
    const d = new Drawing({ textHeight: th });
    const cv = r.cover;
    const ang = (+D.a.s.ang || 90) * Math.PI / 180;
    const cot = Math.abs(Math.sin(ang)) < 1e-6 ? 0 : Math.cos(ang) / Math.sin(ang);
    // 평면: x = 구조물 길이방향 (0~W), y = 구조물에서 바깥쪽 (0~L), 사각은 x 이동
    const P = (x, y) => [x + cot * y, y];
    d.pline([P(0, 0), P(W, 0), P(W, L), P(0, L)], { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.text(W / 2, -th * 0.6, '구조물측 (브래킷)', { color: COLOR.GREEN, h: th * 0.7, valign: 'top', layer: 'TEXT' });
    const xm = W / 2;
    d.line(...P(xm, -th), ...P(xm, L + th), { color: COLOR.CYAN, dash: 'center', layer: 'CENTER' });
    d.text(...P(xm - th, L + th * 0.5), '상 면', { color: COLOR.GREEN, h: th, align: 'right', layer: 'TEXT' });
    d.text(...P(xm + th, L + th * 0.5), '하 면', { color: COLOR.GREEN, h: th, align: 'left', layer: 'TEXT' });
    const mc = tab === 'place' ? COLOR.MAGENTA : COLOR.RED;
    // 주철근 (y 방향): 왼쪽 절반 상면 CTC, 오른쪽 절반 하면 CTC
    const mt = +r.main.top.ctc || 250, mb = +r.main.bottom.ctc || 125;
    for (let x = cv.side; x <= xm + 1e-6; x += mt) d.line(...P(x, cv.side), ...P(x, L - cv.side), { color: mc, layer: 'REBAR' });
    const xs0 = W - cv.side - Math.floor((W - 2 * cv.side) / mb) * mb;
    for (let x = xs0; x <= W - cv.side + 1e-6; x += mb) if (x >= xm) d.line(...P(x, cv.side), ...P(x, L - cv.side), { color: mc, layer: 'REBAR' });
    // 수평철근 (x 방향)
    const ht = +r.horz.top.ctc || 300, hb = +r.horz.bottom.ctc || 150;
    for (let y = cv.side; y <= L - cv.side + 1e-6; y += ht) d.line(...P(cv.side, y), ...P(xm, y), { color: mc, layer: 'REBAR' });
    for (let y = cv.side; y <= L - cv.side + 1e-6; y += hb) d.line(...P(xm, y), ...P(W - cv.side, y), { color: mc, layer: 'REBAR' });
    // 기호
    const bub = (pt, txt, dia, q) => {
        d.line(pt[0], pt[1], q[0], q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], txt, { r: th * 0.8, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0], q[1] - th, dia, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'MARK' });
    };
    bub(P(cv.side + mt * 2, L * 0.7), 'AS1', r.main.top.dia, P(-th * 3, L * 0.8));
    bub(P(W - cv.side - mb * 2, L * 0.7), 'AS2', r.main.bottom.dia, P(W + th * 3, L * 0.8));
    bub(P(W * 0.25, cv.side + ht), 'AH1', r.horz.top.dia, P(-th * 3, L * 0.3));
    bub(P(W * 0.75, cv.side + hb), 'AH2', r.horz.bottom.dia, P(W + th * 3, L * 0.3));
    // 단면표시
    for (const [x0, y0, x1, y1, t] of [[W * 0.62, -th * 1.5, W * 0.62, L + th * 1.5, 'A'], [-th * 1.5, L * 0.5, W + th * 1.5, L * 0.5, 'B']]) {
        const a = P(x0, y0), b = P(x1, y1);
        d.line(a[0], a[1], a[0] + (b[0] - a[0]) * 0.03, a[1] + (b[1] - a[1]) * 0.03, { color: COLOR.MAGENTA, layer: 'MARK' });
        d.line(b[0], b[1], b[0] - (b[0] - a[0]) * 0.03, b[1] - (b[1] - a[1]) * 0.03, { color: COLOR.MAGENTA, layer: 'MARK' });
        d.text(a[0], a[1] - th * 1.2, t, { color: COLOR.MAGENTA, h: th, layer: 'MARK' });
        d.text(b[0], b[1] + th * 0.2, t, { color: COLOR.MAGENTA, h: th, layer: 'MARK' });
    }
    // 치수
    const ntop = Math.floor((xm - cv.side) / mt);
    d.dimH(0, cv.side, L, L + th * 3, String(cv.side), { h: th * 0.55 });
    d.dimH(cv.side, cv.side + ntop * mt, L, L + th * 3, `${ntop}@${mt}=${fmtLen(ntop * mt)}`, { h: th * 0.55 });
    const nb = Math.floor((W - cv.side - xm) / mb);
    d.dimH(W - cv.side - nb * mb, W - cv.side, L, L + th * 3, `${nb}@${mb}=${fmtLen(nb * mb)}`, { h: th * 0.55 });
    d.dimH(0, W, L, L + th * 4.6, undefined, { h: th * 0.6 });
    d.dimV(0, L, 0, -th * 4.5, undefined, { h: th * 0.6 });
    // 종단면 B-B (아래)
    const g = sectionGeom(ctx.c, 0);
    const sec = approachSection(ctx.c, D.a, g);
    const oy = -th * 8 - sec.topNear;
    const S = (pts) => pts.map(([x, y]) => [x, y + oy]);
    d.pline(S(sec.slab), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.pline(S(sec.bracket), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.line(0, oy + sec.yBr - 1200, 0, oy + g.Htot, { color: COLOR.CYAN, layer: 'CONC' });
    const yTop = (x) => sec.topAt(x), yBot = (x) => sec.topAt(x) - sec.thick(x);
    const sx = [sec.x0 + cv.side, sec.x1 - cv.side];
    d.line(sx[0], oy + yTop(sx[0]) - cv.top, sx[1], oy + yTop(sx[1]) - cv.top, { color: COLOR.MAGENTA, layer: 'REBAR' });
    d.line(sx[0], oy + yBot(sx[0]) + cv.bottom, sx[1], oy + yBot(sx[1]) + cv.bottom, { color: COLOR.MAGENTA, layer: 'REBAR' });
    const rr = Math.max(12, th * 0.1);
    for (let x = sx[0]; x <= sx[1]; x += ht) d.circle(x, oy + yTop(x) - cv.top - barD(r.main.top.dia), rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
    for (let x = sx[0]; x <= sx[1]; x += hb) d.circle(x, oy + yBot(x) + cv.bottom + barD(r.main.bottom.dia), rr, { color: COLOR.MAGENTA, fill: COLOR.MAGENTA, layer: 'REBAR' });
    if (r.shear.dia) for (let x = sx[0] + 150; x < sx[1]; x += +r.shear.ctc || 300) d.line(x, oy + yBot(x) + cv.bottom - 20, x, oy + yTop(x) - cv.top + 20, { color: tab === 'set' ? COLOR.YELLOW : COLOR.RED, layer: 'REBAR' });
    d.dimH(sec.x0, sec.x1, oy + sec.topFar, oy + Math.max(sec.topNear, sec.topFar) + th * 2, undefined, { h: th * 0.6 });
    d.text((sec.x0 + sec.x1) / 2, oy + yBot(sec.x1) - th * 2.5, `단면 B-B  (접속슬래브 ${i + 1}, ${D.a.side})`, { color: COLOR.WHITE, h: th, valign: 'top', layer: 'TEXT' });
    d.legend = '접속슬래브 배근';
    return d;
}

function checkPopup(ctx) {
    const list = getApproach(ctx.c).list;
    const f = (v, n = 1) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(n));
    const ok = (v) => (v == null ? lbl('-', { align: 'center' }) : lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' }));
    const res = list.map((a, i) => approachCheck(store.project, store.project.culverts[ctx.ci], i));
    const body = h('div', { style: { minWidth: '820px' } });
    new Grid(body, {
        id: 'ap-check',
        head: [[{ t: '구분', rs: 2 }, { t: '단면', cs: 4 }, { t: '휨', cs: 4 }, { t: '전단', cs: 3 }, { t: '균열', cs: 3 }, { t: '받침부', cs: 3 }],
            [{ t: 'L (m)' }, { t: 'H' }, { t: 'd' }, { t: 'As' }, { t: 'Mu' }, { t: 'φMn' }, { t: 'ρ' }, { t: '판정' }, { t: 'Vu' }, { t: 'φVn' }, { t: '판정' }, { t: 'fs' }, { t: '허용' }, { t: '판정' }, { t: 'fb' }, { t: '허용' }, { t: '판정' }]],
        rows: res.map((r, i) => ({
            head: [{ t: `${i + 1} (${list[i].side})` }],
            cells: !r ? [] : [lbl(f(r.L, 2)), lbl(f(r.t, 0)), lbl(f(r.d, 0)), lbl(f(r.As)), lbl(f(r.Mu)), lbl(f(r.flex.phiMn)), lbl(f(r.flex.rho, 4)), ok(r.flex.ok && r.flex.okRho),
                lbl(f(r.Vu)), lbl(f(r.shear.phiVn)), ok(r.shear.ok),
                lbl(r.crack ? f(r.crack.fs) : '-'), lbl(r.crack ? (r.crack.method === '간격' ? `s≤${f(r.crack.sAllow, 0)}` : `w≤${f(r.crack.wa, 3)}`) : '-'), ok(r.crack ? r.crack.ok : null),
                lbl(f(r.bearing.fb, 2)), lbl(f(r.bearing.fbAllow, 2)), ok(r.bearing.ok)],
        })),
    });
    const r0 = res[0];
    if (r0) body.appendChild(h('div', { class: 'note' }, `* 단순보 (경간 = 접속슬래브 길이). 고정하중 wD = ${f(r0.wD, 2)} kN/m² (포장 80 mm 포함), 활하중 후륜 P = ${r0.P} kN, 분포폭 E = ${f(r0.E, 2)} m, 충격계수 i = ${f(r0.imp, 3)}.  `
        + 'Mu = 1.3·MD + 2.15·ML, 균열 = 사용하중 MD + ML, 받침부 = 브래킷 지압 fb = Ru / (브래킷폭 × 1 m) ≤ 0.65·0.85·fck.'));
    modal({ title: '접속슬래브 설계검토', body, buttons: [{ text: '확인', primary: true }], width: 920 });
}
