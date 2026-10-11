// 상세입력 > 난간벽 및 차수벽 (매뉴얼 3.1)
// BOX 형과 지하차도 BOX 구간의 시종점부 난간벽, 차수벽, 잡석채움, 유출입부 접속판

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, chk } from '../ui/cells.js';
import { h, bRadio } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { blocks } from '../core/model.js';
import { drawCulvertPlan, drawCenterLine } from '../draw/planDraw.js';
import { defaultParapet, parapetSide, parapetApplicable } from '../calc/parapetGeom.js';
import { endFrame, wingPlan, installedWings } from '../calc/wingGeom.js';
import { drawWingsPlan } from '../draw/wingDraw.js';

const VIEWS = ['측면', '평면', '모두표현'];
const CY = { color: COLOR.CYAN, layer: 'CONC' };

export function ensureParapet(ctx) {
    const c = ctx.c;
    if (!c.parapet || !c.parapet.ends) {
        store.set(`${ctx.cp}.parapet`, { ...defaultParapet(), ...(c.parapet || {}), ends: defaultParapet().ends }, { record: false, silent: true });
    }
    return store.get(`${ctx.cp}.parapet`);
}

const HINT = {
    cutUse: '차수벽 설치에 대한 유무를 선택합니다.', H: '차수벽 설치시 높이를 입력합니다.',
    CT1: '차수벽 설치시 하단의 두께를 입력합니다.', CT2: '차수벽 설치시 하단의 두께에 상단 이격거리를 입력합니다.',
    apUse: '유출입부 접속판에 대한 설치유무를 선택합니다.', T: '유출입부 접속판의 두께를 입력합니다.',
    S: '유출입부 접속판에 대한 종단경사를 설정합니다. (%)',
    L1: '유출입부 접속판의 평면도상 좌측 길이를 설정합니다.', L2: '유출입부 접속판의 평면도상 우측 길이를 설정합니다.',
    A1: '유출입부 접속판의 평면도상 좌측의 각도를 설정합니다.', A2: '유출입부 접속판의 평면도상 우측의 각도를 설정합니다.',
    rbUse: '유출입부 접속판 하부 잡석채움 설치유무를 선택합니다.', rbT: '잡석채움 두께를 입력합니다.',
    railUse: '난간벽에 대한 설치유무를 선택합니다.', Wh: '난간벽에 대한 높이를 설정합니다.',
    Wt1: '난간벽 상단의 두께를 입력합니다.', Wt2: '난간벽 하단의 두께를 입력합니다.',
};

export default {
    scope: 'culvert',
    enabled: (ctx) => parapetApplicable(ctx.c),
    hint: '설치-시점의 설치 데이터를 입력합니다.',

    tabs: () => [{ id: 'cut', title: '차수벽' }, { id: 'rail', title: '난간벽' }],

    header(el, ctx) {
        ensureParapet(ctx);
        el.appendChild(h('span', { class: 'framed', style: { border: '1px solid #9fb6d8', padding: '1px 6px', borderRadius: '2px' } }, [
            '화면표시 : ',
            bRadio(`${ctx.cp}.parapet.view`, VIEWS),
        ]));
    },

    render(el, ctx, tab) {
        const pp = ensureParapet(ctx);
        const base = `${ctx.cp}.parapet.ends`;
        const rowHead = (i) => [{ t: i === 0 ? '시점' : '종점' }];
        if (tab === 'rail') {
            new Grid(el, {
                id: 'parapet-rail',
                head: [[{ t: '구분', rs: 2 }, { t: '난간벽', cs: 4 }], [{ t: '설치' }, { t: 'Wh' }, { t: 'Wt1' }, { t: 'Wt2' }]],
                rows: [0, 1].map(i => {
                    const p = `${base}.${i}.rail`;
                    const off = !pp.ends[i].rail.use;
                    return {
                        head: rowHead(i),
                        cells: [
                            chk(`${p}.use`, { hint: HINT.railUse }),
                            num(`${p}.Wh`, { disabled: off, field: 'Wh', hint: HINT.Wh }),
                            num(`${p}.Wt1`, { disabled: off, field: 'Wt1', hint: HINT.Wt1 }),
                            num(`${p}.Wt2`, { disabled: off, field: 'Wt2', hint: HINT.Wt2 }),
                        ],
                    };
                }),
                colWidths: [60, 50, 70, 70, 70],
            });
            return;
        }
        new Grid(el, {
            id: 'parapet-cut',
            head: [
                [{ t: '구분', rs: 2 }, { t: '차수벽', cs: 4 }, { t: '유출입부 접속판', cs: 7 }, { t: '잡석채움', cs: 2 }],
                [{ t: '설치' }, { t: 'H' }, { t: 'CT1' }, { t: 'CT2' }, { t: '설치' }, { t: 'T' }, { t: 'S(%)' }, { t: 'L1' }, { t: 'L2' }, { t: 'A1' }, { t: 'A2' }, { t: '설치' }, { t: 'T' }],
            ],
            rows: [0, 1].map(i => {
                const e = pp.ends[i];
                const cp = `${base}.${i}.cut`, ap = `${base}.${i}.apron`, rp = `${base}.${i}.rubble`;
                const cOff = !e.cut.use, aOff = !e.apron.use, rOff = aOff || !(e.rubble && e.rubble.use);
                return {
                    head: rowHead(i),
                    cells: [
                        chk(`${cp}.use`, { hint: HINT.cutUse }),
                        num(`${cp}.H`, { disabled: cOff, field: 'H', hint: HINT.H }),
                        num(`${cp}.CT1`, { disabled: cOff, field: 'CT1', hint: HINT.CT1 }),
                        num(`${cp}.CT2`, { disabled: cOff, field: 'CT2', hint: HINT.CT2 }),
                        chk(`${ap}.use`, { hint: HINT.apUse }),
                        num(`${ap}.T`, { disabled: aOff, field: 'T', hint: HINT.T }),
                        num(`${ap}.S`, { disabled: aOff, field: 'S(%)', hint: HINT.S }),
                        num(`${ap}.L1`, { disabled: aOff, field: 'L1', hint: HINT.L1 }),
                        num(`${ap}.L2`, { disabled: aOff, field: 'L2', hint: HINT.L2 }),
                        num(`${ap}.A1`, { disabled: aOff, field: 'A1', hint: HINT.A1, validate: v => (v > 0 && v < 270 ? null : '각도는 0 ~ 270° 사이로 입력합니다.') }),
                        num(`${ap}.A2`, { disabled: aOff, field: 'A2', hint: HINT.A2, validate: v => (v > 0 && v < 270 ? null : '각도는 0 ~ 270° 사이로 입력합니다.') }),
                        chk(`${rp}.use`, { disabled: aOff, hint: HINT.rbUse }),
                        num(`${rp}.T`, { disabled: rOff, hint: HINT.rbT }),
                    ],
                };
            }),
            colWidths: [50, 45, 60, 60, 60, 45, 60, 60, 70, 70, 60, 60, 45, 60],
        });
        el.appendChild(h('div', { class: 'note' }, '* 차수벽 · 유출입부 접속판 · 잡석채움을 설정합니다. 단위: mm, 경사: %, 각도: ° (평면상 벽체에서 외측으로 잰 각도)'));
    },

    defaults(ctx, tab) {
        const cur = clone(ensureParapet(ctx));
        const d = defaultParapet();
        cur.ends.forEach((e, i) => {
            if (tab === 'rail') e.rail = d.ends[i].rail;
            else { e.cut = d.ends[i].cut; e.apron = d.ends[i].apron; e.rubble = d.ends[i].rubble; }
        });
        store.set(`${ctx.cp}.parapet`, cur);
    },

    draw(ctx) {
        const pp = ensureParapet(ctx);
        const c = ctx.c;
        const g0 = sectionGeom(c, 0);
        const th = Math.max(100, Math.min(350, g0.Htot / 26));
        const view = pp.view || '측면';
        if (view === '평면') return planDrawing(ctx, pp, th);
        const side = sideDrawing(ctx, pp, th);
        if (view === '측면') return side;
        const plan = planDrawing(ctx, pp, th);
        const a = plan.bbox(), b = side.bbox();
        if (a && b) plan.merge(side, a.minX + a.w / 2 - (b.minX + b.w / 2), a.minY - th * 6 - b.maxY);
        return plan;
    },
    viewKey: (ctx) => `parapet|${ctx.ci}|${(ctx.c.parapet && ctx.c.parapet.view) || '측면'}`,
};

// ── 측면도 ───────────────────────────────────────────────────────────

function sideDrawing(ctx, pp, th) {
    const d = new Drawing({ textHeight: th });
    const c = ctx.c;
    const bl = blocks(c);
    const first = drawEndSide(d, c, pp.ends[0], 0, 0, 0, `BLOCK - 1`);
    const bb = d.bbox();
    const d2 = new Drawing({ textHeight: th });
    drawEndSide(d2, c, pp.ends[1], Math.max(0, bl.length - 1), 1, 0, `BLOCK - ${bl.length}`);
    const b2 = d2.bbox();
    if (bb && b2) d.merge(d2, bb.maxX + th * 8 - b2.minX, 0);
    void first;
    return d;
}

/**
 * 단부 측면 (end 0 = 시점: 암거가 오른쪽으로, 1 = 종점: 왼쪽으로)
 */
function drawEndSide(d, c, e, bi, end, ox, blockLabel) {
    const g = sectionGeom(c, bi);
    const th = d.textHeight;
    const dir = end === 0 ? 1 : -1;
    const bl = blocks(c)[bi];
    const Lv = Math.min(Math.max(3000, g.Htot * 1.1), bl ? bl.length * 1000 : 6000);
    const X = (x) => ox + dir * x;
    const P = (pts) => pts.map(([x, y]) => [X(x), y]);
    const s = parapetSide(e, g);
    // 본체
    d.line(X(0), 0, X(0), g.Htot, CY);
    d.line(X(0), g.Htot, X(Lv), g.Htot, CY);
    d.line(X(0), 0, X(Lv), 0, CY);
    d.line(X(0), g.Htot - g.UT, X(Lv), g.Htot - g.UT, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    d.line(X(0), g.LT, X(Lv), g.LT, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    // 파단선
    const zz = th * 0.6;
    d.pline(P([[Lv, -th], [Lv, g.Htot * 0.45], [Lv + zz, g.Htot * 0.5], [Lv - zz, g.Htot * 0.55], [Lv, g.Htot * 0.6], [Lv, g.Htot + th]]), CY);
    // 버림콘크리트
    if (g.lean) {
        const x0 = s.cut ? Math.max(+e.cut.CT1 || 0, (+e.cut.CT1 || 0) + (+e.cut.CT2 || 0)) : -g.lean.w;
        d.pline(P([[x0, 0], [x0, -g.lean.t], [Lv, -g.lean.t]]), CY);
        d.leader([[X(Lv * 0.7), -g.lean.t], [X(Lv * 0.7 + th * 2), -g.lean.t - th * 2.5]], '버림콘크리트', { color: COLOR.GREEN, h: th * 0.7 });
    }
    // 난간벽
    if (s.rail) {
        d.pline(P(s.rail), { ...CY, closed: true });
        const Wh = +e.rail.Wh || 0, t1 = +e.rail.Wt1 || 0;
        d.dimH(X(0), X(t1), g.Htot + Wh, g.Htot + Wh + th * 2.2, undefined, { name: 'Wt1' });
        d.dimV(g.Htot, g.Htot + Wh, X(0), X(-th * 2.2), undefined, { name: 'Wh' });
        d.leader([[X(t1 / 2), g.Htot + Wh * 0.6], [X(t1 + th * 3), g.Htot + Wh + th * 4]], '난간벽', { color: COLOR.GREEN, h: th * 0.7 });
    }
    // 차수벽
    if (s.cut) {
        d.pline(P(s.cut), { ...CY, closed: false });
        const H = +e.cut.H || 0, c1 = +e.cut.CT1 || 0;
        d.dimV(-H, 0, X(0), X(-th * 2.2), undefined, { name: 'H' });
        d.dimH(X(0), X(c1), -H, -H - th * 2.2, undefined, { name: 'CT1' });
        d.leader([[X(c1 / 2), -H * 0.5], [X(c1 + th * 4), -H - th * 3]], '차수벽', { color: COLOR.GREEN, h: th * 0.7 });
    }
    // 유출입부 접속판 + 잡석채움
    if (s.apron) {
        d.pline(P(s.apron), { ...CY, closed: true });
        if (s.rubble) {
            d.pline(P(s.rubble), { ...CY, closed: true });
            d.hatch(P(s.rubble), { color: COLOR.GRAY, pattern: 'dots', layer: 'HATCH', alpha: 0.5 });
            d.leader([[X(-s.apronL * 0.25), (s.rubble[0][1] + s.rubble[3][1]) / 2], [X(-s.apronL * 0.25 - th * 2), s.rubble[3][1] - th * 2]], '잡석채움', { color: COLOR.GREEN, h: th * 0.7 });
        }
        const T = +e.apron.T || 0, S = +e.apron.S || 0;
        const L = s.apronL;
        const yFar = s.apron[1][1];
        // 경사 화살표
        const xa = -L * 0.55, xb = -L * 0.3;
        const ya = g.LT + S / 100 * L * 0.55 + th * 1.2, yb = g.LT + S / 100 * L * 0.3 + th * 1.2;
        const [ax, bx] = [X(xa), X(xb)];
        d.line(bx, yb, ax, ya, { color: COLOR.RED, layer: 'DIM' });
        const ux = (ax - bx), uy = (ya - yb), ul = Math.hypot(ux, uy) || 1;
        d.pline([[ax, ya], [ax - ux / ul * th * 0.6 - uy / ul * th * 0.2, ya - uy / ul * th * 0.6 + ux / ul * th * 0.2], [ax - ux / ul * th * 0.6 + uy / ul * th * 0.2, ya - uy / ul * th * 0.6 - ux / ul * th * 0.2]], { color: COLOR.RED, layer: 'DIM', closed: true, fill: COLOR.RED });
        d.text((ax + bx) / 2, (ya + yb) / 2 + th * 0.3, `S:${S.toFixed(2)}%`, { color: COLOR.GREEN, h: th * 0.7, layer: 'DIM' });
        d.varLabel((ax + bx) / 2, (ya + yb) / 2 + th * 1.2, 'S(%)', { h: th * 0.6 });
        // 길이 (L1/L2 겹쳐쓰기)
        const yd = Math.max(g.LT, yFar) + th * 5;
        d.dimH(Math.min(X(0), X(-L)), Math.max(X(0), X(-L)), Math.max(g.LT, yFar), yd, `L1 = ${fmtLen(+e.apron.L1 || 0)}`);
        d.text((X(0) + X(-L)) / 2, yd - th * 0.35, `L2 = ${fmtLen(+e.apron.L2 || 0)}`, { color: COLOR.GREEN, h: th * 0.64, valign: 'top', layer: 'DIM' });
        d.dimV(yFar - T, yFar, X(-L), X(-L - th * 2.2), undefined, { name: 'T' });
    }
    // 우측 높이 체인
    const xr = X(Lv + th * 3);
    const ys = [];
    if (g.lean) ys.push(-g.lean.t);
    ys.push(0, g.LT, g.Htot - g.UT, g.Htot);
    for (let i = 0; i < ys.length - 1; i++) d.dimV(ys[i], ys[i + 1], X(Lv), xr);
    // BLOCK 표시
    const yb = -Math.max(g.lean ? g.lean.t : 0, s.cut ? (+e.cut.H || 0) : 0) - th * 6;
    const xc = X(Lv / 2);
    const w = th * 5.5;
    d.rect(xc - w / 2, yb - th * 0.6, w, th * 1.6, { color: COLOR.GREEN, layer: 'TEXT' });
    d.text(xc, yb - th * 0.1, blockLabel, { color: COLOR.GREEN, h: th * 0.8, valign: 'bottom', layer: 'TEXT' });
    d.text(xc, yb - th * 2.4, end === 0 ? '시점부 측면' : '종점부 측면', { color: COLOR.GREEN, h: th * 0.7, layer: 'TEXT' });
}

// ── 평면도 ───────────────────────────────────────────────────────────

function planDrawing(ctx, pp, th) {
    const p = ctx.p, c = ctx.c;
    const d = new Drawing({ textHeight: th });
    drawCenterLine(d, p, c, 8);
    drawCulvertPlan(d, p, c, { dims: false });
    drawWingsPlan(d, p, c, { dims: false });
    const wings = new Set(installedWings(c).map(w => w.key));
    ['S', 'E'].forEach((end, i) => {
        const e = pp.ends[i];
        const F = endFrame(p, c, end);
        const T = F.toG;
        const din = end === 'S' ? 1 : -1;
        const g = F.g;
        const edge = (du) => [T(F.endU(F.vL) + du, F.vL), T(F.endU(F.vR) + du, F.vR)];
        if (e.rail && e.rail.use) {
            const t2 = +e.rail.Wt2 || +e.rail.Wt1 || 0;
            const [a, b] = edge(din * t2);
            d.line(...a, ...b, CY);
            d.text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + th * 0.3, '난간벽', { color: COLOR.GREEN, h: th * 0.6, layer: 'TEXT', rot: 0 });
        }
        if (e.cut && e.cut.use) {
            const w = (+e.cut.CT1 || 0) + Math.max(0, +e.cut.CT2 || 0);
            const [a, b] = edge(din * w);
            d.line(...a, ...b, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        }
        if (e.apron && e.apron.use) {
            const kL = end + 'L', kR = end + 'R';
            const vFL = wings.has(kL) ? wingPlan(p, c, kL, { frame: F }).vF : F.vL + g.WL;
            const vFR = wings.has(kR) ? wingPlan(p, c, kR, { frame: F }).vF : F.vR - g.WR;
            const A1 = (+e.apron.A1 || 90) * Math.PI / 180, A2 = (+e.apron.A2 || 90) * Math.PI / 180;
            const dL = end === 'S' ? [Math.cos(A1), -Math.sin(A1)] : [-Math.cos(A1), -Math.sin(A1)];
            const dR = end === 'S' ? [Math.cos(A2), Math.sin(A2)] : [-Math.cos(A2), Math.sin(A2)];
            const pL = [F.endU(vFL), vFL], pR = [F.endU(vFR), vFR];
            const L1 = +e.apron.L1 || 0, L2 = +e.apron.L2 || 0;
            const qL = [pL[0] + dL[0] * L1, pL[1] + dL[1] * L1], qR = [pR[0] + dR[0] * L2, pR[1] + dR[1] * L2];
            const pts = [pL, qL, qR, pR].map(q => T(q[0], q[1]));
            d.pline(pts, { ...CY, closed: false });
            d.dimA(pts[0], pts[1], (end === 'S' ? -1 : 1) * th * 1.8, fmtLen(L1), {});
            d.dimA(pts[3], pts[2], (end === 'S' ? 1 : -1) * th * 1.8, fmtLen(L2), {});
            const m = T((qL[0] + qR[0] + pL[0] + pR[0]) / 4, (qL[1] + qR[1] + pL[1] + pR[1]) / 4);
            d.text(m[0], m[1], '유출입부 접속판', { color: COLOR.GREEN, h: th * 0.7, valign: 'middle', layer: 'TEXT' });
        }
    });
    return d;
}
