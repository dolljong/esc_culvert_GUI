// rebarHaunch.js - 헌치철근 / 단절점부(우각부) 철근 / 브래킷 철근 데이터와 형상
//
// 데이터:
//   culverts[i].rebar.haunch[bi] = {
//     haunch: { top|bottom: { L|m0|m1..|R: { c1:'D25', c2:'', shape:'V 형'|'X 형' (중간벽만) } } },
//     corner: { layers:[{ use, d:{ TL1,TL2,TR1,TR2,BL1,BL2,BR1,BR2 } } ×3],
//               stirrup:{ TL|TR|BL|BR: { dia, n } },
//               bend:{ use, top:[{use,v}×3], bottom:[{use,v}×3] } }   (v: 절곡부 대각길이, m)
//   }
//   culverts[i].rebar.bracket = { L|R: { dia, c1, c2, sDia, n, S:[], mainN, horz } }
// 좌표는 sectionGeom 단면 좌표 (mm).

import { sectionGeom, haunchSize } from './sectionGeom.js';
import { getSettings, coverOf, devLength, barInfo, barLength, roundBarLen, normDia, getRebarCommon } from './rebar.js';

export const HAUNCH_SHAPES = ['X 형', 'V 형'];

/** 헌치 열 (좌측벽체, 중간벽체n, 우측벽체) */
export function haunchColumns(g) {
    const out = [{ key: 'L', title: '좌측벽체', mid: false }];
    for (const w of g.walls) if (w.kind === 'mid' && w.floor !== 2) out.push({ key: 'm' + w.index, title: `중간벽체${w.index + 1}`, mid: true, index: w.index });
    out.push({ key: 'R', title: '우측벽체', mid: false });
    return out;
}

/** 헌치철근 행 (상부 / 하부) */
export function haunchRows(g) {
    return g.kind === 'U' ? [{ key: 'bottom', title: '하부' }] : [{ key: 'top', title: '상부' }, { key: 'bottom', title: '하부' }];
}

export function defaultHaunchRebar(g) {
    const hh = {};
    for (const r of haunchRows(g)) {
        hh[r.key] = {};
        for (const col of haunchColumns(g)) hh[r.key][col.key] = col.mid ? { c1: 'D25', c2: '', shape: 'V 형' } : { c1: 'D25', c2: '' };
    }
    const d8 = (v) => ({ TL1: v, TL2: v, TR1: v, TR2: v, BL1: v, BL2: v, BR1: v, BR2: v });
    return {
        haunch: hh,
        corner: {
            layers: [{ use: true, d: d8('D19') }, { use: false, d: d8('') }, { use: false, d: d8('') }],
            stirrup: { TL: { dia: 'D25', n: 2 }, TR: { dia: 'D25', n: 2 }, BL: { dia: 'D25', n: 2 }, BR: { dia: 'D25', n: 2 } },
            bend: { use: false, top: [{ use: false, v: 0.4 }, { use: false, v: 0.5 }, { use: false, v: 0.6 }], bottom: [{ use: false, v: 0.4 }, { use: false, v: 0.5 }, { use: false, v: 0.6 }] },
        },
    };
}

export function defaultBracketRebar() {
    const side = () => ({ dia: 'D16', c1: true, c2: false, sDia: 'D16', n: 2, S: [266.863, 320], mainN: 4, horz: false });
    return { L: side(), R: side() };
}

/** 저장값 + 기본값 */
export function getHaunchRebar(c, bi = 0, g) {
    g = g || sectionGeom(c, bi);
    const d = defaultHaunchRebar(g);
    const s = c && c.rebar && c.rebar.haunch && c.rebar.haunch[bi];
    if (!s) return d;
    const out = JSON.parse(JSON.stringify(d));
    for (const r of Object.keys(out.haunch)) for (const k of Object.keys(out.haunch[r])) Object.assign(out.haunch[r][k], (s.haunch && s.haunch[r] && s.haunch[r][k]) || {});
    if (s.corner) out.corner = { ...out.corner, ...s.corner };
    return out;
}

/** 련 cc 의 헌치 설정 {UL,UR,LL,LR} */
function cellHaunch(g, cc) {
    const sec = g.sec;
    if (g.kind === 'DOUBLE') return ((sec.haunch2 || {})[cc.floor === 2 ? 'upper' : 'lower'] || [])[cc.index] || {};
    return (sec.haunch || [])[cc.index] || {};
}

/**
 * 헌치철근 형상.
 * 반환: [{ row, col, corner:'UL'|'UR'|'LL'|'LR', cell, cycle, dia, pts, length, lengthRaw, name, mark }]
 */
export function haunchBarLayout(p, c, bi = 0, cycle = 1, data) {
    const g = sectionGeom(c, bi);
    const st = getSettings(c, bi);
    const cm = getRebarCommon(p);
    data = data || getHaunchRebar(c, bi, g);
    const cols = haunchColumns(g);
    const bars = [];
    const isU = g.kind === 'U';
    const cellsTop = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 2) : g.cells;
    const cellsBot = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
    const midWall = (i, floor) => g.walls.find(w => w.kind === 'mid' && w.index === i && (floor == null || w.floor == null || w.floor === floor));
    const add = (row, col, corner, cc, hc) => {
        const cfg = (data.haunch[row] || {})[col.key];
        if (!cfg) return;
        const dia = cfg['c' + cycle];
        if (!normDia(dia) || !hc || !hc.use) return;
        const { s, w } = haunchSize(hc);
        if (s <= 0 || w <= 0) return;
        const xw = corner[1] === 'L' ? cc.x0 : cc.x1;
        const ys = corner[0] === 'U' ? (isU ? null : cc.y1) : cc.y0;
        if (ys == null) return;
        const sx = corner[1] === 'L' ? 1 : -1, sy = corner[0] === 'U' ? -1 : 1;
        const wallPt = [xw, ys + sy * w], slabPt = [xw + sx * s, ys];
        const L = Math.hypot(s, w);
        const u = [(slabPt[0] - wallPt[0]) / L, (slabPt[1] - wallPt[1]) / L];
        const n = [-sx * w / L, -sy * s / L];      // 콘크리트 쪽 (모서리 방향)
        const cov = row === 'top' ? coverOf(st, 'top', 'L') : coverOf(st, 'bottom', 'U');
        const P0 = [wallPt[0] + n[0] * cov, wallPt[1] + n[1] * cov];
        const P1 = [slabPt[0] + n[0] * cov, slabPt[1] + n[1] * cov];
        const ld = devLength(p, dia, {});
        // 슬래브 쪽 연장: 슬래브 외면 피복까지
        const yLim = row === 'top' ? g.Htot - coverOf(st, 'top', 'U') : coverOf(st, 'bottom', 'L');
        const e1 = Math.max(0, Math.min(ld, Math.abs((yLim - P1[1]) / (u[1] || 1e-9))));
        // 벽 쪽 연장
        let xLim;
        if (!col.mid) xLim = col.key === 'L' ? coverOf(st, 'left', 'O') : g.W - coverOf(st, 'right', 'O');
        else {
            const wl = midWall(col.index, cc.floor);
            if (wl) xLim = cfg.shape === 'X 형' ? (sx > 0 ? wl.x0 + coverOf(st, 'mid:0', 'L') : wl.x1 - coverOf(st, 'mid:0', 'R')) : (wl.x0 + wl.x1) / 2;
            else xLim = xw;
        }
        const e0 = Math.max(0, Math.min(ld, Math.abs((P0[0] - xLim) / (u[0] || 1e-9))));
        const pts = [[P0[0] - u[0] * e0, P0[1] - u[1] * e0], [P1[0] + u[0] * e1, P1[1] + u[1] * e1]];
        const info = barInfo(dia, p);
        const bl = barLength(pts, info.bendR);
        bars.push({ row, col: col.key, corner, cell: cc.index, cycle, dia, pts, lengthRaw: bl.length, length: roundBarLen(bl.length, st.roundLen), shape: cfg.shape || null });
    };
    for (const r of haunchRows(g)) {
        const cells = r.key === 'top' ? cellsTop : cellsBot;
        cells.forEach((cc, i) => {
            const hs = cellHaunch(g, cc);
            const k = r.key === 'top' ? 'U' : 'L';
            const left = i === 0 ? cols[0] : cols.find(cl => cl.key === 'm' + (i - 1));
            const right = i === cells.length - 1 ? cols[cols.length - 1] : cols.find(cl => cl.key === 'm' + i);
            if (left) add(r.key, left, k + 'L', cc, hs[k + 'L']);
            if (right) add(r.key, right, k + 'R', cc, hs[k + 'R']);
        });
    }
    // 기호
    const pre = (cm.marks && cm.marks.haunch) || 'H';
    const seen = new Map();
    let no = 0;
    for (const b of bars) {
        const key = `${normDia(b.dia)}|${Math.round(b.length)}`;
        if (!seen.has(key)) seen.set(key, `${pre}${++no}`);
        b.mark = seen.get(key);
        b.name = b.mark;
    }
    return { g, bars };
}

/**
 * 단절점부(우각부) 철근 형상: 외측 모서리 안쪽의 L 형 (절곡부 입력 시 모따기) 철근.
 * 반환: [{ corner:'TL'|'TR'|'BL'|'BR', layer, cycle, dia, pts, length, mark }]
 */
export function cornerBarLayout(p, c, bi = 0, cycle = 1, data) {
    const g = sectionGeom(c, bi);
    const st = getSettings(c, bi);
    const cm = getRebarCommon(p);
    data = data || getHaunchRebar(c, bi, g);
    const out = [];
    const corners = g.kind === 'U' ? ['BL', 'BR'] : ['TL', 'TR', 'BL', 'BR'];
    (data.corner.layers || []).forEach((ly, li) => {
        if (!ly || !ly.use) return;
        for (const k of corners) {
            const dia = (ly.d || {})[`${k}${cycle}`];
            if (!normDia(dia)) continue;
            const top = k[0] === 'T', left = k[1] === 'L';
            const cS = coverOf(st, top ? 'top' : 'bottom', top ? 'U' : 'L', li + 1) + 60;
            const cW = coverOf(st, left ? 'left' : 'right', 'O', li + 1) + 60;
            const yC = top ? g.Htot - cS : cS, xC = left ? cW : g.W - cW;
            const ld = devLength(p, dia, {});
            const tS = top ? g.UT : g.LT, tW = left ? g.WL : g.WR;
            const legH = tW + ld, legV = tS + ld;
            const sx = left ? 1 : -1, sy = top ? -1 : 1;
            const bend = data.corner.bend || {};
            const bv = bend.use && bend[top ? 'top' : 'bottom'] && bend[top ? 'top' : 'bottom'][li];
            let pts;
            if (bv && bv.use && +bv.v > 0) {
                const a = (+bv.v * 1000) / Math.SQRT2;
                pts = [[xC + sx * legH, yC], [xC + sx * a, yC], [xC, yC + sy * a], [xC, yC + sy * legV]];
            } else pts = [[xC + sx * legH, yC], [xC, yC], [xC, yC + sy * legV]];
            const info = barInfo(dia, p);
            const bl = barLength(pts, info.bendR);
            out.push({ corner: k, layer: li + 1, cycle, dia, pts, lengthRaw: bl.length, length: roundBarLen(bl.length, st.roundLen), bendR: info.bendR });
        }
    });
    const pre = (cm.marks && cm.marks.corner) || 'R';
    const seen = new Map();
    let no = 0;
    for (const b of out) {
        const key = `${normDia(b.dia)}|${Math.round(b.length)}`;
        if (!seen.has(key)) seen.set(key, `${pre}${++no}`);
        b.mark = seen.get(key);
    }
    return { g, bars: out };
}
