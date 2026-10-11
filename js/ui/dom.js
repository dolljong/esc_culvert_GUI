// dom.js - 작은 DOM 헬퍼 (헤더/하단 컨트롤, 그룹박스, 모달)

import store from '../core/store.js';
import { parseNumberInput } from './formula.js';

/** h('div', {class:'x', onclick: fn}, [children...]) */
export function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
}

/** 그룹 박스 */
export function box(title, content, opts = {}) {
    const body = h('div', { class: 'box-body' }, content);
    const b = h('div', { class: 'box', style: opts.style }, [title ? h('div', { class: 'box-title' }, title) : null, body]);
    return b;
}

/** 데이터 경로에 묶인 체크박스 (라벨 포함) */
export function bCheck(path, label, opts = {}) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!store.get(path);
    cb.disabled = !!opts.disabled;
    cb.addEventListener('change', () => {
        if (opts.onChange) opts.onChange(cb.checked);
        else store.set(path, cb.checked);
    });
    return h('label', { title: opts.title }, [cb, label]);
}

/** 데이터 경로에 묶인 선택 상자 */
export function bSelect(path, options, opts = {}) {
    const s = h('select', { disabled: opts.disabled });
    const cur = store.get(path);
    options.forEach(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : String(o);
        const op = h('option', { value: v }, l);
        if (String(v) === String(cur)) op.selected = true;
        s.appendChild(op);
    });
    s.addEventListener('change', () => {
        const o = options[s.selectedIndex];
        const v = typeof o === 'object' ? o.value : o;
        if (opts.onChange) opts.onChange(v);
        else store.set(path, v);
    });
    return opts.label ? h('label', {}, [opts.label + ' ', s]) : s;
}

/** 데이터 경로에 묶인 숫자 입력 ('=' 수식 허용) */
export function bNumber(path, opts = {}) {
    const inp = h('input', { type: 'text', style: { width: (opts.width || 70) + 'px', textAlign: 'right' }, disabled: opts.disabled });
    const v = store.get(path);
    inp.value = v == null ? '' : (opts.dec != null ? Number(v).toFixed(opts.dec) : v);
    const commit = () => {
        const n = parseNumberInput(inp.value);
        if (n == null) { inp.value = v == null ? '' : v; return; }
        if (opts.onChange) opts.onChange(n);
        else store.set(path, n);
    };
    inp.addEventListener('change', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    if (!opts.label) return inp;
    return h('label', {}, [opts.label + ' ', inp, opts.unit ? ' ' + opts.unit : '']);
}

export function bText(path, opts = {}) {
    const inp = h('input', { type: 'text', style: { width: (opts.width || 120) + 'px' }, disabled: opts.disabled });
    inp.value = store.get(path) ?? '';
    inp.addEventListener('change', () => store.set(path, inp.value));
    return opts.label ? h('label', {}, [opts.label + ' ', inp]) : inp;
}

/** 라디오 그룹 */
export function bRadio(path, options, opts = {}) {
    const name = 'r' + Math.random().toString(36).slice(2);
    const cur = store.get(path);
    const wrap = h('span', { class: 'radio-group' });
    options.forEach(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : String(o);
        const r = h('input', { type: 'radio', name, value: v });
        r.checked = String(v) === String(cur);
        r.disabled = !!opts.disabled;
        r.addEventListener('change', () => { if (r.checked) (opts.onChange ? opts.onChange(v) : store.set(path, v)); });
        wrap.appendChild(h('label', {}, [r, l]));
    });
    return wrap;
}

export function button(text, onClick, opts = {}) {
    return h('button', { class: 'btn' + (opts.cls ? ' ' + opts.cls : ''), onclick: onClick, disabled: opts.disabled, title: opts.title }, text);
}

// ── 모달 ──────────────────────────────────────────────────────────────

/**
 * modal({ title, body: Element|string, buttons: [{text, onClick, primary}], width })
 * 반환: { close(), body }
 */
export function modal({ title, body, buttons = [{ text: '닫기' }], width, height }) {
    const layer = document.getElementById('modal-layer');
    const bodyEl = h('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const close = () => { dlg.remove(); if (!layer.children.length) layer.classList.add('hidden'); };
    const foot = h('div', { class: 'modal-foot' }, buttons.map(b => button(b.text, () => { const r = b.onClick ? b.onClick() : undefined; if (r !== false) close(); }, { cls: b.primary ? 'primary' : '' })));
    const dlg = h('div', { class: 'modal', style: { width: width ? width + 'px' : null, height: height ? height + 'px' : null } }, [
        h('div', { class: 'modal-title' }, [h('span', {}, title || ''), h('button', { onclick: close, title: '닫기' }, '✕')]),
        bodyEl, foot,
    ]);
    layer.appendChild(dlg);
    layer.classList.remove('hidden');
    return { close, body: bodyEl, el: dlg };
}

export function confirmBox(message, title = 'ESC Culvert') {
    return new Promise(resolve => {
        modal({
            title,
            body: h('div', { style: { padding: '8px 4px', whiteSpace: 'pre-line', minWidth: '300px' } }, message),
            buttons: [
                { text: '예(Y)', primary: true, onClick: () => resolve(true) },
                { text: '아니오(N)', onClick: () => resolve(false) },
            ],
        });
    });
}

export function alertBox(message, title = 'ESC Culvert') {
    return new Promise(resolve => {
        modal({ title, body: h('div', { style: { padding: '8px 4px', whiteSpace: 'pre-line', minWidth: '300px' } }, message), buttons: [{ text: '확인', primary: true, onClick: () => resolve() }] });
    });
}
