// 구조 계산 > 하중 조합 (옹벽) (매뉴얼 4.5)
// 옹벽식 날개벽이 있을 때만 사용. 탭: 설계하중선택 / 계수하중조합 / 사용하중조합
// 데이터: culverts[i].wallComb = { sel: '<벽 key>', walls: { [key]: { use:{D,L,H,E}, factored:[...], service:[...] } } }
//   row = { name, f: { D, L, H, E }, found: bool(기초 검토시), wall: bool(벽체 검토시) }

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { txt, chk, lbl, custom } from '../ui/cells.js';
import { h, button } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';

const ITEMS = [['D', '고정하중'], ['L', '활하중'], ['H', '토압'], ['E', '지진하중']];
const POS_LABEL = { SL: '시점부(좌)', SR: '시점부(우)', EL: '종점부(좌)', ER: '종점부(우)' };
const selRow = {};

/**
 * 옹벽식 날개벽 목록 [{ key, label }] — c.wings 형식이 정해지지 않았으므로 방어적으로 읽는다.
 *   c.wings.pos 가 배열이면 [{type|kind|form, name|pos}] , 객체면 { key: '옹벽식' | {type} }
 */
export function retainingWings(c) {
    const pos = c && c.wings && c.wings.pos;
    if (!pos) return [];
    const isWall = (v) => (typeof v === 'string' ? v : (v && (v.type || v.kind || v.form || v.wingType)) || '').includes('옹벽식');
    const out = [];
    if (Array.isArray(pos)) {
        pos.forEach((v, i) => { if (isWall(v)) out.push({ key: (v && (v.key || v.pos || v.name)) || `W${i + 1}`, label: `${(v && (v.label || v.name || POS_LABEL[v.pos] || v.pos)) || '날개벽 ' + (i + 1)}-옹벽식` }); });
    } else if (typeof pos === 'object') {
        for (const [k, v] of Object.entries(pos)) if (isWall(v)) out.push({ key: k, label: `${(v && v.label) || POS_LABEL[k] || k}-옹벽식` });
    }
    return out;
}

const R = (name, D, L, H, E) => { const f = {}; if (D) f.D = D; if (L) f.L = L; if (H) f.H = H; if (E) f.E = E; return { name, f, found: true, wall: true }; };

export function defaultWallComb() {
    return {
        use: { D: true, L: true, H: true, E: true },
        factored: [R('LC 01', 1.2, 0, 1.6, 0), R('LC 02', 1.2, 1.6, 1.6, 0), R('LC 03', 0.9, 0, 1.6, 1.0)],
        service: [R('LC 01', 1.0, 0, 1.0, 0), R('LC 02', 1.0, 1.0, 1.0, 0), R('LC 03', 0.9, 0, 1.6, 1.0)],
    };
}

/** 계산용: 옹벽 key 의 조합 (저장값 또는 기본값) */
export function getWallComb(c, key) {
    const wc = c.wallComb && c.wallComb.walls && c.wallComb.walls[key];
    return wc || defaultWallComb();
}

function ensure(ctx) {
    const walls = retainingWings(ctx.c);
    if (!walls.length) return null;
    const wc = clone(ctx.c.wallComb || { sel: walls[0].key, walls: {} });
    let changed = !ctx.c.wallComb;
    if (!walls.some(w => w.key === wc.sel)) { wc.sel = walls[0].key; changed = true; }
    for (const w of walls) if (!wc.walls[w.key]) { wc.walls[w.key] = defaultWallComb(); changed = true; }
    if (changed) store.set(`${ctx.cp}.wallComb`, wc, { record: false, silent: true });
    return { walls, wc: store.get(`${ctx.cp}.wallComb`) };
}

export default {
    scope: 'culvert',
    enabled: (ctx) => !!(ctx.c && retainingWings(ctx.c).length),
    hint: '옹벽식 날개벽의 안정검토 및 단면검토용 하중조합을 설정합니다.',
    tabs: () => [{ id: 'sel', title: '설계하중선택' }, { id: 'factored', title: '계수하중조합' }, { id: 'service', title: '사용하중조합' }],

    header(el, ctx) {
        const st = ensure(ctx);
        if (!st) return;
        const s = h('select', {}, st.walls.map(w => h('option', { value: w.key, selected: w.key === st.wc.sel }, w.label)));
        s.addEventListener('change', () => store.set(`${ctx.cp}.wallComb.sel`, s.value, { record: false }));
        el.appendChild(s);
    },

    render(el, ctx, tab) {
        const st = ensure(ctx);
        if (!st) { el.appendChild(h('div', { class: 'note' }, '옹벽식 날개벽이 없습니다. [상세입력 > 날개벽 위치] 에서 옹벽식 날개벽을 지정하십시오.')); return; }
        const wp = `${ctx.cp}.wallComb.walls.${st.wc.sel}`;
        const w = st.wc.walls[st.wc.sel];
        if (tab === 'sel') {
            new Grid(el, {
                id: 'lcw-sel',
                head: [[{ t: '구 분' }, { t: '설정값' }]],
                rows: ITEMS.map(([k, n]) => ({ head: [{ t: n }], cells: [chk(`${wp}.use.${k}`)] })),
                colWidths: [120, 70],
            });
            return;
        }
        const cols = ITEMS.filter(([k]) => w.use[k] !== false);
        const tp = `${wp}.${tab}`;
        new Grid(el, {
            id: `lcw-${tab}`,
            onSelect: (c, r) => { selRow[tab] = r; },
            head: [[{ t: '구분' }, ...cols.map(([, n]) => ({ t: n })), { t: '기초 검토시' }, { t: '벽체 검토시' }]],
            rows: (w[tab] || []).map((r, i) => ({
                cells: [
                    txt(`${tp}.${i}.name`),
                    ...cols.map(([k, n]) => custom('num', () => (store.get(`${tp}.${i}.f`) || {})[k] || null, (v) => {
                        const f = clone(store.get(`${tp}.${i}.f`) || {});
                        if (v == null || !+v) delete f[k]; else f[k] = +v;
                        store.set(`${tp}.${i}.f`, f);
                    }, { dec: 2, allowEmpty: true, hint: `${n} 하중계수 (빈칸 = 제외)` })),
                    chk(`${tp}.${i}.found`, { hint: '기초(안정) 검토에 사용' }),
                    chk(`${tp}.${i}.wall`, { hint: '벽체 단면검토에 사용' }),
                ],
            })),
            colWidths: [70, ...cols.map(() => 70), 80, 80],
        });
    },

    footer(el, ctx, tab) {
        const st = ensure(ctx);
        const dis = !st || tab === 'sel';
        el.appendChild(button('모든 옹벽 동일적용', () => {
            const s = ensure(ctx);
            if (!s) return;
            const src = s.wc.walls[s.wc.sel];
            const walls = clone(s.wc.walls);
            for (const k of Object.keys(walls)) walls[k] = clone(src);
            store.set(`${ctx.cp}.wallComb.walls`, walls);
        }, { disabled: !st }));
        el.appendChild(button('조합 추가', () => {
            const s = ensure(ctx);
            const tp = `${ctx.cp}.wallComb.walls.${s.wc.sel}.${tab}`;
            const rows = clone(store.get(tp) || []);
            rows.splice(Math.min(selRow[tab] ?? rows.length - 1, rows.length - 1) + 1, 0, { name: `LC ${String(rows.length + 1).padStart(2, '0')}`, f: {}, found: true, wall: true });
            store.set(tp, rows);
        }, { disabled: dis }));
        el.appendChild(button('조합 삭제', () => {
            const s = ensure(ctx);
            const tp = `${ctx.cp}.wallComb.walls.${s.wc.sel}.${tab}`;
            const rows = clone(store.get(tp) || []);
            if (!rows.length) return;
            rows.splice(Math.min(selRow[tab] ?? rows.length - 1, rows.length - 1), 1);
            store.set(tp, rows);
        }, { disabled: dis }));
    },

    defaults(ctx, tab) {
        const st = ensure(ctx);
        if (!st) return;
        const def = defaultWallComb();
        const wp = `${ctx.cp}.wallComb.walls.${st.wc.sel}`;
        if (tab === 'sel') store.set(`${wp}.use`, def.use);
        else store.set(`${wp}.${tab}`, def[tab]);
    },

    draw(ctx) {
        const d = new Drawing({ textHeight: 300 });
        if (!retainingWings(ctx.c).length) d.text(0, 0, '옹벽식 날개벽 없음', { color: COLOR.GRAY });
        return d;
    },
};
