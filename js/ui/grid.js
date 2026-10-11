// grid.js - 엑셀형 입력 그리드 (항목별 세부 입력창)
//
// 매뉴얼 1.2 기본 다이얼로그 입력방식:
//   복사 Ctrl+C / 잘라내기 Ctrl+X / 붙여넣기 Ctrl+V (행열 드래그 선택),
//   '=' 로 시작하면 수식 입력, 취소 Ctrl+Z / 복구 Ctrl+Y (store 에서 처리).
//
// 사용법
//   new Grid(container, {
//     id: 'section-box',                      // 선택 위치 기억용
//     head: [[{t:'내공제원', cs:4}, ...], [...]],  // 다단 헤더 (t, cs=colspan, rs=rowspan)
//     rows: [{ head: [{t:'상부', rs:2}, {t:'좌측'}], cells: [cell, cell, ...] }],
//     colWidths: [60, 60, ...]                 // 선택
//   })
// cell = { get, set, type:'num'|'text'|'select'|'check'|'label'|'button',
//          options, dec, disabled, ro, field, cs, unit, onClick, cls, placeholder }

import { parseNumberInput } from './formula.js';
import store from '../core/store.js';

const selMemory = new Map();   // grid id → {r, c}
let focusedGridId = null;

function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function optList(options) {
    return (options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) }));
}

export function formatCell(cell) {
    const v = cell.get ? cell.get() : cell.value;
    if (cell.type === 'select') {
        const o = optList(cell.options).find(o => String(o.value) === String(v));
        return o ? o.label : (v ?? '');
    }
    if (v == null || v === '') return cell.disabled ? '-' : '';
    if (cell.type === 'num' || (cell.type === 'label' && typeof v === 'number')) {
        if (typeof v !== 'number' || !isFinite(v)) return String(v);
        if (cell.dec != null) return v.toFixed(cell.dec);
        return String(Math.round(v * 1e6) / 1e6);
    }
    return String(v);
}

export class Grid {
    constructor(container, spec) {
        this.container = container;
        this.spec = spec;
        this.id = spec.id || ('g' + Math.random().toString(36).slice(2));
        this.cells = [];      // [r][c] → {cell, td}
        this.active = null;   // {r, c}
        this.anchor = null;   // 범위 선택 시작점
        this.editor = null;
        this._render();
        const mem = selMemory.get(this.id);
        if (mem) this._select(mem.r, mem.c, false, true);
        if (focusedGridId === this.id) this.wrap.focus({ preventScroll: true });
    }

    _render() {
        const { head = [], rows = [], colWidths } = this.spec;
        const wrap = document.createElement('div');
        wrap.className = 'ag-wrap' + (this.spec.cls ? ' ' + this.spec.cls : '');
        wrap.tabIndex = 0;
        wrap.__grid = this;
        this.wrap = wrap;

        const table = document.createElement('table');
        table.className = 'ag';
        if (colWidths) {
            const cg = document.createElement('colgroup');
            colWidths.forEach(w => {
                const col = document.createElement('col');
                if (w) col.style.width = typeof w === 'number' ? w + 'px' : w;
                cg.appendChild(col);
            });
            table.appendChild(cg);
        }
        if (head.length) {
            const thead = document.createElement('thead');
            head.forEach(hr => {
                const tr = document.createElement('tr');
                hr.forEach(h => {
                    const th = document.createElement('th');
                    th.innerHTML = h.html ?? esc(h.t);
                    if (h.cs) th.colSpan = h.cs;
                    if (h.rs) th.rowSpan = h.rs;
                    if (h.cls) th.className = h.cls;
                    if (h.w) th.style.width = h.w + 'px';
                    tr.appendChild(th);
                });
                thead.appendChild(tr);
            });
            table.appendChild(thead);
        }
        const tbody = document.createElement('tbody');
        rows.forEach((row, r) => {
            const tr = document.createElement('tr');
            if (row.cls) tr.className = row.cls;
            (row.head || []).forEach(h => {
                const th = document.createElement('th');
                th.className = 'rh' + (h.cls ? ' ' + h.cls : '');
                th.innerHTML = h.html ?? esc(h.t);
                if (h.cs) th.colSpan = h.cs;
                if (h.rs) th.rowSpan = h.rs;
                tr.appendChild(th);
            });
            const rowCells = [];
            (row.cells || []).forEach((cell) => {
                if (!cell) return;
                const td = document.createElement('td');
                if (cell.cs) td.colSpan = cell.cs;
                if (cell.rs) td.rowSpan = cell.rs;
                const c = rowCells.length;
                td.dataset.r = r;
                td.dataset.c = c;
                this._fillTd(td, cell);
                tr.appendChild(td);
                rowCells.push({ cell, td });
            });
            this.cells.push(rowCells);
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        this.container.appendChild(wrap);
        this._bind();
    }

    _fillTd(td, cell) {
        td.className = 'ag-' + (cell.type || 'num');
        if (cell.disabled) td.classList.add('dis');
        if (cell.ro) td.classList.add('ro');
        if (cell.cls) td.classList.add(...cell.cls.split(' '));
        if (cell.align) td.style.textAlign = cell.align;
        td.innerHTML = '';
        const v = cell.get ? cell.get() : cell.value;
        if (cell.type === 'check') {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!v;
            cb.disabled = !!cell.disabled || !!cell.ro;
            cb.tabIndex = -1;
            cb.addEventListener('change', () => this._commit(cell, cb.checked));
            td.appendChild(cb);
            if (cell.text) td.appendChild(document.createTextNode(' ' + cell.text));
        } else if (cell.type === 'select') {
            if (cell.disabled || cell.ro) {
                td.textContent = cell.disabled ? '-' : formatCell(cell);
            } else {
                const sel = document.createElement('select');
                sel.tabIndex = -1;
                optList(cell.options).forEach(o => {
                    const op = document.createElement('option');
                    op.value = o.value;
                    op.textContent = o.label;
                    if (String(o.value) === String(v)) op.selected = true;
                    sel.appendChild(op);
                });
                sel.addEventListener('change', () => {
                    const o = optList(cell.options)[sel.selectedIndex];
                    this._commit(cell, o ? o.value : sel.value);
                });
                td.appendChild(sel);
            }
        } else if (cell.type === 'button') {
            const b = document.createElement('button');
            b.className = 'ag-btn';
            b.textContent = cell.text || '...';
            b.disabled = !!cell.disabled;
            b.addEventListener('click', (e) => { e.stopPropagation(); cell.onClick && cell.onClick(); });
            td.appendChild(b);
        } else {
            td.textContent = formatCell(cell);
            if (cell.unit) {
                const u = document.createElement('span');
                u.className = 'ag-unit';
                u.textContent = cell.unit;
                td.appendChild(u);
            }
        }
        if (cell.title) td.title = cell.title;
    }

    _bind() {
        const wrap = this.wrap;
        let dragging = false;
        wrap.addEventListener('mousedown', (e) => {
            const td = e.target.closest('td');
            if (!td || !wrap.contains(td)) return;
            if (this.editor && td.contains(this.editor)) return;
            const r = +td.dataset.r, c = +td.dataset.c;
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
                this._select(r, c, e.shiftKey);
                return;
            }
            e.preventDefault();
            this._select(r, c, e.shiftKey);
            wrap.focus({ preventScroll: true });
            dragging = true;
        });
        wrap.addEventListener('mouseover', (e) => {
            if (!dragging) return;
            const td = e.target.closest('td');
            if (!td || !wrap.contains(td)) return;
            this._extendTo(+td.dataset.r, +td.dataset.c);
        });
        window.addEventListener('mouseup', () => { dragging = false; });
        wrap.addEventListener('dblclick', (e) => {
            const td = e.target.closest('td');
            if (!td) return;
            this._startEdit();
        });
        wrap.addEventListener('focus', () => { focusedGridId = this.id; });
        wrap.addEventListener('blur', () => {
            setTimeout(() => {
                if (!wrap.contains(document.activeElement) && focusedGridId === this.id) focusedGridId = null;
            }, 0);
        });
        wrap.addEventListener('keydown', (e) => this._onKey(e));
        wrap.addEventListener('copy', (e) => { if (!this.editor) { e.preventDefault(); e.clipboardData.setData('text/plain', this._copyText()); } });
        wrap.addEventListener('cut', (e) => { if (!this.editor) { e.preventDefault(); e.clipboardData.setData('text/plain', this._copyText()); this._clearRange(); } });
        wrap.addEventListener('paste', (e) => {
            if (this.editor) return;
            e.preventDefault();
            this._paste(e.clipboardData.getData('text/plain'));
        });
    }

    _get(r, c) { return this.cells[r] && this.cells[r][c]; }

    _select(r, c, extend = false, silent = false) {
        if (!this._get(r, c)) return;
        if (extend && this.active) {
            this._extendTo(r, c);
            return;
        }
        this.active = { r, c };
        this.anchor = { r, c };
        this.rangeEnd = { r, c };
        selMemory.set(this.id, { r, c });
        this._paint();
        const { cell, td } = this._get(r, c);
        td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (!silent && this.spec.onSelect) this.spec.onSelect(cell, r, c);
        if (!silent && cell.hint) this._hint(cell.hint);
    }

    _hint(text) { store.emit('hint', text); }

    _extendTo(r, c) {
        if (!this._get(r, c)) return;
        this.rangeEnd = { r, c };
        this._paint();
    }

    _range() {
        if (!this.anchor) return null;
        const a = this.anchor, b = this.rangeEnd || a;
        return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
    }

    _paint() {
        this.wrap.querySelectorAll('td.sel, td.act').forEach(td => td.classList.remove('sel', 'act'));
        const rg = this._range();
        if (rg) {
            for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) {
                const x = this._get(r, c);
                if (x) x.td.classList.add('sel');
            }
        }
        if (this.active) {
            const x = this._get(this.active.r, this.active.c);
            if (x) x.td.classList.add('act');
        }
    }

    _move(dr, dc) {
        if (!this.active) { this._select(0, 0); return; }
        let { r, c } = this.active;
        const rows = this.cells.length;
        for (let k = 0; k < 200; k++) {
            r += dr; c += dc;
            if (dc !== 0 && this.cells[r] && c >= this.cells[r].length) { if (dc > 0 && this.spec.wrapTab) { r++; c = 0; } else return; }
            if (c < 0) return;
            if (r < 0 || r >= rows) return;
            if (!this.cells[r]) continue;
            if (c >= this.cells[r].length) { c = this.cells[r].length - 1; }
            const x = this._get(r, c);
            if (x) { this._select(r, c); return; }
        }
    }

    _onKey(e) {
        if (this.editor) return;   // 편집 중엔 에디터가 처리
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && (e.key === 'z' || e.key === 'y' || e.key === 'Z' || e.key === 'Y')) return; // 전역 처리
        if (ctrl) return;   // copy/cut/paste 이벤트로 처리
        switch (e.key) {
            case 'ArrowUp': e.preventDefault(); e.shiftKey ? this._extendBy(-1, 0) : this._move(-1, 0); return;
            case 'ArrowDown': e.preventDefault(); e.shiftKey ? this._extendBy(1, 0) : this._move(1, 0); return;
            case 'ArrowLeft': e.preventDefault(); e.shiftKey ? this._extendBy(0, -1) : this._move(0, -1); return;
            case 'ArrowRight': e.preventDefault(); e.shiftKey ? this._extendBy(0, 1) : this._move(0, 1); return;
            case 'Tab': e.preventDefault(); this._move(0, e.shiftKey ? -1 : 1); return;
            case 'Enter': e.preventDefault(); this._startEdit(); return;
            case 'F2': e.preventDefault(); this._startEdit(); return;
            case 'Delete': case 'Backspace': e.preventDefault(); this._clearRange(); return;
            case ' ': {
                const x = this.active && this._get(this.active.r, this.active.c);
                if (x && x.cell.type === 'check' && !x.cell.disabled && !x.cell.ro) {
                    e.preventDefault();
                    this._commit(x.cell, !(x.cell.get ? x.cell.get() : x.cell.value));
                    return;
                }
                break;
            }
        }
        if (e.key.length === 1 && !e.altKey) {
            const x = this.active && this._get(this.active.r, this.active.c);
            if (x && (x.cell.type === 'num' || x.cell.type === 'text' || !x.cell.type)) {
                e.preventDefault();
                this._startEdit(e.key);
            }
        }
    }

    _extendBy(dr, dc) {
        const end = this.rangeEnd || this.active;
        if (!end) return;
        this._extendTo(end.r + dr, end.c + dc);
    }

    _editable(cell) {
        return !cell.disabled && !cell.ro && cell.set && (cell.type === 'num' || cell.type === 'text' || !cell.type);
    }

    _startEdit(initial) {
        if (!this.active) return;
        const x = this._get(this.active.r, this.active.c);
        if (!x) return;
        const { cell, td } = x;
        if (cell.type === 'select' && !cell.disabled && !cell.ro) {
            const s = td.querySelector('select');
            if (s) { s.focus(); if (s.showPicker) try { s.showPicker(); } catch { /* 일부 브라우저 미지원 */ } }
            return;
        }
        if (cell.type === 'check' && !cell.disabled && !cell.ro) {
            this._commit(cell, !(cell.get ? cell.get() : cell.value));
            return;
        }
        if (cell.type === 'button') { cell.onClick && cell.onClick(); return; }
        if (!this._editable(cell)) return;
        const input = document.createElement('input');
        input.className = 'ag-editor';
        const raw = cell.get ? cell.get() : cell.value;
        input.value = initial != null ? initial : (raw ?? '');
        td.textContent = '';
        td.appendChild(input);
        td.classList.add('editing');
        this.editor = input;
        input.focus();
        if (initial == null) input.select();
        let done = false;
        const finish = (commit, move) => {
            if (done) return;
            done = true;
            this.editor = null;
            td.classList.remove('editing');
            const text = input.value;
            input.remove();
            if (commit) {
                if (cell.type === 'num') {
                    const v = parseNumberInput(text);
                    if (v != null) this._commit(cell, v);
                    else if (text.trim() === '' && cell.allowEmpty) this._commit(cell, null);
                    else if (text.trim() !== '' && String(text).startsWith('=')) store.emit('hint', '수식을 계산할 수 없습니다: ' + text);
                } else {
                    this._commit(cell, text);
                }
            }
            // 재렌더가 일어나지 않은 경우 원래 값 다시 표시
            if (td.isConnected) this._fillTd(td, cell);
            this._paint();
            this.wrap.focus({ preventScroll: true });
            if (move) this._move(move[0], move[1]);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true, [1, 0]); }
            else if (e.key === 'Tab') { e.preventDefault(); finish(true, [0, e.shiftKey ? -1 : 1]); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && initial != null) { e.preventDefault(); finish(true, [e.key === 'ArrowUp' ? -1 : 1, 0]); }
            e.stopPropagation();
        });
        input.addEventListener('blur', () => finish(true));
    }

    _commit(cell, value) {
        if (!cell.set) return;
        if (cell.validate) {
            const msg = cell.validate(value);
            if (msg) { store.emit('hint', msg); store.emit('warn', msg); return; }
        }
        cell.set(value);
    }

    _copyText() {
        const rg = this._range();
        if (!rg) return '';
        const out = [];
        for (let r = rg.r0; r <= rg.r1; r++) {
            const line = [];
            for (let c = rg.c0; c <= rg.c1; c++) {
                const x = this._get(r, c);
                if (!x) { line.push(''); continue; }
                const v = x.cell.get ? x.cell.get() : x.cell.value;
                if (x.cell.type === 'check') line.push(v ? '1' : '0');
                else if (x.cell.type === 'select') line.push(formatCell(x.cell));
                else line.push(v ?? '');
            }
            out.push(line.join('\t'));
        }
        return out.join('\n');
    }

    _clearRange() {
        const rg = this._range();
        if (!rg) return;
        store.beginBatch();
        try {
            for (let r = rg.r0; r <= rg.r1; r++) for (let c = rg.c0; c <= rg.c1; c++) {
                const x = this._get(r, c);
                if (!x || !this._editable(x.cell)) continue;
                if (x.cell.type === 'text') x.cell.set('');
                else if (x.cell.allowEmpty) x.cell.set(null);
                else x.cell.set(0);
            }
        } finally { store.endBatch(); }
    }

    _paste(text) {
        if (!this.active || !text) return;
        const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
        const { r: r0, c: c0 } = this.active;
        store.beginBatch();
        try {
            lines.forEach((cols, i) => cols.forEach((val, j) => {
                const x = this._get(r0 + i, c0 + j);
                if (!x) return;
                const cell = x.cell;
                if (cell.disabled || cell.ro || !cell.set) return;
                if (cell.type === 'check') cell.set(/^(1|true|o|v|y|예|설치|적용)$/i.test(val.trim()));
                else if (cell.type === 'select') {
                    const o = optList(cell.options).find(o => o.label === val.trim() || String(o.value) === val.trim());
                    if (o) cell.set(o.value);
                } else if (cell.type === 'num') {
                    const v = parseNumberInput(val);
                    if (v != null) cell.set(v);
                } else if (cell.type === 'text' || !cell.type) cell.set(val);
            }));
        } finally { store.endBatch(); }
        store.emit('change', { path: [] });
    }

    /** 변수명으로 셀 선택 (도면의 변수 클릭 연동) */
    focusField(name) {
        for (let r = 0; r < this.cells.length; r++) {
            for (let c = 0; c < this.cells[r].length; c++) {
                if (this.cells[r][c].cell.field === name) {
                    this._select(r, c);
                    this.wrap.focus({ preventScroll: true });
                    return true;
                }
            }
        }
        return false;
    }
}

// ── 속성 그리드 (라벨 | 값) ───────────────────────────────────────────
// rows: [{ label, cell, group }]  group 이 바뀌면 첫 칸에 그룹명을 rowspan 으로 표시
export function propGrid(container, rows, opts = {}) {
    const hasGroup = rows.some(r => r.group);
    const out = [];
    let i = 0;
    while (i < rows.length) {
        const g = rows[i].group;
        let n = 1;
        if (hasGroup) while (i + n < rows.length && rows[i + n].group === g) n++;
        for (let k = 0; k < n; k++) {
            const row = rows[i + k];
            const head = [];
            if (hasGroup && k === 0) head.push({ t: g || '', rs: n, cls: 'grp' });
            head.push({ t: row.label, cls: row.sub ? 'sub' : '' });
            const cells = [row.cell];
            if (opts.unitCol) cells.push({ type: 'label', value: row.unit || '', cls: 'unitcell' });
            out.push({ head, cells, cls: row.cls });
        }
        i += n;
    }
    const head = opts.head ? [opts.head] : [];
    return new Grid(container, {
        id: opts.id,
        cls: 'ag-prop' + (opts.cls ? ' ' + opts.cls : ''),
        head,
        rows: out,
        colWidths: opts.colWidths,
    });
}

export default Grid;
