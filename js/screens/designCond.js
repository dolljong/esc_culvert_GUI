// 구조 계산 > 설계 조건 (매뉴얼 4.1)
// 탭: 설계환경 / 설계조건(암거,날개벽) / 설계선택사항 / 철근비검토 / 상재하중 / 철도하중 / 옹벽식날개벽
// 데이터: project.design (프로젝트 공통) — 계산값은 js/calc/design.js getDesign()

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom, btn } from '../ui/cells.js';
import { h, button, modal } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import {
    getDesign, designRaw, defaultDesign, railTrain, culvertK, K0, KaRankine,
    CODES, KCI, TOOL2D, TOOL3D, EC_FORMULAS, SEIS_METHODS, SEIS_PERF, SEIS_GRADES, SEIS_ZONES, VS_STANDARDS,
    CORROSION, EARTH_P, SITE_CLASSES, LIVE_METHODS, LIVE_KINDS, LIVE_STDS, ROAD_GRADES, RAIL_GRADES, DELTA_OPTIONS,
    GIRDER_METHODS, GIRDER_SHEAR_OPTS,
} from '../calc/design.js';
import { liveSurcharge } from '../calc/loads.js';
import { checkCondition } from '../calc/loadHelpers.js';


const TABS = [
    { id: 'env', title: '설계환경' },
    { id: 'cond', title: '설계조건(암거,날개벽)' },
    { id: 'opt', title: '설계선택사항' },
    { id: 'ratio', title: '철근비검토' },
    { id: 'live', title: '상재하중' },
    { id: 'rail', title: '철도하중' },
    { id: 'wall', title: '옹벽식날개벽' },
];

const TAB_KEYS = {
    env: ['env', 'seisBox', 'seisU'], cond: ['culvert', 'wing'], opt: ['opt'], ratio: ['ratio'],
    live: ['live'], rail: ['rail'], wall: ['wall'],
};

const YN = [{ value: true, label: '적 용' }, { value: false, label: '적용안함' }];
const D = (k) => `design.${k}`;

// ── 공용: 3단 속성 그리드 (구분 | 세부 | 세부 | 설정값 | 단위) ───────────

/**
 * rows: [{ g, a, b?, cell, unit?, hint? }]  — g 그룹(세로 병합), a 항목, b 세부항목 (없으면 a 가 2칸)
 */
export function propTable(el, id, rows, opts = {}) {
    const out = [];
    const runLen = (i, same) => { let n = 1; while (i + n < rows.length && same(rows[i + n])) n++; return n; };
    rows.forEach((r, i) => {
        const prev = rows[i - 1];
        const head = [];
        if (!prev || prev.g !== r.g) head.push({ t: r.g || '', rs: runLen(i, (q) => q.g === r.g), cls: 'grp' });
        if (r.b != null) {
            if (!prev || prev.g !== r.g || prev.a !== r.a || prev.b == null) head.push({ t: r.a, rs: runLen(i, (q) => q.g === r.g && q.a === r.a && q.b != null) });
            head.push({ t: r.b, cls: 'sub' });
        } else head.push({ t: r.a, cs: 2, cls: 'sub' });
        const cell = { ...r.cell };
        if (r.hint && !cell.hint) cell.hint = r.hint;
        out.push({ head, cells: [cell, { type: 'label', value: r.unit || '', cls: 'unitcell' }] });
    });
    return new Grid(el, {
        id, cls: 'ag-prop',
        head: [[{ t: '구분', cs: 3 }, { t: '설정값' }, { t: '단위' }]],
        rows: out,
        colWidths: opts.colWidths || [110, 190, 150, 230, 60],
    });
}

const N = (k, o = {}) => num(D(k), { dec: o.dec, ...o });
const S = (k, options, o = {}) => sel(D(k), options, o);
const B = (k, o = {}) => sel(D(k), YN, o);

/** 렌더 시 누락된 기본값을 채운다 (실행취소 기록 없음) */
function ensure(p) {
    const raw = designRaw(p);
    if (JSON.stringify(raw) !== JSON.stringify(p.design)) store.set('design', raw, { record: false, silent: true });
}

// ── 탭: 설계환경 ─────────────────────────────────────────────────────

function envRows(ctx) {
    const d = getDesign(ctx.p);
    const e = d.env;
    const rows = [
        { g: '기본환경', a: '적용설계기준 (하중조합)', cell: S('env.code', CODES), hint: '하중조합 권고안의 기준. 지진 권고안은 콘크리트설계기준 외에는 지하공동구설계기준으로 통일됩니다.' },
        { g: '기본환경', a: '콘크리트 설계기준', cell: S('env.kci', KCI), hint: '단면검토 및 균열검토에 적용되는 기준' },
        { g: '기본환경', a: '해석Tool(2D)', cell: S('env.tool2d', TOOL2D), hint: 'SAP2000 7.4x 만 자동실행됩니다.' },
        { g: '기본환경', a: '해석Tool(3D)', cell: S('env.tool3d', TOOL3D.map(v => ({ value: v, label: v === '해석안함' ? '3D해석 안함' : v }))), hint: '해석안함이면 3D Plate 해석이 비활성화됩니다.' },
        { g: '재료특성', a: '콘크리트', b: '강도(fck)', cell: N('env.fck'), unit: 'MPa', hint: 'fck 를 바꾸면 탄성계수(Ec)가 자동 계산됩니다.' },
        { g: '재료특성', a: '콘크리트', b: 'Ec 산정식', cell: S('env.ecFormula', EC_FORMULAS), hint: '탄성계수 자동계산식 (기본: 8500·∛(fck+8), wc=2300kg/m³)' },
        { g: '재료특성', a: '콘크리트', b: 'Ec 자동계산', cell: chk(D('env.EcAuto'), { text: '자동' }), hint: '해제하면 탄성계수를 직접 입력합니다.' },
        {
            g: '재료특성', a: '콘크리트', b: '탄성계수(Ec)', unit: 'MPa',
            cell: custom('num', () => getDesign(store.project).env.Ec, (v) => store.transact(() => { store.set(D('env.EcAuto'), false); store.set(D('env.Ec'), v); }), { dec: 0, cls: e.EcAuto ? 'ro' : '' }),
            hint: '값을 입력하면 자동계산이 해제됩니다.',
        },
        { g: '재료특성', a: '철근', b: '항복강도(fy)', cell: N('env.fy'), unit: 'MPa', hint: `fy=300 → D 철근, 400 → H 철근 (현재 ${d.rebarMark})` },
        { g: '재료특성', a: '철근', b: '탄성계수(Es)', cell: N('env.Es'), unit: 'MPa' },
        { g: '재료특성', a: '강재', b: '탄성계수(Es)', cell: N('env.EsSteel'), unit: 'MPa' },
        { g: '재료특성', a: '포아손비', b: '콘크리트', cell: N('env.nuC', { dec: 2 }) },
        { g: '재료특성', a: '포아손비', b: '흙', cell: N('env.nuS', { dec: 2 }) },
        { g: '재료특성', a: '차도부 무근', b: '강도(fck)', cell: N('env.fckRoad'), unit: 'MPa' },
        { g: '재료특성', a: '유출입부 접속저판', b: '강도(fck)', cell: N('env.fckBase'), unit: 'MPa' },
        { g: '재료특성', a: '접속슬래브', b: '강도(fck)', cell: N('env.fckApproach'), unit: 'MPa' },
        { g: '재료특성', a: '접속슬래브', b: '항복강도(fy)', cell: N('env.fyApproach'), unit: 'MPa' },
        { g: '재료특성', a: '버림 콘크리트', b: '강도(fck)', cell: N('env.fckLean'), unit: 'MPa' },
        { g: '재료특성', a: 'Mass 콘크리트', b: '강도(fck)', cell: N('env.fckMass'), unit: 'MPa' },
        { g: '재료특성', a: '기타재료 단위중량', b: '강재, 주강 단강', cell: N('env.gSteel', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '철근 콘크리트', cell: N('env.gRC', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '시멘트 모르터', cell: N('env.gMortar', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '도상(자갈 또는 쇄석)', cell: N('env.gBallast', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '아스팔트 포장', cell: N('env.gAsphalt', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '무근 콘크리트', cell: N('env.gPlain', { dec: 1 }), unit: 'kN/m³' },
        { g: '재료특성', a: '기타재료 단위중량', b: '지하수', cell: N('env.gWater', { dec: 1 }), unit: 'kN/m³' },
        { g: '감소계수', a: '기준값 자동', cell: chk(D('env.phiAuto'), { text: '설계기준 값' }), hint: 'KCI2003: 0.85/0.70/0.80, KCI2007: 0.85/0.65/0.75. KCI2007 은 인장철근 순인장변형률에 따라 변할 수 있습니다.' },
        { g: '감소계수', a: '휨부재', cell: e.phiAuto ? lbl(e.phiF, { dec: 2, cls: 'ro' }) : N('env.phiF', { dec: 2 }) },
        { g: '감소계수', a: '축방향압축부재', cell: e.phiAuto ? lbl(e.phiC, { dec: 2, cls: 'ro' }) : N('env.phiC', { dec: 2 }) },
        { g: '감소계수', a: '전단과 비틀림', cell: e.phiAuto ? lbl(e.phiV, { dec: 2, cls: 'ro' }) : N('env.phiV', { dec: 2 }) },
    ];
    const kind = ctx.c ? ctx.c.type : 'Box형';
    const hasBox = kind !== 'U형';
    const hasU = kind === 'U형' || kind === '지하차도';
    for (const [key, title, en, uType] of [['seisBox', '내진(BOX)', hasBox, false], ['seisU', '내진(U_Type)', hasU, true]]) {
        const s = d[key];
        const off = !en;
        const methods = uType ? SEIS_METHODS.filter(m => m !== '응답변위법') : SEIS_METHODS;
        const rd = s.method === '응답변위법';
        const dis = (cell) => (off ? dash() : cell);
        rows.push(
            { g: title, a: '해석방법', cell: dis(S(`${key}.method`, methods)), hint: uType ? 'U형은 등가정적하중법만 지원합니다.' : 'BOX 는 응답변위법 / 등가정적하중법' },
            { g: title, a: '성능목표', cell: dis(S(`${key}.perf`, SEIS_PERF)), hint: '하중조합의 지진하중(붕괴)/(기능) 탭 생성 여부를 결정합니다.' },
            { g: title, a: '내진등급', cell: dis(S(`${key}.grade`, SEIS_GRADES)) },
            { g: title, a: '지진구역', b: '행정구역 적용', cell: dis(chk(D(`${key}.adminZone`), { text: '구역계수 자동' })) },
            { g: title, a: '지진구역', b: '구역', cell: dis(S(`${key}.zone`, SEIS_ZONES)), hint: 'I 구역 = 0.11, II 구역 = 0.07' },
            { g: title, a: '지진구역', b: '구역계수', cell: dis(s.adminZone ? lbl(s.zoneFactor, { dec: 2, cls: 'ro' }) : N(`${key}.zoneFactor`, { dec: 3 })) },
            { g: title, a: '위험도계수', b: '등급 자동', cell: dis(chk(D(`${key}.riskAuto`), { text: '자동' })), hint: 'II 등급 1.0, I 등급 1.4, 특등급 2.0' },
            { g: title, a: '위험도계수', b: '위험도계수', cell: dis(s.riskAuto ? lbl(s.riskFactor, { dec: 2, cls: 'ro' }) : N(`${key}.riskFactor`, { dec: 2 })) },
            { g: title, a: '가속도계수 A', cell: dis(lbl(s.A, { dec: 3, cls: 'ro' })), hint: 'A = 구역계수 × 위험도계수' },
            { g: title, a: '설계전단파속도 적용기준(응답변위법)', cell: off || !rd || uType ? dash() : S(`${key}.vsStd`, VS_STANDARDS) },
            { g: title, a: '고유주기(Tg)계산시 할증수치', cell: off || !rd || uType ? dash() : N(`${key}.tgFactor`, { dec: 2 }), hint: 'TG = 할증 × TG\'' },
            { g: title, a: '등가정적 설계수평지진계수(kh) 적용률', cell: off || rd ? dash() : N(`${key}.khRate`, { dec: 0 }), unit: '%' },
            { g: title, a: '응답변위법 수평토압 적용', cell: off || !rd || uType ? dash() : B(`${key}.eqSoil`), hint: '적용하면 하중정의 ▸ 토압에 지진시 토압 하중이 생성됩니다.' },
        );
    }
    rows.push({ g: '기타', a: '강재의 부식에 대한 환경조건', cell: S('env.corrosion', CORROSION), hint: 'KCI2003 균열검토의 허용균열폭에 사용' });
    return rows;
}

// ── 탭: 설계조건(암거,날개벽) ───────────────────────────────────────

function condRows(ctx) {
    const d = getDesign(ctx.p);
    const k = culvertK(d);
    const site = SITE_CLASSES.find(s => s.code === d.culvert.site);
    return [
        { g: '암거', a: '성토재', b: '습윤단위중량 γt', cell: N('culvert.gFill', { dec: 1 }), unit: 'kN/m³' },
        { g: '암거', a: '성토재', b: '수중단위중량 γsub', cell: N('culvert.gFillSub', { dec: 1 }), unit: 'kN/m³' },
        { g: '암거', a: '성토재', b: 'N 치', cell: N('culvert.Nfill') },
        { g: '암거', a: '뒷채움재', b: '습윤단위중량 γt', cell: N('culvert.gBack', { dec: 1 }), unit: 'kN/m³' },
        { g: '암거', a: '뒷채움재', b: '수중단위중량 γsub', cell: N('culvert.gBackSub', { dec: 1 }), unit: 'kN/m³' },
        { g: '암거', a: '뒷채움재', b: '내부마찰각 Φ', cell: N('culvert.phiBack', { dec: 1 }), unit: '°' },
        { g: '암거', a: '<기타>', b: '적용토압', cell: S('culvert.earthP', EARTH_P), hint: k.label },
        { g: '암거', a: '<기타>', b: '토압계수 K', cell: d.culvert.earthP === '사용자입력' ? N('culvert.Kuser', { dec: 3 }) : lbl(+k.K.toFixed(3), { dec: 3, cls: 'ro' }), hint: `K0 = ${k.K0.toFixed(3)}, Ka = ${k.Ka.toFixed(3)}` },
        { g: '암거', a: '내진조건', b: '지반종류', cell: btn(`${site ? site.code + ' : ' + site.name : d.culvert.site} ...`, () => sitePopup()), hint: '지반 종류를 선택합니다 (Sa ~ Sf)' },
        { g: '암거', a: '내진조건', b: '계획고에서 기반암까지 깊이', cell: N('culvert.bedrock', { dec: 3 }), unit: 'm', hint: '응답변위법의 기반면 깊이 H' },
        { g: '날개벽', a: '뒷채움재', b: '단위중량', cell: N('wing.gBack', { dec: 1 }), unit: 'kN/m³' },
        { g: '날개벽', a: '뒷채움재', b: '내부마찰각', cell: N('wing.phiBack', { dec: 1 }), unit: '°' },
        { g: '날개벽', a: '배면성토각', cell: N('wing.slope', { dec: 1 }), unit: '°' },
        { g: '날개벽', a: '상재하중', cell: N('wing.surcharge', { dec: 1 }), unit: 'kN/m²' },
        { g: '날개벽', a: '활하중에 의한 토압하중계수', cell: N('wing.liveFactor', { dec: 2 }) },
        { g: '날개벽', a: '토압하중계수', cell: N('wing.epFactor', { dec: 2 }) },
        { g: '날개벽', a: '적용토압', cell: S('wing.earthP', ['정지', '주동']), hint: `K0 = ${K0(d.wing.phiBack).toFixed(3)}, Ka = ${KaRankine(d.wing.phiBack, d.wing.slope).toFixed(3)}` },
        { g: '날개벽', a: '강성영향에 의한 증가계수(α=1.2)', cell: B('wing.alpha12') },
    ];
}

function sitePopup() {
    const cur = getDesign(store.project).culvert.site;
    let pick = cur;
    const tb = h('table', { class: 'ag', style: { borderCollapse: 'collapse' } });
    tb.appendChild(h('thead', {}, [
        h('tr', {}, [h('th', { rowspan: 2 }, '지반분류'), h('th', { rowspan: 2 }, '지반종류의 호칭'), h('th', { colspan: 3 }, '상부 30m에 대한 평균 지반 특성')]),
        h('tr', {}, [h('th', {}, '전단파 속도 (m/s)'), h('th', {}, '표준관입시험 N(Nch) (blow/foot)'), h('th', {}, '비배수전단강도 Su(kPa)')]),
    ]));
    const body = h('tbody');
    const boxes = [];
    for (const s of SITE_CLASSES) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = s.code === cur;
        cb.addEventListener('change', () => { boxes.forEach(b => { b.checked = b === cb; }); pick = s.code; });
        boxes.push(cb);
        const tr = h('tr', {}, [h('td', {}, [h('label', {}, [cb, ' ' + s.code])])]);
        if (s.code === 'Sf') tr.appendChild(h('td', { colspan: 4 }, s.name));
        else tr.append(h('td', {}, s.name), h('td', {}, s.vs), h('td', {}, s.N), h('td', {}, s.su));
        body.appendChild(tr);
    }
    tb.appendChild(body);
    modal({
        title: '지반 종류', body: tb, width: 640,
        buttons: [{ text: '확 인', primary: true, onClick: () => store.set(D('culvert.site'), pick) }, { text: '취 소' }],
    });
}

// ── 탭: 설계선택사항 ────────────────────────────────────────────────

function optRows() {
    const o = (k) => `opt.${k}`;
    return [
        { g: '모델링', a: '사각암거시 경사지간의 고려', cell: S(o('skew'), ['고려안함', '고려(시점기준)', '고려(종점기준)']) },
        { g: '모델링', a: '강역고려', cell: B(o('rigid')) },
        { g: '모델링', a: '헌치고려', cell: B(o('haunch')) },
        { g: '모델링', a: '지하차도시 차도부 모델링 포함여부', cell: B(o('roadModel')) },
        { g: '모델링', a: '차량 진행 방향', cell: S(o('traffic'), ['암거주철근에 직각', '암거주철근에 평행']) },
        { g: '모델링', a: '지반반력계수 Kv', cell: S(o('kvMode'), ['Terzaghi 보정식', 'Terzaghi 보정식 사용자입력', '사용하지않음']) },
        { g: '모델링', a: 'Kv 사용자입력', cell: getDesign(store.project).opt.kvMode === 'Terzaghi 보정식 사용자입력' ? N(o('kvUser')) : dash(), unit: 'kN/m³' },
        { g: '모델링', a: '기초환산폭(Bv)식의 폭(B) 적용방식', cell: S(o('bvDir'), ['횡방향', '종방향']) },
        { g: '모델링', a: '지반 모델링 방식', b: '2D 상시', cell: S(o('soil2dStatic'), ['Spring', 'NLLink']) },
        { g: '모델링', a: '지반 모델링 방식', b: '2D 지진시', cell: S(o('soil2dSeis'), ['Spring', 'NLLink']) },
        { g: '모델링', a: '지반 모델링 방식', b: '3D 상시', cell: S(o('soil3dStatic'), ['Spring', 'NLLink']) },
        { g: '모델링', a: '연직방향 지반 반력계수', cell: S(o('kvSoil'), ['사질토층이 우세한 경우', '사질토와 점성토의 혼합층인 경우', '점성토층이 우세한 경우']), hint: 'Kv = Kv0·(Bv/0.3)^(-1/2 | -3/4 | -1)' },
        { g: '모델링', a: '하부 스프링 기준간격', cell: N(o('springGap')), unit: 'mm' },
        { g: '모델링', a: '내진계산시 벽체스프링 기준간격', cell: N(o('wallSpringGap')), unit: 'mm' },
        { g: '모델링', a: 'NLLINK 외적 불안정시 정정 조건', cell: N(o('nlFix')), unit: 'kN/m' },
        { g: '단면검토시', a: '헌치유효부분 고려', b: '상부', cell: B(o('hEffTop')) },
        { g: '단면검토시', a: '헌치유효부분 고려', b: '하부', cell: B(o('hEffBot')) },
        { g: '단면검토시', a: '수평철근검토시 위험단면 위치', cell: S(o('horzCrit'), ['연단', '연단에서 d 위치', '연단에서 d/2 위치']) },
        { g: '단면검토시', a: '외측 벽체 검토 방법', cell: S(o('outerWall'), ['벽체로 검토', '슬래브로 검토']) },
        { g: '단면검토시', a: '절점부 보강철근 판정시 인장응력 ft', cell: S(o('ft'), ['0.08√fck', '0.13√fck', '0.17√fck']) },
        { g: '단면검토시', a: '하부슬래브 중앙부 부모멘트 검토(부력앵커설치시)', cell: S(o('negMoment'), ['고려안함', '고려']) },
        { g: '단면검토시', a: '외측벽체 철근CTC 적용방법(곡선)', cell: S(o('ctcCurve'), ['CTC적용', '실거리적용']) },
        { g: '단면검토시', a: '접속슬래브 전단검토시 하중산정위치', cell: S(o('approachShear'), ['지점위치', '지점에서 d 위치', '지점에서 1/2d 위치']) },
        { g: '단면검토시', a: '1련암거시 벽체와 일체된 슬래브의 Vc', cell: S(o('vcSingle'), ['1/6√fck', '0.25√fck']) },
        { g: '전단검토시', a: '최소전단철근 고려', b: '벽체', cell: B(o('minShearWall')) },
        { g: '전단검토시', a: '최소전단철근 고려', b: '슬래브', cell: B(o('minShearSlab')) },
        { g: '전단검토시', a: '최소전단철근 고려', b: '접속슬래브', cell: B(o('minShearApp')) },
        { g: '전단검토시', a: '최소전단철근 고려시 간격검토', cell: B(o('minShearGap')) },
        { g: '전단검토시', a: '전단철근 최소간격 고려', b: '벽체', cell: B(o('shearGapWall')) },
        { g: '전단검토시', a: '전단철근 최소간격 고려', b: '슬래브', cell: B(o('shearGapSlab')) },
        { g: '전단검토시', a: '전단철근 최소간격 고려', b: '접속슬래브', cell: B(o('shearGapApp')) },
        { g: '전단검토시', a: '거더검토시 단면력산정', b: '산정방법', cell: S(o('girderMethod'), GIRDER_METHODS) },
        { g: '전단검토시', a: '거더검토시 단면력산정', b: '전단 검토위치', cell: S(o('girderShear'), GIRDER_SHEAR_OPTS) },
        { g: '전단검토시', a: '거더검토시 단면력산정', b: '정모멘트 (wL²/n)', cell: S(o('girderPos'), [8, 10, 11, 12, 14, 16]) },
        { g: '전단검토시', a: '거더검토시 단면력산정', b: '부모멘트 (wL²/n)', cell: S(o('girderNeg'), [8, 9, 10, 11, 12]) },
        { g: '전단검토시', a: '거더검토시 단면력산정', b: '전단력 (n·wL/2)', cell: S(o('girderV'), [1.0, 1.15, 1.2]) },
        { g: '내진해석시', a: '말뚝기초 Mode 선택(NLLink)', cell: S(o('pileMode'), ['COMB', 'HISTORY']) },
        { g: '내진해석시', a: '붕괴방지 해석시 응답수정계수 R(3.0) 적용', cell: B(o('applyR')) },
        { g: '내진해석시', a: '지진하중 재하방향', cell: S(o('eqDir'), ['좌측에서 우측으로 재하', '우측에서 좌측으로 재하', '양쪽에서 재하']) },
        { g: '철도', a: '철도상재하중시 가상토압계수 0.4 적용', cell: B(o('railK04')) },
        { g: '철도', a: '장대레일 종하중 선정시 분포폭 고려', cell: B(o('railLongWidth')) },
        { g: '기타', a: '변형계수(α)', b: '상시', cell: N(o('alphaStatic')) },
        { g: '기타', a: '변형계수(α)', b: '지진시', cell: N(o('alphaSeis')) },
        { g: '기타', a: '노출암거시 유효폭상한', cell: S(o('exposedWidth'), ['2.1m', '1.5m']) },
        { g: '기타', a: 'Mass 기초 부력검토 적용', cell: B(o('massBuoy')) },
        { g: '기타', a: '부력방지앵커 안전율', cell: N(o('anchorFS'), { dec: 2 }) },
        { g: '기타', a: '배력철근 산정시 기준철근', cell: S(o('distBase'), ['사용철근', '필요철근']) },
        { g: '기타', a: '강관말뚝 허용지지력 산정시 말뚝내부흙 포함', cell: B(o('pileSoil')) },
        { g: '기타', a: '점성토의 초기전단파속도 계수', cell: N(o('clayVs')), hint: 'Vs = 계수 × N^(1/3) (토질분류 = 점성토)' },
    ];
}

// ── 탭: 철근비검토 ──────────────────────────────────────────────────

function ratioRows() {
    const r = (k) => `ratio.${k}`;
    return [
        { g: '철근비검토', a: '인장철근에 대한 수축온도 철근비', cell: B(r('shrink')) },
        { g: '수평철근량검토(슬래브)', a: '단면적비 [콘.설 5.7.2]', cell: B(r('slabArea')) },
        { g: '수평철근량검토(슬래브)', a: '주철근비 [도.설 4.7.5.7(2)]', cell: B(r('slabMain')), hint: '주철근 ⟂ 차량: min(120/√L, 67%), ∥: min(55/√L, 50%)' },
        { g: '수평철근량검토(슬래브)', a: '주철근비 [주철근의 20%]', cell: B(r('slabMain20')) },
        { g: '수평철근량검토(슬래브)', a: '노출면 300mm² 이상 [도.설 4.3.9]', cell: B(r('slab300')) },
        { g: '수평철근량검토(벽체)', a: '단면적비', cell: B(r('wallArea')) },
        { g: '수평철근량검토(벽체)', a: '주철근비 [주철근의 20%]', cell: B(r('wallMain20')) },
        { g: '수평철근량검토(벽체)', a: '노출면 300mm² 이상', cell: B(r('wall300')) },
        { g: '수평철근량검토(벽체)', a: '노출면 배치 철근량 검토 [콘.설 11.3(4)]', cell: B(r('wallExposed')) },
        { g: '수평철근량검토(벽체)', a: '0.0015hs [도.설 4.3.9(1)]', cell: B(r('wall0015')) },
        { g: '수평철근량검토(기초)', a: '단면적비', cell: B(r('footArea')) },
        { g: '수평철근량검토(기초)', a: '주철근비 [주철근의 20%]', cell: B(r('footMain20')) },
        { g: '수평철근량검토(기초)', a: '노출면 300mm² 이상', cell: B(r('foot300')) },
        { g: '수평철근량검토(기초)', a: '0.0015hs', cell: B(r('foot0015')) },
        { g: '날개벽(벽체,기초)', a: '단면적비', cell: B(r('wingArea')) },
        { g: '날개벽(벽체,기초)', a: '노출면 300mm² 이상', cell: B(r('wing300')) },
        { g: '날개벽(벽체,기초)', a: '0.0015hs', cell: B(r('wing0015')) },
    ];
}

// ── 탭: 상재하중 ────────────────────────────────────────────────────

function liveRows(ctx) {
    const d = getDesign(ctx.p);
    const lv = d.live;
    const rail = d.isRailCode;
    return [
        { g: '상재하중', a: '활하중 재하방법', cell: S('live.method', rail ? ['상재하중'] : LIVE_METHODS), hint: '이동하중을 선택하면 지반모델링방식이 SPRING 으로 바뀝니다. 철도교 기준은 상재하중만 가능합니다.' },
        { g: '상재하중', a: '하중종류', cell: S('live.kind', LIVE_KINDS) },
        { g: '상재하중', a: '설계기준', cell: S('live.std', LIVE_STDS) },
        { g: '상재하중', a: '하중등급', cell: lv.kind === '철도' ? S('live.railGrade', RAIL_GRADES) : lv.kind === '도로' ? S('live.grade', ROAD_GRADES) : dash() },
        { g: '상재하중', a: '사용자 상재하중', cell: lv.kind === '사용자상재하중' ? N('live.userQ', { dec: 3 }) : dash(), unit: 'kN/m²' },
        { g: '상재하중', a: '연직토압할증계수', cell: N('live.vFactor', { dec: 3 }), hint: '상부 토사 연직하중에 곱하는 할증계수' },
        { g: '상재하중', a: '활하중에 의한 수평토압(10 x Ko)', cell: B('live.hLive') },
        { g: '상재하중', a: '활하중산정시 최소 10kN/m²', cell: B('live.min10') },
    ];
}

// ── 탭: 철도하중 ────────────────────────────────────────────────────

function renderRail(el, ctx) {
    const d = getDesign(ctx.p);
    const en = d.isRailCode;
    const rail = d.rail;
    const n = rail.wheels.length;
    const ensureRail = () => { if (!(ctx.p.design && ctx.p.design.rail)) store.set(D('rail'), clone(rail), { record: false, silent: true }); };
    const wcell = (i, key, o) => en ? custom(o.type || 'num', () => getDesign(store.project).rail.wheels[i][key], (v) => { ensureRail(); store.set(D(`rail.wheels.${i}.${key}`), v); }, o) : lbl(rail.wheels[i][key], { ...o, cls: 'ro' });
    const head = [[{ t: '구분' }, ...rail.wheels.map((_, i) => ({ t: `L${i + 1}` }))]];
    const rows = [
        { head: [{ t: '하중종류' }], cells: rail.wheels.map((_, i) => wcell(i, 'type', { type: 'select', options: ['P', 'Pd'] })) },
        { head: [{ t: '하중크기 (kN)' }], cells: rail.wheels.map((_, i) => wcell(i, 'P', { dec: 3 })) },
        { head: [{ t: '거리 (m)' }], cells: rail.wheels.map((_, i) => wcell(i, 'd', { dec: 3 })) },
    ];
    const wrap = h('div', { class: 'dlg-row', style: { gap: '8px', alignItems: 'flex-start' } });
    const left = h('div', { style: { overflowX: 'auto', maxWidth: '760px' } });
    const right = h('div');
    wrap.append(left, right);
    el.appendChild(wrap);
    new Grid(left, { id: 'dc-rail', head, rows, colWidths: [100, ...Array(n).fill(64)] });
    const side = (k, label) => ({ head: [{ t: label }], cells: [en ? custom('num', () => getDesign(store.project).rail[k], (v) => { ensureRail(); store.set(D(`rail.${k}`), v); }, { dec: 3 }) : lbl(rail[k], { dec: 3, cls: 'ro' })] });
    new Grid(right, {
        id: 'dc-rail-side', head: [[{ t: '구분' }, { t: '값' }]],
        rows: [side('front', '열차앞측 분포하중'), side('rear', '열차뒷측 분포하중'), side('drive', '동륜하중'), side('axle', '축거'), side('axleMid', '축거(중간부분)')],
        colWidths: [130, 80],
    });
    const ops = h('div', { class: 'inline-opts', style: { marginTop: '4px' } }, [
        h('span', {}, en ? `하중등급 ${d.live.railGrade} (상재하중 탭에서 선택)` : '※ 적용설계기준이 철도교설계기준일 때만 입력할 수 있습니다.'),
        button('등급 기본값', () => store.set(D('rail'), railTrain(d.live.railGrade)), { disabled: !en }),
        button('L 추가', () => { ensureRail(); const r = clone(getDesign(store.project).rail); r.wheels.push({ type: 'P', P: 120, d: 1.5 }); store.set(D('rail'), r); }, { disabled: !en }),
        button('L 삭제', () => { const r = clone(getDesign(store.project).rail); if (r.wheels.length > 1) r.wheels.pop(); store.set(D('rail'), r); }, { disabled: !en }),
    ]);
    el.appendChild(ops);
}

function drawRail(ctx) {
    const d = getDesign(ctx.p);
    const r = d.rail;
    const th = 450;
    const dr = new Drawing({ textHeight: th });
    let x = 0;
    const xs = [];
    r.wheels.forEach((w) => { xs.push(x); x += (+w.d || 0) * 1000; });
    const yRail = 0, yTop = 9000;
    const M = COLOR.MAGENTA;
    dr.line(-1500, yRail, x + 6000, yRail, { color: M });
    r.wheels.forEach((w, i) => {
        const rr = w.type === 'Pd' ? 520 : 300;
        dr.line(xs[i], yRail + rr * 2, xs[i], yTop * (w.P / Math.max(...r.wheels.map(q => q.P))) + 1500, { color: M });
        dr.circle(xs[i], yRail + rr, rr, { color: M });
        dr.text(xs[i] - th * 0.3, yRail + rr * 2 + 400, `${(+w.P).toFixed(3)} kN`, { color: COLOR.GREEN, rot: 90, align: 'left', valign: 'bottom', h: th * 0.8 });
    });
    if (r.rear > 0) {
        dr.rect(x, yRail, 6000, 2500, { color: M });
        dr.text(x + 3000, yRail + 2700, `${(+r.rear).toFixed(3)} kN/m`, { color: COLOR.GREEN, h: th * 0.8 });
    }
    for (let i = 0; i < xs.length; i++) {
        const x2 = i < xs.length - 1 ? xs[i + 1] : x;
        dr.dimH(xs[i], x2, yRail, yRail - 1500);
    }
    dr.text(x / 2, yTop + 3000, d.isRailCode ? d.live.railGrade : `${d.live.railGrade} (철도교 기준 아님)`, { color: M, h: th * 2.2 });
    return dr;
}

// ── 탭: 옹벽식날개벽 ────────────────────────────────────────────────

function wallRows(ctx) {
    const d = getDesign(ctx.p);
    const w = d.wall;
    const wa = (k) => `wall.${k}`;
    const rubble = w.foundType === '잡석기초';
    return [
        { g: '재료특성', a: '콘크리트강도 fck', cell: N(wa('fck')), unit: 'MPa' },
        { g: '재료특성', a: '철근항복강도 fy', cell: N(wa('fy')), unit: 'MPa' },
        { g: '뒷채움재', a: '단위중량', cell: N(wa('gBack'), { dec: 1 }), unit: 'kN/m³' },
        { g: '뒷채움재', a: '내부마찰각', cell: N(wa('phiBack'), { dec: 1 }), unit: '°' },
        { g: '뒷채움재', a: '적용토압', cell: S(wa('earthP'), ['정지', '주동']) },
        { g: '토압계수', a: '평상시 (안정/벽체검토)', cell: S(wa('kNormal'), ['Rankine', 'Coulomb', '시행쐐기토압']) },
        { g: '토압계수', a: '지진시', cell: S(wa('kSeis'), ['Mononobe Okabe', '시행쐐기토압']) },
        { g: '토압계수', a: '상재하중 토압 하중계수', cell: S(wa('surFactor'), ['토압계수', '각각하중계수']) },
        { g: '토압계수', a: '벽면마찰각', cell: btn(`안정 ${w.delta.stabN}/${w.delta.stabE}, 벽체 ${w.delta.wallN}/${w.delta.wallE} ...`, () => deltaPopup()) },
        { g: '토압계수', a: '상재하중', cell: N(wa('surcharge'), { dec: 1 }), unit: 'kN/m²' },
        { g: '안전율', a: '전도', b: '평상시', cell: N(wa('fsOverN'), { dec: 2 }) },
        { g: '안전율', a: '전도', b: '지진시', cell: N(wa('fsOverE'), { dec: 2 }) },
        { g: '안전율', a: '활동', b: '평상시', cell: N(wa('fsSlideN'), { dec: 2 }) },
        { g: '안전율', a: '활동', b: '지진시', cell: N(wa('fsSlideE'), { dec: 2 }) },
        { g: '기초지반', a: '단위중량', cell: N(wa('gFound'), { dec: 1 }), unit: 'kN/m³' },
        { g: '기초지반', a: 'N 치', cell: N(wa('Nfound')) },
        { g: '기초지반', a: '점착력', cell: N(wa('cFound'), { dec: 1 }), unit: 'kN/m²' },
        { g: '기초지반', a: '계산된 극한지지력', cell: N(wa('qu'), { dec: 1 }), unit: 'kN/m²', hint: '0 이면 지반자료로 허용지지력 계산, 0 이 아니면 qa = qu/3 (평상시), qu/2 (지진시)' },
        { g: '기초지반', a: '최대허용지지력', cell: N(wa('qaMax'), { dec: 1 }), unit: 'kN/m²' },
        { g: '기초지반', a: '허용지지력 산정식', cell: S(wa('qaFormula'), ['Hansen', 'Terzaghi', 'Meyerhof']) },
        { g: '기초지반', a: '내부마찰각', cell: N(wa('phiFound'), { dec: 1 }), unit: '°' },
        { g: '기초지반', a: '근입지반의 단위중량(γ)', cell: N(wa('gEmbed'), { dec: 1 }), unit: 'kN/m³' },
        { g: '기초지반', a: '유효근입깊이', cell: N(wa('Df'), { dec: 3 }), unit: 'm' },
        { g: '기초지반', a: '기초형식', cell: S(wa('foundType'), ['직접기초', '잡석기초']) },
        { g: '기초지반', a: '기초잡석포설두께', cell: rubble ? N(wa('rubbleT')) : dash(), unit: 'mm' },
        { g: '단면검토', a: '뒷굽판 모멘트 > 벽체하부 모멘트', cell: S(wa('heelMoment'), ['각각의 모멘트적용', '벽체하단의 모멘트적용']) },
        { g: '단면검토', a: '전단 위험단면', b: '앞굽판', cell: S(wa('shearToe'), ['저판벽체연단지점', '저판유효깊이(d)의 1/2 떨어진 지점']) },
        { g: '단면검토', a: '전단 위험단면', b: '뒷굽판', cell: S(wa('shearHeel'), ['저판벽체연단지점', '저판유효깊이(d)의 1/2 떨어진 지점']) },
        ...[['toe', '앞굽'], ['heel', '뒷굽'], ['wall', '벽체'], ['key', '활동방지벽']].flatMap(([k, l]) => [
            { g: '전단철근', a: l, b: '최소간격', cell: B(wa(`shear.${k}.gap`)) },
            { g: '전단철근', a: l, b: '최소전단철근', cell: B(wa(`shear.${k}.min`)) },
        ]),
        { g: '철근비', a: '벽체', cell: N(wa('ratioWall'), { dec: 4 }) },
        { g: '철근비', a: '기초', cell: N(wa('ratioFoot'), { dec: 4 }) },
    ];
}

function deltaPopup() {
    const cur = clone(getDesign(store.project).wall.delta);
    const selEl = (k) => {
        const s = h('select');
        DELTA_OPTIONS.forEach(o => { const op = h('option', { value: o }, o); if (o === cur[k]) op.selected = true; s.appendChild(op); });
        s.addEventListener('change', () => { cur[k] = s.value; });
        return s;
    };
    const tb = h('table', { class: 'ag' }, [
        h('thead', {}, [
            h('tr', {}, [h('th', { rowspan: 2 }, '구분'), h('th', { colspan: 2 }, '벽면마찰각(δ)')]),
            h('tr', {}, [h('th', {}, '평상시'), h('th', {}, '지진시')]),
        ]),
        h('tbody', {}, [
            h('tr', {}, [h('th', { class: 'rh' }, '안정검토시'), h('td', {}, [selEl('stabN')]), h('td', {}, [selEl('stabE')])]),
            h('tr', {}, [h('th', { class: 'rh' }, '벽면검토시'), h('td', {}, [selEl('wallN')]), h('td', {}, [selEl('wallE')])]),
        ]),
    ]);
    modal({ title: '벽면마찰각', body: tb, width: 340, buttons: [{ text: '확 인', primary: true, onClick: () => store.set(D('wall.delta'), cur) }, { text: '취 소' }] });
}

// ── 화면 ─────────────────────────────────────────────────────────────

export default {
    scope: 'culvert',
    hint: '구조계산에 필요한 설계조건을 설정합니다. (프로젝트 공통)',
    tabs: (ctx) => TABS.map(t => (t.id === 'rail' ? { ...t, title: t.title } : t)),

    render(el, ctx, tab) {
        ensure(ctx.p);
        if (tab === 'env') propTable(el, 'dc-env', envRows(ctx));
        else if (tab === 'cond') propTable(el, 'dc-cond', condRows(ctx));
        else if (tab === 'opt') propTable(el, 'dc-opt', optRows(ctx));
        else if (tab === 'ratio') propTable(el, 'dc-ratio', ratioRows(ctx));
        else if (tab === 'live') {
            propTable(el, 'dc-live', liveRows(ctx));
            el.appendChild(h('div', { class: 'note' }, '* 활하중 재하방법은 토피를 자동 고려하지 않습니다. 산정된 상재하중은 확인창에 표시됩니다.'));
        } else if (tab === 'rail') renderRail(el, ctx);
        else if (tab === 'wall') propTable(el, 'dc-wall', wallRows(ctx));
    },

    footer(el, ctx) {
        el.appendChild(button('모든 암거 동일 적용', () => ctx.setHint('설계조건은 프로젝트 공통으로 모든 암거에 동일하게 적용됩니다.')));
    },

    defaults(ctx, tab) {
        const def = defaultDesign();
        const cur = designRaw(ctx.p);
        for (const k of TAB_KEYS[tab] || []) cur[k] = clone(def[k]);
        if (tab === 'rail') cur.rail = null;
        store.set('design', cur);
    },

    draw(ctx, tab) {
        if (tab === 'rail') return drawRail(ctx);
        if (tab === 'live') {
            const d = getDesign(ctx.p);
            const dr = new Drawing({ textHeight: 300 });
            let lines = [];
            try {
                const cond = checkCondition(ctx.p, ctx.c, 0);
                const r = liveSurcharge(d, cond.cover);
                lines = [`상재하중 (${d.live.kind}${d.live.kind === '도로' ? ' ' + d.live.grade : d.live.kind === '철도' ? ' ' + d.live.railGrade : ''})`, `${cond.name} 토피 ${cond.cover.toFixed(3)} m`, ...r.lines, `적용 상재하중 q = ${r.q.toFixed(3)} kN/m²`];
            } catch (e) { lines = ['상재하중 계산 불가: ' + e.message]; }
            lines.forEach((t, i) => dr.text(0, -i * 600, t, { color: i === lines.length - 1 ? COLOR.YELLOW : COLOR.GREEN, align: 'left', h: i === 0 ? 400 : 300 }));
            return dr;
        }
        return new Drawing();
    },
    viewKey: (ctx, tab) => `designCond|${tab}`,
};

