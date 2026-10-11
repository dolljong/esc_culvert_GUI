// 배근 입력 > 전단 철근 (매뉴얼 5.9)
// 부재(상부/하부/중간 슬래브, 좌·우측 벽체)별 전단철근 배치구간 '개수@간격' 과 직경·타입·주철근 구간수.
// 데이터/계산: calc/shearBars.js (culverts[i].rebar.shear[bi], .shearSet[bi], .shearForce)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl } from '../ui/cells.js';
import { h, button, bCheck, bSelect, bNumber, modal } from '../ui/dom.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { drawBars, drawDots, drawForceDiagram, OTHER_COLOR, BAR_COLOR } from '../draw/rebarDraw.js';
import { drawBarShape } from '../draw/barShapes.js';
import { DIAS, mainBarLayout, coverOf, pointAt, getRebarCommon } from '../calc/rebar.js';
import { horzLayout } from '../calc/rebarHorz.js';
import { loadFrame, memberForces } from '../calc/rebarForces.js';
import {
    SHEAR_TYPES, SHEAR_ROWS, N_MAIN, defaultShearSet, getShearSet, shearMembers, defaultShearFace, getShearFace, shearLayout, shearCheck,
} from '../calc/shearBars.js';
import { ensureSettings, ensure, liveModal, sameBlockPopup, sameKindBlocks } from './rebarSet.js';

const ui = { sel: null };
const FORCE = { on: false, state: '평상시', diag: 'SFD' };
const shPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.shear.${bi}`;
const setPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.shearSet.${bi}`;

function ensureShear(ctx) {
    ensureSettings(ctx);
    ensure(shPath(ctx), () => ({ std: 300, sameSpacing: false, faces: {} }));
    ensure(setPath(ctx), defaultShearSet);
    ensure(`${ctx.cp}.rebar.shearForce`, () => ({ ...FORCE }));
}

function memberOf(ctx, tab) {
    const g = sectionGeom(ctx.c, ctx.bi);
    const ms = shearMembers(g);
    return { g, mem: ms.find(m => m.key === tab) || ms[0] };
}

function facePath(ctx, member) {
    const p = `${shPath(ctx)}.faces.${member}`;
    if (store.get(p) == null) store.set(p, getShearFace(ctx.c, ctx.bi, member), { record: false, silent: true });
    return p;
}

function setSegCount(ctx, member, n) {
    const p = facePath(ctx, member);
    const f = clone(store.get(p));
    n = Math.max(1, Math.min(60, n | 0));
    const std = store.get(`${shPath(ctx)}.std`) || 300;
    while (f.segs.length > n) f.segs.pop();
    while (f.segs.length < n) f.segs.push({ n: 1, s: std });
    store.set(p, f);
}

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '전단철근의 배치구간별 개수와 간격을 입력합니다.',

    tabs(ctx) {
        const g = sectionGeom(ctx.c, ctx.bi);
        return shearMembers(g).map(m => ({ id: m.key, title: m.title }));
    },

    header(el, ctx) {
        ensureShear(ctx);
        const { mem } = memberOf(ctx, ctx.tab);
        el.appendChild(bNumber(`${shPath(ctx)}.std`, { label: '표준배치간격', dec: 0, width: 50 }));
        const p = facePath(ctx, mem.key);
        const cur = (store.get(p).segs || []).length;
        const s = h('select', {});
        for (let i = 1; i <= 60; i++) { const o = h('option', { value: i }, `${i}구간`); if (i === cur) o.selected = true; s.appendChild(o); }
        s.addEventListener('change', () => setSegCount(ctx, mem.key, +s.value));
        el.appendChild(h('label', {}, ['전단배치 ', s]));
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [button('전단철근 설정(B)', () => settingsPopup(ctx))]));
    },

    render(el, ctx, tab) {
        ensureShear(ctx);
        const { g, mem } = memberOf(ctx, tab);
        const path = facePath(ctx, mem.key);
        const data = store.get(path);
        const L = mem.seg;
        const hint = `[${mem.title}] 간격을 입력합니다.`;
        new Grid(el, {
            id: `shear-${mem.key}`,
            head: [[{ t: '구분' }, ...data.segs.map((_, k) => ({ t: `${L}${k + 1}` }))]],
            rows: [
                { head: [{ t: '개수' }], cells: data.segs.map((_, k) => num(`${path}.segs.${k}.n`, { dec: 0, hint: `${L}${k + 1} 구간 전단철근 개수`, validate: v => (v >= 0 ? null : '개수는 0 이상') })) },
                { head: [{ t: '간격' }], cells: data.segs.map((_, k) => num(`${path}.segs.${k}.s`, { dec: 0, field: `${L}${k + 1}`, hint, validate: v => (v >= 0 ? null : '간격은 0 이상') })) },
            ],
            onSelect: (cell, r, c) => { ui.sel = { member: mem.key, col: c }; ctx.redraw(); },
        });
        const lay = shearLayout(ctx.p, ctx.c, ctx.bi);
        const M = lay.members.find(m => m.member === mem.key);
        const sum = data.segs.reduce((s, x) => s + (x.n | 0) * (+x.s || 0), 0);
        const span = (M && Math.max(M.lineA.s1, M.lineB.s1)) || 0;
        el.appendChild(h('div', { class: 'note' }, [
            `* 기준위치(${mem.kind === 'slab' ? '좌측벽체 내면' : '상부슬래브 하면'})부터 배치 합계 ${sum} mm / 부재 ${Math.round(span)} mm.`,
            M ? `  ${M.cfg.dia} ${M.cfg.type}, 주철근 ${M.cfg.nMain}구간 (길이방향 ${Math.round(M.pitch)} mm 마다 ${M.perPos}개) → 단면 ${M.ties.length}개 × ${M.perPos} = ${M.ties.length * M.perPos} EA` : '',
        ]));
        void g;
    },

    footer(el, ctx, tab) {
        el.appendChild(button('전체기본값', () => store.transact(() => regenerate(ctx, null)), { title: '모든 부재를 표준배치간격으로 다시 배치' }));
        el.appendChild(button('모든 블럭 동일 적용', () => sameBlocks(ctx, tab), { disabled: ctx.blocks.length < 2 }));
        el.appendChild(button('구간추가', () => { const { mem } = memberOf(ctx, tab); setSegCount(ctx, mem.key, store.get(facePath(ctx, mem.key)).segs.length + 1); }));
        el.appendChild(button('구간삭제', () => { const { mem } = memberOf(ctx, tab); setSegCount(ctx, mem.key, store.get(facePath(ctx, mem.key)).segs.length - 1); }));
        el.appendChild(button('설계검토', () => checkPopup(ctx)));
        const fp = `${ctx.cp}.rebar.shearForce`;
        const fv = store.get(fp) || FORCE;
        el.appendChild(bCheck(`${fp}.on`, '', { title: '부재력보기', onChange: (v) => { store.set(`${fp}.on`, v); if (v) loadFrame(() => ctx.redraw()); } }));
        el.appendChild(bSelect(`${fp}.state`, ['평상시', '지진시'], { disabled: !fv.on }));
        el.appendChild(bSelect(`${fp}.diag`, ['BMD', 'SFD'], { disabled: !fv.on }));
        el.appendChild(bCheck(`${shPath(ctx)}.sameSpacing`, ' 인장, 압축구간을 동일간격으로 배치', { title: '기본값 생성 시: 체크 = 모두 표준간격, 해제 = 지점부(인장구간)는 표준간격/2' }));
    },

    defaults(ctx, tab) { regenerate(ctx, tab); },

    draw(ctx, tab) {
        const p = ctx.p, c = ctx.c, bi = ctx.bi;
        const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
        const th = d.textHeight;
        drawSection(d, c, bi, { simple: true });
        const lay = mainBarLayout(p, c, bi, { cycles: [1], layers: [1] });
        drawBars(d, lay, lay.bars, { color: OTHER_COLOR, lapOffset: 0 });
        const hl = horzLayout(p, c, bi);
        for (const f of hl.faces) drawDots(d, f.dots.map(x => ({ pt: x.pt, color: COLOR.RED })), Math.max(10, th * 0.08));
        const sl = shearLayout(p, c, bi);
        const pre = getRebarCommon(p).marks.shear || 'S';
        sl.members.forEach((M) => {
            const cur = M.member === tab;
            for (const t of M.ties) {
                const u = [t.p1[0] - t.p0[0], t.p1[1] - t.p0[1]];
                const L = Math.hypot(...u) || 1;
                const e = M.ds;
                d.line(t.p0[0] - u[0] / L * e, t.p0[1] - u[1] / L * e, t.p1[0] + u[0] / L * e, t.p1[1] + u[1] / L * e, { color: cur ? BAR_COLOR : OTHER_COLOR, layer: 'REBAR' });
            }
        });
        const M = sl.members.find(m => m.member === tab);
        if (M) {
            chainFor(d, M, sl);
            const no = sl.members.filter(m => m.ties.length).indexOf(M) + 1;
            if (M.ties.length) {
                const i = Math.floor(M.ties.length / 3);
                const a = M.ties[i].p0;
                const out = [-M.lineA.inward[0], -M.lineA.inward[1]];
                const q = [a[0] + out[0] * th * 2.5 + (M.lineA.axis === 'x' ? th * 2 : 0), a[1] + out[1] * th * 2.5 - (M.lineA.axis === 'y' ? th * 2 : 0)];
                for (const k of [-1, 0, 1]) {
                    const tt = M.ties[Math.max(0, Math.min(M.ties.length - 1, i + k * 2))];
                    const mid = [(tt.p0[0] + tt.p1[0]) / 2, (tt.p0[1] + tt.p1[1]) / 2];
                    d.line(q[0], q[1], mid[0], mid[1], { color: COLOR.RED, layer: 'MARK' });
                }
                d.bubble(q[0], q[1], `${pre}${no}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
                d.text(q[0] + th, q[1], M.cfg.dia, { color: COLOR.GREEN, h: th * 0.65, align: 'left', valign: 'middle', layer: 'MARK' });
            }
            // 형상 상세 (오른쪽)
            drawBarShape(d, { shape: M.shape, dims: M.dims, dia: M.cfg.dia, mark: `${pre}${no}`, count: M.ties.length * M.perPos }, { x: sl.g.W + th * 6, y: sl.g.Htot * 0.55, w: Math.max(1500, sl.g.W * 0.18), th: th * 0.8 });
        }
        const fv = store.get(`${ctx.cp}.rebar.shearForce`) || FORCE;
        if (fv.on && loadFrame(() => ctx.redraw()) === 'ready') {
            const forces = memberForces(p, c, bi, { state: fv.state, diag: fv.diag });
            if (forces) drawForceDiagram(d, sl.g, forces);
        }
        d.legend = '전단철근';
        return d;
    },
    viewKey: (ctx) => `shearRebar|${ctx.ci}|${ctx.bi}`,
};

/** 구간 치수 체인 (U1, U2 … / n@간격), 선택 셀은 흰 사각형 */
function chainFor(d, M, sl) {
    const th = d.textHeight;
    const L = M.lineA;
    const out = [-L.inward[0], -L.inward[1]];
    const cov = coverOf(sl.st, M.member, L.face, 1);
    const dist = cov + th * 4.5;
    const lab = shearMembers(sl.g).find(m => m.key === M.member).seg;
    const ax = (s) => { const q = pointAt(L.path, s - L.s0).pt; return L.axis === 'x' ? q[0] : q[1]; };
    const ref = pointAt(L.path, -L.s0).pt;
    let s = 0;
    M.f.segs.forEach((sg, k) => {
        const e = s + (sg.n | 0) * (+sg.s || 0);
        if (e - s > 1e-6) {
            const a = ax(s), b = ax(e);
            const text = (sg.n | 0) > 1 ? `${sg.n}@${sg.s}` : String(sg.s);
            const selOn = ui.sel && ui.sel.member === M.member && ui.sel.col === k;
            if (L.axis === 'x') {
                const yR = ref[1] + out[1] * cov, yD = ref[1] + out[1] * dist;
                d.dimH(a, b, yR, yD, text, { name: `${lab}${k + 1}`, h: th * 0.6 });
                if (selOn) d.rect(Math.min(a, b), yD - th * 0.8, Math.abs(b - a), th * 1.6, { color: COLOR.WHITE, layer: 'SEL' });
            } else {
                const xR = ref[0] + out[0] * cov, xD = ref[0] + out[0] * dist;
                d.dimV(a, b, xR, xD, text, { name: `${lab}${k + 1}`, h: th * 0.6 });
                if (selOn) d.rect(xD - th * 0.8, Math.min(a, b), th * 1.6, Math.abs(b - a), { color: COLOR.WHITE, layer: 'SEL' });
            }
        }
        s = e;
    });
}

function regenerate(ctx, tab) {
    const g = sectionGeom(ctx.c, ctx.bi);
    const sh = store.get(shPath(ctx)) || {};
    for (const m of shearMembers(g)) {
        if (tab && m.key !== tab) continue;
        store.set(`${shPath(ctx)}.faces.${m.key}`, defaultShearFace(g, m.key, sh.std || 300, !!sh.sameSpacing));
    }
}

function sameBlocks(ctx, tab) {
    const targets = sameKindBlocks(ctx);
    sameBlockPopup(() => {
        const s = clone(store.get(shPath(ctx))), ss = clone(store.get(setPath(ctx)));
        for (const b of targets) { store.set(shPath(ctx, b), clone(s)); store.set(setPath(ctx, b), clone(ss)); }
    }, () => {
        const s = store.get(`${shPath(ctx)}.faces.${tab}`);
        for (const b of targets) store.set(`${shPath(ctx, b)}.faces.${tab}`, clone(s));
    });
}

const TYPE_NOTE = {
    캡형: '캡형: 상부 폭 A, 좌측 높이 B, 우측 캡 C = 100',
    겹침형: '겹침형: 폭 A, 높이 B, 겹침 C (이음장)',
    ㄷ형: 'ㄷ형: 높이 A, 상·하 다리 B, C',
    꺽인ㄷ형: '꺽인ㄷ형: 폭 A, 높이 B, 하부 다리 C',
    '캡형(정착장)': '캡형(정착장): 캡형과 같고 C = 정착장',
    간격재: '간격재: ㄷ형과 같으나 A 는 주철근을 감싸지 않는 길이',
};

function settingsPopup(ctx) {
    const sp = setPath(ctx);
    const snap = clone(store.get(sp));
    liveModal('전단철근 설정', (body) => {
        new Grid(body, {
            id: 'shear-set',
            head: [[{ t: '구 분' }, { t: '직 경' }, { t: '타 입' }, { t: '주철근 구간수' }]],
            rows: SHEAR_ROWS.map(([k, t]) => ({
                head: [{ t }],
                cells: [
                    sel(`${sp}.rows.${k}.dia`, DIAS, { hint: `${t} 전단철근 직경` }),
                    sel(`${sp}.rows.${k}.type`, SHEAR_TYPES, { hint: TYPE_NOTE[store.get(`${sp}.rows.${k}.type`)] || '전단철근 형태' }),
                    sel(`${sp}.rows.${k}.nMain`, N_MAIN, { hint: '전단철근 하나가 감싸는 주철근 구간 수 (길이방향)' }),
                ],
            })),
            colWidths: [90, 70, 110, 90],
        });
        const fs = h('fieldset', { style: { margin: '6px 4px', padding: '4px 8px' } }, [h('legend', {}, '헌치철근 적용'),
            bCheck(`${sp}.haunch.top`, ' 상부 슬래브'), ' ', bCheck(`${sp}.haunch.bottom`, ' 하부 슬래브')]);
        body.appendChild(fs);
        body.appendChild(h('div', { class: 'note' }, Object.values(TYPE_NOTE).map(t => h('div', {}, '· ' + t))));
        body.appendChild(h('div', { class: 'inline-opts' }, [
            button('기본값(D)', () => store.set(sp, defaultShearSet())),
            button('모든 블럭 동일 적용', () => {
                const s = clone(store.get(sp));
                store.transact(() => { for (const b of ctx.blocks) if (b.index !== ctx.bi) store.set(setPath(ctx, b.index), clone(s)); });
            }, { disabled: ctx.blocks.length < 2 }),
        ]));
    }, { buttons: [{ text: '확인(O)', primary: true }, { text: '취소(C)', onClick: () => store.set(sp, snap) }], minWidth: 420 });
}

async function checkPopup(ctx) {
    const p = store.project, c = p.culverts[ctx.ci];
    let df = null, err = null;
    try { df = (await import('../calc/designForces.js')).designForces(p, c, 0); } catch (e) { err = e; }
    const rows = shearCheck(p, c, ctx.bi, df);
    const body = h('div', { style: { minWidth: '820px' } });
    if (!df) body.appendChild(h('div', { class: 'note', style: { color: '#c00' } }, `* 2D Frame 해석 결과를 얻지 못했습니다${err ? ` (${err.message})` : ''}. 전단강도만 표시합니다.`));
    const f1 = (v) => (v == null || !isFinite(v) ? '-' : v.toFixed(1));
    const f0 = (v) => (v == null || !isFinite(v) ? '-' : Math.round(v));
    const ok = (v) => (v == null ? lbl('-', { align: 'center' }) : lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' }));
    let prev = null;
    const cnt = (t) => rows.filter(r => r.title === t).length;
    new Grid(body, {
        id: 'shear-check',
        head: [
            [{ t: '구분', cs: 2, rs: 2 }, { t: '설계전단력 / 전단강도 (kN)', cs: 5 }, { t: '간격 (mm)', cs: 3 }, { t: '최소전단철근 (mm²)', cs: 3 }],
            [{ t: 'Vu' }, { t: 'φVc' }, { t: 'φVs' }, { t: 'φVn' }, { t: '판정' }, { t: 's' }, { t: 's max' }, { t: '판정' }, { t: 'Av' }, { t: 'Av,min' }, { t: '판정' }],
        ],
        rows: rows.map(r => {
            const head = [];
            if (r.title !== prev) head.push({ t: r.title, rs: cnt(r.title) });
            prev = r.title;
            head.push({ t: r.label });
            return { head, cells: [lbl(f1(r.Vu)), lbl(f1(r.phiVc)), lbl(f1(r.phiVs)), lbl(f1(r.phiVn)), ok(r.ok), lbl(f0(r.spacing)), lbl(f0(r.smax)), ok(r.okS), lbl(f1(r.Av)), lbl(f1(r.AvMin)), ok(r.okMin)] };
        }),
        colWidths: [80, 110, 60, 60, 60, 60, 46, 50, 50, 46, 60, 60, 46],
    });
    body.appendChild(h('div', { class: 'note' }, '* Vc = 1/6·√fck·b·d (축력 무시), Vs = Av·fy·d/s, Av = 다리수 × 철근단면적 × 1000 / (주철근구간수 × 평면간격) (단위폭 1 m).  '
        + 's max = d/2 ≤ 600 (Vs > √fck·b·d/3 이면 d/4 ≤ 300),  Av,min = max(0.0625√fck, 0.35)·b·s/fy.  간격 판정은 Vu > φVc/2 인 곳만 적용.'));
    modal({ title: '전단철근 설계검토', body, buttons: [{ text: '확인', primary: true }], width: 900 });
}
