// foundType.js - 기초형식 데이터 (일반 입력 > 기초 형식) 와 블록별 조회
//
// c.foundType = {
//   slope: 1.0,                    // 버림콘크리트 사면경사 1 : slope
//   rows: [{ type, s:{ref, off}, e:{ref, off}, t, w, rubble, pile }]
// }
// ref = 기준위치 (신축이음 행 번호, 0 = 암거시점), off = 이격거리 (mm, + 선형진행방향)
// 한 구간은 기준위치 s.ref ~ e.ref 사이의 블록들을 덮는다.

import { jointStations, blocks } from '../core/model.js';

export const FOUND_TYPES = ['직접기초', '잡석기초', '말뚝기초'];
export const FOUND_PILE_TYPES = ['타입강관말뚝', '매입강관말뚝', 'PHC말뚝', '현장타설말뚝'];

export function defaultFoundRow(c, s = 0, e = null) {
    const n = (c.joints || []).length;
    const lean = (c.section && c.section.lean) || { t: 100, w: 100 };
    return {
        type: '직접기초',
        s: { ref: s, off: s === 0 ? -100 : 0 },
        e: { ref: e == null ? n - 1 : e, off: (e == null || e === n - 1) ? 100 : 0 },
        t: lean.t ?? 100, w: lean.w ?? 100, rubble: 300, pile: '타입강관말뚝',
    };
}

export function defaultFoundType(c) {
    return { slope: 1.0, rows: [defaultFoundRow(c)] };
}

/** 이음 수 변경 등에 맞춰 구간을 정리 (연속, 0 ~ n-1 을 덮도록) */
export function normalizeFoundType(c, ft) {
    const n = (c.joints || []).length;
    const out = JSON.parse(JSON.stringify(ft || defaultFoundType(c)));
    if (!Array.isArray(out.rows) || !out.rows.length) out.rows = [defaultFoundRow(c)];
    if (out.slope == null) out.slope = 1.0;
    let prev = 0;
    out.rows = out.rows.filter(r => r && r.s && r.e);
    out.rows.forEach((r, i) => {
        r.s.ref = i === 0 ? 0 : prev;
        r.e.ref = Math.max(r.s.ref + 1, Math.min(n - 1, +r.e.ref || 0));
        if (i === out.rows.length - 1) r.e.ref = n - 1;
        prev = r.e.ref;
        if (!FOUND_TYPES.includes(r.type)) r.type = '직접기초';
        if (!r.pile) r.pile = '타입강관말뚝';
    });
    out.rows = out.rows.filter((r, i) => i === 0 || r.s.ref < n - 1);
    return out;
}

export function getFoundType(c) {
    return normalizeFoundType(c, c.foundType);
}

/** 블록 bi 를 덮는 구간 행 (index 포함) */
export function foundRowOfBlock(c, bi) {
    const ft = getFoundType(c);
    const k = ft.rows.findIndex(r => bi >= r.s.ref && bi < r.e.ref);
    const i = k < 0 ? ft.rows.length - 1 : k;
    return { ...ft.rows[i], index: i };
}

export function isPileBlock(c, bi) {
    return foundRowOfBlock(c, bi).type === '말뚝기초';
}

export function blockPileType(c, bi) {
    const r = foundRowOfBlock(c, bi);
    return r.type === '말뚝기초' ? r.pile || '타입강관말뚝' : null;
}

/** 구간 시·종점 Station (m) */
export function foundRowRange(c, row) {
    const st = jointStations(c);
    const s = (st[row.s.ref] ?? st[0]) + (+row.s.off || 0) / 1000;
    const e = (st[row.e.ref] ?? st[st.length - 1]) + (+row.e.off || 0) / 1000;
    return { s, e, L: e - s };
}

/** 블록 index 목록 */
export function blocksOfRow(c, row) {
    return blocks(c).filter(b => b.index >= row.s.ref && b.index < row.e.ref).map(b => b.index);
}
