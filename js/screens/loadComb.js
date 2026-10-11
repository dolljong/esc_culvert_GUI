// 구조 계산 > 하중 조합 (매뉴얼 4.3)
// 탭: 설계항목선택 / 계수하중 / 계수하중(최대편심) / 사용하중 / 지진하중(붕괴) / 지진하중(기능)
// 데이터: culverts[i].loadComb — 형식과 하중케이스 확장 규칙은 js/calc/combos.js

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { txt, chk, lbl, custom } from '../ui/cells.js';
import { h, button, bCheck, modal, alertBox, confirmBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { getDesign, seisKinds } from '../calc/design.js';
import { defaultLoadComb, defaultTables, getLoadComb, COMBO_KINDS, BASE_ITEMS, comboTable } from '../calc/combos.js';
import { sectionKind } from '../core/model.js';

const sel = { items: 0 };
const selRow = {};

function tabsOf(ctx) {
    const d = getDesign(ctx.p);
    const kind = sectionKind(ctx.c, ctx.bi) === 'U' ? 'U' : 'BOX';
    const sk = seisKinds(d, kind);
    return [
        { id: 'items', title: '설계항목선택' },
        ...COMBO_KINDS.map(k => ({ id: k.id, title: k.title, disabled: (k.id === 'eqCollapse' || k.id === 'eqFunction') && !sk.includes(k.id) })),
    ];
}

function ensure(ctx) {
    const lc = getLoadComb(ctx.c);
    if (JSON.stringify(lc) !== JSON.stringify(ctx.c.loadComb)) store.set(`${ctx.cp}.loadComb`, lc, { record: false, silent: true });
    return store.get(`${ctx.cp}.loadComb`);
}

function download(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function loadFile(ctx) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.act,.json';
    inp.addEventListener('change', async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
            const j = JSON.parse(await f.text());
            if (!j || !j.tables) throw new Error('하중조합 파일 형식이 아닙니다.');
            const cur = ensure(ctx);
            store.set(`${ctx.cp}.loadComb`, { items: j.items || cur.items, opt: { ...cur.opt, ...(j.opt || {}) }, tables: { ...cur.tables, ...j.tables } });
            ctx.setHint(`하중조합을 불러왔습니다: ${f.name}`);
        } catch (e) { alertBox('하중조합 불러오기 실패: ' + e.message); }
    });
    inp.click();
}

function addItem(ctx) {
    const lc = ensure(ctx);
    const n = lc.items.filter(i => i.user).length + 1;
    let code = `U${n}`;
    while (lc.items.some(i => i.code === code)) code = `U${+code.slice(1) + 1}`;
    const inp = h('input', { type: 'text', value: `사용자하중${code.slice(1)}`, style: { width: '200px' } });
    modal({
        title: '설계항목 추가', width: 320,
        body: h('div', {}, [h('label', {}, ['설계항목 이름 : ', inp]), h('div', { class: 'note', style: { color: '#234' } }, `기호 ${code} — 각 조합표의 열로 추가되며 하중계수를 직접 입력합니다.`)]),
        buttons: [{ text: '확인', primary: true, onClick: () => { const items = clone(lc.items); items.push({ code, name: inp.value || code, on: true, user: true }); store.set(`${ctx.cp}.loadComb.items`, items); } }, { text: '취소' }],
    });
}

async function delItem(ctx) {
    const lc = ensure(ctx);
    const it = lc.items[sel.items];
    if (!it || !it.user) { alertBox('사용자가 추가한 설계항목만 삭제할 수 있습니다. 삭제할 항목 행을 선택하세요.'); return; }
    if (!(await confirmBox(`설계항목 [${it.code} : ${it.name}] 을 삭제합니다.`))) return;
    const next = clone(lc);
    next.items = next.items.filter(i => i.code !== it.code);
    for (const k of Object.keys(next.tables)) for (const r of next.tables[k]) if (r.f) delete r.f[it.code];
    store.set(`${ctx.cp}.loadComb`, next);
}

function renderItems(el, ctx, lc) {
    const lp = `${ctx.cp}.loadComb.items`;
    new Grid(el, {
        id: 'lcomb-items',
        onSelect: (c, r) => { sel.items = r; },
        head: [[{ t: '설계항목' }, { t: '기호' }, { t: '적용' }]],
        rows: lc.items.map((it, i) => ({
            cells: [
                it.user ? txt(`${lp}.${i}.name`, { hint: '사용자 설계항목 이름' }) : lbl(it.name),
                lbl(it.code, { align: 'center' }),
                chk(`${lp}.${i}.on`, { hint: '해제하면 이 설계항목의 하중은 모든 조합에서 제외됩니다.' }),
            ],
        })),
        colWidths: [240, 60, 50],
    });
    el.appendChild(h('div', { class: 'note' }, '* 설계항목추가 시 U1, U2 … 기호로 각 조합표의 열에 추가됩니다. 사용자 항목만 삭제할 수 있습니다.'));
}

function renderTable(el, ctx, lc, kind) {
    const seis = kind === 'eqCollapse' || kind === 'eqFunction';
    const cols = lc.items.filter(it => it.on !== false && (seis || it.code !== 'E'));
    const tp = `${ctx.cp}.loadComb.tables.${kind}`;
    const rows = (lc.tables[kind] || []).map((r, i) => {
        const cells = [txt(`${tp}.${i}.name`, { hint: '조합 이름' })];
        for (const it of cols) {
            cells.push(custom('num', () => { const v = (store.get(`${tp}.${i}.f`) || {})[it.code]; return v ? v : null; }, (v) => {
                const f = clone(store.get(`${tp}.${i}.f`) || {});
                if (v == null || !+v) delete f[it.code]; else f[it.code] = +v;
                store.set(`${tp}.${i}.f`, f);
            }, { dec: 3, allowEmpty: true, hint: `${it.name} (${it.code}) 하중계수. 빈칸 = 조합에서 제외` }));
        }
        cells.push(chk(`${tp}.${i}.gw`, { hint: '지하수 고려 조합 (PAVEW, WATERV, SOILBOW, WATERH, BUOYANCY 사용)' }));
        if (!seis) cells.push(chk(`${tp}.${i}.plate`, { hint: '3D Plate 모델로 내보낼 조합' }));
        return { cells };
    });
    const head = [{ t: '구분' }, ...cols.map(it => ({ t: it.code })), { t: '지하수 고려' }];
    if (!seis) head.push({ t: '3D Plate' });
    new Grid(el, {
        id: `lcomb-${kind}`,
        onSelect: (c, r) => { selRow[kind] = r; },
        head: [head],
        rows,
        colWidths: [70, ...cols.map(() => 62), 70, 70],
    });
    if (!lc.opt.gw) el.appendChild(h('div', { class: 'note' }, '* [지하수위 고려] 가 해제되어 지하수 고려 조합은 생성되지 않습니다.'));
}

export default {
    scope: 'culvert',
    perBlock: false,
    hint: '하중조합을 설정합니다. 설계항목별 하중계수는 하중정의의 각 하중케이스에 적용됩니다.',
    tabs: (ctx) => tabsOf(ctx),

    header(el, ctx) {
        ensure(ctx);
        const op = `${ctx.cp}.loadComb.opt`;
        el.appendChild(h('span', { class: 'inline-opts', style: { marginLeft: 'auto' } }, [
            h('b', {}, '하중조합 선택사항'),
            bCheck(`${op}.gw`, ' 지하수위 고려'),
            bCheck(`${op}.ecc`, ' 편토압 적용'),
            bCheck(`${op}.eccLive`, ' 편재 활하중 적용'),
        ]));
    },

    render(el, ctx, tab) {
        const lc = ensure(ctx);
        if (tab === 'items') renderItems(el, ctx, lc);
        else renderTable(el, ctx, lc, tab);
    },

    footer(el, ctx, tab) {
        const items = tab === 'items';
        el.appendChild(button('전체조합 기본값', async () => {
            if (!(await confirmBox('모든 하중조합을 기본값으로 다시 설정합니다. 계속하시겠습니까?'))) return;
            const lc = ensure(ctx);
            store.set(`${ctx.cp}.loadComb.tables`, defaultTables());
            store.set(`${ctx.cp}.loadComb.items`, lc.items.filter(i => !i.user).length === BASE_ITEMS.length ? lc.items.filter(i => !i.user) : defaultLoadComb().items);
        }));
        el.appendChild(button('모든 블럭 동일적용', () => ctx.setHint('하중조합은 암거 단위로 저장되어 모든 블럭에 동일하게 적용됩니다.')));
        el.appendChild(button('조합추가', () => {
            const tp = `${ctx.cp}.loadComb.tables.${tab}`;
            const rows = clone(store.get(tp) || []);
            const i = Math.min(selRow[tab] ?? rows.length - 1, rows.length - 1);
            let n = rows.length + 1;
            while (rows.some(r => r.name === `LC${n}`)) n++;
            rows.splice(i + 1, 0, { name: `LC${n}`, f: {}, gw: false, plate: false, use: true });
            store.set(tp, rows);
        }, { disabled: items }));
        el.appendChild(button('조합삭제', () => {
            const tp = `${ctx.cp}.loadComb.tables.${tab}`;
            const rows = clone(store.get(tp) || []);
            if (!rows.length) return;
            rows.splice(Math.min(selRow[tab] ?? rows.length - 1, rows.length - 1), 1);
            store.set(tp, rows);
        }, { disabled: items }));
        el.appendChild(button('설계항목추가', () => addItem(ctx)));
        el.appendChild(button('설계항목삭제', () => delItem(ctx)));
        el.appendChild(button('하중조합 저장', () => {
            const lc = ensure(ctx);
            download(JSON.stringify({ type: 'esc-culvert-loadcomb', version: 1, ...lc }, null, 1), `${ctx.c.name || 'culvert'}_하중조합.act`);
        }, { title: '모든 하중조합을 *.act 파일로 저장' }));
        el.appendChild(button('하중조합 불러오기', () => loadFile(ctx), { title: '*.act 파일에서 하중조합 불러오기' }));
    },

    defaults(ctx, tab) {
        const def = defaultLoadComb();
        const lc = clone(ensure(ctx));
        if (tab === 'items') { lc.items = def.items; lc.opt = def.opt; }
        else lc.tables[tab] = def.tables[tab];
        store.set(`${ctx.cp}.loadComb`, lc);
    },

    draw(ctx, tab) {
        // 확인창: 하중케이스로 확장된 조합 (하중조합 상세 요약)
        const d = new Drawing({ textHeight: 250 });
        if (tab === 'items') return d;
        let t;
        try { t = comboTable(ctx.p, ctx.c, tab); } catch (e) { d.emptyMessage = '조합 생성 오류: ' + e.message; return d; }
        const cw = 1500, rh = 420, x0 = 0;
        d.text(x0, rh * 1.6, `${COMBO_KINDS.find(k => k.id === tab).title} — 하중케이스 확장 (${t.rows.length}개 조합)`, { color: COLOR.YELLOW, align: 'left', h: 300 });
        d.text(x0, 0, '조합', { color: COLOR.CYAN, align: 'left' });
        t.keys.forEach((k, j) => d.text(x0 + cw * (j + 1.6), 0, k, { color: COLOR.CYAN, h: 220 }));
        t.rows.forEach((r, i) => {
            const y = -(i + 1) * rh;
            d.text(x0, y, `${r.name} (${r.lc})`, { color: COLOR.GREEN, align: 'left', h: 220 });
            r.vals.forEach((v, j) => { if (v != null) d.text(x0 + cw * (j + 1.6), y, v.toFixed(3), { color: COLOR.WHITE, h: 210 }); });
        });
        return d;
    },
    viewKey: (ctx, tab) => `loadComb|${ctx.ci}|${tab}`,
};
