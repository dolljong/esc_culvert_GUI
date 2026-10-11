// standardDB.js - 도로암거표준도(2008) 암거 본체 치수 DB (기본 설정 > 암거 표준도)
//
// 매뉴얼 1.2: 통로 1련/2련, 수로 1련/2련/3련 의 본체만 다룬다 (날개벽 제외).
// 표의 각 칸 = 표준도 코드 (내공 B×H, 적용토피 1.0~10.0 m).
// 통로1련 코드 배치는 매뉴얼 화면 그대로이고, 나머지 탭과 부재 두께는
// 표준도의 경향(경간·토피가 클수록 두껍게, 50mm 단위)을 따르는 합리적인 근사 DB 이다.
//
// 치수 단위: B,H m (표) → 부재 mm.

export const COVERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const STD_TABS = [
    { id: 'P1', title: '통로1련', cells: 1, prefix: 'P1' },
    { id: 'P2', title: '통로2련', cells: 2, prefix: 'P2' },
    { id: 'W1', title: '수로1련', cells: 1, prefix: 'W1' },
    { id: 'W2', title: '수로2련', cells: 2, prefix: 'W2' },
    { id: 'W3', title: '수로3련', cells: 3, prefix: 'W3' },
];

// 토피 그룹 패턴: 같은 그룹은 같은 코드. 0 = 적용불가('-')
const PAT_A = [1, 1, 2, 3, 3, 4, 4, 4, 5, 5];
const PAT_B = [1, 1, 2, 3, 3, 4, 4, 5, 5, 5];
const PAT_C = [1, 1, 2, 3, 3, 4, 4, 4, 5, 0];
const PAT_D = [1, 1, 2, 3, 4, 5, 0, 0, 0, 0];
const PAT_E = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];

// 탭별 행: [B, H, pattern]
const ROWS = {
    P1: [[3.0, 2.5, PAT_A], [3.0, 3.0, PAT_A], [3.5, 3.5, PAT_B], [4.0, 4.0, PAT_B], [4.5, 4.5, PAT_B], [5.0, 4.5, PAT_C], [6.0, 4.5, PAT_D]],
    P2: [[3.0, 2.5, PAT_A], [3.0, 3.0, PAT_A], [3.5, 3.5, PAT_B], [4.0, 4.0, PAT_B], [4.5, 4.5, PAT_C], [5.0, 4.5, PAT_D]],
    W1: [[1.0, 1.0, PAT_E], [1.5, 1.5, PAT_E], [2.0, 2.0, PAT_E], [2.5, 2.5, PAT_A], [3.0, 3.0, PAT_A]],
    W2: [[1.5, 1.5, PAT_E], [2.0, 2.0, PAT_E], [2.5, 2.5, PAT_A], [3.0, 3.0, PAT_A]],
    W3: [[2.0, 2.0, PAT_E], [2.5, 2.5, PAT_A], [3.0, 3.0, PAT_B]],
};

const up50 = (v) => Math.ceil(v / 50 - 1e-9) * 50;

/** 부재 두께 산정 (경간 B m, 그룹 내 최대토피 m, 련수) */
function dims(B, H, coverMax, cells) {
    const span = B * 1000;
    const UT = Math.max(cells > 1 ? 300 : 250, up50(span / 12 + coverMax * 25));
    const LT = up50(UT + 50);
    const W = Math.max(250, up50(Math.max(UT - 50 * (cells > 1 ? 1 : 0), H * 1000 / 10)));
    const C = Math.max(250, up50(W - 50));
    const haunch = Math.min(300, Math.max(150, up50(UT * 0.5)));
    return { UT, LT, W, C, haunch };
}

let _db = null;

/** 표 전체: { [tabId]: { rows: [{B,H,codes:[...]}], items: {code: {...}} } } */
export function standardDB() {
    if (_db) return _db;
    const db = {};
    for (const tab of STD_TABS) {
        const rows = [];
        const items = {};
        let no = 0;
        for (const [B, H, pat] of ROWS[tab.id]) {
            const groupCode = {};
            const codes = pat.map((g, k) => {
                if (!g) return null;
                if (!groupCode[g]) {
                    no += 1;
                    groupCode[g] = `${tab.prefix}-${no}`;
                }
                return groupCode[g];
            });
            // 그룹별 최대 토피
            const maxCover = {};
            pat.forEach((g, k) => { if (g) maxCover[g] = Math.max(maxCover[g] || 0, COVERS[k]); });
            for (const [g, code] of Object.entries(groupCode)) {
                const d = dims(B, H, maxCover[g], tab.cells);
                items[code] = {
                    code, tab: tab.id, title: tab.title, cells: tab.cells,
                    B: B * 1000, H: H * 1000, UT: d.UT, LT: d.LT, WL: d.W, WR: d.W, C: d.C, haunch: d.haunch,
                    coverMax: maxCover[g],
                };
            }
            rows.push({ B, H, codes });
        }
        db[tab.id] = { rows, items };
    }
    _db = db;
    return db;
}

export function findStandard(code) {
    if (!code) return null;
    const db = standardDB();
    for (const t of Object.values(db)) if (t.items[code]) return t.items[code];
    return null;
}

/** 표준도 치수 → Box 단면 객체 (기존 단면의 나머지 설정은 유지) */
export function applyStandardToSection(sec, item, resize) {
    const n = item.cells;
    const out = resize ? resize(JSON.parse(JSON.stringify(sec)), n) : JSON.parse(JSON.stringify(sec));
    out.cells = n;
    out.H = item.H;
    out.B = Array.from({ length: n }, () => item.B);
    out.UT = item.UT;
    out.LT = item.LT;
    out.WL = item.WL;
    out.WR = item.WR;
    out.walls = Array.from({ length: n - 1 }, (_, i) => ({ type: '연속벽체', C: item.C, ...((sec.walls || [])[i] ? { type: '연속벽체' } : {}) }));
    const hc = () => ({ use: true, type: '삼각형', S1: 0, S2: item.haunch, S3: 0, W1: 0, W2: item.haunch, W3: 0 });
    out.haunch = Array.from({ length: n }, () => ({ UL: hc(), UR: hc(), LL: hc(), LR: hc() }));
    if (out.antiFloat && out.antiFloat.brH2Auto !== false) out.antiFloat.brH2 = item.LT;
    out.standardCode = item.code;
    return out;
}
