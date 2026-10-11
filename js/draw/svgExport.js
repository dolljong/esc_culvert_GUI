// svgExport.js - Drawing → 독립 SVG 문자열 (흰 바탕, 인쇄용)
//
// CadView(검은 바탕, DOM) 와 달리 문자열만 만든다 → node 에서도 동작하고 계산서 HTML 에 그대로 넣을 수 있다.
// 흰 바탕에서 안 보이는 색(흰/노랑/하늘 등)은 진한 색으로 바꾼다.
//
// drawingToSvg(drawing, { width, height, margin, title, mono, background }) → '<svg ...>...</svg>'

import { aciToCss } from '../cad/drawing.js';

const FONT = "'Malgun Gothic', 'Dotum', 'Segoe UI', sans-serif";

/** 흰 바탕용 색 (ACI → CSS) */
const PRINT = {
    1: '#d00000', 2: '#9a7a00', 3: '#007a00', 4: '#0060b0', 5: '#2040c0',
    6: '#b000b0', 7: '#000000', 8: '#606060', 9: '#808080',
    10: '#c05050', 30: '#c06000', 40: '#a07000', 50: '#707000', 140: '#3070b0',
    150: '#2060a0', 171: '#405890', 253: '#808080', 254: '#a0a0a0',
};

const DASH = { center: '12 4 2 4', hidden: '6 4', dash: '8 4', dot: '1 3', phantom: '14 4 2 4 2 4' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v) => (Math.round(v * 10) / 10).toString();

export function printColor(c, mono = false) {
    if (mono) return '#000000';
    if (typeof c === 'string') {
        const s = c.toLowerCase();
        if (s === '#ffffff' || s === '#fff' || s === 'white') return '#000000';
        if (s === '#ffff00' || s === 'yellow') return PRINT[2];
        return c;
    }
    return PRINT[c] || aciToCss(c);
}

/**
 * Drawing → SVG 문자열.
 * opts.width/height: 픽셀 크기 (height 생략 시 비율 유지), margin: 여백 비율 (기본 0.04)
 */
export function drawingToSvg(drawing, opts = {}) {
    const mono = !!opts.mono;
    const bb = drawing && drawing.bbox && drawing.bbox();
    const width = opts.width || 640;
    if (!bb || !drawing.entities.length) {
        const h = opts.height || 80;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" style="background:#fff"><text x="${width / 2}" y="${h / 2}" text-anchor="middle" font-size="12" font-family="${esc(FONT)}" fill="#666">${esc((drawing && drawing.emptyMessage) || '그림 없음')}</text></svg>`;
    }
    const m = Math.max(bb.w, bb.h) * (opts.margin ?? 0.04) + 1;
    const vx = bb.minX - m, vy = -bb.maxY - m, vw = bb.w + 2 * m, vh = bb.h + 2 * m;
    let height = opts.height || Math.round(width * vh / vw);
    if (opts.maxHeight && height > opts.maxHeight) height = opts.maxHeight;
    const out = [];
    const defs = [];
    const pats = new Map();
    const sw = opts.strokeWidth || 1;
    const stroke = (e) => {
        let a = `stroke="${printColor(e.color, mono)}" stroke-width="${(e.width || 1) * sw}" vector-effect="non-scaling-stroke"`;
        if (e.dash && DASH[e.dash]) a += ` stroke-dasharray="${DASH[e.dash]}"`;
        return a;
    };
    const fillOf = (f) => (f != null ? printColor(f, mono) : 'none');
    const pattern = (e) => {
        const color = printColor(e.color, mono);
        const sp = e.spacing || 150;
        const key = `${e.pattern}-${color}-${sp}`;
        if (pats.has(key)) return pats.get(key);
        const id = `hp${Math.random().toString(36).slice(2, 7)}${pats.size}`;
        const s = `stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke"`;
        let body = '';
        if (e.pattern === 'cross') body = `<path d="M0,${sp} L${sp},0 M0,0 L${sp},${sp}" ${s}/>`;
        else if (e.pattern === 'dots') body = `<circle cx="${sp / 2}" cy="${sp / 2}" r="${sp * 0.06}" fill="${color}"/>`;
        else if (e.pattern === 'earth') body = `<path d="M0,${sp * 0.3} L${sp * 0.6},${sp * 0.3} M${sp * 0.1},${sp * 0.5} L${sp * 0.5},${sp * 0.5} M${sp * 0.2},${sp * 0.7} L${sp * 0.4},${sp * 0.7}" ${s}/>`;
        else if (e.pattern === 'gravel') body = `<circle cx="${sp * 0.3}" cy="${sp * 0.3}" r="${sp * 0.15}" fill="none" ${s}/><circle cx="${sp * 0.75}" cy="${sp * 0.7}" r="${sp * 0.12}" fill="none" ${s}/>`;
        else if (e.pattern === 'water') body = `<path d="M0,${sp / 2} L${sp},${sp / 2}" ${s}/>`;
        else body = `<path d="M0,${sp} L${sp},0 M${-sp / 4},${sp / 4} L${sp / 4},${-sp / 4} M${sp * 0.75},${sp * 1.25} L${sp * 1.25},${sp * 0.75}" ${s}/>`;
        defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sp}" height="${sp}">${body}</pattern>`);
        const url = `url(#${id})`;
        pats.set(key, url);
        return url;
    };
    for (const e of drawing.entities) {
        switch (e.type) {
            case 'line':
                out.push(`<line x1="${n(e.x1)}" y1="${n(-e.y1)}" x2="${n(e.x2)}" y2="${n(-e.y2)}" ${stroke(e)}/>`);
                break;
            case 'pline': {
                const pts = e.pts.map(p => `${n(p[0])},${n(-p[1])}`).join(' ');
                out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${pts}" fill="${fillOf(e.fill)}" ${stroke(e)}/>`);
                break;
            }
            case 'circle':
                out.push(`<circle cx="${n(e.cx)}" cy="${n(-e.cy)}" r="${n(e.r)}" fill="${fillOf(e.fill)}" ${stroke(e)}/>`);
                break;
            case 'arc': {
                const a0 = e.a0 * Math.PI / 180, a1 = e.a1 * Math.PI / 180;
                let sweep = e.a1 - e.a0;
                while (sweep < 0) sweep += 360;
                const x0 = e.cx + e.r * Math.cos(a0), y0 = e.cy + e.r * Math.sin(a0);
                const x1 = e.cx + e.r * Math.cos(a1), y1 = e.cy + e.r * Math.sin(a1);
                out.push(`<path d="M${n(x0)},${n(-y0)} A${n(e.r)},${n(e.r)} 0 ${sweep > 180 ? 1 : 0} 0 ${n(x1)},${n(-y1)}" fill="none" ${stroke(e)}/>`);
                break;
            }
            case 'hatch': {
                const pts = e.pts.map(p => `${n(p[0])},${n(-p[1])}`).join(' ');
                const solid = e.pattern === 'solid';
                out.push(`<polygon points="${pts}" fill="${solid ? printColor(e.color, mono) : pattern(e)}" fill-opacity="${solid ? Math.min(0.35, e.alpha ?? 0.35) : 1}" stroke="none"/>`);
                break;
            }
            case 'text': {
                const anchor = e.align === 'left' ? 'start' : e.align === 'right' ? 'end' : 'middle';
                const base = e.valign === 'top' ? 'hanging' : e.valign === 'middle' ? 'central' : 'alphabetic';
                out.push(`<text x="0" y="0" transform="translate(${n(e.x)},${n(-e.y)}) rotate(${n(-(e.rot || 0))})" fill="${printColor(e.color, mono)}" font-size="${n(e.h)}" font-family="${esc(FONT)}" text-anchor="${anchor}" dominant-baseline="${base}">${esc(e.str)}</text>`);
                break;
            }
        }
    }
    const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
    const bg = opts.background === false ? '' : `<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${opts.background || '#ffffff'}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" preserveAspectRatio="xMidYMid meet" style="background:#fff;max-width:100%;height:auto">${title}${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${bg}${out.join('')}</svg>`;
}

export default drawingToSvg;
