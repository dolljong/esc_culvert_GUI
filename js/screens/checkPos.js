// 구조 계산 > 검토 위치 설정 (매뉴얼 4.2)
// 탭: 위치설정 / 지반정보 / 포장상세 / 내부하중
// 데이터: culverts[i].checks (형식은 js/calc/loadHelpers.js 머리 주석)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom, txt, btn } from '../ui/cells.js';
import { h, button, bCheck, bSelect, bNumber, modal, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { blocks, fmtSta, jointStations } from '../core/model.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { drawProfile, newPlanDrawing } from '../draw/planDraw.js';
import {
    defaultChecks, defaultCheckRow, defaultBoring, defaultPave, defaultInner, autoCover, sectionName,
    checkCondition, blockAt, PAVE_LAYERS, groundElAt,
} from '../calc/loadHelpers.js';
import { buoyancyCheck, bearingCheck } from '../calc/buoyancy.js';
import { getDesign } from '../calc/design.js';
import { propTable } from './designCond.js';

const TABS = [
    { id: 'pos', title: '위치설정' },
    { id: 'boring', title: '지반정보' },
    { id: 'pave', title: '포장상세' },
    { id: 'inner', title: '내부하중' },
];

const BORING_NAMES = [
    '실트', '점토', '모래 몰탈', '자갈질 모래 콘크리트', '실트질 모래', '실트질 자갈', '점토질 모래', '점토질 자갈', '풍화암', '연암', '경암', '퇴적토', '표토',
    '매립토', '취약암', '풍화토', '이탄토', '자갈', '호박돌', '붕적토', '사질토', '극경암', '보통암', '충적토', '전석',
    '실트 섞인 점토(CL)', '점토 섞인 실트(ML)', '점토 섞인 모래(SC)', '실트 섞인 모래(SM)', '점토 섞인 자갈(GC)', '모래(SP)', '실트 섞인 자갈(GM)',
    '모래와 자갈 섞인 호박돌', '풍화 잔류토(RS)', '풍화암(WR)', '연암(SR)', '경암(HR)',
];

const sel_ = { row: 0, layer: 0 };   // 선택 행 (위치설정), 선택 층 (지반정보)

/** 검토 단면 선택 (공용: loadDef 에서도 사용) */
export const secState = { k: 0 };

/** 렌더 시 기본값 생성 (기록 없음) 후 checks 반환 */
export function ensureChecks(ctx) {
    let ch = ctx.c.checks;
    if (!ch || !Array.isArray(ch.rows) || !ch.rows.length) {
        ch = defaultChecks(ctx.p, ctx.c);
        store.set(`${ctx.cp}.checks`, ch, { record: false, silent: true });
    } else {
        // 누락 항목 보충
        let changed = false;
        const fix = clone(ch);
        fix.rows.forEach((r, i) => {
            if (!r.boring) { r.boring = defaultBoring(ctx.p, ctx.c, +r.sta || 0); changed = true; }
            if (!r.pave) { r.pave = defaultPave(); changed = true; }
            if (!r.inner) { r.inner = defaultInner(); changed = true; }
        });
        if (!fix.view) { fix.view = { profile: true, all: false, boring: false }; changed = true; }
        if (changed) { store.set(`${ctx.cp}.checks`, fix, { record: false, silent: true }); ch = fix; }
    }
    if (secState.k >= ch.rows.length) secState.k = ch.rows.length - 1;
    if (secState.k < 0) secState.k = 0;
    return store.get(`${ctx.cp}.checks`);
}

/** 머리줄 "단면 A-A ▾ ◀ ▶" */
export function sectionSelector(ctx, onChange) {
    const ch = ensureChecks(ctx);
    const s = h('select');
    ch.rows.forEach((r, i) => { const o = h('option', { value: i }, r.name); if (i === secState.k) o.selected = true; s.appendChild(o); });
    const go = (k) => { secState.k = Math.max(0, Math.min(ch.rows.length - 1, k)); (onChange || ctx.rerender)(); };
    s.addEventListener('change', () => go(+s.value));
    return h('span', { class: 'sel-nav' }, [s, h('button', { class: 'btn', style: { minWidth: '22px' }, onclick: () => go(secState.k - 1) }, '◀'), h('button', { class: 'btn', style: { minWidth: '22px' }, onclick: () => go(secState.k + 1) }, '▶')]);
}

// ── 탭 렌더 ──────────────────────────────────────────────────────────

function renderPos(el, ctx, ch) {
    const cp = `${ctx.cp}.checks`;
    const nb = blocks(ctx.c).length;
    el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '3px' } }, [
        bCheck(`${cp}.manualCalc`, ' 계산검토용 직접입력', { title: '해제하면 종단자료(지반고/지하수위)에서 자동으로 구합니다.' }),
        bCheck(`${cp}.manualBuoy`, ' 부력검토용 직접입력'),
        h('span', {}, '토피 = 지표 ~ 구조물 상단 (포장·방수몰탈 포함), 지하수위 = 지표 기준 (아래 −)'),
    ]));
    const rows = ch.rows.map((r, i) => {
        const rp = `${cp}.rows.${i}`;
        const auto = autoCover(ctx.p, ctx.c, +r.sta || 0, Math.min(nb - 1, r.block | 0));
        const man = !!ch.manualCalc, manB = !!ch.manualBuoy;
        const v = (m, path, autoV, o = {}) => (m ? num(path, { dec: 0, ...o }) : lbl(autoV, { dec: 0, cls: 'ro', ...o }));
        const c2 = (m, path, autoV) => (m ? chk(path) : lbl(autoV ? '☑' : '☐', { cls: 'ro', align: 'center' }));
        return {
            cells: [
                txt(`${rp}.name`, { hint: '검토단면 이름' }),
                lbl(ctx.c.type === '지하차도' ? ((ctx.c.zones || [])[r.block] === 'U-Type' ? 'U형' : 'Box형') : ctx.c.type, { cls: 'ro' }),
                custom('num', () => store.get(`${rp}.sta`), (val) => store.transact(() => { store.set(`${rp}.sta`, val); store.set(`${rp}.block`, blockAt(ctx.c, val)); }), { dec: 2, hint: '검토단면의 Station (m)' }),
                sel(`${rp}.block`, Array.from({ length: nb }, (_, b) => ({ value: b, label: String(b + 1) })), { hint: '단면 형상을 가져올 BLOCK' }),
                v(man, `${rp}.cover`, auto.cover, { hint: '계산검토용 토피 (mm)' }),
                c2(man, `${rp}.gwOn`, auto.gwOn),
                v(man, `${rp}.gwl`, auto.gwl, { hint: '계산검토용 지하수위 (mm, 지표 기준)' }),
                v(manB, `${rp}.coverB`, auto.cover, { hint: '부력검토용 토피 (mm)' }),
                c2(manB, `${rp}.gwOnB`, auto.gwOn),
                v(manB, `${rp}.gwlB`, auto.gwl, { hint: '부력검토용 지하수위 (mm)' }),
                num(`${rp}.mortar`, { dec: 0, hint: '상부슬래브 위 방수몰탈 두께 (mm). 토피 하중에 포함됩니다.' }),
            ],
        };
    });
    new Grid(el, {
        id: 'cp-pos',
        onSelect: (cell, r) => { sel_.row = r; secState.k = r; ctx.redraw(); },
        head: [
            [{ t: '검토단면', rs: 2 }, { t: '암거종류', rs: 2 }, { t: 'Sta.(m)', rs: 2 }, { t: 'BLOCK', rs: 2 }, { t: '계산검토용(mm)', cs: 3 }, { t: '부력검토용(mm)', cs: 3 }, { t: '방수몰탈(mm)', rs: 2 }],
            [{ t: '토피' }, { t: '지하수위', cs: 2 }, { t: '토피' }, { t: '지하수위', cs: 2 }],
        ],
        rows,
        colWidths: [90, 70, 80, 55, 70, 28, 70, 70, 28, 70, 80],
    });
}

function renderBoring(el, ctx, ch) {
    const k = secState.k;
    const bp = `${ctx.cp}.checks.rows.${k}.boring`;
    const bo = ch.rows[k].boring;
    el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '3px' } }, [
        bNumber(`${bp}.topEl`, { label: '보링공 상단 EL(m)', dec: 3, width: 70 }),
        bCheck(`${bp}.hatch`, ' 해치패턴'),
        bCheck(`${bp}.split2`, ' 2개층분할(지진)'),
        bCheck(`${bp}.vsIn`, ' 초기전단파속도 입력(지진)'),
    ]));
    const head = [{ t: '구 분' }, { t: '토질 분류' }, { t: '보링 명칭', cs: 2 }, { t: 'dH(m)' }, { t: 'N값' }, { t: '단위중량(kN/m³)' }, { t: 'μ' }];
    if (bo.vsIn) head.push({ t: '전단파속도(m/s)' });
    if (bo.split2) head.push({ t: '토층분할' });
    const rows = bo.layers.map((l, i) => {
        const lp = `${bp}.layers.${i}`;
        const cells = [
            sel(`${lp}.soil`, ['사질토', '점성토']),
            lbl(l.name, { cls: 'ro' }),
            btn('+', () => boringPattern(lp, l.name)),
            num(`${lp}.dH`, { dec: 3, hint: '보링 상단에서 층 하단까지 깊이 (누적, m)' }),
            num(`${lp}.N`, { dec: 0 }),
            num(`${lp}.gamma`, { dec: 3 }),
            num(`${lp}.mu`, { dec: 2, hint: '포아송비' }),
        ];
        if (bo.vsIn) cells.push(num(`${lp}.vs`, { dec: 1 }));
        if (bo.split2) cells.push(sel(`${lp}.part`, [1, 2]));
        return { head: [{ t: String(i + 1) }], cells };
    });
    new Grid(el, { id: 'cp-boring', onSelect: (c, r) => { sel_.layer = r; }, head: [head], rows, colWidths: [40, 80, 150, 26, 70, 50, 100, 50, 100, 70] });
}

function boringPattern(lp, cur) {
    let pick = cur;
    const cols = [BORING_NAMES.slice(0, 13), BORING_NAMES.slice(13, 25), BORING_NAMES.slice(25)];
    const name = 'bp' + Math.random().toString(36).slice(2);
    const body = h('div', { style: { display: 'flex', gap: '16px' } }, cols.map(col => h('div', {}, col.map(n => {
        const r = h('input', { type: 'radio', name, value: n });
        r.checked = n === cur;
        r.addEventListener('change', () => { pick = n; });
        return h('div', {}, [h('label', {}, [r, ' ', h('span', { style: { display: 'inline-block', width: '22px', height: '10px', border: '1px solid #c00', background: 'repeating-linear-gradient(45deg,#fff 0 3px,#c00 3px 4px)', marginRight: '4px' } }), n])]);
    }))));
    modal({ title: '보링 주상도 패턴', body, width: 720, buttons: [{ text: '확 인', primary: true, onClick: () => store.set(`${lp}.name`, pick) }, { text: '취 소' }] });
}

function renderPave(el, ctx, ch) {
    const k = secState.k;
    const pp = `${ctx.cp}.checks.rows.${k}.pave`;
    const pv = ch.rows[k].pave;
    el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '3px' } }, [
        bSelect(`${pp}.type`, ['아스팔트 포장', '콘크리트 포장']),
        bNumber(`${pp}.t`, { label: '두께(mm)', dec: 0, width: 60, disabled: !!pv.detail }),
        bCheck(`${pp}.detail`, ' 세부 포장 적용'),
        h('span', { style: { marginLeft: 'auto' } }, [bCheck(`${pp}.buoy`, ' 부력검토 적용')]),
    ]));
    const off = !pv.detail;
    new Grid(el, {
        id: 'cp-pave',
        head: [[{ t: '구분' }, { t: '선택' }, { t: '두께(mm)' }, { t: '단위중량(kN/m³)' }]],
        rows: (pv.layers || PAVE_LAYERS).map((l, i) => ({
            head: [{ t: l.name }],
            cells: [
                off ? lbl(l.on ? '☑' : '☐', { cls: 'ro', align: 'center' }) : chk(`${pp}.layers.${i}.on`),
                off ? lbl(l.t, { dec: 0, cls: 'ro' }) : num(`${pp}.layers.${i}.t`, { dec: 0 }),
                off ? lbl(l.gamma, { dec: 1, cls: 'ro' }) : num(`${pp}.layers.${i}.gamma`, { dec: 1 }),
            ],
        })),
        colWidths: [100, 50, 90, 120],
    });
    el.appendChild(h('div', { class: 'note' }, '* 포장 두께는 토피에 포함됩니다. 세부포장 적용 시 선택한 층의 두께 합과 단위중량을 사용합니다.'));
}

function renderInner(el, ctx, ch) {
    const k = secState.k;
    const ip = `${ctx.cp}.checks.rows.${k}.inner`;
    const inn = ch.rows[k].inner;
    const YN = [{ value: true, label: '적 용' }, { value: false, label: '적용안함' }];
    const rail = inn.live.kind === '철도하중';
    const rows = [
        { g: '고정하중', a: '고려여부', cell: sel(`${ip}.dead.on`, YN) },
        { g: '고정하중', a: '적용하중', cell: inn.dead.on ? num(`${ip}.dead.q`, { dec: 3 }) : dash(), unit: 'kN/m²' },
        { g: '활하중', a: '고려여부', cell: sel(`${ip}.live.on`, YN) },
        { g: '활하중', a: '하중종류', cell: inn.live.on ? sel(`${ip}.live.kind`, ['도로하중', '철도하중']) : dash() },
        { g: '활하중', a: '하중 제원', cell: inn.live.on ? btn(rail ? `B=${inn.live.B} B1=${inn.live.B1} D=${inn.live.D} H=${inn.live.H} 축하중=${inn.live.Pr}kN ...` : `b=${inn.live.b} t=${inn.live.t} a=${inn.live.a} 윤하중=${inn.live.P}kN ...`, () => innerPopup(ctx, ip)) : dash() },
        { g: '수압', a: '고려여부', cell: sel(`${ip}.water.on`, YN) },
        { g: '수압', a: '수위', cell: inn.water.on ? num(`${ip}.water.h`, { dec: 3 }) : dash(), unit: 'm' },
    ];
    propTable(el, 'cp-inner', rows, { colWidths: [90, 120, 10, 300, 60] });
    el.appendChild(h('div', { class: 'note' }, '* 내부하중은 기초 지지력 검토에만 사용되며 구조해석 모델에는 재하되지 않습니다.'));
}

function innerPopup(ctx, ip) {
    const cur = clone(store.get(ip).live);
    const rail = cur.kind === '철도하중';
    const fields = rail ? [['B', 'B(mm)'], ['B1', 'B1(mm)'], ['D', 'D(mm)'], ['H', 'H(mm)'], ['Pr', '축하중(kN)']] : [['b', 'b(mm)'], ['t', 't(mm)'], ['a', 'a(mm)'], ['P', '윤하중(kN)']];
    const LT = checkCondition(ctx.p, ctx.c, secState.k).g.LT;
    const info = h('div', { class: 'note', style: { color: '#123' } });
    const upd = () => {
        if (rail) {
            const s = (+cur.D + +cur.H);
            info.textContent = `분포폭: B + 2(D+H) + 2·LT = ${((+cur.B + 2 * s + 2 * LT) / 1000).toFixed(3)} m, B1 + 2(D+H) + 2·LT = ${((+cur.B1 + 2 * s + 2 * LT) / 1000).toFixed(3)} m (LT = ${LT})`;
        } else {
            info.textContent = `분포폭: b + 2(t + LT) = ${((+cur.b + 2 * (+cur.t + LT)) / 1000).toFixed(3)} m, a + 2(t + LT) = ${((+cur.a + 2 * (+cur.t + LT)) / 1000).toFixed(3)} m (LT = ${LT}, 45° 분포)`;
        }
    };
    const tr1 = h('tr', {}, fields.map(([, l]) => h('th', {}, l)));
    const tr2 = h('tr', {}, fields.map(([key]) => {
        const inp = h('input', { type: 'text', style: { width: '70px', textAlign: 'right' } });
        inp.value = cur[key];
        inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v)) { cur[key] = v; upd(); } });
        return h('td', {}, [inp]);
    }));
    upd();
    const body = h('div', {}, [h('table', { class: 'ag' }, [h('thead', {}, [tr1]), h('tbody', {}, [tr2])]), info]);
    modal({
        title: '암거 내부 하중', body, width: 520,
        buttons: [
            { text: '기본값', onClick: () => { const d = defaultInner().live; store.set(`${ip}.live`, { ...d, kind: cur.kind }); } },
            { text: '확인', primary: true, onClick: () => store.set(`${ip}.live`, cur) },
        ],
    });
}

// ── 부력 및 지지력 검토 팝업 ─────────────────────────────────────────

function buoyPopup(ctx) {
    const ch = ensureChecks(ctx);
    const pre1 = h('pre', { style: { background: '#fff', border: '1px solid #8aa', padding: '6px', margin: '0 0 6px', height: '230px', overflow: 'auto', font: '12px/1.5 Consolas, monospace' } });
    const pre2 = h('pre', { style: { background: '#fff', border: '1px solid #8aa', padding: '6px', margin: 0, height: '230px', overflow: 'auto', font: '12px/1.5 Consolas, monospace' } });
    const tabs = h('div', { style: { display: 'flex', gap: '2px', marginTop: '4px' } });
    const show = (k) => {
        try {
            pre1.textContent = buoyancyCheck(ctx.p, ctx.c, k).lines.join('\n');
            pre2.textContent = bearingCheck(ctx.p, ctx.c, k).lines.join('\n');
        } catch (e) { pre1.textContent = '계산 오류: ' + e.message; pre2.textContent = ''; console.error(e); }
        [...tabs.children].forEach((b, i) => b.classList.toggle('on', i === k));
    };
    ch.rows.forEach((r, k) => tabs.appendChild(button(r.name, () => show(k))));
    const head = h('div', { style: { marginBottom: '4px', background: '#ffef9c', padding: '2px 6px', display: 'inline-block' } }, `암거 ${ctx.ci + 1} : ${ctx.c.name}`);
    modal({ title: '부력 및 지지력 검토', body: h('div', {}, [head, pre1, pre2, tabs]), width: 760, buttons: [{ text: '확인', primary: true }] });
    show(Math.min(secState.k, ch.rows.length - 1));
}

function foundPopup(ctx) {
    const d = getDesign(ctx.p);
    const ch = ensureChecks(ctx);
    const out = [];
    ch.rows.forEach((r, k) => {
        const cond = checkCondition(ctx.p, ctx.c, k);
        const bo = r.boring || { layers: [] };
        const zBase = cond.groundEl - cond.botEl;
        const lay = (bo.layers || []).find(l => zBase <= +l.dH + 1e-9) || (bo.layers || [])[bo.layers.length - 1] || { N: 30 };
        const N = Math.min(50, +lay.N || 0);
        const E0 = 2800 * N;
        const B = (cond.g.baseX1 - cond.g.baseX0) / 1000;
        const L = (blocks(ctx.c)[cond.bi] || { length: 10 }).length;
        const Bv = d.opt.bvDir === '종방향' ? Math.sqrt(B * L) : B;
        const alpha = +d.opt.alphaStatic || 1;
        const kv0 = alpha * E0 / 0.3;
        const ex = /혼합/.test(d.opt.kvSoil) ? -3 / 4 : /점성/.test(d.opt.kvSoil) ? -1 : -1 / 2;
        const kv = kv0 * Math.pow(Bv / 0.3, ex);
        out.push(`<< ${r.name} 기초부 설계검토 >>`);
        out.push(`기초지반: ${lay.name || ''} N = ${N}, E0 = 2800·N = ${E0.toFixed(0)} kN/m²`);
        out.push(`Kv0 = α·E0/0.3 = ${alpha} × ${E0.toFixed(0)} / 0.3 = ${kv0.toFixed(0)} kN/m³`);
        out.push(`Bv = ${Bv.toFixed(3)} m (${d.opt.bvDir}), Kv = Kv0·(Bv/0.3)^(${ex}) = ${kv.toFixed(0)} kN/m³ (${d.opt.kvSoil})`);
        const b = bearingCheck(ctx.p, ctx.c, k);
        out.push(`지지력: Qa = ${b.qa.toFixed(3)} kN/m², Qmax = ${b.qmax.toFixed(3)} kN/m² → ${b.ok ? 'O.K' : 'N.G'}`);
        out.push('');
    });
    modal({ title: '기초부 설계검토', body: h('pre', { style: { background: '#fff', padding: '6px', font: '12px/1.5 Consolas, monospace', maxHeight: '420px', overflow: 'auto' } }, out.join('\n')), width: 700, buttons: [{ text: '확인', primary: true }] });
}

// ── 도면 ─────────────────────────────────────────────────────────────

/** 검토단면 단면도 + 지표/지하수위/몰탈/포장 + (선택) 주상도 */
export function drawCheckSection(d, p, c, k, opts = {}) {
    const cond = checkCondition(p, c, k);
    const ox = opts.dx || 0;
    const g = drawSection(d, c, cond.bi, { alignment: p.alignment, alignName: p.alignment.name, sta: cond.sta, dx: ox, names: false, dims: opts.dims !== false });
    const th = d.textHeight;
    const yEl = (el) => (el - cond.botEl) * 1000;
    const x0 = g.baseX0 - th * 6 + ox, x1 = g.baseX1 + th * 6 + ox;
    const yG = yEl(cond.groundEl);
    if (g.kind !== 'U' || cond.cover > 0) {
        d.line(x0, yG, x1, yG, { color: COLOR.GREEN, layer: 'GROUND' });
        const cx = g.W / 2 + ox;
        for (let i = 0; i < 4; i++) d.line(cx - th * 1.2 + i * th * 0.6, yG - th * 0.6, cx - th * 0.6 + i * th * 0.6, yG, { color: COLOR.GREEN, layer: 'GROUND' });
        d.line(cx - th * 1.5, yG - th * 0.2, cx + th * 1.5, yG - th * 0.2, { color: COLOR.GREEN, layer: 'GROUND' });
    }
    if (cond.gwOn) {
        const yw = yEl(cond.gwlEl);
        d.line(x0, yw, x1, yw, { color: COLOR.GREEN, dash: 'hidden', layer: 'GROUND' });
        const wx = g.W * 0.75 + ox;
        d.pline([[wx, yw], [wx - th * 0.5, yw + th * 0.7], [wx + th * 0.5, yw + th * 0.7]], { color: COLOR.GREEN, closed: true });
        d.line(wx - th * 0.4, yw - th * 0.25, wx + th * 0.4, yw - th * 0.25, { color: COLOR.GREEN });
    }
    // 방수몰탈 / 포장
    const yTop = g.Htot;
    if (cond.mortar > 0 && g.kind !== 'U') d.line(ox, yTop + cond.mortar * 1000, g.W + ox, yTop + cond.mortar * 1000, { color: COLOR.CYAN, dash: 'hidden' });
    if (cond.pave.t > 0) d.line(x0, yG - cond.pave.t * 1000, x1, yG - cond.pave.t * 1000, { color: COLOR.GRAY, dash: 'hidden' });
    // 토피 치수 (우측)
    if (opts.dims !== false && cond.cover > 0) {
        const xd = g.baseX1 + th * 9 + ox;
        const ys = [yTop];
        if (cond.mortar > 0) ys.push(yTop + cond.mortar * 1000);
        if (cond.gwOn && yEl(cond.gwlEl) > yTop && yEl(cond.gwlEl) < yG) ys.push(yEl(cond.gwlEl));
        ys.push(yG);
        ys.sort((a, b) => a - b);
        for (let i = 0; i < ys.length - 1; i++) d.dimV(ys[i], ys[i + 1], g.W + ox, xd);
        d.dimV(yTop, yG, g.W + ox, xd + th * 2.6);
    }
    d.text(g.W / 2 + ox, yG + th * 2.5, cond.name, { color: COLOR.YELLOW, h: th * 1.1 });
    if (opts.boring) drawBoring(d, cond, g.baseX1 + th * 16 + ox, yEl);
    return { g, cond };
}

function drawBoring(d, cond, x, yEl) {
    const bo = cond.row.boring;
    if (!bo) return;
    const th = d.textHeight;
    const w = th * 3;
    let top = +bo.topEl;
    let prev = top;
    d.text(x + w / 2, yEl(top) + th * 0.6, `EL.${top.toFixed(3)}`, { color: COLOR.GREEN, h: th * 0.7 });
    (bo.layers || []).forEach((l) => {
        const bot = top - (+l.dH || 0);
        const y1 = yEl(prev), y0 = yEl(bot);
        if (y1 - y0 <= 0) return;
        d.rect(x, y0, w, y1 - y0, { color: /암/.test(l.name) ? COLOR.RED : COLOR.MAGENTA, layer: 'GROUND' });
        if (bo.hatch) d.hatch([[x, y0], [x + w, y0], [x + w, y1], [x, y1]], { color: /암/.test(l.name) ? COLOR.RED : COLOR.MAGENTA, pattern: 'ansi31', alpha: 0.3 });
        d.text(x + w + th * 0.4, (y0 + y1) / 2, `${l.name} N=${l.N}`, { color: COLOR.GREEN, h: th * 0.7, align: 'left', valign: 'middle' });
        prev = bot;
    });
}

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'culvert',
    hint: '구조계산을 수행할 검토단면의 위치와 토피, 지하수위를 설정합니다. 기본값은 암거 시종점과 신축이음 위치입니다.',
    tabs: () => TABS,

    header(el, ctx) {
        const tab = ctx.tab;
        ensureChecks(ctx);
        if (tab && tab !== 'pos') el.appendChild(sectionSelector(ctx));
        const vp = `${ctx.cp}.checks.view`;
        el.appendChild(h('span', { class: 'inline-opts', style: { marginLeft: 'auto' } }, [
            h('b', {}, '화면보기'),
            bCheck(`${vp}.profile`, ' 종단위치보기'),
            bCheck(`${vp}.all`, ' 단면 전체 표시'),
            bCheck(`${vp}.boring`, ' 지반정보 표시'),
        ]));
    },

    render(el, ctx, tab) {
        const ch = ensureChecks(ctx);
        if (tab === 'pos') renderPos(el, ctx, ch);
        else if (tab === 'boring') renderBoring(el, ctx, ch);
        else if (tab === 'pave') renderPave(el, ctx, ch);
        else if (tab === 'inner') renderInner(el, ctx, ch);
    },

    footer(el, ctx, tab) {
        const cp = `${ctx.cp}.checks`;
        const ch = ensureChecks(ctx);
        el.appendChild(button('추가', () => {
            if (tab === 'boring') {
                const k = secState.k;
                const ls = clone(ch.rows[k].boring.layers);
                const last = ls[ls.length - 1] || { dH: 0 };
                ls.splice(sel_.layer + 1, 0, { ...last, dH: +((+last.dH || 0) + 5).toFixed(3) });
                store.set(`${cp}.rows.${k}.boring.layers`, ls);
                return;
            }
            const rows = clone(ch.rows);
            const i = Math.min(sel_.row, rows.length - 1);
            const st = jointStations(ctx.c);
            const sta = rows[i] ? (+rows[i].sta + (rows[i + 1] ? (+rows[i + 1].sta - +rows[i].sta) / 2 : 0)) : st[0];
            const row = defaultCheckRow(ctx.p, ctx.c, rows.length, sta, blockAt(ctx.c, sta));
            rows.splice(i + 1, 0, row);
            rows.forEach((r, j) => { if (/^단면 [A-Z]+-[A-Z]+$/.test(r.name)) r.name = sectionName(j); });
            store.set(`${cp}.rows`, rows);
        }, { disabled: tab === 'pave' || tab === 'inner' }));
        el.appendChild(button('삭제', () => {
            if (tab === 'boring') {
                const k = secState.k;
                const ls = clone(ch.rows[k].boring.layers);
                if (ls.length <= 1) return;
                ls.splice(Math.min(sel_.layer, ls.length - 1), 1);
                store.set(`${cp}.rows.${k}.boring.layers`, ls);
                return;
            }
            if (ch.rows.length <= 1) { alertBox('검토단면은 1개 이상 있어야 합니다.'); return; }
            const rows = clone(ch.rows);
            rows.splice(Math.min(sel_.row, rows.length - 1), 1);
            store.set(`${cp}.rows`, rows);
        }, { disabled: tab === 'pave' || tab === 'inner' }));
        el.appendChild(button('부력 및 지지력 검토', () => buoyPopup(ctx)));
        el.appendChild(button('기초부 설계검토', () => foundPopup(ctx)));
    },

    defaults(ctx, tab) {
        const cp = `${ctx.cp}.checks`;
        const ch = clone(ensureChecks(ctx));
        const k = secState.k;
        if (tab === 'pos') {
            const d = defaultChecks(ctx.p, ctx.c);
            d.view = ch.view;
            store.set(cp, d);
        } else if (tab === 'boring') {
            ch.rows.forEach(r => { r.boring = defaultBoring(ctx.p, ctx.c, +r.sta || 0); });
            store.set(cp, ch);
        } else if (tab === 'pave') store.set(`${cp}.rows.${k}.pave`, defaultPave());
        else if (tab === 'inner') store.set(`${cp}.rows.${k}.inner`, defaultInner());
    },

    draw(ctx, tab) {
        const ch = ensureChecks(ctx);
        const v = ch.view || {};
        const p = ctx.p, c = ctx.c;
        if (tab === 'pos' && v.profile) {
            const d = newPlanDrawing(p, c);
            const tr = drawProfile(d, p, c, { dims: false });
            const th = d.textHeight;
            ch.rows.forEach((r, k) => {
                const cond = checkCondition(p, c, k);
                const x = tr.X(cond.sta);
                const on = k === secState.k;
                d.line(x, tr.Y(cond.botEl) - th * 3, x, tr.Y(cond.groundEl) + th * 1.5, { color: on ? COLOR.YELLOW : COLOR.ORANGE, width: on ? 2 : 1 });
                d.text(x, tr.Y(cond.botEl) - th * 3.3, r.name, { color: on ? COLOR.YELLOW : COLOR.ORANGE, h: th * 0.8, valign: 'top' });
                d.line(x - th * 0.8, tr.Y(cond.groundEl), x + th * 0.8, tr.Y(cond.groundEl), { color: COLOR.GREEN });
            });
            const gl = (p.alignment.groundLine || []);
            if (gl.length) {
                const st = jointStations(c);
                const pts = [];
                for (let s = st[0]; s <= st[st.length - 1] + 1e-6; s += Math.max(0.5, (st[st.length - 1] - st[0]) / 40)) pts.push([tr.X(s), tr.Y(groundElAt(p, c, s))]);
                d.pline(pts, { color: COLOR.GREEN, layer: 'GROUND' });
            }
            return d;
        }
        const k = secState.k;
        const d = new Drawing({ textHeight: sectionTextHeight(c, (ch.rows[k] || {}).block || 0) });
        const boring = !!v.boring || tab === 'boring';
        if (v.all) {
            let dx = 0;
            ch.rows.forEach((r, i) => {
                const res = drawCheckSection(d, p, c, i, { dx, boring, dims: false });
                dx += (res.g.baseX1 - res.g.baseX0) + d.textHeight * (boring ? 40 : 24);
            });
        } else drawCheckSection(d, p, c, k, { boring });
        return d;
    },
    viewKey: (ctx, tab) => `checkPos|${ctx.ci}|${tab === 'pos' && (ctx.c.checks || {}).view?.profile ? 'prof' : 'sec' + secState.k}|${JSON.stringify((ctx.c.checks || {}).view || {})}`,
};

export { fmtSta };
