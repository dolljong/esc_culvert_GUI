// rebarForces.js - 배근 화면용 부재력 조회 (2D Frame 해석 결과가 있을 때만)
//
// js/calc/frame2d.js 의 analyze(p, c, checkIndex) → { envelope(group, x, opts) } 계약을 동적 import 로 사용한다.
// 모듈이 없거나 해석이 실패하면 null 을 돌려주고, 화면은 안내문만 표시한다.
// envelope 반환 형식이 확정되지 않았으므로 숫자 / {M,V} / {Mmax,Mmin,Vmax,Vmin} / {max:{M,V},min:{M,V}} 를 모두 받는다.

import { sectionGeom, frameAxes } from './sectionGeom.js';

let frameMod = null;
let status = 'idle';          // idle | loading | ready | missing
const waiters = new Set();
const cache = new Map();

/** frame2d.js 를 불러온다. 준비되면 onReady() 호출 (이미 준비됐으면 바로 'ready') */
export function loadFrame(onReady) {
    if (status === 'ready' || status === 'missing') return status;
    if (onReady) waiters.add(onReady);
    if (status === 'idle') {
        status = 'loading';
        import('./frame2d.js')
            .then(m => { frameMod = m && typeof m.analyze === 'function' ? m : null; status = frameMod ? 'ready' : 'missing'; })
            .catch(() => { status = 'missing'; })
            .finally(() => { const ws = [...waiters]; waiters.clear(); ws.forEach(f => { try { f(status); } catch (e) { console.error(e); } }); });
    }
    return status;
}
export const frameStatus = () => status;

function analysis(p, c, bi) {
    if (!frameMod) return null;
    let key;
    try { key = JSON.stringify([bi, c.section, c.blockSections && c.blockSections[bi], p.design, c.loadDef, c.loadComb, c.analysis, c.checks]); } catch { key = String(Math.random()); }
    const k = `${p.culverts.indexOf(c)}|${key}`;
    if (cache.has(k)) return cache.get(k);
    let res = null;
    try { res = frameMod.analyze(p, c, 0, { block: bi }); } catch (e) { console.warn('[rebarForces] analyze 실패', e); res = null; }
    if (cache.size > 20) cache.clear();
    cache.set(k, res);
    return res;
}

function pick(v, which) {
    // which: 'M' | 'V' → 절대값이 큰 쪽 (부호 유지)
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const cands = [];
    const push = (x) => { if (typeof x === 'number' && isFinite(x)) cands.push(x); };
    push(v[which]);
    push(v[which + 'max']); push(v[which + 'min']);
    push(v[which + 'Max']); push(v[which + 'Min']);
    if (v.max) push(typeof v.max === 'number' ? v.max : v.max[which]);
    if (v.min) push(typeof v.min === 'number' ? v.min : v.min[which]);
    if (!cands.length) return null;
    return cands.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
}

function envAt(res, group, x, which, state) {
    if (!res || typeof res.envelope !== 'function') return null;
    const v = res.envelope(group, x, { state, seismic: state === '지진시', kind: state === '지진시' ? 'eq' : 'normal' });
    return pick(v, which);
}

/** 부재군 길이 (m) */
function groupLength(g, group) {
    const ax = frameAxes(g);
    if (group === 'top' || group === 'bottom' || group === 'mid') return (ax.xs[ax.xs.length - 1] - ax.xs[0]) / 1000;
    return (ax.yTop - ax.yBot) / 1000;
}

/**
 * 부재력도 데이터. opts: { state: '평상시'|'지진시', diag: 'BMD'|'SFD', groups }
 * 반환: [{ group, pts:[[x(m), value]] }] | null
 */
export function memberForces(p, c, bi, opts = {}) {
    if (status !== 'ready') return null;
    const res = analysis(p, c, bi);
    if (!res) return null;
    const g = sectionGeom(c, bi);
    const which = opts.diag === 'SFD' ? 'V' : 'M';
    const groups = opts.groups || ['top', 'bottom', 'left', 'right', ...g.walls.filter(w => w.kind === 'mid' && w.floor !== 2).map(w => `mid:${w.index}`), ...(g.kind === 'DOUBLE' ? ['mid'] : [])];
    const out = [];
    for (const grp of groups) {
        if (g.kind === 'U' && grp === 'top') continue;
        const L = groupLength(g, grp);
        const pts = [];
        const n = 24;
        for (let i = 0; i <= n; i++) {
            const x = L * i / n;
            let v = null;
            try { v = envAt(res, grp, x, which, opts.state); } catch { v = null; }
            if (v != null) pts.push([x, v]);
        }
        if (pts.length > 1) out.push({ group: grp, pts });
    }
    return out.length ? out : null;
}

/** 검토위치의 계수모멘트 |Mu| (kN·m) 또는 null. pos = checkPositions 항목 */
export function momentAt(p, c, bi, pos, state = '평상시') {
    if (status !== 'ready') return null;
    const res = analysis(p, c, bi);
    if (!res) return null;
    try {
        const v = envAt(res, pos.group, pos.x, 'M', state);
        return v == null ? null : Math.abs(v);
    } catch { return null; }
}
