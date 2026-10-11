// barSchedule.js - 철근 제원표 (철근 상세 · 재료표 · 수량 공용)
//
// ── 공개 API ────────────────────────────────────────────────────────────
//   generateRows(p, c, bi)    배근 입력값으로 블록 bi 의 철근 제원을 새로 만든다 (저장값 무시).
//   buildSchedule(p, c, bi)   generateRows + 저장된 표의 '잠금' 행을 보존 ([기본값] 동작).
//   scheduleRows(p, c, bi)    저장된 표(c.rebar.table[bi].rows, 사용자 수정 반영)가 있으면 그것, 없으면 buildSchedule.
//                             모든 행의 length / unitMass / weight 를 다시 계산해 돌려준다.
//   scheduleSummary(p, c)     암거 전체 집계 → { byDia:{ D16:{ count, length(m), net(kg), gross(kg, 할증 포함) } },
//                             total:{ net, gross }, byCat:{ 암거본체:{ net, gross } … }, blocks:[{ bi, rows, net, gross }] }
//   computeRow(p, row)        행의 length(mm) · unitMass(kg/m) · weight(kg, 할증 제외) · weightF(kg, 할증 포함) 계산
//   getWaste(c) / wasteFactor(ws, dia, main)   할증률 설정 (c.rebar.waste)
//
// ── 행 형식 ─────────────────────────────────────────────────────────────
//   { id, cat, lock, desc, mark, dia, dims:{ A,B,C,D,E,R }, lap, lapN, shape, count, factor, vars:{ a,b,c,d }, main,
//     arc?, user? (철근추가 행), length (mm, 이음 포함), unitMass (kg/m), weight (kg, 할증 제외), weightF (kg) }
//   cat: CATS (암거본체 | 암거기타 | 암거상세부 | 보,기둥철근 | 날개벽 | 접속슬래브)
//   형상(shape)과 치수 의미: calc/barShapes.js (SHAPES). 길이 = 형상길이 + lap × lapN, 배근옵션 '철근 길이 반올림' 적용.
//   이음: 형상길이가 배근옵션 '철근 겹이음 적용 길이'(정척, 기본 8 m)를 넘으면 lapN = ceil((L − 정척)/(정척 − 이음장)).
//
// ── 저장 ────────────────────────────────────────────────────────────────
//   culverts[i].rebar.table[bi] = { rows:[...] }      (철근 제원 화면의 [기본값] / 사용자 수정)
//   culverts[i].rebar.waste = { mode:'dia'|'kind', diaLimit:'D19', lo:3, hi:6, main:3, other:6 }   (%)

import { blocks } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import {
    getSettings, getRebarCommon, mainBarLayout, mainMembers, zonesOf, cyclesOf, barInfo, normDia, lapLength, roundBarLen,
    DIAS, diaNum, coverOf, barD,
} from './rebar.js';
import { horzLayout } from './rebarHorz.js';
import { haunchBarLayout, cornerBarLayout } from './rebarHaunch.js';
import { planCounts, blockFrame, zoneSin, longBarLength, planCover } from './rebarPlan.js';
import { shearLayout } from './shearBars.js';
import { columnWalls, getBeamCol, columnBars, girderBars, girderMembers, segPositions } from './beamCol.js';
import { installedWings, wingBlock } from './wingGeom.js';
import { wingBars } from './wingRebar.js';
import { hasApproach, approachBars } from './approachRebar.js';
import { getApproach } from './approachGeom.js';
import { etcBars } from './etcRebar.js';
import { shapeFromPts, shapeLength, hookLen } from './barShapes.js';

export const CATS = ['암거본체', '암거기타', '암거상세부', '보,기둥철근', '날개벽', '접속슬래브'];
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

// ── 할증률 ─────────────────────────────────────────────────────────────

export function defaultWaste() {
    return { mode: 'dia', diaLimit: 'D19', lo: 3, hi: 6, main: 3, other: 6 };
}
export function getWaste(c) {
    return { ...defaultWaste(), ...((c && c.rebar && c.rebar.waste) || {}) };
}
/** 할증 계수 (1.03 등) */
export function wasteFactor(ws, dia, main) {
    const pct = ws.mode === 'kind' ? (main ? ws.main : ws.other) : (diaNum(dia) <= diaNum(ws.diaLimit) ? ws.lo : ws.hi);
    return Math.round((1 + n0(pct) / 100) * 1000) / 1000;
}

// ── 행 계산 ────────────────────────────────────────────────────────────

/** length / unitMass / weight 계산 (행을 고치지 않고 새 객체 반환) */
export function computeRow(p, row, roundMode = 'MM단위 반올림') {
    const b = barInfo(row.dia, p);
    const L0 = shapeLength(row);
    const L = roundBarLen(L0 + n0(row.lap) * n0(row.lapN), roundMode);
    const unitMass = b ? b.mass : 0;
    const weight = L / 1000 * unitMass * n0(row.count);
    const factor = n0(row.factor) || 1;
    return { ...row, length: L, unitMass, weight, weightF: weight * factor };
}

function lapFor(p, st, L, dia) {
    const std = n0(st.lapStdLen) || 8000;
    if (!(L > std)) return { lap: 0, lapN: 0 };
    const lap = lapLength(p, dia, { cls: 'B' });
    return { lap, lapN: Math.ceil((L - std) / Math.max(1000, std - lap)) };
}

/** 내부 행 작성기: 같은 cat+desc+mark 는 개수를 합친다 */
function rowBuilder(p, c, bi) {
    const st = getSettings(c, bi);
    const ws = getWaste(c);
    const rows = [];
    const idx = new Map();
    const marks = new Map();       // prefix|형상키 → mark
    const counter = {};
    const add = (o) => {
        if (!normDia(o.dia) || !(o.count > 0)) return;
        let mark = o.mark;
        if (!mark) {
            const key = `${o.prefix}|${normDia(o.dia)}|${o.shape}|${JSON.stringify(o.dims)}|${JSON.stringify(o.vars || {})}`;
            if (!marks.has(key)) { counter[o.prefix] = (counter[o.prefix] || 0) + 1; marks.set(key, `${o.prefix}${counter[o.prefix]}`); }
            mark = marks.get(key);
        }
        const dims = {};
        for (const [k, v] of Object.entries(o.dims || {})) if (v != null && v !== '') dims[k] = Math.round(+v);
        const L = shapeLength({ ...o, dims });
        const lp = o.lapN != null ? { lap: o.lap || 0, lapN: o.lapN } : lapFor(p, st, L, o.dia);
        const id = `${o.cat}|${o.desc}|${mark}`;
        if (idx.has(id)) { idx.get(id).count += o.count; return; }
        const row = {
            id, cat: o.cat, lock: false, desc: o.desc, mark, dia: o.dia, dims, lap: lp.lap, lapN: lp.lapN,
            shape: o.shape || 1, count: Math.round(o.count), factor: wasteFactor(ws, o.dia, !!o.main), vars: o.vars || {}, main: !!o.main,
            ...(o.arc ? { arc: Math.round(o.arc) } : {}),
            ...(o.pts ? { pts: o.pts } : {}),
        };
        idx.set(id, row);
        rows.push(row);
    };
    return { st, ws, rows, add };
}

// ── 생성 ───────────────────────────────────────────────────────────────

const SLAB = (m) => m === 'top' || m === 'bottom' || m === 'mid';

function bodyRows(p, c, bi, B) {
    const g = sectionGeom(c, bi);
    const st = B.st;
    const cm = getRebarCommon(p);
    const fr = blockFrame(c, bi);
    const counts = planCounts(c, bi);
    const mems = mainMembers(g);
    const memOf = (k) => mems.find(m => m.key === k) || { title: k, faces: [] };
    // 주철근
    for (const z of zonesOf(c, bi, st).filter(z => z.enabled)) {
        const cnt = counts[z.id] || {};
        if (!Object.values(cnt).some(v => v > 0)) continue;
        const lay = mainBarLayout(p, c, bi, { zone: z.id });
        const sn = zoneSin(fr, z.id);
        const suf = z.id === 'start' ? '-1' : z.id === 'end' ? '-2' : '';
        for (const b of lay.bars) {
            const n = cnt[b.cycle] || 0;
            if (!n) continue;
            const pts = SLAB(b.member) && sn < 0.9999 ? b.pts.map(([x, y]) => [x / sn, y]) : b.pts;
            const sh = shapeFromPts(pts, b.bendR);
            const mem = memOf(b.member);
            const fc = mem.faces.find(f => f.key === b.face) || { title: b.face };
            B.add({
                cat: '암거본체', desc: `${mem.title} ${fc.title}${b.layer}단 ${b.cycle}C${z.id !== 'straight' ? ' 사보강' : ''}`,
                mark: b.mark + suf, dia: b.dia, ...sh, count: n, main: true,
            });
        }
    }
    // 수평철근
    const cov = planCover(st);
    const hl = horzLayout(p, c, bi);
    const hPre = cm.marks.horz || 'D';
    for (const F of hl.faces) {
        const mem = memOf(F.member);
        const fc = mem.faces.find(f => f.key === F.face) || { title: F.face };
        const groups = new Map();
        for (const d of F.dots) {
            const L = Math.round(longBarLength(fr, fr.vOfX(d.pt[0]), cov) / 10) * 10;
            groups.set(L, (groups.get(L) || 0) + 1);
        }
        for (const [L, n] of groups) B.add({ cat: '암거본체', desc: `${mem.title} ${fc.title} 수평철근`, prefix: hPre, dia: F.dia, shape: 1, dims: { A: L }, count: n, main: false });
    }
    // 전단철근
    const sl = shearLayout(p, c, bi);
    const sPre = cm.marks.shear || 'S';
    for (const M of sl.members) {
        if (!M.ties.length || !M.cfg.dia) continue;
        B.add({ cat: '암거본체', desc: `${M.title} 전단철근 (${M.cfg.type})`, prefix: sPre, dia: M.cfg.dia, shape: M.shape, dims: M.dims, count: M.ties.length * M.perPos, main: false });
    }
    // 헌치 / 단절점부 (암거상세부)
    const cyc = cyclesOf(st);
    const sumCyc = (k) => Object.values(counts).reduce((a, z) => a + (z[k] || 0) + (z[k + 2] || 0), 0);
    for (const cy of [1, 2]) {
        if (!cyc.includes(cy)) continue;
        const nPos = sumCyc(cy);
        if (!nPos) continue;
        try {
            for (const b of haunchBarLayout(p, c, bi, cy).bars) {
                const sh = shapeFromPts(b.pts, 0);
                B.add({ cat: '암거상세부', desc: `헌치철근 ${b.row === 'top' ? '상부' : '하부'} ${cy}C`, mark: b.mark, dia: b.dia, ...sh, count: nPos, main: false });
            }
        } catch (e) { void e; }
        try {
            for (const b of cornerBarLayout(p, c, bi, cy).bars) {
                const sh = shapeFromPts(b.pts, b.bendR);
                B.add({ cat: '암거상세부', desc: `단절점부철근 ${b.layer}단 ${cy}C`, mark: b.mark, dia: b.dia, ...sh, count: nPos, main: false });
            }
        } catch (e) { void e; }
    }
    // 신축이음 다웰바 (블록 시점 이음)
    const dw = c.dowel;
    if (dw && dw.use && bi > 0 && normDia(dw.dia)) {
        const ctc = n0(dw.ctc) || 300;
        let n = 0;
        if (dw.top !== false && g.kind !== 'U') n += Math.floor((g.W - 160) / ctc) + 1;
        if (dw.wall !== false) n += 2 * (Math.floor(g.H / ctc) + 1);
        B.add({ cat: '암거상세부', desc: '신축이음 다웰바', prefix: 'DW', dia: dw.dia, shape: 1, dims: { A: n0(dw.len) || 1000 }, count: n, main: false });
    }
    return g;
}

function beamColRows(p, c, bi, B, g) {
    const cm = getRebarCommon(p);
    const fr = blockFrame(c, bi);
    const Lg = fr.L0 - 2 * planCover(B.st);
    const pc = cm.marks.column || 'P', pg = cm.marks.beam || 'G';
    for (const cw of columnWalls(c, bi)) {
        const wn = `벽체${cw.index + 1}`;
        const col = getBeamCol(c, bi, cw.index, 'col');
        const topT = g.kind === 'DOUBLE' ? g.MT : g.UT;
        const Lm = cw.H + Math.max(0, topT - 80) + Math.max(0, g.LT - 80);
        const byDia = new Map();
        for (const b of columnBars(cw, col)) byDia.set(b.dia, (byDia.get(b.dia) || 0) + 1);
        for (const [dia, n] of byDia) B.add({ cat: '보,기둥철근', desc: `${wn} 기둥 주철근`, prefix: pc, dia, shape: 1, dims: { A: Math.round(Lm) }, count: n * cw.n, main: true });
        const levels = segPositions(col.hoop.segs, 80).length;
        const dist = n0(col.main.layers[0].dist) || 80;
        const dh = barD(col.hoop.dia);
        if (cw.round) B.add({ cat: '보,기둥철근', desc: `${wn} 기둥 띠철근`, prefix: pc, dia: col.hoop.dia, shape: 12, dims: { A: Math.round(cw.b - 2 * dist + dh) }, count: levels * cw.n, lap: lapLength(p, col.hoop.dia, { compression: true, tie: true }), lapN: 1, main: false });
        else B.add({ cat: '보,기둥철근', desc: `${wn} 기둥 띠철근`, prefix: pc, dia: col.hoop.dia, shape: 11, dims: { A: Math.round(cw.b - 2 * dist + dh), B: Math.round(cw.D - 2 * dist + dh) }, count: levels * cw.n, main: false });
        const tie = col.tie;
        if (tie && normDia(tie.dia) && !cw.round) {
            const hk = hookLen(tie.dia);
            const nv = n0(tie.C1) > 0 ? (tie.B | 0) + 1 : 0, nh = n0(tie.F1) > 0 ? (tie.E | 0) + 1 : 0;
            if (nv) B.add({ cat: '보,기둥철근', desc: `${wn} 기둥 크로스타이`, prefix: pc, dia: tie.dia, shape: 9, dims: { A: Math.round(cw.D - 2 * dist + barD(tie.dia)), B: hk, C: hk }, count: nv * levels * cw.n, main: false });
            if (nh) B.add({ cat: '보,기둥철근', desc: `${wn} 기둥 크로스타이`, prefix: pc, dia: tie.dia, shape: 9, dims: { A: Math.round(cw.b - 2 * dist + barD(tie.dia)), B: hk, C: hk }, count: nh * levels * cw.n, main: false });
        }
        for (const [mem, title] of girderMembers(g).filter(m => m[0] !== 'col')) {
            const gd = getBeamCol(c, bi, cw.index, mem);
            const gb = girderBars(cw, mem, gd);
            const by = new Map();
            for (const b of gb.bars) { const k = `${b.face}|${b.dia}`; by.set(k, (by.get(k) || 0) + 1); }
            for (const [k, n] of by) {
                const [face, dia] = k.split('|');
                B.add({ cat: '보,기둥철근', desc: `${wn} ${title} ${face === 'U' ? '상면' : face === 'L' ? '하면' : '측면'} ${face === 'S' ? '수평철근' : '주철근'}`, prefix: pg, dia, shape: 1, dims: { A: Math.round(Lg) }, count: n, main: face !== 'S' });
            }
            const s = gd.stir || {};
            if (normDia(s.dia)) {
                const nS = segPositions(s.segs, 0, false, Lg).length * Math.max(1, s.legs | 0);
                const ds = barD(s.dia);
                B.add({ cat: '보,기둥철근', desc: `${wn} ${title} 스터럽`, prefix: pg, dia: s.dia, shape: 11, dims: { A: Math.round(gb.bw - 160 + ds), B: Math.round(gb.h - 160 + ds) }, count: nS, main: false });
            }
        }
    }
}

/** 블록 bi 의 철근 제원 (저장값 무시, 새로 생성) */
export function generateRows(p, c, bi = 0) {
    const B = rowBuilder(p, c, bi);
    let g;
    try { g = bodyRows(p, c, bi, B); } catch (e) { console.warn('[barSchedule] 암거본체', e); g = sectionGeom(c, bi); }
    try { for (const o of etcBars(p, c, bi)) B.add({ cat: '암거기타', ...o }); } catch (e) { console.warn('[barSchedule] 기타', e); }
    try { beamColRows(p, c, bi, B, g); } catch (e) { console.warn('[barSchedule] 보기둥', e); }
    try {
        for (const w of installedWings(c)) if (wingBlock(c, w.key) === bi) for (const o of wingBars(p, c, w.key)) B.add({ cat: '날개벽', ...o });
    } catch (e) { console.warn('[barSchedule] 날개벽', e); }
    try {
        if (hasApproach(c)) {
            const nb = blocks(c).length;
            getApproach(c).list.forEach((a, i) => {
                const b = Math.max(0, Math.min(nb - 1, ((a.s && a.s.ref) | 0) - 1));
                if (b === bi) for (const o of approachBars(p, c, i)) B.add({ cat: '접속슬래브', ...o });
            });
        }
    } catch (e) { console.warn('[barSchedule] 접속슬래브', e); }
    const mode = B.st.roundLen;
    return B.rows.map(r => computeRow(p, r, mode));
}

function storedRows(c, bi) {
    const t = c && c.rebar && c.rebar.table && c.rebar.table[bi];
    return t && Array.isArray(t.rows) ? t.rows : null;
}

/** [기본값]: 새로 생성 + 저장된 잠금 행 보존 (같은 id 의 생성 행은 잠금 행으로 대체) */
export function buildSchedule(p, c, bi = 0) {
    const gen = generateRows(p, c, bi);
    const old = storedRows(c, bi) || [];
    const locked = old.filter(r => r.lock);
    if (!locked.length) return gen;
    const lockedIds = new Set(locked.map(r => r.id));
    const out = gen.filter(r => !lockedIds.has(r.id));
    const mode = getSettings(c, bi).roundLen;
    for (const r of locked) {
        // 원래 위치 근처(같은 분류 끝)에 넣는다
        let at = -1;
        for (let i = 0; i < out.length; i++) if (out[i].cat === r.cat) at = i;
        out.splice(at + 1, 0, computeRow(p, r, mode));
    }
    return out;
}

/** 표시/집계용 행 (저장값 우선) */
export function scheduleRows(p, c, bi = 0) {
    const s = storedRows(c, bi);
    if (!s) return buildSchedule(p, c, bi);
    const mode = getSettings(c, bi).roundLen;
    return s.map(r => computeRow(p, r, mode));
}

/** 암거 전체 집계 */
export function scheduleSummary(p, c) {
    const byDia = {}, byCat = {};
    const out = { byDia, byCat, total: { net: 0, gross: 0, count: 0 }, blocks: [] };
    for (const b of blocks(c)) {
        const rows = scheduleRows(p, c, b.index);
        let net = 0, gross = 0;
        for (const r of rows) {
            const k = normDia(r.dia);
            if (!k) continue;
            const e = byDia[k] || (byDia[k] = { count: 0, length: 0, net: 0, gross: 0 });
            e.count += n0(r.count); e.length += r.length / 1000 * n0(r.count); e.net += r.weight; e.gross += r.weightF;
            const ct = byCat[r.cat] || (byCat[r.cat] = { net: 0, gross: 0 });
            ct.net += r.weight; ct.gross += r.weightF;
            net += r.weight; gross += r.weightF;
            out.total.count += n0(r.count);
        }
        out.total.net += net; out.total.gross += gross;
        out.blocks.push({ bi: b.index, rows, net, gross });
    }
    // 직경 순서 정렬
    out.byDia = Object.fromEntries(DIAS.filter(d => byDia[d]).map(d => [d, byDia[d]]));
    return out;
}

/** 빈 사용자 행 (철근추가) */
export function blankRow(cat, ws, dia = 'D16') {
    return {
        id: `user|${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, cat, lock: true, user: true, desc: '추가철근',
        mark: 'X1', dia, dims: { A: 1000 }, lap: 0, lapN: 0, shape: 1, count: 1, factor: wasteFactor(ws, dia, false), vars: {}, main: false,
    };
}

export { coverOf };
