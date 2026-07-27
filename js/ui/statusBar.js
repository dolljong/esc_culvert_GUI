// statusBar.js - 상태 표시줄 (PyQt statusBar 대응)

export const APP_VERSION = '2026.02-web';

function el(id) {
    return document.getElementById(id);
}

export function setMessage(text) {
    const node = el('status-message');
    if (node) node.textContent = text;
}

// 미저장 상태 표시
export function setDirty() {
    const node = el('status-save');
    if (!node) return;
    node.textContent = '저장되지 않음';
    node.className = 'status-save dirty';
}

// 자동저장 완료 표시
export function setSaved(date = new Date()) {
    const node = el('status-save');
    if (!node) return;
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    node.textContent = `자동저장됨 ${hh}:${mm}:${ss}`;
    node.className = 'status-save saved';
}

export function initStatusBar() {
    const version = el('status-version');
    if (version) version.textContent = 'v' + APP_VERSION;
}

export default { initStatusBar, setMessage, setDirty, setSaved, APP_VERSION };
