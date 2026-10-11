// ground.js - 지반정보 (일반입력 > 지반 정보) 데이터와 조회
//
// c.ground = {
//   use: { 토사, 풍화암, 연암, 경암, 지하수위 },   // 적용사항 설정
//   layers: { 토사: { sta, el, segs:[{len, el, N, use}] }, ... }
// }
// 각 층은 시점(sta, el)에서 시작해 구간별 길이(len)만큼 진행하며 끝점 EL 을 가진다.
// 구간 i 의 N 값과 사용여부는 그 구간 전체에 적용된다.

import { jointStations } from '../core/model.js';

export const LAYERS = ['토사', '풍화암', '연암', '경암', '지하수위'];
export const LAYER_STYLE = {
    토사: { color: 6, dash: null },          // 자홍
    풍화암: { color: 1, dash: 'dash' },      // 빨강 파선
    연암: { color: 30, dash: 'dash' },       // 주황 파선
    경암: { color: 5, dash: 'dash' },        // 파랑 파선
    지하수위: { color: 3, dash: null },      // 초록
};

export function defaultGround(c) {
    const st = jointStations(c);
    const sta0 = st[0] ?? 0;
    const lens = [];
    for (let i = 1; i < st.length; i++) lens.push(+(st[i] - st[i - 1]).toFixed(6));
    const mk = (el, N, single = false) => ({
        sta: sta0, el,
        segs: single ? [{ len: lens.reduce((a, b) => a + b, 0), el, N: null, use: true }] : lens.map(len => ({ len, el, N, use: true })),
    });
    return {
        use: { 토사: true, 풍화암: true, 연암: false, 경암: false, 지하수위: true },
        layers: {
            토사: mk(7.5, 15),
            풍화암: mk(0.0, 50),
            연암: mk(-3.0, 50),
            경암: mk(-6.0, 50),
            지하수위: mk(6.5, null, true),
        },
    };
}

export function getGround(c) {
    return c.ground || defaultGround(c);
}

/** 층의 꺾인점 [{sta, el}] */
export function layerPoints(layer) {
    if (!layer) return [];
    const pts = [{ sta: +layer.sta || 0, el: +layer.el || 0 }];
    let s = +layer.sta || 0;
    for (const sg of layer.segs || []) {
        s += +sg.len || 0;
        pts.push({ sta: s, el: +sg.el || 0, N: sg.N, use: sg.use !== false });
    }
    return pts;
}

/** sta 위치의 층 상단 EL / N 값 (구간 사용 안 함이면 null) */
export function layerAt(c, name, sta) {
    const gr = getGround(c);
    if (!gr.use[name]) return null;
    const pts = layerPoints(gr.layers[name]);
    if (pts.length < 2) return pts.length ? { el: pts[0].el, N: null } : null;
    for (let i = 1; i < pts.length; i++) {
        if (sta <= pts[i].sta + 1e-9 || i === pts.length - 1) {
            const a = pts[i - 1], b = pts[i];
            if (!b.use) return null;
            const t = Math.max(0, Math.min(1, (sta - a.sta) / ((b.sta - a.sta) || 1)));
            return { el: a.el + (b.el - a.el) * t, N: b.N };
        }
    }
    return null;
}

/** sta 위치의 지층 주상도 (위에서 아래로) [{name, top, N}] */
export function boringAt(c, sta) {
    const out = [];
    for (const name of ['토사', '풍화암', '연암', '경암']) {
        const r = layerAt(c, name, sta);
        if (r) out.push({ name, top: r.el, N: r.N });
    }
    out.sort((a, b) => b.top - a.top);
    const gw = layerAt(c, '지하수위', sta);
    return { layers: out, gwl: gw ? gw.el : null, groundEl: out.length ? out[0].top : null };
}
