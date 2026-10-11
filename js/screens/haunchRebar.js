// 배근 입력 > 헌치, 단절점부 및 브래킷 (매뉴얼 5.6)
// 탭: 헌치철근 | 단절점부철근 | 브래킷철근 (브래킷이 있을 때)
// 데이터/형상: calc/rebarHaunch.js (culverts[i].rebar.haunch[bi], culverts[i].rebar.bracket)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bCheck, alertBox } from '../ui/dom.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import { sectionOf } from '../core/model.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { drawSection, sectionTextHeight } from '../draw/sectionDraw.js';
import { drawBars, OTHER_COLOR, BAR_COLOR } from '../draw/rebarDraw.js';
import { DIAS, mainBarLayout } from '../calc/rebar.js';
import {
    HAUNCH_SHAPES, haunchColumns, haunchRows, defaultHaunchRebar, defaultBracketRebar, getHaunchRebar,
    haunchBarLayout, cornerBarLayout,
} from '../calc/rebarHaunch.js';
import { ensure, ensureSettings, liveModal, sameKindBlocks } from './rebarSet.js';

const ui = { cycle: 1 };
const DIA_OPT = [{ value: '', label: '' }, ...DIAS.map(d => ({ value: d, label: d }))];
const CNT = (n) => Array.from({ length: n }, (_, i) => ({ value: i + 1, label: `${i + 1}개` }));

function hasBracket(c) {
    const nb = Math.max(1, (c.joints || []).length - 1);
    for (let bi = 0; bi < nb; bi++) { const s = sectionOf(c, bi); if (s && s.bracket && s.bracket.use) return true; }
    return false;
}

const hp = (ctx) => `${ctx.cp}.rebar.haunch.${ctx.bi}`;

export default {
    scope: 'culvert',
    perBlock: (ctx) => ctx.tab !== 'bracket',
    hint: '헌치철근, 단절점부(우각부) 철근, 브래킷 철근의 직경과 배치를 입력합니다.',

    tabs(ctx) {
        const t = [{ id: 'haunch', title: '헌치철근' }, { id: 'corner', title: '단절점부철근' }];
        if (hasBracket(ctx.c)) t.push({ id: 'bracket', title: '브래킷철근' });
        return t;
    },

    header(el, ctx) {
        const w = h('span', { class: 'radio-group' });
        const name = 'hc' + Math.random().toString(36).slice(2);
        for (const v of [1, 2]) {
            const r = h('input', { type: 'radio', name, value: v });
            r.checked = ui.cycle === v;
            r.addEventListener('change', () => { ui.cycle = v; ctx.rerender(); });
            w.appendChild(h('label', {}, [r, `${v}Cycle 보기`]));
        }
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [w]));
    },

    render(el, ctx, tab) {
        ensureSettings(ctx);
        const g = sectionGeom(ctx.c, ctx.bi);
        if (tab === 'bracket') return renderBracket(el, ctx);
        ensure(hp(ctx), () => defaultHaunchRebar(g));
        if (tab === 'corner') renderCorner(el, ctx, g);
        else renderHaunch(el, ctx, g);
    },

    footer(el, ctx, tab) {
        el.appendChild(button('모든 블럭 동일 적용', () => {
            const src = clone(store.get(hp(ctx)));
            store.transact(() => { for (const b of sameKindBlocks(ctx)) store.set(`${ctx.cp}.rebar.haunch.${b}`, clone(src)); });
            ctx.setHint('현재 블록의 헌치·단절점부 철근을 같은 형식의 모든 블록에 적용했습니다.');
        }, { disabled: tab === 'bracket' || ctx.blocks.length < 2 }));
        if (tab === 'corner') el.appendChild(button('단절점부 절곡부 입력', () => bendPopup(ctx)));
        el.appendChild(button('설계검토', () => alertBox(tab === 'corner'
            ? '단절점부 설계검토: 우각부 모멘트(단면검토 결과)가 필요합니다.\n[단면 검토 위치 설정] 및 해석 후 확인하세요.'
            : '브래킷 설계검토: 브래킷 작용하중(덮개 하중)과 단면검토 결과가 필요합니다.'), { disabled: tab === 'haunch' }));
    },

    defaults(ctx, tab) {
        const g = sectionGeom(ctx.c, ctx.bi);
        const d = defaultHaunchRebar(g);
        if (tab === 'bracket') store.set(`${ctx.cp}.rebar.bracket`, defaultBracketRebar());
        else if (tab === 'corner') store.set(`${hp(ctx)}.corner`, d.corner);
        else store.set(`${hp(ctx)}.haunch`, d.haunch);
    },

    draw(ctx, tab) {
        const p = ctx.p, c = ctx.c, bi = ctx.bi;
        const d = new Drawing({ textHeight: sectionTextHeight(c, bi) });
        drawSection(d, c, bi, { simple: true });
        const lay = mainBarLayout(p, c, bi, { cycles: [ui.cycle === 2 ? 2 : 1], layers: [1] });
        drawBars(d, lay, lay.bars, { color: tab === 'haunch' || tab === 'corner' ? OTHER_COLOR : BAR_COLOR, lapOffset: 0 });
        const th = d.textHeight;
        const mark = (b, anchor, dir) => {
            const r = th * 0.7;
            const q = [anchor[0] + dir[0] * th * 2.2, anchor[1] + dir[1] * th * 2.2];
            d.line(anchor[0], anchor[1], q[0] - dir[0] * r, q[1] - dir[1] * r, { color: COLOR.RED, layer: 'MARK' });
            d.bubble(q[0], q[1], b.mark, { r, color: COLOR.RED, textColor: COLOR.GREEN });
            d.text(q[0] + r * 1.3, q[1], `${b.dia}  L=${fmtLen(b.length)}`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
        };
        if (tab === 'corner') {
            const cl = cornerBarLayout(p, c, bi, ui.cycle);
            for (const b of cl.bars) d.pline(b.pts, { color: BAR_COLOR, layer: 'REBAR' });
            const done = new Set();
            for (const b of cl.bars) {
                if (done.has(b.mark + b.corner)) continue;
                done.add(b.mark + b.corner);
                const a = b.pts[Math.floor(b.pts.length / 2)];
                mark(b, a, [b.corner[1] === 'L' ? 0.7 : -0.7, b.corner[0] === 'T' ? -0.7 : 0.7]);
            }
        } else {
            const hl = haunchBarLayout(p, c, bi, ui.cycle);
            for (const b of hl.bars) d.pline(b.pts, { color: BAR_COLOR, layer: 'REBAR' });
            const seen = new Set();
            for (const b of hl.bars) {
                const k = `${b.row}|${b.col}|${b.mark}`;
                if (seen.has(k)) continue;
                seen.add(k);
                const a = [(b.pts[0][0] + b.pts[1][0]) / 2, (b.pts[0][1] + b.pts[1][1]) / 2];
                mark(b, a, [b.corner[1] === 'L' ? 0.6 : -0.6, b.row === 'top' ? -0.8 : 0.8]);
            }
            if (!hl.bars.length) d.legend = '헌치가 없거나 헌치철근 직경이 비어 있습니다.';
        }
        const g = lay.g;
        d.text(g.W / 2, -th * 2.5, `${ui.cycle}Cycle`, { color: COLOR.GREEN, h: th, valign: 'top' });
        if (!d.legend) d.legend = `${ui.cycle}Cycle`;
        return d;
    },
    viewKey: (ctx) => `haunchRebar|${ctx.ci}|${ctx.bi}`,
};

// ── 헌치철근 ─────────────────────────────────────────────────────────

function renderHaunch(el, ctx, g) {
    const data = getHaunchRebar(ctx.c, ctx.bi, g);
    const cols = haunchColumns(g);
    const head0 = [{ t: '구분', rs: 2 }], head1 = [];
    for (const col of cols) {
        head0.push({ t: col.title, cs: col.mid ? 3 : 2 });
        head1.push({ t: '1Cycle' }, { t: '2Cycle' });
        if (col.mid) head1.push({ t: '철근형태' });
    }
    const rows = haunchRows(g).map(r => {
        const cells = [];
        for (const col of cols) {
            const base = `${hp(ctx)}.haunch.${r.key}.${col.key}`;
            const cur = data.haunch[r.key][col.key];
            for (const cy of ['c1', 'c2']) {
                cells.push(custom('select', () => cur[cy] ?? '', (v) => store.set(`${base}.${cy}`, v), { options: DIA_OPT, hint: `${r.title} ${col.title} 헌치철근 ${cy === 'c1' ? 1 : 2}Cycle 직경 (빈칸 = 배치안함)` }));
            }
            if (col.mid) cells.push(custom('select', () => cur.shape || 'V 형', (v) => store.set(`${base}.shape`, v), { options: HAUNCH_SHAPES, hint: '중간벽체 헌치철근 형태 (X 형: 벽을 가로질러 교차, V 형: 벽 중심에서 만남)' }));
        }
        return { head: [{ t: r.title }], cells };
    });
    new Grid(el, { id: `haunch-${cols.length}`, head: [head0, head1], rows });
    el.appendChild(h('div', { class: 'note' }, '* 헌치가 설치된 모서리에만 배치됩니다. 직경 빈칸은 해당 Cycle 에 철근을 두지 않습니다.'));
}

// ── 단절점부철근 ─────────────────────────────────────────────────────

const CORNER_KEYS = ['TL', 'TR', 'BL', 'BR'];

function renderCorner(el, ctx, g) {
    const base = `${hp(ctx)}.corner`;
    const data = getHaunchRebar(ctx.c, ctx.bi, g).corner;
    const noTop = g.kind === 'U';
    const rows = [0, 1, 2].map(li => {
        const ly = data.layers[li] || {};
        const off = !ly.use;
        const cells = [chk(`${base}.layers.${li}.use`, { hint: `${li + 1}단 단절점부 철근 배치` })];
        for (const k of CORNER_KEYS) for (const cy of [1, 2]) {
            if (noTop && k[0] === 'T') { cells.push(dash()); continue; }
            const p = `${base}.layers.${li}.d.${k}${cy}`;
            cells.push(off ? lbl((ly.d || {})[`${k}${cy}`] || '', { cls: 'ro', disabled: true })
                : custom('select', () => store.get(p) ?? '', (v) => store.set(p, v), { options: DIA_OPT, hint: `${li + 1}단 ${k[0] === 'T' ? '상부' : '하부'} ${k[1] === 'L' ? '좌측' : '우측'} ${cy}Cycle 직경` }));
        }
        return { head: [{ t: `${li + 1}단` }], cells };
    });
    rows.push({ head: [{ t: '스터럽', rs: 2 }], cells: [lbl('', { cls: 'ro' }), ...CORNER_KEYS.flatMap(() => [lbl('직경', { cls: 'ro', align: 'center' }), lbl('개수', { cls: 'ro', align: 'center' })])] });
    rows.push({
        cells: [lbl('', { cls: 'ro' }), ...CORNER_KEYS.flatMap(k => (noTop && k[0] === 'T' ? [dash(), dash()] : [
            custom('select', () => store.get(`${base}.stirrup.${k}.dia`) ?? data.stirrup[k].dia, (v) => store.set(`${base}.stirrup.${k}.dia`, v), { options: DIAS, hint: '스터럽 직경' }),
            custom('select', () => store.get(`${base}.stirrup.${k}.n`) ?? data.stirrup[k].n, (v) => store.set(`${base}.stirrup.${k}.n`, +v), { options: CNT(6), hint: '스터럽 개수' }),
        ]))],
    });
    new Grid(el, {
        id: 'corner-rebar',
        head: [
            [{ t: '구분', rs: 3 }, { t: '사용', rs: 3 }, { t: '상부', cs: 4 }, { t: '하부', cs: 4 }],
            [{ t: '좌측', cs: 2 }, { t: '우측', cs: 2 }, { t: '좌측', cs: 2 }, { t: '우측', cs: 2 }],
            Array.from({ length: 4 }, () => [{ t: '1Cycle' }, { t: '2Cycle' }]).flat(),
        ],
        rows,
    });
    el.appendChild(h('div', { class: 'note' }, '* 1,2,3단 = Cycle 별 단절점부(우각부) 보강철근 직경, 스터럽 = 직경과 개수.'));
}

function bendPopup(ctx) {
    const base = `${hp(ctx)}.corner.bend`;
    liveModal('단절점부 절곡부 입력', (body) => {
        const g = sectionGeom(store.get('culverts.' + ctx.ci), ctx.bi);
        const data = getHaunchRebar(store.get('culverts.' + ctx.ci), ctx.bi, g).corner.bend;
        if (store.get(base) == null) store.set(base, data, { record: false, silent: true });
        body.appendChild(h('div', { style: { margin: '4px' } }, [bCheck(`${base}.use`, ' 단절점부 절곡부 입력값 적용')]));
        const grp = (key, title) => {
            const items = [0, 1, 2].map(i => h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '3px 0' } }, [
                bCheck(`${base}.${key}.${i}.use`, ` ${i + 1}단`, { disabled: !data.use }),
                (() => {
                    const inp = h('input', { type: 'text', style: { width: '60px', textAlign: 'right' }, disabled: !data.use });
                    inp.value = (data[key][i] || {}).v ?? '';
                    inp.addEventListener('change', () => store.set(`${base}.${key}.${i}.v`, +inp.value || 0));
                    return inp;
                })(),
            ]));
            return h('fieldset', { style: { display: 'inline-block', margin: '4px', padding: '4px 10px' } }, [h('legend', {}, title), ...items]);
        };
        if (g.kind !== 'U') body.appendChild(grp('top', '상부슬래브'));
        body.appendChild(grp('bottom', '하부슬래브'));
        body.appendChild(h('div', { class: 'note' }, '* 값 = 단별 단절점부 철근 절곡부의 대각 길이 (m).'));
        body.appendChild(button('기본값(D)', () => store.set(base, defaultHaunchRebar(g).corner.bend)));
    }, { buttons: [{ text: '확 인', primary: true }] });
}

// ── 브래킷철근 ───────────────────────────────────────────────────────

function renderBracket(el, ctx) {
    const bp = ensure(`${ctx.cp}.rebar.bracket`, defaultBracketRebar);
    const data = store.get(bp);
    const nS = Math.max(1, ...['L', 'R'].map(s => (data[s] && data[s].n) || 1));
    const head1 = [{ t: '직경' }, { t: '1Cycle' }, { t: '2Cycle' }, { t: '직경' }, { t: '구간수' }];
    for (let i = 0; i < nS; i++) head1.push({ t: `S${i + 1}` });
    head1.push({ t: '주철근 구간수' }, { t: '수평철근 배치' });
    const rows = [['L', '좌측'], ['R', '우측']].map(([s, t]) => {
        const b = `${bp}.${s}`;
        const v = data[s] || {};
        const cells = [
            custom('select', () => v.dia, (x) => store.set(`${b}.dia`, x), { options: DIAS, hint: '브래킷 주철근 직경' }),
            chk(`${b}.c1`, { hint: '1Cycle 배치' }), chk(`${b}.c2`, { hint: '2Cycle 배치' }),
            custom('select', () => v.sDia, (x) => store.set(`${b}.sDia`, x), { options: DIAS, hint: '폐합스터럽 직경' }),
            custom('select', () => v.n, (x) => {
                const n = +x;
                const S = (v.S || []).slice(0, n);
                while (S.length < n) S.push(S[S.length - 1] || 300);
                store.transact(() => { store.set(`${b}.n`, n); store.set(`${b}.S`, S); });
            }, { options: CNT(6), hint: '폐합스터럽 구간수 (S1..Sn 생성)' }),
        ];
        for (let i = 0; i < nS; i++) cells.push(i < (v.n || 0) ? num(`${b}.S.${i}`, { dec: 3, hint: `S${i + 1}: 브래킷 상단에서의 거리 (mm)` }) : dash());
        cells.push(custom('select', () => v.mainN, (x) => store.set(`${b}.mainN`, +x), { options: CNT(10), hint: '종방향으로 폐합스터럽이 감싸는 주철근 수' }));
        cells.push(chk(`${b}.horz`, { hint: '브래킷 수평철근 배치' }));
        return { head: [{ t }], cells };
    });
    new Grid(el, {
        id: 'bracket-rebar',
        head: [[{ t: '구분', rs: 2 }, { t: '주철근', cs: 3 }, { t: '폐합스터럽', cs: 4 + nS }], head1],
        rows,
    });
}
