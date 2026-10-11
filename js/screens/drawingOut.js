// 출력 > 도면 출력 (매뉴얼 m3 1장 "도면출력", m1 1.7 도면 모드)
//
// 머리줄 : [페이지 번호] [구조물 ▼] [카테고리 ▼]  |◀ ◀◀ ◀ ⟳ ▶ ▶▶ ▶|
//   |◀ 현재 카테고리 처음   ◀◀ 이전 카테고리 처음   ◀ 이전 페이지   ⟳ 새로 그리기
//   ▶ 다음 페이지   ▶▶ 다음 카테고리 처음   ▶| 현재 카테고리 마지막
// 본문   : 도면 목록 (구조물 > 일반도 / 구조도 / 기타구조도 > 001 : 제목). 클릭하면 확인창에 그 시트를 표시.
// 하단   : [도면 환경 설정] [도면 초기화] [도면 출력] [인쇄]
// 확인창 : 현재 시트 (용지 mm, 검은 바탕 CAD 화면)
//
// 시트 생성: calc/sheets.js (listSheets). 설정: project.output.drawing (도면 환경 설정 창, .apt 파일 저장/불러오기)
// DXF 저장: 출력범위 (전체/현재/현재부터/현재까지/일부분/사용자 입력), 한파일 저장(가로로 나란히) 또는 시트별 파일(순차 내려받기, 최대 20개).

import store, { clone } from '../core/store.js';
import { h, button, modal, alertBox, confirmBox } from '../ui/dom.js';
import { Drawing } from '../cad/drawing.js';
import { drawingToDxf, downloadText } from '../cad/dxfWriter.js';
import { drawingToSvg } from '../draw/svgExport.js';
import { TITLE_FIELD_ROWS } from '../draw/titleBlock.js';
import {
    listSheets, flatSheets, combineSheets, scaledSheet, drawingSettings, deepMerge,
    defaultGeneralSettings, defaultCulvertDrawing, SETTINGS_UI, SCALES, CATEGORIES,
} from '../calc/sheets.js';

const MAX_FILES = 20;
const ui = { key: null, idx: 0 };
const exp = { range: 'current', from: 1, to: 1, user: '', oneFile: false, dwg: false, sameSize: true, useNo: false, useTitle: false };
const cache = { list: null, sheets: new Map() };
store.on('change', () => { cache.list = null; cache.sheets.clear(); });
store.on('replace', () => { cache.list = null; cache.sheets.clear(); ui.key = null; ui.idx = 0; });

// ── 목록 / 현재 시트 ─────────────────────────────────────────────────

function sheetList(p) {
    if (!cache.list) {
        let groups = [];
        try { groups = listSheets(p); } catch (e) { console.error(e); groups = []; }
        cache.list = { groups, flat: flatSheets(groups) };
    }
    return cache.list;
}

function curIndex(ctx) {
    const { flat } = sheetList(ctx.p);
    if (!flat.length) return -1;
    let i = ui.key ? flat.findIndex(s => s.key === ui.key) : -1;
    if (i < 0) i = Math.max(0, Math.min(flat.length - 1, ui.idx | 0));
    ui.idx = i; ui.key = flat[i].key;
    return i;
}

function build(item) {
    if (!item) return null;
    if (cache.sheets.has(item.key)) return cache.sheets.get(item.key);
    let d;
    try { d = item.build(); } catch (e) {
        console.error(e);
        d = new Drawing();
        d.emptyMessage = `도면 생성 오류 (${item.title}): ${e.message}`;
    }
    cache.sheets.set(item.key, d);
    return d;
}

function go(ctx, i) {
    const { flat } = sheetList(ctx.p);
    if (!flat.length) return;
    i = Math.max(0, Math.min(flat.length - 1, i));
    ui.idx = i; ui.key = flat[i].key;
    const it = flat[i];
    if (it.ci !== ctx.ci) store.set('ui.culvert', it.ci, { record: false, silent: true });
    ctx.rerender();
}

/** 현재 시트가 속한 그룹(구조물+카테고리) 번호 */
function groupOf(ctx, i) {
    const { groups, flat } = sheetList(ctx.p);
    const it = flat[i];
    return groups.findIndex(g => g.items.includes(it));
}

function nav(ctx, kind) {
    const { groups, flat } = sheetList(ctx.p);
    const i = curIndex(ctx);
    if (i < 0) return;
    const gi = groupOf(ctx, i);
    const first = (g) => flat.indexOf(groups[g].items[0]);
    switch (kind) {
        case 'catFirst': go(ctx, first(gi)); break;
        case 'catPrev': go(ctx, gi > 0 ? first(gi - 1) : first(0)); break;
        case 'prev': go(ctx, i - 1); break;
        case 'next': go(ctx, i + 1); break;
        case 'catNext': go(ctx, gi < groups.length - 1 ? first(gi + 1) : first(gi)); break;
        case 'catLast': go(ctx, flat.indexOf(groups[gi].items[groups[gi].items.length - 1])); break;
        case 'refresh': cache.sheets.clear(); cache.list = null; ctx.rerender(); ctx.setHint('도면을 새로 그렸습니다.'); break;
    }
}

// ── 도면 환경 설정 ──────────────────────────────────────────────────

const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, path, v) {
    const ks = path.split('.');
    let a = o;
    for (let i = 0; i < ks.length - 1; i++) {
        if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
        a = a[ks[i]];
    }
    a[ks[ks.length - 1]] = v;
}

function materialize(p, src) {
    const w = clone(src || {}) || {};
    w.general = deepMerge(defaultGeneralSettings(), w.general || {});
    w.culverts = w.culverts || {};
    (p.culverts || []).forEach((c, ci) => { w.culverts[ci] = deepMerge(defaultCulvertDrawing(), w.culverts[ci] || {}); });
    return w;
}

function settingsDialog(ctx) {
    const p = ctx.p;
    let work = materialize(p, p.output && p.output.drawing);
    let tab = 'general';
    let ci = ctx.ci;
    const root = h('div', { style: { width: '760px', display: 'flex', flexDirection: 'column', gap: '6px' } });
    const fileIn = h('input', { type: 'file', accept: '.apt,.aco,.json', style: { display: 'none' } });
    fileIn.addEventListener('change', () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        f.text().then(t => {
            try {
                const o = JSON.parse(t);
                work = materialize(p, o.drawing || o);
                draw();
                ctx.setHint(`도면 옵션을 불러왔습니다: ${f.name}`);
            } catch (e) { alertBox('도면 옵션 파일을 읽을 수 없습니다.\n' + e.message); }
        });
        fileIn.value = '';
    });
    const base = () => (SETTINGS_UI[tab].perCulvert ? work.culverts[ci][tab] : work.general);

    function checkItem(key, label, type, value) {
        const inp = h('input', { type: type === 'radio' ? 'radio' : 'checkbox', name: type === 'radio' ? `dset-${tab}-${key}` : null });
        const cur = getPath(base(), key);
        inp.checked = type === 'radio' ? String(cur) === String(value) : !!cur;
        inp.addEventListener('change', () => { if (type === 'radio') { if (inp.checked) setPath(base(), key, value); } else setPath(base(), key, inp.checked); });
        return h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', padding: '1px 0 1px 18px' } }, [inp, label]);
    }

    function gridTable(def) {
        const rows = def.rows || TITLE_FIELD_ROWS.map(([k, t]) => [`${def.prefix}.${k}`, t, 'text']);
        const tb = h('table', { style: { borderCollapse: 'collapse', width: '100%', background: '#fff', fontSize: '12px' } });
        tb.appendChild(h('tr', {}, def.head.map(t => h('th', { style: { border: '1px solid #9db8de', background: '#dbe7f7', padding: '2px 4px' } }, t))));
        for (const [key, label, kind0, opts] of rows) {
            const kind = kind0 || (def.scale ? 'scale' : 'text');
            let inp;
            const v = getPath(base(), key);
            if (kind === 'select') {
                inp = h('select', { style: { width: '100%' } }, opts.map(o => h('option', { value: o, selected: String(o) === String(v) }, o)));
                inp.addEventListener('change', () => setPath(base(), key, inp.value));
            } else {
                inp = h('input', { type: 'text', style: { width: '100%', boxSizing: 'border-box', textAlign: kind === 'text' ? 'left' : 'right', border: '0' } });
                inp.value = v == null ? '' : v;
                if (kind === 'scale') inp.setAttribute('list', 'dset-scales');
                inp.addEventListener('change', () => {
                    if (kind === 'text') setPath(base(), key, inp.value);
                    else { const n = +inp.value; if (isFinite(n) && n > 0) setPath(base(), key, n); else inp.value = getPath(base(), key); }
                });
            }
            tb.appendChild(h('tr', {}, [h('td', { style: { border: '1px solid #c5d5ea', padding: '1px 4px', whiteSpace: 'nowrap', background: '#eef4fc' } }, label), h('td', { style: { border: '1px solid #c5d5ea', padding: '0 2px', width: '45%' } }, inp)]));
        }
        return tb;
    }

    function draw() {
        root.innerHTML = '';
        const tabs = h('div', { style: { display: 'flex', gap: '2px' } });
        for (const [id, def] of Object.entries(SETTINGS_UI)) tabs.appendChild(button(def.title, () => { tab = id; draw(); }, { cls: id === tab ? 'on' : '' }));
        root.appendChild(tabs);
        const def = SETTINGS_UI[tab];
        const left = h('div', { style: { flex: '0 0 300px', height: '400px', overflow: 'auto', background: '#fff', border: '1px solid #7393c6', padding: '4px', fontSize: '12px' } });
        for (const g of def.tree) {
            left.appendChild(h('div', { style: { fontWeight: 'bold', marginTop: '4px' } }, `▣ ${g.group}`));
            for (const [type, key, label, value] of g.items) left.appendChild(checkItem(key, label, type, value));
        }
        const right = h('div', { style: { flex: '1', height: '400px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' } });
        for (const gd of def.grids) right.appendChild(gridTable(gd));
        if (tab === 'general') right.appendChild(h('div', { style: { fontSize: '11px', color: '#335' } }, '* 도각 파일(.dgk)은 웹 버전에서 내장 KHC 형식 도각으로 그립니다. HCAD Block 은 사용하지 않습니다 (기호는 항상 분해되어 출력).'));
        root.appendChild(h('div', { style: { display: 'flex', gap: '6px' } }, [left, right]));
        root.appendChild(h('datalist', { id: 'dset-scales' }, SCALES.map(s => h('option', { value: s }))));
        // 아래: 구조물 선택 (도면 일반 제외)
        const bottom = h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } });
        if (def.perCulvert) {
            const sel = h('select', {}, (p.culverts || []).map((c, i) => h('option', { value: i, selected: i === ci }, c.name || `암거${i + 1}`)));
            sel.addEventListener('change', () => { ci = +sel.value; draw(); });
            bottom.appendChild(h('label', {}, ['구조물 ', sel]));
        }
        bottom.appendChild(h('span', { style: { flex: '1' } }));
        bottom.appendChild(button('저장', () => {
            const name = `${(p.info && p.info.projectName) || 'ESC Culvert'}_도면옵션.apt`.replace(/[\\/:*?"<>|\s]+/g, '_');
            downloadText(JSON.stringify({ type: 'ESC Culvert 도면 옵션', version: 1, drawing: work }, null, 1), name, 'application/json');
        }, { title: '모든 도면 설정을 파일(*.apt)로 저장' }));
        bottom.appendChild(button('불러오기', () => fileIn.click(), { title: '도면 옵션 불러오기 (*.apt, *.aco)' }));
        bottom.appendChild(button('기본값', () => { work = materialize(p, {}); draw(); }, { title: '모든 도면 설정을 기본값으로' }));
        root.appendChild(bottom);
        root.appendChild(fileIn);
    }
    draw();
    modal({
        title: '도면 환경 설정', body: root, width: 800,
        buttons: [
            { text: '확인', primary: true, onClick: () => { store.set('output.drawing', work); ctx.setHint('도면 환경 설정을 적용했습니다. (Ctrl+Z 로 취소)'); } },
            { text: '취소' },
        ],
    });
}

// ── DXF 저장 ────────────────────────────────────────────────────────

function parseUser(s, n) {
    const out = new Set();
    for (const part of String(s).split(/[,\s]+/).filter(Boolean)) {
        const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
        if (m) { for (let k = Math.min(+m[1], +m[2]); k <= Math.max(+m[1], +m[2]); k++) if (k >= 1 && k <= n) out.add(k - 1); }
        else if (/^\d+$/.test(part) && +part >= 1 && +part <= n) out.add(+part - 1);
    }
    return [...out].sort((a, b) => a - b);
}

function selectedPages(ctx) {
    const { flat } = sheetList(ctx.p);
    const n = flat.length, i = curIndex(ctx);
    const rng = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
    switch (exp.range) {
        case 'all': return rng(0, n - 1);
        case 'from': return rng(i, n - 1);
        case 'to': return rng(0, i);
        case 'part': return rng(Math.max(1, Math.min(exp.from, exp.to)) - 1, Math.min(n, Math.max(exp.from, exp.to)) - 1);
        case 'user': return parseUser(exp.user, n);
        default: return i >= 0 ? [i] : [];
    }
}

const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
function baseName() {
    const f = (typeof window !== 'undefined' && window.__acuFileName) || '제목없음.ecu';
    return f.replace(/\.[^.]+$/, '');
}
function fileNameFor(item) {
    if (exp.useNo) return `${safeName(item.number)}.dxf`;
    if (exp.useTitle) return `${safeName(item.title)}.dxf`;
    return `${safeName(baseName())}_${item.no}.dxf`;
}

async function saveDxf(ctx) {
    const { flat } = sheetList(ctx.p);
    const pages = selectedPages(ctx);
    if (!pages.length) { alertBox('출력할 도면이 없습니다. 출력 범위를 확인하십시오.'); return; }
    if (exp.dwg) await alertBox('웹 버전에서는 DWG 파일 변환을 지원하지 않습니다.\nDXF (R12) 파일로 저장합니다. CAD 프로그램에서 DWG 로 저장하십시오.', 'DWG 파일변환');
    const items = pages.map(i => flat[i]);
    ctx.setHint(`도면 ${items.length}장 생성 중…`);
    await new Promise(r => setTimeout(r, 20));
    const trueScale = !exp.sameSize;
    if (exp.oneFile) {
        const ds = items.map(build).filter(Boolean);
        const all = combineSheets(ds, { trueScale });
        const name = exp.useTitle ? `${safeName(baseName())}_도면.dxf` : `${safeName(baseName())}_${items[0].no}-${items[items.length - 1].no}.dxf`;
        downloadText(drawingToDxf(all), items.length === 1 ? fileNameFor(items[0]) : name, 'application/dxf');
        ctx.setHint(`DXF 저장: ${items.length}장 → 한 파일 (${all.entities.length} 개체)`);
        return;
    }
    let list = items;
    if (items.length > MAX_FILES) {
        const ok = await confirmBox(`선택한 도면이 ${items.length}장입니다.\n웹 브라우저는 파일을 하나씩 내려받으므로 처음 ${MAX_FILES}장만 저장합니다.\n전체는 [한파일로출력] 을 사용하십시오.\n계속하시겠습니까?`, '도면출력');
        if (!ok) return;
        list = items.slice(0, MAX_FILES);
    }
    list.forEach((it, k) => setTimeout(() => {
        const d = build(it);
        if (d) downloadText(drawingToDxf(scaledSheet(d, trueScale)), fileNameFor(it), 'application/dxf');
        if (k === list.length - 1) ctx.setHint(`DXF 저장: ${list.length}개 파일`);
    }, k * 400));
}

function exportDialog(ctx) {
    const { flat } = sheetList(ctx.p);
    if (!flat.length) { alertBox('출력할 도면이 없습니다.'); return; }
    const n = flat.length;
    exp.from = Math.min(Math.max(1, exp.from), n); exp.to = Math.min(Math.max(1, exp.to || n), n);
    const root = h('div', { style: { width: '600px', display: 'flex', flexDirection: 'column', gap: '6px' } });
    const fname = h('input', { type: 'text', style: { flex: '1' }, readonly: true });
    const refresh = () => {
        const pages = selectedPages(ctx);
        const it = flat[pages[0] != null ? pages[0] : curIndex(ctx)];
        fname.value = !it ? '' : exp.oneFile && pages.length > 1 ? `${safeName(baseName())}_${flat[pages[0]].no}-${flat[pages[pages.length - 1]].no}.dxf` : fileNameFor(it);
    };
    const radio = (val, label, extra) => {
        const r = h('input', { type: 'radio', name: 'dxf-range' });
        r.checked = exp.range === val;
        r.addEventListener('change', () => { if (r.checked) { exp.range = val; refresh(); } });
        return h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center', minWidth: '120px' } }, [r, label, ...(extra || [])]);
    };
    const num = (key) => {
        const i = h('input', { type: 'number', min: 1, max: n, style: { width: '52px' } });
        i.value = exp[key];
        i.addEventListener('change', () => { exp[key] = Math.max(1, Math.min(n, i.value | 0)); i.value = exp[key]; exp.range = 'part'; refresh(); });
        return i;
    };
    const user = h('input', { type: 'text', placeholder: '예) 1-3, 5, 8', style: { width: '100%', boxSizing: 'border-box' } });
    user.value = exp.user;
    user.addEventListener('input', () => { exp.user = user.value; exp.range = 'user'; refresh(); });
    const chk = (key, label, title) => {
        const c = h('input', { type: 'checkbox' });
        c.checked = !!exp[key];
        c.addEventListener('change', () => { exp[key] = c.checked; if (key === 'useNo' && c.checked) exp.useTitle = false; if (key === 'useTitle' && c.checked) exp.useNo = false; draw(); });
        return h('label', { style: { display: 'flex', gap: '4px', alignItems: 'center' }, title }, [c, label]);
    };
    const fs = (title, kids) => h('fieldset', { style: { border: '1px solid #7393c6', padding: '4px 8px', flex: '1' } }, [h('legend', {}, title), ...kids]);
    function draw() {
        root.innerHTML = '';
        root.appendChild(h('div', { style: { display: 'flex', gap: '8px' } }, [
            fs('출력 범위', [
                h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' } }, [
                    radio('all', '도면 전체 (A)'), radio('current', '현재 도면 (C)'), radio('from', '현재 부터 (B)'), radio('to', '현재 까지 (E)'),
                ]),
                radio('part', '일부분 (P) :', [num('from'), '부터', num('to'), '까지']),
                radio('user', '사용자 입력 (U) :'), user,
            ]),
            fs('출력 옵션', [
                chk('oneFile', '한파일로출력', '선택한 도면을 한 DXF 파일에 가로로 나란히 저장'),
                chk('dwg', 'DWG 파일변환', '웹 버전에서는 지원하지 않습니다 (DXF 로 저장)'),
                chk('sameSize', '도각크기 동일적용', '켜면 모든 도면을 용지 크기(mm) 그대로, 끄면 대표 축척을 곱한 실척으로 저장'),
                chk('useNo', '파일명 번호사용', '파일명 = 도면번호 첫머리 문자 + 번호'),
                chk('useTitle', '파일명 도면제목 사용', '파일명 = 도면 제목'),
            ]),
        ]));
        root.appendChild(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, ['저장파일명 : ', fname]));
        root.appendChild(h('div', { style: { fontSize: '11px', color: '#335' } }, `전체 ${n}장, 현재 ${flat[curIndex(ctx)].no} : ${flat[curIndex(ctx)].title}. 파일은 브라우저 내려받기 폴더에 저장됩니다.`));
        refresh();
    }
    draw();
    modal({
        title: '도면출력', body: root, width: 640,
        buttons: [
            { text: '파일 저장', primary: true, onClick: () => { saveDxf(ctx).catch(e => { console.error(e); alertBox('DXF 저장 오류: ' + e.message); }); return false; } },
            {
                text: '페이지 정보', onClick: () => {
                    const pages = selectedPages(ctx);
                    alertBox(pages.length ? pages.map(i => `${flat[i].no} : [${flat[i].category}] ${flat[i].title}`).join('\n') : '선택된 도면이 없습니다.', `페이지 정보 (${pages.length}장)`);
                    return false;
                },
            },
            { text: '닫 기' },
        ],
    });
}

// ── 인쇄 ────────────────────────────────────────────────────────────

function printSheet(ctx) {
    const { flat } = sheetList(ctx.p);
    const it = flat[curIndex(ctx)];
    const d = build(it);
    if (!d || !d.entities.length) { alertBox('인쇄할 도면이 없습니다.'); return; }
    const w = window.open('', '_blank');
    if (!w) { alertBox('팝업이 차단되어 인쇄 창을 열 수 없습니다. 브라우저의 팝업 허용 후 다시 시도하십시오.'); return; }
    const svg = drawingToSvg(d, { width: 1680, margin: 0.005 }).replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" ');
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${it.no} ${it.title}</title>
<style>@page { size: landscape; margin: 6mm; } html,body{margin:0;background:#fff} svg{width:100%;height:auto;display:block}</style></head>
<body>${svg}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* 취소 */ } }, 400);
}

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'project',
    hint: '도면을 확인하고 DXF 로 출력합니다. 목록에서 도면을 선택하거나 |◀ ◀◀ ◀ ▶ ▶▶ ▶| 로 이동하십시오. [도면 환경 설정] 에서 출력 객체·축척·도각을 설정합니다.',

    header(el, ctx) {
        const { groups, flat } = sheetList(ctx.p);
        const i = curIndex(ctx);
        const it = flat[i];
        const page = h('input', { type: 'text', title: '페이지 번호 (입력 후 Enter)', style: { width: '40px', textAlign: 'center' } });
        page.value = it ? it.no : '';
        page.addEventListener('change', () => { const k = flat.findIndex(s => +s.no === +page.value); if (k >= 0) go(ctx, k); else page.value = it ? it.no : ''; });
        const cul = h('select', { title: '구조물' }, (ctx.p.culverts || []).map((c, k) => h('option', { value: k, selected: it ? it.ci === k : k === ctx.ci }, c.name || `암거${k + 1}`)));
        cul.addEventListener('change', () => { const k = flat.findIndex(s => s.ci === +cul.value); if (k >= 0) go(ctx, k); });
        const ciNow = it ? it.ci : ctx.ci;
        const cats = groups.filter(g => g.ci === ciNow).map(g => g.category);
        const cat = h('select', { title: '카테고리' }, CATEGORIES.filter(c => cats.includes(c)).map(c => h('option', { value: c, selected: it && it.category === c }, c)));
        cat.addEventListener('change', () => { const k = flat.findIndex(s => s.ci === ciNow && s.category === cat.value); if (k >= 0) go(ctx, k); });
        const nb = (t, kind, title) => h('button', { class: 'nav-btn', title, onclick: () => nav(ctx, kind) }, t);
        el.appendChild(h('span', { class: 'sel-group', style: { display: 'inline-flex', gap: '3px', alignItems: 'center' } }, [
            page, cul, cat,
            nb('|◀', 'catFirst', '현재 카테고리 처음'), nb('◀◀', 'catPrev', '이전 카테고리'), nb('◀', 'prev', '이전 페이지'),
            h('button', { class: 'nav-btn', title: '새로 그리기', style: { color: '#1a8a1a', fontWeight: 'bold' }, onclick: () => nav(ctx, 'refresh') }, '⟳'),
            nb('▶', 'next', '다음 페이지'), nb('▶▶', 'catNext', '다음 카테고리'), nb('▶|', 'catLast', '현재 카테고리 마지막'),
            h('span', { style: { marginLeft: '6px', color: '#10264d' } }, it ? `${i + 1} / ${flat.length}` : '도면 없음'),
        ]));
    },

    render(el, ctx) {
        const { groups, flat } = sheetList(ctx.p);
        const i = curIndex(ctx);
        const list = h('div', { class: 'box', style: { padding: '4px 6px', fontSize: '12px', maxHeight: '100%', overflow: 'auto', minWidth: '320px' } });
        let lastCi = -1;
        for (const g of groups) {
            if (g.ci !== lastCi) { lastCi = g.ci; list.appendChild(h('div', { style: { fontWeight: 'bold', marginTop: '2px' } }, `▣ ${g.culvert}`)); }
            list.appendChild(h('div', { style: { fontWeight: 'bold', paddingLeft: '12px', color: '#1d3f7a' } }, `▤ ${g.category}`));
            for (const it of g.items) {
                const k = flat.indexOf(it);
                list.appendChild(h('div', {
                    style: { paddingLeft: '28px', cursor: 'pointer', background: k === i ? '#ffd979' : '', borderRadius: '2px', whiteSpace: 'nowrap' },
                    title: `${it.category} — 도면번호 ${it.number}`,
                    onclick: () => go(ctx, k),
                }, `${it.no} : ${it.title}`));
            }
        }
        if (!flat.length) list.appendChild(h('div', { class: 'note', style: { color: '#333' } }, '출력할 도면이 없습니다.'));
        const it = flat[i];
        const d = it ? build(it) : null;
        const S = drawingSettings(ctx.p, it ? it.ci : ctx.ci);
        const info = h('div', { class: 'box', style: { padding: '6px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '220px' } }, it ? [
            h('div', {}, [h('b', {}, `${it.no} : ${it.title}`)]),
            h('div', {}, `구조물 : ${(ctx.p.culverts[it.ci] || {}).name || ''} / ${it.category}`),
            h('div', {}, `도면번호 : ${it.number}`),
            h('div', {}, `용지 : ${S.general.size}, 대표 축척 1:${d && d.sheetScale ? d.sheetScale : '-'}`),
            h('div', {}, `개체 수 : ${d ? d.entities.length.toLocaleString() : 0}`),
            h('div', { style: { color: '#555', marginTop: '4px' } }, '확인창: 휠 = 확대/축소, 드래그 = 이동, 더블클릭 = 전체 보기'),
        ] : []);
        el.appendChild(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', height: '100%' } }, [list, info]));
        // 현재 항목이 보이도록
        setTimeout(() => { const sel = [...list.children].find(c => c.style && c.style.background); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' }); }, 0);
    },

    footer(el, ctx) {
        el.appendChild(button('도면 환경 설정', () => settingsDialog(ctx), { title: '출력 객체, 축척, 도각, 표기 방법 설정' }));
        el.appendChild(button('도면 초기화', async () => {
            const ok = await confirmBox('도면 환경 설정을 모두 기본값으로 되돌리고 도면을 다시 만듭니다.\n계속하시겠습니까?', '도면 초기화');
            if (!ok) return;
            store.set('output.drawing', {});
            ui.key = null; ui.idx = 0;
            ctx.setHint('도면을 초기화했습니다. (Ctrl+Z 로 취소)');
        }));
        el.appendChild(button('도면 출력', () => exportDialog(ctx), { cls: 'primary', title: 'DXF 파일 저장' }));
        el.appendChild(button('인쇄', () => printSheet(ctx), { title: '현재 도면 인쇄 (새 창)' }));
    },

    draw(ctx) {
        const { flat } = sheetList(ctx.p);
        const i = curIndex(ctx);
        if (i < 0) { const d = new Drawing(); d.emptyMessage = '출력할 도면이 없습니다.'; return d; }
        const d = build(flat[i]);
        if (d) d.legend = `${flat[i].no} : ${flat[i].title}`;
        return d;
    },
    viewKey: (ctx) => { const { flat } = sheetList(ctx.p); const i = curIndex(ctx); return `drawingOut|${i >= 0 ? flat[i].key : ''}`; },
};
