// 일반 입력 > 단면 제원 (매뉴얼 2.4)
// Box형 / U형 / 복층형 / 지하차도(블록별 U-Type·BOX구간)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bNumber, bCheck } from '../ui/dom.js';
import {
    WALL_TYPES, HAUNCH_TYPES, sectionKind, resizeSection, defaultBoxSection, defaultUSection,
    defaultDoubleSection, defaultSectionFor, blocks,
} from '../core/model.js';
import { sectionDrawing } from '../draw/sectionDraw.js';

/** 현재 편집 단면의 경로 (지하차도는 블록별 단면을 만들어 둔다) */
export function sectionPath(ctx) {
    const c = ctx.c;
    if (c.type !== '지하차도') return `${ctx.cp}.section`;
    const kind = sectionKind(c, ctx.bi);
    const cur = (c.blockSections || [])[ctx.bi];
    const ok = cur && (kind === 'U' ? cur.H1 != null : cur.H != null && cur.H1 == null);
    if (!ok) {
        const init = kind === 'U' ? { ...defaultUSection(), B: [4000, 4000], median: { use: true, Gw: 400, Gh: 500 } } : clone(c.section || defaultBoxSection(2));
        store.set(`${ctx.cp}.blockSections.${ctx.bi}`, init, { record: false, silent: true });
    }
    return `${ctx.cp}.blockSections.${ctx.bi}`;
}

function kindOf(ctx) { return sectionKind(ctx.c, ctx.bi); }

const HINT = {
    H: '구조물 내공의 높이를 입력합니다.', H4: '버림을 측면벽체까지 설치하는 경우 기초하단에서의 수직높이를 입력합니다.',
    B: '구조물 내공의 각 셀마다 폭원을 입력합니다.', UT: '상부 슬래브 두께를 입력합니다.', LT: '하부 슬래브 두께를 입력합니다.',
    WL: '좌측벽 두께를 입력합니다.', WR: '우측벽 두께를 입력합니다.', wall: '중간벽체의 형식을 결정합니다. (연속벽체, 사각/원형기둥)',
    C: '단면도상의 중간벽체 두께를 입력합니다.', H1: '구조물 벽체 높이 (하단에서 상단방향으로 입력)', WT: '벽체 상단 두께', WB: '벽체 하단 두께',
};

export default {
    scope: 'culvert',
    perBlock: (ctx) => ctx.c.type === '지하차도',
    hint: '높이를 설정합니다.',

    tabs(ctx) {
        const k = kindOf(ctx);
        if (k === 'U') return [{ id: 'sec', title: '단면제원' }, { id: 'etc', title: '기타제원' }, { id: 'haunch', title: '내부헌치' }, { id: 'af', title: '부상방지저판' }];
        if (k === 'DOUBLE') return [{ id: 'sec', title: '단면제원' }, { id: 'haunch', title: '내부헌치' }, { id: 'af', title: '부상방지저판' }, { id: 'mid', title: '중간슬래브' }];
        return [{ id: 'sec', title: '단면제원' }, { id: 'haunch', title: '내부헌치' }, { id: 'af', title: '부상방지저판' }];
    },

    header(el, ctx) {
        const k = kindOf(ctx);
        const sp = sectionPath(ctx);
        const sec = store.get(sp);
        if (k !== 'U') {
            const s = h('select', {});
            for (let i = 1; i <= 10; i++) {
                const o = h('option', { value: i }, `${i}련`);
                if (i === sec.cells) o.selected = true;
                s.appendChild(o);
            }
            s.addEventListener('change', () => store.set(sp, resizeSection(clone(sec), +s.value)));
            el.appendChild(h('label', {}, ['암거련수 ', s]));
        }
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [button('암거 표준도', () => ctx.go('standard'))]));
    },

    render(el, ctx, tab) {
        const sp = sectionPath(ctx);
        const sec = store.get(sp);
        const k = kindOf(ctx);
        if (tab === 'sec') {
            if (k === 'U') renderU(el, sp, sec, ctx);
            else if (k === 'DOUBLE') renderDouble(el, sp, sec);
            else renderBox(el, sp, sec);
        } else if (tab === 'haunch') {
            if (k === 'U') renderHaunchU(el, sp, sec);
            else if (k === 'DOUBLE') renderHaunchDouble(el, sp, sec);
            else renderHaunchBox(el, sp, sec);
        } else if (tab === 'af') {
            renderAntiFloat(el, sp, sec);
        } else if (tab === 'etc') {
            renderEtcU(el, sp, sec, ctx);
        } else if (tab === 'mid') {
            new Grid(el, {
                id: 'sec-mid',
                head: [[{ t: '높이' }, { t: '두께' }], [{ t: 'MH' }, { t: 'MT' }]],
                rows: [{ cells: [num(`${sp}.MH`, { field: 'MH', hint: '하부슬래브에서 중간슬래브까지의 내측높이를 입력합니다.' }), num(`${sp}.MT`, { field: 'MT', hint: '중간슬래브의 두께를 설정합니다.' })] }],
                colWidths: [80, 80],
            });
        }
        el.appendChild(h('div', { class: 'note' }, '* 모든 치수 단위: mm. 확인창의 노란 변수명을 클릭하면 해당 셀로 이동합니다.'));
    },

    footer(el, ctx) {
        el.appendChild(button('동일타입 동일적용', () => applySameType(ctx), { disabled: ctx.c.type !== '지하차도', title: '현재 블록 단면을 같은 구간타입의 모든 블록에 적용' }));
        el.appendChild(bNumber(`${ctx.cp}.offset`, { label: '선형과 암거중심의 이격거리(mm) :', dec: 1, width: 70 }));
        el.appendChild(bCheck(`${ctx.cp}.showInputPos`, ' 입력위치 표시', { disabled: ctx.c.type !== '지하차도' }));
    },

    defaults(ctx, tab) {
        const sp = sectionPath(ctx);
        const k = kindOf(ctx);
        const cur = clone(store.get(sp));
        let d = k === 'U' ? defaultUSection() : k === 'DOUBLE' ? defaultDoubleSection(cur.cells || 3) : defaultBoxSection(cur.cells || 2);
        if (k !== 'U') d = resizeSection(d, cur.cells || d.cells);
        if (tab === 'haunch') { cur.haunch = d.haunch; if (d.haunch2) cur.haunch2 = d.haunch2; store.set(sp, cur); }
        else if (tab === 'af') { cur.antiFloat = d.antiFloat; store.set(sp, cur); }
        else if (tab === 'etc') { cur.cover = d.cover; cur.bracket = d.bracket; cur.median = d.median; store.set(sp, cur); }
        else if (tab === 'mid') { cur.MH = d.MH; cur.MT = d.MT; store.set(sp, cur); }
        else store.set(sp, { ...d, lean: cur.lean || d.lean });
    },

    draw(ctx) {
        sectionPath(ctx);
        const b = blocks(ctx.c)[ctx.bi] || { sta0: ctx.c.startSta };
        const d = sectionDrawing(ctx.p, ctx.c, ctx.bi, { sta: b.sta0, names: true });
        if (ctx.c.type === '지하차도') d.legend = `BLOCK ${ctx.bi + 1} : ${(ctx.c.zones || [])[ctx.bi] || 'BOX구간'}`;
        return d;
    },
    viewKey: (ctx) => `section|${ctx.ci}|${ctx.bi}|${kindOf(ctx)}`,
};

// ── Box ───────────────────────────────────────────────────────────────

function ltCell(sp, sec, field = 'LT', path = `${sp}.LT`) {
    return custom('num', () => store.get(path), (v) => {
        store.transact(() => {
            store.set(path, v);
            const af = store.get(`${sp}.antiFloat`);
            if (af && af.brH2Auto !== false && path === `${sp}.LT`) store.set(`${sp}.antiFloat.brH2`, v);
        });
    }, { field, hint: HINT.LT });
}

function renderBox(el, sp, sec) {
    const n = sec.cells;
    const head0 = [{ t: '내공제원', cs: 2 + n }, { t: '슬래브두께', cs: 2 }, { t: '벽체두께/형식', cs: 2 + (n - 1) * 2 }];
    const head1 = [{ t: '높이', cs: 2 }, { t: '폭원', cs: n }, { t: '상부' }, { t: '하부' }, { t: '좌측벽' }];
    if (n > 1) head1.push({ t: '중간벽체', cs: (n - 1) * 2 });
    head1.push({ t: '우측벽' });
    const head2 = [{ t: 'H' }, { t: 'H4' }];
    for (let i = 0; i < n; i++) head2.push({ t: `B${i + 1}` });
    head2.push({ t: 'UT' }, { t: 'LT' }, { t: 'WL' });
    for (let i = 0; i < n - 1; i++) head2.push({ t: `벽체${i + 1}` }, { t: `C${i + 1}` });
    head2.push({ t: 'WR' });
    const cells = [num(`${sp}.H`, { field: 'H', hint: HINT.H }), num(`${sp}.H4`, { field: 'H4', hint: HINT.H4 })];
    for (let i = 0; i < n; i++) cells.push(num(`${sp}.B.${i}`, { field: `B${i + 1}`, hint: HINT.B }));
    cells.push(num(`${sp}.UT`, { field: 'UT', hint: HINT.UT }), ltCell(sp, sec), num(`${sp}.WL`, { field: 'WL', hint: HINT.WL }));
    for (let i = 0; i < n - 1; i++) {
        cells.push(sel(`${sp}.walls.${i}.type`, WALL_TYPES, { hint: HINT.wall }));
        cells.push(num(`${sp}.walls.${i}.C`, { field: `C${i + 1}`, hint: HINT.C }));
    }
    cells.push(num(`${sp}.WR`, { field: 'WR', hint: HINT.WR }));
    new Grid(el, { id: 'sec-box', head: [head0, head1, head2], rows: [{ cells }] });
}

// ── 복층 ─────────────────────────────────────────────────────────────

function renderDouble(el, sp, sec) {
    const n = sec.cells;
    const head0 = [{ t: '구분', rs: 3 }, { t: '내공제원', cs: 2 + n }, { t: '슬래브두께', cs: 2 }, { t: '벽체두께/형식', cs: 2 + (n - 1) * 2 }];
    const head1 = [{ t: '높이', cs: 2 }, { t: '폭원', cs: n }, { t: '상부' }, { t: '하부' }, { t: '좌측벽' }];
    if (n > 1) head1.push({ t: '중간벽체', cs: (n - 1) * 2 });
    head1.push({ t: '우측벽' });
    const head2 = [{ t: 'H' }, { t: 'H4' }];
    for (let i = 0; i < n; i++) head2.push({ t: `B${i + 1}` });
    head2.push({ t: 'UT' }, { t: 'LT' }, { t: 'WL' });
    for (let i = 0; i < n - 1; i++) head2.push({ t: `벽체${i + 1}` }, { t: `C${i + 1}` });
    head2.push({ t: 'WR' });
    const storey = (key) => {
        const out = [];
        out.push(key === 'lower' ? ltCell(sp, sec, 'LT', `${sp}.lower.LT`) : num(`${sp}.upper.LT`, { hint: '2층 하부(중간슬래브측) 두께' }));
        out.push(num(`${sp}.${key}.WL`, { field: key === 'lower' ? 'WL' : undefined, hint: HINT.WL }));
        for (let i = 0; i < n - 1; i++) {
            out.push(sel(`${sp}.${key}.walls.${i}.type`, WALL_TYPES, { hint: HINT.wall }));
            out.push(num(`${sp}.${key}.walls.${i}.C`, { field: key === 'lower' ? `C${i + 1}` : undefined, hint: HINT.C }));
        }
        out.push(num(`${sp}.${key}.WR`, { field: key === 'lower' ? 'WR' : undefined, hint: HINT.WR }));
        return out;
    };
    const shared = [num(`${sp}.H`, { field: 'H', rs: 2, hint: '구조물 내공의 전체 높이 (하부슬래브 상면 ~ 상부슬래브 하면)' }), num(`${sp}.H4`, { rs: 2, field: 'H4', hint: HINT.H4 })];
    for (let i = 0; i < n; i++) shared.push(num(`${sp}.B.${i}`, { field: `B${i + 1}`, rs: 2, hint: HINT.B }));
    shared.push(num(`${sp}.UT`, { field: 'UT', rs: 2, hint: HINT.UT }));
    new Grid(el, {
        id: 'sec-double',
        head: [head0, head1, head2],
        rows: [
            { head: [{ t: '2층' }], cells: [...shared, ...storey('upper')] },
            { head: [{ t: '1층' }], cells: storey('lower') },
        ],
    });
    // 하층 값과 공통 키 동기화 (LT/WL/WR/walls)
}

// ── U형 ───────────────────────────────────────────────────────────────

function renderU(el, sp, sec, ctx) {
    const under = ctx.c.type === '지하차도';
    const head0 = [{ t: '내공제원', cs: under ? 6 : 5 }, { t: '슬래브두께' }, { t: '벽체두께', cs: 2 }];
    const head1 = [{ t: '높이', cs: 4 }, { t: '폭원', cs: under ? 2 : 1 }, { t: '하부' }, { t: '상부' }, { t: '하부' }];
    const head2 = [{ t: 'H1' }, { t: 'H2' }, { t: 'H3' }, { t: 'H4' }, { t: 'B1' }];
    if (under) head2.push({ t: 'B2' });
    head2.push({ t: 'LT' }, { t: 'WT' }, { t: 'WB' });
    const cells = [
        num(`${sp}.H1`, { field: 'H1', hint: HINT.H1 }),
        num(`${sp}.H2`, { field: 'H2', hint: HINT.H1 }),
        num(`${sp}.H3`, { field: 'H3', hint: HINT.H1 }),
        num(`${sp}.H4`, { field: 'H4', hint: HINT.H4 }),
        num(`${sp}.B.0`, { field: 'B1', hint: '구조물 내공의 폭원을 입력합니다.' }),
    ];
    if (under) cells.push(num(`${sp}.B.1`, { field: 'B2', hint: '중분대 우측 내공 폭원 (0 = 없음)' }));
    cells.push(ltCell(sp, sec), num(`${sp}.WT`, { field: 'WT', hint: HINT.WT }), num(`${sp}.WB`, { field: 'WB', hint: HINT.WB }));
    new Grid(el, { id: 'sec-u', head: [head0, head1, head2], rows: [{ cells }] });
    if (under) {
        el.appendChild(h('div', { class: 'inline-opts', style: { marginTop: '4px' } }, [
            bCheck(`${sp}.varying`, ' 시종점변화단면'),
            bCheck(`${sp}.lrSeparate`, ' 좌우측 벽체 제원입력'),
            h('span', {}, '※ 벽체 높이(H2)는 [종단 제원]의 높이에 맞춰 조정됩니다.'),
        ]));
    }
}

function renderEtcU(el, sp, sec, ctx) {
    const under = ctx.c.type === '지하차도';
    const head0 = [], head1 = [], cells = [];
    if (under) {
        head0.push({ t: '1.중분대', cs: 3 });
        head1.push({ t: '설치' }, { t: 'Gw' }, { t: 'Gh' });
        const off = !(sec.median && sec.median.use);
        cells.push(chk(`${sp}.median.use`, { hint: '중분대의 설치유무를 선택합니다.' }), num(`${sp}.median.Gw`, { disabled: off, field: 'Gw' }), num(`${sp}.median.Gh`, { disabled: off, field: 'Gh' }));
    }
    const coff = !(sec.cover && sec.cover.use), boff = !(sec.bracket && sec.bracket.use);
    head0.push({ t: `${under ? '2' : '1'}.덮개`, cs: 4 }, { t: `${under ? '3' : '2'}.브래킷`, cs: 3 });
    head1.push({ t: '설치' }, { t: '하중' }, { t: 'Cb' }, { t: 'Ch' }, { t: '설치' }, { t: 'Bb' }, { t: 'Bh' });
    cells.push(
        chk(`${sp}.cover.use`, { hint: '덮개의 설치유무를 선택합니다.' }),
        num(`${sp}.cover.load`, { dec: 3, disabled: coff, hint: '덮개로 인한 하중 (kN/m)' }),
        num(`${sp}.cover.Cb`, { disabled: coff, field: 'Cb', hint: '벽체상단 내측방향 절단부 폭' }),
        num(`${sp}.cover.Ch`, { disabled: coff, field: 'Ch', hint: '벽체상단 내측방향 절단부 깊이' }),
        chk(`${sp}.bracket.use`, { hint: '브래킷의 설치유무를 선택합니다.' }),
        num(`${sp}.bracket.Bb`, { disabled: boff, field: 'Bb', hint: '벽체상단 외측방향 절단부 폭' }),
        num(`${sp}.bracket.Bh`, { disabled: boff, field: 'Bh', hint: '벽체상단 외측방향 절단부 깊이' }),
    );
    new Grid(el, { id: 'sec-etc', head: [head0, head1], rows: [{ cells }] });
}

// ── 내부헌치 ─────────────────────────────────────────────────────────

function haunchCells(path, hc, types) {
    const t = hc.type || '삼각형';
    const off = !hc.use;
    const en = {
        S1: t !== '삼각형', S2: t !== '사각형', S3: t !== '삼각형',
        W1: t !== '삼각형', W2: t !== '사각형', W3: t !== '삼각형',
    };
    const c = (k) => (off || !en[k] ? dash() : num(`${path}.${k}`, { hint: k.endsWith('2') ? '삼각헌치 가로/세로 크기 (mm)' : '사각헌치 가로/세로 크기 (mm)' }));
    return [
        chk(`${path}.use`, { hint: '내부헌치 설치유무 (삼각형/사각형/혼합형)' }),
        off ? dash() : sel(`${path}.type`, types),
        c('S1'), c('S2'), c('S3'), c('W1'), c('W2'), c('W3'),
    ];
}

function haunchHead(n) {
    const h0 = [{ t: '구분', cs: 2, rs: 2 }];
    const h1 = [];
    for (let i = 0; i < n; i++) {
        h0.push({ t: `${i + 1}련`, cs: 8 });
        h1.push({ t: '설치' }, { t: '타입' }, { t: 'S1' }, { t: 'S2' }, { t: 'S3' }, { t: 'W1' }, { t: 'W2' }, { t: 'W3' });
    }
    return [h0, h1];
}

function renderHaunchBox(el, sp, sec) {
    const n = sec.cells;
    const types = n >= 2 ? HAUNCH_TYPES : HAUNCH_TYPES.slice(0, 2);
    const row = (g, side, key, first) => ({
        head: first ? [{ t: g, rs: 2 }, { t: side }] : [{ t: side }],
        cells: Array.from({ length: n }, (_, i) => haunchCells(`${sp}.haunch.${i}.${key}`, (sec.haunch[i] || {})[key] || {}, types)).flat(),
    });
    new Grid(el, {
        id: 'sec-haunch', head: haunchHead(n),
        rows: [row('상부', '좌측', 'UL', true), row('상부', '우측', 'UR', false), row('하부', '좌측', 'LL', true), row('하부', '우측', 'LR', false)],
    });
}

function renderHaunchU(el, sp, sec) {
    const types = HAUNCH_TYPES.slice(0, 2);
    const hc = (sec.haunch || [{}])[0] || {};
    new Grid(el, {
        id: 'sec-haunch-u',
        head: [[{ t: '구분', rs: 2 }, { t: '1련', cs: 8 }], [{ t: '설치' }, { t: '타입' }, { t: 'S1' }, { t: 'S2' }, { t: 'S3' }, { t: 'W1' }, { t: 'W2' }, { t: 'W3' }]],
        rows: [
            { head: [{ t: '좌측' }], cells: haunchCells(`${sp}.haunch.0.LL`, hc.LL || {}, types) },
            { head: [{ t: '우측' }], cells: haunchCells(`${sp}.haunch.0.LR`, hc.LR || {}, types) },
        ],
    });
}

function renderHaunchDouble(el, sp, sec) {
    const n = sec.cells;
    const h2 = sec.haunch2 || {};
    const rows = [];
    for (const [fl, key] of [['2층', 'upper'], ['1층', 'lower']]) {
        [['상부', '좌측', 'UL'], ['상부', '우측', 'UR'], ['하부', '좌측', 'LL'], ['하부', '우측', 'LR']].forEach(([g, side, k], j) => {
            const head = [];
            if (j === 0) head.push({ t: fl, rs: 4 });
            if (j % 2 === 0) head.push({ t: g, rs: 2 });
            head.push({ t: side });
            rows.push({
                head,
                cells: Array.from({ length: n }, (_, i) => haunchCells(`${sp}.haunch2.${key}.${i}.${k}`, ((h2[key] || [])[i] || {})[k] || {}, HAUNCH_TYPES)).flat(),
            });
        });
    }
    const hd = haunchHead(n);
    hd[0][0] = { t: '구분', cs: 3, rs: 2 };
    new Grid(el, { id: 'sec-haunch-d', head: hd, rows });
}

// ── 부상방지저판 ─────────────────────────────────────────────────────

function renderAntiFloat(el, sp, sec) {
    const af = sec.antiFloat || {};
    const off = !af.use;
    new Grid(el, {
        id: 'sec-af',
        head: [[{ t: '설치' }, { t: 'brW' }, { t: 'brH1' }, { t: 'brH2' }]],
        rows: [{
            cells: [
                chk(`${sp}.antiFloat.use`, { hint: '부상방지저판의 설치유무를 선택합니다.' }),
                off ? dash() : num(`${sp}.antiFloat.brW`, { field: 'brW', hint: '부상방지저판의 돌출길이를 입력합니다.' }),
                off ? dash() : num(`${sp}.antiFloat.brH1`, { field: 'brH1', hint: '벽체위치에서 두께가 변화되는 경우 추가높이를 입력합니다.' }),
                off ? dash() : custom('num', () => af.brH2, (v) => store.transact(() => { store.set(`${sp}.antiFloat.brH2`, v); store.set(`${sp}.antiFloat.brH2Auto`, v === (sec.LT ?? (sec.lower && sec.lower.LT))); }), { field: 'brH2', hint: '부상방지저판의 두께를 입력합니다. (기본값 = 하부슬래브 두께 LT)' }),
            ],
        }],
        colWidths: [50, 80, 80, 80],
    });
}

function applySameType(ctx) {
    const c = ctx.c;
    const zone = (c.zones || [])[ctx.bi];
    const src = clone(store.get(sectionPath(ctx)));
    store.transact(() => {
        blocks(c).forEach(b => {
            if (b.index !== ctx.bi && (c.zones || [])[b.index] === zone) store.set(`${ctx.cp}.blockSections.${b.index}`, clone(src));
        });
    });
}

export { defaultSectionFor };
