// 구조 계산 > 단면 검토 위치 설정 (매뉴얼 4.8)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, lbl, custom } from '../ui/cells.js';
import { h, button, bCheck, bSelect } from '../ui/dom.js';
import { COLOR } from '../cad/drawing.js';
import { designForces, getSecCheck, WALL_SHEAR_OPTS, SLAB_SHEAR_OPTS, MODEL_OPTS } from '../calc/designForces.js';
import { getChecks, sectionName } from '../calc/loadHelpers.js';
import { locate } from '../calc/frameModel.js';
import { newFrameDrawing, drawOutline, drawDiagram, drawModel, fmt } from '../draw/frameDraw.js';

let selCol = 0;

function view(ctx) {
    return { check: 0, diag: 'BMD', state: '평상시', nodeNo: false, memNo: false, values: true, ...(ctx.c.secView || {}) };
}
const setV = (ctx, k, v) => store.set(`${ctx.cp}.secView.${k}`, v, { record: false });

function forces(ctx) {
    try { return designForces(ctx.p, ctx.c, view(ctx).check); } catch (e) { console.error(e); ctx.setHint('해석 오류: ' + e.message, true); return null; }
}

/** 사용자 수정 열 저장 (계산 결과 필드 제외) */
function editCols(ctx, gid, fn) {
    const df = forces(ctx);
    const grp = df.groups.find(g => g.id === gid);
    const k = view(ctx).check;
    const cols = grp.cols.map(c => ({ label: c.label, span: c.span, s: c.s, model: c.model, faceA: c.faceA, faceB: c.faceB, sV: c.sV, modelV: c.modelV, faceV: c.faceV }));
    fn(cols);
    store.set(`${ctx.cp}.secCheck.custom.${k}.${gid}`, cols);
}

export default {
    scope: 'culvert',
    hint: '해석결과 후 단면내 검토위치를 설정합니다. 기본값 외에 임의위치를 추가할 수 있습니다.',

    tabs(ctx) {
        // 머리줄보다 먼저 호출되므로 여기서 기본값을 저장해 둔다
        if (!ctx.c.secView) store.set(`${ctx.cp}.secView`, view(ctx), { record: false, silent: true });
        if (!ctx.c.secCheck) store.set(`${ctx.cp}.secCheck`, getSecCheck(ctx.c), { record: false, silent: true });
        const df = forces(ctx);
        if (!df) return [{ id: 'top', title: '상부슬래브' }];
        return df.groups.map(g => ({ id: g.id, title: g.label.replace('좌측벽', '좌측벽체').replace('우측벽', '우측벽체') }));
    },

    header(el, ctx) {
        const v = view(ctx);
        const ch = getChecks(ctx.p, ctx.c);
        const s = h('select', {});
        ch.rows.forEach((row, i) => { const o = h('option', { value: i }, row.name || sectionName(i)); if (i === v.check) o.selected = true; s.appendChild(o); });
        s.addEventListener('change', () => setV(ctx, 'check', +s.value));
        el.appendChild(h('span', { class: 'sel-nav' }, [s,
            h('button', { class: 'nav-btn', onclick: () => v.check > 0 && setV(ctx, 'check', v.check - 1) }, '◀'),
            h('button', { class: 'nav-btn', onclick: () => v.check < ch.rows.length - 1 && setV(ctx, 'check', v.check + 1) }, '▶')]));
        el.appendChild(bSelect(`${ctx.cp}.secView.diag`, ['BMD', 'SFD'], { onChange: (x) => setV(ctx, 'diag', x) }));
        el.appendChild(bSelect(`${ctx.cp}.secView.state`, ['평상시', '지진시'], { onChange: (x) => setV(ctx, 'state', x) }));
        el.appendChild(h('span', { style: { marginLeft: 'auto', display: 'flex', gap: '8px' } }, [
            bCheck(`${ctx.cp}.secView.nodeNo`, ' 절점 번호', { onChange: (x) => setV(ctx, 'nodeNo', x) }),
            bCheck(`${ctx.cp}.secView.memNo`, ' 부재 번호', { onChange: (x) => setV(ctx, 'memNo', x) }),
            bCheck(`${ctx.cp}.secView.values`, ' 데이터 값', { onChange: (x) => setV(ctx, 'values', x) }),
        ]));
    },

    render(el, ctx, tab) {
        const df = forces(ctx);
        if (!df) return;
        const sc = getSecCheck(ctx.c);
        el.appendChild(h('div', { class: 'inline-opts', style: { marginBottom: '4px' } }, [
            h('label', {}, ['전단검토시 벽체 위험단면 위치 ', bSelect(`${ctx.cp}.secCheck.wallShear`, WALL_SHEAR_OPTS, { onChange: (x) => store.set(`${ctx.cp}.secCheck.wallShear`, x) })]),
            h('label', {}, ['전단검토시 슬래브 위험단면 위치 ', bSelect(`${ctx.cp}.secCheck.slabShear`, SLAB_SHEAR_OPTS, { onChange: (x) => store.set(`${ctx.cp}.secCheck.slabShear`, x) })]),
        ]));
        void sc;
        const grp = df.groups.find(g => g.id === tab) || df.groups[0];
        if (!grp) return;
        const cols = grp.cols;
        // 머리: 련(지간)별 묶음
        const head0 = [{ t: '구분', cs: 3, rs: 2 }];
        const head1 = [];
        let i = 0;
        while (i < cols.length) {
            let n = 1;
            while (i + n < cols.length && cols[i + n].span === cols[i].span) n++;
            head0.push({ t: grp.isSlab ? `${cols[i].span + 1}련` : '벽체', cs: n });
            for (let k = 0; k < n; k++) head1.push({ t: cols[i + k].label });
            i += n;
        }
        const setCol = (ci, key, val) => editCols(ctx, grp.id, (cs) => { cs[ci][key] = val; });
        const [fa, fb] = grp.faces;
        const mRow = (key, mk) => cols.map((c, ci) => mk(c, ci));
        const rows = [
            { head: [{ t: '모멘트', rs: 5 }, { t: '위치', rs: 1 }, { t: '거리(m)' }], cells: mRow('s', (c, ci) => custom('num', () => c.s, (v) => setCol(ci, 's', v), { dec: 3, hint: '부재군 시점(슬래브 좌측벽 중심, 벽체 하부슬래브 중심)에서의 거리 (m)' })) },
            { head: [{ t: '검토 (kN·m)', rs: 4 }, { t: '해석모델' }], cells: mRow('model', (c, ci) => custom('select', () => c.model || '자동', (v) => setCol(ci, 'model', v), { options: MODEL_OPTS, hint: `지배 해석모델: ${c.govModel}` })) },
            { head: [{ t: fa }], cells: mRow('A', (c, ci) => custom('check', () => !!c.faceA, (v) => setCol(ci, 'faceA', v), { text: fmt(c.M.A), hint: `${fa} 인장 설계모멘트 ${fmt(c.M.A)} kN·m (${c.comb.A || '-'}), 사용하중 ${fmt(c.Ms.A)}` })) },
            { head: [{ t: fb }], cells: mRow('B', (c, ci) => custom('check', () => !!c.faceB, (v) => setCol(ci, 'faceB', v), { text: fmt(c.M.B), hint: `${fb} 인장 설계모멘트 ${fmt(c.M.B)} kN·m (${c.comb.B || '-'}), 사용하중 ${fmt(c.Ms.B)}` })) },
            { head: [{ t: '축력 (kN)' }], cells: mRow('N', (c) => lbl(+(c.N.A || c.N.B || 0).toFixed(2), { cls: 'ro', hint: '설계모멘트 조합의 축력 (인장 +)' })) },
            { head: [{ t: '전단력', rs: 3 }, { t: '위치' }, { t: '거리(m)' }], cells: mRow('sV', (c, ci) => custom('num', () => c.sV, (v) => setCol(ci, 'sV', v), { dec: 3, hint: '전단 검토 위치 (m) — 위험단면 옵션으로 기본값 결정' })) },
            { head: [{ t: '검토 (kN)', rs: 2 }, { t: '해석모델' }], cells: mRow('modelV', (c, ci) => custom('select', () => c.modelV || '자동', (v) => setCol(ci, 'modelV', v), { options: MODEL_OPTS, hint: `지배 해석모델: ${c.govModelV}` })) },
            { head: [{ t: '최대값' }], cells: mRow('V', (c) => lbl(+c.V.toFixed(2), { cls: 'ro', hint: `조합 ${c.combV || '-'}` })) },
        ];
        new Grid(el, { id: 'secpos-' + grp.id, head: [head0, head1], rows, onSelect: (cell, r, c) => { selCol = c; } });
    },

    footer(el, ctx, tab) {
        const k = view(ctx).check;
        el.appendChild(button('선택 단면 기본값', () => store.set(`${ctx.cp}.secCheck.custom.${k}`, {})));
        el.appendChild(button('모든 단면 기본값', () => store.set(`${ctx.cp}.secCheck.custom`, {})));
        el.appendChild(button('검토 단면 추가', () => editCols(ctx, tab, (cs) => {
            const b = cs[Math.min(selCol, cs.length - 1)] || cs[0];
            cs.splice(Math.min(selCol, cs.length - 1) + 1, 0, { ...b, label: '사용자' });
        })));
        el.appendChild(button('검토 단면 삭제', () => editCols(ctx, tab, (cs) => { if (cs.length > 1) cs.splice(Math.min(selCol, cs.length - 1), 1); })));
    },

    defaults(ctx) {
        store.set(`${ctx.cp}.secCheck`, { wallShear: '슬래브연단에서 d위치', slabShear: '벽체 연단에서 d위치', custom: {} });
    },

    draw(ctx, tab) {
        const v = view(ctx);
        const df = forces(ctx);
        if (!df) return null;
        const r = df.r;
        const eq = v.state === '지진시';
        const model = eq ? r.modelEq : r.model;
        const d = newFrameDrawing(model);
        drawOutline(d, model);
        if (v.nodeNo || v.memNo) drawModel(d, model, { nodeNo: v.nodeNo, memNo: v.memNo, restraint: false });
        const kinds = eq ? ['eqCollapse', 'eqFunction'] : ['factored', 'factoredEcc'];
        const list = r.combos.filter(x => kinds.includes(x.kind) && x.res);
        const key = v.diag === 'SFD' ? 'V' : 'M';
        const env = (mi, x, pick) => {
            let best = pick === 'max' ? -Infinity : Infinity, out = { N: 0, V: 0, M: 0 };
            for (const cb of list) { const f = cb.res.at(mi, x); if (pick === 'max' ? f[key] > best : f[key] < best) { best = f[key]; out = f; } }
            return out;
        };
        let mx = 0;
        for (const cb of list) for (let mi = 0; mi < model.members.length; mi++) mx = Math.max(mx, Math.abs(cb.res.at(mi, 0)[key]));
        drawDiagram(d, model, (mi, x) => env(mi, x, 'max'), key, { values: false, color: COLOR.CYAN, maxAbs: mx });
        drawDiagram(d, model, (mi, x) => env(mi, x, 'min'), key, { values: false, color: COLOR.CYAN, maxAbs: mx });
        // 검토 위치 표시
        const th = d.textHeight;
        for (const grp of df.groups) {
            const active = grp.id === tab;
            for (const c of grp.cols) {
                const loc = locate(model, grp.id, key === 'V' ? (c.sV ?? c.s) : c.s);
                if (!loc) continue;
                const m = model.members[loc.m];
                const a = model.nodes[m.i], b = model.nodes[m.j];
                const L = Math.hypot(b.x - a.x, b.y - a.y);
                const x = (a.x + (b.x - a.x) * loc.x / L) * 1000, y = (a.y + (b.y - a.y) * loc.x / L) * 1000;
                d.circle(x, y, th * (active ? 0.3 : 0.18), { color: active ? COLOR.RED : COLOR.GRAY, fill: active ? COLOR.RED : null, layer: 'CHECK' });
                if (v.values && active) {
                    const val = key === 'V' ? c.V : (Math.abs(c.M.A) >= Math.abs(c.M.B) ? c.M.A : c.M.B);
                    const vertical = Math.abs(b.x - a.x) < 1e-9;
                    d.text(x + (vertical ? th * 0.6 : 0), y + (vertical ? 0 : th * 0.6), fmt(val), { color: COLOR.YELLOW, h: th * 0.6, rot: vertical ? 90 : 0, layer: 'VALUE' });
                }
            }
        }
        const bb = d.bbox();
        if (bb) d.text((bb.minX + bb.maxX) / 2, bb.maxY + th * 1.5, `${v.diag} - ${v.state}`, { color: COLOR.YELLOW, h: th * 1.1 });
        return d;
    },
    viewKey: (ctx) => `secpos|${ctx.ci}|${view(ctx).check}|${view(ctx).state}`,
};
