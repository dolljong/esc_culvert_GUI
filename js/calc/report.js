// report.js - 구조계산서 (출력 > 구조계산서, 매뉴얼 m3 2장)
//
// 계산 모듈(design/loads/combos/frame2d/designForces/rcDesign/rebar/buoyancy/pile)의 결과를
// 장(chapter) 단위의 블록 목록으로 모으고, 이것을 HTML(미리보기·인쇄) 과 SpreadsheetML 2003(.xls, 텍스트형) 으로 만든다.
//
// buildReport(p, c, opts) → {
//   title, toc: [{ id, no, title, subs:[...] }], html, chapters: [{ id, no, title, blocks }], figures: [{ no, title, drawing, chapter }]
// }
//   opts = { checks: [checkIndex...] (기본 [0]), chapters: [id...] (기본 전체), cover: true, toc: true,
//            figures: true, loadFigures: true, figWidth: 560 }
// reportToExcelXml(report) → SpreadsheetML 2003 XML 문자열 (장마다 워크시트 1개, 셀 참조 없는 텍스트)
// reportFiguresDrawing(report) → Drawing (모든 삽도를 격자로 배치, DXF 저장용)
//
// 블록 형식: { t:'h1'|'h2'|'h3'|'p'|'eq'|'note', text } | { t:'table', head:[[cell]], rows:[[cell]] } | { t:'fig', no, title, drawing }
//   cell = 문자열 | 숫자 | { v, cls:'ok'|'ng'|'num', cs, rs, dec }

import { getDesign, culvertK, K0, KaRankine } from './design.js';
import { loadCases } from './loads.js';
import { combos as comboList, comboTable, COMBO_KINDS } from './combos.js';
import { toSolverLoad } from './frameModel.js';
import { designForces } from './designForces.js';
import { flexure, requiredAs, pmCheck, shear as rcShear, crack as rcCrack, shrinkageRatio } from './rcDesign.js';
import { mainBarLayout, steelAt, barArea, barD, memberThickness } from './rebar.js';
import { horzLayout, horzAsAt, getHorzSet } from './rebarHorz.js';
import { horzCheck } from './rebarCheck.js';
import { buoyancyCheck, bearingCheck } from './buoyancy.js';
import { pileCapacity, pileSection, defaultPileSpec } from './pile.js';
import { getChecks, checkCondition, sectionName } from './loadHelpers.js';
import { sectionGeom, concreteArea } from './sectionGeom.js';
import { columnWalls, beamColCheck, hasColumns } from './beamCol.js';
import { girderAnalysis } from './girder.js';
import { girderDrawing } from '../draw/girderDraw.js';
import { blocks as blockList } from '../core/model.js';
import { foundRowOfBlock } from './foundType.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { sectionDrawing, drawSection } from '../draw/sectionDraw.js';
import { sectionPieces } from './sectionPieces.js';
import { newFrameDrawing, drawModel, drawOutline, drawDiagram, drawLoadCase } from '../draw/frameDraw.js';
import { drawingToSvg } from '../draw/svgExport.js';

// ── 장 목록 ──────────────────────────────────────────────────────────

export const CHAPTERS = [
    { id: 'design', title: '설계조건', perCheck: false },
    { id: 'section', title: '단면형상', perCheck: true },
    { id: 'loads', title: '하중산정', perCheck: true },
    { id: 'combos', title: '하중조합', perCheck: true },
    { id: 'analysis', title: '구조해석', perCheck: true },
    { id: 'members', title: '단면검토', perCheck: true },
    { id: 'buoy', title: '부력 및 지지력 검토', perCheck: true },
    { id: 'found', title: '기초 검토', perCheck: true },
    { id: 'horz', title: '수평철근 검토', perCheck: true },
    { id: 'girder', title: '기둥 및 종방향 거더 검토', perCheck: false },
];

/** 기본 철근 (배근 입력이 없을 때 가정) */
export const DEFAULT_BAR = { dia: 'D16', ctc: 250 };

// ── 숫자 형식 ────────────────────────────────────────────────────────

const fx = (v, d = 3) => (v == null || !isFinite(v) ? '-' : (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d));
const f0 = (v) => fx(v, 0), f1 = (v) => fx(v, 1), f2 = (v) => fx(v, 2), f3 = (v) => fx(v, 3), f4 = (v) => fx(v, 4), f5 = (v) => fx(v, 5);
const OK = (b, txt) => (b == null ? { v: '-' } : { v: txt || (b ? 'O.K' : 'N.G'), cls: b ? 'ok' : 'ng' });
const num = (v, d = 3) => ({ v: fx(v, d), cls: 'num' });

// ── 문서 빌더 ────────────────────────────────────────────────────────

class Doc {
    constructor(rep, chapter) { this.rep = rep; this.ch = chapter; this.blocks = []; }
    h2(text) { this.blocks.push({ t: 'h2', text }); this.ch.subs.push(text); return this; }
    h3(text) { this.blocks.push({ t: 'h3', text }); return this; }
    p(text) { this.blocks.push({ t: 'p', text }); return this; }
    eq(text) { this.blocks.push({ t: 'eq', text }); return this; }
    lines(arr) { for (const s of arr || []) this.blocks.push({ t: /O\.K|N\.G/.test(s) ? 'eqk' : 'eq', text: s }); return this; }
    note(text) { this.blocks.push({ t: 'note', text }); return this; }
    table(head, rows) { this.blocks.push({ t: 'table', head, rows }); return this; }
    fig(drawing, title) {
        if (!this.rep.opts.figures || !drawing) return this;
        const no = this.rep.figures.length + 1;
        this.rep.figures.push({ no, title, drawing, chapter: this.ch.id });
        this.blocks.push({ t: 'fig', no, title, drawing });
        return this;
    }
}

// ── 공용 계산 (검토단면별 캐시) ─────────────────────────────────────

function ctxFor(rep, k) {
    if (rep.cache.has(k)) return rep.cache.get(k);
    const { p, c } = rep;
    const cond = checkCondition(p, c, k, 'calc');
    const x = { k, cond, bi: cond.bi, g: cond.g, name: cond.name || sectionName(k) };
    let dfv;
    Object.defineProperty(x, 'df', { get() { if (dfv === undefined) { try { dfv = designForces(p, c, k); } catch (e) { dfv = null; x.dfError = e.message; } } return dfv; } });
    let lay;
    Object.defineProperty(x, 'layout', { get() { if (lay === undefined) { try { lay = mainBarLayout(p, c, x.bi); } catch (e) { lay = null; } } return lay; } });
    rep.cache.set(k, x);
    return x;
}

// ── 1. 설계조건 ─────────────────────────────────────────────────────

function chDesign(rep, doc) {
    const d = rep.d, e = d.env, cu = d.culvert;
    doc.h2('적용기준');
    doc.table([['구분', '내용']], [
        ['설계기준', e.code],
        ['콘크리트 기준', e.kci === 'KCI2003' ? '콘크리트구조설계기준 (2003)' : '콘크리트구조설계기준 (2007)'],
        ['설계방법', '강도설계법 (단면검토), 사용하중 (균열검토)'],
        ['구조해석', `2D Frame 해석 (내장 해석기, 지반스프링 ${d.opt.soil2dStatic})`],
    ]);
    doc.h2('사용재료');
    doc.table([['구분', '기호', '값', '단위']], [
        ['콘크리트 설계기준강도', 'fck', num(e.fck, 1), 'MPa'],
        ['콘크리트 탄성계수', 'Ec', num(e.Ec, 0), 'MPa'],
        ['철근 항복강도', 'fy', num(e.fy, 1), 'MPa'],
        ['철근 탄성계수', 'Es', num(e.Es, 0), 'MPa'],
        ['탄성계수비', 'n = Es/Ec', num(e.Es / e.Ec, 3), ''],
        ['강도감소계수 (휨)', 'φf', num(e.phiF, 2), ''],
        ['강도감소계수 (압축)', 'φc', num(e.phiC, 2), ''],
        ['강도감소계수 (전단)', 'φv', num(e.phiV, 2), ''],
    ]);
    doc.eq(`Ec = ${e.EcAuto !== false ? e.ecFormula + ' = ' : ''}${f0(e.Ec)} MPa`);
    doc.h2('단위중량');
    doc.table([['구분', '단위중량 (kN/m³)']], [
        ['철근콘크리트', num(e.gRC, 1)], ['무근콘크리트', num(e.gPlain, 1)], ['강재', num(e.gSteel, 1)],
        ['몰탈', num(e.gMortar, 1)], ['아스팔트', num(e.gAsphalt, 1)], ['물', num(e.gWater, 1)],
        ['뒷채움흙 (습윤)', num(cu.gBack, 1)], ['뒷채움흙 (수중)', num(cu.gBackSub, 1)],
        ['성토 (습윤)', num(cu.gFill, 1)], ['성토 (수중)', num(cu.gFillSub, 1)],
    ]);
    doc.h2('토압계수');
    const K = culvertK(d);
    doc.eq(`뒷채움 내부마찰각 Φ = ${cu.phiBack}°, 적용토압 : ${cu.earthP}`);
    doc.eq(`정지토압계수 K0 = 1 − sinΦ = 1 − sin${cu.phiBack}° = ${f3(K0(cu.phiBack))}`);
    doc.eq(`주동토압계수 Ka = tan²(45° − Φ/2) = ${f3(KaRankine(cu.phiBack))}`);
    doc.eq(`적용 : ${K.label}`);
    doc.h2('하중');
    const lv = d.live;
    doc.table([['구분', '내용']], [
        ['활하중 적용방법', lv.method],
        ['활하중 종류', lv.kind === '철도' ? `${lv.kind} (${lv.railGrade})` : lv.kind === '도로' ? `${lv.kind} (${lv.grade}, ${lv.std})` : `${lv.kind} (${lv.userQ} kN/m²)`],
        ['활하중에 의한 수평토압', lv.hLive ? '고려' : '무시'],
        ['내진설계', d.seisBox.on ? `${d.seisBox.method} / ${d.seisBox.perf} / ${d.seisBox.grade}` : '내진해석 하지 않음'],
        ['지진가속도계수', d.seisBox.on ? `A = ${d.seisBox.zoneFactor} × ${d.seisBox.riskFactor} = ${d.seisBox.A}` : '-'],
        ['지반종류', cu.site],
        ['균열검토 환경', e.corrosion],
    ]);
}

// ── 2. 단면형상 ─────────────────────────────────────────────────────

function chSection(rep, doc, x) {
    const g = x.g, cond = x.cond;
    doc.h2(`단면제원 (${x.name}, BLOCK ${x.bi + 1})`);
    let dw = null;
    try { dw = sectionDrawing(rep.p, rep.c, x.bi, { sta: cond.sta }); } catch (e) { doc.note('단면도 생성 오류: ' + e.message); }
    doc.fig(dw, `단면도 - ${x.name}`);
    const rows = [['형식', g.kind === 'U' ? 'U형' : g.kind === 'DOUBLE' ? '복층형' : `BOX형 ${g.n || g.cells.length}련`, '']];
    rows.push(['전체 폭 W', num(g.W, 0), 'mm'], ['전체 높이 H', num(g.Htot, 0), 'mm']);
    if (g.kind !== 'U') rows.push(['상부슬래브 두께 UT', num(g.UT, 0), 'mm']);
    rows.push(['하부슬래브 두께 LT', num(g.LT, 0), 'mm']);
    if (g.WL != null) rows.push(['좌측벽 두께 WL', num(g.WL, 0), 'mm'], ['우측벽 두께 WR', num(g.WR, 0), 'mm']);
    g.cells.forEach((cc, i) => rows.push([`${i + 1}련 내공 B × H`, `${f0(cc.B)} × ${f0(cc.y1 - cc.y0)}`, 'mm']));
    for (const w of g.walls.filter(w => w.kind === 'mid')) rows.push([`중간벽 ${w.index + 1} 두께`, num(w.t, 0), `mm (${w.type})`]);
    rows.push(['단면적 (헌치 포함)', num(concreteArea(g) / 1e6, 3), 'm²']);
    doc.table([['구분', '값', '단위']], rows);
    doc.h3('검토 위치 조건');
    doc.table([['구분', '값']], [
        ['검토단면', `${x.name} (STA. ${f3(cond.sta)})`],
        ['지반고 EL', f3(cond.groundEl)], ['구조물 상단 EL', f3(cond.topEl)], ['구조물 하단 EL', f3(cond.botEl)],
        ['토피 (m)', f3(cond.cover)], ['지하수위 EL', cond.gwOn ? f3(cond.gwlEl) : '고려하지 않음'],
        ['포장', cond.pave && cond.pave.label ? `${cond.pave.label} t = ${f3(cond.pave.t)} m, q = ${f3(cond.pave.q)} kN/m²` : '-'],
    ]);
}

// ── 3. 하중산정 ─────────────────────────────────────────────────────

function chLoads(rep, doc, x) {
    let cases = [];
    try { cases = loadCases(rep.p, rep.c, x.k); } catch (e) { doc.note('하중 계산 오류: ' + e.message); return; }
    const df = rep.opts.loadFigures ? x.df : null;
    const model = df && df.r ? df.r.model : null;
    const modelEq = df && df.r ? df.r.modelEq : null;
    doc.h2('하중 케이스 목록');
    doc.table([['No', '하중명', '기호', '분류', '조합 항목']], cases.map((cs, i) => [String(i + 1), cs.name, cs.mark || cs.key, cs.cat, cs.item || '-']));
    cases.forEach((cs, i) => {
        doc.h2(`${i + 1}) ${cs.name} (${cs.mark || cs.key})`);
        for (const t of cs.text || []) doc.eq(t);
        if (model) {
            const m = cs.cat === '지진하중' ? modelEq : model;
            try {
                const dw = newFrameDrawing(m);
                drawOutline(dw, m);
                drawModel(dw, m, { restraint: false });
                drawLoadCase(dw, m, cs, toSolverLoad(m, cs));
                doc.fig(dw, `하중재하도 - ${cs.name} (${cs.key})`);
            } catch (e) { doc.note('하중재하도 오류: ' + e.message); }
        }
    });
}

// ── 4. 하중조합 ─────────────────────────────────────────────────────

function chCombos(rep, doc, x) {
    let list = [];
    try { list = comboList(rep.p, rep.c, x.k); } catch (e) { doc.note('하중조합 오류: ' + e.message); return; }
    for (const kd of COMBO_KINDS) {
        if (!list.some(cb => cb.kind === kd.id)) continue;
        const t = comboTable(rep.p, rep.c, kd.id, x.k);
        doc.h2(`${kd.title} 조합 (${kd.prefix})`);
        doc.table([['조합', '구분', ...t.keys]], t.rows.map(r => [r.name, r.lc || '', ...r.vals.map(v => (v == null ? '' : num(v, 3)))]));
    }
}

// ── 5. 구조해석 ─────────────────────────────────────────────────────

function envGetter(list, key, pick) {
    return (mi, xx) => {
        let best = pick === 'max' ? -Infinity : Infinity, out = { N: 0, V: 0, M: 0 };
        for (const cb of list) { const f = cb.res.at(mi, xx); const v = f[key]; if (pick === 'max' ? v > best : v < best) { best = v; out = f; } }
        return out;
    };
}

function envDrawing(model, list, key, title) {
    const d = newFrameDrawing(model);
    drawOutline(d, model);
    drawModel(d, model, { restraint: false });
    let mx = 0;
    for (const cb of list) for (let mi = 0; mi < model.members.length; mi++) {
        const a = cb.res.at(mi, 0)[key];
        mx = Math.max(mx, Math.abs(a));
    }
    if (mx > 0) {
        drawDiagram(d, model, envGetter(list, key, 'max'), key, { values: true, color: COLOR.CYAN, maxAbs: mx });
        drawDiagram(d, model, envGetter(list, key, 'min'), key, { values: true, color: COLOR.MAGENTA, maxAbs: mx });
    }
    const bb = d.bbox();
    if (bb) d.text((bb.minX + bb.maxX) / 2, bb.maxY + d.textHeight * 1.5, title, { color: COLOR.YELLOW, h: d.textHeight * 1.1 });
    return d;
}

function chAnalysis(rep, doc, x) {
    const df = x.df;
    if (!df) { doc.note('구조해석 오류: ' + (x.dfError || '해석 결과 없음')); return; }
    const r = df.r;
    doc.h2('해석 모델');
    doc.p(`절점 ${r.model.nodes.length}개, 부재 ${r.model.members.length}개, 지반스프링 ${r.model.springs.filter(s => !s.stab).length}개`);
    try {
        const dm = newFrameDrawing(r.model);
        drawOutline(dm, r.model);
        drawModel(dm, r.model, { nodeNo: true, memNo: false, restraint: true });
        doc.fig(dm, `해석모델 - ${x.name}`);
    } catch (e) { doc.note('모델도 오류: ' + e.message); }
    doc.h2('지반반력계수');
    doc.lines(r.kv.lines);
    doc.h2('부재력 집계 (설계단면력)');
    const head = [['부재', '위치', '검토모델', 'Mu 상/외/좌 (kN·m)', 'Mu 하/내/우 (kN·m)', 'Nu (kN)', 'Vu (kN)', 'Ms 상/외/좌', 'Ms 하/내/우']];
    const rows = [];
    for (const g of df.groups) {
        g.cols.forEach((col, i) => rows.push([
            i === 0 ? g.label : '', `${col.label}${g.isSlab ? ` (${col.span + 1}경간)` : ''}`, col.govModel,
            num(col.M.A, 3), num(col.M.B, 3), num(Math.abs(col.N.A) > Math.abs(col.N.B) ? col.N.A : col.N.B, 3), num(col.V, 3), num(col.Ms.A, 3), num(col.Ms.B, 3),
        ]));
    }
    doc.table(head, rows);
    doc.note('부호: 모멘트는 해당 면 인장, 축력은 인장(+) / 압축(−).');
    const kinds = [['factored', '계수하중'], ['factoredEcc', '계수하중(최대편심)'], ['service', '사용하중'], ['eqCollapse', '지진시(붕괴방지)'], ['eqFunction', '지진시(기능수행)']];
    for (const [kind, title] of kinds) {
        const list = r.combos.filter(cb => cb.kind === kind && cb.res);
        if (!list.length) continue;
        const m = list[0].model || r.model;
        doc.h2(`단면력도 - ${title} (MAX/MIN)`);
        try { doc.fig(envDrawing(m, list, 'M', `BMD - ${title}`), `BMD - ${title}`); } catch (e) { doc.note('BMD 오류: ' + e.message); }
        if (kind === 'factored' || kind === 'eqCollapse') {
            try { doc.fig(envDrawing(m, list, 'V', `SFD - ${title}`), `SFD - ${title}`); } catch (e) { doc.note('SFD 오류: ' + e.message); }
        }
    }
}

// ── 6. 단면검토 ─────────────────────────────────────────────────────

const SLABS = ['top', 'bottom', 'middle'];

function rebarMember(gid) { return gid === 'middle' ? 'mid' : gid; }

function faceKey(gid, AB) {
    if (SLABS.includes(gid)) return AB === 'A' ? 'U' : 'L';
    if (gid === 'left' || gid === 'right') return AB === 'A' ? 'O' : 'I';
    return AB === 'A' ? 'L' : 'R';
}

/** 부재군 좌표 sM (m) → 주철근 이음 기준 좌표 s (mm) */
export function groupToRebarS(g, fm, gid, sM) {
    if (SLABS.includes(gid)) {
        const cells = g.kind === 'DOUBLE' ? g.cells.filter(cc => cc.floor === 1) : g.cells;
        const xRef = g.kind === 'U' ? g.inner.x0 : cells[0].x0;
        return sM * 1000 + fm.x0mm - xRef;
    }
    const yTopIn = g.kind === 'U' ? g.Htot : g.LT + g.H;
    if (/^midU:/.test(gid)) return (g.LT + g.H) - (fm.yBmm + sM * 1000);
    if (g.kind === 'DOUBLE' && /^mid:/.test(gid)) return (g.LT + g.MH) - (fm.yBmm + sM * 1000);
    return yTopIn - fm.yBmm - sM * 1000;
}

function barText(st) {
    const map = new Map();
    for (const b of st.bars) map.set(`${b.dia}|${b.layer}|${b.cycle}`, b);
    const parts = [...map.values()].map(b => `${b.dia}@${Math.round(1000 / b.perMeter)}`);
    return parts.join(' + ');
}

function envName(corrosion) {
    return /고부식/.test(corrosion) ? '고부식성' : /부식/.test(corrosion) ? '부식성' : /습윤/.test(corrosion) ? '습윤' : '건조';
}

const MODEL_KINDS = { 상시: ['factored', 'factoredEcc'], '지진(기능)': ['eqFunction'], '지진(붕괴)': ['eqCollapse'] };

/** 모멘트 부호 → 인장면 (designForces 와 같은 규칙) */
function tensionFace(gid, M) {
    if (gid === 'right') return M > 0 ? 'A' : 'B';
    return M > 0 ? 'B' : 'A';
}

/**
 * 면(A/B)별 지배 모멘트 — 검토모델(상시/지진)을 면마다 따로 고른다.
 * (designForces 는 위치마다 한 모델만 골라 다른 모델의 반대면 모멘트가 빠질 수 있음)
 */
export function faceGoverning(r, gid, col) {
    const out = { M: { A: 0, B: 0 }, N: { A: 0, B: 0 }, comb: { A: '', B: '' }, model: { A: '-', B: '-' } };
    const models = !col.model || col.model === '자동' ? Object.keys(MODEL_KINDS) : [col.model];
    for (const m of models) {
        const kinds = (MODEL_KINDS[m] || []).filter(k => r.combos.some(x => x.kind === k));
        if (!kinds.length) continue;
        const e = r.envelope(kinds, gid, col.s);
        for (const [v, n, nm] of [[e.Mmax, e.at.MmaxN, e.at.Mmax], [e.Mmin, e.at.MminN, e.at.Mmin]]) {
            if (!isFinite(v) || Math.abs(v) < 1e-9) continue;
            const f = tensionFace(gid, v);
            if (Math.abs(v) > Math.abs(out.M[f])) { out.M[f] = v; out.N[f] = n; out.comb[f] = nm; out.model[f] = m; }
        }
    }
    return out;
}

/** 검토단면 x 의 단면검토 결과 행 */
export function memberResults(rep, x) {
    const df = x.df;
    if (!df) return [];
    const d = rep.d, e = d.env;
    const fck = +e.fck, fy = +e.fy, code = e.kci;
    const fm = df.r.model.fm;
    const g = x.g;
    const lay = x.layout;
    const out = [];
    const minShear = (isSlab) => (isSlab ? d.opt.minShearSlab : d.opt.minShearWall);
    for (const grp of df.groups) {
        const mem = rebarMember(grp.id);
        let h = memberThickness(g, mem) || grp.t * 1000;
        if (!h) h = grp.t * 1000;
        const isWall = !grp.isSlab;
        const asColumn = isWall && (d.opt.outerWall !== '슬래브로 검토' || !['left', 'right'].includes(grp.id));
        for (const col of grp.cols) {
            const sR = groupToRebarS(g, fm, grp.id, col.s);
            const gov = faceGoverning(df.r, grp.id, col);
            for (const AB of ['A', 'B']) {
                const Mu = Math.abs(gov.M[AB] || 0);
                if (Mu < 1e-3) continue;
                const fk = faceKey(grp.id, AB);
                let st = lay ? steelAt(lay, mem, fk, sR) : { As: 0, cover: 80, bars: [] };
                let bars = st.As > 0 ? barText(st) : '';
                let assumed = false;
                if (!(st.As > 0)) {
                    assumed = true;
                    st = { As: barArea(DEFAULT_BAR.dia) * 1000 / DEFAULT_BAR.ctc, cover: st.cover || 80, bars: [] };
                    bars = `${DEFAULT_BAR.dia}@${DEFAULT_BAR.ctc} (가정)`;
                }
                const As = st.As, dd = h - st.cover;
                const sec = { b: 1000, h, d: dd, As, fck, fy, code };
                const fl = flexure(sec);
                const MuN = Mu * 1e6;
                const AsReq = requiredAs(sec, MuN);
                const Pu = -(gov.N[AB] || 0);   // 압축 +
                let pm = null;
                if (asColumn && Math.abs(Pu) > 1e-3) {
                    const opp = AB === 'A' ? 'B' : 'A';
                    const stC = lay ? steelAt(lay, mem, faceKey(grp.id, opp), sR) : { As: 0, cover: 80 };
                    const layers = [{ As, d: dd }];
                    if (stC.As > 0) layers.push({ As: stC.As, d: stC.cover });
                    try { pm = pmCheck({ b: 1000, h, fck, fy, code, layers }, Pu * 1e3, MuN); } catch { pm = null; }
                }
                const phiMn = pm ? pm.phiMn / 1e6 : fl.phiMn / 1e6;
                const okM = phiMn >= Mu;
                const rhoReq = AsReq / (1000 * dd);
                const okRhoMin = fl.rho >= fl.rhoMin || As >= 4 / 3 * AsReq;
                const okRhoMax = pm ? true : fl.rho <= fl.rhoMax;
                // 균열
                let cr = null;
                const Ms = Math.abs(col.Ms[AB] || 0);
                if (Ms > 1e-6) {
                    const dia = st.bars[0] ? st.bars[0].dia : DEFAULT_BAR.dia;
                    const perM = st.bars.length ? st.bars.reduce((a, b) => a + b.perMeter, 0) : 1000 / DEFAULT_BAR.ctc;
                    const spacing = 1000 / perM;
                    try {
                        cr = rcCrack({ ...sec, cover: Math.max(10, st.cover - barD(dia) / 2), dc: st.cover, spacing, env: envName(e.corrosion), Ec: e.Ec }, Ms * 1e6);
                    } catch { cr = null; }
                }
                out.push({
                    gid: grp.id, member: grp.label, isSlab: grp.isSlab, pos: `${col.label}${grp.isSlab ? ` (${col.span + 1}경간)` : ''}`,
                    face: grp.faces[AB === 'A' ? 0 : 1], h, d: dd, As, bars, assumed, cover: st.cover,
                    Mu, Pu, Ms, comb: gov.comb[AB], model: gov.model[AB], fl, pm, phiMn, okM, AsReq, rhoReq, okRhoMin, okRhoMax, cr,
                    sf: Mu > 0 ? phiMn / Mu : Infinity,
                    col, colKey: `${grp.id}|${col.label}|${col.span}`,
                });
            }
        }
    }
    // 전단 (위치별 1회)
    const seen = new Set();
    for (const r of out) {
        if (seen.has(r.colKey)) continue;
        seen.add(r.colKey);
        const col = r.col;
        const Vu = Math.abs(col.V || 0);
        const N = -(col.NV || 0);           // 압축 +
        const Nu = r.isSlab ? Math.min(0, N) : N;   // 슬래브는 압축 무시 (안전측)
        const coef = r.isSlab && rep.g0cells === 1 && /0\.25/.test(d.opt.vcSingle) ? 0.25 : 1 / 6;
        const sec = { b: 1000, h: r.h, d: r.d, fck, fy, code };
        const sh = rcShear(sec, Vu * 1e3, Nu * 1e3, { coef });
        const phiVc = sh.phiVc / 1e3;
        const half = Vu > phiVc / 2;
        const needMin = half && minShear(r.isSlab);
        r.shear = { Vu, Nu, phiVc, ok: Vu <= phiVc, half, needMin, coef, sh, comb: col.combV, d: r.d, h: r.h };
    }
    return out;
}

function chMembers(rep, doc, x) {
    const res = memberResults(rep, x);
    if (!res.length) { doc.note('단면검토 결과 없음: ' + (x.dfError || '해석 결과 없음')); return; }
    const e = rep.d.env;
    x.memberRes = res;
    doc.h2('설계요약표');
    const sum = res.map(r => [r.member, r.pos, r.face, num(r.Mu, 2), num(r.phiMn, 2), num(r.sf, 3), OK(r.okM), OK(r.okRhoMin && r.okRhoMax),
        r.shear ? OK(r.shear.ok, r.shear.ok ? 'O.K' : 'N.G') : '-', r.cr ? OK(r.cr.ok) : '-', `${r.bars}`]);
    doc.table([['부재', '위치', '인장면', 'Mu (kN·m)', 'φMn (kN·m)', '안전율', '휨', '철근비', '전단', '균열', '사용철근']], sum);
    const nNG = res.filter(r => !r.okM || !r.okRhoMin || !r.okRhoMax || (r.shear && !r.shear.ok) || (r.cr && !r.cr.ok)).length;
    doc.p(nNG ? `검토 결과 N.G 항목 ${nNG}개 — 배근 또는 단면을 조정하십시오.` : '모든 검토 위치에서 O.K');
    if (res.some(r => r.assumed)) doc.note(`※ 배근 입력이 없는 위치는 ${DEFAULT_BAR.dia}@${DEFAULT_BAR.ctc} 로 가정하였음.`);

    doc.h2('설계 정수');
    doc.eq(`fck = ${e.fck} MPa, fy = ${e.fy} MPa, Es = ${e.Es} MPa, Ec = ${f0(e.Ec)} MPa, 단위폭 b = 1000 mm`);
    doc.eq(`β1 = ${f3(res[0].fl.c > 0 ? res[0].fl.a / res[0].fl.c : 0.85)}, ρmin = max(0.25√fck/fy, 1.4/fy) = ${f5(res[0].fl.rhoMin)}, ρmax = ${f5(res[0].fl.rhoMax)} (${e.kci})`);

    let cur = null;
    for (const r of res) {
        if (r.member !== cur) { doc.h2(`${r.member}`); cur = r.member; }
        doc.h3(`${r.pos} — ${r.face} 인장 (${r.model}, ${r.comb || '-'})`);
        doc.eq(`단면 : b = 1000 mm, h = ${f0(r.h)} mm, d = h − dc = ${f0(r.h)} − ${f1(r.cover)} = ${f1(r.d)} mm`);
        doc.eq(`사용철근 : ${r.bars}  →  As = ${f2(r.As)} mm²`);
        doc.eq(`설계단면력 : Mu = ${f3(r.Mu)} kN·m, Pu = ${f3(r.Pu)} kN${r.Ms ? `, Ms = ${f3(r.Ms)} kN·m` : ''}`);
        // 휨
        const fl = r.fl;
        doc.eq(`a = As·fy / (0.85·fck·b) = ${f2(r.As)} × ${e.fy} / (0.85 × ${e.fck} × 1000) = ${f2(fl.a)} mm, c = ${f2(fl.c)} mm, εt = ${f5(fl.et)}`);
        if (r.pm) {
            doc.eq(`축력과 휨 (P-M) : e = Mu/Pu = ${f1(r.Pu ? r.Mu / r.Pu * 1000 : 0)} mm, φ = ${f3(r.pm.phi)}, c = ${f1(r.pm.c)} mm`);
            doc.eq(`φPn = ${f2(r.pm.phiPn / 1e3)} kN ${r.pm.phiPn / 1e3 >= r.Pu ? '≥' : '<'} Pu = ${f2(r.Pu)} kN`);
            doc.eq(`φMn = ${f2(r.phiMn)} kN·m ${r.okM ? '≥' : '<'} Mu = ${f2(r.Mu)} kN·m  (안전율 ${f3(r.sf)})`);
        } else {
            doc.eq(`φMn = φ·As·fy·(d − a/2) = ${f3(fl.phi)} × ${f2(r.As)} × ${e.fy} × (${f1(r.d)} − ${f2(fl.a)}/2) = ${f2(r.phiMn)} kN·m`);
            doc.eq(`φMn = ${f2(r.phiMn)} kN·m ${r.okM ? '≥' : '<'} Mu = ${f2(r.Mu)} kN·m  (안전율 ${f3(r.sf)})`);
        }
        doc.blocks.push({ t: 'eqk', text: `☞ 휨 검토 : ${r.okM ? 'O.K' : 'N.G'}` });
        // 철근비
        doc.eq(`ρ = As/(b·d) = ${f5(fl.rho)},  ρmin = ${f5(fl.rhoMin)},  ρmax = ${f5(fl.rhoMax)},  ρreq = ${f5(r.rhoReq)}`);
        doc.eq(`필요철근량 As,req = ${isFinite(r.AsReq) ? f2(r.AsReq) : '단면부족'} mm²,  4/3·As,req = ${isFinite(r.AsReq) ? f2(4 / 3 * r.AsReq) : '-'} mm²`);
        doc.blocks.push({ t: 'eqk', text: `☞ 최소철근비 : ${r.okRhoMin ? 'O.K' : 'N.G'},  최대철근비 : ${r.okRhoMax ? 'O.K' : 'N.G'}` });
        // 균열
        if (r.cr) {
            const cr = r.cr;
            if (cr.method === '간격') {
                doc.eq(`균열검토 (${e.kci}, 철근간격) : fs = ${f1(cr.fs)} MPa, κcr = ${cr.kcr}`);
                doc.eq(`s ≤ 375(κcr/fs) − 2.5Cc 및 300(κcr/fs) → s,allow = ${f1(cr.sAllow)} mm`);
                doc.blocks.push({ t: 'eqk', text: `☞ s = ${f1(cr.s)} mm ${cr.ok ? '≤' : '>'} ${f1(cr.sAllow)} mm : ${cr.ok ? 'O.K' : 'N.G'}` });
            } else {
                doc.eq(`균열검토 (${e.kci}, 균열폭) : fs = ${f1(cr.fs)} MPa, βc = ${f3(cr.betac)}, w = 1.08·βc·fs·∛(dc·A)×10⁻⁵`);
                doc.blocks.push({ t: 'eqk', text: `☞ w = ${f4(cr.w)} mm ${cr.ok ? '≤' : '>'} wa = ${f4(cr.wa)} mm : ${cr.ok ? 'O.K' : 'N.G'}` });
            }
        }
    }
    // 전단
    doc.h2('전단 검토');
    const shRows = [];
    const seen = new Set();
    for (const r of res) {
        if (!r.shear || seen.has(r.colKey)) continue;
        seen.add(r.colKey);
        const s = r.shear;
        const minTxt = !s.half ? '불필요' : s.needMin ? '최소전단철근 필요' : '규정 제외';
        shRows.push([r.member, r.pos, num(r.d, 1), num(s.Nu, 2), num(s.Vu, 2), num(s.phiVc, 2), num(s.Vu > 0 ? s.phiVc / s.Vu : Infinity, 3), minTxt, OK(s.ok)]);
    }
    doc.eq(`Vc = ${res.some(r => r.shear && r.shear.coef === 0.25) ? '0.25' : '1/6'}·(1 + Nu/(14·Ag))·√fck·b·d,  φ = ${e.kci === 'KCI2003' ? '0.80' : '0.75'}  (슬래브 축압축력은 무시)`);
    doc.table([['부재', '위치', 'd (mm)', 'Nu (kN)', 'Vu (kN)', 'φVc (kN)', '안전율', '최소전단철근', '판정']], shRows);
    doc.note(`최소전단철근 고려 : 벽체 ${rep.d.opt.minShearWall ? '적용' : '미적용'}, 슬래브 ${rep.d.opt.minShearSlab ? '적용' : '미적용'} (Vu > φVc/2 인 경우)`);
}

// ── 7. 부력 및 지지력 ───────────────────────────────────────────────

/** 구체 자중 산정 그림: 단면 + 구역 경계(점선) + 구역 번호 */
function piecesDrawing(c, bi, sp) {
    const g = sectionGeom(c, bi);
    const d = new Drawing({ textHeight: Math.max(g.W, g.Htot) / 45 });
    const th = d.textHeight;
    drawSection(d, c, bi, { simple: true });
    for (const [x0, y0, x1, y1] of sp.splits) d.line(x0, y0, x1, y1, { color: COLOR.GRAY, layer: 'SPLIT', dash: 'hidden' });
    for (const pc of sp.pieces) {
        const small = pc.A < (th * 2.2) ** 2;
        const r = th * (small ? 0.45 : 0.65);
        d.bubble(pc.cx, pc.cy, String(pc.no), { r, color: COLOR.RED, textColor: COLOR.GREEN });
    }
    return d;
}

/** 구체 자중 (단면 분할) — 표의 합계는 부력 검토의 구체자중과 같다 (concreteArea × γc) */
function selfWeightTable(rep, doc, x) {
    const cond = checkCondition(rep.p, rep.c, x.k, 'buoy');
    const g = cond.g;
    const sp = sectionPieces(g);
    const gc = +rep.d.env.gRC;
    doc.h2('구체 자중 산정 (단면 분할)');
    doc.fig(piecesDrawing(rep.c, cond.bi, sp), `구체 자중 산정 단면 분할 (${x.name})`);
    let sW = 0, sWx = 0;
    const rows = sp.pieces.map(pc => {
        const A = pc.A / 1e6, W = A * gc, xm = pc.cx / 1000;
        sW += W; sWx += W * xm;
        return [String(pc.no), pc.name, pc.shape, pc.b != null ? num(pc.b / 1000, 3) : '-', pc.h != null ? num(pc.h / 1000, 3) : '-', num(A, 4), num(gc, 1), num(W, 3), num(xm, 3), num(W * xm, 3)];
    });
    rows.push([{ v: '합 계', cs: 5 }, num(sp.A / 1e6, 4), '', num(sW, 3), '', num(sWx, 3)]);
    doc.table([['번호', '구분', '형상', 'b (m)', 'h (m)', 'A (m²)', 'γc (kN/m³)', 'W (kN/m)', 'x (m)', 'W·x (kN·m/m)']], rows);
    doc.eq(`x : 좌측 외면에서 각 구역 도심까지 거리, 합력 위치 x̄ = ΣW·x / ΣW = ${f3(sWx)} / ${f3(sW)} = ${f3(sW ? sWx / sW : 0)} m`);
    doc.eq(`구체자중 Wc = ΣW = ${f3(sW)} kN/m (ΣA = ${(sp.A / 1e6).toFixed(4)} m² × γc ${gc})`);
}

function chBuoy(rep, doc, x) {
    try { selfWeightTable(rep, doc, x); } catch (e) { doc.note('구체 자중 산정 오류: ' + e.message); }
    doc.h2('부력 검토');
    try { const b = buoyancyCheck(rep.p, rep.c, x.k); doc.lines(b.lines); x.buoy = b; } catch (e) { doc.note('부력 검토 오류: ' + e.message); }
    doc.h2('기초 지지력 검토');
    try { const b = bearingCheck(rep.p, rep.c, x.k); doc.lines(b.lines); x.bear = b; } catch (e) { doc.note('지지력 검토 오류: ' + e.message); }
}

// ── 8. 기초 ─────────────────────────────────────────────────────────

function maxSoilReaction(r) {
    let q = 0, name = '';
    for (const cb of r.combos) {
        if (cb.kind !== 'service' || !cb.res || !cb.res.springForces) continue;
        cb.model.springs.forEach((s, i) => {
            if (s.dir !== 'y' || s.stab) return;
            const v = cb.res.springForces[i] / (s.trib || 1);
            if (v > q) { q = v; name = cb.name; }
        });
    }
    return { q, name };
}

function chFound(rep, doc, x) {
    const c = rep.c;
    let row;
    try { row = foundRowOfBlock(c, x.bi); } catch { row = { type: '직접기초' }; }
    doc.h2(`기초형식 : ${row.type}${row.type === '말뚝기초' ? ` (${row.pile})` : ''}`);
    const df = x.df;
    const W = (x.g.baseX1 - x.g.baseX0) / 1000;
    if (row.type !== '말뚝기초') {
        let bear = x.bear;
        if (!bear) { try { bear = bearingCheck(rep.p, c, x.k); } catch { bear = null; } }
        if (df) {
            const q = maxSoilReaction(df.r);
            doc.eq(`해석 결과 최대 지반반력 (사용하중 ${q.name || '-'}) qmax = ${f3(q.q)} kN/m²`);
            if (bear) {
                const ok = bear.qa >= q.q;
                doc.blocks.push({ t: 'eqk', text: `☞ qa = ${f3(bear.qa)} kN/m² ${ok ? '≥' : '<'} qmax = ${f3(q.q)} kN/m² : ${ok ? 'O.K' : 'N.G'}` });
            }
        }
        if (bear) doc.eq(`등분포 가정 지반반력 Qmax = ${f3(bear.qmax)} kN/m² (7장 참조)`);
        return;
    }
    const blk = c.foundation && c.foundation.blocks && c.foundation.blocks[x.bi];
    const kind = (blk && blk.kind) || row.pile || '타입강관말뚝';
    const spec = (blk && blk.spec) || defaultPileSpec(kind);
    const opt = (blk && blk.pile) || {};
    const sec = pileSection(kind, spec);
    const W1 = sec.A * ((+spec.L || 0) / 1000) * (kind === '현장타설말뚝' || kind === 'PHC말뚝' ? 24.5 : 77);
    const cap = pileCapacity({ kind, spec, coef: opt.coef, friction: false, group: false, layers: [], spacing: 0, W: W1 });
    doc.h3('말뚝 제원');
    doc.table([['구분', '값']], [
        ['말뚝 종류', kind], ['직경 D (mm)', f0(sec.D * 1000 || spec.D)], ['길이 L (mm)', f0(+spec.L || 0)],
        ['선단 N 치', f0(cap.Ntip)], ['선단 단면적 (m²)', f4(sec.Atip)],
    ]);
    doc.h3('허용지지력');
    doc.eq(`qd = ${opt.coef || 300} × N = ${f1(cap.qd)} kN/m², Rp = qd·Ap = ${f2(cap.tip)} kN, Rf = ${f2(cap.fr)} kN (주면마찰 미고려)`);
    doc.eq(`Ru = ${f2(cap.Ru)} kN → Ra(상시) = Ru/3 = ${f2(cap.RaN)} kN, Ra(지진시) = Ru/2 = ${f2(cap.RaE)} kN`);
    // 말뚝 반력 (등분포 근사)
    const cols = (blk && blk.layout && blk.layout.cols) || [];
    const nPile = cols.reduce((a, cc) => a + (+cc.n || 0), 0);
    let bear = x.bear;
    if (!bear) { try { bear = bearingCheck(rep.p, c, x.k); } catch { bear = null; } }
    if (nPile > 0 && bear) {
        const L = (c.joints && c.joints[x.bi + 1] ? +c.joints[x.bi + 1].dist : 10) || 10;
        const Ptot = bear.qmax * W * L;
        const P1 = Ptot / nPile;
        const ok = cap.RaN >= P1;
        doc.eq(`작용하중 ΣV = Qmax × B × L = ${f3(bear.qmax)} × ${f3(W)} × ${f3(L)} = ${f2(Ptot)} kN, 말뚝 ${nPile} 본`);
        doc.blocks.push({ t: 'eqk', text: `☞ 말뚝 1본당 P = ${f2(P1)} kN ${ok ? '≤' : '>'} Ra = ${f2(cap.RaN)} kN : ${ok ? 'O.K' : 'N.G'}` });
    } else doc.note('말뚝 배치 입력이 없어 반력 검토를 생략함 (기초부 설정 > 말뚝배치).');
}

// ── 9. 수평철근 ─────────────────────────────────────────────────────

function chHorz(rep, doc, x) {
    const p = rep.p, c = rep.c, bi = x.bi;
    let rows = [];
    try {
        const hl = horzLayout(p, c, bi);
        const face = (m, f) => hl.faces.find(q => q.member === m && q.face === f);
        const horzAt = (member, f, s) => {
            if (f) { const F = face(member, f); return F ? horzAsAt(F, s) : 0; }
            return hl.faces.filter(q => q.member === member).reduce((a, F) => a + horzAsAt(F, s), 0);
        };
        rows = horzCheck(p, c, bi, horzAt, { dia: getHorzSet(c, bi).dia.outerWall, layout: x.layout || undefined });
    } catch (e) { doc.note('수평철근 검토 오류: ' + e.message); return; }
    const fy = +rep.d.env.fy;
    doc.h2('수축·온도 철근 (배력철근) 검토');
    doc.eq(`슬래브 : ρ = ${f4(shrinkageRatio(fy))} (fy = ${fy} MPa), 벽체 : ρ = 0.0020 ~ 0.0025 — 필요량 = ρ × 1000 × h (양면 합)`);
    doc.eq('배력철근 : 주철근량의 20% 이상 (해당 면)');
    doc.table([['부재', '위치', '① 수축온도 필요 (mm²)', '사용 (mm²)', '판정', '② 배력 필요 (mm²)', '사용 (mm²)', '판정']],
        rows.map(r => [r.title, r.label, num(r.req1, 1), num(r.use1, 1), OK(r.ok1), num(r.req2, 1), num(r.use2, 1), OK(r.ok2)]));
}

// ── 기둥 및 종방향 거더 ─────────────────────────────────────────────

function chGirder(rep, doc) {
    const { p, c } = rep;
    if (!hasColumns(c)) { doc.note('중간벽체가 기둥(사각기둥/원형기둥)인 블록이 없어 검토하지 않습니다.'); return; }
    const ch = getChecks(p, c);
    const o = rep.d.opt || {};
    doc.h2('검토 방법');
    doc.p('횡방향 2D Frame 해석의 중간벽체 단위폭 축력 N (kN/m)을 기둥 위치 거더의 등분포하중 w 로 보고, 기둥 중심을 지점으로 하는 종방향 연속보로 해석한다.');
    doc.lines([
        '상부거더 : w = 중간벽체 상단 압축력 (아래 방향)',
        '하부거더 : w = 중간벽체 하단 압축력 (위 방향, 지반반력이 거더를 거쳐 기둥으로 전달)',
        '중간거더 : w = 하층 벽체 상단 − 상층 벽체 하단 압축력',
        `단면력 산정 : ${o.girderMethod || '연속보 해석'}${/계수법/.test(o.girderMethod || '') ? ` (정 wL²/${o.girderPos || 14}, 부 wL²/${o.girderNeg || 10}, 전단 ${o.girderV || 1.15}·wL/2)` : ''}, 전단 검토위치 : ${o.girderShear || '지점 연단에서 d 위치'}`,
        '기둥 축력 Pu = 거더 지점반력 최대값, 기둥 모멘트 Mu = 중간벽체 단위폭 모멘트 × 기둥 간격',
    ]);
    for (const b of blockList(c)) {
        const bi = b.index;
        const cws = columnWalls(c, bi);
        if (!cws.length) continue;
        const k = Math.max(0, ch.rows.findIndex(r => (r.block | 0) === bi));
        const x = ctxFor(rep, k);
        for (const cw of cws) {
            const ga = girderAnalysis(p, c, bi, cw.index);
            if (!ga) continue;
            doc.h2(`블록 ${bi + 1} · 벽체 ${cw.index + 1} (${cw.round ? `원형기둥 D = ${cw.b}` : `사각기둥 ${cw.b} × ${cw.D}`})`);
            if (ga.err) doc.note('2D Frame 해석 오류: ' + ga.err);
            for (const g of ga.girders) {
                doc.h3(`${g.title} (bw × h = ${g.bw} × ${g.h} mm)`);
                const cols = g.layout.cols;
                doc.table([['지점', '위치 (mm)', '기둥 두께 (mm)', '좌측 경간 (mm)', '반력 Ru (kN)']],
                    cols.map((q, i) => [String(i + 1), num(q.u, 0), num(q.t, 0), num(i ? q.u - cols[i - 1].u : q.u, 0), num(g.reactions && g.reactions[i], 1)]));
                doc.eq(`극한 w = ${f2(g.ult && g.ult.wMax)} kN/m (${g.ult ? g.ult.at : '-'}), 사용 w = ${f2(g.sv && g.sv.wMax)} kN/m (${g.sv ? g.sv.at : '-'})`);
                if (g.beam && /연속보/.test(g.method)) { doc.fig(girderDrawing(g, 'BMD'), `${g.title} 휨모멘트도 (블록 ${bi + 1}, 벽체 ${cw.index + 1})`); doc.fig(girderDrawing(g, 'SFD'), `${g.title} 전단력도 (블록 ${bi + 1}, 벽체 ${cw.index + 1})`); }
                doc.table([['검토위치', '인장면', 'As (mm²)', 'ρ', '판정', 'Mu (kN·m)', 'φMn (kN·m)', '판정', 'Vu (kN)', 'φVn (kN)', '판정', 'Ms (kN·m)', '균열', '판정']],
                    g.sections.map(s => [s.label, s.face, num(s.As, 0), num(s.rho, 4), OK(s.okRho), num(s.Mu, 1), num(s.phiMn, 1), OK(s.okM),
                        s.vUnit ? num(s.Vu, 1) : '-', s.vUnit ? num(s.phiVn, 1) : '-', OK(s.okV), num(s.Ms, 1),
                        !s.cr ? '-' : s.cr.method === '균열폭' ? `${f3(s.cr.w)} ≤ ${f3(s.cr.wa)}` : `${f0(s.cr.s)} ≤ ${f0(s.cr.sAllow)}`, OK(s.okCr)]));
            }
            const r = beamColCheck(p, c, bi, cw.index, x.df, ga);
            const C = r && r.col;
            if (C) {
                doc.h3('기둥');
                doc.table([['ρ', '판정', 'Pu (kN)', 'Mu (kN·m)', 'φPn (kN)', 'φMn (kN·m)', '판정', 'Vu (kN)', 'φVn (kN)', '판정', '띠철근 s', 's max', '판정']],
                    [[num(C.rho, 4), OK(C.okRho), num(C.Pu, 1), num(C.Mu, 1), num(C.phiPn, 1), num(C.phiMn, 1), OK(C.okPM), num(C.Vu, 1), num(C.phiVn, 1), OK(C.okV), num(C.hoopS, 0), num(C.sMax, 0), OK(C.okS)]]);
            }
        }
    }
}

const BUILDERS = { design: chDesign, section: chSection, loads: chLoads, combos: chCombos, analysis: chAnalysis, members: chMembers, buoy: chBuoy, found: chFound, horz: chHorz, girder: chGirder };

// ── 메인 ─────────────────────────────────────────────────────────────

export function buildReport(p, c, opts = {}) {
    const o = { cover: true, toc: true, figures: true, loadFigures: true, figWidth: 560, ...opts };
    const ch = getChecks(p, c);
    const checks = (o.checks && o.checks.length ? o.checks : [0]).filter(k => k >= 0 && k < ch.rows.length);
    if (!checks.length) checks.push(0);
    const sel = (o.chapters && o.chapters.length ? CHAPTERS.filter(x => o.chapters.includes(x.id)) : CHAPTERS).filter(x => x.id !== 'girder' || hasColumns(c));
    const rep = { p, c, d: getDesign(p), opts: o, figures: [], cache: new Map(), g0cells: 0 };
    try { rep.g0cells = sectionGeom(c, 0).cells.length; } catch { rep.g0cells = 0; }
    const chapters = [];
    sel.forEach((meta, i) => {
        const chap = { id: meta.id, no: i + 1, title: meta.title, subs: [], blocks: [] };
        const doc = new Doc(rep, chap);
        const run = (fn) => { try { fn(); } catch (e) { doc.note(`[${meta.title}] 출력 오류: ${e.message}`); console.error(e); } };
        if (!meta.perCheck) run(() => BUILDERS[meta.id](rep, doc, ctxFor(rep, checks[0])));
        else for (const k of checks) {
            const x = ctxFor(rep, k);
            if (checks.length > 1) doc.blocks.push({ t: 'h2', text: `[${x.name}]` });
            run(() => BUILDERS[meta.id](rep, doc, x));
        }
        chap.blocks = doc.blocks;
        chapters.push(chap);
    });
    const info = p.info || {};
    const title = `${c.name || '암거'} 구조계산서`;
    const checkNames = checks.map(k => ctxFor(rep, k).name);
    const report = {
        title, project: info.projectName || '', checks, checkNames,
        toc: chapters.map(x => ({ id: x.id, no: x.no, title: x.title, subs: x.subs })),
        chapters, figures: rep.figures,
        summary: summarize(rep, checks),
    };
    report.html = reportHtml(report, o);
    return report;
}

function summarize(rep, checks) {
    const out = [];
    for (const k of checks) {
        const x = rep.cache.get(k);
        if (!x || !x.memberRes) continue;
        for (const r of x.memberRes) out.push({ check: x.name, member: r.member, pos: r.pos, face: r.face, Mu: r.Mu, phiMn: r.phiMn, okM: r.okM, okRho: r.okRhoMin && r.okRhoMax, okV: r.shear ? r.shear.ok : null, okCrack: r.cr ? r.cr.ok : null });
    }
    return out;
}

// ── HTML ─────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function cellHtml(cell, tag = 'td') {
    if (cell == null) return `<${tag}></${tag}>`;
    if (typeof cell === 'object') {
        const cls = cell.cls ? ` class="${cell.cls}"` : '';
        const span = (cell.cs ? ` colspan="${cell.cs}"` : '') + (cell.rs ? ` rowspan="${cell.rs}"` : '');
        return `<${tag}${cls}${span}>${esc(cell.v)}</${tag}>`;
    }
    if (typeof cell === 'number') return `<${tag} class="num">${esc(fx(cell))}</${tag}>`;
    return `<${tag}>${esc(cell)}</${tag}>`;
}

function markOkNg(text) {
    return esc(text).replace(/(O\.K\s*!?)/g, '<span class="ok">$1</span>').replace(/(N\.G\s*!?)/g, '<span class="ng">$1</span>');
}

export function blocksHtml(blocks, chap, figWidth = 560) {
    const out = [];
    for (const b of blocks) {
        switch (b.t) {
            case 'h2': out.push(`<h3 class="rep-h2">${esc(b.text)}</h3>`); break;
            case 'h3': out.push(`<h4 class="rep-h3" style="margin:8px 0 2px;font-size:12px">${esc(b.text)}</h4>`); break;
            case 'p': out.push(`<p style="margin:3px 0">${markOkNg(b.text)}</p>`); break;
            case 'eq': out.push(`<div class="eq">${markOkNg(b.text)}</div>`); break;
            case 'eqk': out.push(`<div class="eq" style="font-weight:bold">${markOkNg(b.text)}</div>`); break;
            case 'note': out.push(`<div style="color:#555;font-size:11px;margin:2px 0">${esc(b.text)}</div>`); break;
            case 'table':
                out.push('<table>' + (b.head || []).map(r => '<tr>' + r.map(c => cellHtml(c, 'th')).join('') + '</tr>').join('') +
                    b.rows.map(r => '<tr>' + r.map(c => cellHtml(c)).join('') + '</tr>').join('') + '</table>');
                break;
            case 'fig':
                out.push(`<figure style="margin:6px 0 10px;text-align:center;page-break-inside:avoid" data-fig="${b.no}">${drawingToSvg(b.drawing, { width: figWidth, maxHeight: 520, title: b.title })}<figcaption style="font-size:11px">[그림 ${b.no}] ${esc(b.title)}</figcaption></figure>`);
                break;
        }
    }
    return out.join('\n');
}

export function chapterHtml(chap, figWidth) {
    return `<section data-chapter="${chap.id}"><h2>${chap.no}. ${esc(chap.title)}</h2>\n${blocksHtml(chap.blocks, chap, figWidth)}</section>`;
}

export function reportHtml(report, o = {}) {
    const parts = [];
    if (o.cover !== false) {
        parts.push(`<div class="rep-cover" style="text-align:center;padding:40px 0 30px;page-break-after:always"><h1 style="border:none;font-size:24px">${esc(report.project)}</h1><h1 style="font-size:22px">${esc(report.title)}</h1><p>${esc(report.checkNames.join(', '))}</p></div>`);
    }
    if (o.toc !== false) {
        parts.push('<h2>목 차</h2><ol style="margin:4px 0 12px 18px;padding:0">' + report.toc.map(t => `<li>${esc(t.title)}${t.subs.length ? `<span style="color:#666;font-size:11px"> — ${esc(t.subs.slice(0, 6).join(', '))}${t.subs.length > 6 ? ' …' : ''}</span>` : ''}</li>`).join('') + '</ol>');
    }
    for (const chap of report.chapters) parts.push(chapterHtml(chap, o.figWidth));
    return `<div class="report">${parts.join('\n')}</div>`;
}

/** 인쇄용 독립 HTML 문서 (새 창) */
export function reportDocument(report, css = '') {
    const base = `body{margin:0;background:#fff}
.report{background:#fff;color:#000;font:12px/1.6 'Malgun Gothic','Dotum',sans-serif;padding:16px 22px;max-width:900px}
.report h1{font-size:18px;border-bottom:2px solid #000;margin:4px 0 10px}
.report h2{font-size:15px;margin:16px 0 6px;border-left:4px solid #2f5fa7;padding-left:6px}
.report h3{font-size:13px;margin:10px 0 4px}
.report table{border-collapse:collapse;margin:4px 0 8px}
.report th,.report td{border:1px solid #888;padding:2px 6px}
.report th{background:#e8eef7}
.report td.num{text-align:right}
.report .ok{color:#070;font-weight:bold}
.report .ng{color:#c00;font-weight:bold}
.report .eq{font-family:'Cambria Math','Times New Roman',serif;padding-left:14px}
@media print{section{page-break-before:always}.report{max-width:none}}`;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(report.title)}</title><style>${base}${css}</style></head><body>${report.html}</body></html>`;
}

// ── Excel (SpreadsheetML 2003) ──────────────────────────────────────

const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function sheetName(s, used) {
    let n = String(s).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
    let k = 2;
    const base = n;
    while (used.has(n)) n = (base.slice(0, 28) + ' ' + k++).slice(0, 31);
    used.add(n);
    return n;
}

function xcell(v, style, opts = {}) {
    const st = style ? ` ss:StyleID="${style}"` : '';
    const idx = opts.index ? ` ss:Index="${opts.index}"` : '';
    const mg = opts.across ? ` ss:MergeAcross="${opts.across}"` : '';
    return `<Cell${idx}${st}${mg}><Data ss:Type="String">${xesc(v)}</Data></Cell>`;
}

function cellText(c) {
    if (c == null) return '';
    if (typeof c === 'object') return c.v;
    if (typeof c === 'number') return fx(c);
    return c;
}

function cellStyle(c) {
    if (c && typeof c === 'object') return c.cls === 'ok' ? 'ok' : c.cls === 'ng' ? 'ng' : c.cls === 'num' ? 'num' : 'td';
    if (typeof c === 'number') return 'num';
    return 'td';
}

export function reportToExcelXml(report) {
    const used = new Set();
    const sheets = [];
    const okStyle = (t) => (/N\.G/.test(t) ? 'ngText' : /O\.K/.test(t) ? 'okText' : 'eq');
    for (const chap of report.chapters) {
        const rows = [];
        rows.push(`<Row ss:Height="20">${xcell(`${chap.no}. ${chap.title}`, 'h1')}</Row>`);
        rows.push('<Row/>');
        let maxCols = 1;
        for (const b of chap.blocks) {
            switch (b.t) {
                case 'h2': rows.push(`<Row>${xcell(b.text, 'h2')}</Row>`); break;
                case 'h3': rows.push(`<Row>${xcell(b.text, 'h3', { index: 2 })}</Row>`); break;
                case 'p': rows.push(`<Row>${xcell(b.text, okStyle(b.text), { index: 2 })}</Row>`); break;
                case 'eq': case 'eqk': rows.push(`<Row>${xcell(b.text, okStyle(b.text), { index: 3 })}</Row>`); break;
                case 'note': rows.push(`<Row>${xcell(b.text, 'note', { index: 2 })}</Row>`); break;
                case 'fig': rows.push(`<Row>${xcell(`[그림 ${b.no}] ${b.title}  (삽입도면 DXF 참조)`, 'note', { index: 3 })}</Row>`); break;
                case 'table': {
                    for (const r of b.head || []) {
                        maxCols = Math.max(maxCols, r.length + 2);
                        rows.push(`<Row>${r.map((c, i) => xcell(cellText(c), 'th', i === 0 ? { index: 3 } : {})).join('')}</Row>`);
                    }
                    for (const r of b.rows) {
                        maxCols = Math.max(maxCols, r.length + 2);
                        rows.push(`<Row>${r.map((c, i) => xcell(cellText(c), cellStyle(c), i === 0 ? { index: 3 } : {})).join('')}</Row>`);
                    }
                    rows.push('<Row/>');
                    break;
                }
            }
        }
        const cols = '<Column ss:Width="18"/><Column ss:Width="18"/>' + Array.from({ length: Math.max(1, maxCols - 2) }, () => '<Column ss:Width="78"/>').join('');
        sheets.push(`<Worksheet ss:Name="${xesc(sheetName(`${chap.no}.${chap.title}`, used))}"><Table>${cols}${rows.join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Portrait"/></PageSetup><FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight><PaperSizeIndex>9</PaperSizeIndex></Print></WorksheetOptions></Worksheet>`);
    }
    const font = 'ss:FontName="맑은 고딕" x:CharSet="129"';
    const border = '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>';
    const styles = `<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ${font} ss:Size="10"/></Style>
<Style ss:ID="h1"><Font ${font} ss:Size="14" ss:Bold="1"/></Style>
<Style ss:ID="h2"><Font ${font} ss:Size="11" ss:Bold="1" ss:Color="#1F3F7F"/></Style>
<Style ss:ID="h3"><Font ${font} ss:Size="10" ss:Bold="1"/></Style>
<Style ss:ID="eq"><Font ss:FontName="Times New Roman" ss:Size="10"/></Style>
<Style ss:ID="okText"><Font ${font} ss:Size="10" ss:Bold="1" ss:Color="#007700"/></Style>
<Style ss:ID="ngText"><Font ${font} ss:Size="10" ss:Bold="1" ss:Color="#CC0000"/></Style>
<Style ss:ID="note"><Font ${font} ss:Size="9" ss:Color="#555555"/></Style>
<Style ss:ID="th"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${border}<Font ${font} ss:Size="9" ss:Bold="1"/><Interior ss:Color="#E8EEF7" ss:Pattern="Solid"/></Style>
<Style ss:ID="td">${border}<Font ${font} ss:Size="9"/></Style>
<Style ss:ID="num"><Alignment ss:Horizontal="Right"/>${border}<Font ${font} ss:Size="9"/></Style>
<Style ss:ID="ok"><Alignment ss:Horizontal="Center"/>${border}<Font ${font} ss:Size="9" ss:Bold="1" ss:Color="#007700"/></Style>
<Style ss:ID="ng"><Alignment ss:Horizontal="Center"/>${border}<Font ${font} ss:Size="9" ss:Bold="1" ss:Color="#CC0000"/></Style>
</Styles>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${xesc(report.title)}</Title></DocumentProperties>
${styles}
${sheets.join('\n')}
</Workbook>`;
}

// ── 출력 화면 미리보기 그림 (장별 대표 그림, 계산서 전체를 만들지 않고) ──────

export function chapterFigure(p, c, k = 0, chapterId = 'section') {
    const cond = checkCondition(p, c, k, 'calc');
    const sec = () => sectionDrawing(p, c, cond.bi, { sta: cond.sta });
    if (!['loads', 'combos', 'analysis'].includes(chapterId)) return sec();
    const df = designForces(p, c, k);
    const r = df.r;
    if (chapterId === 'loads') {
        const cs = r.cases.find(x => x.lc && !x.eq) || r.cases[0];
        if (!cs) return sec();
        const d = newFrameDrawing(r.model);
        drawOutline(d, r.model);
        drawModel(d, r.model, { restraint: false });
        drawLoadCase(d, r.model, cs.lc, toSolverLoad(r.model, cs.lc));
        const bb = d.bbox();
        if (bb) d.text((bb.minX + bb.maxX) / 2, bb.maxY + d.textHeight * 1.5, `하중재하도 - ${cs.name} (${cs.key})`, { color: COLOR.YELLOW, h: d.textHeight * 1.1 });
        return d;
    }
    const list = r.combos.filter(cb => cb.kind === 'factored' && cb.res);
    if (!list.length) return sec();
    const d = envDrawing(r.model, list, 'M', 'BMD - 계수하중 (MAX/MIN)');
    return d;
}

// ── 삽도 → 하나의 Drawing (DXF) ─────────────────────────────────────

export function reportFiguresDrawing(report, opts = {}) {
    const figs = (report.figures || []).filter(f => !opts.chapter || f.chapter === opts.chapter);
    const out = new Drawing({ textHeight: 250 });
    if (!figs.length) return out;
    const cell = 20000;     // 한 칸 (mm, 축척 맞춤)
    const perRow = opts.perRow || 4;
    figs.forEach((f, i) => {
        const bb = f.drawing.bbox();
        if (!bb) return;
        const s = (cell * 0.85) / Math.max(bb.w, bb.h, 1);
        const cx = (i % perRow) * cell, cy = -Math.floor(i / perRow) * cell * 1.1;
        out.merge(f.drawing, cx - bb.minX * s + (cell * 0.85 - bb.w * s) / 2, cy - bb.minY * s + (cell * 0.85 - bb.h * s) / 2, s);
        out.text(cx + cell * 0.425, cy - cell * 0.06, `[그림 ${f.no}] ${f.title}`, { color: 7, h: cell * 0.025, layer: 'FIG_TITLE' });
    });
    return out;
}

export default buildReport;
