// 배근 입력 > 배근 설정 (매뉴얼 5.1)
// 탭: 배근옵션 | 철근피복 | 철근배치 | 철근단위질량및 단위면적 | 철근정착,이음보정계수 | 정착장 | 이음장 | 철근기호
//
// 데이터: 블록별 culverts[i].rebar.settings[bi] (배치옵션·피복·사보강·배치단수),
//         프로젝트 공통 rebarCommon (철근 제원·보정계수·정착/이음 표·산출방법·철근기호).
// 배치옵션(1/2/4Cycle)은 주철근(3Cycle)·(2,4Cycle) 화면의 enabled 판정에 쓰인다 (calc/rebar.js cyclesOf).
//
// 다른 배근 화면이 쓰는 공용 UI 도우미도 여기서 내보낸다: ensureSettings, settingsPath, liveModal, sameBlockPopup, ensure.

import store, { clone } from '../core/store.js';
import { Grid, propGrid } from '../ui/grid.js';
import { num, sel, txt, lbl, custom, chk } from '../ui/cells.js';
import { h, button, modal, confirmBox, bCheck } from '../ui/dom.js';
import { blocks } from '../core/model.js';
import { sectionDrawing } from '../draw/sectionDraw.js';
import {
    DIAS, DIA_TABLE, CYCLE_OPTIONS, ROUND_LEN, UPPER_SCOPE, MIDWALL_BEND, SKEW_OPTIONS, LAP_METHODS, LAP_ROUNDS,
    MARK_KEYS, defaultSettings, defaultCover, defaultRebarCommon, anchorageTable, lapTable,
} from '../calc/rebar.js';

// ── 공용 도우미 ──────────────────────────────────────────────────────

/** 값이 없으면 기본값을 기록 없이 넣는다 */
export function ensure(path, make) {
    if (store.get(path) == null) store.set(path, typeof make === 'function' ? make() : make, { record: false, silent: true });
    return path;
}

export const settingsPath = (ctx, bi = ctx.bi) => `${ctx.cp}.rebar.settings.${bi}`;

/** 블록 배근설정과 rebarCommon 을 (없으면) 만든다. 반환: settings 경로 */
export function ensureSettings(ctx) {
    ensure('rebarCommon', defaultRebarCommon);
    const sp = settingsPath(ctx);
    ensure(sp, defaultSettings);
    // 이전 버전 데이터의 누락 항목 보충
    const s = store.get(sp);
    const d = defaultSettings();
    for (const k of Object.keys(d)) if (s[k] == null) store.set(`${sp}.${k}`, d[k], { record: false, silent: true });
    const cm = store.get('rebarCommon');
    const dc = defaultRebarCommon();
    for (const k of Object.keys(dc)) if (cm[k] == null) store.set(`rebarCommon.${k}`, dc[k], { record: false, silent: true });
    return sp;
}

/**
 * 내용이 store 변경 때마다 다시 그려지는 모달.
 * build(body) 로 내용을 채운다. 반환: modal() 결과
 */
export function liveModal(title, build, opts = {}) {
    const body = h('div', { class: 'live-modal', style: { minWidth: (opts.minWidth || 360) + 'px' } });
    const m = modal({ title, body, buttons: opts.buttons || [{ text: '확인(O)', primary: true }], width: opts.width });
    const paint = () => {
        const sc = body.scrollTop;
        body.innerHTML = '';
        try { build(body); } catch (e) { console.error(e); body.appendChild(h('div', { class: 'note' }, '오류: ' + e.message)); }
        body.scrollTop = sc;
    };
    paint();
    const off = store.on('change', () => {
        if (!document.body.contains(body)) { off(); return; }
        paint();
    });
    return m;
}

/** "블럭 동일 적용" 팝업 (매뉴얼 5.2.8): [모든탭] [현재탭] [아니오] */
export function sameBlockPopup(onAllTabs, onCurTab) {
    modal({
        title: '블럭 동일 적용',
        body: h('div', { style: { padding: '8px 4px', minWidth: '300px' } }, '현재블럭의 입력을 동일적용 하시겠습니까?'),
        buttons: [
            { text: '모든탭', primary: true, onClick: () => { store.transact(onAllTabs); } },
            { text: '현재탭', onClick: () => { store.transact(onCurTab); } },
            { text: '아니오' },
        ],
    });
}

/** 같은 단면 형식의 다른 블록 목록 */
export function sameKindBlocks(ctx) {
    const c = ctx.c;
    const zone = (c.zones || [])[ctx.bi];
    return blocks(c).map(b => b.index).filter(i => i !== ctx.bi && (c.type !== '지하차도' || (c.zones || [])[i] === zone));
}

// ── 화면 ─────────────────────────────────────────────────────────────

const TABS = [
    { id: 'opt', title: '배근옵션' },
    { id: 'cover', title: '철근피복' },
    { id: 'skew', title: '철근배치' },
    { id: 'unit', title: '철근단위질량및 단위면적' },
    { id: 'factor', title: '철근정착,이음보정계수' },
    { id: 'dev', title: '정착장' },
    { id: 'lap', title: '이음장' },
    { id: 'mark', title: '철근기호' },
];

const COVER_ROWS = [
    ['슬래브', '상부', '상면', 'top', 'U', true],
    ['슬래브', '상부', '하면', 'top', 'L', false],
    ['슬래브', '중간', '상면', 'mid', 'U', false],
    ['슬래브', '중간', '하면', 'mid', 'L', false],
    ['슬래브', '하부', '상면', 'bottom', 'U', false],
    ['슬래브', '하부', '하면', 'bottom', 'L', true],
    ['벽체', '좌측', '외측', 'left', 'O', true],
    ['벽체', '좌측', '내측', 'left', 'I', false],
    ['벽체', '중간', '내측', 'midWall', 'I', false],
    ['벽체', '우측', '외측', 'right', 'O', true],
    ['벽체', '우측', '내측', 'right', 'I', false],
    ['평면도', '', '측면', 'plan', 'S', true],
];

export default {
    scope: 'culvert',
    perBlock: true,
    hint: '배근에 필요한 기본 옵션(배치옵션, 피복, 정착·이음, 철근기호)을 설정합니다.',

    tabs: () => TABS,

    render(el, ctx, tab) {
        const sp = ensureSettings(ctx);
        if (tab === 'opt') renderOpt(el, sp);
        else if (tab === 'cover') renderCover(el, sp);
        else if (tab === 'skew') renderSkew(el, sp);
        else if (tab === 'unit') renderUnit(el);
        else if (tab === 'factor') renderFactor(el);
        else if (tab === 'dev') renderDev(el, ctx);
        else if (tab === 'lap') renderLap(el, ctx);
        else if (tab === 'mark') renderMark(el);
    },

    footer(el, ctx, tab) {
        el.appendChild(button('배근입력 전체 기본값', () => allDefaultsPopup(ctx), { title: '모든 배근입력 화면을 기본값으로 (암거별/암거전체)' }));
        el.appendChild(button('모든 블럭 동일 적용', () => applyAllBlocks(ctx), { disabled: ctx.blocks.length < 2 }));
        if (tab === 'cover') {
            const sp = settingsPath(ctx);
            el.appendChild(bCheck(`${sp}.coverSameOuter`, ' 외측동일적용', { title: '외측면 값을 고치면 모든 외측면에 같은 값을 적용' }));
            el.appendChild(bCheck(`${sp}.coverSameInner`, ' 내측동일적용', { title: '내측면 값을 고치면 모든 내측면에 같은 값을 적용' }));
        }
    },

    defaults(ctx, tab) {
        const sp = settingsPath(ctx);
        const d = defaultSettings();
        const dc = defaultRebarCommon();
        if (tab === 'opt') {
            for (const k of ['cycle', 'ctc', 'lapStdLen', 'roundLen', 'upperScope', 'midWallBend']) store.set(`${sp}.${k}`, d[k]);
            store.set('rebarCommon.lapMethod', dc.lapMethod);
            store.set('rebarCommon.lapRound', dc.lapRound);
        } else if (tab === 'cover') store.set(`${sp}.cover`, defaultCover());
        else if (tab === 'skew') store.set(`${sp}.skew`, d.skew);
        else if (tab === 'unit') store.set('rebarCommon.diaTable', {});
        else if (tab === 'factor') { store.set('rebarCommon.factors', dc.factors); store.set('rebarCommon.coating', dc.coating); store.set('rebarCommon.lightweight', false); }
        else if (tab === 'dev') { store.set('rebarCommon.devTable', {}); store.set('rebarCommon.formula', dc.formula); }
        else if (tab === 'lap') { store.set('rebarCommon.lapTable', {}); store.set('rebarCommon.formula', dc.formula); }
        else if (tab === 'mark') store.set('rebarCommon.marks', dc.marks);
    },

    draw(ctx) {
        const b = blocks(ctx.c)[ctx.bi] || { sta0: ctx.c.startSta };
        return sectionDrawing(ctx.p, ctx.c, ctx.bi, { sta: b.sta0, names: false });
    },
    viewKey: (ctx) => `rebarSet|${ctx.ci}|${ctx.bi}`,
};

// ── 탭: 배근옵션 ─────────────────────────────────────────────────────

function renderOpt(el, sp) {
    propGrid(el, [
        { group: '주철근배치', label: '배치옵션', cell: sel(`${sp}.cycle`, CYCLE_OPTIONS, { hint: '주철근 배치 Cycle. 1Cycle → 주철근(1Cycle)만, 2Cycle → 1·2Cycle, 4Cycle → 1~4Cycle 입력이 활성화됩니다.' }) },
        { group: '주철근배치', label: 'CTC : 1C ~ 1C', cell: num(`${sp}.ctc`, { dec: 0, hint: '같은 Cycle 철근 사이의 간격 (1C ~ 1C)', validate: v => (v > 0 ? null : '간격은 0보다 커야 합니다.') }), unit: 'mm' },
        { group: '철근 겹이음 적용 길이', label: '', cell: num(`${sp}.lapStdLen`, { dec: 0, hint: '철근 정척 길이. 이 길이를 넘는 철근은 겹이음을 적용합니다.' }), unit: 'mm' },
        { group: '철근 길이 반올림 적용', label: '', cell: sel(`${sp}.roundLen`, ROUND_LEN, { hint: '철근 길이 반올림 방법' }) },
        { group: '상부 이음/정착장 적용 범위', label: '', cell: sel(`${sp}.upperScope`, UPPER_SCOPE, { hint: '상부철근 보정계수(α)를 적용할 철근 종류' }) },
        { group: '중간벽체(기둥) 수직철근 절곡부 처리', label: '', cell: sel(`${sp}.midWallBend`, MIDWALL_BEND, { hint: '중간벽체(기둥) 수직철근의 절곡부 형상 (자동: D19 이상 곡선)' }) },
        { group: '겹이음 및 정착장 산출방법', label: '', cell: sel('rebarCommon.lapMethod', LAP_METHODS, { hint: '콘크리트 설계기준 제8장 정착·이음. 산식: 계산값 사용 / 보정계수: 표의 값을 직접 수정' }) },
        { group: '철근 겹이음, 정착장 산정시 반올림', label: '', cell: sel('rebarCommon.lapRound', LAP_ROUNDS, { hint: '정착장/이음장 10mm 단위 처리' }) },
    ], { id: 'rs-opt', unitCol: true, colWidths: [220, 110, 170, 50], head: [{ t: '구    분', cs: 2 }, { t: '설 정 값' }, { t: '단위' }] });
    el.appendChild(h('div', { class: 'note' }, '* 배치옵션에 따라 [주철근 (3Cycle)] (4Cycle 전용), [주철근 (2,4Cycle)] (2·4Cycle) 메뉴가 활성화됩니다.'));
}

// ── 탭: 철근피복 ─────────────────────────────────────────────────────

function coverCell(sp, key, face, li, outer) {
    const path = `${sp}.cover.${key}.${face}.${li}`;
    return custom('num', () => store.get(path), (v) => {
        const s = store.get(sp);
        const same = outer ? s.coverSameOuter : s.coverSameInner;
        store.transact(() => {
            store.set(path, v);
            if (!same) return;
            for (const r of COVER_ROWS) {
                if (r[5] !== outer) continue;
                if (r[3] === 'plan' && li > 0) continue;
                store.set(`${sp}.cover.${r[3]}.${r[4]}.${li}`, v);
            }
        });
    }, { dec: 0, hint: `${outer ? '외측' : '내측'}면 ${li + 1}단 철근 피복 (콘크리트 면에서 철근 중심까지, mm)` });
}

function renderCover(el, sp) {
    const rows = [];
    COVER_ROWS.forEach((r, i) => {
        const head = [];
        const prev = COVER_ROWS[i - 1];
        if (!prev || prev[0] !== r[0]) head.push({ t: r[0], rs: COVER_ROWS.filter(x => x[0] === r[0]).length });
        if (r[1] === '') head.push({ t: r[2], cs: 2 });
        else {
            if (!prev || prev[1] !== r[1] || prev[0] !== r[0]) head.push({ t: r[1], rs: COVER_ROWS.filter(x => x[0] === r[0] && x[1] === r[1]).length });
            head.push({ t: r[2] });
        }
        const cells = [0, 1, 2].map(li => (r[3] === 'plan' && li > 0 ? lbl('-', { cls: 'ro', disabled: true, align: 'center' }) : coverCell(sp, r[3], r[4], li, r[5])));
        rows.push({ head, cells, cls: r[5] ? 'outer' : '' });
    });
    new Grid(el, { id: 'rs-cover', head: [[{ t: '구분', cs: 3 }, { t: '1단' }, { t: '2단' }, { t: '3단' }]], rows, colWidths: [60, 50, 50, 70, 70, 70] });
    el.appendChild(h('div', { class: 'note' }, '* 피복은 콘크리트 면에서 철근 중심까지의 거리입니다. 외측면: 상부슬래브 상면, 하부슬래브 하면, 좌/우측벽 외측, 평면도 측면.'));
}

// ── 탭: 철근배치 (사보강 배치 옵션) ─────────────────────────────────

function skewTile(kind) {
    // 사다리꼴 블록 평면 (좌: 시점 사각, 우: 종점 사각) + 철근 (검정: 직각, 빨강: 사방향)
    const W = 120, H = 70, k = 22, t = 6, b = H - 6;
    const L = [];
    const black = (x) => L.push(`<line x1="${x}" y1="${t}" x2="${x}" y2="${b}" stroke="#000"/>`);
    const redS = (x) => L.push(`<line x1="${x + k}" y1="${t}" x2="${x}" y2="${b}" stroke="#d00"/>`);   // 시점 사변과 평행
    const redE = (x) => L.push(`<line x1="${x}" y1="${t}" x2="${x + k}" y2="${b}" stroke="#d00"/>`);   // 종점 사변과 평행
    if (kind === '전체' || kind === '절반') {
        const zone = kind === '전체' ? k + 6 : (k + 6) / 2;
        for (let x = 4; x <= 4 + zone; x += 6) redS(x);
        for (let x = 4 + k + 6; x <= W - 4 - k - 6; x += 7) black(x);
        for (let x = W - 4 - k; x >= W - 4 - k - zone; x -= 6) redE(x);
    } else if (kind === '시점 경사방향') {
        for (let x = 4; x <= W - 4 - k - 6; x += 7) redS(x);
    } else {
        for (let x = W - 4 - k; x >= 4 + 6; x -= 7) redE(x);
    }
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polygon points="${4 + k},${t} ${W - 4 - k},${t} ${W - 4},${b} 4,${b}" fill="#fff" stroke="#000"/>${L.join('')}<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#888" stroke-dasharray="4 2"/></svg>`;
}

function renderSkew(el, sp) {
    const cur = store.get(`${sp}.skew`) || '전체';
    const row = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'stretch', flexWrap: 'wrap' } });
    row.appendChild(h('div', { style: { padding: '6px 10px', background: '#dfe8f6', border: '1px solid #9ab', display: 'flex', alignItems: 'center' } }, '사보강 배치 옵션'));
    for (const k of SKEW_OPTIONS) {
        const on = k === cur;
        const tile = h('div', {
            style: { border: '1px solid ' + (on ? '#c55' : '#9ab'), cursor: 'pointer', background: '#fff', minWidth: '124px' },
            title: { '전체': '사보강배치(전체)', '절반': '사보강배치(절반)', '시점 경사방향': '시점경사방향배치', '종점 경사방향': '종점경사방향배치' }[k],
            onclick: () => store.set(`${sp}.skew`, k),
        }, [
            h('div', { style: { background: on ? '#f4a08a' : '#dfe8f6', textAlign: 'center', padding: '2px', fontWeight: on ? 'bold' : 'normal' } }, k),
            h('div', { style: { padding: '2px' }, html: skewTile(k) }),
        ]);
        row.appendChild(tile);
    }
    el.appendChild(row);
    el.appendChild(h('div', { class: 'note' }, '* 사각이 있는 블록에서 주철근 입력구간(직구간 / 시점구간 / 종점구간)을 결정합니다.'));
}

// ── 탭: 철근단위질량 및 단위면적 ─────────────────────────────────────

function renderUnit(el) {
    const rows = DIAS.map(dia => {
        const t = DIA_TABLE[dia];
        const path = `rebarCommon.diaTable.${dia}.mass`;
        return {
            head: [{ t: dia }],
            cells: [
                custom('num', () => store.get(path) ?? t.mass, (v) => store.set(path, v), { dec: 3, hint: '철근재료표의 중량 계산에 쓰는 단위질량 (kg/m)' }),
                lbl(t.area, { dec: 3, cls: 'ro', hint: '계산에 적용되는 항목이어서 수정할 수 없습니다.' }),
                lbl(t.d, { dec: 3, cls: 'ro' }),
                lbl(t.perim, { dec: 3, cls: 'ro' }),
                lbl(t.bendR, { dec: 0, cls: 'ro', hint: '모서리 구부림 반지름 (mm)' }),
                lbl(t.bendLen, { dec: 0, cls: 'ro', hint: '모서리 절곡시 적용값 ≈ π/2 × 구부림 반지름 (mm)' }),
            ],
        };
    });
    new Grid(el, {
        id: 'rs-unit',
        head: [[{ t: '철근호칭' }, { t: '단위질량 (kg/m)' }, { t: '단면적 (mm²)' }, { t: '지 름 (mm)' }, { t: '둘 레 (mm)' }, { t: '모서리 구부림 반지름(mm)' }, { t: '모서리 절곡시 적용값(mm)' }]],
        rows, colWidths: [60, 90, 90, 80, 80, 120, 120],
    });
}

// ── 탭: 보정계수 ─────────────────────────────────────────────────────

function renderFactor(el) {
    const F = 'rebarCommon.factors';
    const rows = [
        { head: [{ t: 'α', rs: 2 }, { t: '상부철근' }], cells: [num(`${F}.alpha.top`, { dec: 2, hint: '철근배치 위치계수: 상부철근 (아래에 300mm 넘게 콘크리트를 친 수평철근)' })] },
        { head: [{ t: '일반철근' }], cells: [num(`${F}.alpha.normal`, { dec: 2 })] },
        { head: [{ t: 'β', rs: 3 }, { t: '피복두께 3db미만, 순간격 6db미만 도막철근' }], cells: [num(`${F}.beta.coated1`, { dec: 2, hint: '도막계수' })] },
        { head: [{ t: '기타도막철근' }], cells: [num(`${F}.beta.coated2`, { dec: 2 })] },
        { head: [{ t: '도막되지 않은철근' }], cells: [num(`${F}.beta.none`, { dec: 2 })] },
        { head: [{ t: 'γ', rs: 2 }, { t: 'D22이상의 철근' }], cells: [num(`${F}.gamma.large`, { dec: 2, hint: '철근 크기계수' })] },
        { head: [{ t: 'D19이하의 철근과 이형철선' }], cells: [lbl(() => store.get(`${F}.gamma.small`), { dec: 2, cls: 'ro', hint: '기준값 0.8 (고정)' })] },
        { head: [{ t: 'λ', rs: 2 }, { t: '경량콘크리트' }], cells: [num(`${F}.lambda.light`, { dec: 2, hint: '경량콘크리트계수' })] },
        { head: [{ t: '일반콘크리트' }], cells: [num(`${F}.lambda.normal`, { dec: 2 })] },
    ];
    new Grid(el, { id: 'rs-factor', head: [[{ t: '구분' }, { t: '종류' }, { t: '계수' }]], rows, colWidths: [40, 280, 80] });
    el.appendChild(h('div', { class: 'inline-opts', style: { marginTop: '4px' } }, [
        h('label', {}, ['적용 도막 ', (() => {
            const s = h('select', {});
            [['none', '도막되지 않은철근'], ['coated1', '도막철근(피복 3db 미만 등)'], ['coated2', '기타 도막철근']].forEach(([v, l]) => {
                const o = h('option', { value: v }, l);
                if (store.get('rebarCommon.coating') === v) o.selected = true;
                s.appendChild(o);
            });
            s.addEventListener('change', () => store.set('rebarCommon.coating', s.value));
            return s;
        })()]),
        bCheck('rebarCommon.lightweight', ' 경량콘크리트'),
    ]));
    el.appendChild(h('div', { class: 'note' }, '* 콘크리트구조설계기준 8.2.2 정착길이 보정계수. 정착장/이음장 표에 반영됩니다.'));
}

// ── 탭: 정착장 / 이음장 ─────────────────────────────────────────────

const isFormula = () => (store.get('rebarCommon.lapMethod') || LAP_METHODS[0]) === LAP_METHODS[0];

function tableCell(tableKey, dia, key, getRow) {
    if (isFormula()) return lbl(() => getRow()[key], { dec: 0, cls: 'ro', hint: '산식에 의한 계산값 (배근옵션에서 보정계수에 의한 방법을 선택하면 수정할 수 있습니다)' });
    const path = `rebarCommon.${tableKey}.${dia}.${key}`;
    return custom('num', () => getRow()[key], (v) => store.set(path, v), { dec: 0, hint: '보정계수에 의한 방법: 입력값이 최종값으로 철근에 적용됩니다.' });
}

function formulaRows(ncols) {
    if (!isFormula()) return [];
    return [
        { head: [{ t: '피복두께' }], cells: [num('rebarCommon.formula.cover', { dec: 0, cs: ncols, hint: '산식에 적용할 피복두께 (mm)' })] },
        { head: [{ t: '철근간격' }], cells: [num('rebarCommon.formula.spacing', { dec: 0, cs: ncols, hint: '산식에 적용할 철근 간격 (mm)' })] },
    ];
}

function renderDev(el, ctx) {
    const tbl = anchorageTable(ctx.p);
    const keys = ['basic', 'normal', 'top', 'cBasic', 'cSpiral'];
    const rows = tbl.map(r => ({ head: [{ t: r.dia }], cells: keys.map(k => tableCell('devTable', r.dia, k, () => anchorageTable(store.project).find(x => x.dia === r.dia))) }));
    rows.push(...formulaRows(keys.length));
    new Grid(el, {
        id: 'rs-dev',
        head: [
            [{ t: '철근호칭', rs: 2 }, { t: '인장철근', cs: 3 }, { t: '압축철근', cs: 2 }],
            [{ t: '기본정착' }, { t: '일반철근' }, { t: '상부철근' }, { t: '기본정착' }, { t: '나선철근' }],
        ],
        rows, colWidths: [70, 80, 80, 80, 80, 80],
    });
    el.appendChild(h('div', { class: 'note' }, `* ${store.get('rebarCommon.lapMethod')} · ${store.get('rebarCommon.lapRound')} (10mm), fck=${(ctx.p.design && ctx.p.design.env && ctx.p.design.env.fck) || 24} MPa, fy=${(ctx.p.design && ctx.p.design.env && ctx.p.design.env.fy) || 300} MPa`));
}

function renderLap(el, ctx) {
    const tbl = lapTable(ctx.p);
    const keys = ['nA', 'nB', 'tA', 'tB', 'c', 'cTie', 'spiral'];
    const rows = tbl.map(r => ({ head: [{ t: r.dia }], cells: keys.map(k => tableCell('lapTable', r.dia, k, () => lapTable(store.project).find(x => x.dia === r.dia))) }));
    rows.push(...formulaRows(keys.length));
    new Grid(el, {
        id: 'rs-lap',
        head: [
            [{ t: '철근호칭', rs: 3 }, { t: '인장철근', cs: 4 }, { t: '압축철근', cs: 2 }, { t: '나선철근', rs: 3 }],
            [{ t: '일반', cs: 2 }, { t: '상부', cs: 2 }, { t: '일반', rs: 2 }, { t: '폐합 띠철근', rs: 2 }],
            [{ t: 'A급' }, { t: 'B급' }, { t: 'A급' }, { t: 'B급' }],
        ],
        rows, colWidths: [70, 70, 70, 70, 70, 70, 80, 70],
    });
}

// ── 탭: 철근기호 ─────────────────────────────────────────────────────

function renderMark(el) {
    new Grid(el, {
        id: 'rs-mark',
        head: [[{ t: '구분' }, { t: '철근기호' }]],
        rows: MARK_KEYS.map(([k, t]) => ({ head: [{ t }], cells: [txt(`rebarCommon.marks.${k}`, { hint: `${t} 철근기호 접두어 (예: ${t === '상부슬래브' ? 'T1, T2 …' : '…'})` })] })),
        colWidths: [140, 90],
    });
}

// ── 버튼 ─────────────────────────────────────────────────────────────

function applyAllBlocks(ctx) {
    const src = clone(store.get(settingsPath(ctx)));
    store.transact(() => {
        for (const b of ctx.blocks) if (b.index !== ctx.bi) store.set(settingsPath(ctx, b.index), clone(src));
    });
    ctx.setHint('현재 블록의 배근설정을 모든 블록에 적용했습니다.');
}

function allDefaultsPopup(ctx) {
    const run = async (all) => {
        const ok = await confirmBox(`${all ? '모든 암거' : '현재 암거'}의 배근입력 전체를 기본값으로 다시 설정합니다.\n기존 배근 입력값은 모두 지워집니다. 계속하시겠습니까?`, '배근입력 전체 기본값');
        if (!ok) return;
        store.transact(() => {
            const list = all ? ctx.p.culverts.map((_, i) => i) : [ctx.ci];
            for (const i of list) store.set(`culverts.${i}.rebar`, {});
            if (all) store.set('rebarCommon', defaultRebarCommon());
        });
        ctx.setHint('배근입력을 기본값으로 다시 설정했습니다. (Ctrl+Z 로 취소)');
    };
    modal({
        title: '배근입력 전체 기본값',
        body: h('div', { style: { padding: '8px 4px', minWidth: '320px', whiteSpace: 'pre-line' } }, '배근입력의 모든 항목을 기본값으로 설정합니다.\n적용 범위를 선택하세요.'),
        buttons: [
            { text: '암거 기본값', primary: true, onClick: () => { run(false); } },
            { text: '암거전체 기본값', onClick: () => { run(true); } },
            { text: '취소' },
        ],
    });
}

export { chk };
