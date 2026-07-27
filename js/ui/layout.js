// layout.js - 트리 접기/펴기, 패널 크기 조절
// PyQt의 "보기 > 트리메뉴 보기"(toggle_tree_widget)와 QSplitter를 대체한다.

const LAYOUT_KEY = 'esc_culvert_layout';

const TREE_MIN = 160;
const TREE_MAX = 520;
const FORM_MIN_RATIO = 0.15;   // 메인 패널 높이 대비
const FORM_MAX_RATIO = 0.75;

const defaults = {
    treeHidden: false,
    treeWidth: 240,
    formHeightRatio: 0.35
};

function loadLayout() {
    try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch {
        return { ...defaults };
    }
}

function saveLayout(layout) {
    try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
        // 저장 실패는 무시 (레이아웃은 부가 정보)
    }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

let layout = { ...defaults };
let onResize = () => {};

function applyTreeWidth() {
    document.documentElement.style.setProperty('--tree-width', layout.treeWidth + 'px');
}

function applyFormHeight() {
    document.documentElement.style.setProperty(
        '--form-height', (layout.formHeightRatio * 100).toFixed(2) + '%'
    );
}

function applyTreeHidden() {
    const area = document.getElementById('content-area');
    const btn = document.getElementById('btn-toggle-tree');
    if (area) area.classList.toggle('tree-hidden', layout.treeHidden);
    if (btn) btn.setAttribute('aria-expanded', String(!layout.treeHidden));
}

export function toggleTree() {
    layout.treeHidden = !layout.treeHidden;
    applyTreeHidden();
    saveLayout(layout);
    onResize();
    return !layout.treeHidden;
}

// 드래그 처리 (수직/수평 공통)
function initDrag(splitter, axis, onDrag) {
    if (!splitter) return;

    splitter.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        splitter.setPointerCapture(e.pointerId);
        splitter.classList.add('dragging');
        document.body.classList.add(axis === 'x' ? 'resizing-col' : 'resizing-row');

        const move = (ev) => onDrag(ev);
        const up = (ev) => {
            splitter.releasePointerCapture(ev.pointerId);
            splitter.classList.remove('dragging');
            document.body.classList.remove('resizing-col', 'resizing-row');
            splitter.removeEventListener('pointermove', move);
            splitter.removeEventListener('pointerup', up);
            splitter.removeEventListener('pointercancel', up);
            saveLayout(layout);
            onResize();
        };

        splitter.addEventListener('pointermove', move);
        splitter.addEventListener('pointerup', up);
        splitter.addEventListener('pointercancel', up);
    });
}

export function initLayout(options = {}) {
    onResize = options.onResize || (() => {});
    layout = loadLayout();

    applyTreeWidth();
    applyFormHeight();
    applyTreeHidden();

    const toggleBtn = document.getElementById('btn-toggle-tree');
    if (toggleBtn) toggleBtn.addEventListener('click', () => toggleTree());

    // 트리 너비: 콘텐츠 영역 좌측 기준
    const area = document.getElementById('content-area');
    initDrag(document.getElementById('splitter-tree'), 'x', (ev) => {
        if (!area) return;
        const left = area.getBoundingClientRect().left;
        layout.treeWidth = clamp(Math.round(ev.clientX - left), TREE_MIN, TREE_MAX);
        applyTreeWidth();
        onResize();
    });

    // 폼 높이: 메인 패널 하단 기준 비율
    const mainPanel = document.getElementById('main-panel');
    initDrag(document.getElementById('splitter-form'), 'y', (ev) => {
        if (!mainPanel) return;
        const rect = mainPanel.getBoundingClientRect();
        if (rect.height <= 0) return;
        const ratio = (rect.bottom - ev.clientY) / rect.height;
        layout.formHeightRatio = clamp(ratio, FORM_MIN_RATIO, FORM_MAX_RATIO);
        applyFormHeight();
        onResize();
    });
}

export default { initLayout, toggleTree };
