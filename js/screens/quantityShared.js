// quantityShared.js - 출력 > 수량산출서 (일반 / 공통 / 토공) 공용 화면 (매뉴얼 m3 3장, 메뉴 항목 아님)
//
// 왼쪽: [수량산출] · 탭(일반|공통|토공) · 항목 트리(체크 = 출력 대상) · [전체][해제][반전][산근][집계]
// 오른쪽: A 집계표 / B 산출근거 미리보기 (Grid), 화면정렬 수직/수평
// 하단: [수량산출 옵션 선택] [수량 산출] [수량산출서 출력] [출력된 삽도 보기] [출력파일 열기] + 진행 문구
// 확인창: 선택한 시트의 삽도 (본체 단면 / 터파기 단면 / 날개벽 / 접속슬래브)
//
// 데이터: project.output.quantity = { byCulvert: { [ci]: 옵션 }, checked: { 일반|공통|토공: { [sheetId]: false } }, layout: 'v'|'h' }

import store, { clone } from '../core/store.js';
import { h, button, modal, alertBox } from '../ui/dom.js';
import { Grid } from '../ui/grid.js';
import { custom, lbl } from '../ui/cells.js';
import {
    quantities, quantityToExcelXml, getQuantityOptions, defaultQuantityOptions,
    BASIS, REBAR_MODES, ASSEMBLY, FORM_TYPES, FORM_PARTS, OUTPUT_ITEMS, CONC_PARTS,
} from '../calc/quantity.js';
import { quantityFigure, quantityFigures, quantityFiguresDrawing } from '../draw/quantityDraw.js';
import { drawingToSvg } from '../draw/svgExport.js';
import { drawingToDxf, downloadText } from '../cad/dxfWriter.js';
import { Drawing } from '../cad/drawing.js';

const QP = 'output.quantity';
const TABS = [['일반', 'quantityOut'], ['공통', 'quantityCommon'], ['토공', 'quantityEarth']];

const cache = { key: null, result: null, ms: 0 };
const selection = {};             // tab → { a, b }
let status = '수량산출서 출력 대기……';
let lastOut = null;               // { result, tab, ids, name }

// ── 계산 (입력·옵션이 같으면 재사용) ──────────────────────────────────

export function quantityResult(ctx, force = false) {
    const o = getQuantityOptions(ctx.p, ctx.ci);
    const key = JSON.stringify([ctx.ci, ctx.c, ctx.p.alignment, ctx.p.design, ctx.p.rebarCommon, o]);
    if (force || cache.key !== key || !cache.result) {
        const t0 = performance.now();
        cache.result = quantities(ctx.p, { ci: ctx.ci });
        cache.key = key;
        cache.ms = Math.round(performance.now() - t0);
    }
    return cache.result;
}

const qget = (p) => (p.output && p.output.quantity) || {};
function checkedMap(ctx, tab) { return { ...((qget(ctx.p).checked || {})[tab] || {}) }; }
const isOn = (map, id) => map[id] !== false;

function flatten(nodes, parent = null, out = []) {
    for (const n of nodes || []) { out.push({ ...n, parent }); flatten(n.children, n.id, out); }
    return out;
}

function sel(ctx, tab, res) {
    const flat = flatten(res.trees[tab]);
    const s = selection[tab] || (selection[tab] = {});
    if (!flat.some(n => n.id === s.a && n.kind === '집계')) s.a = (flat.find(n => n.kind === '집계') || {}).id;
    if (!flat.some(n => n.id === s.b && n.kind === '산근')) {
        const ch = flat.find(n => n.kind === '산근' && n.parent === s.a) || flat.find(n => n.kind === '산근');
        s.b = ch ? ch.id : null;
    }
    if (!s.view) s.view = s.b || s.a;
    return s;
}

// ── 시트 표 ───────────────────────────────────────────────────────────

function sheetGrid(host, sheet, gid) {
    host.innerHTML = '';
    if (!sheet) { host.appendChild(h('div', { style: { padding: '8px', color: '#555' } }, '표시할 시트가 없습니다.')); return; }
    const num = (v, o = {}) => (typeof v === 'number' ? { type: 'label', value: v, dec: o.dec ?? 3, align: 'right' } : { type: 'label', value: v ?? '', align: o.align || (v === '-' ? 'center' : 'left') });
    let head, rows, colWidths;
    if (sheet.kind === '산근') {
        head = [[{ t: '공 종' }, { t: '' }, { t: '산 출 근 거' }, { t: '수 량' }, { t: '단위' }]];
        rows = sheet.rows.map(r => ({
            cls: r[2] === '계' ? 'q-sum' : '',
            cells: [num(r[0]), num(r[1], { align: 'center' }), num(r[2]), num(r[3] === '' ? '' : r[3]), num(r[4], { align: 'center' })],
        }));
        colWidths = [110, 26, 360, 80, 40];
    } else {
        const nc = sheet.cols.length;
        head = [[{ t: '공 종' }, { t: '규 격' }, { t: '구 분' }, { t: '단위' }, ...sheet.cols.map(t => ({ t })), { t: '합 계' }]];
        rows = sheet.rows.map(r => ({ cells: r.map((v, i) => num(v, { align: i === 3 ? 'center' : undefined })) }));
        colWidths = [96, 96, 70, 40, ...Array(nc).fill(76), 84];
    }
    new Grid(host, { id: gid, head, rows, colWidths });
}

function sheetHtml(sheet) {
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const f = (v) => (typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : esc(v));
    const head = sheet.kind === '산근' ? ['공 종', '', '산 출 근 거', '수 량', '단위'] : ['공 종', '규 격', '구 분', '단위', ...sheet.cols, '합 계'];
    const th = head.map(t => `<th style="border:1px solid #888;background:#dce6f1;padding:2px 6px">${esc(t)}</th>`).join('');
    const tr = sheet.rows.map(r => `<tr>${r.map(v => `<td style="border:1px solid #bbb;padding:1px 6px;${typeof v === 'number' ? 'text-align:right' : ''}${r[2] === '계' ? ';font-weight:bold;background:#f2f2f2' : ''}">${f(v)}</td>`).join('')}</tr>`).join('');
    return `<h3 style="margin:6px 0">${esc(sheet.name)}</h3><table style="border-collapse:collapse;font-size:12px;margin-bottom:14px">${`<tr>${th}</tr>`}${tr}</table>`;
}

// ── 출력 ─────────────────────────────────────────────────────────────

function outputIds(ctx, tab, res) {
    const map = checkedMap(ctx, tab);
    return flatten(res.trees[tab]).filter(n => isOn(map, n.id)).map(n => n.id);
}

function fileBase(ctx, tab) {
    return `${(ctx.c.name || '암거')}_${tab}수량 산출서`.replace(/[\\/:*?"<>|]+/g, '_');
}

function doOutput(ctx, tab) {
    const res = quantityResult(ctx);
    const ids = outputIds(ctx, tab, res);
    if (!ids.length) { alertBox('출력할 항목을 트리에서 하나 이상 선택하십시오.'); return; }
    status = `${ctx.c.name || '암거'}_${tab} 수량산출서 출력중...`;
    ctx.setHint(status);
    setTimeout(() => {
        try {
            const xml = quantityToExcelXml(res, { sheets: ids });
            const name = fileBase(ctx, tab);
            downloadText(xml, `${name}.xls`, 'application/vnd.ms-excel');
            lastOut = { result: res, tab, ids, name, ci: ctx.ci };
            status = `출력완료!! (${name}.xls, 시트 ${ids.length}개)`;
            ctx.setHint(status);
        } catch (e) {
            console.error(e);
            status = '출력 오류: ' + e.message;
            ctx.setHint(status, true);
        }
        ctx.rerender();
    }, 20);
}

function openLast() {
    if (!lastOut) return;
    const sheets = lastOut.ids.map(id => lastOut.result.sheet(id)).filter(Boolean);
    const list = h('div', { style: { width: '200px', flex: '0 0 200px', overflow: 'auto', borderRight: '1px solid #9db8de', fontSize: '12px' } });
    const body = h('div', { style: { flex: '1', overflow: 'auto', background: '#fff', padding: '4px 8px' }, html: sheets.map((s, i) => `<section data-i="${i}">${sheetHtml(s)}</section>`).join('') });
    sheets.forEach((s, i) => list.appendChild(h('div', {
        style: { cursor: 'pointer', padding: '2px 4px' },
        onclick: () => { const sec = body.querySelector(`section[data-i="${i}"]`); if (sec) body.scrollTop = sec.offsetTop - body.offsetTop; },
    }, s.name)));
    const m = modal({
        title: `출력파일 열기 — ${lastOut.name}.xls`, width: 1080, height: 720,
        body: h('div', { style: { display: 'flex', gap: '6px', height: '100%', minHeight: '0' } }, [list, body]),
        buttons: [
            { text: '다시 저장(.xls)', onClick: () => { downloadText(quantityToExcelXml(lastOut.result, { sheets: lastOut.ids }), `${lastOut.name}.xls`, 'application/vnd.ms-excel'); return false; } },
            { text: '닫기', primary: true },
        ],
    });
    m.body.style.display = 'flex'; m.body.style.flexDirection = 'column'; m.body.style.minHeight = '0';
}

/** 출력된 삽도 보기 (Pic 탭 + DXF 저장) */
function figuresDialog(ctx, tab) {
    const res = quantityResult(ctx);
    const ids = outputIds(ctx, tab, res);
    const figs = quantityFigures(ctx.p, ctx.c, res, { sheets: ids.length ? ids : undefined });
    if (!figs.length) { alertBox('출력할 삽도가 없습니다. 트리에서 산출근거 항목을 선택하십시오.'); return; }
    let cur = 0;
    const tabs = h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap', marginBottom: '4px', maxHeight: '58px', overflow: 'auto' } });
    const view = h('div', { style: { background: '#fff', border: '1px solid #7393c6', height: '470px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
    const cap = h('div', { style: { padding: '2px 4px', fontWeight: 'bold' } });
    const all = h('input', { type: 'checkbox' });
    const show = () => {
        tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === cur));
        view.innerHTML = drawingToSvg(figs[cur].drawing, { width: 760, height: 460 });
        cap.textContent = `[Pic ${figs[cur].no}] ${figs[cur].title}`;
    };
    figs.forEach((f, i) => tabs.appendChild(button(`Pic ${f.no}`, () => { cur = i; show(); }, { title: f.title })));
    modal({
        title: '계산서 삽도 보기', width: 810,
        body: h('div', { style: { width: '780px' } }, [tabs, cap, view, h('label', { style: { display: 'inline-flex', gap: '4px', marginTop: '4px' } }, [all, '전체파일 저장 (모든 삽도를 한 DXF 로)'])]),
        buttons: [
            {
                text: 'DXF파일로 저장', onClick: () => {
                    let d;
                    if (all.checked) d = quantityFiguresDrawing(figs);
                    else { d = new Drawing({ textHeight: figs[cur].drawing.textHeight }); d.merge(figs[cur].drawing); }
                    downloadText(drawingToDxf(d), `${fileBase(ctx, tab)}${all.checked ? '_삽도' : `_Pic${figs[cur].no}`}.dxf`, 'application/dxf');
                    return false;
                },
            },
            { text: '확 인', primary: true },
        ],
    });
    show();
}

// ── 수량산출 옵션 ────────────────────────────────────────────────────

export function optionsDialog(ctx) {
    const p = ctx.p;
    let ci = ctx.ci;
    let draft = clone(getQuantityOptions(p, ci));
    let tab = 0;
    const wrap = h('div', { style: { width: '560px' } });
    const paint = () => {
        wrap.innerHTML = '';
        // 구조물 선택
        const cs = h('select', {});
        p.culverts.forEach((c, i) => { const op = h('option', { value: i }, `암거${i + 1}:${c.name || ''}`); if (i === ci) op.selected = true; cs.appendChild(op); });
        cs.addEventListener('change', () => { ci = +cs.value; draft = clone(getQuantityOptions(p, ci)); paint(); });
        wrap.appendChild(h('div', { style: { marginBottom: '4px' } }, [cs]));
        const tb = h('div', { style: { display: 'flex', gap: '2px', marginBottom: '4px' } });
        ['출력옵션', '일반수량 옵션', '거푸집수량 옵션'].forEach((t, i) => tb.appendChild(h('button', { class: 'dlg-tab' + (i === tab ? ' active' : ''), onclick: () => { tab = i; paint(); } }, t)));
        wrap.appendChild(tb);
        const host = h('div', { style: { maxHeight: '440px', overflow: 'auto' } });
        wrap.appendChild(host);
        const set = (fn) => (v) => { fn(v); paint(); };
        const chkCell = (get, put, on, off) => custom('check', get, set(put), { text: get() ? on : off, align: 'right' });
        if (tab === 0) {
            const rows = [
                ['수량산출 적용기준', custom('select', () => draft.basis, set(v => { draft.basis = v; }), { options: BASIS })],
                ['삽도출력시 지반정보 출력', chkCell(() => draft.groundFig, v => { draft.groundFig = v; }, '출력', '출력안함')],
                ['철근수량 집계방법', custom('select', () => draft.rebarMode, set(v => { draft.rebarMode = v; }), { options: REBAR_MODES })],
                ['엑셀로 출력시 집계표간 셀 참조', chkCell(() => draft.refSummary, v => { draft.refSummary = v; }, '셀 참조', '셀 참조 안함')],
                ['엑셀로 출력시 산출근거 셀 참조', chkCell(() => draft.refBasis, v => { draft.refBasis = v; }, '셀 참조', '셀 참조 안함')],
                ['철근 할증율 적용', chkCell(() => draft.rebarWaste, v => { draft.rebarWaste = v; }, '적용', '적용 안함')],
                ['옹벽수량을 총괄집계표에 합산', chkCell(() => draft.wallInTotal, v => { draft.wallInTotal = v; }, '적용', '적용 안함')],
            ].map(([t, cell]) => ({ head: [{ t, cs: 2 }], cells: [cell] }));
            OUTPUT_ITEMS.forEach(([k, t], i) => rows.push({
                head: i === 0 ? [{ t: '출력선택사항', rs: OUTPUT_ITEMS.length }, { t }] : [{ t }],
                cells: [chkCell(() => draft.items[k] !== false, v => { draft.items[k] = v; }, '선택', '선택안함')],
            }));
            new Grid(host, { id: 'qty-opt-0', head: [[{ t: '구 분', cs: 2 }, { t: '설정값' }]], rows, colWidths: [110, 220, 200] });
        } else if (tab === 1) {
            const G = draft.general;
            const unit = (u) => lbl(u, { cls: 'ro', align: 'center' });
            const rows = [
                { head: [{ t: '동바리', cs: 2 }], cells: [lbl(G.shore, { cls: 'ro', align: 'right' }), unit('')] },
                { head: [{ t: '비계', cs: 2 }], cells: [lbl(G.scaffold, { cls: 'ro', align: 'right' }), unit('')] },
                { head: [{ t: '비계수량 공제높이', cs: 2 }], cells: [custom('num', () => G.scaffoldDeduct, set(v => { G.scaffoldDeduct = +v || 0; }), { dec: 0 }), unit('mm')] },
                { head: [{ t: '지수판', cs: 2 }], cells: [custom('text', () => G.waterstop, set(v => { G.waterstop = v; }), { align: 'right' }), unit('')] },
                { head: [{ t: '실런트', cs: 2 }], cells: [custom('text', () => G.sealant, set(v => { G.sealant = v; }), { align: 'right' }), unit('')] },
                { head: [{ t: '스티로폼', cs: 2 }], cells: [custom('num', () => G.styro, set(v => { G.styro = +v || 0; }), { dec: 0 }), unit('mm')] },
            ];
            const asm = [['body', '본체'], ['approach', '접속슬래브'], ['wall', '옹벽'], ['wing', '날개벽']];
            asm.forEach(([k, t], i) => rows.push({ head: i === 0 ? [{ t: '철근조립', rs: asm.length }, { t }] : [{ t }], cells: [custom('select', () => G.assembly[k], set(v => { G.assembly[k] = v; }), { options: ASSEMBLY }), unit('')] }));
            CONC_PARTS.forEach(([k, t], i) => rows.push({ head: i === 0 ? [{ t: '콘크리트 굵은골재최대치수', rs: CONC_PARTS.length }, { t }] : [{ t }], cells: [custom('num', () => G.agg[k], set(v => { G.agg[k] = +v || 0; }), { dec: 0 }), unit('mm')] }));
            CONC_PARTS.forEach(([k, t], i) => rows.push({ head: i === 0 ? [{ t: '콘크리트 슬럼프', rs: CONC_PARTS.length }, { t }] : [{ t }], cells: [custom('num', () => G.slump[k], set(v => { G.slump[k] = +v || 0; }), { dec: 0 }), unit('mm')] }));
            new Grid(host, { id: 'qty-opt-1', head: [[{ t: '구 분', cs: 2 }, { t: '설정값' }, { t: '단위' }]], rows, colWidths: [150, 90, 150, 50] });
        } else {
            const rows = [];
            const groups = [];
            for (const r of FORM_PARTS) { const g = groups.find(x => x.name === r[0]); if (g) g.list.push(r); else groups.push({ name: r[0], list: [r] }); }
            for (const g of groups) {
                g.list.forEach(([, k, t], i) => {
                    const user = draft.form[k] === '사용자입력';
                    rows.push({
                        head: i === 0 ? [{ t: g.name, rs: g.list.length }, { t }] : [{ t }],
                        cells: [
                            custom('select', () => draft.form[k], set(v => { draft.form[k] = v; }), { options: [...FORM_TYPES, '사용자입력'] }),
                            user ? custom('text', () => draft.formUser[k] || '', set(v => { draft.formUser[k] = v; })) : lbl(draft.form[k], { cls: 'ro' }),
                        ],
                    });
                });
            }
            new Grid(host, { id: 'qty-opt-2', head: [[{ t: '구 분', cs: 2 }, { t: '설정값' }, { t: '사용자입력' }]], rows, colWidths: [90, 130, 140, 140] });
        }
    };
    const save = (all) => {
        store.transact(() => {
            const targets = all ? p.culverts.map((_, i) => i) : [ci];
            for (const i of targets) store.set(`${QP}.byCulvert.${i}`, clone(draft));
        });
        ctx.setHint(all ? '수량산출 옵션을 모든 암거에 적용했습니다.' : '수량산출 옵션을 저장했습니다.');
    };
    paint();
    modal({
        title: '수량산출 옵션', body: wrap, width: 600,
        buttons: [
            { text: '기본값', onClick: () => { draft = defaultQuantityOptions(); paint(); return false; } },
            { text: '모든 암거 동일적용', onClick: () => save(true) },
            { text: '저장', onClick: () => { downloadText(JSON.stringify(draft, null, 2), `수량산출옵션.aco`, 'application/json'); return false; } },
            {
                text: '열기', onClick: () => {
                    const inp = h('input', { type: 'file', accept: '.aco,.json' });
                    inp.addEventListener('change', () => {
                        const f = inp.files && inp.files[0];
                        if (!f) return;
                        f.text().then(t => {
                            try { const o = JSON.parse(t); draft = { ...defaultQuantityOptions(), ...o, general: { ...defaultQuantityOptions().general, ...(o.general || {}) } }; paint(); } catch { alertBox('수량산출 옵션 파일을 읽을 수 없습니다.'); }
                        });
                    });
                    inp.click();
                    return false;
                },
            },
            { text: '확인', primary: true, onClick: () => save(false) },
            { text: '취소' },
        ],
    });
}

// ── 화면 ─────────────────────────────────────────────────────────────

export function makeQuantityScreen(tab) {
    return {
        scope: 'culvert',
        hint: `수량산출서(${tab})를 출력합니다. 트리에서 집계표/산출근거를 확인하고 출력할 항목을 체크한 후 [수량산출서 출력] 을 누르십시오.`,

        render(el, ctx) {
            let res;
            try { res = quantityResult(ctx); } catch (e) {
                console.error(e);
                el.appendChild(h('div', { style: { color: '#b00', padding: '8px' } }, '수량산출 오류: ' + e.message));
                return;
            }
            const s = sel(ctx, tab, res);
            const map = checkedMap(ctx, tab);
            const flat = flatten(res.trees[tab]);
            const setChecked = (m) => store.set(`${QP}.checked.${tab}`, m, { record: false });

            // ── 왼쪽: 트리 ──
            const tabsEl = h('div', { style: { display: 'flex', gap: '1px', margin: '3px 0' } },
                TABS.map(([t, id]) => h('button', { class: 'dlg-tab' + (t === tab ? ' active' : ''), onclick: () => t !== tab && ctx.go(id) }, t)));
            const tree = h('div', { style: { flex: '1', overflow: 'auto', background: '#fff', border: '1px solid #7393c6', padding: '2px', fontSize: '12px', minHeight: '120px' } });
            const addNode = (n, depth) => {
                const cb = h('input', { type: 'checkbox' });
                cb.checked = isOn(map, n.id);
                cb.addEventListener('change', () => {
                    const m = { ...map };
                    const mark = (x) => { m[x.id] = cb.checked; (x.children || []).forEach(mark); };
                    mark(n);
                    setChecked(m);
                });
                const active = n.id === s.view;
                const lab = h('span', {
                    style: { cursor: 'pointer', padding: '0 3px', background: active ? '#ffd979' : (n.id === s.a || n.id === s.b ? '#e3eefc' : ''), borderRadius: '2px', whiteSpace: 'nowrap' },
                    title: n.kind === '산근' ? '산출근거 (B) 에 표시 — Ctrl+클릭: 집계표(A)는 유지' : '집계표 (A) 에 표시',
                    onclick: (e) => {
                        if (n.kind === '집계') {
                            s.a = n.id;
                            const ch = flat.find(x => x.parent === n.id && x.kind === '산근');
                            if (ch) s.b = ch.id;
                        } else {
                            s.b = n.id;
                            if (!e.ctrlKey) { const par = flat.find(x => x.id === n.id); if (par && par.parent && res.sheet(par.parent) && res.sheet(par.parent).kind === '집계') s.a = par.parent; }
                        }
                        s.view = n.id;
                        ctx.rerender();
                    },
                }, n.label);
                tree.appendChild(h('div', { style: { paddingLeft: `${depth * 14}px`, display: 'flex', alignItems: 'center', gap: '2px', lineHeight: '19px' } }, [cb, lab]));
                (n.children || []).forEach(ch => addNode(ch, depth + 1));
            };
            res.trees[tab].forEach(n => addNode(n, 0));
            const bulk = (fn) => () => { const m = {}; for (const n of flat) m[n.id] = fn(n); setChecked(m); };
            const foot = h('div', { style: { display: 'flex', gap: '2px', marginTop: '3px', flexWrap: 'wrap' } }, [
                button('전체', bulk(() => true)),
                button('해제', bulk(() => false)),
                button('반전', bulk(n => !isOn(map, n.id))),
                button('산근', bulk(n => n.kind === '산근'), { title: '산출근거만 선택' }),
                button('집계', bulk(n => n.kind === '집계'), { title: '집계표만 선택' }),
            ]);
            const left = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', minWidth: '0' } }, [
                button('수량산출', () => { quantityResult(ctx, true); ctx.setHint(`수량을 다시 산출했습니다 (${cache.ms} ms).`); ctx.rerender(); }, { cls: 'primary', title: '현재 입력값으로 수량을 다시 산출합니다' }),
                tabsEl, tree, foot,
            ]);
            left.firstChild.style.width = '100%';

            // ── 오른쪽: A 집계표 / B 산출근거 ──
            const layout = qget(ctx.p).layout === 'h' ? 'h' : 'v';
            const paneA = h('div', { style: { overflow: 'auto', minHeight: '0', minWidth: '0' } });
            const paneB = h('div', { style: { overflow: 'auto', minHeight: '0', minWidth: '0' } });
            const titled = (lab, sh, pane) => h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', minWidth: '0', border: '2px solid #2f4fd0', background: '#fff' } }, [
                h('div', { style: { fontWeight: 'bold', padding: '1px 4px', background: '#eef4fc', borderBottom: '1px solid #9db8de' } }, `${lab}  ${sh ? sh.name : '-'}`), pane,
            ]);
            const shA = s.a && res.sheet(s.a), shB = s.b && res.sheet(s.b);
            sheetGrid(paneA, shA, `qty-a-${tab}`);
            sheetGrid(paneB, shB, `qty-b-${tab}`);
            const right = h('div', {
                style: {
                    display: 'grid', gap: '4px', minHeight: '0', minWidth: '0',
                    gridTemplateColumns: layout === 'v' ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                    gridTemplateRows: layout === 'v' ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
                },
            }, [titled('A 집계표', shA, paneA), titled('B 산출근거', shB, paneB)]);

            // ── 하단 ──
            const radio = (v, t) => {
                const r = h('input', { type: 'radio', name: `qty-lay-${tab}` });
                r.checked = layout === v;
                r.addEventListener('change', () => r.checked && store.set(`${QP}.layout`, v, { record: false }));
                return h('label', { style: { display: 'inline-flex', gap: '2px', alignItems: 'center' } }, [r, t]);
            };
            const T = res.totals;
            const sumLine = tab === '일반'
                ? `콘크리트 ${T.concrete.toFixed(3)} m³ · 거푸집 ${T.formwork.toFixed(3)} m²`
                : tab === '공통' ? `철근 ${T.rebar.toFixed(3)} TON (순 ${T.rebarNet.toFixed(3)} / 할증포함 ${T.rebarGross.toFixed(3)})`
                    : `터파기 ${T.excavation.toFixed(3)} m³ · 되메우기 ${T.backfill.toFixed(3)} m³ · 잔토 ${T.surplus.toFixed(3)} m³`;
            const has = !!(lastOut && lastOut.ci === ctx.ci && lastOut.tab === tab);
            const bottom = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginTop: '4px', padding: '3px', background: '#dbe7f7', border: '1px solid #9db8de' } }, [
                h('span', {}, ['화면정렬 : ', radio('v', '수직'), ' ', radio('h', '수평')]),
                button('수량산출 옵션 선택', () => optionsDialog(ctx)),
                button('수량 산출', () => { quantityResult(ctx, true); ctx.setHint(`수량을 다시 산출했습니다 (${cache.ms} ms).`); ctx.rerender(); }),
                button('수량산출서 출력', () => doOutput(ctx, tab), { cls: 'primary', title: 'Excel(.xls) 로 저장' }),
                button('출력된 삽도 보기', () => figuresDialog(ctx, tab)),
                button('출력파일 열기', () => openLast(), { disabled: !has }),
                h('span', { style: { fontSize: '11px', color: '#15284b' } }, `${status}   |   ${sumLine}`),
            ]);

            el.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '360px' } }, [
                h('div', { style: { display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr)', gap: '6px', flex: '1', minHeight: '0' } }, [left, right]),
                bottom,
            ]));
        },

        draw(ctx) {
            try {
                const res = quantityResult(ctx);
                const s = sel(ctx, tab, res);
                const sh = res.sheet(s.view) || res.sheet(s.b) || res.sheet(s.a);
                return quantityFigure(ctx.p, ctx.c, sh, { basis: res.opts.basis });
            } catch (e) {
                const d = new Drawing();
                d.emptyMessage = '삽도 생성 오류: ' + e.message;
                return d;
            }
        },
        viewKey: (ctx) => { const s = selection[tab] || {}; return `qty|${tab}|${ctx.ci}|${s.view || ''}`; },
    };
}
