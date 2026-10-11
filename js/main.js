// main.js - 진입점: 파일(새로 만들기/열기/저장), 자동저장, 단축키

import store from './core/store.js';
import { createProject, normalizeProject, migrateLegacy, APP_VERSION } from './core/model.js';
import storage from './utils/storage.js';
import { initShell, openScreen, viewCommand, toggleTree, dialogMax, setHint, updateTitle } from './ui/shell.js';
import { confirmBox, alertBox, modal, h } from './ui/dom.js';

const AUTOSAVE_KEY = 'escculvert.autosave';
const RECENT_KEY = 'escculvert.recent';

// 이전 저장 키(aculvert.*)를 새 키로 옮긴다
try {
    for (const k of Object.keys(localStorage)) {
        if (k.startsWith('aculvert.')) {
            const nk = 'escculvert.' + k.slice(9);
            if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
            localStorage.removeItem(k);
        }
    }
    // 최근 문서 이름의 .acu 확장자를 .ecu 로
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (recent.some(r => /\.acu$/i.test(r.name))) {
        for (const r of recent) {
            if (!/\.acu$/i.test(r.name)) continue;
            const nn = r.name.replace(/\.acu$/i, '.ecu');
            const body = localStorage.getItem(RECENT_KEY + ':' + r.name);
            if (body != null) { localStorage.setItem(RECENT_KEY + ':' + nn, body); localStorage.removeItem(RECENT_KEY + ':' + r.name); }
            r.name = nn;
        }
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    }
} catch { /* 저장소 접근 불가 시 무시 */ }
let fileHandle = null;
let saveTimer = null;
let dirty = false;

function boot() {
    let data = null;
    try { data = storage.load(AUTOSAVE_KEY); } catch { data = null; }
    if (!data) {
        // 이전 버전(단일 단면) 자동저장이 있으면 옮겨온다
        const legacy = storage.load();
        if (legacy && legacy.sectionData) data = migrateLegacy(legacy);
    }
    store.replace(data ? normalizeProject(data) : createProject());
    window.__acuFileName = ((data && data.__fileName) || '제목없음.ecu').replace(/\.acu$/i, '.ecu');

    initShell();
    document.getElementById('sb-version').textContent = 'v' + APP_VERSION;

    store.on('change', () => { markDirty(); });
    bindCommands();
    renderRecent();

    let last = 'projectInfo';
    try { last = localStorage.getItem('escculvert.lastScreen') || last; } catch { /* 무시 */ }
    openScreen(last, { force: true });
}

function markDirty() {
    dirty = true;
    document.getElementById('sb-save').textContent = '변경됨';
    updateTitle();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 1000);
}

function autosave() {
    saveTimer = null;
    const data = { ...store.project, __fileName: window.__acuFileName };
    if (storage.save(data, AUTOSAVE_KEY)) {
        const t = new Date();
        document.getElementById('sb-save').textContent = `자동저장 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
    } else {
        document.getElementById('sb-save').textContent = '자동저장 실패';
    }
}

window.addEventListener('beforeunload', () => {
    if (saveTimer) { clearTimeout(saveTimer); autosave(); }
});

// ── 파일 ──────────────────────────────────────────────────────────────

async function newFile() {
    if (dirty && !(await confirmBox('현재 작업을 닫고 새 파일을 만듭니다.\n저장하지 않은 변경 내용은 사라집니다. 계속하시겠습니까?', '새로 만들기'))) return;
    fileHandle = null;
    window.__acuFileName = '제목없음.ecu';
    store.replace(createProject());
    dirty = false;
    openScreen('projectInfo');
    setHint('새 프로젝트를 만들었습니다.');
}

function serialize() {
    const p = { ...store.project };
    delete p.__fileName;
    return JSON.stringify(p, null, 1);
}

async function saveFile(saveAs = false) {
    const text = serialize();
    if (window.showSaveFilePicker) {
        try {
            if (!fileHandle || saveAs) {
                fileHandle = await window.showSaveFilePicker({
                    suggestedName: window.__acuFileName || '제목없음.ecu',
                    types: [{ description: 'ESC Culvert 프로젝트', accept: { 'application/json': ['.ecu'] } }],
                });
            }
            const w = await fileHandle.createWritable();
            await w.write(text);
            await w.close();
            window.__acuFileName = fileHandle.name;
            afterSave();
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            console.warn('파일 시스템 저장 실패, 내려받기로 대체:', e);
        }
    }
    const name = window.__acuFileName && window.__acuFileName !== '제목없음.ecu' ? window.__acuFileName : `${store.project.info.projectName || 'project'}.ecu`;
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    window.__acuFileName = name;
    afterSave();
}

function afterSave() {
    dirty = false;
    addRecent(window.__acuFileName, serialize());
    updateTitle();
    document.getElementById('sb-save').textContent = '저장됨';
    setHint(`${window.__acuFileName} 을(를) 저장했습니다.`);
}

async function openFile() {
    if (dirty && !(await confirmBox('현재 작업을 닫고 다른 파일을 엽니다.\n저장하지 않은 변경 내용은 사라집니다. 계속하시겠습니까?', '열기'))) return;
    if (window.showOpenFilePicker) {
        try {
            const [hd] = await window.showOpenFilePicker({ types: [{ description: 'ESC Culvert 프로젝트', accept: { 'application/json': ['.ecu', '.acu', '.json'] } }] });
            const f = await hd.getFile();
            loadText(await f.text(), f.name);
            fileHandle = hd.name.endsWith('.ecu') ? hd : null;
            return;
        } catch (e) {
            if (e && e.name === 'AbortError') return;
        }
    }
    const inp = document.getElementById('file-input');
    inp.value = '';
    inp.onchange = async () => {
        const f = inp.files[0];
        if (f) loadText(await f.text(), f.name);
    };
    inp.click();
}

function loadText(text, name) {
    let data;
    try { data = JSON.parse(text); } catch (e) { alertBox('파일 형식이 올바르지 않습니다.\n' + e.message); return; }
    if (data.sectionData && !data.culverts) data = migrateLegacy(data);
    store.replace(normalizeProject(data));
    window.__acuFileName = name.replace(/\.(json|acu)$/i, '.ecu');
    dirty = false;
    addRecent(window.__acuFileName, text);
    updateTitle();
    openScreen('projectInfo');
    setHint(`${name} 을(를) 열었습니다.`);
}

function addRecent(name, text) {
    try {
        const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(r => r.name !== name);
        list.unshift({ name, t: Date.now() });
        localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
        localStorage.setItem(RECENT_KEY + ':' + name, text);
        // 목록에서 빠진 파일 내용은 지운다
        Object.keys(localStorage).filter(k => k.startsWith(RECENT_KEY + ':') && !list.slice(0, 8).some(r => RECENT_KEY + ':' + r.name === k)).forEach(k => localStorage.removeItem(k));
    } catch { /* 저장공간 부족 등 무시 */ }
    renderRecent();
}

function renderRecent() {
    const el = document.getElementById('recent-list');
    el.innerHTML = '';
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { list = []; }
    if (!list.length) { el.appendChild(h('div', { style: { color: '#888' } }, '(없음)')); return; }
    list.forEach((r, i) => {
        el.appendChild(h('button', {
            class: 'recent-item',
            onclick: () => {
                hideMenu();
                const text = localStorage.getItem(RECENT_KEY + ':' + r.name);
                if (text) loadText(text, r.name); else alertBox('이 문서의 사본이 브라우저에 남아 있지 않습니다. [열기]로 파일을 선택하세요.');
            },
        }, [h('u', {}, String(i + 1)), ' ', r.name]));
    });
}

function hideMenu() { document.getElementById('appmenu').classList.add('hidden'); }

async function importOld() {
    const inp = document.getElementById('file-input');
    inp.value = '';
    inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
            const data = JSON.parse(await f.text());
            store.replace(normalizeProject(data.sectionData ? migrateLegacy(data) : data));
            openScreen('section');
            setHint('이전 형식 파일을 가져왔습니다.');
        } catch (e) { alertBox('가져오기 실패: ' + e.message); }
    };
    inp.click();
}

function showHelp() {
    modal({
        title: '도움말',
        width: 560,
        body: h('div', { style: { lineHeight: '1.7' } }, [
            h('b', {}, 'ESC Culvert — 암거 설계'), h('br'),
            '왼쪽 메뉴트리를 위에서부터 차례로 입력하면 설계가 끝납니다. [이전]/[다음] 버튼으로 단계를 이동합니다.', h('br'), h('br'),
            h('b', {}, '입력창'), h('br'),
            '· 셀을 선택하고 바로 입력, Enter/Tab 으로 이동, F2 또는 더블클릭으로 수정', h('br'),
            '· "=" 로 시작하면 수식 (예: =4500*2+500, =SQRT(2)*300)', h('br'),
            '· Ctrl+C / Ctrl+X / Ctrl+V : 드래그로 선택한 행열을 엑셀과 주고받기', h('br'),
            '· Ctrl+Z 취소 / Ctrl+Y 복구 (도면 화면에서도 유효)', h('br'), h('br'),
            h('b', {}, '입력결과 확인창'), h('br'),
            '· 휠 위/아래: 확대/축소, 휠버튼(또는 왼쪽 버튼) 드래그: 화면이동, 더블클릭: 전체보기', h('br'),
            '· 노란 변수명을 클릭하면 해당 입력셀로 이동합니다.', h('br'), h('br'),
            h('b', {}, '파일'), h('br'),
            '· 프로젝트는 .ecu 파일로 저장합니다(Ctrl+S). 작업 중 내용은 이 브라우저에 1초마다 자동저장됩니다.',
        ]),
    });
}

function bindCommands() {
    const run = async (cmd) => {
        switch (cmd) {
            case 'new': hideMenu(); return newFile();
            case 'open': hideMenu(); return openFile();
            case 'save': hideMenu(); return saveFile(false);
            case 'saveAs': hideMenu(); return saveFile(true);
            case 'print': hideMenu(); return window.print();
            case 'importOld': hideMenu(); return importOld();
            case 'closeMenu': return hideMenu();
            case 'undo': return store.undo() ? setHint('취소했습니다.') : setHint('취소할 작업이 없습니다.');
            case 'redo': return store.redo() ? setHint('복구했습니다.') : setHint('복구할 작업이 없습니다.');
            case 'undoAll': {
                if (!store.canUndo()) return setHint('취소할 작업이 없습니다.');
                if (await confirmBox('이전 작업을 전부 취소합니다. 계속하시겠습니까?', '전부취소')) setHint(`${store.undoAll()}개 작업을 취소했습니다.`);
                return;
            }
            case 'toggleTree': return toggleTree();
            case 'dlgMax': return dialogMax();
            case 'dlgReset': return dialogMax(false);
            case 'help': return showHelp();
            case 'settings': return openScreen('projectInfo').then(() => setHint('설정: 프로그램 설정은 브라우저에 저장됩니다.'));
            default: return viewCommand(cmd);
        }
    };
    document.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cmd]');
        if (b) { e.preventDefault(); run(b.dataset.cmd); return; }
        const menu = document.getElementById('appmenu');
        if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target.id !== 'app-orb' && !e.target.closest('#app-orb')) hideMenu();
    });
    document.getElementById('app-orb').addEventListener('click', () => document.getElementById('appmenu').classList.toggle('hidden'));

    document.addEventListener('keydown', (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        if (!ctrl || e.altKey) return;
        const k = e.key.toLowerCase();
        const inEditor = e.target && (e.target.tagName === 'INPUT' && e.target.type === 'text' || e.target.tagName === 'TEXTAREA');
        if (k === 's') { e.preventDefault(); saveFile(e.shiftKey); }
        else if (k === 'o') { e.preventDefault(); openFile(); }
        else if (k === 'n') { e.preventDefault(); newFile(); }
        else if ((k === 'z' || k === 'y') && !inEditor) {
            e.preventDefault();
            run(k === 'z' && !e.shiftKey ? 'undo' : 'redo');
        }
    });
}

document.addEventListener('DOMContentLoaded', boot);
