// 일반 입력 > 종단 제원 (매뉴얼 2.3) — 지하차도 전용
// 구조물 상단 EL 과 벽체 내측높이를 종단방향으로 설정한다.
// U-Type 구간: 신축이음(기준위치)별 벽체 상단EL / 시점·종점 높이 → 단면제원 U형 H2 를 맞춘다.
// BOX 구간: 블록 시·종점의 상부슬래브 하면 EL / 내공높이 → 단면제원 BOX H 를 맞춘다.
//
// 데이터 culverts[i].profile = {
//   shape: 'straight' | 'vertical',   // 직선처리 / 종단선형 적용
//   autoTop, sameLR,
//   joints: [{ topL, topR, autoL, autoR }],   // 이음별 (U-Type 벽체 상단 EL, m)
//   box: [{ top: [t0, t1] } | null],          // 블록별 (BOX 상부슬래브 하면 EL, m)
// }

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { lbl, dash, custom } from '../ui/cells.js';
import { h, bCheck, bRadio } from '../ui/dom.js';
import { COLOR, fmtLen } from '../cad/drawing.js';
import { jointStations, blocks, sectionOf, sectionKind, fmtSta } from '../core/model.js';
import { elevationAt, interpTable } from '../calc/alignment.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { newPlanDrawing } from '../draw/planDraw.js';
import { sectionPath } from './section.js';

const K = 1000;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ── 구간/조회 ─────────────────────────────────────────────────────────

/** U-Type 구간 블록 목록: start = 첫 BOX 이전, end = 그 이후의 U-Type */
function zoneBlocks(c, which) {
    const z = (c.zones || []);
    const bl = blocks(c);
    const firstBox = bl.findIndex(b => (z[b.index] || 'BOX구간') !== 'U-Type');
    if (which === 'box') return bl.filter(b => (z[b.index] || 'BOX구간') !== 'U-Type').map(b => b.index);
    if (which === 'start') return bl.filter(b => z[b.index] === 'U-Type' && (firstBox < 0 || b.index < firstBox)).map(b => b.index);
    return bl.filter(b => z[b.index] === 'U-Type' && firstBox >= 0 && b.index > firstBox).map(b => b.index);
}

function baseEl(p, sta) { return elevationAt(p.alignment.vip, sta); }
function planEl(p, sta) { return interpTable(p.alignment.groundLine, sta); }

/** 블록 단면의 기본 높이 (m): U = H1+H2+H3, BOX = H */
function secHeight(c, bi) {
    const s = sectionOf(c, bi);
    if (sectionKind(c, bi) === 'U') return ((+s.H1 || 0) + (+s.H2 || 0) + (+s.H3 || 0)) / K;
    return (+s.H || 0) / K;
}

export function defaultProfile(p, c) {
    const st = jointStations(c);
    const bl = blocks(c);
    const z = c.zones || [];
    const joints = st.map((s, j) => {
        // 이음에 접한 U 블록 높이
        const bi = z[j] === 'U-Type' ? j : (z[j - 1] === 'U-Type' ? j - 1 : null);
        const hh = bi != null ? secHeight(c, bi) : 3.0;
        const t = r3(baseEl(p, s) + hh);
        return { topL: t, topR: t, autoL: false, autoR: false };
    });
    const box = bl.map(b => (z[b.index] === 'U-Type' ? null : { top: [r3(baseEl(p, b.sta0) + secHeight(c, b.index)), r3(baseEl(p, b.sta1) + secHeight(c, b.index))] }));
    return { shape: 'straight', autoTop: false, sameLR: true, joints, box };
}

function ensure(ctx) {
    const c = ctx.c;
    const d = defaultProfile(ctx.p, c);
    let pr = c.profile;
    let fix = false;
    if (!pr) { pr = d; fix = true; }
    else {
        pr = clone(pr);
        if (!Array.isArray(pr.joints)) { pr.joints = d.joints; fix = true; }
        if (!Array.isArray(pr.box)) { pr.box = d.box; fix = true; }
        if (pr.joints.length !== d.joints.length) { pr.joints = d.joints.map((x, i) => pr.joints[i] || x); fix = true; }
        if (pr.box.length !== d.box.length || pr.box.some((x, i) => !!x !== !!d.box[i])) { pr.box = d.box.map((x, i) => (x ? (pr.box[i] || x) : null)); fix = true; }
        for (const k of ['shape', 'autoTop', 'sameLR']) if (pr[k] == null) { pr[k] = d[k]; fix = true; }
    }
    if (fix) store.set(`${ctx.cp}.profile`, pr, { record: false, silent: true });
    return c.profile;
}

/** U 구간 이음 j 의 벽체 상단 EL (자동EL / 상단EL 자동계산 반영) */
function topEl(p, c, pr, joints, j, side) {
    const st = jointStations(c);
    const key = side === 'R' && !pr.sameLR ? 'R' : 'L';
    const own = (k) => {
        if (pr.autoTop) return r3(planEl(p, st[k]));
        return +pr.joints[k][`top${key}`] || 0;
    };
    const isAuto = (k) => k !== joints[0] && k !== joints[joints.length - 1] && pr.joints[k][`auto${key}`];
    if (!isAuto(j) || pr.autoTop) return own(j);
    let a = j, b = j;
    while (a > joints[0] && isAuto(a)) a--;
    while (b < joints[joints.length - 1] && isAuto(b)) b++;
    const t = (st[j] - st[a]) / ((st[b] - st[a]) || 1);
    return own(a) + (own(b) - own(a)) * t;
}

/** 블록별 벽체 높이 (m) [시점면, 종점면] */
export function blockHeights(p, c, bi) {
    const pr = c.profile || defaultProfile(p, c);
    const st = jointStations(c);
    const z = c.zones || [];
    if (z[bi] === 'U-Type') {
        const which = zoneBlocks(c, 'start').includes(bi) ? 'start' : 'end';
        const zb = zoneBlocks(c, which);
        const joints = [zb[0], ...zb.map(b => b + 1)];
        const hL = [topEl(p, c, pr, joints, bi, 'L') - baseEl(p, st[bi]), topEl(p, c, pr, joints, bi + 1, 'L') - baseEl(p, st[bi + 1])];
        const hR = [topEl(p, c, pr, joints, bi, 'R') - baseEl(p, st[bi]), topEl(p, c, pr, joints, bi + 1, 'R') - baseEl(p, st[bi + 1])];
        return { L: hL, R: hR };
    }
    const bx = (pr.box || [])[bi] || { top: [baseEl(p, st[bi]) + secHeight(c, bi), baseEl(p, st[bi + 1]) + secHeight(c, bi)] };
    const hh = [bx.top[0] - baseEl(p, st[bi]), bx.top[1] - baseEl(p, st[bi + 1])];
    return { L: hh, R: hh };
}

/** 종단 높이 → 블록 단면 (U: H2, BOX: H) */
function syncSections(ctx) {
    const c = ctx.c;
    if (c.type !== '지하차도') return;
    for (const b of blocks(c)) {
        const sp = sectionPath({ c, cp: ctx.cp, bi: b.index });
        const sec = store.get(sp);
        const hh = blockHeights(ctx.p, c, b.index);
        const Hmax = Math.round(Math.max(...hh.L, ...hh.R) * K);
        if (!(Hmax > 0)) continue;
        if (sectionKind(c, b.index) === 'U') {
            const H2 = Math.max(0, Hmax - (+sec.H1 || 0) - (+sec.H3 || 0));
            if (sec.H2 !== H2) store.set(`${sp}.H2`, H2);
        } else if (sec.H !== Hmax) store.set(`${sp}.H`, Hmax);
    }
}

function setAndSync(ctx, path, v) {
    store.transact(() => {
        store.set(path, v);
        syncSections(ctx);
    });
}

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'culvert',
    enabled: (ctx) => !!ctx.c && ctx.c.type === '지하차도',
    hint: '구조물 종단형상(상단 EL, 벽체 높이)을 설정합니다.',

    tabs(ctx) {
        const c = ctx.c;
        return [
            { id: 'start', title: 'U-TYPE(시점측)', disabled: !zoneBlocks(c, 'start').length },
            { id: 'box', title: 'BOX구간', disabled: !zoneBlocks(c, 'box').length },
            { id: 'end', title: 'U-TYPE(종점측)', disabled: !zoneBlocks(c, 'end').length },
        ];
    },

    header(el, ctx) {
        if (ctx.c.type !== '지하차도') return;
        ensure(ctx);
        const pp = `${ctx.cp}.profile`;
        el.appendChild(h('label', {}, '구조물 종단형상'));
        el.appendChild(bRadio(`${pp}.shape`, [{ value: 'vertical', label: '종단선형 적용' }, { value: 'straight', label: '직선처리' }]));
        el.appendChild(bCheck(`${pp}.autoTop`, ' 상단 EL 자동계산', { onChange: (v) => setAndSync(ctx, `${pp}.autoTop`, v), title: 'U-Type 벽체 상단 EL 을 계획고(종단 지반고)에 맞춥니다.' }));
        el.appendChild(bCheck(`${pp}.sameLR`, ' 좌우측 동일적용', { onChange: (v) => setAndSync(ctx, `${pp}.sameLR`, v), title: '좌우측 벽체 높이가 다른 U-Type 은 해제합니다.' }));
    },

    render(el, ctx, tab) {
        if (ctx.c.type !== '지하차도') {
            el.appendChild(h('div', { class: 'note' }, '종단 제원은 지하차도 형식에서만 입력합니다.'));
            return;
        }
        const pr = ensure(ctx);
        if (tab === 'box') renderBox(el, ctx, pr);
        else renderU(el, ctx, pr, tab);
        el.appendChild(h('div', { class: 'note' }, '* 입력한 높이는 [단면 제원]의 U형 벽체높이(H2) 및 BOX 내공높이(H)에 반영됩니다. EL 단위: m'));
    },

    defaults(ctx) {
        store.set(`${ctx.cp}.profile`, defaultProfile(ctx.p, ctx.c));
        syncSections(ctx);
    },

    apply(ctx) { store.transact(() => syncSections(ctx)); },

    draw(ctx) {
        if (ctx.c.type !== '지하차도') return null;
        ensure(ctx);
        return drawLongitudinal(ctx.p, ctx.c);
    },
    viewKey: (ctx) => `profile|${ctx.ci}`,
};

function renderU(el, ctx, pr, tab) {
    const p = ctx.p, c = ctx.c, pp = `${ctx.cp}.profile`;
    const st = jointStations(c);
    const zb = zoneBlocks(c, tab);
    if (!zb.length) return;
    const joints = [zb[0], ...zb.map(b => b + 1)];
    const nJ = st.length;
    const sideCells = (j, side) => {
        const first = j === joints[0], last = j === joints[joints.length - 1];
        const mirror = side === 'R' && pr.sameLR;
        const key = side;
        const auto = !first && !last && pr.joints[j][`auto${key}`];
        const ro = mirror || pr.autoTop || auto;
        const top = () => r3(topEl(p, c, pr, joints, j, side));
        const hS = () => r3(top() - baseEl(p, st[j]));
        const setTop = (v) => setAndSync(ctx, `${pp}.joints.${j}.top${key}`, v);
        const cells = [];
        cells.push(first || last ? dash() : (mirror ? lbl(() => (pr.joints[j].autoL ? '자동' : '-'), { cls: 'ro', align: 'center' })
            : custom('check', () => !!pr.joints[j][`auto${key}`], (v) => setAndSync(ctx, `${pp}.joints.${j}.auto${key}`, !!v), { hint: '자동단면: 앞뒤 기준위치의 EL 로 보간합니다.' })));
        cells.push(ro ? lbl(top, { dec: 3, cls: 'ro' }) : custom('num', top, setTop, { dec: 3, hint: '벽체 상단 EL(m)을 입력합니다.' }));
        const hCell = (show) => {
            if (!show) return dash();
            return ro ? lbl(hS, { dec: 3, cls: 'ro' }) : custom('num', hS, (v) => setTop(r3(baseEl(p, st[j]) + v)), { dec: 3, hint: '벽체 높이(m) — 기초상단에서 벽체 상단까지' });
        };
        cells.push(hCell(!first), hCell(!last));
        return cells;
    };
    const rows = joints.map((j, k) => ({
        head: [{ t: String(k + 1) }],
        cells: [
            lbl(j === 0 ? '암거시점' : j === nJ - 1 ? '암거종점' : '신축이음', { cls: 'ro', hint: j === 0 ? '암거시점' : j === nJ - 1 ? '암거종점' : '신축이음' }),
            lbl(st[j], { dec: 3, cls: 'ro' }),
            k === 0 ? dash() : lbl(() => baseEl(p, st[j]), { dec: 3, cls: 'ro' }),
            k === joints.length - 1 ? dash() : lbl(() => baseEl(p, st[j]), { dec: 3, cls: 'ro' }),
            lbl(() => planEl(p, st[j]), { dec: 3, cls: 'ro', hint: '계획고 (선형정보 종단 지반고)' }),
            ...sideCells(j, 'L'),
            ...sideCells(j, 'R'),
        ],
    }));
    new Grid(el, {
        id: 'profile-' + tab,
        head: [
            [{ t: '구분', rs: 2 }, { t: '선형중심', cs: 2 }, { t: '기초상단 EL', cs: 3 }, { t: '좌측벽체', cs: 4 }, { t: '우측벽체', cs: 4 }],
            [{ t: '위치' }, { t: 'Station' }, { t: '시점방향' }, { t: '종점방향' }, { t: '계획고' },
                { t: '자동EL' }, { t: '상단EL' }, { t: '시점높이' }, { t: '종점높이' },
                { t: '자동EL' }, { t: '상단EL' }, { t: '시점높이' }, { t: '종점높이' }],
        ],
        rows,
        colWidths: [40, 70, 80, 70, 70, 70, 55, 70, 70, 70, 55, 70, 70, 70],
    });
}

function renderBox(el, ctx, pr) {
    const p = ctx.p, c = ctx.c, pp = `${ctx.cp}.profile`;
    const st = jointStations(c);
    const nJ = st.length;
    const rows = [];
    for (const bi of zoneBlocks(c, 'box')) {
        [0, 1].forEach(k => {
            const j = bi + k;
            const top = () => +((pr.box[bi] || {}).top || [])[k] || 0;
            const setTop = (v) => setAndSync(ctx, `${pp}.box.${bi}.top.${k}`, v);
            rows.push({
                head: k === 0 ? [{ t: `BLOCK-${bi + 1}`, rs: 2 }] : [],
                cells: [
                    lbl(j === 0 ? '암거시점' : j === nJ - 1 ? '암거종점' : '신축이음', { cls: 'ro' }),
                    lbl(st[j], { dec: 3, cls: 'ro' }),
                    lbl(() => baseEl(p, st[j]), { dec: 3, cls: 'ro' }),
                    lbl(() => planEl(p, st[j]), { dec: 3, cls: 'ro' }),
                    custom('num', top, setTop, { dec: 3, hint: '상부 슬래브 하면 EL(m)을 입력합니다.' }),
                    custom('num', () => r3(top() - baseEl(p, st[j])), (v) => setTop(r3(baseEl(p, st[j]) + v)), { dec: 3, hint: '벽체 내공 높이(m)를 입력합니다.' }),
                ],
            });
        });
    }
    new Grid(el, {
        id: 'profile-box',
        head: [
            [{ t: '구분', rs: 2 }, { t: '선형중심', cs: 2 }, { t: '기초상단EL', rs: 2 }, { t: '계획고EL', rs: 2 }, { t: '벽체', cs: 2 }],
            [{ t: '위치' }, { t: 'Station(m)' }, { t: '상단EL' }, { t: '높이' }],
        ],
        rows,
        colWidths: [70, 70, 90, 90, 90, 90, 90],
    });
}

// ── 종단면도 ──────────────────────────────────────────────────────────

function drawLongitudinal(p, c) {
    const d = newPlanDrawing(p, c);
    const th = d.textHeight;
    const pr = c.profile || defaultProfile(p, c);
    const st = jointStations(c);
    const sta0 = st[0];
    const X = (s) => (s - sta0) * K;
    const Y = (el) => el * K;
    const bl = blocks(c);
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const baseAt = (b, s) => {
        if (pr.shape === 'vertical') return baseEl(p, s);
        const t = (s - b.sta0) / (b.length || 1);
        return baseEl(p, b.sta0) + (baseEl(p, b.sta1) - baseEl(p, b.sta0)) * t;
    };
    const samples = (b) => {
        const n = pr.shape === 'vertical' ? Math.max(2, Math.ceil(b.length / 1)) : 1;
        return Array.from({ length: n + 1 }, (_, k) => b.sta0 + b.length * k / n);
    };
    let yMax = -Infinity, yMin = Infinity;
    const tops = [], bots = [];
    for (const b of bl) {
        const g = sectionGeom(c, b.index);
        const hh = blockHeights(p, c, b.index);
        const ss = samples(b);
        const base = ss.map(s => [X(s), Y(baseAt(b, s))]);
        const bottom = ss.map(s => [X(s), Y(baseAt(b, s)) - g.LT]);
        const lean = g.lean ? ss.map(s => [X(s), Y(baseAt(b, s)) - g.LT - g.lean.t]) : null;
        const isU = g.kind === 'U';
        const t0 = Y(baseEl(p, b.sta0)) + hh.L[0] * K, t1 = Y(baseEl(p, b.sta1)) + hh.L[1] * K;
        const ut = isU ? 0 : g.UT;
        const outline = [...bottom, [X(b.sta1), t1 + ut], [X(b.sta0), t0 + ut]];
        d.pline(outline, { ...cy, closed: true });
        if (lean) d.pline(lean, cy);
        d.pline(base, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        if (!isU) d.line(X(b.sta0), t0, X(b.sta1), t1, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
        tops.push([X(b.sta0), t0 + ut], [X(b.sta1), t1 + ut]);
        bots.push([X(b.sta0), bottom[0][1]], [X(b.sta1), bottom[bottom.length - 1][1]]);
        yMax = Math.max(yMax, t0 + ut, t1 + ut);
        yMin = Math.min(yMin, ...(lean || bottom).map(q => q[1]));
    }
    // 계획고(지반고) / 종단선형
    const s0 = st[0] - 5, s1 = st[st.length - 1] + 5;
    const al = [], gl = [];
    for (let s = s0; s <= s1 + 1e-6; s += Math.max(0.5, (s1 - s0) / 200)) {
        al.push([X(s), Y(baseEl(p, s))]);
        gl.push([X(s), Y(planEl(p, s))]);
    }
    d.pline(al, { color: COLOR.RED, layer: 'ALIGN' });
    d.text(al[0][0], al[0][1] + th * 0.3, '종단선형', { color: COLOR.GREEN, h: th * 0.7, align: 'left', layer: 'TEXT' });
    d.pline(gl, { color: COLOR.YELLOW, dash: 'hidden', layer: 'GROUND' });
    d.text(gl[0][0], gl[0][1] + th * 0.3, '계획고', { color: COLOR.GREEN, h: th * 0.7, align: 'left', layer: 'TEXT' });
    yMax = Math.max(yMax, ...gl.map(q => q[1]));
    // 시점 단부
    d.line(X(st[0]), bots[0][1], X(st[0]), tops[0][1], { color: COLOR.YELLOW, layer: 'CONC', width: 2 });
    // 이음 / EL
    const yTag = yMax + th * 3;
    st.forEach((s, j) => {
        d.line(X(s), yMin - th * 2, X(s), yTag, { color: COLOR.RED, layer: 'JOINT' });
        d.text(X(s), yTag + th * 0.3, `STA. ${fmtSta(s)}`, { color: COLOR.GREEN, h: th * 0.65, layer: 'TEXT' });
        const top = tops[Math.min(tops.length - 1, j * 2 - (j > 0 ? 1 : 0))];
        const bot = bots[Math.min(bots.length - 1, j * 2 - (j > 0 ? 1 : 0))];
        if (top) d.elMark(X(s), top[1], top[1] / K, { h: th * 0.55 });
        if (bot) d.elMark(X(s), bot[1], bot[1] / K, { h: th * 0.55, down: true });
    });
    // 구간 / 블록 치수
    const yB = yTag + th * 2.6, yZ = yB + th * 3;
    for (const b of bl) {
        d.dimH(X(b.sta0), X(b.sta1), yTag, yB, fmtLen(b.length * K));
        d.text((X(b.sta0) + X(b.sta1)) / 2, yB - th * 0.3, `(BLOCK${b.index + 1})`, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'DIM' });
    }
    const runs = [];
    for (const b of bl) {
        const z = (c.zones || [])[b.index] === 'U-Type' ? 'U-Type' : 'BOX';
        const last = runs[runs.length - 1];
        if (last && last.z === z) { last.s1 = b.sta1; } else runs.push({ z, s0: b.sta0, s1: b.sta1 });
    }
    for (const r of runs) {
        d.dimH(X(r.s0), X(r.s1), yB, yZ, `${r.z}구간 (L=${(r.s1 - r.s0).toFixed(3)}m)`);
    }
    d.legend = '종단 제원 : 청색 = 구조물, 적색 = 종단선형(기초상단), 황색 파선 = 계획고';
    return d;
}
