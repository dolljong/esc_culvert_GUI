// 출력 > 옹벽 구조계산서 (매뉴얼 m3 2장 "옹벽 구조계산서 출력")
//
// 옹벽식 날개벽이 있는 암거에서만 사용. 날개벽 위치 선택 → 계산서 미리보기 / Excel 출력 / 삽도 DXF.
// 계산은 js/calc/retainingWall.js 의 wallDesign (wallReport.js 가 동적 import).
//
// 데이터: project.output.wallReport = { wing: { [ci]: 'SR' }, chapters: { id: bool }, figures }

import store from '../core/store.js';
import { h, box, button, alertBox } from '../ui/dom.js';
import { WALL_CHAPTERS, wallWings, buildWallReport } from '../calc/wallReport.js';
import { previewReport, saveExcel, figuresDialog } from './reportOut.js';
import { Drawing } from '../cad/drawing.js';

const P = 'output.wallReport';
let last = null;          // { report, name, ci, key }
let drawCache = null;     // { key, drawing }

function opt(ctx) {
    const o = (ctx.p.output && ctx.p.output.wallReport) || {};
    const wings = wallWings(ctx.c);
    const want = o.wing && o.wing[ctx.ci];
    const wing = wings.find(w => w.key === want) ? want : (wings[0] && wings[0].key);
    const chapters = {};
    for (const ch of WALL_CHAPTERS) chapters[ch.id] = !(o.chapters && o.chapters[ch.id] === false);
    return { wings, wing, chapters, figures: o.figures !== false, cover: o.cover !== false, toc: o.toc !== false };
}
const setO = (path, v) => store.set(`${P}.${path}`, v, { record: false });

async function buildNow(ctx) {
    const o = opt(ctx);
    if (!o.wing) { alertBox('옹벽식 날개벽이 없습니다. (상세입력 > 날개벽 위치)'); return null; }
    const chapters = WALL_CHAPTERS.filter(ch => o.chapters[ch.id]).map(ch => ch.id);
    if (!chapters.length) { alertBox('출력할 항목을 하나 이상 선택하십시오.'); return null; }
    ctx.setHint('옹벽 구조계산서 작성 중…');
    const report = await buildWallReport(ctx.p, ctx.c, o.wing, { chapters, figures: o.figures, cover: o.cover, toc: o.toc });
    if (report.error) { ctx.setHint(report.error, true); alertBox(report.error); return null; }
    const name = `${(ctx.p.info && ctx.p.info.projectName) || 'ESC'}_${ctx.c.name || '암거'}_${o.wing}_옹벽구조계산서`.replace(/[\\/:*?"<>|\s]+/g, '_');
    last = { report, name, ci: ctx.ci, key: o.wing };
    ctx.setHint(`옹벽 구조계산서를 만들었습니다 (${report.ok ? '전체 O.K' : 'N.G 항목 있음'}).`);
    return last;
}

function run(ctx, fn) {
    buildNow(ctx).then(r => { if (r) { fn(r); ctx.rerender(); } }).catch(e => { console.error(e); alertBox('계산서 작성 오류: ' + e.message); });
}

export default {
    scope: 'culvert',
    enabled: (ctx) => {
        try { return wallWings(ctx.c).length > 0; } catch { return false; }
    },
    hint: '옹벽식 날개벽의 구조계산서를 출력합니다.',

    render(el, ctx) {
        const o = opt(ctx);
        if (!o.wings.length) {
            el.appendChild(box('옹벽 구조계산서 출력', [h('div', { style: { padding: '6px' } }, '이 암거에는 옹벽식 날개벽이 없습니다. 상세입력 > 날개벽 위치에서 형식을 "옹벽식" 으로 선택하십시오.')]));
            return;
        }
        const wingSel = h('select', {});
        o.wings.forEach(w => { const op = h('option', { value: w.key }, w.name); if (w.key === o.wing) op.selected = true; wingSel.appendChild(op); });
        wingSel.addEventListener('change', () => setO(`wing.${ctx.ci}`, wingSel.value));
        const target = box('출력 대상', [
            h('div', { class: 'opt' }, ['암거명 : ', h('b', {}, `암거 ${ctx.ci + 1} : ${ctx.c.name || ''}`)]),
            h('div', { class: 'opt' }, ['날개벽 위치 : ', wingSel]),
        ]);
        const tree = h('div', { style: { padding: '2px 4px' } });
        WALL_CHAPTERS.forEach((ch, i) => {
            const cb = h('input', { type: 'checkbox' });
            cb.checked = o.chapters[ch.id];
            cb.addEventListener('change', () => setO(`chapters.${ch.id}`, cb.checked));
            tree.appendChild(h('label', { class: 'opt' }, [cb, `${i + 1}. ${ch.title}`]));
        });
        const flag = (key, label, val) => {
            const cb = h('input', { type: 'checkbox' });
            cb.checked = val;
            cb.addEventListener('change', () => setO(key, cb.checked));
            return h('label', { style: { display: 'inline-flex', gap: '3px', marginRight: '12px' } }, [cb, label]);
        };
        const items = box('출력 항목 (체크한 항목만 출력)', [
            tree,
            h('div', { class: 'opt' }, [
                button('전체선택', () => store.transact(() => WALL_CHAPTERS.forEach(ch => setO(`chapters.${ch.id}`, true)))),
                button('전체해제', () => store.transact(() => WALL_CHAPTERS.forEach(ch => setO(`chapters.${ch.id}`, false)))),
            ]),
            h('div', { class: 'opt' }, [flag('cover', '표지', o.cover), flag('toc', '목차', o.toc), flag('figures', '삽도 포함', o.figures)]),
        ]);
        const has = !!(last && last.ci === ctx.ci && last.key === o.wing);
        const runBox = box('출력', [
            h('div', { class: 'opt', style: { flexWrap: 'wrap', gap: '6px' } }, [
                button('미리보기', () => run(ctx, r => previewReport(r)), { cls: 'primary' }),
                button('출력(P)', () => run(ctx, r => saveExcel(r)), { title: 'Excel(.xls, 텍스트형) 로 저장' }),
                button('출력파일 열기', () => last && previewReport(last), { disabled: !has }),
                button('삽입도면 보기', () => (has ? figuresDialog(last) : run(ctx, r => figuresDialog(r)))),
            ]),
            h('div', { style: { fontSize: '11px', color: '#333', padding: '2px' } }, has ? `최근 작성: ${last.report.title} (${last.report.ok ? '전체 O.K' : 'N.G 항목 있음'})` : ''),
        ]);
        el.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: '6px', alignItems: 'start' } }, [
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [target, runBox]), items,
        ]));
    },

    draw(ctx) {
        const o = opt(ctx);
        if (!o.wing) { const d = new Drawing(); d.emptyMessage = '옹벽식 날개벽 없음'; return d; }
        const key = `${ctx.ci}|${o.wing}|${JSON.stringify(ctx.c.wings || {})}`;
        if (drawCache && drawCache.key === key && drawCache.drawing) return drawCache.drawing;
        // 단면 그림은 비동기 모듈 → 준비되면 다시 그린다
        if (!drawCache || drawCache.key !== key) {
            drawCache = { key, drawing: null };
            buildWallReport(ctx.p, ctx.c, o.wing, { chapters: ['loads'], cover: false, toc: false })
                .then(r => { if (drawCache && drawCache.key === key && r && r.figures && r.figures[0]) { drawCache.drawing = r.figures[0].drawing; ctx.redraw(); } })
                .catch(() => {});
        }
        const d = new Drawing();
        d.emptyMessage = '옹벽 단면 준비 중…';
        return d;
    },
    viewKey: (ctx) => `wallrep|${ctx.ci}|${opt(ctx).wing}|${drawCache && drawCache.drawing ? 1 : 0}`,
};
