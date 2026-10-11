// dxfWriter.js - Drawing → DXF (AutoCAD R12 / AC1009)
//
// R12 형식은 핸들·객체 테이블 없이도 AutoCAD 등 대부분의 CAD 에서 열린다.
// 한글은 \U+XXXX 유니코드 이스케이프로 기록한다 (코드페이지와 무관하게 표시됨).
// 치수선은 화면과 동일하게 선/화살표/문자로 분해해서 기록한다.

const LTYPES = {
    CONTINUOUS: { desc: 'Solid line', pattern: [] },
    CENTER: { desc: 'Center ____ _ ____', pattern: [31.75, -6.35, 6.35, -6.35] },
    HIDDEN: { desc: 'Hidden __ __ __', pattern: [6.35, -3.175] },
    DASHED: { desc: 'Dashed __ __', pattern: [12.7, -6.35] },
    DOT: { desc: 'Dot . . .', pattern: [0, -6.35] },
    PHANTOM: { desc: 'Phantom', pattern: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
};
const DASH_TO_LTYPE = { center: 'CENTER', hidden: 'HIDDEN', dash: 'DASHED', dot: 'DOT', phantom: 'PHANTOM' };

function encText(s) {
    let out = '';
    for (const ch of String(s)) {
        const c = ch.codePointAt(0);
        out += c < 128 ? ch : '\\U+' + c.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
}

const f = (v) => (Math.round(v * 10000) / 10000).toString();

export function drawingToDxf(drawing, opts = {}) {
    const lines = [];
    const w = (code, val) => { lines.push(String(code)); lines.push(String(val)); };
    const ltScale = opts.ltScale || Math.max(1, drawing.textHeight / 10);

    const layers = new Map();
    for (const e of drawing.entities) {
        if (!layers.has(e.layer || '0')) layers.set(e.layer || '0', typeof e.color === 'number' ? e.color : 7);
    }
    if (!layers.has('0')) layers.set('0', 7);

    const bb = drawing.bbox() || { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };

    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSBASE'); w(10, 0); w(20, 0); w(30, 0);
    w(9, '$EXTMIN'); w(10, f(bb.minX)); w(20, f(bb.minY)); w(30, 0);
    w(9, '$EXTMAX'); w(10, f(bb.maxX)); w(20, f(bb.maxY)); w(30, 0);
    w(9, '$LTSCALE'); w(40, f(ltScale));
    w(9, '$DWGCODEPAGE'); w(3, 'ANSI_949');
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, Object.keys(LTYPES).length);
    for (const [name, lt] of Object.entries(LTYPES)) {
        w(0, 'LTYPE'); w(2, name); w(70, 0); w(3, lt.desc); w(72, 65);
        w(73, lt.pattern.length);
        w(40, f(lt.pattern.reduce((a, b) => a + Math.abs(b), 0)));
        for (const p of lt.pattern) w(49, f(p));
    }
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, layers.size);
    for (const [name, color] of layers) {
        w(0, 'LAYER'); w(2, name); w(70, 0); w(62, color); w(6, 'CONTINUOUS');
    }
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'STYLE'); w(70, 1);
    w(0, 'STYLE'); w(2, 'STANDARD'); w(70, 0); w(40, 0); w(41, 0.8); w(50, 0); w(71, 0); w(42, 2.5); w(3, 'txt'); w(4, 'whgtxt');
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'ENTITIES');
    const common = (e) => {
        w(8, e.layer || '0');
        if (e.dash && DASH_TO_LTYPE[e.dash]) w(6, DASH_TO_LTYPE[e.dash]);
        if (typeof e.color === 'number') w(62, e.color);
    };
    for (const e of drawing.entities) {
        switch (e.type) {
            case 'line':
                w(0, 'LINE'); common(e);
                w(10, f(e.x1)); w(20, f(e.y1)); w(30, 0);
                w(11, f(e.x2)); w(21, f(e.y2)); w(31, 0);
                break;
            case 'pline':
                if (e.fill != null && e.pts.length >= 3 && e.pts.length <= 4) {
                    // 채움 삼각형/사각형(화살표 등)은 SOLID
                    const p = e.pts;
                    const q = p.length === 3 ? [p[0], p[1], p[2], p[2]] : [p[0], p[1], p[3], p[2]];
                    w(0, 'SOLID'); common(e);
                    q.forEach((pt, i) => { w(10 + i, f(pt[0])); w(20 + i, f(pt[1])); w(30 + i, 0); });
                    break;
                }
                w(0, 'POLYLINE'); common(e); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, e.closed ? 1 : 0);
                for (const p of e.pts) { w(0, 'VERTEX'); w(8, e.layer || '0'); w(10, f(p[0])); w(20, f(p[1])); w(30, 0); }
                w(0, 'SEQEND'); w(8, e.layer || '0');
                break;
            case 'circle':
                w(0, 'CIRCLE'); common(e); w(10, f(e.cx)); w(20, f(e.cy)); w(30, 0); w(40, f(e.r));
                break;
            case 'arc':
                w(0, 'ARC'); common(e); w(10, f(e.cx)); w(20, f(e.cy)); w(30, 0); w(40, f(e.r)); w(50, f(e.a0)); w(51, f(e.a1));
                break;
            case 'hatch':
                if (e.pattern === 'solid') break;   // 반투명 채움은 화면 전용
                w(0, 'POLYLINE'); w(8, 'HATCH'); w(62, typeof e.color === 'number' ? e.color : 8); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 1);
                for (const p of e.pts) { w(0, 'VERTEX'); w(8, 'HATCH'); w(10, f(p[0])); w(20, f(p[1])); w(30, 0); }
                w(0, 'SEQEND'); w(8, 'HATCH');
                break;
            case 'text': {
                const hj = e.align === 'left' ? 0 : e.align === 'right' ? 2 : 1;
                const vj = e.valign === 'top' ? 3 : e.valign === 'middle' ? 2 : 1;
                w(0, 'TEXT'); common(e);
                w(10, f(e.x)); w(20, f(e.y)); w(30, 0);
                w(40, f(e.h)); w(1, encText(e.str));
                if (e.rot) w(50, f(e.rot));
                w(41, 0.8); w(7, 'STANDARD');
                w(72, hj); w(73, vj);
                w(11, f(e.x)); w(21, f(e.y)); w(31, 0);
                break;
            }
        }
    }
    w(0, 'ENDSEC');
    w(0, 'EOF');
    return lines.join('\r\n') + '\r\n';
}

export function downloadText(content, filename, mime = 'application/octet-stream') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveDrawingAsDxf(drawing, filename) {
    downloadText(drawingToDxf(drawing), filename, 'application/dxf');
}
