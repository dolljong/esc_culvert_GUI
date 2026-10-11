// frameDraw.js - 2D 골조 모델 / 부재력도(BMD·SFD·AFD) / 변위 / 반력 / 하중재하도
//
// 모델 좌표 m → 도면 mm. 부재력도는 인장측에 그린다 (모멘트 + = 국부 -y 쪽).

import { Drawing, COLOR } from '../cad/drawing.js';

const K = 1000;

function fmt(v, dig = 3) {
    if (!isFinite(v)) return '-';
    const a = Math.abs(v);
    const dec = a >= 1000 ? 1 : a >= 100 ? 2 : dig;
    return (+v.toFixed(dec)).toString();
}

export function newFrameDrawing(model) {
    let maxX = 0, maxY = 0;
    for (const n of model.nodes) { maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    return new Drawing({ textHeight: Math.max(maxX, maxY) * K / 55 });
}

/** 단면 외곽 (회색) — 모델 좌표에 맞춰 (원점 = 좌측벽 중심 × 하부슬래브 중심) */
export function drawOutline(d, model) {
    const g = model.geom;
    const fm = model.fm;
    const ox = -fm.x0mm, oy = -fm.yBmm;
    const T = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);
    d.pline(T(g.outer), { color: COLOR.GRAY, closed: true, layer: 'OUTLINE' });
    if (g.kind !== 'U') for (const cl of g.cells) d.pline(T(cl.poly), { color: COLOR.GRAY, closed: true, layer: 'OUTLINE' });
    if (g.antiFloat) { d.pline(T(g.antiFloat.left), { color: COLOR.GRAY, layer: 'OUTLINE' }); d.pline(T(g.antiFloat.right), { color: COLOR.GRAY, layer: 'OUTLINE' }); }
}

/** 부재·절점·스프링·번호 */
export function drawModel(d, model, opts = {}) {
    const th = d.textHeight;
    model.members.forEach((m, k) => {
        const a = model.nodes[m.i], b = model.nodes[m.j];
        d.line(a.x * K, a.y * K, b.x * K, b.y * K, { color: COLOR.GREEN, layer: 'FRAME' });
        if (opts.memNo) d.text((a.x + b.x) / 2 * K, (a.y + b.y) / 2 * K + th * 0.2, String(k + 1), { color: COLOR.SKY, h: th * 0.55, layer: 'NO' });
    });
    model.nodes.forEach((n, k) => {
        d.circle(n.x * K, n.y * K, th * 0.12, { color: COLOR.GREEN, fill: COLOR.GREEN, layer: 'FRAME' });
        if (opts.nodeNo) d.text(n.x * K + th * 0.25, n.y * K + th * 0.25, String(k + 1), { color: COLOR.YELLOW, h: th * 0.5, align: 'left', layer: 'NO' });
    });
    if (opts.restraint !== false) {
        for (const s of model.springs) {
            if (s.stab) continue;
            const n = model.nodes[s.node];
            const x = n.x * K, y = n.y * K, L = th * 1.1;
            if (s.dir === 'y') {
                const pts = [[x, y]];
                for (let k = 1; k <= 6; k++) pts.push([x + (k % 2 ? 1 : -1) * th * 0.18, y - L * k / 7]);
                pts.push([x, y - L]);
                d.pline(pts, { color: s.compressionOnly ? COLOR.MAGENTA : COLOR.SKY, layer: 'SPRING' });
                d.line(x - th * 0.25, y - L, x + th * 0.25, y - L, { color: COLOR.SKY, layer: 'SPRING' });
            } else if (s.wall) {
                const dir = s.wall === 'left' ? -1 : 1;
                const pts = [[x, y]];
                for (let k = 1; k <= 6; k++) pts.push([x + dir * L * k / 7, y + (k % 2 ? 1 : -1) * th * 0.18]);
                pts.push([x + dir * L, y]);
                d.pline(pts, { color: COLOR.SKY, layer: 'SPRING' });
            }
        }
        for (const s of model.supports || []) {
            const n = model.nodes[s.node];
            const x = n.x * K, y = n.y * K, t = th * 0.4;
            d.pline([[x, y], [x - t, y - t * 1.4], [x + t, y - t * 1.4]], { color: COLOR.SKY, closed: true, layer: 'SPRING' });
        }
    }
}

/**
 * 부재력도. comp: 'M' | 'V' | 'N'
 * getF(memberIndex, x) → {N,V,M}  (여러 조합 포락은 getF 를 두 번 호출해 max/min 각각)
 * opts: { scale, color, values, maxAbs(공통 최대값) }
 */
export function drawDiagram(d, model, getF, comp = 'M', opts = {}) {
    const th = d.textHeight;
    const size = Math.max(...model.nodes.map(n => n.x), ...model.nodes.map(n => n.y)) * K;
    let maxAbs = opts.maxAbs || 0;
    const samples = model.members.map((m, mi) => {
        const a = model.nodes[m.i], b = model.nodes[m.j];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const n = 4;
        const pts = [];
        for (let k = 0; k <= n; k++) {
            const x = L * k / n;
            const f = getF(mi, x);
            const v = comp === 'M' ? f.M : comp === 'V' ? f.V : f.N;
            pts.push({ x, v });
            if (!opts.maxAbs) maxAbs = Math.max(maxAbs, Math.abs(v));
        }
        return { m, a, b, L, pts };
    });
    if (maxAbs < 1e-9) return { maxAbs: 0 };
    const k = (opts.scale || 1) * size * 0.12 / maxAbs;
    const color = opts.color ?? COLOR.CYAN;
    // 부호: M 은 인장측 (국부 -y), V·N 은 국부 +y
    const sgn = comp === 'M' ? -1 : 1;
    const labelled = [];
    for (const s of samples) {
        const c = (s.b.x - s.a.x) / s.L, sn = (s.b.y - s.a.y) / s.L;
        const nx = -sn, ny = c;
        const base = (x) => [(s.a.x + c * x) * K, (s.a.y + sn * x) * K];
        const tip = s.pts.map(p => {
            const [bx, by] = base(p.x);
            return [bx + sgn * p.v * k * nx, by + sgn * p.v * k * ny];
        });
        d.pline(tip, { color, layer: 'DIAGRAM' });
        // 해치선
        s.pts.forEach((p, i) => {
            const [bx, by] = base(p.x);
            if (Math.abs(p.v) * k > th * 0.05) d.line(bx, by, tip[i][0], tip[i][1], { color, layer: 'DIAGRAM' });
        });
        labelled.push({ s, tip, base });
    }
    if (opts.values) {
        // 부재군 끝과 극값에 값 표시
        const byGroup = {};
        samples.forEach((s, i) => { (byGroup[s.m.group] = byGroup[s.m.group] || []).push(i); });
        for (const ids of Object.values(byGroup)) {
            const all = [];
            ids.forEach(i => samples[i].pts.forEach((p, j) => all.push({ i, j, v: p.v })));
            const pick = new Set([`${ids[0]},0`, `${ids[ids.length - 1]},${samples[ids[ids.length - 1]].pts.length - 1}`]);
            const mx = all.reduce((a, b) => (b.v > a.v ? b : a), all[0]);
            const mn = all.reduce((a, b) => (b.v < a.v ? b : a), all[0]);
            pick.add(`${mx.i},${mx.j}`); pick.add(`${mn.i},${mn.j}`);
            // 벽체 연결부(벽 위치) 값
            for (const key of pick) {
                const [i, j] = key.split(',').map(Number);
                const L = labelled[i];
                const v = samples[i].pts[j].v;
                if (Math.abs(v) < maxAbs * 0.01) continue;
                const [x, y] = L.tip[j];
                const vertical = Math.abs(samples[i].b.x - samples[i].a.x) < 1e-9;
                d.text(x, y + (vertical ? 0 : th * 0.2 * Math.sign(sgn * v || 1)), fmt(v), { color: opts.textColor ?? color, h: th * 0.55, rot: vertical ? 90 : 0, valign: 'middle', layer: 'VALUE' });
            }
        }
    }
    return { maxAbs };
}

/** 변위도 */
export function drawDisplacement(d, model, res, opts = {}) {
    const size = Math.max(...model.nodes.map(n => n.x), ...model.nodes.map(n => n.y)) * K;
    let mx = 0;
    model.nodes.forEach((n, i) => { mx = Math.max(mx, Math.hypot(res.u[i * 3], res.u[i * 3 + 1])); });
    if (mx < 1e-15) return;
    const k = (opts.scale || 1) * size * 0.08 / mx;
    model.members.forEach(m => {
        const a = model.nodes[m.i], b = model.nodes[m.j];
        d.line((a.x * K) + res.u[m.i * 3] * k, a.y * K + res.u[m.i * 3 + 1] * k, b.x * K + res.u[m.j * 3] * k, b.y * K + res.u[m.j * 3 + 1] * k, { color: COLOR.YELLOW, layer: 'DISP' });
    });
    d.legend = `최대변위 ${(mx * 1000).toFixed(3)} mm`;
}

/** 지반반력 (스프링력) */
export function drawReactions(d, model, res) {
    const th = d.textHeight;
    let mx = 0;
    res.springForces.forEach((f, k) => { if (model.springs[k].dir === 'y' && !model.springs[k].stab) mx = Math.max(mx, Math.abs(f)); });
    if (mx < 1e-9) return;
    const size = Math.max(...model.nodes.map(n => n.x)) * K;
    const k = size * 0.12 / mx;
    model.springs.forEach((s, i) => {
        if (s.dir !== 'y' || s.stab) return;
        const n = model.nodes[s.node];
        const f = res.springForces[i];
        const q = f / (s.trib || 1);
        const x = n.x * K, y = n.y * K;
        d.line(x, y, x, y - f * k, { color: COLOR.MAGENTA, layer: 'REACT' });
        d.text(x, y - f * k - th * 0.3, (+q.toFixed(1)).toString(), { color: COLOR.MAGENTA, h: th * 0.45, rot: 90, align: 'right', valign: 'middle', layer: 'REACT' });
    });
    d.legend = '지반반력 (kN/m²)';
}

/** 하중재하도 (loads.js 케이스) */
export function drawLoadCase(d, model, lc, solverLoad) {
    const th = d.textHeight;
    const size = Math.max(...model.nodes.map(n => n.x), ...model.nodes.map(n => n.y)) * K;
    let mx = 0;
    for (const q of solverLoad.dist) mx = Math.max(mx, Math.abs(q.w1), Math.abs(q.w2));
    const k = mx > 0 ? size * 0.1 / mx : 0;
    for (const q of solverLoad.dist) {
        const m = model.members[q.member];
        const a = model.nodes[m.i], b = model.nodes[m.j];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const c = (b.x - a.x) / L, s = (b.y - a.y) / L;
        const P = (x) => [(a.x + c * x) * K, (a.y + s * x) * K];
        const dirv = q.dir === 'gx' ? [1, 0] : q.dir === 'gy' ? [0, 1] : q.dir === 'lx' ? [c, s] : [-s, c];
        const p1 = P(q.a ?? 0), p2 = P(q.b ?? L);
        const t1 = [p1[0] - dirv[0] * q.w1 * k, p1[1] - dirv[1] * q.w1 * k];
        const t2 = [p2[0] - dirv[0] * q.w2 * k, p2[1] - dirv[1] * q.w2 * k];
        d.pline([p1, t1, t2, p2], { color: COLOR.RED, layer: 'LOAD' });
        for (const t of [0, 0.5, 1]) {
            const bx = p1[0] + (p2[0] - p1[0]) * t, by = p1[1] + (p2[1] - p1[1]) * t;
            const w = q.w1 + (q.w2 - q.w1) * t;
            if (Math.abs(w) * k < th * 0.2) continue;
            const tx = bx - dirv[0] * w * k, ty = by - dirv[1] * w * k;
            d.line(tx, ty, bx, by, { color: COLOR.RED, layer: 'LOAD' });
            const ah = th * 0.3 * Math.sign(w);
            d.line(bx, by, bx - dirv[0] * ah - dirv[1] * ah * 0.5, by - dirv[1] * ah + dirv[0] * ah * 0.5, { color: COLOR.RED, layer: 'LOAD' });
            d.line(bx, by, bx - dirv[0] * ah + dirv[1] * ah * 0.5, by - dirv[1] * ah - dirv[0] * ah * 0.5, { color: COLOR.RED, layer: 'LOAD' });
        }
    }
    for (const q of solverLoad.point) {
        const m = model.members[q.member];
        const a = model.nodes[m.i], b = model.nodes[m.j];
        const L = Math.hypot(b.x - a.x, b.y - a.y);
        const x = (a.x + (b.x - a.x) * q.pos / L) * K, y = (a.y + (b.y - a.y) * q.pos / L) * K;
        const dirv = q.dir === 'gx' ? [1, 0] : [0, 1];
        const len = th * 2;
        d.line(x - dirv[0] * Math.sign(q.P) * len, y - dirv[1] * Math.sign(q.P) * len, x, y, { color: COLOR.YELLOW, layer: 'LOAD' });
        d.text(x - dirv[0] * Math.sign(q.P) * len, y - dirv[1] * Math.sign(q.P) * len - th * 0.2, (+Math.abs(q.P).toFixed(2)).toString(), { color: COLOR.YELLOW, h: th * 0.5, valign: 'top', layer: 'LOAD' });
    }
    d.legend = `${lc.name} (${lc.key})  최대 ${(+mx.toFixed(3))} kN/m`;
}

export { fmt };
