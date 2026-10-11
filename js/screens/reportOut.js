// 출력 > 구조계산서 (매뉴얼 m3 2장 "구조계산서 출력")
//
// 대상 암거(머리줄) · 검토단면 (개별 / 선택 / 모든 타입) · 출력 항목(장 트리, 체크된 것만 출력) 을 고르고
//   [미리보기]       계산서 HTML 모달 (인쇄 = 새 창 window.print)
//   [출력(P)]        Excel (SpreadsheetML 2003 .xls, 셀 참조 없는 텍스트형) 내려받기
//   [출력파일 열기]  마지막으로 만든 계산서 다시 보기
//   [삽입도면 보기]  계산서 삽도 (Pic 탭) 보기 + DXF 저장
// 확인창(위)은 트리에서 선택한 장의 대표 그림.
//
// 데이터: project.output.report = { mode:'single'|'select'|'all', view, chapters:{id:bool}, figures, loadFigures, checks:{ [ci]: { one, list:[k] } } }

import store from '../core/store.js';
import { h, box, button, modal, alertBox } from '../ui/dom.js';
import { getChecks, sectionName } from '../calc/loadHelpers.js';
import { CHAPTERS, buildReport, reportToExcelXml, reportDocument, reportFiguresDrawing, chapterFigure } from '../calc/report.js';
import { drawingToSvg } from '../draw/svgExport.js';
import { drawingToDxf, downloadText } from '../cad/dxfWriter.js';
import { Drawing } from '../cad/drawing.js';

const P = 'output.report';
let last = null;          // { report, name }

function opt(ctx) {
    const o = (ctx.p.output && ctx.p.output.report) || {};
    const chapters = {};
    for (const ch of CHAPTERS) chapters[ch.id] = !(o.chapters && o.chapters[ch.id] === false);
    const cks = (o.checks && o.checks[ctx.ci]) || {};
    return {
        mode: o.mode || 'single', view: o.view || 'section', figures: o.figures !== false, loadFigures: o.loadFigures !== false,
        cover: o.cover !== false, toc: o.toc !== false,
        chapters, one: cks.one | 0, list: Array.isArray(cks.list) ? cks.list : [0],
    };
}
const setO = (path, v) => store.set(`${P}.${path}`, v, { record: false });

function checkNames(ctx) {
    return getChecks(ctx.p, ctx.c).rows.map((r, i) => r.name || sectionName(i));
}

function selectedChecks(ctx, o) {
    const n = checkNames(ctx).length;
    if (o.mode === 'all') return [...Array(n).keys()];
    if (o.mode === 'select') { const l = o.list.filter(k => k < n); return l.length ? l : [0]; }
    return [Math.min(o.one, n - 1)];
}

function buildNow(ctx) {
    const o = opt(ctx);
    const chapters = CHAPTERS.filter(ch => o.chapters[ch.id]).map(ch => ch.id);
    if (!chapters.length) { alertBox('출력할 항목을 하나 이상 선택하십시오.'); return null; }
    const t0 = performance.now();
    const report = buildReport(ctx.p, ctx.c, {
        checks: selectedChecks(ctx, o), chapters, figures: o.figures, loadFigures: o.loadFigures && o.figures, cover: o.cover, toc: o.toc,
    });
    const name = `${(ctx.p.info && ctx.p.info.projectName) || 'ESC'}_${ctx.c.name || '암거'}_구조계산서`.replace(/[\\/:*?"<>|\s]+/g, '_');
    last = { report, name, ci: ctx.ci };
    ctx.setHint(`구조계산서를 만들었습니다: ${report.chapters.length}장, 삽도 ${report.figures.length}개 (${Math.round(performance.now() - t0)} ms)`);
    return last;
}

/** 계산이 무거우므로 안내 표시 후 다음 틱에 실행 */
function withBusy(ctx, fn) {
    ctx.setHint('구조계산서 작성 중… (해석·단면검토 수행)');
    setTimeout(() => {
        try { fn(); } catch (e) { console.error(e); ctx.setHint('계산서 작성 오류: ' + e.message, true); alertBox('계산서 작성 중 오류가 발생했습니다.\n' + e.message); }
    }, 30);
}

export function printReport(report) {
    const w = window.open('', '_blank');
    if (!w) { alertBox('팝업이 차단되어 인쇄 창을 열 수 없습니다. 브라우저의 팝업 허용 후 다시 시도하십시오.'); return; }
    w.document.open();
    w.document.write(reportDocument(report));
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* 사용자 취소 */ } }, 400);
}

export function previewReport(rep, extraButtons = []) {
    const { report, name } = rep;
    const toc = h('div', { style: { width: '170px', flex: '0 0 170px', overflow: 'auto', borderRight: '1px solid #9db8de', paddingRight: '4px', fontSize: '12px' } });
    const body = h('div', { style: { flex: '1', overflow: 'auto', background: '#fff' }, html: report.html });
    for (const t of report.toc) {
        toc.appendChild(h('div', {
            style: { cursor: 'pointer', padding: '2px 4px', fontWeight: 'bold' },
            onclick: () => { const s = body.querySelector(`section[data-chapter="${t.id}"]`); if (s) body.scrollTop = s.offsetTop - body.offsetTop; },
        }, `${t.no}. ${t.title}`));
    }
    const wrap = h('div', { style: { display: 'flex', gap: '6px', height: '100%', minHeight: '0' } }, [toc, body]);
    const m = modal({
        title: `구조계산서 미리보기 — ${report.title}`, width: 1060, height: 720, body: wrap,
        buttons: [
            { text: '인쇄(P)', onClick: () => { printReport(report); return false; } },
            { text: 'Excel 저장', onClick: () => { saveExcel(rep); return false; } },
            ...extraButtons,
            { text: '닫기(C)', primary: true },
        ],
    });
    m.body.style.display = 'flex';
    m.body.style.flexDirection = 'column';
    m.body.style.minHeight = '0';
    return m;
}

export function saveExcel(rep) {
    downloadText(reportToExcelXml(rep.report), `${rep.name}.xls`, 'application/vnd.ms-excel');
}

/** 삽입도면 보기 (계산서 삽도 Pic 탭) */
export function figuresDialog(rep) {
    const figs = rep.report.figures;
    if (!figs.length) { alertBox('삽도가 없습니다. 출력 옵션의 [삽도 포함] 을 확인하십시오.'); return; }
    let cur = 0;
    const tabs = h('div', { style: { display: 'flex', gap: '2px', flexWrap: 'wrap', marginBottom: '4px', maxHeight: '58px', overflow: 'auto' } });
    const view = h('div', { style: { background: '#fff', border: '1px solid #7393c6', height: '470px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
    const cap = h('div', { style: { padding: '2px 4px', fontWeight: 'bold' } });
    const all = h('input', { type: 'checkbox' });
    const show = () => {
        tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === cur));
        const f = figs[cur];
        view.innerHTML = drawingToSvg(f.drawing, { width: 760, height: 460 });
        cap.textContent = `[Pic ${f.no}] ${f.title}`;
    };
    figs.forEach((f, i) => tabs.appendChild(button(`Pic ${f.no}`, () => { cur = i; show(); }, { title: f.title })));
    const body = h('div', { style: { width: '780px' } }, [tabs, cap, view, h('label', { style: { display: 'inline-flex', gap: '4px', marginTop: '4px' } }, [all, '전체파일 저장 (모든 삽도를 한 DXF 로)'])]);
    modal({
        title: '계산서 삽도 보기', body, width: 810,
        buttons: [
            {
                text: 'DXF파일로 저장', onClick: () => {
                    let d;
                    if (all.checked) d = reportFiguresDrawing(rep.report);
                    else { d = new Drawing({ textHeight: figs[cur].drawing.textHeight }); d.merge(figs[cur].drawing); }
                    downloadText(drawingToDxf(d), `${rep.name}${all.checked ? '_삽도' : `_Pic${figs[cur].no}`}.dxf`, 'application/dxf');
                    return false;
                },
            },
            { text: '확 인', primary: true },
        ],
    });
    show();
}

export default {
    scope: 'culvert',
    hint: '구조계산서를 출력합니다. 검토단면과 출력 항목을 선택한 후 [미리보기] 또는 [출력] 을 누르십시오.',

    render(el, ctx) {
        const o = opt(ctx);
        const names = checkNames(ctx);
        // ── 출력 대상 ──
        const radio = (mode, label) => {
            const r = h('input', { type: 'radio', name: 'rep-mode' });
            r.checked = o.mode === mode;
            r.addEventListener('change', () => r.checked && setO('mode', mode));
            return h('label', { style: { display: 'inline-flex', gap: '4px', alignItems: 'center', minWidth: '120px' } }, [r, label]);
        };
        const oneSel = h('select', { disabled: o.mode !== 'single' });
        names.forEach((n, i) => { const op = h('option', { value: i }, `${ctx.c.name || '암거'} - ${n}`); if (i === o.one) op.selected = true; oneSel.appendChild(op); });
        oneSel.addEventListener('change', () => setO(`checks.${ctx.ci}.one`, +oneSel.value));
        const multi = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '2px 12px', paddingLeft: '22px', opacity: o.mode === 'select' ? 1 : 0.5 } });
        names.forEach((n, i) => {
            const cb = h('input', { type: 'checkbox', disabled: o.mode !== 'select' });
            cb.checked = o.list.includes(i);
            cb.addEventListener('change', () => {
                const s = new Set(o.list);
                if (cb.checked) s.add(i); else s.delete(i);
                setO(`checks.${ctx.ci}.list`, [...s].sort((a, b) => a - b));
            });
            multi.appendChild(h('label', { style: { display: 'inline-flex', gap: '3px' } }, [cb, n]));
        });
        const target = box('출력 대상', [
            h('div', { class: 'opt' }, ['암거명 : ', h('b', {}, `암거 ${ctx.ci + 1} : ${ctx.c.name || ''}`)]),
            h('div', { class: 'opt' }, [radio('single', '개별 타입 출력'), oneSel]),
            h('div', { class: 'opt' }, [radio('select', '선택 타입 출력')]), multi,
            h('div', { class: 'opt' }, [radio('all', `모든 타입 출력 (${names.length}개)`)]),
        ]);
        // ── 출력 항목 ──
        const tree = h('div', { style: { padding: '2px 4px' } });
        CHAPTERS.forEach((ch, i) => {
            const cb = h('input', { type: 'checkbox' });
            cb.checked = o.chapters[ch.id];
            cb.addEventListener('change', () => setO(`chapters.${ch.id}`, cb.checked));
            const lab = h('span', {
                style: { cursor: 'pointer', padding: '0 4px', background: o.view === ch.id ? '#ffd979' : '', borderRadius: '2px' },
                title: '클릭하면 확인창에 이 장의 대표 그림을 표시합니다',
                onclick: () => setO('view', ch.id),
            }, `${i + 1}. ${ch.title}`);
            tree.appendChild(h('div', { class: 'opt' }, [cb, lab]));
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
                button('전체선택', () => store.transact(() => CHAPTERS.forEach(ch => setO(`chapters.${ch.id}`, true)))),
                button('전체해제', () => store.transact(() => CHAPTERS.forEach(ch => setO(`chapters.${ch.id}`, false)))),
            ]),
            h('div', { class: 'opt', style: { flexWrap: 'wrap' } }, [
                flag('cover', '표지', o.cover), flag('toc', '목차', o.toc), flag('figures', '삽도 포함', o.figures), flag('loadFigures', '하중재하도 포함', o.loadFigures),
            ]),
        ]);
        // ── 실행 ──
        const has = !!(last && last.ci === ctx.ci);
        const run = box('출력', [
            h('div', { class: 'opt', style: { flexWrap: 'wrap', gap: '6px' } }, [
                button('미리보기', () => withBusy(ctx, () => { const r = buildNow(ctx); if (r) { previewReport(r); ctx.rerender(); } }), { cls: 'primary' }),
                button('출력(P)', () => withBusy(ctx, () => { const r = buildNow(ctx); if (r) { saveExcel(r); ctx.rerender(); } }), { title: 'Excel(.xls, 텍스트형) 로 저장' }),
                button('출력파일 열기', () => last && previewReport(last), { disabled: !has, title: '마지막으로 만든 계산서를 다시 엽니다' }),
                button('삽입도면 보기', () => withBusy(ctx, () => { const r = (last && last.ci === ctx.ci) ? last : buildNow(ctx); if (r) figuresDialog(r); })),
            ]),
            h('div', { style: { fontSize: '11px', color: '#333', padding: '2px' } }, has
                ? `최근 작성: ${last.report.title} — ${last.report.checkNames.join(', ')} (${last.report.chapters.length}장, 삽도 ${last.report.figures.length}개)`
                : 'Excel 출력은 셀 참조가 없는 텍스트형 계산서(SpreadsheetML .xls)입니다.'),
        ]);
        el.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: '6px', alignItems: 'start' } }, [
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [target, run]), items,
        ]));
    },

    draw(ctx) {
        const o = opt(ctx);
        const k = selectedChecks(ctx, o)[0] || 0;
        try { return chapterFigure(ctx.p, ctx.c, k, o.view); } catch (e) {
            const d = new Drawing();
            d.emptyMessage = '그림 생성 오류: ' + e.message;
            return d;
        }
    },
    viewKey: (ctx) => { const o = opt(ctx); return `rep|${ctx.ci}|${o.view}|${selectedChecks(ctx, o)[0]}`; },
};
