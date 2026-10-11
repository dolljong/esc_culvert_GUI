// 일반 입력 > 지반 정보 (매뉴얼 2.2)
// 선형상의 지층(토사/풍화암/연암/경암)과 지하수위. [검토위치설정] 기본값에서 토피·지반정보로 사용.
// 데이터: culverts[i].ground (calc/ground.js 형식)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, chk, dash } from '../ui/cells.js';
import { h, box, button, bCheck, modal, alertBox } from '../ui/dom.js';
import { LAYERS, defaultGround, layerAt } from '../calc/ground.js';
import { readDxfPolylines, mergeToProfile } from '../calc/groundDxf.js';
import { drawProfile, newPlanDrawing } from '../draw/planDraw.js';

let selCell = { layer: '토사', seg: 1 };

const USE_LABEL = { 토사: '토사 구간', 풍화암: '풍화암 구간', 연암: '연암 구간', 경암: '경암 구간', 지하수위: '지하 수위' };

function ensure(ctx) {
    const c = ctx.c;
    let g = c.ground;
    let fix = false;
    if (!g || !g.layers || !g.use) { g = defaultGround(c); fix = true; }
    else {
        g = clone(g);
        const d = defaultGround(c);
        for (const name of LAYERS) {
            if (!g.layers[name] || !Array.isArray(g.layers[name].segs) || !g.layers[name].segs.length) { g.layers[name] = d.layers[name]; fix = true; }
            if (g.use[name] == null) { g.use[name] = d.use[name]; fix = true; }
        }
    }
    if (fix) store.set(`${ctx.cp}.ground`, g, { record: false, silent: true });
    return c.ground;
}

export default {
    scope: 'culvert',
    hint: '입력선 시점위치 Station(m)을 입력합니다.',

    render(el, ctx) {
        const gr = ensure(ctx);
        const gp = `${ctx.cp}.ground`;
        const shown = LAYERS.filter(n => gr.use[n]);
        const maxSeg = Math.max(1, ...shown.map(n => gr.layers[n].segs.length));
        const head = [[{ t: '구 분', cs: 2 }, { t: '시점' }, ...Array.from({ length: maxSeg }, (_, k) => ({ t: `구간 ${k + 1}` }))]];
        const rows = [];
        for (const name of shown) {
            const L = gr.layers[name];
            const lp = `${gp}.layers.${name}`;
            const water = name === '지하수위';
            const items = water ? ['sta/길이', 'Elevation', '구간사용'] : ['sta/길이', 'Elevation', 'N 값', '구간사용'];
            items.forEach((item, r) => {
                const cells = [];
                for (let k = 0; k <= maxSeg; k++) {
                    const meta = { layer: name, seg: k };
                    const sp = `${lp}.segs.${k - 1}`;
                    const has = k === 0 || k <= L.segs.length;
                    let cell;
                    if (!has) cell = dash();
                    else if (item === 'sta/길이') cell = k === 0
                        ? num(`${lp}.sta`, { dec: 3, hint: '입력선 시점위치 Station(m)을 입력합니다.' })
                        : num(`${sp}.len`, { dec: 3, hint: '구간 길이(m)를 입력합니다.', validate: v => (v > 0 ? null : '구간 길이는 0보다 커야 합니다.') });
                    else if (item === 'Elevation') cell = k === 0
                        ? num(`${lp}.el`, { dec: 3, hint: `${name} 시점의 Elevation(m)을 입력합니다.` })
                        : num(`${sp}.el`, { dec: 3, hint: `${name} 구간 끝점의 Elevation(m)을 입력합니다. (층의 상단)` });
                    else if (item === 'N 값') cell = k === 0 ? dash() : num(`${sp}.N`, { dec: 0, allowEmpty: true, hint: '해당 구간의 표준관입시험 N 값을 입력합니다.' });
                    else cell = k === 0 ? dash() : chk(`${sp}.use`, { hint: '해당 구간에 지층이 없는 경우 체크를 해제합니다.' });
                    cell.meta = meta;
                    cells.push(cell);
                }
                rows.push({ head: r === 0 ? [{ t: name, rs: items.length, cls: 'grp' }, { t: item }] : [{ t: item }], cells });
            });
        }
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        new Grid(left, {
            id: 'ground-grid', head, rows,
            colWidths: [70, 80, 80, ...Array.from({ length: maxSeg }, () => 80)],
            onSelect: (cell) => { if (cell.meta) selCell = cell.meta; },
        });
        wrap.appendChild(left);
        wrap.appendChild(h('div', { class: 'dlg-col' }, [
            box('적용사항 설정', LAYERS.map(n => h('div', { class: 'opt' }, [bCheck(`${gp}.use.${n}`, ' ' + USE_LABEL[n])]))),
        ]));
        el.appendChild(wrap);
        el.appendChild(h('div', { class: 'note' }, '* sta/길이: 시점 칸은 시작 Station, 구간 칸은 구간 길이(m). Elevation 은 각 층 상단의 꺾인점 EL(m) 입니다.'));
    },

    footer(el, ctx) {
        el.appendChild(button('위치추가', () => addPos(ctx)));
        el.appendChild(button('위치삭제', () => delPos(ctx)));
        el.appendChild(button('DXF로 지반선 읽기', () => readDxf(ctx)));
    },

    defaults(ctx) {
        store.set(`${ctx.cp}.ground`, defaultGround(ctx.c));
    },

    draw(ctx) {
        ensure(ctx);
        const d = newPlanDrawing(ctx.p, ctx.c);
        drawProfile(d, ctx.p, ctx.c, { refLabels: true });
        return d;
    },
    viewKey: (ctx) => `ground|${ctx.ci}`,
};

function addPos(ctx) {
    const gr = clone(ensure(ctx));
    const name = gr.use[selCell.layer] ? selCell.layer : LAYERS.find(n => gr.use[n]);
    if (!name) return;
    const L = gr.layers[name];
    const k = Math.max(1, Math.min(selCell.seg || L.segs.length, L.segs.length));
    const sg = L.segs[k - 1];
    const prevEl = k === 1 ? L.el : L.segs[k - 2].el;
    const half = +((+sg.len || 0) / 2).toFixed(6);
    if (!(half > 0)) return;
    L.segs.splice(k - 1, 1,
        { ...sg, len: half, el: +((+prevEl + +sg.el) / 2).toFixed(6) },
        { ...sg, len: +((+sg.len) - half).toFixed(6) });
    store.set(`${ctx.cp}.ground`, gr);
    selCell = { layer: name, seg: k };
}

function delPos(ctx) {
    const gr = clone(ensure(ctx));
    const name = selCell.layer;
    const L = gr.layers[name];
    if (!L || !gr.use[name]) return;
    const k = selCell.seg;
    if (!(k >= 1) || k > L.segs.length) { alertBox('삭제할 구간 칸을 선택하십시오.'); return; }
    if (L.segs.length <= 1) { alertBox('구간은 최소 1개가 있어야 합니다.'); return; }
    const rm = L.segs[k - 1];
    if (k < L.segs.length) L.segs[k].len = +((+L.segs[k].len) + (+rm.len)).toFixed(6);
    else L.segs[k - 2].len = +((+L.segs[k - 2].len) + (+rm.len)).toFixed(6);
    L.segs.splice(k - 1, 1);
    store.set(`${ctx.cp}.ground`, gr);
    selCell = { layer: name, seg: Math.max(1, k - 1) };
}

function readDxf(ctx) {
    let parsed = null;
    const file = h('input', { type: 'file', accept: '.dxf' });
    const dxfLayer = h('select', { disabled: true });
    const target = h('select', {}, LAYERS.map(n => h('option', { value: n }, n)));
    const unit = h('select', {}, [h('option', { value: 1000 }, 'mm (도면 1 = 1mm)'), h('option', { value: 1 }, 'm (도면 1 = 1m)')]);
    const info = h('div', { class: 'note' }, 'DXF 의 X 좌표를 Station, Y 좌표를 Elevation 으로 읽습니다. (LINE / LWPOLYLINE / POLYLINE)');
    file.addEventListener('change', async () => {
        const f = file.files[0];
        if (!f) return;
        try {
            parsed = readDxfPolylines(await f.text());
            const names = Object.keys(parsed.layers);
            dxfLayer.innerHTML = '';
            names.forEach(n => dxfLayer.appendChild(h('option', { value: n }, `${n} (${parsed.layers[n].length})`)));
            dxfLayer.disabled = !names.length;
            info.textContent = names.length ? `레이어 ${names.length}개를 찾았습니다.` : '선/폴리라인을 찾지 못했습니다.';
        } catch (e) { info.textContent = 'DXF 읽기 실패: ' + e.message; }
    });
    const body = h('div', { class: 'dlg-col', style: { gap: '6px', minWidth: '380px' } }, [
        h('label', {}, ['DXF 파일 ', file]),
        h('label', {}, ['DXF 레이어 ', dxfLayer]),
        h('label', {}, ['적용할 지층 ', target]),
        h('label', {}, ['도면 단위 ', unit]),
        info,
    ]);
    modal({
        title: 'DXF로 지반선 읽기', body,
        buttons: [
            {
                text: '읽기', primary: true, onClick: () => {
                    if (!parsed || dxfLayer.disabled) { alertBox('DXF 파일과 레이어를 선택하십시오.'); return false; }
                    const pts = mergeToProfile(parsed.layers[dxfLayer.value]);
                    if (pts.length < 2) { alertBox('점이 2개 이상인 지반선이 필요합니다.'); return false; }
                    const sc = +unit.value;
                    const name = target.value;
                    const gr = clone(ensure(ctx));
                    const prof = pts.map(([x, y]) => ({ sta: x / sc, el: y / sc }));
                    gr.layers[name] = {
                        sta: +prof[0].sta.toFixed(6), el: +prof[0].el.toFixed(6),
                        segs: prof.slice(1).map((p, i) => {
                            const mid = (prof[i].sta + p.sta) / 2;
                            const old = layerAt(ctx.c, name, mid);
                            return { len: +(p.sta - prof[i].sta).toFixed(6), el: +p.el.toFixed(6), N: name === '지하수위' ? null : (old && old.N != null ? old.N : 15), use: true };
                        }).filter(s => s.len > 1e-6),
                    };
                    gr.use[name] = true;
                    store.set(`${ctx.cp}.ground`, gr);
                    return true;
                },
            },
            { text: '취소' },
        ],
    });
}
