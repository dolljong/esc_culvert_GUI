// sheets.js - 도면출력 시트 생성 (매뉴얼 m3 1장 "도면출력", 4장 시트 구성)
//
// listSheets(p, opts) → [{ ci, culvert, category:'일반도'|'구조도'|'기타구조도', items:[{ no:'001', title, key, ci, category, number, build:() => Drawing }] }]
//   · 번호(no)는 프로젝트 전체에서 001 부터 연속. number = 도면번호 첫머리 문자 + no.
//   · build() 는 용지 mm (A1 841×594) 좌표의 Drawing 을 만든다: 도각(표제란) + 축척별로 배치한 도면(Drawing.merge).
//     반환 Drawing 에 sheetScale (대표 축척), sheetSize ({w,h}) 를 붙인다 (DXF 실척 출력용).
//   · 각 도면(뷰)은 try/catch 로 감싸 데이터/모듈이 없으면 건너뛴다.
//
// 시트 구성 (일반암거, 3 BLOCK 예):
//   일반도     001 일반암거 일반도(1)  평면도 · 종단면도 · 표준단면도 · 시공이음/신축이음/기둥/난간벽/차수벽 상세 · 노트
//              002 일반암거 일반도(2)  옹벽 평면도 · 날개벽 일반도 · 접속슬래브 상세 · 토공 상세
//   구조도     BLOCKn 구조도 (1) 주철근 조립도 (Cycle 별) · 일반단면도 · BMD/SFD(해석 결과가 있을 때) · 노트
//                          (2) 평면 배근도 (상부/하부(/중간) 슬래브) · 표준단면도
//                          (3) 수평철근 · 전단철근 배근도
//                          (4~) 철근상세 + 철근재료표 (테이블당 데이타수 마다 한 장) + 직경별 집계
//              BLOCKn 기둥부 구조도 (1~) 기둥 단면 · 거더 단면 · 철근상세 · 재료표 (기둥이 있을 때)
//   기타구조도 시점부(좌)-일체식 / 시점부(우)-옹벽식(1)(2) … · 접속슬래브 배근도(n)
//
// 설정: project.output.drawing = { general:{…}, culverts:{ [ci]: { gen, struct, wing, approach } } }
//   drawingSettings(p, ci) 가 기본값과 병합해 돌려준다. 항목 정의(설정 창 트리/표)는 SETTINGS_UI.

import { Drawing, COLOR, fmtLen, fmtNum } from '../cad/drawing.js';
import { drawSheetFrame, defaultTitleFields } from '../draw/titleBlock.js';
import { drawTable, drawNoteBox, drawViewTitle } from '../draw/tableDraw.js';
import { blocks, jointStations, sectionOf } from '../core/model.js';
import { sectionGeom } from './sectionGeom.js';
import { getHorizontal } from './alignment.js';
import { drawSection } from '../draw/sectionDraw.js';
import { drawCulvertPlan, drawCenterLine, drawProfile } from '../draw/planDraw.js';
import { drawBars, drawBarMarks, drawSpliceTicks, drawDots, drawForceDiagram, BAR_COLOR, OTHER_COLOR } from '../draw/rebarDraw.js';
import { drawBarShape } from '../draw/barShapes.js';
import { drawWingsPlan, drawWallPlan, drawIntegralElevation, drawIntegralSection, drawWallSection, drawWallElevation } from '../draw/wingDraw.js';
import { mainBarLayout, getSettings, cyclesOf, getRebarCommon, materials, normDia, DIAS, barD } from './rebar.js';
import { horzLayout } from './rebarHorz.js';
import { shearLayout } from './shearBars.js';
import { scheduleRows } from './barSchedule.js';
import { columnWalls, getBeamCol, columnBars, girderBars, girderMembers } from './beamCol.js';
import { installedWings, wingBlock, wingPlan, integralElevation, wallSection, defaultWallRow, WING_NAMES } from './wingGeom.js';
import { getWingRebar, wingCoverOf, zonePositions, wingBars, haunchBarLine, bodyWallPlan, horzBarPlan, wingPlanView } from './wingRebar.js';
import { getApproach, approachPlan, approachSection } from './approachGeom.js';
import { hasApproach, getApproachRebar, approachDims } from './approachRebar.js';
import { getParapet, parapetSide, parapetApplicable } from './parapetGeom.js';
import { loadFrame, memberForces } from './rebarForces.js';

// 화면 모듈에만 있는 그리기 함수 (없으면 해당 도면 생략)
const SCR = {};
for (const [k, path] of [['plan', '../screens/rebarPlan.js'], ['cjoint', '../screens/cjoint.js'], ['approach', '../screens/approach.js'], ['earth', '../screens/earthwork.js']]) {
    try { SCR[k] = await import(path); } catch (e) { SCR[k] = null; }
}
try { loadFrame(); } catch { /* 해석 모듈 없음 */ }

export const CATEGORIES = ['일반도', '구조도', '기타구조도'];
export const SCALES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, 120, 125, 150, 200, 250, 300, 400, 500, 600, 750, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000];
export const EL_FORMATS = ['EL. ', 'EL.:', 'EL.='];
const BODY_CATS = ['암거본체', '암거기타', '암거상세부'];
const PAPER_TH = 2.5;          // 기본 문자 높이 (용지 mm)

// ── 설정 ──────────────────────────────────────────────────────────────

export function defaultGeneralSettings() {
    return {
        tableShadow: false, titleShadow: false, noBlock: false,
        el: 'EL. ', fc: '콘크리트 강도',
        dgk: 'KHCBLKA1-A.dgk', xref: '', prefix: '', size: 'A1',
        fields: defaultTitleFields(),
    };
}

export function defaultCulvertDrawing() {
    return {
        gen: {
            show: {
                section: true, plan: true, profile: true, expTop: true, expBottom: true, expWall: true, cjoint: true, column: true,
                rail: true, cut: true, wingStart: true, wingEnd: true, wingPlan: true, wingSection: true, wingDrain: true, gutter: true, note: true,
                approach: true, earth: true,
            },
            page: 'all', blockN: 1, onePage: false, fillLine: true, fillDim: false, groundInfo: true,
            scales: { base: 100, cjoint: 20, rail: 20, cut: 20, column: 20, wingSection: 100, wingDrain: 100, gutter: 30, approach: 50, expJoint: 20 },
        },
        struct: {
            show: {
                genSection: true, c1: true, c2: true, c3: true, c4: true, barLen: true, altLap: false, rail: true, bracket: true, cut: true, anti: true,
                median: true, bmd: true, sfd: true, note: true,
                planSection: true, planTop: true, planBottom: true, planMid: true, wallL: true, wallR: true, wallIn: true, planToMid: true, planDim: true,
                horz: true, shear: true, shapes: true, table: true, summary: true,
            },
            planMode: 'split', page: 'block', unitM: true,
            scales: { base: 50, main: 50, std: 50, genSection: 100, bmd: 100, sfd: 100, rail: 30, cut: 30, bracket: 30, anti: 30, median: 30, plan: 50, horz: 50, shear: 50, column: 20 },
            barGap: 800, rowsPerTable: 40,
        },
        wing: {
            show: {
                back: true, front: true, secA: true, secB: true, rail: true, shapes: true, table: true, secBFront: true,
                wBack: true, wFront: true, wStart: true, wEnd: true, fTop: true, fBottom: true, mainS: true, mainE: true, wShapes: true, wTable: true,
            },
            tableMode: 'all', scales: { base: 50 }, barGap: 1000, rowsPerTable: 70,
        },
        approach: {
            show: { plan: true, secA: true, secB: true, bracket: true, dowel: true, shapes: true, table: true },
            scales: { base: 50, bracket: 30, dowel: 30 }, barGap: 800, rowsPerTable: 40,
        },
    };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
export function deepMerge(base, over) {
    if (!isObj(over)) return base;
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(over)) {
        if (isObj(v) && isObj(base[k])) out[k] = deepMerge(base[k], v);
        else if (v !== undefined) out[k] = v;
    }
    return out;
}

/** 저장값 + 기본값 → { general, gen, struct, wing, approach } */
export function drawingSettings(p, ci = 0) {
    const o = (p && p.output && p.output.drawing) || {};
    const general = deepMerge(defaultGeneralSettings(), o.general || {});
    const cs = deepMerge(defaultCulvertDrawing(), (o.culverts && o.culverts[ci]) || {});
    return { general, ...cs };
}

/** 설정 창 정의 (탭 → 왼쪽 트리 / 오른쪽 표). key 는 탭 객체 기준 경로 */
export const SETTINGS_UI = {
    general: {
        title: '도면 일반', perCulvert: false,
        tree: [
            { group: '도면 출력', items: [['check', 'tableShadow', '테이블 테두리 입체 표현'], ['check', 'titleShadow', '중제목 박스 입체 표현'], ['check', 'noBlock', 'HCAD Block 사용 안함']] },
            { group: 'Elevation 표기 방법', items: [['radio', 'el', 'EL. 15.000', 'EL. '], ['radio', 'el', 'EL.:15.000', 'EL.:'], ['radio', 'el', 'EL.=15.000', 'EL.=']] },
            { group: '콘크리트강도 표기 방법', items: [['radio', 'fc', '콘크리트 강도', '콘크리트 강도'], ['radio', 'fc', '굵은 골재 최대치수', '굵은 골재 최대치수']] },
        ],
        grids: [
            { head: ['설정 항목', '설정 값'], rows: [['dgk', '도각 파일', 'text'], ['xref', '외부 참조 도각 파일', 'text'], ['prefix', '도면 번호 첫 머리 문자', 'text'], ['size', '용지 크기', 'select', ['A1', 'A2', 'A3']]] },
            { head: ['설정 항목', '설정 값'], prefix: 'fields', rows: null },     // TITLE_FIELD_ROWS
        ],
    },
    gen: {
        title: '일반도', perCulvert: true,
        tree: [
            {
                group: '도면 출력', items: [
                    ['check', 'show.section', '표준단면도'], ['check', 'show.plan', '평면도'], ['check', 'show.profile', '종단면도'],
                    ['check', 'show.expTop', '신축이음 상부상세'], ['check', 'show.expBottom', '신축이음 하부상세'], ['check', 'show.expWall', '신축이음 벽체상세'],
                    ['check', 'show.cjoint', '시공이음 상세'], ['check', 'show.column', '기둥 단면상세'], ['check', 'show.rail', '난간벽 상세'], ['check', 'show.cut', '차수벽 상세'],
                    ['check', 'show.wingStart', '날개벽 시점 정면도'], ['check', 'show.wingEnd', '날개벽 종점 정면도'], ['check', 'show.wingPlan', '날개벽 평면도'],
                    ['check', 'show.wingSection', '날개벽 단면도'], ['check', 'show.wingDrain', '날개벽 배수상세도'], ['check', 'show.gutter', '측구2 상세'],
                    ['check', 'show.approach', '접속슬래브 상세'], ['check', 'show.earth', '토공 상세'], ['check', 'show.note', 'Note'],
                ],
            },
            { group: '출력 옵션-페이지', items: [['radio', 'page', '전체 출력', 'all'], ['radio', 'page', 'BLOCK별로 출력', 'block']] },
            { group: '출력 옵션', items: [['check', 'onePage', '일반도 도면 한장에 출력'], ['check', 'fillLine', '옹벽단면도 성토라인 표시'], ['check', 'fillDim', '옹벽단면도 성토라인 치수'], ['check', 'groundInfo', '종단면도 지반정보 표시']] },
        ],
        grids: [
            { head: ['설정항목', '스케일'], scale: true, rows: [['scales.base', '기본스케일'], ['scales.cjoint', '시공이음 상세'], ['scales.expJoint', '신축이음 상세'], ['scales.rail', '난간벽 상세'], ['scales.cut', '차수벽 상세'], ['scales.column', '기둥 단면상세'], ['scales.wingSection', '날개벽 단면'], ['scales.wingDrain', '날개벽 배수파이프상세'], ['scales.gutter', '측구2 상세'], ['scales.approach', '접속슬래브 상세']] },
            { head: ['설정항목', '설정값'], rows: [['blockN', '출력 BLOCK수', 'number']] },
        ],
    },
    struct: {
        title: '구조도', perCulvert: true,
        tree: [
            {
                group: '주철근 조립도', items: [
                    ['check', 'show.genSection', '일반단면도'], ['check', 'show.c1', '주철근조립도 1CYCLE'], ['check', 'show.c2', '주철근조립도 2CYCLE'],
                    ['check', 'show.c3', '주철근조립도 3CYCLE'], ['check', 'show.c4', '주철근조립도 4CYCLE'], ['check', 'show.barLen', '주철근 조립도 철근 길이표현'],
                    ['check', 'show.altLap', '1Cycle 이음길이를 교대로 표현'], ['check', 'show.rail', '난간벽상세'], ['check', 'show.bracket', '브래킷 상세'],
                    ['check', 'show.cut', '차수벽 상세'], ['check', 'show.anti', '부상방지저판 상세'], ['check', 'show.median', '중분대 상세'],
                    ['check', 'show.bmd', 'BMD'], ['check', 'show.sfd', 'SFD'], ['check', 'show.note', '노트사항'],
                ],
            },
            {
                group: '평면 배근도', items: [
                    ['check', 'show.planSection', '표준단면도'], ['check', 'show.planTop', '상부슬래브'], ['check', 'show.planBottom', '하부슬래브'], ['check', 'show.planMid', '중간슬래브'],
                    ['check', 'show.wallL', '좌측벽체'], ['check', 'show.wallR', '우측벽체'], ['check', 'show.wallIn', '내측벽체'],
                    ['check', 'show.planToMid', '평면배근도 출력시 블럭 중앙까지 표현'], ['check', 'show.planDim', '슬래브평면도 하단부 주철근Dim 표시'],
                    ['radio', 'planMode', '상,하면(내,외측) 분리표현', 'split'], ['radio', 'planMode', '상,하면(내,외측) 전체표현', 'all'],
                ],
            },
            { group: '수평/전단 철근', items: [['check', 'show.horz', '수평철근 배근도'], ['check', 'show.shear', '전단철근 배근도']] },
            { group: '철근재료표', items: [['check', 'show.shapes', '철근상세'], ['check', 'show.table', '철근재료표'], ['check', 'show.summary', '직경별 집계표']] },
            { group: '출력옵션-페이지', items: [['radio', 'page', 'BLOCK별 출력', 'block'], ['radio', 'page', '동일 BLOCK 통합 출력', 'merge']] },
            { group: '출력옵션', items: [['check', 'unitM', '재료표 길이 m 단위 출력']] },
        ],
        grids: [
            { head: ['설정항목', '스케일'], scale: true, rows: [['scales.base', '기본스케일'], ['scales.main', '주철근 조립도'], ['scales.std', '표준 단면도'], ['scales.genSection', '일반단면도'], ['scales.plan', '평면 배근도'], ['scales.horz', '수평철근 배근도'], ['scales.shear', '전단철근 배근도'], ['scales.bmd', 'BMD'], ['scales.sfd', 'SFD'], ['scales.rail', '난간벽상세'], ['scales.cut', '차수벽상세'], ['scales.bracket', '브래킷상세'], ['scales.anti', '부상방지저판상세'], ['scales.median', '중분대 상세'], ['scales.column', '기둥/거더 단면']] },
            { head: ['설정항목', '설정값'], rows: [['barGap', '철근제원간격', 'number'], ['rowsPerTable', '테이블당 데이타수', 'number']] },
        ],
    },
    wing: {
        title: '날개벽배근도', perCulvert: true,
        tree: [
            {
                group: '도면 출력', items: [
                    ['check', 'show.back', '배면 (일체식)'], ['check', 'show.front', '전면 (일체식)'], ['check', 'show.secA', '단면 A-A (일체식)'], ['check', 'show.secB', '단면 B-B (일체식)'],
                    ['check', 'show.rail', '난간벽상세 (일체식)'], ['check', 'show.shapes', '철근상세 (일체식)'], ['check', 'show.table', '철근재료표 (일체식)'], ['check', 'show.secBFront', '단면B-B정면도 (일체식)'],
                    ['check', 'show.wBack', '벽체배면 (옹벽식)'], ['check', 'show.wFront', '벽체전면 (옹벽식)'], ['check', 'show.wStart', '시점단면도 (옹벽식)'], ['check', 'show.wEnd', '종점단면도 (옹벽식)'],
                    ['check', 'show.fTop', '저판상면 (옹벽식)'], ['check', 'show.fBottom', '저판하면 (옹벽식)'], ['check', 'show.mainS', '주철근 조립도 시점측(옹벽식)'], ['check', 'show.mainE', '주철근 조립도 종점측(옹벽식)'],
                    ['check', 'show.wShapes', '철근상세 (옹벽식)'], ['check', 'show.wTable', '철근재료표 (옹벽식)'],
                ],
            },
            { group: '철근재료표 표현방법', items: [['radio', 'tableMode', '전체로 출력', 'all'], ['radio', 'tableMode', '주철근,기타철근 구분출력', 'split']] },
        ],
        grids: [{ head: ['설정항목', '설정값'], rows: [['scales.base', '기본스케일', 'scale'], ['barGap', '철근제원간격', 'number'], ['rowsPerTable', '테이블당 데이타수', 'number']] }],
    },
    approach: {
        title: '접속슬래브', perCulvert: true,
        tree: [{ group: '도면 출력', items: [['check', 'show.plan', '평면도'], ['check', 'show.secA', '단면A-A'], ['check', 'show.secB', '단면B-B'], ['check', 'show.bracket', '브래킷 상세'], ['check', 'show.dowel', '다우웰바 상세'], ['check', 'show.shapes', '철근상세'], ['check', 'show.table', '철근재료표']] }],
        grids: [{ head: ['설정항목', '설정값'], rows: [['scales.base', '기본 스케일', 'scale'], ['scales.bracket', '브라켓 상세', 'scale'], ['scales.dowel', '다우웰바 상세', 'scale'], ['barGap', '철근제원 간격', 'number'], ['rowsPerTable', '테이블당 데이타수', 'number']] }],
    },
};

// ── 공용 그리기 도구 ─────────────────────────────────────────────────

const vd = (scale, th = PAPER_TH) => new Drawing({ textHeight: th * scale });
const nextScale = (s) => SCALES.find(v => v > s + 1e-9) || s * 1.5;
const n0 = (v) => (v != null && v !== '' && isFinite(+v) ? +v : 0);

/** 도면 회전 (deg, 원점 기준) — 엔티티를 직접 바꾼다 */
export function rotateDrawing(d, deg) {
    if (!deg) return d;
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const R = (x, y) => [x * c - y * s, x * s + y * c];
    const normRot = (r) => { let v = ((r % 360) + 360) % 360; if (v > 90 && v <= 270) v -= 180; if (v > 180) v -= 360; return v; };
    for (const e of d.entities) {
        switch (e.type) {
            case 'line': [e.x1, e.y1] = R(e.x1, e.y1); [e.x2, e.y2] = R(e.x2, e.y2); break;
            case 'pline': case 'hatch': e.pts = e.pts.map(p => R(p[0], p[1])); break;
            case 'circle': [e.cx, e.cy] = R(e.cx, e.cy); break;
            case 'arc': [e.cx, e.cy] = R(e.cx, e.cy); e.a0 += deg; e.a1 += deg; break;
            case 'text': [e.x, e.y] = R(e.x, e.y); e.rot = normRot((e.rot || 0) + deg); break;
        }
    }
    return d;
}

/** 출력용 사본: 변수명(노랑, 클릭용)·선택 강조 제거, 문자 높이 보정 */
function forSheet(d, scale, opts = {}) {
    const out = new Drawing({ textHeight: d.textHeight });
    const drop = new Set(opts.dropText || []);
    for (const e of d.entities) {
        if (e.layer === 'VAR' || e.layer === 'SEL' || (e.field && e.type === 'text' && e.color === 2)) continue;
        if (e.type === 'text' && drop.has(e.str)) continue;
        if (e.type === 'hatch' && e.pattern === 'solid') continue;
        const c = { ...e };
        delete c.field; delete c.tip;
        out.entities.push(c);
    }
    // 문자 높이: 용지에서 너무 작거나 크면 보정 (기호 원 포함)
    const hs = out.entities.filter(e => e.type === 'text').map(e => e.h).sort((a, b) => a - b);
    if (hs.length) {
        const med = hs[Math.floor(hs.length / 2)] / scale;
        const target = opts.th || PAPER_TH;
        if (med < target * 0.7 || med > target * 1.6) {
            const f = Math.max(0.35, Math.min(4, target / med));
            for (const e of out.entities) {
                if (e.type === 'text') e.h *= f;
                else if (e.type === 'circle' && e.layer === 'MARK') e.r *= f;
            }
        }
    }
    return out;
}

/** 뷰 정의: { d, scale, title, fixed (용지 단위 표 등, 축척 고정), scaleText, dropText } */
function view(d, scale, title, extra = {}) {
    if (!d || !d.entities || !d.entities.length) return null;
    return { d, scale, title, ...extra };
}

function safe(label, fn) {
    try { return fn(); } catch (e) { console.warn(`[sheets] ${label} 생략:`, e && e.message ? e.message : e); return null; }
}

const TITLE_H = 12;   // 뷰 제목 공간 (용지 mm)

function measure(v) {
    if (!v._bb) {
        v._src = v.fixed ? v.d : forSheet(v.d, v.scale, v);
        v._bb = v._src.bbox();
    }
    const bb = v._bb;
    if (!bb) return { w: 0, h: 0 };
    return { w: bb.w / v.scale, h: bb.h / v.scale + (v.title ? TITLE_H : 0) };
}

/** rows(선반) / cols(세로 쌓기) 배치 시도. 반환: [{v, x, yTop, w, h}] | null */
function tryLayout(items, area, gap, mode) {
    const out = [];
    if (mode === 'rows') {
        const rows = [];
        let cur = [], w = 0;
        for (const it of items) {
            if (it.w > area.w + 1e-6) return null;
            if (cur.length && w + gap + it.w > area.w) { rows.push(cur); cur = []; w = 0; }
            w += (cur.length ? gap : 0) + it.w;
            cur.push(it);
        }
        if (cur.length) rows.push(cur);
        const hs = rows.map(r => Math.max(...r.map(i => i.h)));
        const tot = hs.reduce((a, b) => a + b, 0);
        if (tot + gap * (rows.length - 1) > area.h + 1e-6) return null;
        const gy = Math.min(40, (area.h - tot) / Math.max(1, rows.length + 1));
        let y = area.y + area.h - gy * 0.6;
        rows.forEach((r, ri) => {
            const sw = r.reduce((a, i) => a + i.w, 0);
            const gx = Math.min(60, (area.w - sw) / (r.length + 1));
            let x = area.x + gx;
            for (const it of r) { out.push({ ...it, x, yTop: y }); x += it.w + gx; }
            y -= hs[ri] + gy;
        });
        return out;
    }
    const cols = [];
    let cur = [], h = 0;
    for (const it of items) {
        if (it.h > area.h + 1e-6) return null;
        if (cur.length && h + gap + it.h > area.h) { cols.push(cur); cur = []; h = 0; }
        h += (cur.length ? gap : 0) + it.h;
        cur.push(it);
    }
    if (cur.length) cols.push(cur);
    const ws = cols.map(c => Math.max(...c.map(i => i.w)));
    const tot = ws.reduce((a, b) => a + b, 0);
    if (tot + gap * (cols.length - 1) > area.w + 1e-6) return null;
    const gx = Math.min(60, (area.w - tot) / (cols.length + 1));
    let x = area.x + gx;
    cols.forEach((c, ci) => {
        const sh = c.reduce((a, i) => a + i.h, 0);
        const gy = Math.min(30, (area.h - sh) / (c.length + 1));
        let y = area.y + area.h - gy;
        for (const it of c) { out.push({ ...it, x: x + (ws[ci] - it.w) / 2, yTop: y }); y -= it.h + gy; }
        x += ws[ci] + gx;
    });
    return out;
}

/** 뷰들을 영역에 배치 (넘치면 축척을 한 단계씩 키운다) 하고 시트에 합친다 */
function packViews(sheet, area, views, G) {
    views = views.filter(v => v && v.d && v.d.entities.length);
    if (!views.length) return [];
    const gap = 10;
    let placed = null;
    for (let iter = 0; iter < 16 && !placed; iter++) {
        const items = views.map(v => ({ v, ...measure(v) })).filter(i => i.w > 0);
        placed = tryLayout(items, area, gap, 'rows') || tryLayout(items, area, gap, 'cols');
        if (placed) break;
        const scalable = views.filter(v => !v.fixed);
        if (!scalable.length) break;
        // 가장 큰 축척 비율로 넘치는 만큼 키운다
        for (const v of scalable) { v.scale = nextScale(v.scale); v._bb = null; }
    }
    if (!placed) {
        // 그래도 넘치면 겹치지 않게 아래로 이어 배치 (영역 밖으로 나갈 수 있음)
        const items = views.map(v => ({ v, ...measure(v) }));
        let x = area.x, y = area.y + area.h, rowH = 0;
        placed = [];
        for (const it of items) {
            if (x > area.x && x + it.w > area.x + area.w) { x = area.x; y -= rowH + gap; rowH = 0; }
            placed.push({ ...it, x, yTop: y });
            x += it.w + gap; rowH = Math.max(rowH, it.h);
        }
    }
    for (const it of placed) {
        const v = it.v;
        const bb = v._bb;
        if (!bb) continue;
        const s = 1 / v.scale;
        const top = it.yTop - (v.title ? TITLE_H : 0);
        sheet.merge(v._src, it.x - bb.minX * s, top - bb.maxY * s, s);
        if (v.title) drawViewTitle(sheet, it.x + it.w / 2, top + 1.5, v.title, v.fixed ? (v.scaleText || '') : (v.scaleText || `S=1:${v.scale}`), { box: true, shadow: G.titleShadow, th: 4 });
    }
    return placed;
}

function finalize(d, G) {
    const fmt = EL_FORMATS.includes(G.el) ? G.el : 'EL. ';
    for (const e of d.entities) {
        if (e.type !== 'text') continue;
        const m = /^EL\.\s?[:=]?\s?(-?[\d,]+(?:\.\d+)?)$/.exec(e.str);
        if (m) e.str = fmt + m[1];
        else if (/^EL\. /.test(e.str) && fmt !== 'EL. ') e.str = e.str.replace(/^EL\. /, fmt);
    }
    return d;
}

function today() {
    const t = new Date();
    return `${String(t.getFullYear()).slice(2)}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`;
}

/** 시트 하나 구성 */
function composeSheet(p, c, S, meta, views) {
    const G = S.general;
    const d = new Drawing({ textHeight: PAPER_TH });
    const info = p.info || {};
    const vs = views.filter(Boolean);
    const scales = [...new Set(vs.filter(v => !v.fixed).map(v => v.scale))].sort((a, b) => a - b);
    const fr = drawSheetFrame(d, {
        size: G.size, title: meta.title, projectName: info.projectName, client: info.client, designer: info.designer, contractor: info.contractor,
        site: info.siteName, name1: c.name, number: meta.number, date: today(), fields: G.fields, dgk: G.dgk,
        fileName: meta.fileName || '', scaleText: '',
    });
    const placed = packViews(d, fr.area, vs, G);
    const used = [...new Set(placed.filter(i => !i.v.fixed).map(i => i.v.scale))].sort((a, b) => a - b);
    // 축척 칸 (표제란) 다시 쓰기: 대표 축척
    const sc = used.length ? (used.length === 1 ? `S=1:${used[0]}` : `S=1:${used[0]}, 1:${used[used.length - 1]}`) : 'NONE';
    if (!(G.fields && (G.fields.hScale || G.fields.vScale))) {
        // drawSheetFrame 은 scaleText 가 비면 칸을 비워둔다 → 축척 칸 위치에 직접 기입
        const P = fr.W, X0 = 15, sx = (P - 30) / 811;
        d.text(X0 + 504 * sx, 10 + 28 / 6, sc, { color: 6, layer: 'FRAME-TEXT', h: 2.4, valign: 'middle' });
    }
    if (!vs.length) d.text(fr.area.x + fr.area.w / 2, fr.area.y + fr.area.h / 2, '출력할 도면 객체가 없습니다 (도면 환경 설정 확인)', { color: 8, h: 6, valign: 'middle', layer: 'TEXT' });
    finalize(d, G);
    d.sheetScale = used[0] || scales[0] || 1;
    d.sheetSize = { w: fr.W, h: fr.H };
    d.title = meta.title;
    return d;
}

// ── 일반도 뷰 ────────────────────────────────────────────────────────

function planView(p, c, Sg) {
    const s = Sg.scales.base;
    const d = vd(s);
    drawCenterLine(d, p, c, 6);
    drawCulvertPlan(d, p, c, { dims: true });
    if (Sg.show.wingPlan) safe('날개벽 평면', () => drawWingsPlan(d, p, c, { names: false }));
    if (hasApproach(c)) safe('접속슬래브 평면', () => getApproach(c).list.forEach((a) => {
        const pl = approachPlan(p, c, a);
        d.pline(pl.poly, { color: COLOR.CYAN, layer: 'APPROACH', closed: true });
        d.pline(pl.inner, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    }));
    // 암거 축을 수평으로
    const st = jointStations(c);
    const h = getHorizontal(p.alignment);
    const q = h.pointAt((st[0] + st[st.length - 1]) / 2);
    rotateDrawing(d, -(q.th * 180 / Math.PI));
    return view(d, s, '평 면 도');
}

function profileView(p, c, Sg) {
    const s = Sg.scales.base;
    const d = vd(s);
    drawProfile(d, p, c, { ground: !!Sg.groundInfo });
    return view(d, s, '종 단 면 도');
}

function sectionView(p, c, bi, s, title, opts = {}) {
    const d = vd(s);
    const b = blocks(c)[bi] || { sta0: c.startSta };
    drawSection(d, c, bi, { alignment: p.alignment, alignName: p.alignment.name, sta: b.sta0, names: false, ...opts });
    return view(d, s, title);
}

/** 서로 다른 단면의 블록 목록 [{ bi, list:[bi..] }] */
function distinctSections(c, list) {
    const out = [];
    for (const bi of list) {
        const k = JSON.stringify(sectionOf(c, bi)) + '|' + (c.type === '지하차도' ? (c.zones || [])[bi] : '');
        const f = out.find(o => o.k === k);
        if (f) f.list.push(bi); else out.push({ k, bi, list: [bi] });
    }
    return out;
}

function cjointView(c, Sg) {
    if (!SCR.cjoint) return null;
    const cj = c.cjoint || SCR.cjoint.defaultCjoint(c);
    const d = SCR.cjoint.keywayDrawing(cj);
    return view(d, Sg.scales.cjoint, '시공이음 상세', { dropText: ['시공이음 상세'] });
}

/** 신축이음 상세: 두 블록 맞댐 + 채움재 + 다웰바 */
function expJointView(c, part, Sg) {
    const g = sectionGeom(c, 0);
    const t = part === 'top' ? g.UT : part === 'bottom' ? g.LT : g.WL;
    if (!(t > 0)) return null;
    const joints = c.joints || [];
    const gap = Math.max(10, n0((joints[1] || {}).gap) || 20);
    const s = Sg.scales.expJoint || 20;
    const d = vd(s);
    const th = d.textHeight;
    const L = Math.max(600, t * 1.6);
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.rect(-gap / 2 - L, 0, L, t, cy);
    d.rect(gap / 2, 0, L, t, cy);
    // 절단선
    for (const x of [-gap / 2 - L, gap / 2 + L]) d.pline([[x, -th * 0.5], [x, t * 0.4], [x + th * 0.4 * Math.sign(x), t * 0.5], [x - th * 0.4 * Math.sign(x), t * 0.55], [x, t * 0.65], [x, t + th * 0.5]], { color: COLOR.CYAN, layer: 'CONC' });
    // 채움재 / 실링
    d.hatch([[-gap / 2, 0], [gap / 2, 0], [gap / 2, t], [-gap / 2, t]], { color: COLOR.YELLOW, pattern: 'dots', layer: 'FILL' });
    d.rect(-gap / 2, t - Math.min(30, t * 0.1), gap, Math.min(30, t * 0.1), { color: COLOR.YELLOW, layer: 'FILL' });
    const dw = c.dowel || {};
    if (dw.use !== false && (part === 'bottom' || (part === 'top' && dw.top !== false) || (part === 'wall' && dw.wall !== false))) {
        const len = n0(dw.len) || 1000;
        d.line(-len / 2, t / 2, len / 2, t / 2, { color: COLOR.MAGENTA, layer: 'REBAR', width: 2 });
        d.rect(gap / 2, t / 2 - barD(dw.dia || 'D32') * 0.7, len / 2 - gap / 2, barD(dw.dia || 'D32') * 1.4, { color: COLOR.YELLOW, layer: 'REBAR' });
        d.leader([[len / 4, t / 2], [len / 4 + th * 2, t + th * 2]], `다웰바 ${dw.dia || 'D32'} CTC ${dw.ctc || 150}, L=${fmtLen(len)}`, { color: COLOR.GREEN });
    }
    d.leader([[0, t * 0.3], [-th * 3, -th * 2.5]], '채움재 (T=' + gap + ')', { color: COLOR.GREEN });
    d.dimV(0, t, -gap / 2 - L, -gap / 2 - L - th * 2.5);
    d.dimH(-gap / 2, gap / 2, t, t + th * 2.2, String(gap));
    const nm = part === 'top' ? '상부 슬래브' : part === 'bottom' ? '하부 슬래브' : '벽체';
    return view(d, s, `신축이음 상세 (${nm})`);
}

function columnView(c, Sg) {
    const cws = columnWalls(c, 0);
    if (!cws.length) return null;
    const cw = cws[0];
    const s = Sg.scales.column;
    const d = vd(s);
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    if (cw.round) d.circle(cw.b / 2, cw.D / 2, cw.b / 2, cy);
    else {
        d.rect(0, 0, cw.b, cw.D, cy);
        d.line(0, 0, cw.b, cw.D, { ...cy, dash: 'hidden' });
        d.line(cw.b, 0, 0, cw.D, { ...cy, dash: 'hidden' });
    }
    d.dimH(0, cw.b, cw.D, cw.D + d.textHeight * 2.2);
    d.dimV(0, cw.D, 0, -d.textHeight * 2.2);
    d.text(cw.b / 2, -d.textHeight * 1.5, `${cw.n} EA @ ${fmtLen(Math.round(cw.ctc))}`, { color: COLOR.GREEN, valign: 'top', layer: 'TEXT' });
    return view(d, s, `기둥단면도 : 벽체${cw.index + 1}`);
}

function railView(c, kind, s, title) {
    if (!parapetApplicable(c)) return null;
    const pp = getParapet(c);
    const e = pp.ends[0] && pp.ends[0][kind] && pp.ends[0][kind].use ? pp.ends[0] : (pp.ends[1] && pp.ends[1][kind] && pp.ends[1][kind].use ? pp.ends[1] : null);
    if (!e) return null;
    const g = sectionGeom(c, 0);
    const sd = parapetSide(e, g);
    const d = vd(s);
    const th = d.textHeight;
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const L = 1200;
    if (kind === 'rail' && sd.rail) {
        const yb = g.Htot - g.UT;
        d.pline([[L, yb], [0, yb], [0, g.Htot + n0(e.rail.Wh)]], cy);
        d.pline([...sd.rail.slice(1), [sd.rail[3][0], sd.rail[3][1]]], cy);
        d.line(sd.rail[1][0], g.Htot, L, g.Htot, cy);
        d.pline([[L, yb - th * 0.4], [L, yb + g.UT * 0.4], [L + th * 0.4, yb + g.UT * 0.5], [L - th * 0.4, yb + g.UT * 0.55], [L, yb + g.UT * 0.65], [L, g.Htot + th * 0.4]], cy);
        const Wh = n0(e.rail.Wh), t1 = n0(e.rail.Wt1), t2 = n0(e.rail.Wt2) || t1;
        d.dimH(0, t1, g.Htot + Wh, g.Htot + Wh + th * 2.2);
        if (t2 !== t1) d.dimH(0, t2, g.Htot, g.Htot - th * 2);
        d.dimV(g.Htot, g.Htot + Wh, Math.max(t1, t2), Math.max(t1, t2) + th * 3);
        d.dimV(yb, g.Htot, 0, -th * 2.4);
    } else if (kind === 'cut' && sd.cut) {
        d.pline([[L, 0], [sd.cut[3][0], 0]], cy);
        d.pline(sd.cut, cy);
        d.pline([[0, 0], [0, g.LT], [L, g.LT]], cy);
        d.pline([[L, -th * 0.4], [L, g.LT * 0.4], [L + th * 0.4, g.LT * 0.5], [L - th * 0.4, g.LT * 0.55], [L, g.LT * 0.65], [L, g.LT + th * 0.4]], cy);
        const H = n0(e.cut.H), c1 = n0(e.cut.CT1);
        d.dimV(-H, 0, 0, -th * 2.4);
        d.dimV(0, g.LT, 0, -th * 2.4);
        d.dimH(0, c1, -H, -H - th * 2.2);
    } else return null;
    return view(d, s, title);
}

function notes(p, c, G, kind = 'gen') {
    const m = materials(p);
    const fcTxt = G.fc === '굵은 골재 최대치수' ? `콘크리트 : 25-${m.fck}-120 (굵은골재최대치수-강도-슬럼프)` : `콘크리트 설계기준강도 fck = ${m.fck} MPa`;
    const base = [
        '1. 도면의 치수 단위는 mm 이며, EL. 및 STA. 는 m 단위이다.',
        `2. ${fcTxt}, 철근 항복강도 fy = ${m.fy} MPa`,
        '3. 철근조립시 이음이 한곳에 집중되지 않도록 분산하여야 한다.',
    ];
    if (kind === 'gen') {
        const st = jointStations(c);
        base.push(`4. 암거 연장 L = ${fmtLen((st[st.length - 1] - st[0]) * 1000)} (${blocks(c).length} BLOCK)`);
        base.push('5. 신축이음부에는 채움재 및 지수판을 설치한다.');
    } else {
        base.push('4. 철근 피복두께는 철근 중심까지의 거리이다.');
        base.push('5. 철근 길이는 이음 길이를 포함한 값이다.');
    }
    const d = new Drawing({ textHeight: PAPER_TH });
    drawNoteBox(d, 0, 0, 150, '노트 사항', base, { shadow: G.tableShadow });
    return view(d, 1, null, { fixed: true });
}

// ── 일반도(2): 옹벽 평면 / 날개벽 / 접속슬래브 / 토공 ─────────────────────────────

function wingRows(c, key) {
    return (c.wings && c.wings.dim && c.wings.dim[key] && c.wings.dim[key].wall && c.wings.dim[key].wall.rows) || [defaultWallRow(c), defaultWallRow(c, true)];
}
function wingLen(c, key) {
    const pos = c.wings && c.wings.pos && c.wings.pos[key];
    return pos && n0(pos.len) > 0 ? n0(pos.len) : (key[1] === 'R' ? 4500 : 5000);
}

function wingGeneralViews(p, c, Sg) {
    const out = [];
    const s = Sg.scales.wingSection || 100;
    // 옹벽 평면도 (시점부/종점부, 옹벽식 날개벽이 있을 때)
    if (Sg.show.wingPlan) {
        for (const end of ['S', 'E']) {
            if (end === 'S' ? !Sg.show.wingStart : !Sg.show.wingEnd) continue;
            out.push(safe(`${end} 옹벽 평면도`, () => { const d = vd(s); return drawWallPlan(d, p, c, end, (key) => wingRows(c, key)) ? view(d, s, `${end === 'S' ? '시점부' : '종점부'} 옹벽 평면도`) : null; }));
        }
    }
    for (const w of installedWings(c)) {
        const start = w.key[0] === 'S';
        if (start ? !Sg.show.wingStart : !Sg.show.wingEnd) continue;
        const nm = WING_NAMES[w.key];
        if (w.type === '일체식') {
            out.push(safe(`${nm} 정면도`, () => { const d = vd(s); drawIntegralElevation(d, c, w.key, 0, 0, { title: ' ', p }); return view(d, s, `${nm} 정면도`, { dropText: [' '] }); }));
            if (Sg.show.wingSection) out.push(safe(`${nm} 단면도`, () => { const d = vd(s * 0.5 >= 20 ? s / 2 : s); drawIntegralSection(d, c, w.key, 0, 0); return view(d, s * 0.5 >= 20 ? s / 2 : s, `${nm} 단면도`, { dropText: ['단면'] }); }));
        } else {
            const rows = wingRows(c, w.key);
            const drain = c.wings && c.wings.dim && c.wings.dim[w.key] && c.wings.dim[w.key].wall && c.wings.dim[w.key].wall.drain;
            out.push(safe(`${nm} 정면도`, () => { const d = vd(s); drawWallElevation(d, rows, wingLen(c, w.key), 0, 0, { drain: Sg.show.wingDrain ? drain : null }); return view(d, s, `${nm} 정면도`); }));
            if (Sg.show.wingSection) {
                out.push(safe(`${nm} 시점단면`, () => { const d = vd(s); drawWallSection(d, rows[0], 0, 0, '', { names: false, drain: Sg.show.wingDrain ? drain : null }); return view(d, s, `${nm} 단면 (시점)`); }));
                out.push(safe(`${nm} 종점단면`, () => { const d = vd(s); drawWallSection(d, rows[1], 0, 0, '', { names: false, drain: Sg.show.wingDrain ? drain : null }); return view(d, s, `${nm} 단면 (종점)`); }));
            }
        }
    }
    return out;
}

function approachGeneralViews(p, c, Sg) {
    if (!hasApproach(c) || !SCR.approach || !Sg.show.approach) return [];
    const s = Sg.scales.approach || 50;
    return getApproach(c).list.map((a, i) => safe(`접속슬래브 ${i + 1}`, () => {
        const d = vd(s);
        SCR.approach.drawApproachSection(d, c, a, i);
        return view(d, s, `접속슬래브 상세 (${i + 1} : ${a.side})`, { dropText: [`접속${i + 1} : ${a.side}`] });
    }));
}

function earthView(p, c, Sg) {
    if (!SCR.earth || !Sg.show.earth) return null;
    const s = Sg.scales.base;
    const d = vd(s);
    const b = blocks(c)[0];
    SCR.earth.drawExcavation(d, p, c, 0, b.sta0, 'BLOCK 1 (시점)');
    return view(d, s, '토공 상세 (터파기)', { dropText: ['BLOCK 1 (시점)'] });
}

// ── 구조도 뷰 ────────────────────────────────────────────────────────

function mainAssemblyView(p, c, bi, cyc, Ss) {
    const s = Ss.scales.main;
    const d = vd(s);
    drawSection(d, c, bi, { simple: true });
    const lay = mainBarLayout(p, c, bi, { cycles: [cyc] });
    drawBars(d, lay, lay.bars, { color: BAR_COLOR });
    drawSpliceTicks(d, lay, lay.splices);
    drawBarMarks(d, lay, lay.bars.filter(b => b.layer === 1 || b.piece === 0));
    if (!Ss.show.barLen) d.entities = d.entities.filter(e => !(e.type === 'text' && /^L=/.test(e.str)));
    return view(d, s, `주철근 조립도 (${cyc}CYCLE)`);
}

function forceView(p, c, bi, diag, s) {
    const forces = memberForces(p, c, bi, { diag, state: '평상시' });
    if (!forces) return null;
    const d = vd(s);
    const g = drawSection(d, c, bi, { simple: true });
    drawForceDiagram(d, g, forces);
    return view(d, s, diag);
}

function planRebarView(p, c, bi, which, Ss) {
    if (!SCR.plan) return null;
    const s = Ss.scales.plan || Ss.scales.base;
    const d = SCR.plan.planDrawing(p, c, bi, { view: which });
    const nm = which === 'top' ? '상부슬래브' : which === 'bottom' ? '하부슬래브' : '중간슬래브';
    const drop = d.entities.filter(e => e.type === 'text' && /철근배치도$/.test(e.str)).map(e => e.str);
    return view(d, s, `평면 배근도 (${nm})`, { dropText: drop });
}

function horzView(p, c, bi, Ss) {
    const s = Ss.scales.horz || Ss.scales.base;
    const d = vd(s);
    drawSection(d, c, bi, { simple: true });
    const lay = mainBarLayout(p, c, bi, { cycles: [1], layers: [1] });
    drawBars(d, lay, lay.bars, { color: OTHER_COLOR, lapOffset: 0 });
    const hl = horzLayout(p, c, bi);
    const th = d.textHeight;
    const pre = (getRebarCommon(p).marks && getRebarCommon(p).marks.horz) || 'D';
    let no = 0;
    for (const F of hl.faces) {
        drawDots(d, F.dots.map(x => ({ pt: x.pt, color: x.extra ? COLOR.YELLOW : BAR_COLOR })), Math.max(12, th * 0.12));
        const pick = F.dots.filter(x => !x.extra);
        if (!pick.length) continue;
        no++;
        const a = pick[Math.floor(pick.length / 2)].pt;
        const out = [-F.inward[0], -F.inward[1]];
        const q = [a[0] + out[0] * th * 3, a[1] + out[1] * th * 3];
        d.line(a[0], a[1], q[0], q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0] + out[0] * th * 0.7, q[1] + out[1] * th * 0.7, `${pre}${no}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + out[0] * th * 0.7 + th, q[1] + out[1] * th * 0.7 - th, `${F.dia} CTC ${F.f && F.f.ctc ? F.f.ctc : ''}`.trim(), { color: COLOR.GREEN, h: th * 0.6, align: 'left', layer: 'MARK' });
    }
    return view(d, s, '수평철근 배근도');
}

function shearView(p, c, bi, Ss) {
    const sl = shearLayout(p, c, bi);
    if (!sl.members.some(m => m.ties.length)) return null;
    const s = Ss.scales.shear || Ss.scales.base;
    const d = vd(s);
    const th = d.textHeight;
    drawSection(d, c, bi, { simple: true });
    const lay = mainBarLayout(p, c, bi, { cycles: [1], layers: [1] });
    drawBars(d, lay, lay.bars, { color: OTHER_COLOR, lapOffset: 0 });
    const pre = getRebarCommon(p).marks.shear || 'S';
    let no = 0;
    for (const M of sl.members) {
        if (!M.ties.length) continue;
        no++;
        for (const t of M.ties) d.line(t.p0[0], t.p0[1], t.p1[0], t.p1[1], { color: BAR_COLOR, layer: 'REBAR' });
        const tt = M.ties[Math.floor(M.ties.length / 2)];
        const mid = [(tt.p0[0] + tt.p1[0]) / 2, (tt.p0[1] + tt.p1[1]) / 2];
        const q = [mid[0] + th * 2, mid[1] + th * 2];
        d.line(mid[0], mid[1], q[0], q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0] + th * 0.5, q[1] + th * 0.5, `${pre}${no}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + th * 1.5, q[1] + th * 0.5, `${M.cfg.dia} (${M.cfg.type})`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    }
    return view(d, s, '전단철근 배근도');
}

function columnRebarViews(p, c, bi, Ss) {
    const out = [];
    const s = Ss.scales.column || 20;
    for (const cw of columnWalls(c, bi)) {
        out.push(safe('기둥 단면', () => {
            const col = getBeamCol(c, bi, cw.index, 'col');
            if (!col) return null;
            const d = vd(s);
            const th = d.textHeight;
            const cy = { color: COLOR.CYAN, layer: 'CONC' };
            if (cw.round) d.circle(cw.b / 2, cw.D / 2, cw.b / 2, cy); else d.rect(0, 0, cw.b, cw.D, cy);
            const bars = columnBars(cw, col);
            const r = Math.max(8, barD(bars[0] ? bars[0].dia : 'D22') / 2);
            for (const b of bars) d.circle(b.x, b.y, r, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
            if (!cw.round) d.rect(80 - r, 80 - r, cw.b - 160 + 2 * r, cw.D - 160 + 2 * r, { color: BAR_COLOR, layer: 'REBAR' });
            d.dimH(0, cw.b, cw.D, cw.D + th * 2.2);
            d.dimV(0, cw.D, 0, -th * 2.2);
            const dias = [...new Set(bars.map(b => b.dia))];
            d.text(cw.b / 2, -th * 1.2, `주철근 ${bars.length}-${dias.join(',')}  띠철근 ${col.hoop && col.hoop.dia ? col.hoop.dia : ''}`, { color: COLOR.GREEN, h: th * 0.8, valign: 'top', layer: 'TEXT' });
            return view(d, s, `기둥 단면 (벽체${cw.index + 1})`);
        }));
        for (const [mem, title] of girderMembers(cw.g).filter(m => m[0] !== 'col')) {
            out.push(safe(title, () => {
                const gd = getBeamCol(c, bi, cw.index, mem);
                if (!gd) return null;
                const gb = girderBars(cw, mem, gd);
                if (!(gb.h > 0)) return null;
                const d = vd(s);
                const th = d.textHeight;
                d.rect(0, 0, gb.bw, gb.h, { color: COLOR.CYAN, layer: 'CONC' });
                for (const b of gb.bars) d.circle(b.x, b.y, Math.max(8, barD(b.dia) / 2), { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
                d.rect(80, 80, Math.max(10, gb.bw - 160), Math.max(10, gb.h - 160), { color: BAR_COLOR, layer: 'REBAR' });
                d.dimH(0, gb.bw, gb.h, gb.h + th * 2.2);
                d.dimV(0, gb.h, 0, -th * 2.2);
                return view(d, s, `${title} 단면 (벽체${cw.index + 1})`);
            }));
        }
    }
    return out;
}

// ── 철근상세 / 재료표 ───────────────────────────────────────────────

/** 철근상세 모음 (용지 mm, fixed 뷰) */
function shapesBlock(rows, cols = 4) {
    if (!rows.length) return null;
    const d = new Drawing({ textHeight: 2.2 });
    const cw = 92, ch = 52;
    rows.forEach((r, i) => {
        const x = (i % cols) * cw, y = -Math.floor(i / cols) * ch - ch + 12;
        drawBarShape(d, r, { x, y, w: 58, th: 2.0 });
    });
    return view(d, 1, '철 근 상 세', { fixed: true });
}

function fmtM(mm, unitM) { return unitM ? (mm / 1000).toFixed(3) : fmtNum(mm); }

/** 재료표 (용지 mm, fixed) */
function tableBlock(rows, G, opts = {}) {
    if (!rows.length) return null;
    const d = new Drawing({ textHeight: PAPER_TH });
    const unitM = opts.unitM !== false;
    const cols = [
        { t: '기 호', w: 14 }, { t: '직 경', w: 13 }, { t: unitM ? '길 이\n(m)' : '길 이\n(mm)', w: 18, align: 'right' }, { t: '수 량\n(EA)', w: 15, align: 'right' },
        { t: '총길이\n(m)', w: 20, align: 'right' }, { t: '단위중량\n(kg/m)', w: 18, align: 'right' }, { t: '총중량\n(kg)', w: 20, align: 'right' },
    ];
    const body = rows.map(r => [r.mark, r.dia, fmtM(r.length, unitM), fmtNum(r.count), (r.length / 1000 * n0(r.count)).toFixed(3), (r.unitMass || 0).toFixed(3), (r.weight || 0).toFixed(1)]);
    const t = drawTable(d, 0, 0, cols, body, { rowH: opts.rowH || 5.5, th: 2.2, shadow: G.tableShadow, title: opts.title });
    if (opts.summary) {
        const S = summarize(opts.summary);
        const sc = [{ t: '직 경', w: 16 }, { t: '총길이(m)', w: 26, align: 'right' }, { t: '총중량(kg)', w: 26, align: 'right' }, { t: '할증포함(kg)', w: 28, align: 'right' }];
        const sb = S.list.map(e => [e.dia, e.length.toFixed(3), e.net.toFixed(1), e.gross.toFixed(1)]);
        sb.push({ cells: ['합 계', '', S.net.toFixed(1), S.gross.toFixed(1)], color: 2, bold: true });
        sb.push({ cells: ['(ton)', '', (S.net / 1000).toFixed(3), (S.gross / 1000).toFixed(3)], color: 2 });
        drawTable(d, 0, -t.h - 8, sc, sb, { rowH: 5.5, th: 2.2, shadow: G.tableShadow, title: '직경별 집계표' });
    }
    return view(d, 1, null, { fixed: true });
}

function summarize(rows) {
    const by = {};
    let net = 0, gross = 0;
    for (const r of rows) {
        const k = normDia(r.dia);
        if (!k) continue;
        const e = by[k] || (by[k] = { dia: k, length: 0, net: 0, gross: 0 });
        e.length += r.length / 1000 * n0(r.count);
        e.net += r.weight || 0;
        e.gross += r.weightF || r.weight || 0;
        net += r.weight || 0; gross += r.weightF || r.weight || 0;
    }
    return { list: DIAS.filter(d => by[d]).map(d => by[d]), net, gross };
}

/** 철근상세+재료표 페이지 분할: [{ rows, last }] */
function detailChunks(rows, per) {
    per = Math.max(5, per | 0 || 40);
    const out = [];
    for (let i = 0; i < rows.length; i += per) out.push({ rows: rows.slice(i, i + per), last: i + per >= rows.length });
    return out;
}

/** 철근상세 + 재료표 고정 배치 페이지 */
function detailPage(p, c, S, meta, chunk, allRows, show) {
    const G = S.general;
    const d = new Drawing({ textHeight: PAPER_TH });
    const info = p.info || {};
    const fr = drawSheetFrame(d, { size: G.size, title: meta.title, projectName: info.projectName, client: info.client, designer: info.designer, contractor: info.contractor, site: info.siteName, name1: c.name, number: meta.number, date: today(), fields: G.fields, dgk: G.dgk });
    const A = fr.area;
    const views = [];
    if (show.table !== false) views.push(safe('재료표', () => tableBlock(chunk.rows, G, { title: '철 근 재 료 표', summary: chunk.last && show.summary !== false ? allRows : null, unitM: show.unitM })));
    const tW = views[0] ? 124 : 0;
    const placed = [];
    if (views[0]) {
        const v = views[0];
        const bb = v.d.bbox();
        d.merge(v.d, A.x + A.w - tW - bb.minX, A.y + A.h - bb.maxY);
        placed.push(v);
    }
    if (show.shapes !== false) {
        const cols = Math.max(1, Math.floor((A.w - tW - 10) / 92));
        const sv = shapesBlock(chunk.rows, cols);
        if (sv) {
            const bb = sv.d.bbox();
            const top = A.y + A.h - TITLE_H;
            const sc = Math.min(1, (top - A.y) / Math.max(1, bb.h), (A.w - tW - 10) / Math.max(1, bb.w));
            d.merge(sv.d, A.x - bb.minX * sc, top - bb.maxY * sc, sc);
            drawViewTitle(d, A.x + bb.w * sc / 2, top + 1.5, '철 근 상 세', '', { box: true, shadow: G.titleShadow, th: 4 });
        }
    }
    d.text(15 + 504 * (fr.W - 30) / 811, 10 + 28 / 6, 'NONE', { color: 6, layer: 'FRAME-TEXT', h: 2.4, valign: 'middle' });
    finalize(d, G);
    d.sheetScale = 1;
    d.sheetSize = { w: fr.W, h: fr.H };
    d.title = meta.title;
    return d;
}

// ── 날개벽 배근 뷰 ───────────────────────────────────────────────────

function integralFaceView(p, c, key, face, s) {
    const ev = integralElevation(c, key);
    const r = getWingRebar(c, key);
    const f = r[face];
    if (!f) return null;
    const { cover: cv, marks } = wingCoverOf(c, key);
    const d = vd(s);
    const th = d.textHeight;
    const mir = face === 'back';
    const X = (x) => (mir ? ev.L1 - x : x);
    d.pline(ev.poly.map(([x, y]) => [X(x), y]), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.line(X(0), 0, X(0), ev.hRoot, { color: COLOR.GREEN, dash: 'hidden', layer: 'HIDDEN' });
    const xs = zonePositions(f.V, 0).filter(x => x < ev.L1 - 1);
    for (const x of xs) d.line(X(x), cv.bottom, X(x), ev.topAt(x) - cv.top, { color: BAR_COLOR, layer: 'REBAR' });
    const ys = zonePositions(f.H, 0).filter(y => y < ev.hRoot - 1);
    const ext = (y) => (y <= ev.hTip ? ev.L1 : ev.L1 * (ev.hRoot - y) / Math.max(1, ev.hRoot - ev.hTip));
    for (const y of ys) d.line(X(-th * 1.5), y, X(Math.max(0, ext(y) - cv.end)), y, { color: BAR_COLOR, layer: 'REBAR' });
    d.dimH(0, ev.L1, 0, -th * 2.5);
    d.dimV(0, ev.hRoot, mir ? ev.L1 : 0, mir ? ev.L1 + th * 2.5 : -th * 2.5);
    const bub = (pt, txt, dia) => {
        const q = [pt[0] + th * 2, pt[1] + th * 1.6];
        d.line(pt[0], pt[1], q[0], q[1] - th * 0.7, { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], txt, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + th, q[1], dia || '', { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    };
    if (xs.length) { const x = xs[Math.floor(xs.length / 2)]; bub([X(x), ev.topAt(x) * 0.6], `${marks.main}1`, f.dia && f.dia.v); }
    if (ys.length) { const y = ys[Math.floor(ys.length / 3)]; bub([X(ext(y) * 0.4), y], `${marks.main}2`, f.dia && f.dia.h1); }
    return view(d, s, face === 'front' ? '전 면' : '배 면');
}

function integralSecAView(c, key, s) {
    const ev = integralElevation(c, key);
    const r = getWingRebar(c, key);
    const { cover: cv } = wingCoverOf(c, key);
    const d = vd(s);
    const th = d.textHeight;
    const T1 = ev.T1 || 300, T2 = ev.T2 || 300, H = ev.hRoot;
    d.pline([[0, 0], [T2, 0], [T1, H], [0, H]], { color: COLOR.CYAN, layer: 'CONC', closed: true });
    const xb = (y) => T2 + (T1 - T2) * y / H;
    d.line(cv.front, cv.bottom, cv.front, H - cv.top, { color: BAR_COLOR, layer: 'REBAR' });
    d.line(xb(cv.bottom) - cv.back, cv.bottom, xb(H - cv.top) - cv.back, H - cv.top, { color: BAR_COLOR, layer: 'REBAR' });
    const rr = Math.max(10, th * 0.12);
    for (const y of zonePositions(r.front.H, 0).filter(y => y < H)) d.circle(cv.front + barD(r.front.dia.v), y, rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    for (const y of zonePositions(r.back.H, 0).filter(y => y < H)) d.circle(xb(y) - cv.back - barD(r.back.dia.v), y, rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    d.dimH(0, T1, H, H + th * 2);
    d.dimH(0, T2, 0, -th * 2);
    d.dimV(0, H, 0, -th * 2);
    return view(d, s, '단면 A-A');
}

function integralSecBView(p, c, key, s) {
    const wp = wingPlan(p, c, key);
    const r = getWingRebar(c, key);
    const { cover: cv } = wingCoverOf(c, key);
    const d = vd(s);
    const th = d.textHeight;
    // 평면 배치 그대로 회전만 해서 날개벽을 수평으로
    const pv = wingPlanView(wp);
    const Q = pv.Q;
    d.pline(wp.poly.map(Q), { color: COLOR.CYAN, layer: 'CONC', closed: true });
    if (wp.haunch) d.line(...Q(wp.haunch[0]), ...Q(wp.haunch[1]), { color: COLOR.CYAN, layer: 'CONC' });
    const hb = r.back && r.back.dia && r.back.dia.hu ? haunchBarLine(wp, cv) : null;
    // 암거 벽체 (일부)
    const bw = bodyWallPlan(wp, hb);
    for (const sg of [bw.outer, bw.inner, bw.end]) d.line(...Q(sg[0]), ...Q(sg[1]), { color: COLOR.CYAN, layer: 'CONC' });
    d.line(...Q(bw.cut[0]), ...Q(bw.cut[1]), { color: COLOR.GRAY, layer: 'CUT', dash: 'center' });
    if (hb) d.pline(hb.pts.map(Q), { color: BAR_COLOR, layer: 'REBAR' });
    const L = wp.len, T = wp.thick;
    const dev = Math.max(300, 40 * barD(r.front.dia.h1));
    // 수평철근: 암거 벽체 내측 피복까지 연장, 끝 100 꺾음
    for (const fk of ['front', 'back']) {
        const hp = horzBarPlan(wp, cv, fk);
        const off = fk === 'front' ? cv.front : T - cv.back;
        if (hp) d.pline(hp.pts.map(Q), { color: BAR_COLOR, layer: 'REBAR' });
        else d.line(...Q(pv.at(-dev, off)), ...Q(pv.at(L - cv.end, off)), { color: BAR_COLOR, layer: 'REBAR' });
    }
    const rr = Math.max(10, th * 0.12);
    for (const x of zonePositions(r.front.V, 0).filter(x => x < L)) d.circle(...Q(pv.at(x, cv.front + barD(r.front.dia.h1))), rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    for (const x of zonePositions(r.back.V, 0).filter(x => x < L)) d.circle(...Q(pv.at(x, T - cv.back - barD(r.back.dia.h1))), rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    const xb = Q(pv.at(L, 0))[0];
    d.dimH(Math.min(0, xb), Math.max(0, xb), 0, -pv.sy * th * 2);
    return view(d, s, '단면 B-B');
}

function wallFaceView(c, key, face, s) {
    const rows = wingRows(c, key);
    const L = wingLen(c, key);
    const r = getWingRebar(c, key);
    const d = vd(s);
    const e = drawWallElevation(d, rows, L, 0, 0, {});
    const ctc = n0(r.std) || 250;
    const cv = 80;
    const yb = (x) => e.botS + (e.botE - e.botS) * x / (L || 1);
    const yt = (x) => e.topS + (e.topE - e.topS) * x / (L || 1);
    for (let x = cv; x <= L - cv + 1e-6; x += ctc) d.line(x, yb(x) + cv, x, yt(x) - cv, { color: BAR_COLOR, layer: 'REBAR' });
    const hz = r.horz && r.horz.wall;
    const hc = n0(hz && hz.ctc) || 300;
    const yMin = Math.max(e.botS, e.botE) + 700, yMax = Math.min(e.topS, e.topE) - cv;
    for (let y = yMin; y <= yMax; y += hc) d.line(cv, y, L - cv, y, { color: BAR_COLOR, layer: 'REBAR' });
    const m = r.main && r.main.wall;
    const th = d.textHeight;
    const q = [L * 0.5 + th * 2, yt(L * 0.5) + th * 2];
    d.line(L * 0.5, yt(L * 0.5) - th, q[0], q[1] - th * 0.7, { color: COLOR.RED, layer: 'MARK' });
    d.bubble(q[0], q[1], `${wingCoverOf(c, key).marks.main}${face === 'back' ? 1 : 2}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
    d.text(q[0] + th, q[1], (m && (face === 'back' ? m.back : m.front)) || '', { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    return view(d, s, face === 'back' ? '벽체 배면' : '벽체 전면');
}

/**
 * 옹벽식 저판 배근도 (평면). face: 'top' 상면 / 'bottom' 하면.
 * 국부 좌표: x = 옹벽 길이방향 (시점단면 0 → 종점단면 L), y = 앞굽 끝에서 뒷굽 쪽 거리 (앞굽 끝 0).
 * 단면 폭이 시·종점에서 다르면 직선 보간. 주철근 = 단면 방향 (std 간격), 배력철근 = 길이 방향 (horz.foot.ctc).
 */
function footingPlanView(c, key, face, s) {
    const rows = wingRows(c, key);
    const S0 = wallSection(rows[0]), S1 = wallSection(rows[1] || rows[0]);
    const L = wingLen(c, key);
    const r = getWingRebar(c, key);
    const { marks } = wingCoverOf(c, key);
    const d = vd(s);
    const th = d.textHeight;
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const hid = { ...cy, dash: 'hidden' };
    const lerp = (a, b, x) => a + (b - a) * x / (L || 1);
    const Wx = (x) => lerp(S0.W, S1.W, x);
    // 단면 좌표 u (뒷굽 끝 0) → y
    const Y = (x, f) => Wx(x) - lerp(f(S0), f(S1), x);
    const edge = (f, st) => d.line(0, Y(0, f), L, Y(L, f), st);
    // 기초 외곽
    d.pline([[0, 0], [L, 0], [L, S1.W], [0, S0.W]], { ...cy, closed: true });
    // 벽체 하단 (상면도: 실선, 하면도: 은선), 전단키 (하면도: 은선)
    const stemSt = face === 'top' ? cy : hid;
    edge(S => S.stem.xb1, stemSt);
    edge(S => S.stem.xb0, stemSt);
    if (face === 'bottom' && S0.key && S1.key) { edge(S => S.key[0][0], hid); edge(S => S.key[1][0], hid); }
    const cv = 80;
    const m = (r.main && r.main.foot) || {};
    const hz = (r.horz && r.horz.foot) || {};
    const ctc = n0(r.std) || 250;
    const mainDia = face === 'top' ? m.top : m.bottom;
    const distDia = face === 'top' ? hz.back : hz.front;
    const hc = n0(hz.ctc) || 300;
    // 주철근 (단면 방향): 상면은 '저판 끊기' 시 벽체 앞면까지
    if (m.place !== false && mainDia) {
        for (let x = cv; x <= L - cv + 1e-6; x += ctc) {
            const y0 = face === 'top' && m.gap ? Y(x, S => S.B2 + S.B3) + cv : cv;
            d.line(x, y0, x, Wx(x) - cv, { color: BAR_COLOR, layer: 'REBAR' });
        }
    }
    // 배력철근 (길이 방향)
    if (distDia) {
        const yMax = Math.min(S0.W, S1.W) - cv;
        for (let y = cv; y <= yMax + 1e-6; y += hc) d.line(cv, y, L - cv, y, { color: OTHER_COLOR, layer: 'REBAR' });
    }
    // 철근 표기
    const xm = L * 0.35, ym = Wx(xm) + th * 2.5;
    if (mainDia) {
        d.line(xm, Wx(xm) - cv, xm, ym - th * 0.7, { color: COLOR.RED, layer: 'MARK' });
        d.bubble(xm, ym, `${marks.main}${face === 'top' ? 3 : 4}`, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(xm + th, ym, `${mainDia} CTC ${ctc}`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    }
    if (distDia) {
        const yq = cv + hc * Math.max(0, Math.floor(((Math.min(S0.W, S1.W) - 2 * cv) / hc) / 2));
        d.line(L - cv, yq, L + th * 2, yq, { color: COLOR.RED, layer: 'MARK' });
        d.text(L + th * 2.3, yq, `${distDia} CTC ${hc} (배력)`, { color: COLOR.GREEN, h: th * 0.6, align: 'left', valign: 'middle', layer: 'MARK' });
    }
    // 치수
    d.dimH(0, L, 0, -th * 2.2);
    d.dimV(0, S0.W, 0, -th * 2.2);
    if (Math.abs(S1.W - S0.W) > 1) d.dimV(0, S1.W, L, L + th * 9);
    return view(d, s, face === 'top' ? '저판 상면 배근도' : '저판 하면 배근도');
}

function wallSectionRebarView(c, key, end, s) {
    const rows = wingRows(c, key);
    const row = rows[end] || rows[0];
    const r = getWingRebar(c, key);
    const { marks } = wingCoverOf(c, key);
    const sct = wallSection(row);
    const d = vd(s);
    const th = d.textHeight;
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    d.pline(sct.poly, { ...cy, closed: true });
    if (sct.key) d.pline(sct.key, cy);
    if (sct.lean) d.pline(sct.lean, { ...cy, closed: true });
    const cv = 80, st = sct.stem;
    const backAt = (y) => st.xb0 + (st.xt0 - st.xb0) * (y - sct.BF1) / ((sct.WH - sct.BF1) || 1);
    const frontAt = (y) => st.xb1 + (st.xt1 - st.xb1) * (y - sct.yJ) / ((sct.WH - sct.yJ) || 1);
    const m = r.main || {};
    const pts = [];
    if (m.wall && m.wall.place) {
        const yb0 = cv, yt0 = sct.WH - cv;
        d.pline([[backAt(yt0) + cv, yt0], [st.xb0 + cv, Math.max(yb0, sct.BF1)], [st.xb0 + cv, yb0], [st.xb0 + cv - 400, yb0]], { color: BAR_COLOR, layer: 'REBAR' });
        d.pline([[frontAt(yt0) - cv, yt0], [st.xb1 - cv, sct.yJ], [st.xb1 - cv, yb0], [st.xb1 - cv + 400, yb0]], { color: BAR_COLOR, layer: 'REBAR' });
        pts.push([[backAt(sct.WH * 0.6) + cv, sct.WH * 0.6], `${marks.main}1`, m.wall.back, -1], [[frontAt(sct.WH * 0.6) - cv, sct.WH * 0.6], `${marks.main}2`, m.wall.front, 1]);
    }
    if (m.foot && m.foot.place) {
        const yT = (x) => (x <= st.xb0 ? sct.BF2 + (sct.BF1 - sct.BF2) * x / (st.xb0 || 1) : sct.BB1 + (sct.BB2 - sct.BB1) * (x - st.xb1) / ((sct.W - st.xb1) || 1)) - cv;
        d.pline([[cv, yT(cv)], [st.xb0, yT(st.xb0)], [m.foot.gap ? st.xb1 : sct.W - cv, m.foot.gap ? sct.BB1 - cv : yT(sct.W - cv)]], { color: BAR_COLOR, layer: 'REBAR' });
        d.line(cv, cv, sct.W - cv, cv, { color: BAR_COLOR, layer: 'REBAR' });
        pts.push([[sct.W * 0.2, yT(sct.W * 0.2)], `${marks.main}3`, m.foot.top, -1], [[sct.W * 0.75, cv], `${marks.main}4`, m.foot.bottom, 1]);
    }
    const hz = r.horz || {};
    const rr = Math.max(10, th * 0.12);
    for (let y = sct.yJ + 100; y < sct.WH - cv; y += n0(hz.wall && hz.wall.ctc) || 300) {
        d.circle(backAt(y) + cv + 25, y, rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
        d.circle(frontAt(y) - cv - 25, y, rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    }
    for (let x = cv + 100; x < sct.W - cv; x += n0(hz.foot && hz.foot.ctc) || 300) d.circle(x, cv + 25, rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    for (const [pt, t, dia, sg] of pts) {
        const q = [pt[0] + sg * th * 3, pt[1] + th * 1.5];
        d.line(pt[0], pt[1], q[0] - sg * th * 0.7, q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], t, { r: th * 0.7, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0] + sg * th, q[1], dia || '', { color: COLOR.GREEN, h: th * 0.6, align: sg > 0 ? 'left' : 'right', valign: 'middle', layer: 'MARK' });
    }
    d.dimH(0, sct.W, 0, -th * 2.5);
    d.dimV(0, sct.WH, sct.W, sct.W + th * 2.5);
    return view(d, s, end === 0 ? '시점 단면도' : '종점 단면도');
}

// ── 접속슬래브 배근 뷰 ───────────────────────────────────────────────

function approachPlanRebarView(p, c, i, s) {
    const D = approachDims(p, c, i);
    const r = getApproachRebar(c, i);
    const W = D.Wa, L = D.Ltot;
    const d = vd(s);
    const th = d.textHeight;
    const cv = r.cover;
    const ang = (n0(D.a.s && D.a.s.ang) || 90) * Math.PI / 180;
    const cot = Math.abs(Math.sin(ang)) < 1e-6 ? 0 : Math.cos(ang) / Math.sin(ang);
    const P = (x, y) => [x + cot * y, y];
    d.pline([P(0, 0), P(W, 0), P(W, L), P(0, L)], { color: COLOR.CYAN, layer: 'CONC', closed: true });
    const xm = W / 2;
    d.line(...P(xm, -th), ...P(xm, L + th), { color: COLOR.CYAN, dash: 'center', layer: 'CENTER' });
    d.text(...P(xm - th, L + th * 0.5), '상 면', { color: COLOR.GREEN, h: th, align: 'right', layer: 'TEXT' });
    d.text(...P(xm + th, L + th * 0.5), '하 면', { color: COLOR.GREEN, h: th, align: 'left', layer: 'TEXT' });
    const mt = n0(r.main.top.ctc) || 250, mb = n0(r.main.bottom.ctc) || 125;
    for (let x = cv.side; x <= xm + 1e-6; x += mt) d.line(...P(x, cv.side), ...P(x, L - cv.side), { color: BAR_COLOR, layer: 'REBAR' });
    for (let x = W - cv.side; x >= xm - 1e-6; x -= mb) d.line(...P(x, cv.side), ...P(x, L - cv.side), { color: BAR_COLOR, layer: 'REBAR' });
    const ht = n0(r.horz.top.ctc) || 300, hb = n0(r.horz.bottom.ctc) || 150;
    for (let y = cv.side; y <= L - cv.side + 1e-6; y += ht) d.line(...P(cv.side, y), ...P(xm, y), { color: BAR_COLOR, layer: 'REBAR' });
    for (let y = cv.side; y <= L - cv.side + 1e-6; y += hb) d.line(...P(xm, y), ...P(W - cv.side, y), { color: BAR_COLOR, layer: 'REBAR' });
    const bub = (pt, txt, dia, q) => {
        d.line(pt[0], pt[1], q[0], q[1], { color: COLOR.RED, layer: 'MARK' });
        d.bubble(q[0], q[1], txt, { r: th * 0.8, color: COLOR.RED, textColor: COLOR.GREEN });
        d.text(q[0], q[1] - th, dia, { color: COLOR.GREEN, h: th * 0.6, valign: 'top', layer: 'MARK' });
    };
    bub(P(cv.side + mt * 2, L * 0.7), 'AS1', r.main.top.dia, P(-th * 3, L * 0.8));
    bub(P(W - cv.side - mb * 2, L * 0.7), 'AS2', r.main.bottom.dia, P(W + th * 3, L * 0.8));
    bub(P(W * 0.25, cv.side + ht), 'AH1', r.horz.top.dia, P(-th * 3, L * 0.3));
    bub(P(W * 0.75, cv.side + hb), 'AH2', r.horz.bottom.dia, P(W + th * 3, L * 0.3));
    d.dimH(0, W, L, L + th * 3);
    d.dimV(0, L, 0, -th * 4.5);
    return view(d, s, '평 면 도');
}

function approachSecRebarView(p, c, i, s) {
    const D = approachDims(p, c, i);
    const r = getApproachRebar(c, i);
    const g = sectionGeom(c, 0);
    const sec = approachSection(c, D.a, g);
    const d = vd(s);
    const th = d.textHeight;
    const cv = r.cover;
    d.pline(sec.slab, { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.pline(sec.bracket, { color: COLOR.CYAN, layer: 'CONC', closed: true });
    d.line(0, sec.yBr - 1200, 0, g.Htot, { color: COLOR.CYAN, layer: 'CONC' });
    const yTop = (x) => sec.topAt(x), yBot = (x) => sec.topAt(x) - sec.thick(x);
    const sx = [sec.x0 + cv.side, sec.x1 - cv.side];
    d.line(sx[0], yTop(sx[0]) - cv.top, sx[1], yTop(sx[1]) - cv.top, { color: BAR_COLOR, layer: 'REBAR' });
    d.line(sx[0], yBot(sx[0]) + cv.bottom, sx[1], yBot(sx[1]) + cv.bottom, { color: BAR_COLOR, layer: 'REBAR' });
    const rr = Math.max(12, th * 0.1);
    const ht = n0(r.horz.top.ctc) || 300, hb = n0(r.horz.bottom.ctc) || 150;
    for (let x = sx[0]; x <= sx[1]; x += ht) d.circle(x, yTop(x) - cv.top - barD(r.main.top.dia), rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    for (let x = sx[0]; x <= sx[1]; x += hb) d.circle(x, yBot(x) + cv.bottom + barD(r.main.bottom.dia), rr, { color: BAR_COLOR, fill: BAR_COLOR, layer: 'REBAR' });
    if (r.shear.dia) for (let x = sx[0] + 150; x < sx[1]; x += n0(r.shear.ctc) || 300) d.line(x, yBot(x) + cv.bottom - 20, x, yTop(x) - cv.top + 20, { color: COLOR.YELLOW, layer: 'REBAR' });
    d.dimH(sec.x0, sec.x1, sec.topFar, Math.max(sec.topNear, sec.topFar) + th * 2);
    d.dimV(yBot(sec.x1), yTop(sec.x1), sec.x1, sec.x1 + th * 2.4);
    return view(d, s, '단면 B-B');
}

/**
 * 재료표에서 날개벽 key 의 행.
 * (wingBars 의 desc 에 날개벽 이름이 빠져 있어 — `{ desc: name+…, ...o }` 순서 — 같은 블록의 날개벽 행을 생성 순서로 나눈다.)
 */
function wingScheduleRows(p, c, key, blockRows) {
    const all = blockRows.filter(r => r.cat === '날개벽');
    const named = all.filter(r => String(r.desc || '').startsWith(WING_NAMES[key]));
    if (named.length) return named;
    const bi = wingBlock(c, key);
    const ws = installedWings(c).filter(w => wingBlock(c, w.key) === bi);
    const counts = ws.map(w => safe('wingBars', () => wingBars(p, c, w.key).filter(o => o.count > 0 && o.dia).length) || 0);
    const tot = counts.reduce((a, b) => a + b, 0);
    const k = ws.findIndex(w => w.key === key);
    if (k < 0) return [];
    if (tot === all.length) {
        const start = counts.slice(0, k).reduce((a, b) => a + b, 0);
        return all.slice(start, start + counts[k]);
    }
    // 사용자가 행을 고친 경우: 설명이 일치하는 행 (중복 시 앞쪽)
    const descs = new Set((safe('wingBars', () => wingBars(p, c, key)) || []).map(o => o.desc));
    return ws.length === 1 ? all : all.filter(r => descs.has(r.desc));
}

/** 브래킷 / 다우웰바 상세 (구조물 외면 부근만) */
function approachBracketView(c, a, s, withDowel = true) {
    const g = sectionGeom(c, 0);
    const sec = approachSection(c, a, g);
    const b = a.bracket || {};
    const d = vd(s);
    const th = d.textHeight;
    const cy = { color: COLOR.CYAN, layer: 'CONC' };
    const L = Math.min(sec.x1, sec.x0 + 1500);
    const yTop = (x) => sec.topAt(x), yBot = (x) => sec.topAt(x) - sec.thick(x);
    d.pline(sec.bracket, { ...cy, closed: true });
    d.line(0, sec.yBr - n0(b.bH2) - n0(b.bH3) - 600, 0, g.Htot, cy);
    d.line(0, g.Htot, -600, g.Htot, cy);
    d.pline([[L, yBot(L)], [sec.x0, yBot(sec.x0)], [sec.x0, yTop(sec.x0)], [L, yTop(L)]], cy);
    const ym = (yTop(L) + yBot(L)) / 2;
    d.pline([[L, yBot(L) - th * 0.3], [L, ym - th * 0.3], [L + th * 0.4, ym], [L - th * 0.4, ym + th * 0.2], [L, ym + th * 0.5], [L, yTop(L) + th * 0.3]], cy);
    if (withDowel) {
        const dw = a.dowel || {};
        const yD = sec.yBr + n0(a.H2) / 2;
        const dl = Math.min(n0(dw.len) || 1000, 1400);
        d.line(sec.x0 - Math.min(dl / 2, sec.x0 + n0(b.bW)), yD, sec.x0 + dl / 2, yD, { color: COLOR.MAGENTA, layer: 'REBAR', width: 2 });
        d.leader([[sec.x0 + dl * 0.3, yD], [sec.x0 + dl * 0.3 + th * 2, yTop(sec.x0) + th * 2.5]], `다웰바 ${dw.dia || ''} CTC ${dw.ctc || ''}`, { color: COLOR.GREEN });
    }
    d.dimH(0, n0(b.bW), sec.yBr - n0(b.bH2) - n0(b.bH3), sec.yBr - n0(b.bH2) - n0(b.bH3) - th * 2.4);
    d.dimV(sec.yBr - n0(b.bH2), sec.yBr, n0(b.bW), n0(b.bW) + th * 1.5);
    d.dimV(yBot(sec.x0), yTop(sec.x0), sec.x0, -th * 2.6);
    d.dimH(0, sec.x0, yTop(sec.x0), yTop(sec.x0) + th * 2.2);
    return view(d, s, '브래킷 및 다우웰바 상세');
}

// ── 시트 목록 ────────────────────────────────────────────────────────

function blockLabel(list, nb) {
    if (nb <= 1) return '';
    return `BLOCK${list.map(b => b + 1).join(',')} `;
}

/**
 * 시트 목록.
 * opts: { culverts: [ci...] (생략 시 전체) }
 */
export function listSheets(p, opts = {}) {
    const groups = [];
    let no = 0;
    const want = opts.culverts ? new Set(opts.culverts) : null;
    (p.culverts || []).forEach((c, ci) => {
        if (want && !want.has(ci)) return;
        const S = drawingSettings(p, ci);
        const G = S.general;
        const nb = blocks(c).length;
        const rowsMemo = new Map();
        const rowsOf = (bi) => { if (!rowsMemo.has(bi)) rowsMemo.set(bi, safe(`철근제원 BLOCK${bi + 1}`, () => scheduleRows(p, c, bi)) || []); return rowsMemo.get(bi); };
        const mkItem = (category, title, build) => {
            const n = String(++no).padStart(3, '0');
            const meta = { no: n, title, number: `${G.prefix || ''}${n}`, fileName: '' };
            return { no: n, title, ci, category, key: `${ci}|${category}|${title}`, number: meta.number, build: () => build(meta) };
        };
        const gen = [], str = [], etc = [];
        const Sg = S.gen, Ss = S.struct;

        // ── 일반도 ──
        const v1 = (bisForSection) => {
            const vs = [];
            if (Sg.show.plan) vs.push(safe('평면도', () => planView(p, c, Sg)));
            if (Sg.show.section) {
                for (const ds of distinctSections(c, bisForSection)) {
                    const lbl = distinctSections(c, blocks(c).map(b => b.index)).length > 1 ? ` (BLOCK${ds.list.map(b => b + 1).join(',')})` : '';
                    vs.push(safe('표준단면도', () => sectionView(p, c, ds.bi, Sg.scales.base, `표준단면도${lbl}`)));
                }
            }
            if (Sg.show.profile) vs.push(safe('종단면도', () => profileView(p, c, Sg)));
            return vs;
        };
        const details = () => {
            const vs = [];
            if (Sg.show.cjoint) vs.push(safe('시공이음', () => cjointView(c, Sg)));
            if (nb > 1) {
                if (Sg.show.expTop && sectionGeom(c, 0).kind !== 'U') vs.push(safe('신축이음 상부', () => expJointView(c, 'top', Sg)));
                if (Sg.show.expBottom) vs.push(safe('신축이음 하부', () => expJointView(c, 'bottom', Sg)));
                if (Sg.show.expWall) vs.push(safe('신축이음 벽체', () => expJointView(c, 'wall', Sg)));
            }
            if (Sg.show.column) vs.push(safe('기둥', () => columnView(c, Sg)));
            if (Sg.show.rail) vs.push(safe('난간벽', () => railView(c, 'rail', Sg.scales.rail, '난간벽 상세')));
            if (Sg.show.cut) vs.push(safe('차수벽', () => railView(c, 'cut', Sg.scales.cut, '차수벽 상세')));
            return vs;
        };
        const page2 = () => [...wingGeneralViews(p, c, Sg), ...approachGeneralViews(p, c, Sg), safe('토공', () => earthView(p, c, Sg))];
        const allB = blocks(c).map(b => b.index);
        const note = () => (Sg.show.note ? safe('노트', () => notes(p, c, G, 'gen')) : null);
        const nm = c.name || `암거${ci + 1}`;
        if (Sg.onePage) {
            gen.push(mkItem('일반도', `${nm} 일반도`, (m) => composeSheet(p, c, S, m, [...v1(allB), ...details(), ...page2(), note()])));
        } else if (Sg.page === 'block' && nb > 1) {
            gen.push(mkItem('일반도', `${nm} 일반도(1)`, (m) => composeSheet(p, c, S, m, [Sg.show.plan ? safe('평면도', () => planView(p, c, Sg)) : null, Sg.show.profile ? safe('종단면도', () => profileView(p, c, Sg)) : null, note()])));
            const per = Math.max(1, Sg.blockN | 0);
            let k = 2;
            for (let i = 0; i < nb; i += per) {
                const list = allB.slice(i, i + per);
                gen.push(mkItem('일반도', `${nm} 일반도(${k++})`, (m) => composeSheet(p, c, S, m, [
                    ...(Sg.show.section ? list.map(bi => safe('표준단면도', () => sectionView(p, c, bi, Sg.scales.base, `표준단면도 (BLOCK${bi + 1})`))) : []),
                    ...(i === 0 ? details() : []),
                ])));
            }
            const v2 = page2();
            if (v2.some(Boolean)) gen.push(mkItem('일반도', `${nm} 일반도(${k})`, (m) => composeSheet(p, c, S, m, page2())));
        } else {
            gen.push(mkItem('일반도', `${nm} 일반도(1)`, (m) => composeSheet(p, c, S, m, [...v1(allB), ...details(), note()])));
            const has2 = installedWings(c).length || hasApproach(c) || (SCR.earth && Sg.show.earth);
            if (has2) gen.push(mkItem('일반도', `${nm} 일반도(2)`, (m) => composeSheet(p, c, S, m, page2())));
        }

        // ── 구조도 ──
        let units = allB.map(bi => [bi]);
        if (Ss.page === 'merge') {
            const sig = new Map();
            for (const bi of allB) {
                const k = JSON.stringify(sectionOf(c, bi)) + JSON.stringify(rowsOf(bi).filter(r => BODY_CATS.includes(r.cat)).map(r => [r.mark, r.dia, r.length, r.count]));
                if (sig.has(k)) sig.get(k).push(bi); else sig.set(k, [bi]);
            }
            units = [...sig.values()];
        }
        for (const list of units) {
            const bi = list[0];
            const lbl = blockLabel(list, nb);
            let k = 1;
            const T = () => `${lbl}구조도 (${k++})`;
            const st = getSettings(c, bi);
            const cycs = cyclesOf(st).filter(cy => Ss.show[`c${cy}`] !== false);
            // (1) 주철근 조립도
            str.push(mkItem('구조도', T(), (m) => composeSheet(p, c, S, m, [
                Ss.show.genSection ? safe('일반단면도', () => sectionView(p, c, bi, Ss.scales.genSection, '일반단면도')) : null,
                ...cycs.map(cy => safe(`주철근 ${cy}C`, () => mainAssemblyView(p, c, bi, cy, Ss))),
                Ss.show.bmd ? safe('BMD', () => forceView(p, c, bi, 'BMD', Ss.scales.bmd)) : null,
                Ss.show.sfd ? safe('SFD', () => forceView(p, c, bi, 'SFD', Ss.scales.sfd)) : null,
                Ss.show.rail ? safe('난간벽', () => railView(c, 'rail', Ss.scales.rail, '난간벽 상세')) : null,
                Ss.show.cut ? safe('차수벽', () => railView(c, 'cut', Ss.scales.cut, '차수벽 상세')) : null,
                Ss.show.note ? safe('노트', () => notes(p, c, G, 'struct')) : null,
            ])));
            // (2) 평면 배근도
            const g0 = safe('단면', () => sectionGeom(c, bi));
            const planViews = (m) => composeSheet(p, c, S, m, [
                Ss.show.planSection ? safe('표준단면도', () => sectionView(p, c, bi, Ss.scales.std, '표준단면도')) : null,
                Ss.show.planTop && g0 && g0.kind !== 'U' ? safe('상부 평면', () => planRebarView(p, c, bi, 'top', Ss)) : null,
                Ss.show.planMid && g0 && g0.kind === 'DOUBLE' ? safe('중간 평면', () => planRebarView(p, c, bi, 'mid', Ss)) : null,
                Ss.show.planBottom ? safe('하부 평면', () => planRebarView(p, c, bi, 'bottom', Ss)) : null,
            ]);
            if (SCR.plan && (Ss.show.planTop || Ss.show.planBottom || Ss.show.planSection)) str.push(mkItem('구조도', T(), planViews));
            // (3) 수평 / 전단
            if (Ss.show.horz || Ss.show.shear) str.push(mkItem('구조도', T(), (m) => composeSheet(p, c, S, m, [
                Ss.show.horz ? safe('수평철근', () => horzView(p, c, bi, Ss)) : null,
                Ss.show.shear ? safe('전단철근', () => shearView(p, c, bi, Ss)) : null,
            ])));
            // (4~) 철근상세 + 재료표
            if (Ss.show.shapes || Ss.show.table) {
                const rows = rowsOf(bi).filter(r => BODY_CATS.includes(r.cat));
                for (const ch of detailChunks(rows, Ss.rowsPerTable)) str.push(mkItem('구조도', T(), (m) => detailPage(p, c, S, m, ch, rows, { ...Ss.show, unitM: Ss.unitM })));
            }
            // 기둥부 구조도
            const cws = safe('기둥', () => columnWalls(c, bi)) || [];
            if (cws.length) {
                const rows = rowsOf(bi).filter(r => r.cat === '보,기둥철근');
                let kc = 1;
                str.push(mkItem('구조도', `${lbl}기둥부 구조도 (${kc++})`, (m) => composeSheet(p, c, S, m, columnRebarViews(p, c, bi, Ss))));
                for (const ch of detailChunks(rows, Ss.rowsPerTable)) str.push(mkItem('구조도', `${lbl}기둥부 구조도 (${kc++})`, (m) => detailPage(p, c, S, m, ch, rows, { ...Ss.show, unitM: Ss.unitM })));
            }
        }

        // ── 기타구조도: 날개벽 ──
        const Sw = S.wing;
        for (const w of installedWings(c)) {
            const nmW = `${WING_NAMES[w.key]}-${w.type}`;
            const rows = wingScheduleRows(p, c, w.key, rowsOf(wingBlock(c, w.key)));
            const s = Sw.scales.base;
            const sorted = Sw.tableMode === 'split' ? [...rows.filter(r => r.main), ...rows.filter(r => !r.main)] : rows;
            if (w.type === '일체식') {
                const chunks = detailChunks(sorted, Sw.rowsPerTable);
                etc.push(mkItem('기타구조도', nmW, (m) => composeSheet(p, c, S, m, [
                    Sw.show.back ? safe('배면', () => integralFaceView(p, c, w.key, 'back', s)) : null,
                    Sw.show.front ? safe('전면', () => integralFaceView(p, c, w.key, 'front', s)) : null,
                    Sw.show.secA ? safe('단면 A-A', () => integralSecAView(c, w.key, s)) : null,
                    Sw.show.secB ? safe('단면 B-B', () => integralSecBView(p, c, w.key, s)) : null,
                    Sw.show.shapes ? safe('철근상세', () => shapesBlock(chunks[0] ? chunks[0].rows : [], 3)) : null,
                    Sw.show.table ? safe('재료표', () => tableBlock(chunks[0] ? chunks[0].rows : [], G, { title: '철 근 재 료 표', summary: chunks.length <= 1 ? sorted : null })) : null,
                ])));
                chunks.slice(1).forEach((ch, j) => etc.push(mkItem('기타구조도', `${nmW}(${j + 2})`, (m) => detailPage(p, c, S, m, ch, sorted, { shapes: Sw.show.shapes, table: Sw.show.table }))));
            } else {
                let k = 1;
                etc.push(mkItem('기타구조도', `${nmW}(${k++})`, (m) => composeSheet(p, c, S, m, [
                    Sw.show.wBack ? safe('벽체배면', () => wallFaceView(c, w.key, 'back', s)) : null,
                    Sw.show.wFront ? safe('벽체전면', () => wallFaceView(c, w.key, 'front', s)) : null,
                    Sw.show.wStart ? safe('시점단면', () => wallSectionRebarView(c, w.key, 0, s)) : null,
                    Sw.show.wEnd ? safe('종점단면', () => wallSectionRebarView(c, w.key, 1, s)) : null,
                    Sw.show.fTop ? safe('저판상면', () => footingPlanView(c, w.key, 'top', s)) : null,
                    Sw.show.fBottom ? safe('저판하면', () => footingPlanView(c, w.key, 'bottom', s)) : null,
                ])));
                if (Sw.show.wShapes || Sw.show.wTable) for (const ch of detailChunks(sorted, Sw.rowsPerTable)) etc.push(mkItem('기타구조도', `${nmW}(${k++})`, (m) => detailPage(p, c, S, m, ch, sorted, { shapes: Sw.show.wShapes, table: Sw.show.wTable })));
            }
        }
        // ── 기타구조도: 접속슬래브 ──
        const Sa = S.approach;
        if (hasApproach(c)) {
            const nbk = blocks(c).length;
            getApproach(c).list.forEach((a, i) => {
                const bi = Math.max(0, Math.min(nbk - 1, ((a.s && a.s.ref) | 0) - 1));
                const rows = rowsOf(bi).filter(r => r.cat === '접속슬래브' && String(r.desc || '').startsWith(`접속슬래브${i + 1}(`));
                const s = Sa.scales.base;
                const chunks = detailChunks(rows, Sa.rowsPerTable);
                etc.push(mkItem('기타구조도', `접속슬래브 배근도(${i + 1})`, (m) => composeSheet(p, c, S, m, [
                    Sa.show.plan ? safe('평면', () => approachPlanRebarView(p, c, i, s)) : null,
                    Sa.show.secB ? safe('단면 B-B', () => approachSecRebarView(p, c, i, s)) : null,
                    Sa.show.bracket ? safe('브래킷', () => approachBracketView(c, a, Sa.scales.bracket || 30, Sa.show.dowel)) : null,
                    Sa.show.shapes ? safe('철근상세', () => shapesBlock(chunks[0] ? chunks[0].rows : [], 3)) : null,
                    Sa.show.table ? safe('재료표', () => tableBlock(chunks[0] ? chunks[0].rows : [], G, { title: '철 근 재 료 표', summary: rows })) : null,
                ])));
            });
        }

        if (gen.length) groups.push({ ci, culvert: nm, category: '일반도', items: gen });
        if (str.length) groups.push({ ci, culvert: nm, category: '구조도', items: str });
        if (etc.length) groups.push({ ci, culvert: nm, category: '기타구조도', items: etc });
    });
    return groups;
}

/** 그룹 트리 → 평탄 목록 */
export function flatSheets(groups) {
    return groups.flatMap(g => g.items);
}

/**
 * 여러 시트를 한 Drawing 으로 (가로로 나란히). opts.trueScale: 시트별 대표 축척을 곱해 실척(모형 공간) 으로.
 */
export function combineSheets(drawings, opts = {}) {
    const out = new Drawing({ textHeight: PAPER_TH });
    let x = 0;
    for (const d of drawings) {
        const k = opts.trueScale ? (d.sheetScale || 1) : 1;
        const w = (d.sheetSize ? d.sheetSize.w : 841) * k;
        out.merge(d, x, 0, k);
        x += w + 50 * k;
    }
    return out;
}

/** 시트 하나를 실척으로 (도각크기 동일적용이 꺼져 있을 때 DXF 용) */
export function scaledSheet(d, trueScale) {
    if (!trueScale || !(d.sheetScale > 1)) return d;
    const out = new Drawing({ textHeight: PAPER_TH * d.sheetScale });
    out.merge(d, 0, 0, d.sheetScale);
    out.sheetScale = d.sheetScale; out.sheetSize = d.sheetSize; out.title = d.title;
    return out;
}

