// combos.js - 하중 조합 (구조 계산 > 하중 조합, 매뉴얼 4.3 / 4.6.2 하중조합 상세)
//
// ── 계약 ──────────────────────────────────────────────────────────────
// combos(p, c, checkIndex = 0) → Combo[]
//   Combo = {
//     name,        'UL01'… (계수), 'UE01'… (계수-최대편심), 'SL01'… (사용), 'EC01'… (지진-붕괴), 'EF01'… (지진-기능)
//     kind,        'factored' | 'factoredEcc' | 'service' | 'eqCollapse' | 'eqFunction'
//     lc,          원본 행 이름 ('LC1' …)
//     gw, plate,   지하수 고려 / 3D Plate 내보내기
//     itemFactors: { D: 1.2, Hv: 1.58, … }   설계항목 계수 (원본 행)
//     factors:     { [loadCaseKey]: f }       하중케이스 계수 (loads.js 의 key) ← 해석기가 사용
//   }
//
// 확장 규칙 (매뉴얼 4.6.2):
//   설계항목 계수는 그 항목에 속한 모든 하중케이스에 적용 (케이스의 item 은 하중정의에서 바꿀 수 있음).
//   지하수 고려 행 → gw:'yes' 케이스 (PAVEW, WATERV, SOILBOW, WATERH, BUOYANCY), 그 외 행 → gw:'no' (PAVE, SOILBO).
//   alt.group 이 같은 케이스는 조합을 나눈다: 온도 (TEMPPLUS+SHRINK) / (SHRINK+TEMPMINUS),
//   지진 양방향 (EQL / EQR). 계수하중(최대편심) 은 편토압 (SOILUL / SOILUR) 과 편재활하중 (LIVEFUL / LIVEFUR) 을
//   SOILBO / LIVEFU 대신 각각 분리 조합 (하중조합 선택사항 '편토압 적용' / '편재 활하중 적용' 이 켜졌을 때).
//   '지하수위 고려' 가 꺼져 있으면 지하수 고려 행은 만들지 않는다. 적용(use=false) 행은 제외하고 번호를 다시 매긴다.
//
// 데이터 c.loadComb (화면 loadComb 소유):
//   { items: [{ code, name, on, user }], opt: { gw, ecc, eccLive },
//     tables: { factored|factoredEcc|service|eqCollapse|eqFunction: [{ name, f: {code: factor}, gw, plate, use }] } }

import { getDesign, seisKinds } from './design.js';
import { caseCatalog } from './loads.js';
import { sectionKind } from '../core/model.js';
import { getChecks } from './loadHelpers.js';

export const BASE_ITEMS = [
    { code: 'D', name: '고정하중' },
    { code: 'Hv', name: '연직하중' },
    { code: 'L', name: '활하중' },
    { code: 'Hh', name: '수평하중' },
    { code: 'T', name: '온도,크리프,부등침하,건조수축' },
    { code: 'F', name: '유체중량 및 압력' },
    { code: 'E', name: '지진하중' },
];

export const COMBO_KINDS = [
    { id: 'factored', title: '계수하중', prefix: 'UL' },
    { id: 'factoredEcc', title: '계수하중(최대편심)', prefix: 'UE' },
    { id: 'service', title: '사용하중', prefix: 'SL' },
    { id: 'eqCollapse', title: '지진하중(붕괴)', prefix: 'EC' },
    { id: 'eqFunction', title: '지진하중(기능)', prefix: 'EF' },
];

// [D, Hv, L, Hh, T, F, E, 지하수]
const R = (name, D, Hv, L, Hh, T, F, E, gw) => {
    const f = {};
    [['D', D], ['Hv', Hv], ['L', L], ['Hh', Hh], ['T', T], ['F', F], ['E', E]].forEach(([k, v]) => { if (v) f[k] = v; });
    return { name, f, gw: !!gw, plate: false, use: true };
};

/** 콘크리트 구조설계기준 권고 조합 (매뉴얼 4.3.2 ~ 4.3.6) */
export function defaultTables() {
    const fac = () => [
        R('LC1', 1.4, 1.4, 0, 0, 0, 0, 0, false),
        R('LC2', 1.2, 1.58, 1.6, 1.6, 1.2, 0, 0, false),
        R('LC3', 1.2, 0, 1.0, 0, 0, 0, 0, false),
        R('LC4', 1.2, 1.58, 1.6, 0.8, 1.2, 0, 0, false),
        R('LC5', 0.9, 1.58, 0, 1.6, 0, 0, 0, false),
        R('LC6', 1.4, 1.4, 0, 0, 0, 1.4, 0, true),
        R('LC7', 1.2, 1.58, 1.6, 1.6, 1.2, 1.2, 0, true),
        R('LC8', 1.2, 1.58, 1.6, 0.8, 1.2, 1.2, 0, true),
        R('LC9', 0.9, 1.58, 0, 1.6, 0, 0, 0, true),
    ];
    return {
        factored: fac(),
        factoredEcc: fac(),
        service: [
            R('LC1', 1.0, 1.0, 0, 0, 0, 0, 0, false),
            R('LC2', 1.0, 0.988, 1.0, 1.0, 1.0, 0, 0, false),
            R('LC3', 1.0, 0, 1.0, 0, 0, 0, 0, false),
            R('LC4', 1.0, 0.988, 1.0, 0.5, 1.0, 0, 0, false),
            R('LC5', 1.0, 0.988, 0, 1.0, 0, 0, 0, false),
            R('LC6', 1.0, 1.0, 0, 0, 0, 1.0, 0, true),
            R('LC7', 1.0, 0.988, 1.0, 1.0, 1.0, 1.0, 0, true),
            R('LC8', 1.0, 0.988, 1.0, 0.5, 1.0, 1.0, 0, true),
            R('LC9', 1.0, 0.988, 0, 1.0, 0, 0, 0, true),
        ],
        eqCollapse: [
            R('LC1', 1.0, 0, 1.0, 0, 0, 0, 1.0, false),
            R('LC2', 1.0, 0.988, 0, 1.0, 0, 0, 1.0, false),
            R('LC3', 1.0, 0.988, 0, 1.0, 0, 0, 1.0, true),
        ],
        eqFunction: [
            R('LC1', 1.2, 0, 1.0, 0, 0, 0, 1.4, false),
            R('LC2', 0.9, 1.58, 0, 1.6, 0, 0, 1.4, false),
            R('LC3', 1.2, 0, 1.0, 0, 0, 0, 1.4, true),
            R('LC4', 0.9, 1.58, 0, 1.6, 0, 0, 1.4, true),
        ],
    };
}

export function defaultLoadComb() {
    return {
        items: BASE_ITEMS.map(it => ({ ...it, on: true, user: false })),
        opt: { gw: true, ecc: true, eccLive: true },
        tables: defaultTables(),
    };
}

/** 저장값 + 기본값 */
export function getLoadComb(c) {
    const lc = c.loadComb;
    const d = defaultLoadComb();
    if (!lc) return d;
    return {
        items: Array.isArray(lc.items) && lc.items.length ? lc.items : d.items,
        opt: { ...d.opt, ...(lc.opt || {}) },
        tables: { ...d.tables, ...(lc.tables || {}) },
    };
}

/** 성능목표/형식에 따라 사용되는 조합 종류 */
export function activeKinds(p, c, bi = 0) {
    const d = getDesign(p);
    const kind = sectionKind(c, bi) === 'U' ? 'U' : 'BOX';
    return ['factored', 'factoredEcc', 'service', ...seisKinds(d, kind)];
}

function cartesian(groups) {
    let out = [[]];
    for (const g of groups) {
        const next = [];
        for (const a of out) for (const opt of g) next.push([...a, opt]);
        out = next;
    }
    return out;
}

/**
 * 하중조합 목록 (해석기 입력). checkIndex 는 하중 케이스 목록을 얻는 데만 쓴다 (케이스 key 는 단면과 무관).
 */
export function combos(p, c, checkIndex = 0) {
    const lc = getLoadComb(c);
    const ch = getChecks(p, c);
    const k = Math.min(checkIndex, ch.rows.length - 1);
    const bi = (ch.rows[k] && ch.rows[k].block) || 0;
    const cat = caseCatalog(p, c, k);
    const itemOn = {};
    for (const it of lc.items) itemOn[it.code] = it.on !== false;
    const out = [];
    for (const kd of activeKinds(p, c, bi)) {
        const kindMeta = COMBO_KINDS.find(x => x.id === kd);
        const rows = lc.tables[kd] || [];
        const seis = kd === 'eqCollapse' || kd === 'eqFunction';
        const ecc = kd === 'factoredEcc';
        let n = 0;
        for (const row of rows) {
            if (row.use === false) continue;
            if (row.gw && !lc.opt.gw) continue;
            // 이 행에 들어가는 케이스
            const sel = cat.filter(cs => {
                const f = +(row.f || {})[cs.item] || 0;
                if (!f || itemOn[cs.item] === false) return false;
                if (cs.item === 'E' && !seis) return false;
                if (cs.gw === 'yes' && !row.gw) return false;
                if (cs.gw === 'no' && row.gw) return false;
                if (cs.ecc) {
                    if (!ecc) return false;
                    if (cs.alt && cs.alt.group === 'soil' && !lc.opt.ecc) return false;
                    if (cs.alt && cs.alt.group === 'live' && !lc.opt.eccLive) return false;
                }
                return true;
            });
            // 최대편심: 편토압/편재활하중이 있으면 양토압/전폭활하중을 대신한다
            let use = sel;
            if (ecc) {
                if (sel.some(cs => cs.ecc && cs.alt && cs.alt.group === 'soil')) use = use.filter(cs => !/^SOILBO/.test(cs.key));
                if (sel.some(cs => cs.ecc && cs.alt && cs.alt.group === 'live')) use = use.filter(cs => cs.key !== 'LIVEFU');
            }
            const fixed = use.filter(cs => !cs.alt);
            const groups = {};
            for (const cs of use.filter(cs => cs.alt)) (groups[cs.alt.group] = groups[cs.alt.group] || []).push(cs);
            const variants = cartesian(Object.values(groups).map(arr => arr.map(x => [x])));
            for (const v of variants) {
                const factors = {};
                for (const cs of [...fixed, ...v.flat()]) factors[cs.key] = +(row.f[cs.item]);
                if (!Object.keys(factors).length) continue;
                n++;
                out.push({
                    name: `${kindMeta.prefix}${String(n).padStart(2, '0')}`,
                    kind: kd, lc: row.name, gw: !!row.gw, plate: !!row.plate,
                    itemFactors: { ...row.f },
                    factors,
                });
            }
        }
    }
    return out;
}

/** 조합 상세표 (하중조합 상세 화면/계산서): { keys, rows: [{name, lc, kind, vals:[]}] } */
export function comboTable(p, c, kind, checkIndex = 0) {
    const list = combos(p, c, checkIndex).filter(x => !kind || x.kind === kind);
    const keys = [];
    for (const cb of list) for (const k of Object.keys(cb.factors)) if (!keys.includes(k)) keys.push(k);
    return { keys, rows: list.map(cb => ({ name: cb.name, lc: cb.lc, kind: cb.kind, vals: keys.map(k => cb.factors[k] ?? null) })) };
}
