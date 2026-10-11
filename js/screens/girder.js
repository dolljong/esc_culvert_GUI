// 구조 계산 > 종방향 거더 해석
// 중간벽체가 사각기둥/원형기둥인 경우 기둥을 지점으로 하는 종방향 연속보(상부/하부/중간 거더)를 해석하고
// 휨·전단·균열·철근비를 검토한다. 계산은 calc/girder.js, 거더 철근은 [배근 입력 > 보, 기둥 철근].

import { Grid } from '../ui/grid.js';
import { lbl } from '../ui/cells.js';
import { h } from '../ui/dom.js';
import { fmtLen } from '../cad/drawing.js';
import { columnWalls, hasColumns } from '../calc/beamCol.js';
import { girderAnalysis } from '../calc/girder.js';
import { girderDrawing } from '../draw/girderDraw.js';

const ui = { wi: null, mem: 'top', diag: 'BMD' };
const f = (v, n = 1) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(n));
const ok = (v) => (v == null ? lbl('-', { align: 'center' }) : lbl(v ? 'O.K' : 'N.G', { align: 'center', cls: v ? '' : 'ng' }));

function walls(ctx) {
    try { return columnWalls(ctx.c, ctx.bi); } catch { return []; }
}

function result(ctx) {
    const ws = walls(ctx);
    if (!ws.length) return null;
    if (!ws.some(w => w.index === ui.wi)) ui.wi = ws[0].index;
    let ga = null;
    try { ga = girderAnalysis(ctx.p, ctx.c, ctx.bi, ui.wi); } catch (e) { console.error(e); ctx.setHint('거더 해석 오류: ' + e.message, true); return null; }
    if (ga && !ga.girders.some(g => g.mem === ui.mem)) ui.mem = ga.girders[0] ? ga.girders[0].mem : 'top';
    return ga;
}

const curGirder = (ga) => (ga ? ga.girders.find(g => g.mem === ui.mem) : null);

export default {
    scope: 'culvert',
    perBlock: true,
    enabled: (ctx) => !ctx.c || hasColumns(ctx.c),
    hint: '기둥을 지점으로 하는 종방향 거더의 단면력을 산정하고 휨, 전단, 균열을 검토합니다.',

    tabs() {
        return [{ id: 'force', title: '단면력' }, { id: 'check', title: '설계검토' }];
    },

    header(el, ctx) {
        const ws = walls(ctx);
        if (!ws.length) { el.appendChild(h('span', { class: 'note' }, '이 블록에는 기둥이 없습니다.')); return; }
        const ga = result(ctx);
        const wsel = h('select', {});
        for (const w of ws) { const o = h('option', { value: w.index }, `벽체 ${w.index + 1}`); if (w.index === ui.wi) o.selected = true; wsel.appendChild(o); }
        wsel.addEventListener('change', () => { ui.wi = +wsel.value; ctx.rerender(); });
        el.appendChild(h('label', {}, ['벽체 ', wsel]));
        const ms = h('select', {});
        for (const g of (ga ? ga.girders : [])) { const o = h('option', { value: g.mem }, g.title); if (g.mem === ui.mem) o.selected = true; ms.appendChild(o); }
        ms.addEventListener('change', () => { ui.mem = ms.value; ctx.rerender(); });
        el.appendChild(h('label', {}, [' 부재 ', ms]));
        const ds = h('select', {});
        for (const [v, t] of [['BMD', '휨모멘트도'], ['SFD', '전단력도']]) { const o = h('option', { value: v }, t); if (v === ui.diag) o.selected = true; ds.appendChild(o); }
        ds.addEventListener('change', () => { ui.diag = ds.value; ctx.redraw(); });
        el.appendChild(h('label', {}, [' 보기 ', ds]));
        const g = curGirder(ga);
        if (g) el.appendChild(h('span', { style: { marginLeft: 'auto' } }, `${g.method} · bw × h = ${g.bw} × ${g.h} mm`));
    },

    render(el, ctx, tab) {
        const ga = result(ctx);
        if (!ga) { el.appendChild(h('div', { class: 'note' }, '현재 블록의 중간벽체가 기둥(사각기둥/원형기둥)이 아닙니다. [일반 입력 > 단면 제원]에서 벽체 형식을 기둥으로 지정하세요.')); return; }
        if (ga.err) el.appendChild(h('div', { class: 'note', style: { color: '#c00' } }, `* 2D Frame 해석 오류: ${ga.err}`));
        const g = curGirder(ga);
        if (!g) return;
        if (tab === 'check') return renderCheck(el, g);
        // 하중
        const dir = g.mem === 'bottom' ? '위 방향 (지반반력)' : '아래 방향';
        const wTitle = g.mem === 'top' ? '중간벽체 상단 축력' : g.mem === 'bottom' ? '중간벽체 하단 축력' : '하층 벽체 상단 − 상층 벽체 하단 축력';
        new Grid(el, {
            id: 'gd-load',
            head: [[{ t: '구분' }, { t: '거더 하중 w (kN/m)' }, { t: '조합' }, { t: '비고' }]],
            rows: [
                { head: [{ t: '극한 최대' }], cells: [lbl(f(g.ult && g.ult.wMax, 2)), lbl(g.ult ? g.ult.at : '-', { align: 'center' }), lbl(`${wTitle}, ${dir}`)] },
                { head: [{ t: '극한 최소' }], cells: [lbl(f(g.ult && g.ult.wMin, 2)), lbl(g.ult ? g.ult.atMin : '-', { align: 'center' }), lbl('')] },
                { head: [{ t: '사용 최대' }], cells: [lbl(f(g.sv && g.sv.wMax, 2)), lbl(g.sv ? g.sv.at : '-', { align: 'center' }), lbl('균열 검토용')] },
            ],
            colWidths: [80, 120, 80, 320],
        });
        // 경간
        const cols = g.layout.cols;
        el.appendChild(h('div', { style: { fontWeight: 'bold', margin: '8px 4px 4px' } }, '기둥 배치 및 지점 반력'));
        new Grid(el, {
            id: 'gd-sup',
            head: [[{ t: '지점' }, { t: '위치 (mm)' }, { t: '기둥 두께 (mm)' }, { t: '좌측 경간 (mm)' }, { t: '반력 Ru (kN)' }]],
            rows: cols.map((q, k) => ({
                head: [{ t: String(k + 1) }],
                cells: [lbl(f(q.u, 0)), lbl(f(q.t, 0)), lbl(f(k ? q.u - cols[k - 1].u : q.u, 0)), lbl(f(g.reactions && g.reactions[k], 1))],
            })),
            colWidths: [50, 90, 100, 100, 100],
        });
        el.appendChild(h('div', { class: 'note' }, `* 블록 길이 ${fmtLen(g.layout.L)} mm, 기둥 중심 단순지지 연속보 (양단 내민보). 횡방향 해석의 단위폭 축력을 거더 등분포하중으로 적용하며 모든 경간에 같은 비율로 재하됩니다.`));
    },

    draw(ctx) {
        const ga = result(ctx);
        const g = curGirder(ga);
        if (!g || !g.beam) return null;
        return girderDrawing(g, ui.diag);
    },

    viewKey: (ctx) => `girder|${ctx.ci}|${ctx.bi}|${ui.wi}|${ui.mem}|${ui.diag}`,
};

function renderCheck(el, g) {
    new Grid(el, {
        id: 'gd-chk',
        head: [
            [{ t: '검토위치', rs: 2 }, { t: '인장면', rs: 2 }, { t: '철근비', cs: 2 }, { t: '휨강도', cs: 3 }, { t: '전단강도', cs: 5 }, { t: '균열', cs: 3 }],
            [{ t: 'ρ' }, { t: '판정' }, { t: 'Mu (kN·m)' }, { t: 'φMn' }, { t: '판정' }, { t: 'Vu (kN)' }, { t: 'φVn' }, { t: '판정' }, { t: 's / smax' }, { t: '판정' }, { t: 'Ms (kN·m)' }, { t: g.sections[0] && g.sections[0].cr && g.sections[0].cr.method === '균열폭' ? 'w / wa' : 's / sa' }, { t: '판정' }],
        ],
        rows: g.sections.map(s => ({
            cells: [
                lbl(s.label), lbl(s.face, { align: 'center' }),
                lbl(f(s.rho, 4)), ok(s.okRho),
                lbl(f(s.Mu)), lbl(f(s.phiMn)), ok(s.okM),
                lbl(s.vUnit ? f(s.Vu) : '-'), lbl(s.vUnit ? f(s.phiVn) : '-'), ok(s.okV),
                lbl(s.vUnit ? `${f(s.stirS, 0)} / ${f(s.sMax, 0)}` : '-'), ok(s.okS),
                lbl(f(s.Ms)), lbl(!s.cr ? '-' : s.cr.method === '균열폭' ? `${f(s.cr.w, 3)} / ${f(s.cr.wa, 3)}` : `${f(s.cr.s, 0)} / ${f(s.cr.sAllow, 0)}`), ok(s.okCr),
            ],
        })),
        colWidths: [130, 50, 60, 45, 75, 65, 45, 65, 65, 45, 75, 45, 70, 85, 45],
    });
    el.appendChild(h('div', { class: 'note' }, `* 단면 bw × h = ${g.bw} × ${g.h} mm, As(상면) = ${f(g.AsU, 0)} mm², As(하면) = ${f(g.AsL, 0)} mm², fck = ${g.fck} MPa, fy = ${g.fy} MPa. 철근은 [배근 입력 > 보, 기둥 철근]의 입력값.`));
}
