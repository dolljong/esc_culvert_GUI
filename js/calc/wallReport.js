// wallReport.js - 옹벽식 날개벽 구조계산서 (출력 > 옹벽 구조계산서)
//
// retainingWall.js 의 wallDesign(p, c, wingId) 결과를 report.js 와 같은 장/블록 구조로 바꾼다
// → 같은 HTML/Excel(SpreadsheetML)/DXF 출력 함수를 그대로 쓸 수 있다.
// retainingWall.js 는 다른 작업자가 소유 → 동적 import, 결과 형식은 방어적으로 읽는다.
//
// buildWallReport(p, c, wingId, opts) → Promise<report | { error }>
//   report = { title, project, checks:[], checkNames:[name], toc, chapters, figures, html, ok }

import { reportHtml } from './report.js';
import { Drawing } from '../cad/drawing.js';
import { WING_KEYS, WING_NAMES, installedWings } from './wingGeom.js';

export const WALL_CHAPTERS = [
    { id: 'summary', title: '해석결과요약' },
    { id: 'design', title: '설계조건' },
    { id: 'loads', title: '단면가정, 하중계산' },
    { id: 'stability', title: '안정검토' },
    { id: 'members', title: '단면설계 및 철근량 검토' },
];

const n0 = (v) => (isFinite(+v) ? +v : 0);
const fx = (v, d = 2) => (v == null || !isFinite(v) ? '-' : (+v).toFixed(d));
const f2 = (v) => fx(v, 2), f3 = (v) => fx(v, 3);
const num = (v, d = 2) => ({ v: fx(v, d), cls: 'num' });
const OK = (b) => (b == null ? { v: '-' } : { v: b ? 'O.K' : 'N.G', cls: b ? 'ok' : 'ng' });

/** 옹벽식 날개벽 목록 [{ key, name }] */
export function wallWings(c) {
    try {
        return installedWings(c).filter(w => w.type === '옹벽식');
    } catch {
        const pos = (c && c.wings && c.wings.pos) || {};
        return WING_KEYS.filter(k => pos[k] && pos[k].type === '옹벽식').map(k => ({ key: k, name: `${WING_NAMES[k]}-옹벽식` }));
    }
}

let modCache = null;
async function wallModule() {
    if (modCache) return modCache;
    try { modCache = await import('./retainingWall.js'); } catch (e) { modCache = { error: e }; }
    return modCache;
}

function wallFigure(c, wingId, sections) {
    return import('../draw/wingDraw.js').then(m => {
        const rows = sections.map(s => s.row).filter(Boolean);
        if (!rows.length || !m.drawWallSection) return null;
        const maxW = Math.max(...rows.map(r => n0(r.B1) + n0(r.B2) + n0(r.B3)), 1000);
        const d = new Drawing({ textHeight: Math.max(80, maxW / 30) });
        rows.forEach((r, i) => {
            try { m.drawWallSection(d, r, i * maxW * 1.8, 0, i === 0 ? '_s' : '_e', { names: false, title: sections[i].label }); } catch { /* 형상 오류 무시 */ }
        });
        return d;
    }).catch(() => null);
}

export async function buildWallReport(p, c, wingId, opts = {}) {
    const mod = await wallModule();
    if (!mod || typeof mod.wallDesign !== 'function') return { error: '옹벽 구조계산 모듈(retainingWall.js)을 불러올 수 없습니다.' };
    let r;
    try { r = mod.wallDesign(p, c, wingId); } catch (e) { return { error: '옹벽 구조계산 오류: ' + e.message }; }
    if (!r || r.error) return { error: (r && r.error) || '계산 결과 없음' };
    const sections = Array.isArray(r.sections) ? r.sections : [];
    const P = r.params || {};
    const figures = [];
    const sel = opts.chapters && opts.chapters.length ? WALL_CHAPTERS.filter(x => opts.chapters.includes(x.id)) : WALL_CHAPTERS;
    const fig = opts.figures === false ? null : await wallFigure(c, wingId, sections);
    const chapters = sel.map((meta, i) => {
        const B = [];
        const subs = [];
        const h2 = (t) => { B.push({ t: 'h2', text: t }); subs.push(t); };
        const eq = (t) => B.push({ t: /O\.K|N\.G/.test(t) ? 'eqk' : 'eq', text: t });
        const table = (head, rows) => B.push({ t: 'table', head, rows });
        try {
            if (meta.id === 'summary') {
                table([['단면', '구분', '판정']], sections.flatMap(s => [
                    [s.label, '안정검토 (전도·활동·지지력)', OK((s.stability || []).every(x => x.ok))],
                    [s.label, '단면검토 (휨·전단·균열)', OK((s.members || []).every(x => x.ok))],
                ]));
                eq(`종합 판정 : ${r.ok ? 'O.K' : 'N.G'}`);
            } else if (meta.id === 'design') {
                table([['구분', '내용']], [
                    ['재료', `fck = ${P.fck} MPa, fy = ${P.fy} MPa, γc = ${P.gc} kN/m³`],
                    ['뒷채움', `γ = ${P.gamma} kN/m³, φ = ${P.phi}°, 상재하중 q = ${P.q} kN/m²`],
                    ['토압', `${P.earthP || ''} — 평상시 ${P.method || ''}, 지진시 ${P.seisMethod || ''}`],
                    ['지진', P.seisOn ? `A = ${P.A}, kh = ${f3(P.kh)}` : '내진해석 하지않음'],
                    ['안전율', P.fs ? `전도 ${P.fs.overN} (지진시 ${P.fs.overE}), 활동 ${P.fs.slideN} (지진시 ${P.fs.slideE})` : '-'],
                    ['기초지반', P.found ? `γ = ${P.found.gamma} kN/m³, φ = ${f2(P.found.phi)}°, c = ${P.found.c} kN/m², Df = ${P.found.Df} m, ${P.found.type || ''}` : '-'],
                ]);
                const cb = r.comb || {};
                const rows = [];
                for (const [k, t] of [['factored', '계수'], ['service', '사용']]) for (const row of cb[k] || []) rows.push([t, row.name, ...['D', 'L', 'H', 'E'].map(x => (n0(row.f && row.f[x]) ? num(row.f[x]) : '')), row.found !== false ? '●' : '', row.wall !== false ? '●' : '']);
                if (rows.length) { h2('하중조합'); table([['구분', '조합', 'D', 'L', 'H', 'E', '기초', '벽체']], rows); }
            } else if (meta.id === 'loads') {
                if (fig) {
                    const no = figures.length + 1;
                    figures.push({ no, title: `${r.name} 단면`, drawing: fig, chapter: 'loads' });
                    B.push({ t: 'fig', no, title: `${r.name} 단면`, drawing: fig });
                }
                for (const s of sections) {
                    const g = s.geom || {};
                    h2(s.label);
                    eq(`기초폭 B = ${f3(g.B)} m (앞굽 ${f3(g.B1)}, 벽체 ${f3(g.B3)}, 뒷굽 ${f3(g.B2)}), 전체높이 H = ${f3(g.WH)} m, 벽체높이 ${f3(g.hStem)} m`);
                    for (const l of (s.earth && s.earth.lines) || []) eq(l);
                    if (s.items && s.items.length) {
                        table([['항목', '구분', 'V (kN)', 'H (kN)', 'x (m)', 'y (m)', 'Mr (kN·m)', 'Mo (kN·m)']],
                            s.items.map(it => [it.name, it.cat, num(it.V), num(it.H), num(n0(g.B) - n0(it.x), 3), num(it.y, 3), num(n0(it.V) * (n0(g.B) - n0(it.x))), num(n0(it.H) * n0(it.y))]));
                    }
                }
            } else if (meta.id === 'stability') {
                for (const s of sections) {
                    h2(s.label);
                    // 자중 및 합력 위치: 단면을 사각형·삼각형으로 나눈 표 (안정검토의 D 하중과 같은 값)
                    const wt = s.weight;
                    if (wt && wt.pieces && typeof mod.weightRows === 'function') {
                        B.push({ t: 'h3', text: '자중 및 합력 위치 (단면 분할, 기준점 = 앞굽 끝)' });
                        const wfig = opts.figures === false || typeof mod.weightFigure !== 'function' ? null : mod.weightFigure(s);
                        if (wfig) {
                            const no = figures.length + 1, title = `${r.name} ${s.label} 자중 분할`;
                            figures.push({ no, title, drawing: wfig, chapter: 'stability' });
                            B.push({ t: 'fig', no, title, drawing: wfig });
                        }
                        const dg = mod.WEIGHT_DIGITS || [];
                        table([mod.WEIGHT_HEAD], mod.weightRows(wt).map(row => row.cells.map((v, k) => (dg[k] == null ? v : v == null ? '' : num(v, dg[k])))));
                        eq(`자중 합력 위치 x̄ = ΣW·x / ΣW = ${f2(wt.total.M)} / ${f2(wt.total.W)} = ${f3(wt.total.x)} m (앞굽 끝에서)`);
                        B.push({ t: 'h3', text: '안정검토' });
                    }
                    table([['조합', 'ΣV', 'ΣH', 'Mr', 'Mo', '전도 FS', '판정', 'e (허용)', '활동 FS', '판정', 'qmax', 'qa', '판정']],
                        (s.stability || []).map(st => [`${st.name}${st.seis ? ' (지진)' : ''}`, num(st.V), num(st.H), num(st.Mr), num(st.Mo),
                            `${f2(st.FSo)} ≥ ${st.fsO}`, OK(st.okO), `${f3(st.e)} (${f3(st.eAllow)})`, `${f2(st.FSs)} ≥ ${st.fsS}`, OK(st.okS),
                            num(Math.max(n0(st.q1), n0(st.q2))), num(st.qa), OK(st.okB)]));
                    for (const st of s.stability || []) if (st.qaLine) eq(`${st.name} : ${st.qaLine}`);
                }
            } else if (meta.id === 'members') {
                for (const s of sections) {
                    h2(s.label);
                    table([['부재', 'h (mm)', 'd (mm)', 'Mu (kN·m)', '조합', 'Vu (kN)', '사용철근', 'As (mm²)', '필요 (mm²)', 'φMn', '휨', 'φVc', '전단', '균열', '판정']],
                        (s.members || []).map(m => [m.name, num(m.h, 0), num(m.d, 0), num(m.Mu), m.combo || '-', num(m.Vu),
                            m.rebar ? `${m.rebar.dia}@${m.rebar.ctc}${m.rebar.user ? '' : ' (자동)'}` : '-', num(m.rebar && m.rebar.As), num(m.AsNeed),
                            num(m.phiMn), OK(m.okM), num(m.phiVc), OK(m.okV), m.crack ? OK(m.okCrack) : '-', OK(m.ok)]));
                    for (const m of s.members || []) if (m.note) B.push({ t: 'note', text: `※ ${m.name}: ${m.note}` });
                }
            }
        } catch (e) { B.push({ t: 'note', text: `[${meta.title}] 출력 오류: ${e.message}` }); }
        return { id: meta.id, no: i + 1, title: meta.title, subs, blocks: B };
    });
    const report = {
        title: `${c.name || ''} ${r.name} 구조계산서`.trim(), project: (p.info && p.info.projectName) || '',
        checks: [], checkNames: [r.name], chapters, figures, ok: r.ok, raw: r,
        toc: chapters.map(x => ({ id: x.id, no: x.no, title: x.title, subs: x.subs })),
    };
    report.html = reportHtml(report, { cover: opts.cover !== false, toc: opts.toc !== false, figWidth: opts.figWidth || 560 });
    return report;
}
