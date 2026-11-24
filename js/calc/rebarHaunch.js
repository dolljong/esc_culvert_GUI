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
/** 헌치철근 양 끝 꺾임 길이 (만나는 주철근 방향으로, mm) */
export const HAUNCH_HOOK = 100;

const isColumn = (w) => w.type === '사각기둥' || w.type === '원형기둥';

/** 꼭짓점 v 에서 a·c 방향 사이 내각 (°, 정수) */
function bendAngle(a, v, c) {
    const p = [a[0] - v[0], a[1] - v[1]], q = [c[0] - v[0], c[1] - v[1]];
    const den = Math.hypot(p[0], p[1]) * Math.hypot(q[0], q[1]) || 1;
    return Math.round(Math.acos(Math.max(-1, Math.min(1, (p[0] * q[0] + p[1] * q[1]) / den))) * 180 / Math.PI);
}

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
 * 양 끝은 만나는 주철근 방향으로 HAUNCH_HOOK(100) 만큼 꺾는다 (슬래브 끝 수평, 벽 끝 수직).
 * 반환: [{ row, col, corner:'UL'|'UR'|'LL'|'LR'|'UM'|'LM', cell, cycle, dia, pts, anchor, length, lengthRaw, name, mark }]
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
    // 기둥 좌우 헌치 깊이 중 큰 값 (sectionDraw 의 기둥-헌치 경계선과 같은 높이)
    const colHaunchDepth = (row, i, floor) => {
        const cs = row === 'top' ? cellsTop : cellsBot;
        const k = row === 'top' ? 'U' : 'L';
        const hl = cellHaunch(g, cs[i] || {})[k + 'R'], hr = cellHaunch(g, cs[i + 1] || {})[k + 'L'];
        const dep = (hc) => (hc && hc.use ? haunchSize(hc).w : 0);
        return Math.max(dep(hl), dep(hr));
    };
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
        // 헌치면과 평행하게 양쪽으로 연장해 만나는 주철근 선에서 끝낸다 (정착길이로 자르지 않음).
        // 슬래브 쪽: 슬래브 외면 주철근 선까지
        const yLim = row === 'top' ? g.Htot - coverOf(st, 'top', 'U') : coverOf(st, 'bottom', 'L');
        const e1 = Math.max(0, Math.abs((yLim - P1[1]) / (u[1] || 1e-9)));
        // 벽 쪽: 외측벽 외측 주철근 선 / 중간벽(상·하부 모두)은 벽을 가로질러 반대면 수직철근 선까지
        let xLim, join = false;
        if (!col.mid) xLim = col.key === 'L' ? coverOf(st, 'left', 'O') : g.W - coverOf(st, 'right', 'O');
        else {
            const wl = midWall(col.index, cc.floor);
            // 기둥: 좌우 헌치철근을 기둥 중심에서 이어 한 개의 철근으로 (아래에서 합친다)
            join = !!wl && isColumn(wl);
            const cross = !join;
            if (wl) xLim = cross ? (sx > 0 ? wl.x0 + coverOf(st, 'mid:0', 'L') : wl.x1 - coverOf(st, 'mid:0', 'R')) : (wl.x0 + wl.x1) / 2;
            else xLim = xw;
        }
        let pts;
        if (join) {
            // 기둥: 기둥측 헌치 끝 수평선(좌우 헌치 깊이 중 큰 값)에서 피복만큼 슬래브 쪽 높이까지 → 아래에서 수평부로 잇는다
            const yH = ys + sy * (colHaunchDepth(row, col.index, cc.floor) - cov);
            const e = (yH - P0[1]) / (u[1] || 1e-9);
            pts = [[P0[0] + u[0] * e, yH], [P1[0] + u[0] * e1, P1[1] + u[1] * e1]];
        } else {
            const e0 = Math.max(0, Math.abs((P0[0] - xLim) / (u[0] || 1e-9)));
            pts = [[P0[0] - u[0] * e0, P0[1] - u[1] * e0], [P1[0] + u[0] * e1, P1[1] + u[1] * e1]];
        }
        // 끝 꺾임 방향 (진행 방향 쪽으로 만나는 주철근과 평행): 슬래브 끝 → 수평, 벽 끝 → 수직. 기둥 연결부는 꺾지 않는다.
        const hookE = [Math.sign(u[0]) || sx, 0];
        const hookS = join ? null : [0, Math.sign(-u[1]) || -sy];
        bars.push({ row, col: col.key, corner, cell: cc.index, cycle, dia, pts, hookS, hookE, shape: join ? null : col.mid ? 'X 형' : null, join });
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
    // 기둥 좌우 헌치철근 연결: 왼쪽 련의 우측 모서리 철근 + 오른쪽 련의 좌측 모서리 철근 → 한 개
    for (let i = 0; i < bars.length; i++) {
        const a = bars[i];
        if (!a || !a.join || a.corner[1] !== 'R') continue;
        const j = bars.findIndex(b => b && b !== a && b.join && b.row === a.row && b.col === a.col && b.corner[1] === 'L');
        if (j < 0) continue;
        const b = bars[j];
        const pts = [a.pts[1], a.pts[0]];
        if (Math.hypot(b.pts[0][0] - a.pts[0][0], b.pts[0][1] - a.pts[0][1]) > 1) pts.push(b.pts[0]);
        pts.push(b.pts[1]);
        bars[i] = { ...a, corner: a.corner[0] + 'M', pts, hookS: a.hookE, hookE: b.hookE };
        bars[j] = null;
    }
    for (let i = bars.length - 1; i >= 0; i--) if (!bars[i]) bars.splice(i, 1);
    // 양 끝 꺾임 추가 + 길이
    for (const b of bars) {
        const mid = Math.floor((b.pts.length - 1) / 2);
        b.anchor = [(b.pts[mid][0] + b.pts[mid + 1][0]) / 2, (b.pts[mid][1] + b.pts[mid + 1][1]) / 2];   // 기호 위치 (경사부 중앙)
        const P = b.pts.slice();
        if (b.hookS) { const q = P[0]; P.unshift([q[0] + b.hookS[0] * HAUNCH_HOOK, q[1] + b.hookS[1] * HAUNCH_HOOK]); }
        if (b.hookE) { const q = P[P.length - 1]; P.push([q[0] + b.hookE[0] * HAUNCH_HOOK, q[1] + b.hookE[1] * HAUNCH_HOOK]); }
        b.pts = P;
        const bl = barLength(P, 0)   // 재료표(shapeFromPts(pts, 0))와 같은 직선 합 길이;
        b.lengthRaw = bl.length;
        b.length = roundBarLen(bl.length, st.roundLen);
        // 꺾임 내각 (°): 경사부와 끝 꺾임 사이. 끝 꺾임이 만나는 주철근과 나란히 놓여 결속되는 각도.
        b.angles = P.length === 4 ? [bendAngle(P[0], P[1], P[2]), bendAngle(P[1], P[2], P[3])] : null;
    }
    // 기호
    const pre = (cm.marks && cm.marks.haunch) || 'H';
    const seen = new Map();
    let no = 0;
    for (const b of bars) {
        const key = `${normDia(b.dia)}|${Math.round(b.length)}|${b.angles ? b.angles.join(',') : b.pts.length}`;
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
