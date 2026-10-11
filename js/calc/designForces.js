// designForces.js - 단면검토 위치와 설계단면력 (구조 계산 > 단면 검토 위치 설정, 매뉴얼 4.8)
//
// c.secCheck = {
//   wallShear: '연단' | '슬래브연단에서 d위치' | '슬래브연단에서 d/2위치',
//   slabShear: '연단' | '벽체 연단에서 d위치' | '벽체 연단에서 d/2위치',
//   custom: { [checkIndex]: { [group]: [col...] } }       사용자 수정/추가 열 (없으면 기본값)
// }
// col = { label, span, s (m, 부재군 시점에서), model: '자동'|'상시'|'지진(기능)'|'지진(붕괴)',
//         faceA: bool, faceB: bool,               모멘트 검토면 (슬래브: A=상면 B=하면, 벽: A=외측 B=내측, 중간벽: A=좌측 B=우측)
//         sV (m), modelV, faceV: 'A'|'B' }
//
// designForces(p, c, k) → { r (analyze 결과), groups: [{ id, label, faces:[nameA,nameB], cols: [{...col, M:{A,B}, Ms:{A,B}, N, V, ...}] }] }

import { analyze } from './frame2d.js';
import { getDesign } from './design.js';

export const WALL_SHEAR_OPTS = ['연단', '슬래브연단에서 d위치', '슬래브연단에서 d/2위치'];
export const SLAB_SHEAR_OPTS = ['연단', '벽체 연단에서 d위치', '벽체 연단에서 d/2위치'];
export const MODEL_OPTS = ['자동', '상시', '지진(기능)', '지진(붕괴)'];

const COVER_D = 0.08;   // 유효깊이 산정용 기본 피복+철근반경 (m) — 배근 입력이 있으면 그 값 사용

export function groupInfo(r, id) {
    const fm = r.model.fm;
    const g = fm.groups.find(x => x.id === id);
    const label = g ? g.label : id;
    const isSlab = g && g.kind === 'slab';
    const faces = isSlab ? ['상면', '하면'] : (id === 'left' || id === 'right') ? ['외측', '내측'] : ['좌측', '우측'];
    return { g, label, isSlab, faces };
}

/** 모멘트 부호 → 인장면 (A 면이 인장이면 'A') */
function tensionFace(id, M) {
    // 슬래브(왼→오): M>0 하면 인장 = B. 좌측벽(아래→위): M>0 = 오른쪽 = 내측 = B. 우측벽: M>0 = 오른쪽 = 외측 = A.
    if (id === 'right') return M > 0 ? 'A' : 'B';
    return M > 0 ? 'B' : 'A';
}

function defaultCols(r, id, d) {
    const fm = r.model.fm;
    const { g, isSlab } = groupInfo(r, id);
    const cols = [];
    const ws = r.model.geom.walls.filter(w => w.floor !== 2);
    if (isSlab) {
        const xs = fm.xs;
        const t = g.t;
        const dd = t - COVER_D;
        const shOff = /d\/2/.test(d.slabShear) ? dd / 2 : /d위치/.test(d.slabShear) ? dd : 0;
        for (let i = 0; i < xs.length - 1; i++) {
            const tl = (ws[i] ? ws[i].t : 0) / 2000, tr = (ws[i + 1] ? ws[i + 1].t : 0) / 2000;
            const fl = xs[i] + tl, fr = xs[i + 1] - tr;
            cols.push({ label: '좌측', span: i, s: fl, model: '자동', faceA: true, faceB: false, sV: fl + shOff, modelV: '자동', faceV: 'A' });
            cols.push({ label: '중앙부', span: i, s: (xs[i] + xs[i + 1]) / 2, model: '자동', faceA: false, faceB: true, sV: (xs[i] + xs[i + 1]) / 2, modelV: '자동', faceV: 'A' });
            cols.push({ label: '우측', span: i, s: fr, model: '자동', faceA: true, faceB: false, sV: fr - shOff, modelV: '자동', faceV: 'A' });
        }
    } else {
        const L = g.L;
        const slabs = fm.groups.filter(x => x.kind === 'slab');
        const bot = slabs.find(x => x.id === 'bottom');
        const top = slabs.find(x => x.id === 'top');
        const fb = (bot ? bot.t / 2 : 0) - g.y0 + g.y0;   // 하부슬래브 상면 (부재군 좌표)
        const ft = top ? L - top.t / 2 : L;
        const dd = g.t - COVER_D;
        const shOff = /d\/2/.test(d.wallShear) ? dd / 2 : /d위치/.test(d.wallShear) ? dd : 0;
        const startFace = id.startsWith('midU') ? (slabs.find(x => x.id === 'middle') || { t: 0 }).t / 2 : fb;
        cols.push({ label: '하단', span: 0, s: startFace, model: '자동', faceA: true, faceB: true, sV: startFace + shOff, modelV: '자동', faceV: 'A' });
        cols.push({ label: '중앙부', span: 0, s: (startFace + ft) / 2, model: '자동', faceA: false, faceB: true, sV: (startFace + ft) / 2, modelV: '자동', faceV: 'A' });
        if (r.model.geom.kind !== 'U' || id.startsWith('mid')) cols.push({ label: '상단', span: 0, s: ft, model: '자동', faceA: true, faceB: true, sV: ft - shOff, modelV: '자동', faceV: 'A' });
    }
    return cols;
}

const KINDS = {
    상시: ['factored', 'factoredEcc'],
    '지진(기능)': ['eqFunction'],
    '지진(붕괴)': ['eqCollapse'],
};

function governing(r, id, s, model) {
    const models = model === '자동' ? Object.keys(KINDS) : [model];
    let best = null;
    for (const m of models) {
        const kinds = KINDS[m].filter(k => r.combos.some(x => x.kind === k));
        if (!kinds.length) continue;
        const e = r.envelope(kinds, id, s);
        if (!isFinite(e.Mmax)) continue;
        const cand = { model: m, e };
        if (!best) best = cand;
        else {
            const sc = (x) => Math.max(Math.abs(x.e.Mmax), Math.abs(x.e.Mmin));
            if (sc(cand) > sc(best)) best = cand;
        }
    }
    return best;
}

function governingV(r, id, s, model) {
    const models = model === '자동' ? Object.keys(KINDS) : [model];
    let best = null;
    for (const m of models) {
        const kinds = KINDS[m].filter(k => r.combos.some(x => x.kind === k));
        if (!kinds.length) continue;
        const e = r.envelope(kinds, id, s);
        const v = Math.abs(e.Vmax) >= Math.abs(e.Vmin) ? e.Vmax : e.Vmin;
        if (!best || Math.abs(v) > Math.abs(best.V)) best = { model: m, V: v, N: Math.abs(e.Vmax) >= Math.abs(e.Vmin) ? e.at.VmaxN : e.at.VminN, at: Math.abs(e.Vmax) >= Math.abs(e.Vmin) ? e.at.Vmax : e.at.Vmin };
    }
    return best;
}

export function getSecCheck(c) {
    return { wallShear: '슬래브연단에서 d위치', slabShear: '벽체 연단에서 d위치', custom: {}, ...(c.secCheck || {}) };
}

export function designForces(p, c, k = 0) {
    const r = analyze(p, c, k);
    const sc = getSecCheck(c);
    const groups = [];
    const order = ['top', 'bottom', 'middle', 'left', 'right'];
    const ids = Object.keys(r.model.groups).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        return (ia < 0 ? 10 : ia) - (ib < 0 ? 10 : ib) || a.localeCompare(b);
    });
    const svc = r.combos.some(x => x.kind === 'service') ? ['service'] : ['factored'];
    for (const id of ids) {
        const info = groupInfo(r, id);
        const custom = sc.custom && sc.custom[k] && sc.custom[k][id];
        const cols = (custom && custom.length ? custom : defaultCols(r, id, sc)).map(col => {
            // 면별로 해석모델(상시/지진) 중 가장 큰 모멘트를 택한다
            const models = (col.model || '자동') === '자동' ? Object.keys(KINDS) : [col.model];
            const M = { A: 0, B: 0 }, Ms = { A: 0, B: 0 }, Nat = { A: 0, B: 0 }, comb = { A: '', B: '' }, modelOf = { A: '-', B: '-' };
            for (const mdl of models) {
                const kinds = KINDS[mdl].filter(k2 => r.combos.some(x => x.kind === k2));
                if (!kinds.length) continue;
                const e = r.envelope(kinds, id, col.s);
                for (const [v, n, nm] of [[e.Mmax, e.at.MmaxN, e.at.Mmax], [e.Mmin, e.at.MminN, e.at.Mmin]]) {
                    if (!isFinite(v) || Math.abs(v) < 1e-9) continue;
                    const f = tensionFace(id, v);
                    if (Math.abs(v) > Math.abs(M[f])) { M[f] = v; Nat[f] = n; comb[f] = nm; modelOf[f] = mdl; }
                }
            }
            const gv = { model: Math.abs(M.A) >= Math.abs(M.B) ? modelOf.A : modelOf.B };
            const es = r.envelope(svc, id, col.s);
            for (const v of [es.Mmax, es.Mmin]) {
                if (!isFinite(v)) continue;
                const f = tensionFace(id, v);
                if (Math.abs(v) > Math.abs(Ms[f])) Ms[f] = v;
            }
            const gV = governingV(r, id, col.sV ?? col.s, col.modelV || '자동');
            return {
                ...col,
                govModel: gv.model, modelOf,
                M, Ms, N: Nat, comb,
                V: gV ? gV.V : 0, NV: gV ? gV.N : 0, combV: gV ? gV.at : '', govModelV: gV ? gV.model : '-',
            };
        });
        groups.push({ id, label: info.label, faces: info.faces, isSlab: info.isSlab, t: info.g ? info.g.t : 0, L: info.g ? info.g.L : 0, cols });
    }
    return { r, groups, sc, design: getDesign(p) };
}
