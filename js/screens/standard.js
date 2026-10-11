// 기본 설정 > 암거 표준도 (매뉴얼 1.2)
// 도로암거표준도(2008)의 BOX 본체 치수를 확인하고 선택한 표준도를 현재 암거 단면에 적용한다.
// 통로 1련/2련, 수로 1련/2련/3련 (날개벽은 포함하지 않음)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { lbl, dash } from '../ui/cells.js';
import { h, button, bCheck, alertBox, confirmBox } from '../ui/dom.js';
import { Drawing, COLOR, fmtLen } from '../cad/drawing.js';
import { cellPolygon } from '../calc/sectionGeom.js';
import { resizeSection, defaultBoxSection } from '../core/model.js';
import { STD_TABS, COVERS, standardDB, findStandard, applyStandardToSection } from '../calc/standardDB.js';

const CY = COLOR.CYAN;

function stdData() {
    const s = store.project.standard || {};
    return { applied: !!s.applied, autoDB: s.autoDB !== false, tab: s.tab, pick: s.pick || null };
}

function pickOf(tab) {
    const s = stdData();
    if (s.pick && s.pick.tab === tab) return s.pick;
    // 탭의 첫 코드
    const t = standardDB()[tab];
    const code = t && t.rows[0] && t.rows[0].codes[0];
    return code ? { tab, code, cover: COVERS[0], row: 0, col: 0 } : null;
}

export default {
    scope: 'project',
    hint: '도로암거표준도(2008)의 BOX 제원입니다. 표준도 코드를 선택한 후 [적용] 하면 현재 암거의 단면제원에 반영됩니다.',

    tabs: () => STD_TABS.map(t => ({ id: t.id, title: t.title })),

    render(el, ctx, tab) {
        const t = standardDB()[tab];
        if (!t) return;
        const pk = pickOf(tab);
        const head0 = [{ t: '내공치수(m)', cs: 2 }, { t: '적용토피(m)', cs: COVERS.length }];
        const head1 = [{ t: 'B' }, { t: 'H' }, ...COVERS.map(cv => ({ t: cv.toFixed(1), cls: pk && pk.cover === cv ? 'act' : '' }))];
        const rows = t.rows.map((r, ri) => ({
            head: [{ t: r.B.toFixed(1), cls: pk && pk.row === ri ? 'grp' : '' }, { t: r.H.toFixed(1), cls: pk && pk.row === ri ? 'grp' : '' }],
            cells: r.codes.map((code, ci) => (code
                ? lbl(code, { cls: 'ro', align: 'center', hint: `${code} : ${describe(findStandard(code))}`, std: { code, row: ri, col: ci } })
                : dash({ align: 'center' }))),
        }));
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        new Grid(left, {
            id: 'std-' + tab,
            head: [head0, head1],
            rows,
            colWidths: [50, 50, ...COVERS.map(() => 58)],
            onSelect: (cell) => {
                if (!cell.std) return;
                const cur = stdData().pick;
                const next = { tab, code: cell.std.code, cover: COVERS[cell.std.col], row: cell.std.row, col: cell.std.col };
                if (cur && JSON.stringify(cur) === JSON.stringify(next)) return;
                store.set('standard.pick', next, { record: false });
                store.set('standard.tab', tab, { record: false, silent: true });
            },
        });
        wrap.appendChild(left);
        const it = pk && findStandard(pk.code);
        el.appendChild(wrap);
        el.appendChild(h('div', { class: 'note', style: { marginTop: '4px' } },
            it ? `선택 : ${it.code} (${it.title}, 적용토피 ${pk.cover.toFixed(1)} m)  —  ${describe(it)}` : '표준도 코드를 선택하십시오.'));
        el.appendChild(h('div', { class: 'note' }, '* 선택한 표준도는 [적용(A)] 또는 [현재 암거에 적용] 버튼으로 현재 암거의 단면 제원(Box형)에 반영됩니다.'));
    },

    footer(el, ctx, tab) {
        el.appendChild(bCheck('standard.applied', ' 표준도 적용 프로젝트', { title: '입력 및 출력을 도로암거표준도 형식에 맞추는 경우 선택합니다.' }));
        el.appendChild(bCheck('standard.autoDB', ' DB 자동 불러오기', { title: '프로그램 설치 폴더의 표준도 DB 파일을 자동으로 불러옵니다.' }));
        el.appendChild(button('현재 암거에 적용', () => applyPick(ctx, tab)));
    },

    defaults() {
        store.set('standard', { applied: false, autoDB: true, tab: 0, pick: null });
    },

    apply(ctx) { applyPick(ctx, ctx.tab); },

    draw(ctx, tab) {
        const pk = pickOf(tab);
        const it = pk && findStandard(pk.code);
        if (!it) { const d = new Drawing(); d.emptyMessage = '표준도를 선택하십시오.'; return d; }
        return drawStandard(it, pk.cover);
    },
    viewKey: (ctx, tab) => `standard|${tab}`,
};

function describe(it) {
    if (!it) return '';
    const n = it.cells;
    return `B=${it.B}${n > 1 ? `×${n}련` : ''}, H=${it.H}, 상부슬래브 ${it.UT}, 하부슬래브 ${it.LT}, 측벽 ${it.WL}${n > 1 ? `, 중간벽 ${it.C}` : ''}, 헌치 ${it.haunch} (mm)`;
}

async function applyPick(ctx, tab) {
    const pk = pickOf(tab);
    const it = pk && findStandard(pk.code);
    if (!it) { alertBox('적용할 표준도 코드를 선택하십시오.'); return; }
    const c = ctx.c;
    if (!c) return;
    if (c.type === 'U형' || c.type === '복층형') {
        alertBox(`암거 표준도는 BOX 본체에만 적용됩니다.\n현재 암거 [${c.name}] 의 형식(${c.type})에는 적용할 수 없습니다.`);
        return;
    }
    const ok = await confirmBox(`표준도 ${it.code} 의 제원을\n암거 ${ctx.ci + 1} : ${c.name} 의 단면 제원에 적용합니다.\n\n${describe(it)}\n\n계속하시겠습니까?`, '암거 표준도');
    if (!ok) return;
    store.transact(() => {
        const cur = clone(c.section && c.section.H != null && c.section.H1 == null ? c.section : defaultBoxSection(it.cells));
        store.set(`${ctx.cp}.section`, applyStandardToSection(cur, it, resizeSection));
        if (c.type === '지하차도') {
            (c.blockSections || []).forEach((bs, i) => {
                if (bs && bs.H != null && bs.H1 == null) store.set(`${ctx.cp}.blockSections.${i}`, applyStandardToSection(clone(bs), it, resizeSection));
            });
        }
        store.set('standard.pick', pk, { record: false });
    });
    ctx.setHint && ctx.setHint(`표준도 ${it.code} 를 [${c.name}] 단면 제원에 적용했습니다. (Ctrl+Z 로 취소)`);
}

/** 표준도 BOX 단면 + 토피 */
function drawStandard(it, cover) {
    const n = it.cells;
    const W = it.WL + n * it.B + (n - 1) * it.C + it.WR;
    const Htot = it.LT + it.H + it.UT;
    const d = new Drawing({ textHeight: Math.max(100, Math.max(W, Htot + cover * 1000) / 40) });
    const th = d.textHeight;
    const st = { color: CY, layer: 'CONC' };
    // 버림
    const lw = 100, lt = 100;
    d.pline([[-lw, -lt], [W + lw, -lt], [W + lw, 0], [-lw, 0]], { ...st, closed: true });
    // 외곽 / 내공
    d.rect(0, 0, W, Htot, st);
    const hc = { use: true, type: '삼각형', S2: it.haunch, W2: it.haunch };
    const xs = [];
    let x = it.WL;
    for (let i = 0; i < n; i++) {
        xs.push([x, x + it.B]);
        d.pline(cellPolygon(x, x + it.B, it.LT, it.LT + it.H, { UL: hc, UR: hc, LL: hc, LR: hc }), { ...st, closed: true });
        x += it.B + (i < n - 1 ? it.C : 0);
    }
    // 지반선 + 토사 기호
    const yG = Htot + cover * 1000;
    const gx0 = -W * 0.25, gx1 = W * 1.25;
    d.line(gx0, yG, gx1, yG, { color: COLOR.GREEN, layer: 'GROUND' });
    const zz = [];
    const sx = W * 0.5 - th * 2;
    for (let k = 0; k <= 8; k++) zz.push([sx + k * th * 0.5, yG + (k % 2 ? th * 0.45 : 0)]);
    d.pline(zz, { color: COLOR.WHITE, layer: 'GROUND' });
    d.text(sx + th * 2, yG + th * 0.8, `토피 ${cover.toFixed(1)} m`, { color: COLOR.GREEN, h: th * 0.8, layer: 'TEXT' });
    // 우측 치수
    const xr = W + lw + th * 3;
    d.dimChainV([-lt, 0, it.LT, it.LT + it.H, Htot, yG], W, xr, [String(lt), fmtLen(it.LT), fmtLen(it.H), fmtLen(it.UT), fmtLen(cover * 1000)]);
    d.dimV(0, Htot, W, xr + th * 2.6);
    // 하부 치수
    const bx = [0];
    xs.forEach(([a, b]) => bx.push(a, b));
    bx.push(W);
    d.dimChainH(bx, -lt, -lt - th * 3);
    d.dimH(0, W, -lt, -lt - th * 5.6);
    // 제목
    d.text(W / 2, yG + th * 2.4, `${it.code}  (${it.title}  ${(it.B / 1000).toFixed(1)}×${(it.H / 1000).toFixed(1)})`, { color: COLOR.YELLOW, h: th, layer: 'TEXT' });
    d.legend = `${it.code} : ${describe(it)}`;
    return d;
}
