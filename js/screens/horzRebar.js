// 배근 입력 > 수평 철근 (매뉴얼 5.7)
// 부재별(상부/하부/중간 슬래브, 좌·우측 벽체) 상면/하면(외측/내측) 수평철근(배력철근)의 구간별 '개수@간격'.
// 데이터/위치 계산: calc/rebarHorz.js (culverts[i].rebar.horz[bi], .horzSet[bi])

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bCheck, bSelect, bNumber, modal } from '../ui/dom.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { drawBars, drawDots, drawForceDiagram, OTHER_COLOR, BAR_COLOR } from '../draw/rebarDraw.js';
import { DIAS, mainBarLayout, coverOf, pointAt, getSettings, spansOf } from '../calc/rebar.js';
import { horzCheck } from '../calc/rebarCheck.js';
import { loadFrame, memberForces } from '../calc/rebarForces.js';
import {
    HORZ_OPTS, defaultHorzSet, getHorzSet, horzMembers, defaultHorzFace, getHorzFace, horzLayout, horzAsAt,
} from '../calc/rebarHorz.js';
import { ensure, ensureSettings, liveModal, sameBlockPopup, sameKindBlocks } from './rebarSet.js';

const ui = { sel: null };   // { face, col } 그리드 선택 → 도면 강조
const FORCE = { on: false, state: '평상시', diag: 'BMD' };

const hzPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.horz.${bi}`;
const setPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.horzSet.${bi}`;

function ensureHorz(ctx) {
    ensureSettings(ctx);
    ensure(hzPath(ctx), () => ({ std: 300, sameSpacing: false, faces: {} }));
    ensure(setPath(ctx), defaultHorzSet);
    ensure(`${ctx.cp}.rebar.horzForce`, () => ({ ...FORCE }));
}

function memberOf(ctx, tab) {
    const g = sectionGeom(ctx.c, ctx.bi);
    return { g, mem: horzMembers(g).find(m => m.key === tab) || horzMembers(g)[0] };
}

const segLabel = (mem, f) => (mem.kind === 'slab' ? (f.key === 'U' ? 'U' : 'L') : (f.key === 'O' ? 'O' : 'I'));

/** 면 데이터를 (없으면 기본값으로) 저장하고 경로 반환 */
function facePath(ctx, member, face) {
    const p = `${hzPath(ctx)}.faces.${member}.${face}`;
    if (store.get(p) == null) {
        const f = getHorzFace(ctx.c, ctx.bi, member, face);
        store.set(p, f, { record: false, silent: true });
    }
    return p;
}

function setSegCount(ctx, member, face, n) {
    const p = facePath(ctx, member, face);
    const f = clone(store.get(p));
    n = Math.max(1, Math.min(40, n | 0));
    while (f.segs.length > n) f.segs.pop();
    const std = store.get(`${hzPath(ctx)}.std`) || 300;
    while (f.segs.length < n) f.segs.push({ n: 1, s: std });
    store.set(p, f);
}

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '수평철근(배력철근)의 배치구간별 개수와 간격을 입력합니다.',

    tabs(ctx) {
        const g = sectionGeom(ctx.c, ctx.bi);
        return horzMembers(g).map(m => ({ id: m.key, title: m.title }));
    },

    header(el, ctx) {
        ensureHorz(ctx);
        const { mem } = memberOf(ctx, ctx.tab);
        el.appendChild(bNumber(`${hzPath(ctx)}.std`, { label: '표준배치간격', dec: 0, width: 50 }));
        for (const f of mem.faces) {
            const p = facePath(ctx, mem.key, f.key);
            const cur = (store.get(p).segs || []).length;
            const s = h('select', {});
            for (let i = 1; i <= 40; i++) { const o = h('option', { value: i }, `${i}구간`); if (i === cur) o.selected = true; s.appendChild(o); }
            s.addEventListener('change', () => setSegCount(ctx, mem.key, f.key, +s.value));
            el.appendChild(h('label', {}, [`${f.title}배치 `, s]));
        }
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [button('수평철근 설정(B)', () => settingsPopup(ctx))]));
    },

    render(el, ctx, tab) {
        ensureHorz(ctx);
        const { mem } = memberOf(ctx, tab);
        const set = getHorzSet(ctx.c, ctx.bi);
        const extra = mem.kind === 'slab' ? set.opts.slabExtra : set.opts.wallExtra;
        const faces = mem.faces.map(f => ({ f, path: facePath(ctx, mem.key, f.key), data: store.get(facePath(ctx, mem.key, f.key)) }));
        const nMax = Math.max(...faces.map(x => x.data.segs.length));
        const rows = [];
        faces.forEach(({ f, path, data }, fi) => {
            const L = segLabel(mem, f);
            const head = [{ t: f.title, rs: 3 }, { t: '구분' }];
            if (extra) head.push({ t: 'R1' }, { t: 'B@C' }, { t: 'R2' });
            head.push({ t: 'D' });
            for (let k = 0; k < nMax; k++) head.push({ t: `${L}${k + 1}` });
            rows.push({ head, cells: [] });
            const cnt = [], gap = [];
            const hint = `[${mem.title}] ${f.title} 간격을 입력합니다.`;
            if (extra) {
                cnt.push(lbl('', { cls: 'ro' }), num(`${path}.BC.n`, { dec: 0, hint: '추가 구간 B@C 의 개수' }), lbl('', { cls: 'ro' }));
                gap.push(num(`${path}.R1`, { dec: 0, hint: '기준위치 바깥 첫 철근 간격 R1' }), num(`${path}.BC.s`, { dec: 0, hint: '추가 구간 B@C 의 간격' }), num(`${path}.R2`, { dec: 0, hint: '마지막 철근 간격 R2' }));
            }
            cnt.push(lbl(1, { cls: 'ro', align: 'center', hint: 'D 개수는 1 (고정)' }));
            gap.push(num(`${path}.D`, { dec: 0, field: `${L}D`, hint: `[${mem.title}] ${f.title}: 기준위치에서 첫 철근까지 (D)` }));
            for (let k = 0; k < nMax; k++) {
                if (k >= data.segs.length) { cnt.push(dash()); gap.push(dash()); continue; }
                cnt.push(num(`${path}.segs.${k}.n`, { dec: 0, hint: `${L}${k + 1} 구간 철근 개수`, validate: v => (v >= 0 ? null : '개수는 0 이상') }));
                gap.push(num(`${path}.segs.${k}.s`, { dec: 0, field: `${L}${k + 1}`, hint, validate: v => (v >= 0 ? null : '간격은 0 이상') }));
            }
            rows.push({ head: [{ t: '개수' }], cells: cnt });
            rows.push({ head: [{ t: '간격' }], cells: gap });
            void fi;
        });
        new Grid(el, {
            id: `horz-${mem.key}-${extra ? 'x' : ''}`, head: [], rows,
            onSelect: (cell, r, c) => {
                const fi = Math.floor(r / 3);
                const col = c - (extra ? 3 : 0) - 1;   // -1 = D
                ui.sel = { member: mem.key, face: mem.faces[fi] ? mem.faces[fi].key : null, col };
                ctx.redraw();
            },
        });
        // 합계 확인
        const g = sectionGeom(ctx.c, ctx.bi);
        const span = spansOf(g, mem.key).slice(-1)[0].s1;
        const sums = faces.map(({ f, data }) => `${f.title} ${(+data.D || 0) + data.segs.reduce((s, x) => s + (x.n | 0) * (+x.s || 0), 0)}`).join(', ');
        el.appendChild(h('div', { class: 'note' }, `* 기준위치(${mem.kind === 'slab' ? '좌측벽체 내면' : '상부슬래브 하면'})부터의 배치 합계: ${sums} / 내공 ${span} mm`));
    },

    footer(el, ctx, tab) {
        el.appendChild(button('전체기본값', () => store.transact(() => regenerate(ctx, null)), { title: '모든 부재를 표준배치간격으로 다시 배치' }));
        el.appendChild(button('모든 블럭 동일 적용', () => sameBlocks(ctx, tab), { disabled: ctx.blocks.length < 2 }));
        el.appendChild(button('구간추가', () => { const { mem } = memberOf(ctx, tab); const f = faceOfSel(mem); setSegCount(ctx, mem.key, f, store.get(facePath(ctx, mem.key, f)).segs.length + 1); }));
        el.appendChild(button('구간삭제', () => { const { mem } = memberOf(ctx, tab); const f = faceOfSel(mem); setSegCount(ctx, mem.key, f, store.get(facePath(ctx, mem.key, f)).segs.length - 1); }));
        el.appendChild(button('설계검토', () => checkPopup(ctx)));
        const fp = `${ctx.cp}.rebar.horzForce`;
        const fv = store.get(fp) || FORCE;
        el.appendChild(bCheck(`${fp}.on`, '', { title: '부재력보기', onChange: (v) => { store.set(`${fp}.on`, v); if (v) loadFrame(() => ctx.redraw()); } }));
        el.appendChild(bSelect(`${fp}.state`, ['평상시', '지진시'], { disabled: !fv.on }));
        el.appendChild(bSelect(`${fp}.diag`, ['BMD', 'SFD'], { disabled: !fv.on }));
        el.appendChild(bCheck(`${hzPath(ctx)}.sameSpacing`, ' 인장, 압축구간을 동일간격으로 배치', { title: '기본값 생성 시: 체크 = 모두 표준간격, 해제 = 인장구간은 표준간격/2' }));
    },

    defaults(ctx, tab) { regenerate(ctx, tab); },

    draw(ctx, tab) {
        const p = ctx.p, c = ctx.c, bi = ctx.bi;
        const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
        drawSection(d, c, bi, { simple: true });
        const lay = mainBarLayout(p, c, bi, { cycles: [1], layers: [1] });
        drawBars(d, lay, lay.bars, { color: OTHER_COLOR, lapOffset: 0 });
        const hl = horzLayout(p, c, bi);
        const th = d.textHeight;
        const r = Math.max(12, th * 0.12);
        for (const f of hl.faces) drawDots(d, f.dots.map(x => ({ pt: x.pt, color: x.extra ? COLOR.YELLOW : BAR_COLOR })), r);
        // 현재 부재: 구간 치수 + 기호
        const st = getSettings(c, bi);
        const mem = horzMembers(hl.g).find(m => m.key === tab);
        if (mem) {
            mem.faces.forEach((fc, fi) => {
                const F = hl.faces.find(x => x.member === mem.key && x.face === fc.key);
                if (!F) return;
                chainFor(d, F, mem, fc, st, hl.g);
                // 기호 (D1, D2 …)
                const no = fi + 1 + (['top', 'mid', 'bottom', 'left', 'right'].indexOf(mem.key)) * 2;
                const pick = F.dots.filter(x => !x.extra);
                if (pick.length) {
                    const a = pick[Math.floor(pick.length / 3)].pt;
                    const out = [-F.inward[0], -F.inward[1]];
                    const q = [a[0] + out[0] * th * 3 + (F.line.axis === 'x' ? th * 1.5 : 0), a[1] + out[1] * th * 3 - (F.line.axis === 'y' ? th * 1.5 : 0)];
                    for (const k of [-1, 0, 1]) {
                        const t = pick[Math.max(0, Math.min(pick.length - 1, Math.floor(pick.length / 3) + k * 2))].pt;
                        d.line(q[0], q[1], t[0], t[1], { color: COLOR.RED, layer: 'MARK' });
                    }
                    const mk = ((p.rebarCommon && p.rebarCommon.marks && p.rebarCommon.marks.horz) || 'D') + no;
                    d.bubble(q[0], q[1], mk, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
                    d.text(q[0] + th, q[1], F.dia, { color: COLOR.GREEN, h: th * 0.65, align: 'left', valign: 'middle', layer: 'MARK' });
                }
            });
        }
        const fv = store.get(`${ctx.cp}.rebar.horzForce`) || FORCE;
        if (fv.on && loadFrame(() => ctx.redraw()) === 'ready') {
            const forces = memberForces(p, c, bi, { state: fv.state, diag: fv.diag });
            if (forces) drawForceDiagram(d, hl.g, forces);
        }
        d.legend = '수평철근';
        return d;
    },
    viewKey: (ctx) => `horzRebar|${ctx.ci}|${ctx.bi}`,
};

function faceOfSel(mem) {
    return (ui.sel && ui.sel.member === mem.key && ui.sel.face) || mem.faces[0].key;
}

/** 구간 치수 체인 (이름 + n@간격), 선택 셀은 흰 사각형 */
function chainFor(d, F, mem, fc, st, g) {
    const th = d.textHeight;
    const L = F.line;
    const out = [-L.inward[0], -L.inward[1]];
    const cov = coverOf(st, mem.key, fc.key, 1);
    const dist = cov + th * 4.5;
    const lab = segLabel(mem, fc);
    const ax = (s) => { const q = pointAt(L.path, s - L.s0).pt; return L.axis === 'x' ? q[0] : q[1]; };
    const f = F.f;
    const items = [{ s0: 0, s1: +f.D || 0, name: 'D', text: String(f.D) }];
    let s = +f.D || 0;
    f.segs.forEach((sg, k) => {
        const e = s + (sg.n | 0) * (+sg.s || 0);
        items.push({ s0: s, s1: e, name: `${lab}${k + 1}`, text: (sg.n | 0) > 1 ? `${sg.n}@${sg.s}` : String(sg.s) });
        s = e;
    });
    const ref = pointAt(L.path, -L.s0).pt;
    items.forEach((it, i) => {
        if (it.s1 - it.s0 < 1e-6) return;
        const a = ax(it.s0), b = ax(it.s1);
        if (L.axis === 'x') {
            const yR = ref[1] + out[1] * cov, yD = ref[1] + out[1] * dist;
            d.dimH(a, b, yR, yD, it.text, { name: it.name, h: th * 0.6 });
            if (ui.sel && ui.sel.member === mem.key && ui.sel.face === fc.key && ui.sel.col === i - 1) d.rect(Math.min(a, b), yD - th * 0.8, Math.abs(b - a), th * 1.6, { color: COLOR.WHITE, layer: 'SEL' });
        } else {
            const xR = ref[0] + out[0] * cov, xD = ref[0] + out[0] * dist;
            d.dimV(a, b, xR, xD, it.text, { name: it.name, h: th * 0.6 });
            if (ui.sel && ui.sel.member === mem.key && ui.sel.face === fc.key && ui.sel.col === i - 1) d.rect(xD - th * 0.8, Math.min(a, b), th * 1.6, Math.abs(b - a), { color: COLOR.WHITE, layer: 'SEL' });
        }
    });
    const end = L.axis === 'x' ? [ax(s) + th * 1.2, ref[1] + out[1] * dist] : [ref[0] + out[0] * dist, ax(s) - th * 1.2];
    d.text(end[0], end[1], `(${fc.title})`, { color: COLOR.RED, h: th * 0.6, align: 'left', valign: 'middle', layer: 'TEXT' });
    void g;
}

/** 기본값 다시 만들기 (tab = 부재 키, null = 전체) */
function regenerate(ctx, tab) {
    const g = sectionGeom(ctx.c, ctx.bi);
    const hz = store.get(hzPath(ctx)) || {};
    for (const m of horzMembers(g)) {
        if (tab && m.key !== tab) continue;
        for (const f of m.faces) store.set(`${hzPath(ctx)}.faces.${m.key}.${f.key}`, defaultHorzFace(g, m.key, f.key, hz.std || 300, !!hz.sameSpacing));
    }
}

function sameBlocks(ctx, tab) {
    const targets = sameKindBlocks(ctx);
    sameBlockPopup(() => {
        const s = clone(store.get(hzPath(ctx)));
        const ss = clone(store.get(setPath(ctx)));
        for (const b of targets) { store.set(hzPath(ctx, b), clone(s)); store.set(setPath(ctx, b), clone(ss)); }
    }, () => {
        const s = store.get(`${hzPath(ctx)}.faces.${tab}`);
        for (const b of targets) store.set(`${hzPath(ctx, b)}.faces.${tab}`, clone(s));
    });
}

function settingsPopup(ctx) {
    const sp = setPath(ctx);
    const snap = clone(store.get(sp));
    liveModal('수평철근 설정', (body) => {
        const g = sectionGeom(store.get('culverts.' + ctx.ci), ctx.bi);
        const roadOn = !!(ctx.c.cross && (ctx.c.cross.all || (ctx.c.cross.cells || []).some(x => x && x.use)));
        const dias = h('fieldset', { style: { margin: '4px', padding: '4px 8px' } }, [h('legend', {}, '수평철근 직경')]);
        const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto auto auto', gap: '4px 10px', alignItems: 'center' } });
        for (const [k, t, dis] of [['top', '상부슬래브', g.kind === 'U'], ['bottom', '하부슬래브', false], ['outerWall', '외측벽체', false], ['innerWall', '내측벽체', false], ['mid', '중간슬래브', g.kind !== 'DOUBLE'], ['road', '차도부', !roadOn]]) {
            grid.appendChild(h('span', {}, t));
            grid.appendChild(bSelect(`${sp}.dia.${k}`, DIAS, { disabled: dis }));
        }
        dias.appendChild(grid);
        body.appendChild(dias);
        body.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', margin: '6px' } }, HORZ_OPTS.map(([k, t]) => bCheck(`${sp}.opts.${k}`, ' ' + t))));
        body.appendChild(h('div', { class: 'inline-opts' }, [
            button('기본값(D)', () => store.set(sp, defaultHorzSet())),
            button('모든 블럭 동일 적용', () => {
                const s = clone(store.get(sp));
                store.transact(() => { for (const b of ctx.blocks) if (b.index !== ctx.bi) store.set(setPath(ctx, b.index), clone(s)); });
            }, { disabled: ctx.blocks.length < 2 }),
        ]));
    }, { buttons: [{ text: '확인(O)', primary: true }, { text: '취소(C)', onClick: () => store.set(sp, snap) }] });
}

function checkPopup(ctx) {
    const p = store.project, c = p.culverts[ctx.ci];
    const hl = horzLayout(p, c, ctx.bi);
    const face = (m, f) => hl.faces.find(x => x.member === m && x.face === f);
    const horzAt = (member, f, s) => {
        if (f) { const F = face(member, f); return F ? horzAsAt(F, s) : 0; }
        return hl.faces.filter(x => x.member === member).reduce((a, F) => a + horzAsAt(F, s), 0);
    };
    const rows = horzCheck(p, c, ctx.bi, horzAt, { dia: getHorzSet(c, ctx.bi).dia.outerWall });
    const body = h('div', { style: { minWidth: '640px' } });
    let prev = null;
    const cnt = (t) => rows.filter(r => r.title === t).length;
    const f3 = (v) => (v == null || !isFinite(v) ? '-' : v.toFixed(3));
    const ok = (v) => lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' });
    new Grid(body, {
        id: 'horz-check',
        head: [
            [{ t: '구분', cs: 2, rs: 2 }, { t: '① B × H × Factor', cs: 3 }, { t: '② 사용 철근량 × 비율(%)', cs: 3 }],
            [{ t: 'Req As' }, { t: 'Use As' }, { t: '구분' }, { t: 'Req As' }, { t: 'Use As' }, { t: '구분' }],
        ],
        rows: rows.map(r => {
            const head = [];
            if (r.title !== prev) head.push({ t: r.title, rs: cnt(r.title) });
            prev = r.title;
            head.push({ t: r.label });
            return { head, cells: [lbl(f3(r.req1)), lbl(f3(r.use1)), ok(r.ok1), lbl(f3(r.req2)), lbl(f3(r.use2)), ok(r.ok2)] };
        }),
        colWidths: [80, 120, 80, 80, 50, 80, 80, 50],
    });
    body.appendChild(h('div', { class: 'note' }, '* ① 수축·온도철근: 슬래브 0.0020(fy<400), 벽체 0.0025 × B(1000) × H, 양면 합계.  ② 인장 주철근량 × 20%, 해당 면.'));
    modal({ title: '수평철근 설계검토', body, buttons: [{ text: '확인', primary: true }], width: 700 });
}
