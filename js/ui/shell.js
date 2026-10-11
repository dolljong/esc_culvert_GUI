// shell.js - 프로그램 틀: 메뉴(드롭다운), 메뉴트리, 입력결과 확인창, 항목별 세부 입력창, 상태바
//
// 화면(screen) 모듈은 js/screens/<id>.js 에 있고 다음을 내보낸다 (모두 선택):
//   scope: 'project' | 'culvert'     culvert 이면 머리에 "암거 n : 이름 ▼ ◀ ▶"
//   perBlock: bool | (ctx)=>bool      BLOCK 선택기 표시
//   enabled(ctx) → bool               메뉴/트리 회색 처리
//   hint                              안내줄 기본 문구
//   tabs(ctx) → [{id, title, disabled}]
//   header(el, ctx)                   머리줄 추가 컨트롤
//   render(el, ctx, tabId)            본문
//   footer(el, ctx, tabId)            하단 [기본값] 옆 추가 버튼
//   defaults(ctx, tabId)              [기본값] 처리 (store.set 사용, 한 번의 실행취소로 묶임)
//   draw(ctx, tabId) → Drawing        입력결과 확인창
//   viewKey(ctx, tabId) → string      같은 키면 확대상태 유지
//   apply(ctx)                        [적용]

import store from '../core/store.js';
import { MENU, SCREEN_ORDER, findScreen } from '../core/menu.js';
import { curCulvertIndex, curBlockIndex, blockCount, blocks } from '../core/model.js';
import { h, confirmBox } from './dom.js';
import { CadView } from '../cad/cadView.js';
import { Drawing } from '../cad/drawing.js';
import { saveDrawingAsDxf, downloadText } from '../cad/dxfWriter.js';

const screenCache = new Map();
let current = { id: 'projectInfo', tab: null };
let cad = null;
let renderQueued = false;
let lastScreen = null;
const tabMemory = {};

export async function loadScreen(id) {
    if (screenCache.has(id)) return screenCache.get(id);
    let mod;
    try {
        mod = (await import(`../screens/${id}.js`)).default;
    } catch (e) {
        if (!/Failed to fetch|Cannot find|404|Importing a module script failed|error loading dynamically imported module/i.test(String(e))) console.error(e);
        mod = placeholderScreen(id);
    }
    screenCache.set(id, mod);
    return mod;
}

function placeholderScreen(id) {
    const s = findScreen(id);
    return {
        scope: 'project',
        hint: `${s ? s.label : id} 입력 화면을 준비 중입니다.`,
        render(el) { el.appendChild(h('div', { class: 'note' }, `[${s ? s.label : id}] 화면은 준비 중입니다.`)); },
    };
}

// ── 컨텍스트 ──────────────────────────────────────────────────────────

export function makeCtx() {
    const p = store.project;
    const ci = curCulvertIndex();
    const c = p.culverts[ci];
    const bi = curBlockIndex();
    return {
        store, p, ci, c, cp: `culverts.${ci}`, bi,
        blocks: c ? blocks(c) : [],
        tab: current.tab,
        rerender: () => scheduleRender(),
        redraw: () => redraw(),
        setHint,
        go: (id) => openScreen(id),
        cad: () => cad,
    };
}

// ── 초기화 ────────────────────────────────────────────────────────────

export function initShell() {
    cad = new CadView(document.getElementById('cad-host'), {
        onFieldClick: (name) => focusField(name),
        onMouseWorld: (x, y) => {
            document.getElementById('sb-coord').textContent = `${(x / 1000).toFixed(6)}, ${(y / 1000).toFixed(6)}`;
        },
    });
    buildMenubar();
    buildTree();
    buildTreeFoot();
    bindDialogButtons();
    bindSplitters();
    store.on('change', () => scheduleRender());
    store.on('hint', (t) => setHint(t));
    store.on('warn', (t) => setHint(t, true));
}

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        renderAll();
    });
}

// ── 메뉴 (드롭다운) ───────────────────────────────────────────────────
// 원본 리본의 탭 줄만 남기고, 탭을 누르면 단계 목록이 펼쳐진다.

let openGroup = null;

function buildMenubar() {
    const bar = document.getElementById('menubar');
    bar.innerHTML = '';
    for (const g of MENU) {
        const tab = h('div', { class: 'menu-tab', 'data-group': g.id }, g.label);
        tab.addEventListener('click', (e) => {
            if (e.target.closest('.menu-drop')) return;
            e.stopPropagation();
            openGroup = openGroup === g.id ? null : g.id;
            renderMenubar();
        });
        tab.addEventListener('mouseenter', () => {
            if (openGroup && openGroup !== g.id) { openGroup = g.id; renderMenubar(); }
        });
        bar.appendChild(tab);
    }
    document.addEventListener('click', (e) => {
        if (openGroup && !e.target.closest('#menubar')) { openGroup = null; renderMenubar(); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openGroup) { openGroup = null; renderMenubar(); }
    });
}

function renderMenubar() {
    const cur = findScreen(current.id);
    const ctx = makeCtx();
    document.querySelectorAll('#menubar .menu-tab').forEach(tab => {
        const gid = tab.dataset.group;
        tab.classList.toggle('active', !!cur && cur.group.id === gid);
        tab.classList.toggle('open', openGroup === gid);
        const old = tab.querySelector('.menu-drop');
        if (old) old.remove();
        if (openGroup !== gid) return;
        const g = MENU.find(x => x.id === gid);
        const drop = h('div', { class: 'menu-drop' });
        for (const it of g.items) {
            const en = isEnabled(screenCache.get(it.id), ctx);
            const b = h('button', { class: 'menu-item' + (it.id === current.id ? ' cur' : ''), disabled: !en }, it.label);
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                openGroup = null;
                renderMenubar();
                openScreen(it.id);
            });
            drop.appendChild(b);
        }
        tab.appendChild(drop);
    });
}

function isEnabled(mod, ctx) {
    if (!mod || !mod.enabled) return true;
    try { return mod.enabled(ctx) !== false; } catch { return true; }
}

// ── 메뉴트리 ──────────────────────────────────────────────────────────

const collapsed = new Set();

function buildTree() {
    const root = document.getElementById('mtree');
    root.innerHTML = '';
    for (const g of MENU) {
        const li = h('li');
        const node = h('div', { class: 'mt-node grp' });
        const tw = h('span', { class: 'tw' }, collapsed.has(g.id) ? '+' : '−');
        node.appendChild(tw);
        node.appendChild(h('span', {}, g.label));
        node.addEventListener('click', () => {
            if (collapsed.has(g.id)) collapsed.delete(g.id); else collapsed.add(g.id);
            buildTree();
            refreshTreeState();
        });
        li.appendChild(node);
        const ul = h('ul', { style: { display: collapsed.has(g.id) ? 'none' : '' } });
        for (const it of g.items) {
            const n = h('div', { class: 'mt-node', 'data-id': it.id });
            n.appendChild(h('span', { class: 'tw none' }));
            n.appendChild(h('span', {}, it.label));
            n.addEventListener('click', () => { if (!n.classList.contains('dis')) openScreen(it.id); });
            ul.appendChild(h('li', {}, [n]));
        }
        li.appendChild(ul);
        root.appendChild(li);
    }
}

function refreshTreeState() {
    const ctx = makeCtx();
    document.querySelectorAll('#mtree .mt-node[data-id]').forEach(n => {
        const id = n.dataset.id;
        n.classList.toggle('sel', id === current.id);
        n.classList.toggle('dis', !isEnabled(screenCache.get(id), ctx));
    });
    const sel = document.querySelector('#mtree .mt-node.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function buildTreeFoot() {
    const foot = document.getElementById('tree-foot');
    foot.innerHTML = '';
    const modes = [
        { id: 'input', label: '입력', go: () => openScreen(current.id) },
        { id: 'drawing', label: '도면', go: () => openScreen('drawingOut') },
        { id: 'qty', label: '수량', go: () => openScreen('quantityOut') },
    ];
    for (const m of modes) {
        const b = h('button', { 'data-mode': m.id }, m.label);
        b.addEventListener('click', m.go);
        foot.appendChild(b);
    }
}

// ── 화면 열기 ─────────────────────────────────────────────────────────

export async function openScreen(id, opts = {}) {
    const meta = findScreen(id);
    if (!meta) return;
    const mod = await loadScreen(id);
    const ctx = makeCtx();
    if (!opts.force && !isEnabled(mod, ctx)) {
        setHint(`[${meta.label}] 은(는) 현재 암거 형식에서 사용하지 않는 단계입니다.`);
        return;
    }
    if (lastScreen && lastScreen.leave) try { lastScreen.leave(makeCtx()); } catch (e) { console.error(e); }
    current = { id, tab: tabMemory[id] || null };
    lastScreen = mod;
    try { localStorage.setItem('escculvert.lastScreen', id); } catch { /* 무시 */ }
    // 모든 화면 모듈을 미리 불러와 회색 처리 판정에 사용
    preloadAll();
    renderAll(true);
}

let preloaded = false;
function preloadAll() {
    if (preloaded) return;
    preloaded = true;
    Promise.all(SCREEN_ORDER.map(s => loadScreen(s.id))).then(() => refreshTreeState());
}

export function currentScreenId() { return current.id; }

function renderAll(fresh = false) {
    const meta = findScreen(current.id);
    const mod = screenCache.get(current.id);
    if (!meta || !mod) return;
    const ctx = makeCtx();
    refreshTreeState();
    renderMenubar();
    document.getElementById('dlg-title').textContent = `${meta.group.label} - ${meta.label}`;
    updateTitle();

    // 탭
    let tabs = [];
    try { tabs = mod.tabs ? mod.tabs(ctx) || [] : []; } catch (e) { console.error(e); }
    if (tabs.length) {
        const valid = tabs.filter(t => !t.disabled);
        if (!tabs.some(t => t.id === current.tab && !t.disabled)) current.tab = (valid[0] || tabs[0]).id;
    } else current.tab = null;
    ctx.tab = current.tab;
    tabMemory[current.id] = current.tab;

    // 머리줄
    const head = document.getElementById('dlg-head');
    head.innerHTML = '';
    if (mod.scope === 'culvert') head.appendChild(culvertSelector(ctx));
    const perBlock = typeof mod.perBlock === 'function' ? mod.perBlock(ctx) : mod.perBlock;
    if (mod.scope === 'culvert' && perBlock !== undefined) head.appendChild(blockSelector(ctx, !!perBlock));
    if (mod.header) safe(() => mod.header(head, ctx));

    const tabsEl = document.getElementById('dlg-tabs');
    tabsEl.innerHTML = '';
    for (const t of tabs) {
        const b = h('button', { class: 'dlg-tab' + (t.id === current.tab ? ' active' : '') + (t.disabled ? ' dis' : '') }, t.title);
        b.addEventListener('click', () => {
            if (t.disabled) return;
            current.tab = t.id;
            tabMemory[current.id] = t.id;
            renderAll();
        });
        tabsEl.appendChild(b);
    }

    // 본문 (스크롤 위치 유지)
    const body = document.getElementById('dlg-body');
    const scroll = fresh ? 0 : body.scrollTop;
    body.innerHTML = '';
    if (mod.render) safe(() => mod.render(body, ctx, current.tab));
    body.scrollTop = scroll;

    // 하단
    const left = document.getElementById('dlg-foot-left');
    left.innerHTML = '';
    if (mod.defaults) {
        const label = typeof mod.defaultsLabel === 'function' ? mod.defaultsLabel(ctx, current.tab) : mod.defaultsLabel;
        left.appendChild(h('button', { class: 'btn', title: '프로그램 기본값으로 다시 설정 (Alt+D)', onclick: () => runDefaults(mod) }, label ? label : ['기본값(', h('u', {}, 'D'), ')']));
    }
    if (mod.footer) safe(() => mod.footer(left, ctx, current.tab));

    const idx = SCREEN_ORDER.findIndex(s => s.id === current.id);
    document.getElementById('btn-prev').disabled = idx <= 0;
    document.getElementById('btn-next').disabled = idx >= SCREEN_ORDER.length - 1;

    if (fresh) setHint(mod.hint || '');
    redraw(fresh);
}

function safe(fn) {
    try { fn(); } catch (e) {
        console.error(e);
        setHint('화면 처리 중 오류: ' + e.message, true);
    }
}

async function runDefaults(mod) {
    const ok = await confirmBox('프로그램 내부의 기본값으로 다시 설정합니다.\n기존에 입력되어 있는 수치는 무시됩니다.\n계속하시겠습니까?', '기본값');
    if (!ok) return;
    const ctx = makeCtx();
    store.transact(() => mod.defaults(ctx, current.tab));
    setHint('기본값을 적용했습니다. (Ctrl+Z 로 취소)');
}

export function redraw(fit = false) {
    const mod = screenCache.get(current.id);
    if (!mod) return;
    const ctx = makeCtx();
    ctx.tab = current.tab;
    let d = null;
    if (mod.draw) {
        try { d = mod.draw(ctx, current.tab); } catch (e) { console.error(e); d = new Drawing(); d.emptyMessage = '도면 생성 오류: ' + e.message; }
    }
    if (!d) d = new Drawing();
    let key = null;
    try { key = mod.viewKey ? mod.viewKey(ctx, current.tab) : `${current.id}|${current.tab}|${ctx.ci}|${ctx.bi}`; } catch { key = null; }
    if (fit) key = key + '|' + Math.random();
    cad.render(d, key);
    document.getElementById('view-legend').textContent = d.legend || '';
}

// ── 머리줄 선택기 ─────────────────────────────────────────────────────

function culvertSelector(ctx) {
    const p = ctx.p;
    const sel = h('select', { title: '암거 선택' });
    p.culverts.forEach((c, i) => {
        const o = h('option', { value: i }, `암거 ${i + 1} : ${c.name}`);
        if (i === ctx.ci) o.selected = true;
        sel.appendChild(o);
    });
    const go = (i) => {
        if (i < 0 || i >= p.culverts.length) return;
        store.set('ui.culvert', i, { record: false });
        store.set('ui.block', 0, { record: false });
    };
    sel.addEventListener('change', () => go(+sel.value));
    return h('span', { class: 'sel-group' }, [
        sel,
        h('button', { class: 'nav-btn', title: '이전 암거', onclick: () => go(ctx.ci - 1) }, '◀'),
        h('button', { class: 'nav-btn', title: '다음 암거', onclick: () => go(ctx.ci + 1) }, '▶'),
    ]);
}

function blockSelector(ctx, enabled) {
    const n = ctx.c ? blockCount(ctx.c) : 1;
    const sel = h('select', { disabled: !enabled, title: 'BLOCK 선택' });
    for (let i = 0; i < n; i++) {
        const z = ctx.c && ctx.c.type === '지하차도' && ctx.c.zones ? ` (${ctx.c.zones[i] || 'BOX구간'})` : '';
        const o = h('option', { value: i }, `BLOCK ${i + 1}${z}`);
        if (i === ctx.bi) o.selected = true;
        sel.appendChild(o);
    }
    const go = (i) => { if (i >= 0 && i < n) store.set('ui.block', i, { record: false }); };
    sel.addEventListener('change', () => go(+sel.value));
    return h('span', { class: 'sel-group' }, [
        sel,
        h('button', { class: 'nav-btn', disabled: !enabled, onclick: () => go(ctx.bi - 1) }, '◀'),
        h('button', { class: 'nav-btn', disabled: !enabled, onclick: () => go(ctx.bi + 1) }, '▶'),
    ]);
}

// ── 버튼 / 단축키 ─────────────────────────────────────────────────────

function bindDialogButtons() {
    document.getElementById('btn-prev').addEventListener('click', () => step(-1));
    document.getElementById('btn-next').addEventListener('click', () => step(1));
    document.getElementById('btn-apply').addEventListener('click', () => {
        const mod = screenCache.get(current.id);
        if (mod && mod.apply) safe(() => mod.apply(makeCtx()));
        renderAll();
        setHint('적용되었습니다.');
    });
    document.addEventListener('keydown', (e) => {
        if (!e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'p') { e.preventDefault(); step(-1); }
        else if (k === 'n') { e.preventDefault(); step(1); }
        else if (k === 'a') { e.preventDefault(); document.getElementById('btn-apply').click(); }
        else if (k === 'd') {
            const mod = screenCache.get(current.id);
            if (mod && mod.defaults) { e.preventDefault(); runDefaults(mod); }
        }
    });
}

/** 이전/다음: 사용하지 않는 단계(회색)는 건너뛴다 (매뉴얼 2.3 "입력단계를 그냥 지나치게 됩니다") */
async function step(dir) {
    let idx = SCREEN_ORDER.findIndex(s => s.id === current.id);
    const ctx = makeCtx();
    for (;;) {
        idx += dir;
        if (idx < 0 || idx >= SCREEN_ORDER.length) return;
        const mod = await loadScreen(SCREEN_ORDER[idx].id);
        if (isEnabled(mod, ctx)) { openScreen(SCREEN_ORDER[idx].id); return; }
    }
}

export function setHint(text, warn = false) {
    const el = document.getElementById('dlg-msg');
    document.getElementById('dlg-msg-text').textContent = text || '';
    el.classList.toggle('warn', !!warn);
}

function focusField(name) {
    const mod = screenCache.get(current.id);
    // 그리드 셀 찾기: 화면이 focusField 를 제공하면 우선
    if (mod && mod.focusField && mod.focusField(name, makeCtx())) return;
    const td = [...document.querySelectorAll('#dlg-body .ag-wrap')];
    for (const w of td) {
        const g = w.__grid;
        if (g && g.focusField(name)) return;
    }
    setHint(`변수 ${name}`);
}

export function updateTitle() {
    const p = store.project;
    const name = (window.__acuFileName || '제목없음.ecu');
    document.getElementById('title-text').textContent = `ESC Culvert - [${name}]`;
    document.title = `ESC Culvert - ${p.info ? p.info.projectName : ''}`;
    document.getElementById('sb-project').textContent = p.info ? p.info.projectName : '';
    document.getElementById('sb-designer').textContent = p.info ? p.info.designer : '';
}

// ── 화면 도구 ─────────────────────────────────────────────────────────

export function viewCommand(cmd) {
    if (cmd === 'zoomFit') cad.fit();
    else if (cmd === 'zoomIn') cad.zoom(1 / 1.3);
    else if (cmd === 'zoomOut') cad.zoom(1.3);
    else if (cmd === 'viewDxf') {
        if (!cad.drawing || !cad.drawing.entities.length) { setHint('저장할 도면이 없습니다.'); return; }
        const meta = findScreen(current.id);
        saveDrawingAsDxf(cad.drawing, `${meta ? meta.label.replace(/[\\/:*?"<>|, ]/g, '_') : 'drawing'}.dxf`);
        setHint('현재 화면을 DXF 파일로 저장했습니다.');
    } else if (cmd === 'viewPng') {
        const svg = cad.toSvgString();
        const img = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        img.onload = () => {
            const r = document.getElementById('cad-host').getBoundingClientRect();
            const cv = document.createElement('canvas');
            cv.width = Math.round(r.width * 2); cv.height = Math.round(r.height * 2);
            const g = cv.getContext('2d');
            g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
            g.drawImage(img, 0, 0, cv.width, cv.height);
            URL.revokeObjectURL(url);
            cv.toBlob(b => {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(b);
                a.download = 'capture.png';
                a.click();
            });
        };
        img.src = url;
    }
}

export function exportText(text, name) { downloadText(text, name, 'text/plain;charset=utf-8'); }

// ── 분할선 ────────────────────────────────────────────────────────────

function bindSplitters() {
    const root = document.documentElement;
    const saved = JSON.parse(localStorage.getItem('escculvert.layout') || '{}');
    if (saved.tree) root.style.setProperty('--tree-w', saved.tree + 'px');
    if (saved.dlg) root.style.setProperty('--dlg-h', saved.dlg + 'px');
    const save = () => localStorage.setItem('escculvert.layout', JSON.stringify(saved));
    const drag = (el, onMove) => el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const mv = (ev) => onMove(ev);
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); save(); };
        window.addEventListener('mousemove', mv);
        window.addEventListener('mouseup', up);
    });
    drag(document.getElementById('split-tree'), (e) => {
        const w = Math.max(150, Math.min(480, e.clientX - 3));
        saved.tree = w;
        root.style.setProperty('--tree-w', w + 'px');
    });
    drag(document.getElementById('split-dlg'), (e) => {
        const c = document.getElementById('center').getBoundingClientRect();
        const hgt = Math.max(140, Math.min(c.height - 80, c.bottom - e.clientY));
        saved.dlg = hgt;
        root.style.setProperty('--dlg-h', hgt + 'px');
        document.getElementById('dialog').classList.remove('maxed');
    });
}

export function toggleTree() {
    document.getElementById('workspace').classList.toggle('tree-hidden');
}

export function dialogMax(on) {
    const d = document.getElementById('dialog');
    if (on === undefined) on = !d.classList.contains('maxed');
    d.classList.toggle('maxed', on);
    if (!on) document.documentElement.style.removeProperty('--dlg-h');
}
