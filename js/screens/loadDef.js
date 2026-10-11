// 구조 계산 > 하중 정의 (매뉴얼 4.4)
// 하중 분류/케이스 선택 → 왼쪽 하중 표, 오른쪽 하중조건 (온도하중은 온도 옵션), 확인창에 하중도
// 데이터: culverts[i].loadDef — 하중 계산은 js/calc/loads.js (사용자 입력은 loadDef.over / loadDef.user)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, custom } from '../ui/cells.js';
import { h, button, bCheck, modal, alertBox, confirmBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { loadCases, LOAD_CATS, DEFAULT_TEMP } from '../calc/loads.js';
import { frameModel, checkCondition } from '../calc/loadHelpers.js';
import { getLoadComb } from '../calc/combos.js';
import { ensureChecks, sectionSelector, secState } from './checkPos.js';

const DIRS = [{ value: 'gravity', label: 'Gravity' }, { value: 'x', label: 'Global X' }, { value: 'normal', label: '내측(Normal)' }];
const TYPES = [{ value: 'dist', label: 'Distributed' }, { value: 'point', label: 'Point Load' }];
const cur = { cat: '고정하중', key: 'SW', row: 0 };

function ensure(ctx) {
    ensureChecks(ctx);
    if (!ctx.c.loadDef) store.set(`${ctx.cp}.loadDef`, { condUser: false, cond: {}, temp: { ...DEFAULT_TEMP }, itemOver: {}, over: {}, user: [], userInput: false, inputMode: 'Element로 입력', showNo: false }, { record: false, silent: true });
    return store.get(`${ctx.cp}.loadDef`);
}

function casesOf(ctx) {
    try { return loadCases(ctx.p, store.get(ctx.cp), secState.k); } catch (e) { console.error(e); return []; }
}

function pickCase(ctx, cases) {
    const cats = LOAD_CATS.filter(c => cases.some(x => x.cat === c));
    if (!cats.includes(cur.cat)) cur.cat = cats[0];
    const inCat = cases.filter(x => x.cat === cur.cat);
    if (!inCat.some(x => x.key === cur.key)) cur.key = inCat[0] && inCat[0].key;
    return { cats, inCat, cs: cases.find(x => x.key === cur.key) };
}

function itemOptions(ctx) {
    return getLoadComb(ctx.c).items.map(it => ({ value: it.code, label: `${it.code}:${it.name}` }));
}

/** 현재 케이스 하중 목록 쓰기 (사용자 케이스 → user[i].items, 기본 케이스 → over[key]) */
function writeItems(ctx, cs, items) {
    const ld = store.get(`${ctx.cp}.loadDef`);
    if (cs.user) {
        const i = (ld.user || []).findIndex(u => u.key === cs.key);
        if (i >= 0) store.set(`${ctx.cp}.loadDef.user.${i}.items`, items);
    } else store.set(`${ctx.cp}.loadDef.over.${cs.key}`, items);
}

function elemLabel(fm, it) {
    const gr = fm.group(it.target);
    const a = it.a ?? 0, b = it.b ?? (gr ? gr.L : 0);
    const e = fm.elements.find(e => e.target === it.target && Math.abs(e.a - a) < 1e-3 && Math.abs(e.b - b) < 1e-3);
    if (e) return `${e.no} (${e.label})`;
    return gr ? gr.label : it.target;
}

// ── 본문 ─────────────────────────────────────────────────────────────

function renderLoads(el, ctx, cs, fm, ld) {
    if (cs.temp || cs.cat === '온도하중') {
        const t = cs.temp || { dT: 0, grad: 0, targets: [] };
        const rows = t.targets.map((tg, i) => ({
            cells: [lbl(i + 1, { align: 'center' }), lbl(fm.group(tg) ? fm.group(tg).label : tg), lbl('Temperature', { cls: 'ro' }), lbl(t.dT, { dec: 2 }), lbl(t.grad, { dec: 2 })],
        }));
        new Grid(el, { id: 'ld-temp', head: [[{ t: '번호' }, { t: 'Element' }, { t: '하중종류' }, { t: 'T' }, { t: 'T2' }]], rows, colWidths: [40, 130, 90, 60, 60] });
        return;
    }
    const editable = !!ld.userInput || cs.user;
    const L = (it) => (fm.group(it.target) || { L: 0 }).L;
    const set = (i, patch) => {
        const items = clone(cs.items);
        Object.assign(items[i], patch);
        writeItems(ctx, cs, items);
    };
    const rows = cs.items.map((it, i) => {
        const pt = it.kind === 'point';
        const e = (v, fn, o = {}) => (editable ? custom('num', () => v, fn, { dec: 3, ...o }) : lbl(v, { dec: 3, ...o }));
        const s = (v, opts, fn) => (editable ? custom('select', () => v, fn, { options: opts }) : lbl((opts.find(o => o.value === v) || {}).label || v));
        return {
            cells: [
                lbl(i + 1, { align: 'center' }),
                lbl(elemLabel(fm, it)),
                s(it.kind, TYPES, (v) => set(i, v === 'point' ? { kind: 'point', pos: it.a ?? 0, P: it.w1 ?? 0 } : { kind: 'dist', w1: it.P ?? 0, w2: it.P ?? 0 })),
                s(it.dir, DIRS, (v) => set(i, { dir: v })),
                e(pt ? it.pos : (it.a ?? 0), (v) => set(i, pt ? { pos: v } : { a: v, b: it.b ?? L(it) }), { hint: '부재 시점(I)에서의 거리 (m, Absolute)' }),
                e(pt ? it.P : it.w1, (v) => set(i, pt ? { P: v } : { w1: v }), { hint: pt ? '집중하중 (kN)' : '시점 분포하중 (kN/m)' }),
                pt ? lbl(null, { disabled: true }) : e(it.b ?? L(it), (v) => set(i, { a: it.a ?? 0, b: v })),
                pt ? lbl(null, { disabled: true }) : e(it.w2, (v) => set(i, { w2: v })),
            ],
        };
    });
    new Grid(el, {
        id: 'ld-loads',
        onSelect: (c, r) => { cur.row = r; },
        head: [
            [{ t: '번호', rs: 2 }, { t: 'Element 번호', rs: 2 }, { t: '하중타입', rs: 2 }, { t: '재하방향', rs: 2 }, { t: '시점(I)', cs: 2 }, { t: '종점(J)', cs: 2 }],
            [{ t: '거리1(m)' }, { t: '하중1' }, { t: '거리2(m)' }, { t: '하중2' }],
        ],
        rows,
        colWidths: [40, 170, 90, 100, 70, 80, 70, 80],
    });
    if (cs.overridden) el.appendChild(h('div', { class: 'note' }, '* 사용자 입력 하중으로 대체된 케이스입니다. [하중 기본값] 으로 자동계산 하중으로 되돌립니다.'));
}

function renderCond(el, ctx, cs, ld) {
    const k = secState.k;
    const cond = checkCondition(ctx.p, store.get(ctx.cp), k);
    const cp = `${ctx.cp}.loadDef.cond.${k}`;
    if (cs && (cs.temp || cs.cat === '온도하중')) {
        const tp = `${ctx.cp}.loadDef.temp`;
        if (!ld.temp) store.set(tp, { ...DEFAULT_TEMP }, { record: false, silent: true });
        new Grid(el, {
            id: 'ld-tempopt',
            head: [[{ t: '구 분', cs: 2 }, { t: '입력값' }]],
            rows: [
                { cells: [chk(`${tp}.on`), lbl('온도하중'), num(`${tp}.dT`, { dec: 1, hint: '균일 온도변화 ±T (°C)' })] },
                { cells: [chk(`${tp}.gradOn`), lbl('상하면온도차'), num(`${tp}.grad`, { dec: 1, hint: '상하면 온도차 T2 (°C)' })] },
                { cells: [chk(`${tp}.shrinkOn`), lbl('건조수축'), num(`${tp}.shrink`, { dec: 1, hint: '건조수축 등가온도 (°C)' })] },
                { cells: [lbl('건조수축 적용시 하부슬래브 포함', { cs: 2 }), chk(`${tp}.shrinkBottom`)] },
                { cells: [lbl('온도하중 적용시 하부슬래브 포함', { cs: 2 }), chk(`${tp}.tempBottom`)] },
            ],
            colWidths: [26, 200, 70],
        });
        return;
    }
    const user = !!ld.condUser;
    const ensureCond = () => {
        if (!store.get(cp)) store.set(cp, { groundEl: +cond.groundEl.toFixed(3), gwlEl: +(cond.gwOn ? cond.gwlEl : cond.gwlElRaw).toFixed(3), topEl: +cond.topEl.toFixed(3), surOn: false, sur: 0 }, { record: false, silent: true });
    };
    const c3 = (key, val) => (user ? custom('num', () => { const v = store.get(`${cp}.${key}`); return v ?? val; }, (v) => { ensureCond(); store.set(`${cp}.${key}`, v); }, { dec: 3 }) : lbl(val, { dec: 3, cls: 'ro' }));
    const sur = store.get(cp) || {};
    new Grid(el, {
        id: 'ld-cond',
        head: [[{ t: '구 분', rs: 2 }, { t: '평균 EL.(m)', cs: 3 }], [{ t: '지반고' }, { t: '지하수위' }, { t: '구조물 상단' }]],
        rows: [
            { head: [{ t: '계산검토용' }], cells: [c3('groundEl', cond.groundEl), c3('gwlEl', cond.gwOn ? cond.gwlEl : cond.gwlElRaw), c3('topEl', cond.topEl)] },
            {
                head: [{ t: '상재고정하중(kN/m²)' }],
                cells: [
                    custom('check', () => !!sur.surOn, (v) => { ensureCond(); store.set(`${cp}.surOn`, v); }),
                    sur.surOn ? custom('num', () => store.get(`${cp}.sur`) ?? 0, (v) => { ensureCond(); store.set(`${cp}.sur`, v); }, { dec: 3, cs: 2 }) : lbl(0, { dec: 3, cls: 'ro', cs: 2 }),
                ],
            },
        ],
        colWidths: [130, 80, 80, 80],
    });
    el.appendChild(h('div', { class: 'note' }, `토피 = ${cond.cover.toFixed(3)} m. 하중은 하중조건에서 자동 계산됩니다.`));
}

// ── 팝업 ─────────────────────────────────────────────────────────────

function addCasePopup(ctx) {
    const ld = ensure(ctx);
    const opts = itemOptions(ctx);
    const name = h('input', { type: 'text', value: `${cur.cat}${(ld.user || []).length + 1}`, style: { width: '160px' } });
    const mark = h('input', { type: 'text', value: 'VV', style: { width: '160px' } });
    const it = h('select', {}, opts.map(o => h('option', { value: o.value }, o.label)));
    it.value = cur.cat === '토압' ? 'Hh' : cur.cat === '활하중' ? 'L' : cur.cat === '고정하중' ? 'D' : 'Hv';
    const catSel = h('select', { disabled: true }, [h('option', {}, cur.cat)]);
    const row = (l, e) => h('div', { style: { margin: '4px 0' } }, [h('span', { style: { display: 'inline-block', width: '80px' } }, l), e]);
    modal({
        title: '추가하중 입력', width: 320,
        body: h('div', {}, [row('하중종류 :', catSel), row('하중이름 :', name), row('하중마크 :', mark), row('설계항목 :', it)]),
        buttons: [
            {
                text: '확인', primary: true, onClick: () => {
                    const m = mark.value.trim();
                    if (!/^[A-Za-z0-9]+$/.test(m)) { alertBox('하중마크는 영문/숫자만 사용할 수 있습니다. ("_" 및 특수문자 불가)'); return false; }
                    const all = casesOf(ctx);
                    if (all.some(x => x.key === m)) { alertBox(`하중마크 [${m}] 가 이미 있습니다.`); return false; }
                    const lab = (opts.find(o => o.value === it.value) || {}).label || it.value;
                    confirmBox(`[${cur.cat}]에 [${name.value}]하중이 [${lab}]으로 추가됩니다. 계속하시겠습니까 ?`, 'ARcStructure').then(ok => {
                        if (!ok) return;
                        const user = clone(store.get(`${ctx.cp}.loadDef.user`) || []);
                        user.push({ key: m, name: name.value || m, cat: cur.cat, item: it.value, items: [] });
                        store.set(`${ctx.cp}.loadDef.user`, user);
                        cur.key = m;
                    });
                },
            },
            { text: '취소' },
        ],
    });
}

function addLoadPopup(ctx, cs, fm, ld) {
    const byElem = (ld.inputMode || 'Element로 입력') === 'Element로 입력';
    const tgt = h('select');
    if (byElem) fm.elements.forEach(e => tgt.appendChild(h('option', { value: e.no }, `${e.no} : ${e.label}`)));
    else fm.groups.forEach(g => tgt.appendChild(h('option', { value: g.id }, `${g.label} (L=${g.L.toFixed(3)} m)`)));
    const typ = h('select', {}, TYPES.map(t => h('option', { value: t.value }, t.label)));
    const dir = h('select', {}, DIRS.map(t => h('option', { value: t.value }, t.label)));
    const inp = (v) => h('input', { type: 'text', value: v, style: { width: '80px', textAlign: 'right' } });
    const s0 = inp(0), s1 = inp(''), f0 = inp(0), f1 = inp(0);
    const row = (l, e) => h('div', { style: { margin: '3px 0' } }, [h('span', { style: { display: 'inline-block', width: '120px' } }, l), e]);
    modal({
        title: '하중 입력', width: 360,
        body: h('div', {}, [
            row('Kind of Load :', h('b', {}, `${cs.name} (${cs.key})`)),
            row(byElem ? 'Element :' : '부재 :', tgt),
            row('하중타입 :', typ),
            row('Direction :', dir),
            byElem ? null : row('Start 위치(m) :', s0),
            byElem ? null : row('End 위치(m) :', s1),
            row('Start Force :', f0),
            row('End Force :', f1),
        ]),
        buttons: [
            {
                text: '확 인', primary: true, onClick: () => {
                    let target, a, b;
                    if (byElem) { const e = fm.elements.find(x => x.no === +tgt.value); target = e.target; a = e.a; b = e.b; }
                    else { const g = fm.group(tgt.value); target = g.id; a = +s0.value || 0; b = s1.value === '' ? g.L : +s1.value; }
                    const it = typ.value === 'point'
                        ? { target, kind: 'point', pos: +a.toFixed(4), P: +f0.value || 0, dir: dir.value }
                        : { target, kind: 'dist', a: +a.toFixed(4), b: +b.toFixed(4), w1: +f0.value || 0, w2: +f1.value || 0, dir: dir.value };
                    writeItems(ctx, cs, [...clone(cs.items), it]);
                },
            },
            { text: '취 소' },
        ],
    });
}

// ── 도면 ─────────────────────────────────────────────────────────────

const FORCE = {
    gravity: () => [0, -1],
    x: () => [1, 0],
    normal: (id) => (id === 'top' ? [0, -1] : id === 'bottom' || id === 'middle' ? [0, 1] : id === 'left' ? [1, 0] : id === 'right' ? [-1, 0] : [1, 0]),
};

function memberPt(gr, a) {
    return gr.kind === 'slab' ? [a * 1000, gr.y * 1000] : [gr.x * 1000, (gr.y0 + a) * 1000];
}

function drawFrame(d, fm, showNo) {
    const th = d.textHeight;
    for (const gr of fm.groups) {
        const p0 = memberPt(gr, 0), p1 = memberPt(gr, gr.L);
        d.line(p0[0], p0[1], p1[0], p1[1], { color: COLOR.GRAY, width: 4 });
        d.line(p0[0], p0[1], p1[0], p1[1], { color: COLOR.GREEN });
    }
    const nodes = [];
    const ys = [...new Set(fm.groups.filter(g => g.kind === 'slab').map(g => g.y))];
    for (const x of fm.xs) for (const y of ys) nodes.push([x * 1000, y * 1000]);
    if (fm.g.kind === 'U') for (const w of fm.groups.filter(g => g.kind === 'wall')) nodes.push(memberPt(w, w.L));
    for (const [x, y] of nodes) d.circle(x, y, th * 0.18, { color: COLOR.GREEN, fill: COLOR.GREEN });
    // 하부 스프링
    const bot = fm.group('bottom');
    const n = Math.max(4, Math.round(fm.L / 0.5));
    for (let i = 0; i <= n; i++) {
        const x = fm.L * 1000 * i / n, y = bot.y * 1000;
        const z = th * 0.25, hh = th * 1.6;
        const pts = [[x, y], [x, y - hh * 0.2]];
        for (let k = 0; k < 4; k++) pts.push([x + (k % 2 ? -z : z), y - hh * (0.3 + k * 0.13)]);
        pts.push([x, y - hh * 0.85], [x, y - hh]);
        d.pline(pts, { color: COLOR.SKY });
        d.line(x - z * 1.2, y - hh, x + z * 1.2, y - hh, { color: COLOR.RED });
    }
    if (showNo) {
        for (const e of fm.elements) {
            const gr = fm.group(e.target);
            const m = memberPt(gr, (e.a + e.b) / 2);
            d.text(m[0] + (gr.kind === 'wall' ? th * 0.5 : 0), m[1] + (gr.kind === 'slab' ? -th * 1.2 : 0), String(e.no), { color: COLOR.YELLOW, h: th * 0.8, align: gr.kind === 'wall' ? 'left' : 'center' });
        }
    }
}

function drawCase(d, fm, cs) {
    const th = d.textHeight;
    if (cs.temp) {
        for (const id of cs.temp.targets) {
            const gr = fm.group(id);
            if (!gr) continue;
            const p0 = memberPt(gr, 0), p1 = memberPt(gr, gr.L);
            d.line(p0[0], p0[1], p1[0], p1[1], { color: COLOR.ORANGE, width: 6 });
            const m = memberPt(gr, gr.L / 2);
            d.text(m[0] + (gr.kind === 'wall' ? th * 0.4 : 0), m[1] + (gr.kind === 'slab' ? th * 0.4 : 0), `${cs.temp.dT.toFixed(3)}${cs.temp.grad ? ' / ' + cs.temp.grad.toFixed(3) : ''}`, { color: COLOR.YELLOW, h: th * 0.7, rot: gr.kind === 'wall' ? 90 : 0 });
        }
        return;
    }
    let maxW = 0;
    for (const it of cs.items) maxW = Math.max(maxW, Math.abs(it.kind === 'point' ? 0 : Math.max(Math.abs(it.w1), Math.abs(it.w2))));
    let maxP = 0;
    for (const it of cs.items) if (it.kind === 'point') maxP = Math.max(maxP, Math.abs(it.P));
    const LEN = th * 4;
    const sc = maxW > 0 ? LEN / maxW : 0;
    const scP = maxP > 0 ? LEN / maxP : 0;
    const col = COLOR.MAGENTA;
    const arrow = (tx, ty, hx, hy) => {
        d.line(tx, ty, hx, hy, { color: col });
        const L = Math.hypot(hx - tx, hy - ty);
        if (L < 1e-6) return;
        const ux = (hx - tx) / L, uy = (hy - ty) / L, a = Math.min(th * 0.4, L * 0.4), w = a * 0.4;
        d.pline([[hx, hy], [hx - ux * a - uy * w, hy - uy * a + ux * w], [hx - ux * a + uy * w, hy - uy * a - ux * w]], { color: col, closed: true, fill: col });
    };
    for (const it of cs.items) {
        const gr = fm.group(it.target);
        if (!gr) continue;
        const f = FORCE[it.dir] ? FORCE[it.dir](it.target) : [0, -1];
        const md = gr.kind === 'slab' ? [1, 0] : [0, 1];
        const parallel = Math.abs(f[0] * md[0] + f[1] * md[1]) > 0.5;
        const perp = parallel ? (gr.kind === 'slab' ? [0, 1] : (it.target === 'right' ? [1, 0] : [-1, 0])) : null;
        if (it.kind === 'point') {
            const [x, y] = memberPt(gr, it.pos);
            const s = Math.sign(it.P) || 1;
            const len = Math.max(th * 0.8, Math.abs(it.P) * scP);
            const dx = f[0] * s, dy = f[1] * s;
            arrow(x - dx * len, y - dy * len, x, y);
            d.text(x - dx * len, y - dy * len + th * 0.2, it.P.toFixed(3), { color: COLOR.YELLOW, h: th * 0.6 });
            continue;
        }
        const a = it.a ?? 0, b = it.b ?? gr.L;
        const nA = Math.max(2, Math.round((b - a) / (fm.L / 20)) + 1);
        const pts = [];
        for (let i = 0; i <= nA; i++) {
            const t = i / nA, pos = a + (b - a) * t, w = it.w1 + (it.w2 - it.w1) * t;
            const [x, y] = memberPt(gr, pos);
            const s = Math.sign(w) || 1;
            if (!parallel) {
                const L = Math.abs(w) * sc;
                const tx = x - f[0] * s * L, ty = y - f[1] * s * L;
                pts.push([tx, ty]);
                if (L > th * 0.2) arrow(tx, ty, x, y);
            } else {
                const L = Math.abs(w) * sc;
                const ox = x + perp[0] * L, oy = y + perp[1] * L;
                pts.push([ox, oy]);
                if (i % 2 === 0 && L > th * 0.2) arrow(ox - f[0] * s * th * 0.5, oy - f[1] * s * th * 0.5, ox + f[0] * s * th * 0.5, oy + f[1] * s * th * 0.5);
            }
        }
        d.pline(pts, { color: col });
        const rot = gr.kind === 'wall' ? 90 : 0;
        d.text(pts[0][0], pts[0][1] + th * 0.2, it.w1.toFixed(3), { color: COLOR.YELLOW, h: th * 0.55, rot });
        if (Math.abs(it.w2 - it.w1) > 1e-6 || b - a < fm.L * 0.3) d.text(pts[pts.length - 1][0], pts[pts.length - 1][1] + th * 0.2, it.w2.toFixed(3), { color: COLOR.YELLOW, h: th * 0.55, rot });
    }
}

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'culvert',
    hint: '하중조합에서 정의된 설계항목의 하중을 검토단면별로 정의합니다. 하중은 하중조건에서 자동 계산됩니다.',

    header(el, ctx) {
        ensure(ctx);
        el.appendChild(sectionSelector(ctx));
    },

    render(el, ctx) {
        const ld = ensure(ctx);
        const cases = casesOf(ctx);
        const { cats, inCat, cs } = pickCase(ctx, cases);
        const fm = frameModel(ctx.c, checkCondition(ctx.p, ctx.c, secState.k).bi);
        // 2 행: 분류 / 케이스 / 설계항목
        const catSel = h('select', {}, cats.map(c => h('option', { value: c, selected: c === cur.cat }, c)));
        catSel.addEventListener('change', () => { cur.cat = catSel.value; cur.key = null; ctx.rerender(); });
        const csSel = h('select', { style: { minWidth: '240px' } }, inCat.map(x => h('option', { value: x.key, selected: x.key === cur.key }, `${x.name}(${x.mark})`)));
        csSel.addEventListener('change', () => { cur.key = csSel.value; ctx.rerender(); });
        const step = (arr, v, dlt) => arr[(arr.indexOf(v) + dlt + arr.length) % arr.length];
        const spin = (fn) => h('span', {}, [h('button', { class: 'btn', style: { minWidth: '20px' }, onclick: () => { fn(-1); ctx.rerender(); } }, '▲'), h('button', { class: 'btn', style: { minWidth: '20px' }, onclick: () => { fn(1); ctx.rerender(); } }, '▼')]);
        const overOn = !!(cs && ld.itemOver && ld.itemOver[cs.key]);
        const itemSel = h('select', { disabled: !overOn }, itemOptions(ctx).map(o => h('option', { value: o.value, selected: cs && o.value === cs.item }, o.label)));
        itemSel.addEventListener('change', () => store.set(`${ctx.cp}.loadDef.itemOver.${cs.key}`, itemSel.value));
        const overCb = h('input', { type: 'checkbox' });
        overCb.checked = overOn;
        overCb.addEventListener('change', () => {
            const io = clone(ld.itemOver || {});
            if (overCb.checked) io[cs.key] = cs.item; else delete io[cs.key];
            store.set(`${ctx.cp}.loadDef.itemOver`, io);
        });
        el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '3px' } }, [
            catSel, spin((dl) => { cur.cat = step(cats, cur.cat, dl); cur.key = null; }),
            csSel, spin((dl) => { cur.key = step(inCat.map(x => x.key), cur.key, dl); }),
            h('label', {}, [overCb, ' 설계항목']), itemSel,
            h('span', { style: { marginLeft: 'auto' } }, [bCheck(`${ctx.cp}.loadDef.condUser`, ' 하중조건 사용자 입력')]),
        ]));
        if (!cs) { el.appendChild(h('div', { class: 'note' }, '하중 케이스가 없습니다.')); return; }
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div'), right = h('div');
        wrap.append(left, right);
        el.appendChild(wrap);
        renderLoads(left, ctx, cs, fm, ld);
        renderCond(right, ctx, cs, ld);
        if (cs.text && cs.text.length) {
            el.appendChild(h('pre', { style: { margin: '4px 0 0', padding: '4px 6px', background: '#fff', color: '#123', font: '11px/1.45 Consolas, monospace', maxHeight: '150px', overflow: 'auto', border: '1px solid #8aa' } }, cs.text.join('\n')));
        }
    },

    footer(el, ctx) {
        const ld = ensure(ctx);
        const lp = `${ctx.cp}.loadDef`;
        const cases = casesOf(ctx);
        const { cs } = pickCase(ctx, cases);
        const fm = frameModel(ctx.c, checkCondition(ctx.p, ctx.c, secState.k).bi);
        const ui = !!ld.userInput;
        const temp = cs && (cs.temp || cs.cat === '온도하중');
        const modeSel = h('select', { disabled: !ui }, ['Element로 입력', '위치로 입력'].map(v => h('option', { value: v, selected: v === (ld.inputMode || 'Element로 입력') }, v)));
        modeSel.addEventListener('change', () => store.set(`${lp}.inputMode`, modeSel.value));
        el.appendChild(bCheck(`${lp}.userInput`, ' 사용자 입력'));
        el.appendChild(modeSel);
        el.appendChild(bCheck(`${lp}.showNo`, ' 부재번호'));
        el.appendChild(button('전체기본값(T)', async () => {
            if (!(await confirmBox('모든 하중과 하중조건을 기본값으로 되돌립니다. 사용자 추가 하중도 삭제됩니다.'))) return;
            store.set(lp, { condUser: false, cond: {}, temp: { ...DEFAULT_TEMP }, itemOver: {}, over: {}, user: [], userInput: false, inputMode: 'Element로 입력', showNo: !!ld.showNo });
        }));
        el.appendChild(button('하중 기본값', () => {
            if (!cs) return;
            store.transact(() => {
                const over = clone(ld.over || {}); delete over[cs.key]; store.set(`${lp}.over`, over);
                const io = clone(ld.itemOver || {}); delete io[cs.key]; store.set(`${lp}.itemOver`, io);
                if (temp) store.set(`${lp}.temp`, { ...DEFAULT_TEMP });
            });
        }));
        el.appendChild(button('하중조건 기본값', () => { const cond = clone(ld.cond || {}); delete cond[secState.k]; store.set(`${lp}.cond`, cond); }));
        el.appendChild(button('하중추가', () => addCasePopup(ctx)));
        el.appendChild(button('하중삭제', async () => {
            if (!cs || !cs.user) { alertBox('사용자가 추가한 하중만 삭제할 수 있습니다.'); return; }
            if (!(await confirmBox(`[${cs.name}(${cs.key})] 하중을 삭제합니다.`))) return;
            store.set(`${lp}.user`, (ld.user || []).filter(u => u.key !== cs.key));
        }));
        const needUI = (fn) => () => { if (!ui && !(cs && cs.user)) { alertBox('[사용자 입력] 을 체크한 후 사용하십시오.'); return; } fn(); };
        el.appendChild(button('추가', needUI(() => addLoadPopup(ctx, cs, fm, ld)), { disabled: temp }));
        el.appendChild(button('삭제', needUI(() => { const items = clone(cs.items); items.splice(Math.min(cur.row, items.length - 1), 1); writeItems(ctx, cs, items); }), { disabled: temp }));
        el.appendChild(button('전체삭제', needUI(() => writeItems(ctx, cs, [])), { disabled: temp }));
    },

    defaults(ctx) {
        const ld = ensure(ctx);
        store.set(`${ctx.cp}.loadDef`, { condUser: false, cond: {}, temp: { ...DEFAULT_TEMP }, itemOver: {}, over: {}, user: ld.user || [], userInput: false, inputMode: 'Element로 입력', showNo: !!ld.showNo });
    },

    draw(ctx) {
        const c = ctx.c;
        ensure(ctx);
        const cases = casesOf(ctx);
        const { cs } = pickCase(ctx, cases);
        const fm = frameModel(c, checkCondition(ctx.p, c, secState.k).bi);
        const d = new Drawing({ textHeight: Math.max(120, Math.min(400, fm.L * 1000 / 40)) });
        drawFrame(d, fm, !!(c.loadDef && c.loadDef.showNo));
        if (cs) {
            drawCase(d, fm, cs);
            d.text(fm.L * 500, (Math.max(...fm.groups.map(g => g.kind === 'slab' ? g.y : g.y1)) * 1000) + d.textHeight * 7, `${cs.name} (${cs.mark}) : ${cs.item}`, { color: COLOR.WHITE, h: d.textHeight });
        }
        // 좌표축
        const th = d.textHeight, ax = -th * 6, ay = -th * 3;
        d.line(ax, ay, ax + th * 2, ay, { color: COLOR.RED }); d.text(ax + th * 2.4, ay, 'X', { color: COLOR.RED, h: th * 0.7, valign: 'middle' });
        d.line(ax, ay, ax, ay + th * 2, { color: COLOR.BLUE }); d.text(ax, ay + th * 2.4, 'Z', { color: COLOR.BLUE, h: th * 0.7 });
        return d;
    },
    viewKey: (ctx) => `loadDef|${ctx.ci}|${secState.k}|${cur.key}`,
};
