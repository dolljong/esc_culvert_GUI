// cadView.js - 입력결과 확인창 (검은 바탕 CAD 뷰)
//
// Drawing 엔티티를 SVG 로 그린다. 매뉴얼 1.2:
//   휠 위로 = 확대, 휠 아래로 = 축소, 휠버튼 누른 채 이동 = 화면이동.
// 왼쪽 버튼 드래그도 화면이동으로 쓴다. 더블클릭 = 전체보기.
// 변수명 문자(field)를 클릭하면 onFieldClick 으로 알려 입력셀을 활성화한다
// (매뉴얼: "확인창의 변수명을 클릭하면 세부항목 입력창의 DATA cell 이 활성화").

import { aciToCss } from './drawing.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = "'Malgun Gothic', 'Segoe UI', sans-serif";

function el(name, attrs = {}, parent) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
}

const DASH = {
    center: '12 4 2 4',
    hidden: '6 4',
    dash: '8 4',
    dot: '1 3',
    phantom: '14 4 2 4 2 4',
};

export class CadView {
    constructor(container, opts = {}) {
        this.container = container;
        this.onFieldClick = opts.onFieldClick || (() => {});
        this.onMouseWorld = opts.onMouseWorld || (() => {});
        this.svg = el('svg', { class: 'cad-svg', xmlns: NS });
        container.appendChild(this.svg);
        this.defs = el('defs', {}, this.svg);
        this.root = el('g', {}, this.svg);
        this.view = null;       // {x, y, w, h} (SVG 좌표 = 세계좌표 y 반전)
        this.extent = null;
        this.drawing = null;
        this.viewKey = null;
        this._bind();
        this._ro = new ResizeObserver(() => this._applyView());
        this._ro.observe(container);
    }

    _bind() {
        const c = this.container;
        let pan = null;
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!this.view) return;
            const p = this._clientToSvg(e.clientX, e.clientY);
            const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
            const v = this.view;
            this.view = {
                x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f,
                w: v.w * f, h: v.h * f,
            };
            this._applyView();
        }, { passive: false });
        c.addEventListener('mousedown', (e) => {
            if (e.button !== 0 && e.button !== 1) return;
            const t = e.target.closest && e.target.closest('[data-field]');
            if (t && e.button === 0) return;   // 변수 클릭은 click 에서 처리
            e.preventDefault();
            pan = { sx: e.clientX, sy: e.clientY, v: { ...this.view } };
            c.classList.add('panning');
        });
        window.addEventListener('mousemove', (e) => {
            if (pan && this.view) {
                const r = this.svg.getBoundingClientRect();
                const k = this._scale(r);
                this.view = { ...pan.v, x: pan.v.x - (e.clientX - pan.sx) / k, y: pan.v.y - (e.clientY - pan.sy) / k };
                this._applyView();
            }
        });
        window.addEventListener('mouseup', () => {
            if (pan) { pan = null; c.classList.remove('panning'); }
        });
        c.addEventListener('mousemove', (e) => {
            if (!this.view) return;
            const p = this._clientToSvg(e.clientX, e.clientY);
            this.onMouseWorld(p.x, -p.y);
        });
        c.addEventListener('dblclick', () => this.fit());
        c.addEventListener('click', (e) => {
            const t = e.target.closest && e.target.closest('[data-field]');
            if (t) this.onFieldClick(t.getAttribute('data-field'));
        });
    }

    _scale(rect) {
        // preserveAspectRatio meet → 실제 픽셀/단위
        return Math.min(rect.width / this.view.w, rect.height / this.view.h);
    }

    _clientToSvg(cx, cy) {
        const r = this.svg.getBoundingClientRect();
        const k = this._scale(r);
        // meet 정렬은 가운데
        const offX = (r.width - this.view.w * k) / 2;
        const offY = (r.height - this.view.h * k) / 2;
        return { x: this.view.x + (cx - r.left - offX) / k, y: this.view.y + (cy - r.top - offY) / k };
    }

    _applyView() {
        if (!this.view) return;
        const v = this.view;
        this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    }

    fit() {
        if (!this.extent) return;
        const e = this.extent;
        const m = Math.max(e.w, e.h) * 0.06 + 1;
        this.view = { x: e.minX - m, y: -e.maxY - m, w: e.w + 2 * m, h: e.h + 2 * m };
        this._applyView();
    }

    zoom(f) {
        if (!this.view) return;
        const v = this.view;
        const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
        this.view = { x: cx - v.w * f / 2, y: cy - v.h * f / 2, w: v.w * f, h: v.h * f };
        this._applyView();
    }

    /**
     * 도면 그리기. key 가 직전과 같으면 현재 확대/이동 상태를 유지한다
     * (값을 고칠 때마다 화면이 튀지 않도록).
     */
    render(drawing, key = null) {
        this.drawing = drawing;
        this.root.innerHTML = '';
        this.defs.innerHTML = '';
        this._patterns = new Map();
        if (!drawing || drawing.entities.length === 0) {
            this.extent = null;
            this.view = { x: -100, y: -50, w: 200, h: 100 };
            this._applyView();
            if (drawing && drawing.emptyMessage) {
                el('text', { x: 0, y: 0, fill: '#888', 'font-size': 6, 'text-anchor': 'middle', 'font-family': FONT }, this.root).textContent = drawing.emptyMessage;
            }
            this.viewKey = null;
            return;
        }
        for (const e of drawing.entities) this._draw(e);
        const bb = drawing.bbox();
        this.extent = bb;
        if (key == null || key !== this.viewKey || !this.view) this.fit();
        else this._applyView();
        this.viewKey = key;
    }

    _stroke(e, attrs) {
        attrs.stroke = aciToCss(e.color);
        attrs['vector-effect'] = 'non-scaling-stroke';
        attrs['stroke-width'] = e.width || 1;
        if (e.dash && DASH[e.dash]) attrs['stroke-dasharray'] = DASH[e.dash];
        return attrs;
    }

    _pattern(e) {
        const color = aciToCss(e.color);
        const sp = e.spacing || 150;
        const key = `${e.pattern}-${color}-${sp}`;
        if (this._patterns.has(key)) return this._patterns.get(key);
        const id = 'hp' + this._patterns.size;
        const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: sp, height: sp }, this.defs);
        const sw = { stroke: color, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' };
        if (e.pattern === 'ansi31') {
            el('path', { d: `M0,${sp} L${sp},0 M${-sp / 4},${sp / 4} L${sp / 4},${-sp / 4} M${sp * 0.75},${sp * 1.25} L${sp * 1.25},${sp * 0.75}`, ...sw }, p);
        } else if (e.pattern === 'cross') {
            el('path', { d: `M0,${sp} L${sp},0 M0,0 L${sp},${sp}`, ...sw }, p);
        } else if (e.pattern === 'dots') {
            el('circle', { cx: sp / 2, cy: sp / 2, r: sp * 0.06, fill: color }, p);
        } else if (e.pattern === 'earth') {
            el('path', { d: `M0,${sp * 0.3} L${sp * 0.6},${sp * 0.3} M${sp * 0.1},${sp * 0.5} L${sp * 0.5},${sp * 0.5} M${sp * 0.2},${sp * 0.7} L${sp * 0.4},${sp * 0.7}`, ...sw }, p);
        } else if (e.pattern === 'gravel') {
            el('circle', { cx: sp * 0.3, cy: sp * 0.3, r: sp * 0.15, fill: 'none', ...sw }, p);
            el('circle', { cx: sp * 0.75, cy: sp * 0.7, r: sp * 0.12, fill: 'none', ...sw }, p);
        } else if (e.pattern === 'water') {
            el('path', { d: `M0,${sp / 2} L${sp},${sp / 2}`, ...sw }, p);
        }
        const url = `url(#${id})`;
        this._patterns.set(key, url);
        return url;
    }

    _draw(e) {
        const g = this.root;
        let node = null;
        switch (e.type) {
            case 'line':
                node = el('line', this._stroke(e, { x1: e.x1, y1: -e.y1, x2: e.x2, y2: -e.y2 }), g);
                break;
            case 'pline': {
                const pts = e.pts.map(p => `${p[0]},${-p[1]}`).join(' ');
                const attrs = this._stroke(e, { points: pts, fill: e.fill != null ? aciToCss(e.fill) : 'none' });
                node = el(e.closed ? 'polygon' : 'polyline', attrs, g);
                break;
            }
            case 'circle':
                node = el('circle', this._stroke(e, { cx: e.cx, cy: -e.cy, r: e.r, fill: e.fill != null ? aciToCss(e.fill) : 'none' }), g);
                break;
            case 'arc': {
                const a0 = e.a0 * Math.PI / 180, a1 = e.a1 * Math.PI / 180;
                let sweep = e.a1 - e.a0;
                while (sweep < 0) sweep += 360;
                const x0 = e.cx + e.r * Math.cos(a0), y0 = e.cy + e.r * Math.sin(a0);
                const x1 = e.cx + e.r * Math.cos(a1), y1 = e.cy + e.r * Math.sin(a1);
                const large = sweep > 180 ? 1 : 0;
                // y 반전으로 반시계 → SVG sweep-flag 0
                node = el('path', this._stroke(e, { d: `M${x0},${-y0} A${e.r},${e.r} 0 ${large} 0 ${x1},${-y1}`, fill: 'none' }), g);
                break;
            }
            case 'hatch': {
                const pts = e.pts.map(p => `${p[0]},${-p[1]}`).join(' ');
                const fill = e.pattern === 'solid' ? aciToCss(e.color) : this._pattern(e);
                node = el('polygon', { points: pts, fill, 'fill-opacity': e.pattern === 'solid' ? e.alpha : 1, stroke: 'none' }, g);
                break;
            }
            case 'text': {
                const anchor = e.align === 'left' ? 'start' : e.align === 'right' ? 'end' : 'middle';
                const base = e.valign === 'top' ? 'hanging' : e.valign === 'middle' ? 'central' : 'alphabetic';
                node = el('text', {
                    x: 0, y: 0,
                    transform: `translate(${e.x},${-e.y}) rotate(${-e.rot})`,
                    fill: aciToCss(e.color),
                    'font-size': e.h,
                    'font-family': FONT,
                    'text-anchor': anchor,
                    'dominant-baseline': base,
                }, g);
                node.textContent = e.str;
                break;
            }
        }
        if (node && e.field) {
            node.setAttribute('data-field', e.field);
            node.classList.add('cad-field');
        }
        if (node && e.tip) {
            const t = el('title', {}, node);
            t.textContent = e.tip;
        }
    }

    /** 현재 화면을 PNG 로 저장 (매뉴얼 4.6 "이미지 파일저장") */
    toSvgString() {
        const clone = this.svg.cloneNode(true);
        clone.setAttribute('style', 'background:#000');
        const r = this.svg.getBoundingClientRect();
        clone.setAttribute('width', Math.round(r.width));
        clone.setAttribute('height', Math.round(r.height));
        return new XMLSerializer().serializeToString(clone);
    }
}

export default CadView;
