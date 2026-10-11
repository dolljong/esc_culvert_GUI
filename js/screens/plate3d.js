// 구조 계산 > 3D Plate 해석 (매뉴얼 4.7)
//
// 원본은 MIDAS Civil 과 수동 연계한다: [MIDAS Civil Input 생성] 으로 .mct 를 내려받아 MIDAS 에서 해석하고,
// Text Output (Plate Force per unit length (L), ENVULT/ENVECC/ENVUSE 포함) 으로 만든 .anl 을 [MIDAS Civil Output 읽기] 로 읽는다.
// 해석Tool(3D) = MIDAS 이고 BOX 형식 블록일 때만 사용한다.
// 데이터: culverts[i].plate3d (화면 옵션). 읽은 .anl 결과는 메모리에만 둔다 (암거·블록별).

import store from '../core/store.js';
import { h, button, bCheck, modal, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { downloadText } from '../cad/dxfWriter.js';
import { sectionKind, blocks } from '../core/model.js';
import { getDesign } from '../calc/design.js';
import { COMBO_KINDS } from '../calc/combos.js';
import { projector, loadResultant } from '../calc/plateMesh.js';
import { plateModel, mctText, parseAnl, plateValue, nodeAverages, summarize, ENVELOPES } from '../calc/plateMct.js';

const PLATE_RES = [['Fxx', 'Fyy', 'Fxy', 'FMax', 'FMin', 'Vxx'], ['Mxx', 'Myy', 'Mxy', 'MMax', 'MMin', 'Vyy']];
const FRAME_RES = [['Shear 2-2', 'Moment 2-2', 'Axial Force'], ['Shear 3-3', 'Moment 3-3', 'Axial Tortion']];
const RES_MODES = [{ value: 'center', label: '부재의 Center' }, { value: 'avg', label: '각 절점 평균값' }, { value: 'max', label: '최대값' }];
const VIEWS = [{ value: 'YZ', label: 'Y-Z평면' }, { value: 'XZ', label: 'X-Z평면(정면)' }, { value: 'XY', label: 'X-Y평면' }, { value: '3D', label: '3D 평면' }];
const UNIT = (c) => (c[0] === 'M' ? 'kN·m/m' : 'kN/m');

const DEF = {
    mesh: 500, meshInput: 500, resMode: 'center', comp: 'Fxx', loadType: 'STATIC', sel: 'SW',
    showLoad: false, kor: true, nodeNo: false, memNo: false, restraint: false, values: false, view: '3D',
};

/** 읽은 ANL 결과: key `${ci}|${bi}` → { name, res, signature } */
const RESULTS = new Map();

function opt(ctx) { return { ...DEF, ...(ctx.c.plate3d || {}) }; }
const P = (ctx, k) => `${ctx.cp}.plate3d.${k}`;
const setO = (ctx, k, v) => store.set(P(ctx, k), v, { record: false });
const isBox = (ctx) => sectionKind(ctx.c, ctx.bi | 0) === 'BOX';

function modelSafe(ctx) {
    try { return plateModel(ctx.p, ctx.c, ctx.bi | 0, { mesh: opt(ctx).mesh }); } catch (e) { console.error(e); ctx.setHint('3D 모델 생성 오류: ' + e.message, true); return null; }
}
const resultOf = (ctx) => RESULTS.get(`${ctx.ci}|${ctx.bi | 0}`) || null;

/** 하중/조합 선택 목록 */
function selList(ctx, M, o) {
    const R = resultOf(ctx);
    if (R && !(o.showLoad && o.loadType === 'STATIC')) {
        const keys = new Set(M ? M.cases.map(x => x.key) : []);
        const list = R.res.loads.filter(l => (o.loadType === 'STATIC') === keys.has(l));
        if (list.length) return list.map(l => ({ value: l, label: l }));
    }
    if (!M) return [];
    if (o.loadType === 'STATIC') return M.cases.map(x => ({ value: x.key, label: `${x.key} : ${x.name}` }));
    const out = [];
    for (const env of ENVELOPES) if (M.combos.some(cb => env.kinds.includes(cb.kind))) out.push({ value: env.name, label: `${env.name} : ${env.desc}` });
    for (const cb of M.combos) out.push({ value: cb.name, label: `${cb.name} (${cb.lc || ''})` });
    return out;
}

export default {
    scope: 'culvert',
    perBlock: true,
    enabled: (ctx) => {
        if (!ctx.c) return false;
        if (getDesign(ctx.p).env.tool3d !== 'MIDAS') return false;
        return blocks(ctx.c).some((b, i) => sectionKind(ctx.c, i) === 'BOX');
    },
    hint: 'MIDAS Civil 과 연계하여 BOX 형식 블록의 3D Plate 해석을 수행합니다. Mesh 크기를 바꾼 뒤 [재생성]을 누르십시오.',

    header(el, ctx) {
        const o = opt(ctx);
        const inp = h('input', { type: 'text', style: { width: '50px', textAlign: 'right' } });
        inp.value = o.meshInput;
        inp.addEventListener('change', () => { const v = +inp.value; if (v >= 100 && v <= 5000) setO(ctx, 'meshInput', v); else inp.value = o.meshInput; });
        el.appendChild(h('label', {}, ['Mesh 크기(mm) ', inp]));
        el.appendChild(button('재생성', () => {
            const v = +inp.value;
            if (!(v >= 100 && v <= 5000)) { alertBox('Mesh 크기는 100 ~ 5000 mm 범위로 입력하십시오.'); return; }
            store.transact(() => { setO(ctx, 'meshInput', v); setO(ctx, 'mesh', v); });
        }));
        const s = h('select', {});
        RES_MODES.forEach(m => { const op = h('option', { value: m.value }, m.label); if (m.value === o.resMode) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', () => setO(ctx, 'resMode', s.value));
        el.appendChild(h('label', {}, ['3D Plate 해석결과값 ', s]));
    },

    render(el, ctx) {
        if (!ctx.c.plate3d) store.set(`${ctx.cp}.plate3d`, { ...DEF }, { record: false, silent: true });
        if (!isBox(ctx)) {
            el.appendChild(h('div', { class: 'note' }, `BLOCK ${(ctx.bi | 0) + 1} 은(는) BOX 형식이 아닙니다. 3D Plate 해석은 BOX 형식만 지원합니다.`));
            return;
        }
        const o = opt(ctx);
        const M = modelSafe(ctx);
        const R = resultOf(ctx);
        const row1 = h('div', { class: 'inline-opts' });
        const lt = h('select', {});
        [{ value: 'STATIC', label: 'STATIC LOAD' }, { value: 'COMBO', label: 'COMBO LOAD' }].forEach(x => { const op = h('option', { value: x.value }, x.label); if (x.value === o.loadType) op.selected = true; lt.appendChild(op); });
        lt.addEventListener('change', () => {
            const nl = selList(ctx, M, { ...o, loadType: lt.value });
            store.transact(() => { setO(ctx, 'loadType', lt.value); setO(ctx, 'sel', nl[0] ? nl[0].value : ''); });
        });
        row1.appendChild(h('label', {}, ['하중 종류 ', lt]));
        const list = selList(ctx, M, o);
        const cur = list.some(x => x.value === o.sel) ? o.sel : (list[0] && list[0].value);
        const s = h('select', { style: { maxWidth: '260px' } });
        list.forEach(x => { const op = h('option', { value: x.value }, x.label); if (x.value === cur) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', () => setO(ctx, 'sel', s.value));
        const idx = list.findIndex(x => x.value === cur);
        row1.appendChild(h('label', {}, ['하중 및 조합 ', s,
            h('button', { class: 'nav-btn', onclick: () => idx > 0 && setO(ctx, 'sel', list[idx - 1].value) }, '◀'),
            h('button', { class: 'nav-btn', onclick: () => idx < list.length - 1 && setO(ctx, 'sel', list[idx + 1].value) }, '▶')]));
        row1.appendChild(bCheck(P(ctx, 'showLoad'), ' 하중재하보기', { disabled: o.loadType !== 'STATIC' || !M, onChange: (v) => setO(ctx, 'showLoad', v), title: '선택한 하중 케이스의 판 압력을 색으로 표시' }));
        row1.appendChild(bCheck(P(ctx, 'kor'), ' Kor Code 적용', { onChange: (v) => setO(ctx, 'kor', v), title: '계산 결과 보기에서 판 설계모멘트를 M ± |Mxy| (Wood-Armer 간이식) 로 표시' }));
        el.appendChild(row1);

        const groups = h('div', { class: 'dlg-row', style: { marginTop: '4px' } });
        const rname = 'p3d-res-' + ctx.ci;
        groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, 'Element 결과 - PLATE'), h('div', { class: 'box-body', style: { display: 'grid', gridTemplateColumns: 'repeat(6, auto)', gap: '2px 10px' } },
            PLATE_RES.flat().map(id => {
                const rb = h('input', { type: 'radio', name: rname });
                rb.checked = o.comp === id;
                rb.addEventListener('change', () => setO(ctx, 'comp', id));
                return h('label', {}, [rb, id]);
            }))]));
        groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, 'Element 결과 - FRAME'), h('div', { class: 'box-body', style: { display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '2px 10px', opacity: 0.55 } },
            FRAME_RES.flat().map(id => h('label', { title: '3D 모델에 FRAME 요소가 없습니다' }, [h('input', { type: 'radio', disabled: true, name: rname + 'f' }), id])))]));
        const vname = 'p3d-view-' + ctx.ci;
        groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, 'View Control'), h('div', { class: 'box-body' }, [
            h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, [
                bCheck(P(ctx, 'nodeNo'), ' 절점 번호', { onChange: (v) => setO(ctx, 'nodeNo', v) }),
                bCheck(P(ctx, 'memNo'), ' 부재 번호', { onChange: (v) => setO(ctx, 'memNo', v) }),
                bCheck(P(ctx, 'restraint'), ' 구속 조건', { onChange: (v) => setO(ctx, 'restraint', v) }),
                bCheck(P(ctx, 'values'), ' 데이터 값', { onChange: (v) => setO(ctx, 'values', v) }),
            ]),
            h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' } }, VIEWS.map(v => {
                const rb = h('input', { type: 'radio', name: vname });
                rb.checked = o.view === v.value;
                rb.addEventListener('change', () => setO(ctx, 'view', v.value));
                return h('label', {}, [rb, v.label]);
            })),
        ])]));
        if (M) {
            const info = [
                `절점 ${M.mesh.nodes.length} / 판요소 ${M.mesh.plates.length} / Mesh ${M.mesh.mesh} mm / 블록길이 ${M.mesh.Lb.toFixed(3)} m`,
                `하중 ${M.cases.length} / 조합 ${M.combos.length} (포락 ${ENVELOPES.filter(e => M.combos.some(cb => e.kinds.includes(cb.kind))).map(e => e.name).join(', ')})`,
                M.sg.mode === 'fixed' ? '지반: 하부 고정지점' : `지반: kv = ${M.sg.kv.toFixed(0)} kN/m³ (절점 스프링 = kv × 지배면적, 수평 kv/3)`,
                `검토단면: ${M.cond.name || ''}  STA. ${(+M.cond.sta).toFixed(3)}`,
            ];
            if (+o.meshInput !== +o.mesh) info.push(`※ Mesh 크기 ${o.meshInput} mm 가 아직 적용되지 않았습니다 → [재생성]`);
            if (R) {
                info.push(`ANL: ${R.name} — 요소 ${R.res.count}, 하중 ${R.res.loads.length}개 (${R.res.mode === 'L' ? 'Force per unit length (L)' : R.res.mode === 'G' ? 'Default (G)' : '판 부재력'})`);
                if (R.res.count !== M.mesh.plates.length || R.signature !== M.mesh.signature) info.push('※ 현재 Mesh 와 ANL 의 요소 수가 다릅니다. Input 을 다시 생성해 해석하십시오.');
            } else info.push('ANL 결과 없음 — [MIDAS Civil Output 읽기]');
            groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, '해석 정보'), h('div', { class: 'box-body', style: { whiteSpace: 'pre-line', color: '#234' } }, info.join('\n'))]));
        }
        el.appendChild(groups);
    },

    footer(el, ctx) {
        const ok = isBox(ctx);
        el.appendChild(button('MIDAS Civil 자동 실행', null, { disabled: true, title: '지원하지 않습니다' }));
        el.appendChild(button('MIDAS Civil Input 생성', () => exportMct(ctx), { disabled: !ok }));
        el.appendChild(button('MIDAS Civil Output 읽기', () => readAnl(ctx), { disabled: !ok }));
        el.appendChild(button('계산 결과 보기', () => showResults(ctx), { disabled: !ok }));
    },

    defaults(ctx) {
        store.set(`${ctx.cp}.plate3d`, { ...DEF });
    },

    draw(ctx) {
        if (!isBox(ctx)) { const d = new Drawing(); d.emptyMessage = 'BOX 형식 블록만 지원합니다'; return d; }
        const M = modelSafe(ctx);
        if (!M) return null;
        return drawPlate(ctx, M, opt(ctx));
    },
    viewKey: (ctx) => { const o = opt(ctx); return `p3d|${ctx.ci}|${ctx.bi}|${o.view}|${o.mesh}`; },
};

// ── 도면 ─────────────────────────────────────────────────────────────

/** R→G→B 등고선 색 (t: 0 = 최소(파랑) … 1 = 최대(빨강)), 구간 수 n */
function contourColor(t, n = 10) {
    const k = Math.max(0, Math.min(n - 1, Math.floor(t * n)));
    const hue = 240 * (1 - k / (n - 1));
    return hslHex(hue, 1, 0.5);
}
function hslHex(hh, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + hh / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function drawPlate(ctx, M, o) {
    const mesh = M.mesh;
    const pr = projector(o.view);
    const pts = new Map();
    for (const n of mesh.nodes) pts.set(n.id, pr.P(n.x, n.y, n.z));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q of pts.values()) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); }
    const size = Math.max(maxX - minX, maxY - minY, 1);
    const d = new Drawing({ textHeight: size / 70 });
    // 값 (결과 또는 하중)
    const R = resultOf(ctx);
    let vals = null, label = '', unit = '';
    if (o.showLoad && o.loadType === 'STATIC') {
        const lc = M.cases.find(x => x.key === o.sel);
        if (lc) {
            vals = new Map();
            for (const q of lc.plate.pres) vals.set(q.elem, (vals.get(q.elem) || 0) + q.p);
            label = `하중재하 - ${lc.key} : ${lc.name}`; unit = 'kN/m²';
            const res = loadResultant(mesh, lc.plate);
            d.legend = `합력 FX = ${res.FX.toFixed(1)} kN, FZ = ${res.FZ.toFixed(1)} kN (절점하중 ${lc.plate.conc.length}개 포함)`;
        }
    } else if (R && o.sel && R.res.loads.includes(o.sel)) {
        vals = new Map();
        const nodeAvg = o.resMode === 'avg' ? nodeAverages(R.res, mesh, o.sel, o.comp) : null;
        for (const pl of mesh.plates) {
            const v = plateValue(R.res, pl.id, o.sel, o.comp, o.resMode, pl, nodeAvg);
            if (v != null) vals.set(pl.id, v);
        }
        label = `${o.comp} - ${o.sel} (${RES_MODES.find(m => m.value === o.resMode).label})`; unit = UNIT(o.comp);
    }
    // 판 (먼 것부터)
    const order = mesh.plates.map(pl => {
        const ps = pl.n.map(id => pts.get(id));
        return { pl, ps, depth: ps.reduce((a, q) => a + q[2], 0) / 4 };
    }).sort((a, b) => a.depth - b.depth);
    let vmin = Infinity, vmax = -Infinity;
    if (vals) for (const v of vals.values()) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    const colored = vals && vals.size && isFinite(vmin);
    const span = colored ? (vmax - vmin) || 1 : 1;
    for (const { pl, ps } of order) {
        const poly = ps.map(q => [q[0], q[1]]);
        if (colored) {
            const v = vals.get(pl.id);
            const fill = v == null ? '#303030' : contourColor((v - vmin) / span);
            d.pline(poly, { closed: true, fill, color: COLOR.GRAY });
        } else d.pline(poly, { closed: true, color: COLOR.GREEN });
    }
    // 절점/부재 번호, 데이터 값
    const th = d.textHeight;
    if (o.memNo || (o.values && colored)) {
        for (const { pl, ps } of order) {
            const cx = ps.reduce((a, q) => a + q[0], 0) / 4, cy = ps.reduce((a, q) => a + q[1], 0) / 4;
            const parts = [];
            if (o.memNo) parts.push(String(pl.id));
            if (o.values && colored && vals.has(pl.id)) parts.push(vals.get(pl.id).toPrecision(3));
            if (parts.length) d.text(cx, cy, parts.join(' : '), { h: th * 0.6, valign: 'middle', color: COLOR.WHITE });
        }
    }
    if (o.nodeNo) for (const n of mesh.nodes) { const q = pts.get(n.id); d.text(q[0], q[1], String(n.id), { h: th * 0.55, align: 'left', color: COLOR.YELLOW }); }
    if (o.restraint) {
        const r = size / 300;
        for (const b of mesh.bottomNodes) { const q = pts.get(b.node); d.circle(q[0], q[1], r, { color: COLOR.MAGENTA }); }
    }
    // 좌표축 (X 빨강, Y 초록, Z 파랑)
    const ax = size / 10;
    const o0 = [minX - size * 0.08, minY - size * 0.06];
    const axes = [['X', [1, 0, 0], COLOR.RED], ['Y', [0, 1, 0], COLOR.GREEN], ['Z', [0, 0, 1], COLOR.BLUE]];
    for (const [nmx, v, col] of axes) {
        const q = pr.P(v[0], v[1], v[2]);
        const len = Math.hypot(q[0], q[1]);
        if (len < 1e-6) { d.circle(o0[0], o0[1], ax * 0.08, { color: col }); d.text(o0[0] + ax * 0.12, o0[1], nmx, { color: col, align: 'left' }); continue; }
        const ex = o0[0] + q[0] / 1000 * ax, ey = o0[1] + q[1] / 1000 * ax;
        d.line(o0[0], o0[1], ex, ey, { color: col, width: 2 });
        d.text(ex + q[0] / len * th, ey + q[1] / len * th, nmx, { color: col, valign: 'middle' });
    }
    // 범례 + 제목
    if (colored) {
        const n = 10, bx = maxX + size * 0.06, bh = (maxY - minY) / n * 0.8, bw = size * 0.03;
        for (let k = 0; k < n; k++) {
            const y0 = minY + k * bh;
            d.rect(bx, y0, bw, bh, { fill: contourColor((k + 0.5) / n), color: COLOR.GRAY });
            d.text(bx + bw * 1.3, y0, (vmin + span * k / n).toPrecision(4), { align: 'left', valign: 'middle', h: th * 0.8, color: COLOR.WHITE });
        }
        d.text(bx + bw * 1.3, minY + n * bh, vmax.toPrecision(4), { align: 'left', valign: 'middle', h: th * 0.8, color: COLOR.WHITE });
        d.text(bx, minY + n * bh + th * 1.5, unit, { align: 'left', color: COLOR.WHITE, h: th * 0.8 });
        d.text((minX + maxX) / 2, maxY + th * 2, label, { color: COLOR.YELLOW, h: th * 1.2 });
    } else {
        d.text((minX + maxX) / 2, maxY + th * 2, `3D Plate Mesh - BLOCK ${(ctx.bi | 0) + 1} (${mesh.mesh} mm)`, { color: COLOR.YELLOW, h: th * 1.2 });
    }
    return d;
}

// ── 입출력 ───────────────────────────────────────────────────────────

function exportMct(ctx) {
    try {
        const o = opt(ctx);
        const txt = mctText(ctx.p, ctx.c, ctx.bi | 0, { mesh: o.mesh });
        downloadText(txt, `${ctx.c.name || 'culvert'}_BLOCK${(ctx.bi | 0) + 1}.mct`, 'text/plain;charset=utf-8');
        ctx.setHint('MIDAS Civil MCT 파일을 저장했습니다. MIDAS 에서 Tools > MCT Command Shell 로 불러와 해석한 뒤, Text Output 으로 .anl 을 만드십시오 (ENVUSE, ENVULT, ENVECC 선택).');
    } catch (e) {
        console.error(e);
        alertBox('MCT 생성 오류: ' + e.message);
    }
}

function readAnl(ctx) {
    const inp = h('input', { type: 'file', accept: '.anl,.txt,.out', style: { display: 'none' } });
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return;
        try {
            const res = parseAnl(await f.text());
            if (!res.count) { alertBox('판(PLATE) 부재력 결과를 찾지 못했습니다.\nMIDAS Text Output 에서 Plate / Force per unit length (L) 를 선택했는지 확인하십시오.'); return; }
            const M = modelSafe(ctx);
            RESULTS.set(`${ctx.ci}|${ctx.bi | 0}`, { name: f.name, res, signature: M ? M.mesh.signature : '' });
            const keys = new Set(M ? M.cases.map(x => x.key) : []);
            const first = res.loads.find(l => !keys.has(l) && /^ENV/i.test(l)) || res.loads[0];
            store.transact(() => { setO(ctx, 'loadType', keys.has(first) ? 'STATIC' : 'COMBO'); setO(ctx, 'sel', first); setO(ctx, 'showLoad', false); });
            ctx.rerender(); ctx.redraw();
            ctx.setHint(`${f.name}: 판요소 ${res.count}개, 하중 ${res.loads.length}개를 읽었습니다.`);
        } catch (e) {
            console.error(e);
            alertBox('ANL 읽기 오류: ' + e.message);
        }
    });
    inp.click();
}

function showResults(ctx) {
    const M = modelSafe(ctx);
    if (!M) return;
    const o = opt(ctx);
    const R = resultOf(ctx);
    const fx = (v, n = 3) => (v == null || !isFinite(v) ? '-' : v.toFixed(n));
    const glabel = (gid) => (M.mesh.groupDefs.find(g => g.id === gid) || {}).label || gid;
    let html = `<h1>3D Plate 해석 결과 — ${ctx.c.name} BLOCK ${(ctx.bi | 0) + 1}</h1>`;
    html += `<p>절점 ${M.mesh.nodes.length}, 판요소 ${M.mesh.plates.length}, Mesh ${M.mesh.mesh} mm, 블록길이 ${M.mesh.Lb.toFixed(3)} m<br>${(M.sg.lines || []).join('<br>')}</p>`;
    if (!R) {
        html += '<h2>하중 검산 (판 압력 + 절점하중 합력)</h2><table><tr><th>하중</th><th>이름</th><th>ΣFX (kN)</th><th>ΣFZ (kN)</th><th>압력요소</th><th>절점하중</th></tr>';
        for (const lc of M.cases) {
            const r = loadResultant(M.mesh, lc.plate);
            html += `<tr><td>${lc.key}</td><td>${lc.name}</td><td class="num">${fx(r.FX, 2)}</td><td class="num">${fx(r.FZ, 2)}</td><td class="num">${lc.plate.pres.length}</td><td class="num">${lc.plate.conc.length}</td></tr>`;
        }
        html += '</table><p>MIDAS 해석 결과(.anl)를 읽으면 부재군별 최대/최소 단면력이 표시됩니다.</p>';
    } else {
        const loads = R.res.loads.filter(l => /^ENV/i.test(l));
        const show = loads.length ? loads : [o.sel].filter(l => R.res.loads.includes(l));
        const comps = ['Mxx', 'Myy', 'Mxy', 'Fxx', 'Fyy', 'Vxx', 'Vyy'];
        html += `<p>ANL: ${R.name} (요소 ${R.res.count}, 하중 ${R.res.loads.length}) — 값은 부재의 Center 기준, 단위 kN/m, kN·m/m</p>`;
        for (const ld of show) {
            const sm = summarize(R.res, M.mesh, ld, comps);
            html += `<h2>${ld}</h2><table><tr><th>부재</th>${comps.map(cp => `<th>${cp} max</th><th>${cp} min</th>`).join('')}</tr>`;
            for (const [gid, row] of Object.entries(sm)) html += `<tr><td>${glabel(gid)}</td>${comps.map(cp => `<td class="num">${fx(row[cp].max)}</td><td class="num">${fx(row[cp].min)}</td>`).join('')}</tr>`;
            html += '</table>';
            if (o.kor) {
                // Wood-Armer 간이 설계모멘트 Mx* = Mxx ± |Mxy|
                html += '<h3>설계 휨모멘트 (Kor Code: Mx* = Mxx ± |Mxy|, My* = Myy ± |Mxy|)</h3><table><tr><th>부재</th><th>Mx*+</th><th>Mx*−</th><th>My*+</th><th>My*−</th></tr>';
                for (const [gid, ids] of Object.entries(M.mesh.groups)) {
                    let a = -Infinity, b = Infinity, c2 = -Infinity, d2 = Infinity;
                    for (const id of ids) {
                        const lr = R.res.elems.get(id) && R.res.elems.get(id)[ld];
                        if (!lr || !lr.cent) continue;
                        const q = lr.cent, t = Math.abs(q.Mxy || 0);
                        a = Math.max(a, q.Mxx + t); b = Math.min(b, q.Mxx - t); c2 = Math.max(c2, q.Myy + t); d2 = Math.min(d2, q.Myy - t);
                    }
                    html += `<tr><td>${glabel(gid)}</td><td class="num">${fx(a)}</td><td class="num">${fx(b)}</td><td class="num">${fx(c2)}</td><td class="num">${fx(d2)}</td></tr>`;
                }
                html += '</table>';
            }
        }
    }
    const kinds = COMBO_KINDS.filter(k => M.combos.some(cb => cb.kind === k.id)).map(k => `${k.title} ${M.combos.filter(cb => cb.kind === k.id).length}개`);
    html += `<p>하중조합: ${kinds.join(', ')}</p>`;
    modal({ title: '계산 결과 보기 (3D Plate)', width: 980, height: 640, body: h('div', { class: 'report', html }) });
}
