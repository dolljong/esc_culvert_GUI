// 배근 입력 > 주철근 (1Cycle) (매뉴얼 5.2)
//
// 블록별 · 구간(직/시점/종점)별 · 단(1~3단)별 · 부재별로 주철근 겹이음 위치(UD/LD)와 직경(UR/LR)을 입력한다.
// 데이터: culverts[i].rebar.main[bi].c{cycle}[zone]['L'+단][member][face] = { n, D[], R[], place[] } (calc/rebar.js 참조)
//         culverts[i].rebar.drawOpt (배근 도면 옵션), .forceView (부재력보기), .autoCalc (자동계산 설정)
// 이 파일의 makeMainScreen(kind) 를 주철근(3Cycle) main3.js, 주철근(2,4Cycle) main24.js 가 함께 쓴다.

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, modal, bCheck, bSelect, alertBox } from '../ui/dom.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import {
    DIAS, mainMembers, getMainFace, mainFacePath, normalizeFace, getSettings, cyclesOf, zonesOf, faceRefSpan,
    layerEnabled, diaRange, checkPositions, mainBarLayout,
} from '../calc/rebar.js';
import { mainFlexureCheck } from '../calc/rebarCheck.js';
import { loadFrame, frameStatus, memberForces, momentAt } from '../calc/rebarForces.js';
import { mainRebarDrawing } from '../draw/rebarDraw.js';
import { ensureSettings, settingsPath, liveModal, sameBlockPopup, sameKindBlocks, ensure } from './rebarSet.js';

const ZONES = ['straight', 'start', 'end'];

// rcDesign.flexure (있으면 사용)
let rcFlexure = null;
import('../calc/rcDesign.js').then(m => { if (m && typeof m.flexure === 'function') rcFlexure = m.flexure; }).catch(() => { /* 없음 */ });

/** 화면 상태 (데이터 아님) */
const ui = { layer: 1, zone: 'straight', cyc24: 2 };

const DEFAULT_DRAW_OPT = { allMarks: false, inputMark: true, allLaps: false, keepRight: false, unfold: false };
const DEFAULT_FORCE = { on: false, state: '평상시', diag: 'BMD' };
const DEFAULT_AUTO = { section: '단면 A-A', minDia: 'D22', maxDia: 'D32', symmetric: false, twoLayer: true, separate: false, target: 120 };

/**
 * 주철근 화면 생성.
 * kind: 1 (1Cycle) | 3 (3Cycle) | 24 (2,4Cycle)
 */
export function makeMainScreen(kind) {
    const curCycle = (ctx) => (kind === 24 ? (getSettings(ctx.c, ctx.bi).cycle === '4Cycle' ? ui.cyc24 : 2) : kind);
    const inherits = (cyc) => cyc === 3 || cyc === 4;   // 직경(·배치)은 1(2)Cycle 을 따른다

    return {
        scope: 'culvert',
        perBlock: true,
        enabled(ctx) {
            if (!ctx.c) return true;
            const cs = cyclesOf(getSettings(ctx.c, ctx.bi));
            if (kind === 3) return cs.includes(3);
            if (kind === 24) return cs.includes(2);
            return true;
        },
        hint: kind === 24 ? '2,4Cycle 주철근의 절단위치와 직경, 배치여부를 입력합니다.'
            : kind === 3 ? '3Cycle 주철근의 겹이음 위치를 입력합니다. (직경은 1Cycle 과 동일)'
                : '주철근(1Cycle)의 이음수, 기준위치에서 겹이음 중심까지의 거리, 철근직경을 입력합니다.',

        tabs(ctx) {
            const g = sectionGeom(ctx.c, ctx.bi);
            return mainMembers(g).map(m => ({ id: m.key, title: m.title }));
        },

        header(el, ctx) {
            ensureSettings(ctx);
            const st = getSettings(ctx.c, ctx.bi);
            const cyc = curCycle(ctx);
            const ck = cyc === 1 || cyc === 3 ? 1 : 2;
            // 입력단수
            const g = sectionGeom(ctx.c, ctx.bi);
            const mems = mainMembers(g);
            const avail = [1, 2, 3].filter(l => l === 1 || mems.some(m => m.faces.some(f => layerEnabled(st, m.key, f.key, l, ck))));
            if (!avail.includes(ui.layer)) ui.layer = 1;
            const ls = h('select', {});
            [1, 2, 3].forEach(l => {
                const o = h('option', { value: l, disabled: !avail.includes(l) }, `${l}단철근`);
                if (l === ui.layer) o.selected = true;
                ls.appendChild(o);
            });
            ls.addEventListener('change', () => { ui.layer = +ls.value; ctx.rerender(); });
            const nav = (dl) => { const i = avail.indexOf(ui.layer) + dl; if (i >= 0 && i < avail.length) { ui.layer = avail[i]; ctx.rerender(); } };
            el.appendChild(h('label', {}, ['입력단수 ', ls]));
            el.appendChild(h('button', { class: 'nav-btn', onclick: () => nav(-1) }, '◀'));
            el.appendChild(h('button', { class: 'nav-btn', onclick: () => nav(1) }, '▶'));
            // 구간
            const zs = zonesOf(ctx.c, ctx.bi, st);
            if (!zs.find(z => z.id === ui.zone && z.enabled)) ui.zone = 'straight';
            const zw = h('span', { class: 'radio-group' });
            const rn = 'z' + Math.random().toString(36).slice(2);
            for (const z of zs) {
                const r = h('input', { type: 'radio', name: rn, value: z.id });
                r.checked = z.id === ui.zone;
                r.disabled = !z.enabled;
                r.addEventListener('change', () => { ui.zone = z.id; ctx.rerender(); });
                zw.appendChild(h('label', {}, [r, z.title]));
            }
            el.appendChild(zw);
            if (kind === 24 && st.cycle === '4Cycle') {
                const cw = h('span', { class: 'radio-group' });
                const cn = 'c' + Math.random().toString(36).slice(2);
                for (const v of [2, 4]) {
                    const r = h('input', { type: 'radio', name: cn, value: v });
                    r.checked = ui.cyc24 === v;
                    r.addEventListener('change', () => { ui.cyc24 = v; ctx.rerender(); });
                    cw.appendChild(h('label', {}, [r, `${v}Cycle`]));
                }
                el.appendChild(cw);
            }
            el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [button('배근 도면 옵션', () => drawOptPopup(ctx))]));
        },

        render(el, ctx, tab) {
            ensureSettings(ctx);
            const cyc = curCycle(ctx);
            const g = sectionGeom(ctx.c, ctx.bi);
            const mem = mainMembers(g).find(m => m.key === tab);
            if (!mem) return;
            const st = getSettings(ctx.c, ctx.bi);
            const ck = cyc === 1 || cyc === 3 ? 1 : 2;
            const faces = mem.faces.filter(f => layerEnabled(st, mem.key, f.key, ui.layer, ck));
            if (!faces.length) {
                el.appendChild(h('div', { class: 'note' }, `${mem.title}: ${ui.layer}단 철근이 설정되지 않았습니다. [배치단수 설정]에서 지정하세요.`));
                return;
            }
            const data = faces.map(f => getMainFace(ctx.c, ctx.bi, cyc, ui.zone, ui.layer, mem.key, f.key, g));
            const nD = Math.max(1, ...data.map(d => d.n));
            const rows = [];
            faces.forEach((f, fi) => {
                const d = data[fi];
                const head = [{ t: f.cnt, cls: 'grp' }];
                for (let k = 0; k < nD; k++) head.push({ t: `${f.D}${k + 1}` });
                for (let k = 0; k <= nD; k++) head.push({ t: `${f.R}${k + 1}` });
                rows.push({ head, cells: [] });
                rows.push({ cells: valueCells(ctx, cyc, mem, f, d, nD, g) });
                if (cyc === 2 || cyc === 4) rows.push({ cells: placeCells(ctx, cyc, mem, f, d, nD) });
            });
            new Grid(el, { id: `main${kind}-${mem.key}-${ui.layer}`, head: [], rows, colWidths: [70, ...Array(nD).fill(62), ...Array(nD + 1).fill(66)] });
            const span = faceRefSpan(g, mem.key);
            const tip = mem.kind === 'slab' ? `기준위치: 좌측벽체 내면, 내공 전체폭 ${span} mm` : `기준위치: ${g.kind === 'U' ? '벽체 상단' : '상부슬래브 하면'}에서 아래로, 내공높이 ${span} mm`;
            el.appendChild(h('div', { class: 'note' }, `* ${tip}. ${cyc === 1 || cyc === 3 ? 'D = 겹이음 중심까지의 연속거리, R = 이음 사이 철근직경' : 'D = 절단점 연속거리, R = 철근직경, 체크 = 해당 구간 철근 배치'}${inherits(cyc) ? ` (직경${cyc === 4 ? '·배치' : ''}는 ${cyc === 3 ? 1 : 2}Cycle 과 동일)` : ''}`));
        },

        footer(el, ctx, tab) {
            const cp = ctx.cp;
            el.appendChild(button('모든 블럭 동일 적용', () => sameBlocks(ctx, curCycle(ctx), tab), { disabled: ctx.blocks.length < 2 }));
            if (kind === 1) el.appendChild(button('배치단수 설정', () => layersPopup(ctx)));
            if (kind === 24) {
                el.appendChild(button('철근연결', () => connectPopup(ctx)));
                ensure(`${cp}.rebar.main.${ctx.bi}.bendCorner`, false);
                el.appendChild(bCheck(`${cp}.rebar.main.${ctx.bi}.bendCorner`, ' 단절점부 주철근 절곡배치', { title: '우각부 주철근을 헌치를 따라 꺾어 배치' }));
            }
            ensure(`${cp}.rebar.forceView`, () => ({ ...DEFAULT_FORCE }));
            const fv = store.get(`${cp}.rebar.forceView`);
            el.appendChild(bCheck(`${cp}.rebar.forceView.on`, '', { title: '부재력보기', onChange: (v) => { store.set(`${cp}.rebar.forceView.on`, v); if (v) loadFrame(() => ctx.redraw()); } }));
            el.appendChild(bSelect(`${cp}.rebar.forceView.state`, ['평상시', '지진시'], { disabled: !fv.on }));
            el.appendChild(bSelect(`${cp}.rebar.forceView.diag`, ['BMD', 'SFD'], { disabled: !fv.on }));
            if (kind === 1) el.appendChild(button('자동계산(철근직경 및 단수)', () => autoCalcPopup(ctx)));
            el.appendChild(button('설계검토', () => designCheckPopup(ctx, curCycle(ctx), kind)));
        },

        defaults(ctx, tab) {
            const cyc = curCycle(ctx);
            const path = `${ctx.cp}.rebar.main.${ctx.bi}.c${cyc}`;
            const m = clone(store.get(path)) || {};
            for (const z of ZONES) {
                if (!m[z]) continue;
                for (const lk of Object.keys(m[z])) if (m[z][lk]) delete m[z][lk][tab];
            }
            store.set(path, m);
        },

        draw(ctx, tab) {
            const cp = ctx.cp;
            const opt = { ...DEFAULT_DRAW_OPT, ...(store.get(`${cp}.rebar.drawOpt`) || {}) };
            const fv = { ...DEFAULT_FORCE, ...(store.get(`${cp}.rebar.forceView`) || {}) };
            let forces = null, note = '';
            if (fv.on) {
                const s = loadFrame(() => ctx.redraw());
                if (s === 'ready') {
                    forces = memberForces(ctx.p, ctx.c, ctx.bi, { state: fv.state, diag: fv.diag });
                    if (!forces) note = '  (2D Frame 해석 결과 없음)';
                } else if (s === 'missing') note = '  (2D Frame 해석 모듈 없음 — 부재력보기 불가)';
            }
            const cyc = curCycle(ctx);
            const g = sectionGeom(ctx.c, ctx.bi);
            const mem = mainMembers(g).find(m => m.key === tab) || {};
            const b = ctx.blocks[ctx.bi];
            const { d } = mainRebarDrawing(ctx.p, ctx.c, ctx.bi, {
                cycle: cyc, zone: ui.zone, layer: ui.layer, member: tab, memberTitle: mem.title,
                showAll: opt.allMarks, inputName: opt.inputMark, allLaps: opt.allLaps && getSettings(ctx.c, ctx.bi).cycle === '4Cycle',
                forces, unfold: opt.unfold, blockLen: b ? b.length * 1000 : 10000,
            });
            d.legend = `${cyc}Cycle · ${ui.layer}단 · ${zonesOf(ctx.c, ctx.bi).find(z => z.id === ui.zone).title}${fv.on && forces ? ` · ${fv.state} ${fv.diag}` : ''}${note}`;
            return d;
        },
        viewKey: (ctx, tab) => `main${kind}|${ctx.ci}|${ctx.bi}|${(store.get(`${ctx.cp}.rebar.drawOpt`) || {}).unfold ? 'u' + tab : ''}`,
    };

    // ── 셀 ──────────────────────────────────────────────────────────

    function facePath(ctx, cyc, mem, f) { return mainFacePath(ctx.cp, ctx.bi, cyc, ui.zone, ui.layer, mem.key, f.key); }

    function write(ctx, cyc, mem, f, next) {
        const path = facePath(ctx, cyc, mem, f);
        if (inherits(cyc)) store.set(path, { D: next.D.slice() });
        else store.set(path, normalizeFace(next));
    }

    function valueCells(ctx, cyc, mem, f, d, nD, g) {
        const cells = [];
        const cntOpts = Array.from({ length: 11 }, (_, i) => ({ value: i, label: i === 0 && mem.kind === 'wall' ? '없음' : String(i) }));
        if (inherits(cyc)) cells.push(lbl(() => (d.n === 0 && mem.kind === 'wall' ? '없음' : d.n), { cls: 'ro', align: 'center', hint: `이음수는 ${cyc === 3 ? 1 : 2}Cycle 과 동일합니다.` }));
        else cells.push(custom('select', () => d.n, (v) => write(ctx, cyc, mem, f, resizeFace(d, +v, faceRefSpan(g, mem.key))), { options: cntOpts, hint: `${f.cnt}: 부재 ${f.title}의 ${cyc === 1 || cyc === 3 ? '겹이음' : '절단점'} 개수` }));
        for (let k = 0; k < nD; k++) {
            if (k >= d.n) { cells.push(dash()); continue; }
            cells.push(custom('num', () => d.D[k], (v) => {
                const next = clone(d);
                const delta = v - next.D[k];
                next.D[k] = v;
                const keepRight = !!(store.get(`${ctx.cp}.rebar.drawOpt.keepRight`));
                if (!keepRight && k + 1 < next.n) next.D[k + 1] = Math.max(0, next.D[k + 1] - delta);
                write(ctx, cyc, mem, f, next);
            }, { dec: 0, field: `${f.D}${k + 1}`, hint: `${f.D}${k + 1}: 기준위치에서 ${k === 0 ? '' : '앞 이음부터 '}겹이음 중심까지의 거리 (mm)`, validate: v => (v >= 0 ? null : '거리는 0 이상이어야 합니다.') }));
        }
        for (let j = 0; j <= nD; j++) {
            if (j > d.n) { cells.push(dash()); continue; }
            if (inherits(cyc)) cells.push(lbl(d.R[j], { cls: 'ro', align: 'center', field: `${f.R}${j + 1}` }));
            else cells.push(custom('select', () => d.R[j], (v) => { const next = clone(d); next.R[j] = v; write(ctx, cyc, mem, f, next); }, { options: DIAS, field: `${f.R}${j + 1}`, hint: `${f.R}${j + 1}: 해당위치의 철근직경` }));
        }
        return cells;
    }

    function placeCells(ctx, cyc, mem, f, d, nD) {
        const cells = [lbl('', { cls: 'ro' })];
        for (let k = 0; k < nD; k++) cells.push(lbl('', { cls: 'ro' }));
        for (let j = 0; j <= nD; j++) {
            if (j > d.n) { cells.push(lbl('', { cls: 'ro' })); continue; }
            if (inherits(cyc)) cells.push(custom('check', () => d.place[j], null, { ro: true, hint: '배치여부는 2Cycle 과 동일합니다.' }));
            else cells.push(custom('check', () => d.place[j], (v) => { const next = clone(d); next.place[j] = !!v; write(ctx, cyc, mem, f, next); }, { hint: `${f.R}${j + 1} 구간에 철근을 배치합니다.` }));
        }
        return cells;
    }
}

/** 이음/절단점 개수 변경: 늘리면 남은 구간을 나눠 새 위치를 만든다 */
export function resizeFace(d, n, span) {
    const next = clone(d);
    n = Math.max(0, Math.min(20, n | 0));
    const D = (next.D || []).slice(0, n);
    if (D.length < n) {
        const used = D.reduce((s, v) => s + (+v || 0), 0);
        const add = n - D.length;
        const step = Math.max(100, Math.round((span - used) / (add + 1)));
        while (D.length < n) D.push(step);
    }
    next.n = n;
    next.D = D;
    return normalizeFace(next);
}

// ── 팝업: 배근 도면 옵션 ────────────────────────────────────────────

function drawOptPopup(ctx) {
    const p = `${ctx.cp}.rebar.drawOpt`;
    ensure(p, () => ({ ...DEFAULT_DRAW_OPT }));
    const snap = clone(store.get(p));
    const four = getSettings(ctx.c, ctx.bi).cycle === '4Cycle';
    liveModal('도면 옵션', (body) => {
        body.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px', padding: '6px' } }, [
            bCheck(`${p}.allMarks`, ' 모든 철근Mark 보기'),
            bCheck(`${p}.inputMark`, ' 입력문자에 대한 철근Mark 표시'),
            bCheck(`${p}.allLaps`, ' 전체 이음 표기', { disabled: !four, title: '배치옵션이 4Cycle 일 때 모든 Cycle 의 이음위치를 함께 표시' }),
            bCheck(`${p}.keepRight`, ' 입력값 변경시 우측값 조정', { title: '체크하면 이음위치를 고칠 때 우측 값을 그대로 둡니다 (뒤 이음들이 함께 이동)' }),
            bCheck(`${p}.unfold`, ' 입력부 전개도 보기'),
        ]));
    }, { buttons: [{ text: 'OK', primary: true }, { text: 'Cancel', onClick: () => store.set(p, snap) }] });
}

// ── 팝업: 배치단수 설정 ─────────────────────────────────────────────

function layersPopup(ctx) {
    const sp = ensureSettings(ctx);
    liveModal('철근 배치 단수', (body) => {
        const c = store.get('culverts.' + ctx.ci);
        const g = sectionGeom(c, ctx.bi);
        const rows = [];
        for (const m of mainMembers(g)) {
            m.faces.forEach((f, i) => {
                const base = `${sp}.layers.${m.key}.${f.key}`;
                const o = store.get(base) || {};
                const cell = (k, dis) => custom('check', () => !!store.get(`${base}.${k}`), (v) => {
                    store.transact(() => {
                        store.set(`${base}.${k}`, !!v);
                        if (!v && k.startsWith('l2')) store.set(`${base}.l3${k.slice(2)}`, false);
                    });
                }, { disabled: dis });
                rows.push({
                    head: i === 0 ? [{ t: m.title, rs: m.faces.length }, { t: f.title }] : [{ t: f.title }],
                    cells: [cell('l2c1'), cell('l2c2'), cell('l3c1', !o.l2c1), cell('l3c2', !o.l2c2)],
                });
            });
        }
        new Grid(body, {
            id: 'main-layers',
            head: [[{ t: '구분', cs: 2, rs: 2 }, { t: '2단', cs: 2 }, { t: '3단', cs: 2 }], [{ t: '1Cycle' }, { t: '2Cycle' }, { t: '1Cycle' }, { t: '2Cycle' }]],
            rows, colWidths: [110, 50, 60, 60, 60, 60],
        });
        body.appendChild(h('div', { class: 'inline-opts', style: { marginTop: '6px' } }, [
            button('기본값(D)', () => store.set(`${sp}.layers`, {})),
            button('모든 블럭 동일 적용', () => {
                const src = clone(store.get(`${sp}.layers`) || {});
                store.transact(() => { for (const b of ctx.blocks) if (b.index !== ctx.bi) store.set(`${settingsPath(ctx, b.index)}.layers`, clone(src)); });
            }, { disabled: ctx.blocks.length < 2 }),
        ]));
        body.appendChild(h('div', { class: 'note' }, '* 체크한 단·Cycle 은 [입력단수]에서 2단철근/3단철근으로 입력할 수 있습니다.'));
    }, { buttons: [{ text: '확인(O)', primary: true }] });
}

// ── 모든 블럭 동일 적용 ─────────────────────────────────────────────

function sameBlocks(ctx, cyc, tab) {
    const src = (bi) => `${ctx.cp}.rebar.main.${bi}.c${cyc}`;
    const targets = sameKindBlocks(ctx);
    sameBlockPopup(() => {
        const s = clone(store.get(src(ctx.bi)) || {});
        for (const b of targets) store.set(src(b), clone(s));
        ctx.setHint('현재 블록의 주철근 입력(모든 탭)을 같은 형식의 모든 블록에 적용했습니다.');
    }, () => {
        const s = store.get(src(ctx.bi)) || {};
        for (const b of targets) {
            const t = clone(store.get(src(b)) || {});
            for (const z of ZONES) {
                for (const lk of ['L1', 'L2', 'L3']) {
                    const v = s[z] && s[z][lk] && s[z][lk][tab];
                    if (v === undefined) continue;
                    t[z] = t[z] || {}; t[z][lk] = t[z][lk] || {};
                    t[z][lk][tab] = clone(v);
                }
            }
            store.set(src(b), t);
        }
        ctx.setHint('현재 탭의 주철근 입력을 같은 형식의 모든 블록에 적용했습니다.');
    });
}

// ── 팝업: 설계검토 ──────────────────────────────────────────────────

export function designCheckPopup(ctx, cyc, kind) {
    const p = store.project, c = p.culverts[ctx.ci];
    const fv = { ...DEFAULT_FORCE, ...(store.get(`${ctx.cp}.rebar.forceView`) || {}) };
    let tab = 'flex';
    const title = kind === 24 ? '주철근(2,4Cycle) 설계검토' : `주철근(${kind}Cycle) 설계검토`;
    const run = () => mainFlexureCheck(p, c, ctx.bi, {
        flexure: rcFlexure || undefined,
        moment: (pos) => momentAt(p, c, ctx.bi, pos, fv.state),
    });
    const body = h('div', { style: { minWidth: '700px' } });
    const paint = () => {
        body.innerHTML = '';
        const rows = run();
        const grid = h('div', {});
        body.appendChild(grid);
        let prev = null;
        const groupCount = (t) => rows.filter(r => r.title === t).length;
        const okCell = (ok) => lbl(ok == null ? '-' : ok ? 'O.K' : 'N.G', { align: 'center', cls: ok === false ? 'ng' : '' });
        const f3 = (v) => (v == null || !isFinite(v) ? '-' : v.toFixed(3));
        if (tab === 'flex') {
            new Grid(grid, {
                id: 'main-check',
                head: [
                    [{ t: '구분', cs: 2, rs: 2 }, { t: '철근비', cs: 4 }, { t: '모멘트 (kN·m)', cs: 4 }],
                    [{ t: 'Pmin' }, { t: 'Puse' }, { t: 'Pmax' }, { t: '비고' }, { t: 'φMn' }, { t: 'Mu' }, { t: '안전도' }, { t: '비고' }],
                ],
                rows: rows.map(r => {
                    const head = [];
                    if (r.title !== prev) head.push({ t: r.title, rs: groupCount(r.title) });
                    prev = r.title;
                    head.push({ t: r.label });
                    return {
                        head,
                        cells: [lbl(f3(r.rhoMin)), lbl(f3(r.rho)), lbl(f3(r.rhoMax)), okCell(r.okRho),
                            lbl(f3(r.phiMn)), lbl(f3(r.Mu)), lbl(f3(r.sf)), okCell(r.okM)],
                    };
                }),
                colWidths: [80, 120, 60, 60, 60, 50, 80, 80, 60, 50],
            });
            const st = frameStatus();
            body.appendChild(h('div', { class: 'note' }, rows.some(r => r.Mu != null)
                ? `* Mu: 2D Frame 해석 ${fv.state} 포락값. φMn: 단위폭 1m, 인장측 주철근(배치된 모든 Cycle·단).`
                : `* 계수모멘트가 없어 휨강도(φMn)와 철근비만 표시합니다. ${st === 'missing' ? '(2D Frame 해석 모듈 없음)' : '([2D Frame 해석] 후 다시 확인하세요)'}`));
        } else {
            new Grid(grid, {
                id: 'main-crack',
                head: [[{ t: '구분', cs: 2, rs: 2 }, { t: '응력검토', cs: 2 }, { t: '균열폭검토', cs: 3 }], [{ t: 'fs' }, { t: 'fsa' }, { t: 'S' }, { t: 'Sa' }, { t: '비고' }]],
                rows: rows.map(r => {
                    const head = [];
                    if (r.title !== prev) head.push({ t: r.title, rs: groupCount(r.title) });
                    prev = r.title;
                    head.push({ t: r.label });
                    return { head, cells: [lbl('-'), lbl('-'), lbl('-'), lbl('-'), lbl('-', { align: 'center' })] };
                }),
                colWidths: [80, 120, 70, 70, 80, 80, 50],
            });
            body.appendChild(h('div', { class: 'note' }, '* 균열검토는 사용하중 모멘트가 필요합니다. [단면 검토] 결과가 준비되면 표시됩니다.'));
        }
        body.appendChild(h('div', { class: 'inline-opts', style: { marginTop: '4px' } }, [
            button('단면력검토', () => { tab = 'flex'; paint(); }, { cls: tab === 'flex' ? 'primary' : '' }),
            button('균열검토', () => { tab = 'crack'; paint(); }, { cls: tab === 'crack' ? 'primary' : '' }),
        ]));
    };
    paint();
    modal({ title, body, buttons: [{ text: '확인', primary: true }], width: 760 });
    // 해석 모듈을 처음 부르는 경우 준비되면 다시 계산
    if (loadFrame(() => { if (document.body.contains(body)) paint(); }) === 'loading') { /* 대기 */ }
}

// ── 팝업: 자동계산 ──────────────────────────────────────────────────

function autoCalcPopup(ctx) {
    const ap = `${ctx.cp}.rebar.autoCalc`;
    ensure(ap, () => ({ ...DEFAULT_AUTO }));
    liveModal('철근배치 최적화 설정', (body) => {
        new Grid(body, {
            id: 'main-auto',
            head: [],
            rows: [
                { head: [{ t: '검토단면' }], cells: [sel(`${ap}.section`, ['단면 A-A'])] },
                { head: [{ t: '주철근 최소 직경' }], cells: [sel(`${ap}.minDia`, DIAS)] },
                { head: [{ t: '주철근 최대 직경' }], cells: [sel(`${ap}.maxDia`, DIAS)] },
            ],
            colWidths: [140, 100],
        });
        body.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', margin: '6px 2px' } }, [
            bCheck(`${ap}.symmetric`, ' 주철근 직경 대칭적용'),
            bCheck(`${ap}.twoLayer`, ' 주철근 2단 배치적용'),
            bCheck(`${ap}.separate`, ' 1,2 Cycle의 철근직경을 분리하여 적용'),
            h('label', {}, ['최적화 기준 안전율 (%) ', (() => {
                const i = h('input', { type: 'text', style: { width: '60px', textAlign: 'right' } });
                i.value = store.get(`${ap}.target`);
                i.addEventListener('change', () => store.set(`${ap}.target`, +i.value || 100));
                return i;
            })()]),
        ]));
        body.appendChild(h('div', { class: 'note' }, '* 최소 직경부터 한 단계씩 키워 기준 안전율을 만족하면 멈춥니다. 최대 직경에서도 부족하면 (2단 배치적용 시) 2단 철근을 추가합니다.'));
    }, { buttons: [{ text: '확인', primary: true, onClick: () => { runAutoCalc(ctx); } }, { text: '취소' }] });
}

function runAutoCalc(ctx) {
    const p = store.project, c = p.culverts[ctx.ci], bi = ctx.bi;
    const a = { ...DEFAULT_AUTO, ...(store.get(`${ctx.cp}.rebar.autoCalc`) || {}) };
    const done = () => {
        const g = sectionGeom(c, bi);
        const fv = store.get(`${ctx.cp}.rebar.forceView`) || DEFAULT_FORCE;
        const positions = checkPositions(g);
        const mus = positions.map(pos => momentAt(p, c, bi, pos, fv.state));
        if (!mus.some(v => v != null)) { alertBox('계수모멘트가 없어 자동계산할 수 없습니다.\n[2D Frame 해석]을 먼저 수행하세요.'); return; }
        const st = getSettings(c, bi);
        const cycles = cyclesOf(st).filter(x => x === 1 || x === 2);
        const dias = diaRange(a.minDia, a.maxDia);
        const target = (+a.target || 100) / 100;
        const sp = settingsPath(ctx);
        // 면 단위로 같은 직경을 적용 (모든 조각)
        const faceKeys = [...new Set(positions.map(q => `${q.member}|${q.face}`))];
        store.transact(() => {
            const result = {};
            for (const fk of faceKeys) {
                const [member, face] = fk.split('|');
                const idx = positions.map((q, i) => i).filter(i => positions[i].member === member && positions[i].face === face && mus[i] != null);
                if (!idx.length) continue;
                const setDia = (dia, cycList) => {
                    for (const cyc of cycList) {
                        const d = getMainFace(store.project.culverts[ctx.ci], bi, cyc, 'straight', 1, member, face, g);
                        d.R = d.R.map(() => dia);
                        store.set(mainFacePath(ctx.cp, bi, cyc, 'straight', 1, member, face), d);
                    }
                };
                const check = () => {
                    const rows = mainFlexureCheck(p, store.project.culverts[ctx.ci], bi, { flexure: rcFlexure || undefined, moment: (pos) => momentAt(p, c, bi, pos, fv.state) });
                    return idx.every(i => { const r = rows[i]; return r.sf == null || r.sf >= target; });
                };
                let ok = false;
                for (const dia of dias) {
                    setDia(dia, a.separate ? [1] : cycles);
                    if (check()) { ok = true; result[fk] = dia; break; }
                }
                if (!ok && a.twoLayer) {
                    store.set(`${sp}.layers.${member}.${face}.l2c1`, true);
                    ok = check();
                    result[fk] = dias[dias.length - 1] + ' (2단)';
                }
                if (!ok && !result[fk]) result[fk] = dias[dias.length - 1] + ' (부족)';
            }
            if (a.symmetric) {
                for (const face of ['O', 'I']) {
                    const l = result[`left|${face}`], r = result[`right|${face}`];
                    if (!l || !r) continue;
                    const big = parseInt(String(l).slice(1), 10) >= parseInt(String(r).slice(1), 10) ? l : r;
                    for (const m of ['left', 'right']) for (const cyc of a.separate ? [1] : cycles) {
                        const d = getMainFace(store.project.culverts[ctx.ci], bi, cyc, 'straight', 1, m, face, g);
                        d.R = d.R.map(() => String(big).split(' ')[0]);
                        store.set(mainFacePath(ctx.cp, bi, cyc, 'straight', 1, m, face), d);
                    }
                }
            }
        });
        ctx.setHint('자동계산으로 주철근 직경을 조정했습니다. (Ctrl+Z 로 취소)');
    };
    const s = loadFrame(() => done());
    if (s === 'ready' || s === 'missing') done();
}

// ── 팝업: 철근연결 (2,4Cycle) ───────────────────────────────────────

function connectPopup(ctx) {
    const base = `${ctx.cp}.rebar.connect.${ctx.bi}`;
    liveModal('철근연결설정', (body) => {
        const c = store.get('culverts.' + ctx.ci);
        const g = sectionGeom(c, ctx.bi);
        const n = g.kind === 'U' ? 1 : (g.kind === 'DOUBLE' ? g.cells.filter(x => x.floor === 1).length : g.cells.length);
        const boxes = Array.from({ length: n }, (_, i) => `Box${i + 1}`);
        const seg = ['좌측벽체~Box1', ...boxes.slice(0, -1).map((b, i) => `${b}~${boxes[i + 1]}`), `Box${n}~우측벽체`];
        const table = (title, groups, key) => {
            const rows = [];
            for (const [gname, items, gk] of groups) {
                items.forEach((it, i) => rows.push({
                    head: i === 0 ? [{ t: gname, rs: items.length }, { t: it }] : [{ t: it }],
                    cells: [chk(`${base}.${key}.${gk}.${i}`), lbl(0, { cls: 'ro', align: 'center' })],
                }));
            }
            const wrap = h('div', { style: { display: 'inline-block', verticalAlign: 'top', marginRight: '10px' } });
            new Grid(wrap, { id: `conn-${key}`, head: [[{ t: title, cs: 2 }, { t: '연결' }, { t: '이음수' }]], rows, colWidths: [50, 130, 40, 50] });
            return wrap;
        };
        const hasTop = g.kind !== 'U';
        if (hasTop) body.appendChild(table('상부슬래브', [['상면', boxes, 'U'], ['하면', seg, 'L']], 'top'));
        body.appendChild(table('하부슬래브', [['상면', seg, 'U'], ['하면', boxes, 'L']], 'bottom'));
        body.appendChild(table('외측벽체', [['좌측', ['외측면', '내측상단~상부슬래브', '내측하단~하부슬래브'], 'L'], ['우측', ['외측면', '내측상단~상부슬래브', '내측하단~하부슬래브'], 'R']], 'wall'));
        body.appendChild(h('div', { class: 'inline-opts', style: { marginTop: '6px' } }, [
            button('기본값(D)', () => store.set(base, {})),
            button('모든 블럭 동일 적용', () => {
                const src = clone(store.get(base) || {});
                store.transact(() => { for (const b of ctx.blocks) if (b.index !== ctx.bi) store.set(`${ctx.cp}.rebar.connect.${b.index}`, clone(src)); });
            }, { disabled: ctx.blocks.length < 2 }),
        ]));
        body.appendChild(h('div', { class: 'note' }, '* 2,4Cycle 철근이 중간에서 끊길 때 이웃 부재 철근과 이어 배치합니다 (예: 하면 철근을 외측벽체까지 연장).'));
    }, { buttons: [{ text: '확 인', primary: true }], width: 760 });
}

export { mainBarLayout };

export default makeMainScreen(1);
