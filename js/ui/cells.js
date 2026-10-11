// cells.js - 그리드 셀 ↔ 프로젝트 데이터 바인딩 헬퍼
//
//   num('culverts.0.section.H', { field: 'H', dec: 0 })
//   sel(path, ['연속벽체', '사각기둥', '원형기둥'])
//   chk(path) / txt(path) / lbl(값 또는 함수)

import store from '../core/store.js';

export function num(path, o = {}) {
    return {
        type: 'num',
        get: () => {
            const v = store.get(path);
            return o.scale ? (v == null ? v : v / o.scale) : v;
        },
        set: (v) => store.set(path, o.scale && v != null ? v * o.scale : v),
        ...o,
    };
}

export function txt(path, o = {}) {
    return { type: 'text', get: () => store.get(path) ?? '', set: (v) => store.set(path, v), ...o };
}

export function sel(path, options, o = {}) {
    return { type: 'select', options, get: () => store.get(path), set: (v) => store.set(path, coerce(v, options)), ...o };
}

export function chk(path, o = {}) {
    return { type: 'check', get: () => !!store.get(path), set: (v) => store.set(path, !!v), ...o };
}

/** 계산값/고정문자 (편집 불가) */
export function lbl(value, o = {}) {
    return { type: 'label', get: typeof value === 'function' ? value : () => value, ...o };
}

/** 비활성 셀 ('-' 표시) */
export const dash = (o = {}) => ({ type: 'label', get: () => null, disabled: true, ...o });

export function btn(text, onClick, o = {}) {
    return { type: 'button', text, onClick, ...o };
}

/** 사용자 함수로 읽고 쓰는 셀 */
export function custom(type, get, set, o = {}) {
    return { type, get, set, ...o };
}

// 선택지 값의 타입(숫자/문자) 유지
function coerce(v, options) {
    const first = options && options[0];
    const sample = first && typeof first === 'object' ? first.value : first;
    if (typeof sample === 'number') {
        const n = Number(v);
        return isFinite(n) ? n : v;
    }
    return v;
}
