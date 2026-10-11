// drawing.js - CAD 엔티티 목록
//
// 화면(입력결과 확인창)과 DXF 출력이 같은 엔티티 목록을 공유한다.
// 좌표는 실제 치수(mm), y축은 위쪽이 + 이다 (CAD와 동일).
//
// 색상은 AutoCAD 색상번호(ACI)를 그대로 쓴다. 화면은 검은 바탕이다.
//   1 빨강  2 노랑  3 초록  4 하늘(cyan)  5 파랑  6 자홍  7 흰색  8 회색  9 밝은회색

export const ACI = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#3f6fff',
    6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0',
    10: '#ff7f7f', 30: '#ff7f00', 40: '#ffbf00', 50: '#bfbf00', 140: '#7fbfff',
    150: '#3f9fff', 171: '#5f7fbf', 253: '#adadad', 254: '#d6d6d6',
};

export const COLOR = {
    RED: 1, YELLOW: 2, GREEN: 3, CYAN: 4, BLUE: 5, MAGENTA: 6, WHITE: 7, GRAY: 8, LIGHTGRAY: 9,
    ORANGE: 30, SKY: 140,
};

export function aciToCss(c) {
    if (typeof c === 'string') return c;
    return ACI[c] || '#ffffff';
}

const DEFAULT_STYLE = { color: 7, layer: '0', dash: null };

// 문자 기본 높이: 도면 크기에 맞춰 화면별로 정한다 (drawing.textHeight)
export class Drawing {
    constructor(opts = {}) {
        this.entities = [];
        this.textHeight = opts.textHeight || 250;   // mm (도면 단위)
        this.style = { ...DEFAULT_STYLE };
        this.title = opts.title || '';
    }

    /** 이후 엔티티의 기본 스타일 (color / layer / dash) */
    setStyle(st) { this.style = { ...this.style, ...st }; return this; }

    _push(e, st) {
        const s = { ...this.style, ...(st || {}) };
        e.color = s.color; e.layer = s.layer; e.dash = s.dash || null;
        if (s.width) e.width = s.width;
        if (s.field) e.field = s.field;
        if (s.tip) e.tip = s.tip;
        this.entities.push(e);
        return e;
    }

    line(x1, y1, x2, y2, st) { return this._push({ type: 'line', x1, y1, x2, y2 }, st); }

    /** pts: [[x,y],...] */
    pline(pts, st = {}) {
        if (!pts || pts.length < 2) return null;
        return this._push({ type: 'pline', pts: pts.map(p => [p[0], p[1]]), closed: !!st.closed, fill: st.fill || null }, st);
    }

    rect(x, y, w, h, st = {}) {
        return this.pline([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { ...st, closed: true });
    }

    circle(cx, cy, r, st = {}) { return this._push({ type: 'circle', cx, cy, r, fill: st.fill || null }, st); }

    /** a0,a1: 도(degree), 반시계방향 */
    arc(cx, cy, r, a0, a1, st) { return this._push({ type: 'arc', cx, cy, r, a0, a1 }, st); }

    /**
     * 문자. opt: h(높이), align('left'|'center'|'right'), valign('bottom'|'middle'|'top'),
     * rot(도), color, field(클릭 시 입력셀로 이동할 변수명)
     */
    text(x, y, str, opt = {}) {
        return this._push({
            type: 'text', x, y, str: String(str),
            h: opt.h || this.textHeight,
            align: opt.align || 'center',
            valign: opt.valign || 'bottom',
            rot: opt.rot || 0,
        }, opt);
    }

    /** 채움(해치). pattern: 'solid' | 'ansi31' | 'earth' | 'dots' */
    hatch(pts, st = {}) {
        return this._push({ type: 'hatch', pts: pts.map(p => [p[0], p[1]]), pattern: st.pattern || 'ansi31', alpha: st.alpha ?? 0.35, spacing: st.spacing || null }, st);
    }

    // ── 치수선 ──────────────────────────────────────────────────────────
    // 매뉴얼 화면처럼 치수선 + 보조선 + 화살표(또는 틱) + 숫자.
    // 화면/DXF가 같은 분해 방식을 쓰므로 모양이 항상 일치한다.

    /**
     * 수평 치수. x1~x2 구간, 측정점 높이 yRef 에서 치수선 높이 yDim 으로 보조선.
     * text 를 생략하면 길이(정수 mm)를 쓴다.
     */
    dimH(x1, x2, yRef, yDim, text, st = {}) {
        const len = Math.abs(x2 - x1);
        if (len < 1e-6) return;
        const s = { color: 1, layer: 'DIM', ...st };
        const ts = { ...s, color: st.textColor ?? 3 };
        const h = st.h || this.textHeight * 0.8;
        const ext = Math.sign(yDim - yRef) || 1;
        const gap = h * 0.4;
        this.line(x1, yRef + ext * gap, x1, yDim + ext * gap, s);
        this.line(x2, yRef + ext * gap, x2, yDim + ext * gap, s);
        this.line(x1, yDim, x2, yDim, s);
        this._ticks(x1, yDim, x2, yDim, h, s);
        const label = text != null ? text : fmtLen(len);
        this.text((x1 + x2) / 2, yDim + h * 0.35, label, { ...ts, h, align: 'center', valign: 'bottom' });
        if (st.name) this.varLabel((x1 + x2) / 2, yDim - h * 0.35, st.name, { h: h * 0.85, valign: 'top' });
    }

    /** 수직 치수 (문자는 치수선 왼쪽에 세워 쓴다) */
    dimV(y1, y2, xRef, xDim, text, st = {}) {
        const len = Math.abs(y2 - y1);
        if (len < 1e-6) return;
        const s = { color: 1, layer: 'DIM', ...st };
        const ts = { ...s, color: st.textColor ?? 3 };
        const h = st.h || this.textHeight * 0.8;
        const ext = Math.sign(xDim - xRef) || 1;
        const gap = h * 0.4;
        this.line(xRef + ext * gap, y1, xDim + ext * gap, y1, s);
        this.line(xRef + ext * gap, y2, xDim + ext * gap, y2, s);
        this.line(xDim, y1, xDim, y2, s);
        this._ticks(xDim, y1, xDim, y2, h, s);
        const label = text != null ? text : fmtLen(len);
        this.text(xDim - h * 0.35, (y1 + y2) / 2, label, { ...ts, h, align: 'center', valign: 'bottom', rot: 90 });
        if (st.name) this.varLabel(xDim + h * 0.35, (y1 + y2) / 2, st.name, { h: h * 0.85, valign: 'top', rot: 90 });
    }

    /** 정렬 치수 (두 점 사이, offset 만큼 왼쪽 법선방향) */
    dimA(p1, p2, offset, text, st = {}) {
        const s = { color: 1, layer: 'DIM', ...st };
        const h = st.h || this.textHeight * 0.8;
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) return;
        const nx = -dy / L, ny = dx / L;
        const a = [p1[0] + nx * offset, p1[1] + ny * offset];
        const b = [p2[0] + nx * offset, p2[1] + ny * offset];
        this.line(p1[0], p1[1], a[0] + nx * h * 0.4 * Math.sign(offset), a[1] + ny * h * 0.4 * Math.sign(offset), s);
        this.line(p2[0], p2[1], b[0] + nx * h * 0.4 * Math.sign(offset), b[1] + ny * h * 0.4 * Math.sign(offset), s);
        this.line(a[0], a[1], b[0], b[1], s);
        this._ticks(a[0], a[1], b[0], b[1], h, s);
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        const label = text != null ? text : fmtLen(L);
        this.text((a[0] + b[0]) / 2 + nx * h * 0.35, (a[1] + b[1]) / 2 + ny * h * 0.35, label, { ...s, color: st.textColor ?? 3, h, rot: ang });
    }

    /** 연속 수평치수: xs = [x0, x1, ...] */
    dimChainH(xs, yRef, yDim, texts, st) {
        for (let i = 0; i < xs.length - 1; i++) this.dimH(xs[i], xs[i + 1], yRef, yDim, texts ? texts[i] : undefined, st);
    }
    dimChainV(ys, xRef, xDim, texts, st) {
        for (let i = 0; i < ys.length - 1; i++) this.dimV(ys[i], ys[i + 1], xRef, xDim, texts ? texts[i] : undefined, st);
    }

    _ticks(x1, y1, x2, y2, h, s) {
        // 화살표 (채움 삼각형)
        const L = Math.hypot(x2 - x1, y2 - y1);
        if (L < 1e-6) return;
        const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
        const a = Math.min(h * 0.6, L / 3), w = a * 0.3;
        const tri = (px, py, dx, dy) => this.pline([
            [px, py], [px + dx * a - dy * w, py + dy * a + dx * w], [px + dx * a + dy * w, py + dy * a - dx * w]
        ], { ...s, closed: true, fill: s.color });
        tri(x1, y1, ux, uy);
        tri(x2, y2, -ux, -uy);
    }

    /** 지시선 + 문자 */
    leader(pts, str, st = {}) {
        const s = { color: 2, layer: 'TEXT', ...st };
        this.pline(pts, s);
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2] || last;
        const right = last[0] >= prev[0];
        this.text(last[0] + (right ? 1 : -1) * this.textHeight * 0.3, last[1], str, { ...s, align: right ? 'left' : 'right', valign: 'middle', h: st.h });
    }

    /** 변수명 표시 (클릭하면 해당 입력셀로 이동) */
    varLabel(x, y, name, opt = {}) {
        return this.text(x, y, name, { color: 2, layer: 'VAR', field: name, ...opt });
    }

    /** 원형 번호 (철근기호, 절점번호 등) */
    bubble(x, y, str, opt = {}) {
        const r = opt.r || this.textHeight * 0.7;
        this.circle(x, y, r, { color: opt.color ?? 2, layer: opt.layer || 'MARK' });
        this.text(x, y, str, { color: opt.textColor ?? opt.color ?? 2, h: r * 1.0, valign: 'middle', layer: opt.layer || 'MARK' });
    }

    /**
     * EL 표시: 빨간 ▽(위) 또는 ▲ 삼각형 + 초록 'EL. x.xxx'
     * opt.down=true 이면 ▲ 를 아래에서 위로. opt.align 'left'|'right'
     */
    elMark(x, y, el, opt = {}) {
        const h = opt.h || this.textHeight * 0.8;
        const t = h * 0.6;
        const dir = opt.down ? -1 : 1;
        const s = { color: 1, layer: 'DIM' };
        // 기호 끝점과 수평선이 모두 y (해당 EL 높이)에 오도록
        this.pline([[x, y], [x - t * 0.6, y + dir * t], [x + t * 0.6, y + dir * t]], { ...s, closed: true });
        const sx = opt.align === 'right' ? -1 : 1;
        this.line(x, y, x + sx * h * 5, y, s);
        this.text(x + sx * t * 0.9, y + dir * h * 0.25, `EL. ${Number(el).toFixed(3)}`, { color: 3, layer: 'DIM', h, align: opt.align === 'right' ? 'right' : 'left', valign: opt.down ? 'top' : 'bottom' });
    }

    /** 지시선이 붙은 두 줄 문자 (예: 암거시점 / STA. 0K+010.0) */
    tag(x, y, line1, line2, opt = {}) {
        const h = opt.h || this.textHeight * 0.8;
        const L = opt.len || h * 3;
        const dir = opt.down ? -1 : 1;
        this.line(x, y, x, y + dir * L, { color: 1, layer: 'DIM' });
        const yy = y + dir * L;
        if (line1) this.text(x, yy + (dir > 0 ? h * 1.4 : -h * 0.2), line1, { color: opt.color ?? 3, h, valign: dir > 0 ? 'bottom' : 'top', layer: 'TEXT' });
        if (line2) this.text(x, yy + (dir > 0 ? h * 0.2 : -h * 1.4), line2, { color: opt.color ?? 3, h, valign: dir > 0 ? 'bottom' : 'top', layer: 'TEXT' });
    }

    /** 경계상자 */
    bbox() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const add = (x, y) => {
            if (!isFinite(x) || !isFinite(y)) return;
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        };
        for (const e of this.entities) {
            switch (e.type) {
                case 'line': add(e.x1, e.y1); add(e.x2, e.y2); break;
                case 'pline': case 'hatch': e.pts.forEach(p => add(p[0], p[1])); break;
                case 'circle': case 'arc': add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
                case 'text': {
                    const w = e.str.length * e.h * 0.9;
                    add(e.x - w / 2, e.y - e.h); add(e.x + w / 2, e.y + e.h);
                    break;
                }
            }
        }
        if (minX === Infinity) return null;
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }

    /** 다른 도면을 이동/축척하여 합친다 (도면출력 시트 구성용) */
    merge(other, dx = 0, dy = 0, scale = 1) {
        const T = (x, y) => [x * scale + dx, y * scale + dy];
        for (const e of other.entities) {
            const c = { ...e };
            switch (e.type) {
                case 'line': [c.x1, c.y1] = T(e.x1, e.y1); [c.x2, c.y2] = T(e.x2, e.y2); break;
                case 'pline': case 'hatch': c.pts = e.pts.map(p => T(p[0], p[1])); break;
                case 'circle': case 'arc': [c.cx, c.cy] = T(e.cx, e.cy); c.r = e.r * scale; break;
                case 'text': [c.x, c.y] = T(e.x, e.y); c.h = e.h * scale; break;
            }
            this.entities.push(c);
        }
    }
}

export function fmtLen(v) {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? r.toLocaleString('en-US') : r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtNum(v, d = 0) {
    if (v == null || !isFinite(v)) return '-';
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default Drawing;
