// tableDraw.js - 도면용 표 / 노트 상자 / 중제목 (선 + 문자 엔티티)
//
// 좌표 단위는 호출하는 Drawing 의 단위 (도면출력에서는 용지 mm).
//   drawTable(d, x, yTop, cols, rows, opts) → { w, h }
//   drawNoteBox(d, x, yTop, w, title, lines, opts) → { w, h }
//   drawViewTitle(d, cx, yBase, title, scaleText, opts) → 높이
//   shadowBox(d, x, y, w, h, off)      입체 표현 (오른쪽·아래 그림자)

const LINE = { color: 4, layer: 'TABLE' };
const TXT = { color: 7, layer: 'TABLE-TEXT' };

/** 테두리 입체 표현: 오른쪽/아래쪽 채움 띠 (DXF 에서는 SOLID) */
export function shadowBox(d, x, y, w, h, off = 1.6, color = 8) {
    d.pline([[x + w, y - off], [x + w + off, y - off], [x + w + off, y + h - off], [x + w, y + h - off]], { color, layer: 'TABLE-SHADOW', closed: true, fill: color });
    d.pline([[x + off, y - off], [x + w, y - off], [x + w, y], [x + off, y]], { color, layer: 'TABLE-SHADOW', closed: true, fill: color });
}

function fit(str, w, h) {
    const n = String(str).length;
    if (!n) return h;
    // 한글은 폭이 넓다
    let units = 0;
    for (const ch of String(str)) units += ch.charCodeAt(0) > 0x2e80 ? 1.0 : 0.62;
    return Math.max(1, Math.min(h, (w - 1.5) / Math.max(1, units * 0.95)));
}

/**
 * 표.
 * cols: [{ t (머리글), w (폭), align ('left'|'center'|'right') }]
 * rows: [[셀 문자열 ...]] , 행 객체 { cells, color, bold(선 굵게) } 도 허용
 * opts: { rowH (7), headH (rowH*1.4), th (2.5), title, shadow, headColor, lineColor }
 */
export function drawTable(d, x, yTop, cols, rows, opts = {}) {
    const rowH = opts.rowH || 7;
    const headH = opts.headH || rowH * 1.4;
    const th = opts.th || 2.5;
    const W = cols.reduce((s, c) => s + c.w, 0);
    const line = { ...LINE, color: opts.lineColor ?? LINE.color };
    let y = yTop;
    let titleH = 0;
    if (opts.title) {
        titleH = th * 2.6;
        d.text(x + W / 2, y - titleH / 2, opts.title, { color: 6, layer: 'TABLE-TEXT', h: th * 1.3, valign: 'middle' });
        y -= titleH;
    }
    const H = headH + rows.length * rowH;
    if (opts.shadow) shadowBox(d, x, y - H, W, H, Math.max(1, th * 0.6));
    d.rect(x, y - H, W, H, { ...line, width: 2 });
    // 머리글
    let cx = x;
    cols.forEach((c, i) => {
        if (i > 0) d.line(cx, y, cx, y - H, line);
        const lines = String(c.t).split('\n');
        lines.forEach((t, k) => {
            const hh = fit(t, c.w, th * 0.95);
            const yy = y - headH / 2 + (lines.length - 1) * hh * 0.65 - k * hh * 1.3;
            d.text(cx + c.w / 2, yy, t, { color: opts.headColor ?? 2, layer: 'TABLE-TEXT', h: hh, valign: 'middle' });
        });
        cx += c.w;
    });
    d.line(x, y - headH, x + W, y - headH, { ...line, width: 2 });
    // 행
    rows.forEach((r, ri) => {
        const cells = Array.isArray(r) ? r : r.cells;
        const yc = y - headH - ri * rowH - rowH / 2;
        if (ri > 0) d.line(x, y - headH - ri * rowH, x + W, y - headH - ri * rowH, r && r.bold ? { ...line, width: 2 } : line);
        let xx = x;
        cols.forEach((c, ci) => {
            const s = cells[ci];
            if (s != null && s !== '') {
                const al = c.align || 'center';
                const tx = al === 'left' ? xx + 1 : al === 'right' ? xx + c.w - 1 : xx + c.w / 2;
                d.text(tx, yc, s, { ...TXT, color: (r && r.color) ?? TXT.color, h: fit(s, c.w, th), align: al, valign: 'middle' });
            }
            xx += c.w;
        });
    });
    return { w: W, h: H + titleH };
}

/**
 * 노트 상자 (매뉴얼 '노트 사항': 초록 제목 + 번호 문장, 외곽선)
 * opts: { th (2.4), shadow, color (3) }
 */
export function drawNoteBox(d, x, yTop, w, title, lines, opts = {}) {
    const th = opts.th || 2.4;
    const color = opts.color ?? 3;
    const lh = th * 1.7;
    // 줄바꿈 (대략 폭 기준)
    const maxChars = Math.max(10, Math.floor((w - th * 2) / (th * 0.95)));
    const out = [];
    for (const ln of lines) {
        let s = String(ln);
        let first = true;
        while (s.length > maxChars) {
            out.push((first ? '' : '   ') + s.slice(0, maxChars));
            s = s.slice(maxChars);
            first = false;
        }
        out.push((first ? '' : '   ') + s);
    }
    const H = th * 3.2 + out.length * lh + th;
    if (opts.shadow) shadowBox(d, x, yTop - H, w, H, Math.max(1, th * 0.7), color);
    d.rect(x, yTop - H, w, H, { color, layer: 'NOTE', width: 2 });
    d.text(x + th, yTop - th * 1.6, title, { color, layer: 'NOTE', h: th * 1.2, align: 'left', valign: 'middle' });
    d.line(x + th * 0.8, yTop - th * 2.7, x + th * 0.8 + title.length * th * 1.25, yTop - th * 2.7, { color, layer: 'NOTE' });
    out.forEach((s, i) => d.text(x + th, yTop - th * 3.2 - (i + 0.5) * lh, s, { color: 7, layer: 'NOTE', h: th * 0.85, align: 'left', valign: 'middle' }));
    return { w, h: H };
}

/**
 * 중제목 (자홍 제목, 선택적으로 상자) + 초록 축척 문자. yBase = 제목 아래 기준선.
 * opts: { box, shadow, th (4.2) } → 차지하는 높이 반환
 */
export function drawViewTitle(d, cx, yBase, title, scaleText, opts = {}) {
    const th = opts.th || 4.2;
    const sh = th * 0.62;
    const yS = yBase + sh * 0.3;
    if (scaleText) d.text(cx, yS, scaleText, { color: 3, layer: 'TITLE', h: sh, valign: 'bottom' });
    const yT = yBase + (scaleText ? sh * 1.7 : 0) + th * 0.35;
    d.text(cx, yT, title, { color: 6, layer: 'TITLE', h: th, valign: 'bottom' });
    let units = 0;
    for (const ch of title) units += ch.charCodeAt(0) > 0x2e80 ? 1.0 : 0.62;
    const w = units * th * 0.95 + th * 1.6;
    if (opts.box) {
        const bx = cx - w / 2, by = yT - th * 0.3, bh = th * 1.6;
        if (opts.shadow) shadowBox(d, bx, by, w, bh, th * 0.25, 8);
        d.rect(bx, by, w, bh, { color: 6, layer: 'TITLE' });
    } else {
        d.line(cx - w / 2 + th * 0.5, yT - th * 0.25, cx + w / 2 - th * 0.5, yT - th * 0.25, { color: 6, layer: 'TITLE' });
    }
    return yT + th * 1.4 - yBase;
}
