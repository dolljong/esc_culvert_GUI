// 상세입력 > 접속 슬래브 (매뉴얼 3.4)
// [접속슬래브 | 브래킷/DOWEL BAR], 기본값[아스콘]/[콘크리트], 전체설치, 추가, 삭제

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl } from '../ui/cells.js';
import { h, button, confirmBox, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { REBAR_DIAS, jointStations } from '../core/model.js';
import { drawCulvertPlan, drawCenterLine } from '../draw/planDraw.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import {
    AP_SIDES, DOWEL_TYPES, defaultApproach, defaultApproachSlab, approachAll, approachPlan, approachSection,
} from '../calc/approachGeom.js';

const selRow = new Map();   // 암거 index → 선택 행

export function ensureApproach(ctx) {
    const c = ctx.c;
    if (!c.approach || !Array.isArray(c.approach.list)) {
        store.set(`${ctx.cp}.approach`, defaultApproach(c), { record: false, silent: true });
    }
    return store.get(`${ctx.cp}.approach`);
}

function curRow(ctx) {
    const list = (ctx.c.approach && ctx.c.approach.list) || [];
    const r = selRow.get(ctx.ci) ?? 0;
    return Math.max(0, Math.min(list.length - 1, r));
}

const HINT = {
    side: '암거진행방향을 기준으로 접속슬래브 설치부분을 선택합니다. (좌측, 우측)',
    ref: '접속슬래브의 좌우가 설치되는 기준위치를 설정합니다. ([구간 설정]의 위치 번호)',
    off: '기준위치에서부터 떨어진 거리를 입력합니다. (mm)',
    ang: '기준위치에서 접속슬래브 좌,우간의 각도를 설정합니다. (°)',
    L: '접속슬래브 종단상 길이를 입력합니다. (mm)', H1: '접속슬래브 끝단(시점)의 두께를 입력합니다.', H2: '접속슬래브 브래킷쪽(종점)의 두께를 입력합니다.',
    S: '접속슬래브에 대한 종단경사를 입력합니다. (%)', St: '구조물 벽체에서 접속슬래브와의 이격거리를 입력합니다.', GH: 'GH (매뉴얼 설명 없음)',
    bD: '평면상 기준위치로부터 브래킷 설치위치에 대해 설정합니다. (mm)', bH: '벽체상단에서 브래킷상단까지의 수직이격거리를 입력합니다.',
    bH2: '브래킷 수직부 높이', bH3: '브래킷 경사부 높이', bW: '벽체에서 브래킷 돌출길이를 입력합니다.',
    dType: '교량타입/암거타입에 대해 설정합니다. 선택에 따라 다웰바 상세가 달라집니다.', dia: '다웰바 직경', ctc: '다웰바 간격 (mm)', len: '다웰바 길이 (mm)',
};

export default {
    scope: 'culvert',
    hint: '위치',

    tabs: () => [{ id: 'slab', title: '접속슬래브' }, { id: 'bracket', title: '브래킷/DOWEL BAR' }],

    render(el, ctx, tab) {
        const ap = ensureApproach(ctx);
        const lp = `${ctx.cp}.approach.list`;
        const n = jointStations(ctx.c).length;
        const refs = Array.from({ length: n }, (_, i) => i + 1);
        const onSelect = (cell, r) => {
            if (selRow.get(ctx.ci) !== r) { selRow.set(ctx.ci, r); ctx.redraw(); }
        };
        if (!ap.list.length) {
            el.appendChild(h('div', { class: 'note' }, '설치된 접속슬래브가 없습니다. [추가] 또는 [전체설치]를 누르십시오.'));
            return;
        }
        if (tab === 'bracket') {
            new Grid(el, {
                id: 'ap-bracket', onSelect,
                head: [
                    [{ t: '구분', rs: 2 }, { t: '위치', rs: 2 }, { t: '브래킷', cs: 6 }, { t: 'DOWEL BAR', cs: 4 }],
                    [{ t: 'bD1' }, { t: 'bD2' }, { t: 'bH1' }, { t: 'bH2' }, { t: 'bH3' }, { t: 'bW' }, { t: '형식' }, { t: '직경' }, { t: 'CTC' }, { t: '길이' }],
                ],
                rows: ap.list.map((a, i) => {
                    const bp = `${lp}.${i}.bracket`, dp = `${lp}.${i}.dowel`;
                    return {
                        cells: [
                            lbl(i + 1, { align: 'center' }), lbl(a.side, { cls: 'ro', align: 'center' }),
                            num(`${bp}.bD1`, { field: 'bD1', hint: HINT.bD }), num(`${bp}.bD2`, { field: 'bD2', hint: HINT.bD }),
                            num(`${bp}.bH1`, { field: 'bH1', hint: HINT.bH }), num(`${bp}.bH2`, { field: 'bH2', hint: HINT.bH2 }),
                            num(`${bp}.bH3`, { field: 'bH3', hint: HINT.bH3 }), num(`${bp}.bW`, { field: 'bW', hint: HINT.bW }),
                            sel(`${dp}.type`, DOWEL_TYPES, { hint: HINT.dType }), sel(`${dp}.dia`, REBAR_DIAS, { hint: HINT.dia }),
                            num(`${dp}.ctc`, { hint: HINT.ctc }), num(`${dp}.len`, { hint: HINT.len }),
                        ],
                    };
                }),
                colWidths: [40, 50, 60, 60, 60, 60, 60, 60, 80, 60, 60, 60],
            });
            return;
        }
        new Grid(el, {
            id: 'ap-slab', onSelect,
            head: [
                [{ t: '구분', rs: 2 }, { t: '위치', rs: 2 }, { t: '시점', cs: 3 }, { t: '종점', cs: 3 }, { t: '단면제원', cs: 7 }, { t: 'GH', rs: 2 }],
                [{ t: '기준위치' }, { t: '이격거리' }, { t: '각도' }, { t: '기준위치' }, { t: '이격거리' }, { t: '각도' },
                    { t: 'L1' }, { t: 'L2' }, { t: 'L3' }, { t: 'H1' }, { t: 'H2' }, { t: 'S(%)' }, { t: 'St' }],
            ],
            rows: ap.list.map((a, i) => {
                const p = `${lp}.${i}`;
                const angV = v => (v > 0 && v < 180 ? null : '각도는 0~180° 사이로 입력합니다.');
                return {
                    cells: [
                        lbl(i + 1, { align: 'center' }),
                        sel(`${p}.side`, AP_SIDES, { hint: HINT.side }),
                        sel(`${p}.s.ref`, refs, { hint: HINT.ref }), num(`${p}.s.off`, { dec: 0, hint: HINT.off }), num(`${p}.s.ang`, { dec: 0, hint: HINT.ang, validate: angV }),
                        sel(`${p}.e.ref`, refs, { hint: HINT.ref }), num(`${p}.e.off`, { dec: 0, hint: HINT.off }), num(`${p}.e.ang`, { dec: 0, hint: HINT.ang, validate: angV }),
                        num(`${p}.L1`, { field: 'L1', hint: HINT.L }), num(`${p}.L2`, { field: 'L2', hint: HINT.L }), num(`${p}.L3`, { field: 'L3', hint: HINT.L }),
                        num(`${p}.H1`, { field: 'H1', hint: HINT.H1 }), num(`${p}.H2`, { field: 'H2', hint: HINT.H2 }),
                        num(`${p}.S`, { dec: 2, field: 'S', hint: HINT.S }), num(`${p}.St`, { field: 'St', hint: HINT.St }),
                        num(`${p}.GH`, { hint: HINT.GH }),
                    ],
                };
            }),
            colWidths: [40, 60, 60, 70, 50, 60, 70, 50, 60, 50, 50, 50, 50, 60, 50, 60],
        });
    },

    footer(el, ctx) {
        el.appendChild(button('기본값[콘크리트](C)', async () => {
            const ok = await confirmBox('프로그램 내부의 기본값[콘크리트]으로 다시 설정합니다.\n기존에 입력되어 있는 수치는 무시됩니다.\n계속하시겠습니까?', '기본값');
            if (ok) store.set(`${ctx.cp}.approach`, defaultApproach(ctx.c, '콘크리트'));
        }, { title: '콘크리트 포장 기본값 (기본값(D) = 아스콘)' }));
        el.appendChild(button('전체설치', () => store.set(`${ctx.cp}.approach`, approachAll(ctx.c)), { title: '각 블록별 좌우에 각각 접속슬래브를 설치합니다.' }));
        el.appendChild(button('추가', () => {
            const list = clone((ctx.c.approach && ctx.c.approach.list) || []);
            const src = list[curRow(ctx)];
            list.push(src ? clone(src) : defaultApproachSlab(ctx.c));
            selRow.set(ctx.ci, list.length - 1);
            store.set(`${ctx.cp}.approach.list`, list);
        }));
        el.appendChild(button('삭제', () => {
            const list = clone((ctx.c.approach && ctx.c.approach.list) || []);
            if (!list.length) { alertBox('삭제할 접속슬래브가 없습니다.', '접속 슬래브'); return; }
            list.splice(curRow(ctx), 1);
            store.set(`${ctx.cp}.approach.list`, list);
        }));
    },

    defaultsLabel: '기본값[아스콘](S)',
    defaults(ctx) {
        store.set(`${ctx.cp}.approach`, defaultApproach(ctx.c, '아스콘'));
    },

    draw(ctx) {
        const ap = ensureApproach(ctx);
        const p = ctx.p, c = ctx.c;
        const th = sectionTextHeight(c, 0);
        const d = new Drawing({ textHeight: th });
        drawCenterLine(d, p, c, 8);
        drawCulvertPlan(d, p, c, { dims: false });
        const cur = curRow(ctx);
        ap.list.forEach((a, i) => {
            const pl = approachPlan(p, c, a);
            d.pline(pl.poly, { color: i === cur ? COLOR.CYAN : COLOR.SKY, layer: 'APPROACH', closed: true });
            d.pline(pl.inner, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
            d.bubble(pl.center[0], pl.center[1], String(i + 1), { color: COLOR.GREEN, r: th * 0.8 });
        });
        if (!ap.list.length) return d;
        // 선택된 접속슬래브 종단 상세
        const dS = new Drawing({ textHeight: th });
        drawApproachSection(dS, c, ap.list[cur], cur);
        const a = d.bbox(), b = dS.bbox();
        if (a && b) d.merge(dS, a.minX + a.w / 2 - (b.minX + b.w / 2), a.minY - th * 5 - b.maxY);
        return d;
    },
    viewKey: (ctx) => `approach|${ctx.ci}|${curRow(ctx)}`,
};

/** 접속슬래브 종단 상세 (구조물 단면 + 브래킷 + 슬래브) */
export function drawApproachSection(d, c, a, idx = 0) {
    const th = d.textHeight;
    const g = sectionGeom(c, 0);
    const left = a.side !== '우측';
    const s = approachSection(c, a, g);
    // x' (외면에서 바깥 +) → 단면 x
    const X = (x) => (left ? -x : g.W + x);
    const T = (pts) => pts.map(([x, y]) => [X(x), y]);
    drawSection(d, c, 0, { simple: true });
    d.pline(T(s.bracket), { color: COLOR.CYAN, layer: 'CONC' });
    d.pline(T(s.slab), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    const b = a.bracket || {};
    const dw = a.dowel || {};
    const bH1 = +b.bH1 || 0, bH2 = +b.bH2 || 0, bH3 = +b.bH3 || 0, bW = +b.bW || 0;
    // 다웰바 (빨간 선)
    const yD = s.yBr + (+a.H2 || 0) / 2;
    const dl = Math.min(+dw.len || 1000, (s.x1 - s.x0) * 0.4);
    d.line(X(s.x0 + dl / 2), yD, X(Math.max(0, s.x0 - dl / 2)), yD, { color: COLOR.RED, layer: 'REBAR', width: 2 });
    d.leader([[X(s.x0 + dl * 0.2), yD], [X(s.x0 + dl * 0.2 + th * 3), s.topNear + th * 3]], `다웰바 ${dw.dia || ''}@${dw.ctc || ''}`, { color: COLOR.GREEN, h: th * 0.7 });
    // 치수
    const yTop = Math.max(s.topNear, s.topFar, g.Htot) + th * 3;
    d.dimH(X(s.x0), X(s.x1), Math.max(s.topNear, s.topFar), yTop);
    d.dimH(X(0), X(s.x0), s.topNear, yTop, undefined, { name: 'St' });
    const yBot = Math.min(s.topFar - (+a.H1 || 0), s.yBr - bH2 - bH3) - th * 3;
    d.dimH(X(s.x0), X(s.x0 + (+a.L1 || 0)), s.topFar - (+a.H1 || 0), yBot, undefined, { name: 'L1' });
    if (+a.L2 > 0) d.dimH(X(s.x0 + (+a.L1 || 0)), X(s.x0 + (+a.L1 || 0) + (+a.L2)), s.topFar - (+a.H1 || 0), yBot, undefined, { name: 'L2' });
    if (+a.L3 > 0) d.dimH(X(s.x0 + (+a.L1 || 0) + (+a.L2 || 0)), X(s.x1), s.topFar - (+a.H1 || 0), yBot, undefined, { name: 'L3' });
    d.dimV(s.topFar - (+a.H1 || 0), s.topFar, X(s.x1), X(s.x1 + th * 2.4), undefined, { name: 'H1' });
    d.dimV(s.yBr, s.topNear, X(s.x0 + th * 0.2), X(s.x0 + th * 2.4), undefined, { name: 'H2' });
    // 브래킷 체인 (벽체 안쪽)
    const xc = X(-th * 2.4 - (left ? g.WL : g.WR));
    d.dimV(g.Htot - bH1, g.Htot, X(0), xc, undefined, { name: 'bH1' });
    d.dimV(g.Htot - bH1 - bH2, g.Htot - bH1, X(0), xc, undefined, { name: 'bH2' });
    if (bH3 > 0) d.dimV(g.Htot - bH1 - bH2 - bH3, g.Htot - bH1 - bH2, X(0), xc, undefined, { name: 'bH3' });
    d.dimH(X(0), X(bW), s.yBr - bH2, s.yBr - bH2 - bH3 - th * 2, undefined, { name: 'bW' });
    // 경사
    const xm = (s.x0 + s.x1) / 2;
    d.text(X(xm), s.topAt(xm) + th * 0.6, `S:${(+a.S || 0).toFixed(2)}%`, { color: COLOR.GREEN, h: th * 0.75, layer: 'DIM' });
    d.text(X(xm), yBot - th * 4.5, `접속${idx + 1} : ${a.side}`, { color: COLOR.GREEN, h: th * 1.4, layer: 'TEXT' });
}
