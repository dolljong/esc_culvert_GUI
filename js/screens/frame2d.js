// 구조 계산 > 2D Frame 해석 (매뉴얼 4.6)
//
// 원본은 SAP2000 7.4 와 연계하지만, 여기서는 브라우저 내장 해석기(js/calc/frameSolver.js)로 바로 푼다.
// [SAP2000 Input 생성] 은 .s2k 텍스트를 내려받아 외부 검증에 쓸 수 있게 한다.

import store from '../core/store.js';
import { h, button, bCheck, bSelect, modal, alertBox } from '../ui/dom.js';
import { Grid } from '../ui/grid.js';
import { lbl } from '../ui/cells.js';
import { COLOR } from '../cad/drawing.js';
import { analyze } from '../calc/frame2d.js';
import { toSolverLoad } from '../calc/frameModel.js';
import { getChecks, sectionName } from '../calc/loadHelpers.js';
import { comboTable, COMBO_KINDS } from '../calc/combos.js';
import { newFrameDrawing, drawModel, drawOutline, drawDiagram, drawDisplacement, drawReactions, drawLoadCase, fmt } from '../draw/frameDraw.js';
import { downloadText } from '../cad/dxfWriter.js';

const RESULTS = [
    { id: 'V', label: 'Shear 2-2' }, { id: 'M', label: 'Moment 3-3' }, { id: 'N', label: 'Axial Force' },
    { id: 'D', label: 'Displacement' }, { id: 'R', label: 'Reaction' },
];

function opt(ctx) {
    const a = ctx.c.analysis || {};
    return {
        check: 0, mode: 'normal', loadType: 'COMBO', sel: 'ENV:factored', result: 'M', scale: 1,
        nodeNo: false, memNo: false, restraint: true, values: true, showLoad: false,
        ...a,
    };
}
const P = (ctx, k) => `${ctx.cp}.analysis.${k}`;
const setO = (ctx, k, v) => store.set(P(ctx, k), v, { record: false });

function runSafe(ctx) {
    try { return analyze(ctx.p, ctx.c, opt(ctx).check); } catch (e) { console.error(e); ctx.setHint('해석 오류: ' + e.message, true); return null; }
}

/** 선택 목록: 하중(STATIC) 또는 조합(COMBO, 포락 포함) */
function selList(r, o) {
    if (!r) return [];
    if (o.loadType === 'STATIC') {
        return r.cases.filter(x => (o.mode === 'eq') === x.eq || (o.mode === 'eq' && !x.eq)).map(x => ({ value: x.key, label: `${x.key} : ${x.name}` }));
    }
    const kinds = o.mode === 'eq' ? ['eqCollapse', 'eqFunction'] : ['factored', 'factoredEcc', 'service'];
    const out = [];
    for (const k of kinds) {
        if (!r.combos.some(x => x.kind === k)) continue;
        const meta = COMBO_KINDS.find(x => x.id === k);
        out.push({ value: `ENV:${k}`, label: `MAXMIN : ${meta ? meta.title || meta.name || k : k}` });
        for (const cb of r.combos.filter(x => x.kind === k)) out.push({ value: cb.name, label: `${cb.name} (${cb.lc || ''})` });
    }
    return out;
}

export default {
    scope: 'culvert',
    hint: '내장 해석기로 2D Frame 해석을 수행합니다. 하중/조합을 선택하면 부재력도를 확인할 수 있습니다.',

    header(el, ctx) {
        const o = opt(ctx);
        const ch = getChecks(ctx.p, ctx.c);
        const s = h('select', {});
        ch.rows.forEach((row, i) => { const op = h('option', { value: i }, row.name || sectionName(i)); if (i === o.check) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', () => setO(ctx, 'check', +s.value));
        el.appendChild(h('span', {}, [s,
            h('button', { class: 'nav-btn', onclick: () => o.check > 0 && setO(ctx, 'check', o.check - 1) }, '◀'),
            h('button', { class: 'nav-btn', onclick: () => o.check < ch.rows.length - 1 && setO(ctx, 'check', o.check + 1) }, '▶')]));
        el.appendChild(button('평상시', () => { setO(ctx, 'mode', 'normal'); setO(ctx, 'sel', o.loadType === 'COMBO' ? 'ENV:factored' : 'SW'); }, { cls: o.mode === 'normal' ? 'on' : '' }));
        el.appendChild(button('지진시(붕괴방지)', () => { setO(ctx, 'mode', 'eq'); setO(ctx, 'sel', o.loadType === 'COMBO' ? 'ENV:eqCollapse' : 'EQ'); }, { cls: o.mode === 'eq' ? 'on' : '' }));
    },

    render(el, ctx) {
        if (!ctx.c.analysis) store.set(`${ctx.cp}.analysis`, opt(ctx), { record: false, silent: true });
        const o = opt(ctx);
        const r = runSafe(ctx);
        const row1 = h('div', { class: 'inline-opts' });
        row1.appendChild(h('label', {}, ['하중 종류 ', bSelect(P(ctx, 'loadType'), [{ value: 'STATIC', label: 'STATIC LOAD' }, { value: 'COMBO', label: 'COMBO LOAD' }], {
            onChange: (v) => { setO(ctx, 'loadType', v); setO(ctx, 'sel', v === 'COMBO' ? (o.mode === 'eq' ? 'ENV:eqCollapse' : 'ENV:factored') : (o.mode === 'eq' ? 'EQ' : 'SW')); },
        })]));
        const list = selList(r, o);
        const cur = list.some(x => x.value === o.sel) ? o.sel : (list[0] && list[0].value);
        const s = h('select', { style: { maxWidth: '260px' } });
        list.forEach(x => { const op = h('option', { value: x.value }, x.label); if (x.value === cur) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', () => setO(ctx, 'sel', s.value));
        const idx = list.findIndex(x => x.value === cur);
        row1.appendChild(h('label', {}, ['하중 및 조합 ', s,
            h('button', { class: 'nav-btn', onclick: () => idx > 0 && setO(ctx, 'sel', list[idx - 1].value) }, '◀'),
            h('button', { class: 'nav-btn', onclick: () => idx < list.length - 1 && setO(ctx, 'sel', list[idx + 1].value) }, '▶')]));
        row1.appendChild(bCheck(P(ctx, 'showLoad'), ' 하중재하보기', { disabled: o.loadType !== 'STATIC', onChange: (v) => setO(ctx, 'showLoad', v) }));
        el.appendChild(row1);

        const groups = h('div', { class: 'dlg-row', style: { marginTop: '4px' } });
        const res = h('div', { class: 'box' }, [h('div', { class: 'box-title' }, 'Element 결과'), h('div', { class: 'box-body', style: { display: 'grid', gridTemplateColumns: 'auto auto auto', gap: '2px 10px' } },
            RESULTS.map(x => {
                const rb = h('input', { type: 'radio', name: 'f2d-res' });
                rb.checked = o.result === x.id;
                rb.addEventListener('change', () => setO(ctx, 'result', x.id));
                return h('label', {}, [rb, x.label]);
            }))]);
        groups.appendChild(res);
        const sc = h('input', { type: 'range', min: 0.2, max: 3, step: 0.1, value: o.scale });
        sc.addEventListener('change', () => setO(ctx, 'scale', +sc.value));
        groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, '스케일'), h('div', { class: 'box-body' }, [h('label', {}, ['Diagram ', sc])])]));
        groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, 'View Control'), h('div', { class: 'box-body', style: { display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 10px' } }, [
            bCheck(P(ctx, 'nodeNo'), ' 절점 번호', { onChange: (v) => setO(ctx, 'nodeNo', v) }),
            bCheck(P(ctx, 'memNo'), ' 부재 번호', { onChange: (v) => setO(ctx, 'memNo', v) }),
            bCheck(P(ctx, 'restraint'), ' 구속 조건', { onChange: (v) => setO(ctx, 'restraint', v) }),
            bCheck(P(ctx, 'values'), ' 데이터 값', { onChange: (v) => setO(ctx, 'values', v) }),
        ])]));
        if (r) {
            const info = [
                `절점 ${r.model.nodes.length} / 부재 ${r.model.members.length} / 하중 ${r.cases.length} / 조합 ${r.combos.length}`,
                `지반: ${ctx.p.design ? '' : ''}${r.kv.mode === 'fixed' ? '고정지점' : `kv = ${r.kv.kv.toFixed(0)} kN/m³ (지진시 ${r.kv.kvEq.toFixed(0)})`}`,
                `검토단면: ${r.cond.name || ''}  STA. ${r.cond.sta.toFixed(3)}  토피 ${r.cond.cover.toFixed(3)} m`,
            ];
            const err = [...r.cases, ...r.combos].filter(x => x.error);
            if (err.length) info.push(`해석 오류 ${err.length}건: ${err[0].error}`);
            groups.appendChild(h('div', { class: 'box' }, [h('div', { class: 'box-title' }, '해석 정보'), h('div', { class: 'box-body', style: { whiteSpace: 'pre-line', color: '#234' } }, info.join('\n'))]));
        }
        el.appendChild(groups);
    },

    footer(el, ctx) {
        el.appendChild(button('SAP 2000 자동 실행', () => alertBox('웹 버전은 SAP2000 을 직접 실행할 수 없습니다.\n내장 해석기가 자동으로 해석하며, [SAP 2000 Input 생성] 으로 검증용 입력파일을 받을 수 있습니다.'), { title: '내장 해석기 사용' }));
        el.appendChild(button('SAP 2000 Input 생성', () => exportS2k(ctx)));
        el.appendChild(button('SAP 2000 Output 읽기', () => alertBox('내장 해석기 결과를 사용합니다. (외부 SAP2000 출력 읽기는 지원하지 않습니다)')));
        el.appendChild(button('계산 결과 보기', () => showResults(ctx)));
        el.appendChild(button('하중조합상세', () => showCombos(ctx)));
    },

    defaults(ctx) {
        store.set(`${ctx.cp}.analysis`, { check: 0, mode: 'normal', loadType: 'COMBO', sel: 'ENV:factored', result: 'M', scale: 1, nodeNo: false, memNo: false, restraint: true, values: true, showLoad: false });
    },

    draw(ctx) {
        const o = opt(ctx);
        const r = runSafe(ctx);
        if (!r) return null;
        const model = o.mode === 'eq' ? r.modelEq : r.model;
        const d = newFrameDrawing(model);
        drawOutline(d, model);
        drawModel(d, model, { nodeNo: o.nodeNo, memNo: o.memNo, restraint: o.restraint });
        const sel = o.sel;
        const one = r.cases.find(x => x.key === sel) || r.combos.find(x => x.name === sel);
        const title = (t) => {
            const bb = d.bbox();
            if (bb) d.text((bb.minX + bb.maxX) / 2, bb.maxY + d.textHeight * 1.5, t, { color: COLOR.YELLOW, h: d.textHeight * 1.1 });
        };
        const compName = { M: 'BMD', V: 'SFD', N: 'AFD', D: '변위', R: '지반반력' }[o.result];
        if (sel && sel.startsWith('ENV:')) {
            const kind = sel.slice(4);
            const list = r.combos.filter(x => x.kind === kind && x.res);
            if (!list.length) return d;
            if (o.result === 'M' || o.result === 'V' || o.result === 'N') {
                const key = o.result;
                const env = (mi, x, pick) => {
                    let best = pick === 'max' ? -Infinity : Infinity, out = null;
                    for (const cb of list) { const f = cb.res.at(mi, x); const v = f[key]; if (pick === 'max' ? v > best : v < best) { best = v; out = f; } }
                    return out;
                };
                let mx = 0;
                for (const cb of list) for (let mi = 0; mi < model.members.length; mi++) mx = Math.max(mx, Math.abs(cb.res.at(mi, 0)[key]));
                drawDiagram(d, model, (mi, x) => env(mi, x, 'max'), key, { scale: o.scale, values: o.values, color: COLOR.CYAN, maxAbs: mx });
                drawDiagram(d, model, (mi, x) => env(mi, x, 'min'), key, { scale: o.scale, values: o.values, color: COLOR.MAGENTA, maxAbs: mx });
                d.legend = '하늘: 최대  자홍: 최소';
            }
            const meta = COMBO_KINDS.find(x => x.id === kind);
            title(`${compName} - ${meta ? meta.title || meta.name || kind : kind} (MAXMIN)`);
            return d;
        }
        if (!one || !one.res) { d.emptyMessage = one && one.error ? one.error : '결과 없음'; return d; }
        if (o.showLoad && one.lc) {
            drawLoadCase(d, model, one.lc, toSolverLoad(model, one.lc));
            title(`하중재하도 - ${one.key}`);
            return d;
        }
        if (o.result === 'D') drawDisplacement(d, model, one.res, { scale: o.scale });
        else if (o.result === 'R') drawReactions(d, model, one.res);
        else drawDiagram(d, model, (mi, x) => one.res.at(mi, x), o.result, { scale: o.scale, values: o.values });
        title(`${compName} - ${one.key || one.name}`);
        return d;
    },
    viewKey: (ctx) => `f2d|${ctx.ci}|${opt(ctx).check}|${opt(ctx).mode}`,
};

// ── 결과표 ────────────────────────────────────────────────────────────

const GROUP_LABEL = { top: '상부슬래브', bottom: '하부슬래브', middle: '중간슬래브', left: '좌측벽체', right: '우측벽체' };

function showResults(ctx) {
    const r = runSafe(ctx);
    if (!r) return;
    let html = `<h2>설계 단면력 — 단면 ${r.cond.name}</h2>`;
    html += `<p>${r.kv.lines.join('<br>')}</p>`;
    const kinds = [['factored', '계수하중'], ['factoredEcc', '계수하중(최대편심)'], ['service', '사용하중'], ['eqCollapse', '지진하중(붕괴)'], ['eqFunction', '지진하중(기능)']];
    for (const [gid, gm] of Object.entries(r.model.groups)) {
        const label = GROUP_LABEL[gid] || (gid.startsWith('midU') ? `2층 중간벽 ${+gid.split(':')[1] + 1}` : `중간벽 ${+gid.split(':')[1] + 1}`);
        const st = r.stations(gid);
        const L = st[st.length - 1];
        const pts = [0, L / 4, L / 2, 3 * L / 4, L];
        html += `<h3>${label}</h3><table><tr><th>조합</th><th>위치(m)</th>${pts.map(s => `<th>${s.toFixed(3)}</th>`).join('')}</tr>`;
        for (const [kd, kn] of kinds) {
            if (!r.combos.some(x => x.kind === kd)) continue;
            const envs = pts.map(s => r.envelope([kd], gid, s));
            html += `<tr><td rowspan="3">${kn}</td><td>Mmax / Mmin</td>${envs.map(e => `<td class="num">${fmt(e.Mmax)} / ${fmt(e.Mmin)}</td>`).join('')}</tr>`;
            html += `<tr><td>Vmax / Vmin</td>${envs.map(e => `<td class="num">${fmt(e.Vmax)} / ${fmt(e.Vmin)}</td>`).join('')}</tr>`;
            html += `<tr><td>Nmax / Nmin</td>${envs.map(e => `<td class="num">${fmt(e.Nmax)} / ${fmt(e.Nmin)}</td>`).join('')}</tr>`;
        }
        html += '</table>';
    }
    modal({ title: '계산 결과 보기', width: 900, height: 620, body: h('div', { class: 'report', html }) });
}

function showCombos(ctx) {
    const o = opt(ctx);
    const kinds = ['factored', 'factoredEcc', 'service', 'eqCollapse', 'eqFunction'];
    const wrap = h('div');
    const tabs = h('div', { class: 'dlg-tabs', style: { background: 'transparent' } });
    const body = h('div', { style: { marginTop: '4px' } });
    let curKind = 'factored';
    const show = () => {
        body.innerHTML = '';
        tabs.querySelectorAll('.dlg-tab').forEach(t => t.classList.toggle('active', t.dataset.k === curKind));
        const t = comboTable(ctx.p, ctx.c, curKind, o.check);
        if (!t.rows.length) { body.appendChild(h('div', {}, '이 조합 종류는 사용하지 않습니다.')); return; }
        new Grid(body, {
            id: 'combo-detail-' + curKind,
            head: [[{ t: 'LC' }, { t: '조합' }, ...t.keys.map(k => ({ t: k }))]],
            rows: t.rows.map(rw => ({ cells: [lbl(rw.lc), lbl(rw.name), ...rw.vals.map(v => lbl(v, { dec: 3 }))] })),
        });
    };
    for (const k of kinds) {
        const meta = COMBO_KINDS.find(x => x.id === k);
        const b = h('button', { class: 'dlg-tab', 'data-k': k }, meta ? (meta.title || meta.name || k) : k);
        b.addEventListener('click', () => { curKind = k; show(); });
        tabs.appendChild(b);
    }
    wrap.append(tabs, body);
    show();
    modal({
        title: '하중조합 상세', width: 980, height: 560, body: wrap, buttons: [
            { text: 'Excel 출력 (E)', onClick: () => { exportComboCsv(ctx, o.check); return false; } },
            { text: '닫기 (C)' },
        ],
    });
}

function exportComboCsv(ctx, check) {
    const lines = [];
    for (const k of ['factored', 'factoredEcc', 'service', 'eqCollapse', 'eqFunction']) {
        const t = comboTable(ctx.p, ctx.c, k, check);
        if (!t.rows.length) continue;
        lines.push(`[${k}]`);
        lines.push(['LC', '조합', ...t.keys].join(','));
        t.rows.forEach(rw => lines.push([rw.lc, rw.name, ...rw.vals.map(v => v ?? '')].join(',')));
        lines.push('');
    }
    downloadText('﻿' + lines.join('\r\n'), '하중조합상세.csv', 'text/csv;charset=utf-8');
}

/** SAP2000 v7 .s2k 텍스트 (검증용) */
function exportS2k(ctx) {
    const r = runSafe(ctx);
    if (!r) return;
    const m = r.model;
    const L = [];
    L.push(`; ESC Culvert - ${ctx.c.name} 단면 ${r.cond.name}`);
    L.push('SYSTEM', '  DOF=UX,UZ,RY  LENGTH=M  FORCE=KN  PAGE=SECTIONS', '');
    L.push('JOINT');
    m.nodes.forEach((n, i) => L.push(`  ${i + 1}  X=${n.x.toFixed(4)}  Y=0  Z=${n.y.toFixed(4)}`));
    L.push('', 'MATERIAL', `  NAME=CONC  IDES=C  E=${m.members[0].E}  U=0.17  W=24.5`, '');
    const secs = new Map();
    m.members.forEach(mb => { const k = `T${Math.round(mb.h * 1000)}R${Math.round((mb.A / mb.h) * 1000)}`; if (!secs.has(k)) secs.set(k, mb); });
    L.push('FRAME SECTION');
    for (const [k, mb] of secs) L.push(`  NAME=${k}  MAT=CONC  SH=R  T=${mb.h.toFixed(3)},${(mb.A / mb.h).toFixed(3)}`);
    L.push('', 'FRAME');
    m.members.forEach((mb, i) => L.push(`  ${i + 1}  J=${mb.i + 1},${mb.j + 1}  SEC=T${Math.round(mb.h * 1000)}R${Math.round((mb.A / mb.h) * 1000)}`));
    L.push('', 'SPRING');
    m.springs.forEach(s => { if (!s.stab) L.push(`  ADD=${s.node + 1}  ${s.dir === 'y' ? 'UZ' : 'UX'}=${s.k.toFixed(3)}`); });
    L.push('', 'LOAD');
    for (const cs of r.cases) {
        if (cs.eq) continue;
        L.push(`  NAME=${cs.key}  CSYS=0`);
        const ld = toSolverLoad(m, cs.lc);
        L.push('    TYPE=TRAPEZOIDAL');
        for (const q of ld.dist) {
            const mb = m.members[q.member];
            const Lm = Math.hypot(m.nodes[mb.j].x - m.nodes[mb.i].x, m.nodes[mb.j].y - m.nodes[mb.i].y);
            L.push(`      ADD=${q.member + 1}  DIR=${q.dir === 'gx' ? 'X' : 'Z'}  DIST=${(q.a / Lm).toFixed(4)},${(q.b / Lm).toFixed(4)}  VAL=${q.w1.toFixed(4)},${q.w2.toFixed(4)}  RD=R`);
        }
        if (ld.point.length) {
            L.push('    TYPE=CONCENTRATED SPAN');
            for (const q of ld.point) L.push(`      ADD=${q.member + 1}  DIR=${q.dir === 'gx' ? 'X' : 'Z'}  DIST=${q.pos.toFixed(4)}  VAL=${q.P.toFixed(4)}  RD=A`);
        }
    }
    L.push('', 'COMBO');
    for (const cb of r.combos) {
        if (cb.eq) continue;
        L.push(`  NAME=${cb.name}  TYPE=ADD`);
        for (const [k, f] of Object.entries(cb.factors)) L.push(`    LOAD=${k}  SF=${f}`);
    }
    L.push('', 'END');
    downloadText(L.join('\r\n'), `${ctx.c.name}_${r.cond.name}.s2k`, 'text/plain;charset=utf-8');
}
