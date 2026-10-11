// 상세입력 > 날개벽 제원 (매뉴얼 3.3)
// 일체식: L1, H2, H3, T1, T2, Hu1, Hu2, 날개벽타입 (근단 상·하단은 암거 상·하단에 맞춤)
// 옹벽식: [단면 설정 | 성토부 설정 | 배수공] — 시점/종점 행

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, dash, custom } from '../ui/cells.js';
import { h, button, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import {
    WING_STD, installedWings, defaultWingDim, defaultWingPosFor,
    integralElevation, wallSection,
} from '../calc/wingGeom.js';
import { drawIntegralElevation, drawIntegralSection, drawWallSection, drawWallElevation } from '../draw/wingDraw.js';

const curByCulvert = new Map();   // 암거 index → 선택된 날개벽 key

function wingList(ctx) { return installedWings(ctx.c); }

function curWing(ctx) {
    const list = wingList(ctx);
    if (!list.length) return null;
    const k = curByCulvert.get(ctx.ci);
    return list.find(w => w.key === k) || list[0];
}

/** 날개벽 데이터 확보 (없으면 기본값, 기록 없이) */
function ensureDim(ctx, key) {
    const c = ctx.c;
    if (!c.wings || !c.wings.pos) {
        store.set(`${ctx.cp}.wings`, { ...(c.wings || {}), pos: defaultWingPosFor(c), dim: (c.wings && c.wings.dim) || {} }, { record: false, silent: true });
    }
    const path = `${ctx.cp}.wings.dim.${key}`;
    let d = store.get(path);
    if (!d || !d.integral || !d.wall) {
        const def = defaultWingDim(ctx.c, key);
        d = { ...def, ...(d || {}) };
        store.set(path, d, { record: false, silent: true });
    }
    return path;
}

const HINT = {
    L1: '날개벽 길이를 입력합니다. ([날개벽 위치]의 길이와 같습니다)',
    H2: '날개벽 끝단의 노출 수직높이를 입력합니다.',
    H3: '날개벽 끝단의 하부(근입) 수직높이를 입력합니다.',
    T1: '날개벽 상단 두께를 입력합니다.', T2: '날개벽 하단 두께를 입력합니다.',
    Hu1: '평면도에서 날개벽과 구조물 본체 사이의 헌치 제원 (본체 방향)', Hu2: '평면도에서 날개벽과 구조물 본체 사이의 헌치 제원 (날개벽 방향)',
    std: '표준타입을 설정합니다. (도로공사, 건교부 타입)',
    batter: '벽체 전면에 대한 경사비를 설정합니다.', WH: '옹벽의 총높이를 설정합니다.', WT: '벽체 상단부 두께를 설정합니다.',
    B1: '기초 앞굽 길이', B2: '기초 뒷굽 길이', B3: '벽체 하단부 폭',
    BF1: '기초 뒷굽의 높이 (벽체와 만나는 부분)', BF2: '기초 뒷굽의 높이 (끝단)',
    BB1: '기초 앞굽의 높이 (벽체와 만나는 부분)', BB2: '기초 앞굽의 높이 (끝단)',
    EL: '벽체 상단부의 EL 을 결정합니다. (m)',
    addH: '벽체단면 검토시 추가 검토위치: 기초상단에서 상향으로 높이를 입력합니다. (m)',
    keyUse: '활동방지벽 설치유무를 선택합니다.', D: '뒷굽전면에서 활동방지벽의 시작위치 (mm)', W: '활동방지벽의 수평두께 (mm)', T: '활동방지벽의 수직높이 (mm)',
    HU1: '배면헌치 수평길이', HU2: '배면헌치 수직길이', IO: '버림콘크리트의 옹벽 시종점 전개도상 돌출길이 (mm)', IH: '버림콘크리트 수직높이 (mm)',
    inf: '배면 사면이 무한으로 가는 경우 선택합니다. (기본값 off)',
    SL: '옹벽배면 상단으로부터 배면방향으로 사면시점의 위치 (기본값 500)',
    SH: '무한사면이 off 인 경우 성토고', SD: '옹벽배면 상단에서 경사가 시작되는 위치까지의 하향 거리 (기본값 0)',
    slope1: '1단 경사부 구배 (기본값 1:1.500)', slope2: '2단 이상 경사부 구배 (기본값 1:1.800)',
    bermW: '소단폭 (기본값 1000). 성토고가 최대높이보다 클 때만 소단이 발생합니다.', bermS: '소단경사 (%) (기본값 4.00)',
    dUse: '배수공에 대한 설치유무를 설정합니다.', dia: '배수홀의 지름 (mm)', dH: '정면도상 좌측에서 이격거리 (mm)', ctcH: '정면도상 수평간격 (mm)',
    dV: '단면도상 기초상단에서 상향방향 이격거리 (mm)', dT: '단면도상 Drain board 를 설치할 경우 옹벽상단에서 이격거리 (mm)',
};

export default {
    scope: 'culvert',
    enabled: (ctx) => wingList(ctx).length > 0,
    hint: '[날개벽 위치]에서 설치한 날개벽의 제원을 입력합니다.',

    tabs(ctx) {
        const w = curWing(ctx);
        if (!w) return [];
        if (w.type === '일체식') return [{ id: 'integral', title: '일체식 날개벽' }];
        const path = ensureDim(ctx, w.key);
        const drainOn = !!store.get(`${path}.wall.drain.use`);
        return [{ id: 'sec', title: '단면 설정' }, { id: 'fill', title: '성토부 설정' }, { id: 'drain', title: '배수공', disabled: !drainOn }];
    },

    header(el, ctx) {
        const list = wingList(ctx);
        const w = curWing(ctx);
        const s = h('select', { disabled: !list.length });
        list.forEach(it => {
            const o = h('option', { value: it.key }, it.name);
            if (w && it.key === w.key) o.selected = true;
            s.appendChild(o);
        });
        if (!list.length) s.appendChild(h('option', {}, '설치된 날개벽 없음'));
        const go = (k) => { curByCulvert.set(ctx.ci, k); ctx.rerender(); };
        s.addEventListener('change', () => go(s.value));
        const idx = w ? list.findIndex(it => it.key === w.key) : -1;
        el.appendChild(h('span', { class: 'sel-group' }, [
            s,
            h('button', { class: 'nav-btn', disabled: idx <= 0, onclick: () => go(list[idx - 1].key) }, '◀'),
            h('button', { class: 'nav-btn', disabled: idx < 0 || idx >= list.length - 1, onclick: () => go(list[idx + 1].key) }, '▶'),
        ]));
        if (w) {
            const path = ensureDim(ctx, w.key);
            const cb = h('input', { type: 'checkbox', disabled: w.type !== '옹벽식' });
            cb.checked = w.type === '옹벽식' && !!store.get(`${path}.wall.drain.use`);
            cb.addEventListener('change', () => store.set(`${path}.wall.drain.use`, cb.checked));
            el.appendChild(h('label', { style: { marginLeft: 'auto' } }, [cb, ' 배수공 설치']));
        }
    },

    render(el, ctx, tab) {
        const w = curWing(ctx);
        if (!w) {
            el.appendChild(h('div', { class: 'note' }, '설치된 날개벽이 없습니다. [날개벽 위치]에서 날개벽을 설치하십시오.'));
            return;
        }
        const path = ensureDim(ctx, w.key);
        if (w.type === '일체식') renderIntegral(el, ctx, w, path);
        else if (tab === 'fill') renderFill(el, path);
        else if (tab === 'drain') renderDrain(el, path);
        else renderWallSec(el, path);
        el.appendChild(h('div', { class: 'note' }, '* 모든 치수 단위: mm (EL, 검토높이: m). 확인창의 노란 변수명을 클릭하면 해당 셀로 이동합니다.'));
    },

    footer(el, ctx) {
        const w = curWing(ctx);
        el.appendChild(button('동일타입 동일적용', () => applySameType(ctx), { disabled: !w, title: '현재 날개벽 제원을 같은 형식의 다른 날개벽에 적용' }));
        el.appendChild(button('구간추가', () => {}, { disabled: true }));
        el.appendChild(button('구간삭제', () => {}, { disabled: true }));
    },

    defaults(ctx, tab) {
        const w = curWing(ctx);
        if (!w) return;
        const path = ensureDim(ctx, w.key);
        const cur = clone(store.get(path));
        const def = defaultWingDim(ctx.c, w.key);
        if (w.type === '일체식') cur.integral = def.integral;
        else if (tab === 'fill') cur.wall.fill = def.wall.fill;
        else if (tab === 'drain') cur.wall.drain = def.wall.drain;
        else cur.wall.rows = def.wall.rows;
        store.set(path, cur);
    },

    draw(ctx, tab) {
        const w = curWing(ctx);
        if (!w) { const d = new Drawing(); d.emptyMessage = '설치된 날개벽이 없습니다.'; return d; }
        const path = ensureDim(ctx, w.key);
        const dim = store.get(path);
        const c = ctx.c;
        if (w.type === '일체식') {
            const e = integralElevation(c, w.key);
            const d = new Drawing({ textHeight: Math.max(100, Math.min(400, Math.max(e.L1, e.hRoot) / 35)) });
            drawIntegralElevation(d, c, w.key, 0, 0, { title: `${w.name} 전개도`, p: ctx.p });
            drawIntegralSection(d, c, w.key, e.L1 + d.textHeight * 14, 0);
            d.text(e.L1 / 2, -d.textHeight * 6.5, `날개벽타입 : ${dim.integral.std || '도로공사'}`, { color: COLOR.GREEN, h: d.textHeight * 0.8, layer: 'TEXT' });
            return d;
        }
        const rows = dim.wall.rows;
        const s0 = wallSection(rows[0]), s1 = wallSection(rows[1]);
        const pos = c.wings.pos[w.key];
        const L = +pos.len || 5000;
        const big = Math.max(s0.W, s1.W, s0.WH, s1.WH, L);
        const d = new Drawing({ textHeight: Math.max(80, Math.min(300, big / 40)) });
        const th = d.textHeight;
        const drain = dim.wall.drain;
        const fill = dim.wall.fill;
        const baseS = (+rows[0].EL || 0) * 1000 - (+rows[0].WH || 0);
        const baseE = (+rows[1].EL || 0) * 1000 - (+rows[1].WH || 0);
        // 시점 단면 (좌), 전개도 (가운데), 종점 단면 (우) — 기초 하면을 EL 기준으로 정렬
        const gap = th * 14;
        drawWallSection(d, rows[0], 0, baseS, '_s', { drain, title: '시점 단면' });
        drawFill(d, rows[0], fill, 0, baseS);
        const xe = s0.W + gap;
        drawWallElevation(d, rows, L, xe, 0, { drain, title: `${w.name} 전개도` });
        const xs = xe + L + gap;
        drawWallSection(d, rows[1], xs, baseE, '_e', { drain, title: '종점 단면' });
        drawFill(d, rows[1], fill, xs, baseE);
        return d;
    },
    viewKey: (ctx) => { const w = curWing(ctx); return `wingDim|${ctx.ci}|${w ? w.key : ''}`; },
};

// ── 일체식 ───────────────────────────────────────────────────────────

function renderIntegral(el, ctx, w, path) {
    const ip = `${path}.integral`;
    const posPath = `${ctx.cp}.wings.pos.${w.key}.len`;
    new Grid(el, {
        id: 'wing-int',
        head: [
            [{ t: '구분', rs: 2 }, { t: '길이' }, { t: '수직높이', cs: 2 }, { t: '두께', cs: 2 }, { t: '평면헌치', cs: 2 }, { t: '날개벽타입', rs: 2 }],
            [{ t: 'L1' }, { t: 'H2' }, { t: 'H3' }, { t: 'T1' }, { t: 'T2' }, { t: 'Hu1' }, { t: 'Hu2' }],
        ],
        rows: [{
            head: [{ t: w.name.split('-')[0] }],
            cells: [
                custom('num', () => store.get(posPath), (v) => store.transact(() => { store.set(posPath, v); store.set(`${ip}.L1`, v); }), { field: 'L1', hint: HINT.L1, validate: v => (v > 0 ? null : '길이는 0보다 커야 합니다.') }),
                num(`${ip}.H2`, { field: 'H2', hint: HINT.H2 }),
                num(`${ip}.H3`, { field: 'H3', hint: HINT.H3 }),
                num(`${ip}.T1`, { field: 'T1', hint: HINT.T1 }),
                num(`${ip}.T2`, { field: 'T2', hint: HINT.T2 }),
                num(`${ip}.Hu1`, { field: 'Hu1', hint: HINT.Hu1 }),
                num(`${ip}.Hu2`, { field: 'Hu2', hint: HINT.Hu2 }),
                sel(`${ip}.std`, WING_STD, { hint: HINT.std }),
            ],
        }],
        colWidths: [80, 70, 70, 70, 70, 70, 70, 70, 90],
    });
}

// ── 옹벽식 ───────────────────────────────────────────────────────────

function renderWallSec(el, path) {
    const rp = `${path}.wall.rows`;
    const rows = store.get(rp) || [];
    const mk = (i) => {
        const p = `${rp}.${i}`, sfx = i === 0 ? '_s' : '_e';
        const keyOn = !!(rows[i] && rows[i].key && rows[i].key.use);
        const f = (k, o = {}) => num(`${p}.${k}`, { field: k + sfx, hint: HINT[k], ...o });
        return {
            head: [{ t: i === 0 ? '시점' : '종점' }],
            cells: [
                num(`${p}.batter`, { dec: 4, hint: HINT.batter }),
                f('WH'), f('WT'), f('B1'), f('B2'), f('B3'), f('BF1'), f('BF2'), f('BB1'), f('BB2'),
                num(`${p}.EL`, { dec: 3, hint: HINT.EL }),
                num(`${p}.addH`, { dec: 3, hint: HINT.addH }),
                chk(`${p}.key.use`, { hint: HINT.keyUse }),
                keyOn ? num(`${p}.key.D`, { field: 'D' + sfx, hint: HINT.D }) : dash(),
                keyOn ? num(`${p}.key.W`, { hint: HINT.W }) : dash(),
                keyOn ? num(`${p}.key.T`, { hint: HINT.T }) : dash(),
                f('HU1'), f('HU2'), f('IO'), f('IH'),
            ],
        };
    };
    new Grid(el, {
        id: 'wing-wall-sec',
        head: [
            [{ t: '구분', rs: 2 }, { t: '단면제원', cs: 10 }, { t: 'EL', rs: 2 }, { t: '벽체추가 검토높이(m)', html: '벽체추가<br>검토높이(m)', rs: 2 }, { t: '활동방지벽', cs: 4 }, { t: '배면헌치', cs: 2 }, { t: '버림콘크리트', cs: 2 }],
            [{ t: '전면경사' }, { t: 'WH' }, { t: 'WT' }, { t: 'B1' }, { t: 'B2' }, { t: 'B3' }, { t: 'BF1' }, { t: 'BF2' }, { t: 'BB1' }, { t: 'BB2' },
                { t: '설치' }, { t: 'D' }, { t: 'W' }, { t: 'T' }, { t: 'HU1' }, { t: 'HU2' }, { t: 'IO' }, { t: 'IH' }],
        ],
        rows: [mk(0), mk(1)],
    });
}

function renderFill(el, path) {
    const fp = `${path}.wall.fill`;
    const inf = !!store.get(`${fp}.inf`);
    new Grid(el, {
        id: 'wing-wall-fill',
        head: [
            [{ t: '무한사면', rs: 2 }, { t: 'SL', rs: 2 }, { t: 'SH', rs: 2 }, { t: 'SD', rs: 2 }, { t: '경사부구배', cs: 2 }, { t: '소단부', cs: 2 }],
            [{ t: '1단' }, { t: '2단이상' }, { t: '소단폭' }, { t: '소단경사(%)' }],
        ],
        rows: [{
            cells: [
                chk(`${fp}.inf`, { hint: HINT.inf }),
                num(`${fp}.SL`, { field: 'SL', hint: HINT.SL }),
                inf ? dash() : num(`${fp}.SH`, { field: 'SH', hint: HINT.SH }),
                num(`${fp}.SD`, { field: 'SD', hint: HINT.SD }),
                num(`${fp}.slope1`, { dec: 3, hint: HINT.slope1 }),
                num(`${fp}.slope2`, { dec: 3, hint: HINT.slope2 }),
                num(`${fp}.bermW`, { hint: HINT.bermW }),
                num(`${fp}.bermS`, { dec: 2, hint: HINT.bermS }),
            ],
        }],
        colWidths: [70, 70, 70, 70, 70, 70, 70, 80],
    });
}

function renderDrain(el, path) {
    const dp = `${path}.wall.drain`;
    const on = !!store.get(`${dp}.use`);
    const n = (k, hint, o = {}) => (on ? num(`${dp}.${k}`, { hint, ...o }) : dash());
    new Grid(el, {
        id: 'wing-wall-drain',
        head: [[{ t: '배수공설치' }, { t: '직경' }, { t: 'dH' }, { t: 'ctcH' }, { t: 'dV' }, { t: 'T' }]],
        rows: [{
            cells: [
                chk(`${dp}.use`, { hint: HINT.dUse }),
                n('dia', HINT.dia), n('dH', HINT.dH), n('ctcH', HINT.ctcH, { validate: v => (v > 0 ? null : '간격은 0보다 커야 합니다.') }), n('dV', HINT.dV), n('T', HINT.dT),
            ],
        }],
        colWidths: [80, 70, 70, 70, 70, 70],
    });
}

/** 성토부 (배면 사면) 표시: 자홍 지반선 */
function drawFill(d, row, fill, ox, oy) {
    if (!fill) return;
    const s = wallSection(row);
    const x0 = s.stem.xt0 + ox, y0 = s.WH - (+fill.SD || 0) + oy;
    const SL = +fill.SL || 0;
    const m = +fill.slope1 || 1.5;
    const pts = [[x0, y0], [x0 - SL, y0]];
    const rise = fill.inf ? Math.max(s.W, s.WH) * 0.6 : Math.max(0, +fill.SH || 0);
    pts.push([x0 - SL - rise * m, y0 + rise]);
    if (!fill.inf) pts.push([x0 - SL - rise * m - s.W * 0.3, y0 + rise]);
    d.pline(pts, { color: COLOR.MAGENTA, layer: 'GROUND' });
}

function applySameType(ctx) {
    const w = curWing(ctx);
    if (!w) return;
    const src = clone(store.get(ensureDim(ctx, w.key)));
    const targets = wingList(ctx).filter(o => o.key !== w.key && o.type === w.type);
    if (!targets.length) { alertBox('같은 형식의 다른 날개벽이 없습니다.', '동일타입 동일적용'); return; }
    store.transact(() => {
        for (const t of targets) {
            const path = ensureDim(ctx, t.key);
            const cur = clone(store.get(path));
            if (w.type === '일체식') {
                cur.integral = { ...clone(src.integral), L1: cur.integral.L1 };
            } else cur.wall = clone(src.wall);
            store.set(path, cur);
        }
    });
    ctx.setHint(`${targets.map(t => t.name).join(', ')} 에 적용했습니다.`);
}
