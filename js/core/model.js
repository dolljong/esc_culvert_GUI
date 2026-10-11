// model.js - 프로젝트 데이터 구조와 공용 조회 함수
//
// 단위 규칙: Station / 좌표 / EL 은 m, 부재 치수는 mm (매뉴얼 입력창과 동일).
//
// project = {
//   version, info{...}, standard{...}, alignment{...},
//   culverts: [ culvert, ... ],
//   design{...}, loads{...}, rebar{...}, output{...}   // 구조계산·배근·출력 (각 화면이 채움)
// }
// culvert = { name, type, startSta, joints[], zones[], dowel{}, ground{}, section{}, blockSections[], ... }

import store, { clone } from './store.js';

export const APP_VERSION = '2026.10';
export const FILE_VERSION = 2;

export const CULVERT_TYPES = ['Box형', 'U형', '복층형', '지하차도'];
export const WALL_TYPES = ['연속벽체', '사각기둥', '원형기둥'];
export const HAUNCH_TYPES = ['삼각형', '사각형', '혼합형'];
export const REBAR_DIAS = ['D10', 'D13', 'D16', 'D19', 'D22', 'D25', 'D29', 'D32', 'D35', 'D38', 'D41', 'D51'];

// ── 기본 단면 ─────────────────────────────────────────────────────────

export function defaultHaunch(type = '삼각형', s = 300) {
    return { use: true, type, S1: 200, S2: s, S3: 0, W1: 200, W2: s, W3: 0 };
}

export function defaultBoxSection(cells = 2) {
    const sec = {
        cells,
        H: 4500, H4: 0,
        B: Array.from({ length: cells }, () => 4500),
        UT: 500, LT: 600, WL: 500, WR: 500,
        walls: Array.from({ length: cells - 1 }, () => ({ type: '연속벽체', C: 500 })),
        haunch: Array.from({ length: cells }, () => ({
            UL: defaultHaunch(), UR: defaultHaunch(), LL: defaultHaunch(), LR: defaultHaunch(),
        })),
        haunchAll: true,
        antiFloat: { use: true, brW: 300, brH1: 0, brH2: 600, brH2Auto: true },
        lean: { t: 100, w: 100 },   // 버림콘크리트 (기초형식에서 갱신)
    };
    return sec;
}

export function defaultUSection() {
    return {
        cells: 1,
        H1: 1000, H2: 3000, H3: 500, H4: 0,
        B: [4000], LT: 600, WT: 300, WB: 600,
        cover: { use: true, load: 5.0, Cb: 100, Ch: 100 },
        bracket: { use: true, Bb: 100, Bh: 250 },
        median: { use: false, Gw: 400, Gh: 500 },
        haunch: [{ LL: defaultHaunch(), LR: defaultHaunch() }],
        antiFloat: { use: true, brW: 300, brH1: 0, brH2: 600, brH2Auto: true },
        lean: { t: 100, w: 100 },
        varying: false,     // 시종점변화단면
        lrSeparate: false,  // 좌우측 벽체 제원입력
        end: null,          // 종점 단면 (varying 일 때)
    };
}

export function defaultDoubleSection(cells = 3) {
    const sec = defaultBoxSection(cells);
    Object.assign(sec, {
        H: 9000, UT: 600, B: Array.from({ length: cells }, () => 4000),
        upper: { LT: 800, WL: 600, WR: 600, walls: Array.from({ length: cells - 1 }, () => ({ type: '연속벽체', C: 400 })) },
        lower: { LT: 800, WL: 800, WR: 800, walls: Array.from({ length: cells - 1 }, () => ({ type: '원형기둥', C: 400 })) },
        MH: 4200, MT: 250,
    });
    // 복층: 헌치는 층별 (upper/lower) × 련별
    sec.haunch2 = {
        upper: Array.from({ length: cells }, () => ({ UL: defaultHaunch(), UR: defaultHaunch(), LL: { ...defaultHaunch(), use: false }, LR: { ...defaultHaunch(), use: false } })),
        lower: Array.from({ length: cells }, () => ({ UL: defaultHaunch(), UR: defaultHaunch(), LL: defaultHaunch(), LR: defaultHaunch() })),
    };
    sec.LT = 800;
    sec.WL = 800; sec.WR = 800;
    sec.walls = sec.lower.walls;
    return sec;
}

export function defaultSectionFor(type) {
    if (type === 'U형') return defaultUSection();
    if (type === '복층형') return defaultDoubleSection(3);
    return defaultBoxSection(2);
}

/** 련수 변경 시 배열 길이 맞추기 */
export function resizeSection(sec, cells) {
    cells = Math.max(1, Math.min(10, cells | 0));
    const fit = (arr, n, make) => {
        const a = (arr || []).slice(0, n);
        while (a.length < n) a.push(make(a.length));
        return a;
    };
    sec.cells = cells;
    sec.B = fit(sec.B, cells, () => sec.B && sec.B.length ? sec.B[sec.B.length - 1] : 4500);
    sec.walls = fit(sec.walls, cells - 1, () => ({ type: '연속벽체', C: sec.WL || 500 }));
    if (sec.haunch) sec.haunch = fit(sec.haunch, cells, () => ({ UL: defaultHaunch(), UR: defaultHaunch(), LL: defaultHaunch(), LR: defaultHaunch() }));
    if (sec.upper) sec.upper.walls = fit(sec.upper.walls, cells - 1, () => ({ type: '연속벽체', C: 400 }));
    if (sec.lower) { sec.lower.walls = fit(sec.lower.walls, cells - 1, () => ({ type: '원형기둥', C: 400 })); sec.walls = sec.lower.walls; }
    if (sec.haunch2) {
        sec.haunch2.upper = fit(sec.haunch2.upper, cells, () => ({ UL: defaultHaunch(), UR: defaultHaunch(), LL: { ...defaultHaunch(), use: false }, LR: { ...defaultHaunch(), use: false } }));
        sec.haunch2.lower = fit(sec.haunch2.lower, cells, () => ({ UL: defaultHaunch(), UR: defaultHaunch(), LL: defaultHaunch(), LR: defaultHaunch() }));
    }
    return sec;
}

// ── 암거 ─────────────────────────────────────────────────────────────

export function defaultJoints(blockCount = 3, blockLen = 10) {
    const rows = [{ dist: 0, gap: 0, angle: 90 }];
    for (let i = 0; i < blockCount; i++) rows.push({ dist: blockLen, gap: i < blockCount - 1 ? 20 : 0, angle: 90 });
    return rows;
}

export function defaultCulvert(name = '일반암거', type = 'Box형', startSta = 10) {
    const blockCount = 3, blockLen = 10;
    return {
        name, type, startSta,
        blockCount, blockLen,
        joints: defaultJoints(blockCount, blockLen),
        zones: type === '지하차도' ? ['U-Type', 'BOX구간', 'U-Type'] : [],
        dowel: { use: true, dia: 'D32', ctc: 150, len: 1000, top: true, wall: true },
        showIP: false,
        planView: 'plan',
        offset: 0,                      // 선형과 암거중심의 이격거리 (mm, +우측)
        section: defaultSectionFor(type === '지하차도' ? 'Box형' : type),
        blockSections: [],              // 지하차도: 블록별 단면
    };
}

// ── 프로젝트 ─────────────────────────────────────────────────────────

export function defaultAlignment() {
    return {
        name: '선형1',
        startSta: 0,
        ip: [
            { name: 'BP', x: 0, y: 0, R: null, A1: null, A2: null },
            { name: 'EP', x: 0, y: 200, R: null, A1: null, A2: null },
        ],
        vip: [
            { sta: 0, el: 0, L: 0 },
            { sta: 200, el: 0, L: 0 },
        ],
        groundLine: [
            { sta: 0, el: 7.5 },
            { sta: 200, el: 7.5 },
        ],
        superL: [{ sta: 0, slope: -2.0 }, { sta: 200, slope: -2.0 }],
        superR: [{ sta: 0, slope: -2.0 }, { sta: 200, slope: -2.0 }],
    };
}

export function createProject() {
    return {
        version: FILE_VERSION,
        info: {
            projectName: '테스트 사업',
            client: '한국도로공사',
            contractor: '(주) 한길아이티',
            siteName: '서울',
            designer: '한길아이티',
            dirForward: '서울방향',
            dirBackward: '부산방향',
        },
        standard: { applied: false, autoDB: true, tab: 0, pick: null },
        alignment: defaultAlignment(),
        culverts: [defaultCulvert()],
        ui: { culvert: 0, block: 0 },
    };
}

// ── 조회 함수 ────────────────────────────────────────────────────────

export const P = () => store.project;

export function curCulvertIndex() {
    const p = store.project;
    const n = (p.culverts || []).length;
    let i = p.ui ? p.ui.culvert | 0 : 0;
    if (i >= n) i = n - 1;
    return Math.max(0, i);
}

export function curBlockIndex() {
    const p = store.project;
    const c = p.culverts[curCulvertIndex()];
    const nb = c ? blockCount(c) : 1;
    let b = p.ui ? p.ui.block | 0 : 0;
    if (b >= nb) b = nb - 1;
    return Math.max(0, b);
}

/** 신축이음으로 나뉜 블록 수 */
export function blockCount(c) {
    return Math.max(1, (c.joints || []).length - 1);
}

/** 각 신축이음(행)의 Station (m) */
export function jointStations(c) {
    const out = [];
    let s = c.startSta || 0;
    (c.joints || []).forEach((j, i) => {
        if (i > 0) s += j.dist || 0;
        out.push(s);
    });
    return out;
}

export function culvertLength(c) {
    const st = jointStations(c);
    return st.length ? st[st.length - 1] - st[0] : 0;
}

/** 블록 정보 [{index, sta0, sta1, length, zone}] */
export function blocks(c) {
    const st = jointStations(c);
    const out = [];
    for (let i = 0; i < st.length - 1; i++) {
        out.push({ index: i, sta0: st[i], sta1: st[i + 1], length: st[i + 1] - st[i], zone: (c.zones || [])[i] || null });
    }
    return out;
}

/** 해당 블록의 단면 (지하차도는 블록별, 그 외에는 공통) */
export function sectionOf(c, bi = 0) {
    if (c.type === '지하차도') {
        const s = (c.blockSections || [])[bi];
        if (s) return s;
        const zone = (c.zones || [])[bi] || 'BOX구간';
        return zone === 'U-Type' ? defaultUSection() : c.section;
    }
    return c.section;
}

/** 단면 형식 ('BOX' | 'U' | 'DOUBLE') */
export function sectionKind(c, bi = 0) {
    if (c.type === 'U형') return 'U';
    if (c.type === '복층형') return 'DOUBLE';
    if (c.type === '지하차도') return ((c.zones || [])[bi] || 'BOX구간') === 'U-Type' ? 'U' : 'BOX';
    return 'BOX';
}

export function fmtSta(sta) {
    // STA. 0K+010.0 형식
    const s = Math.round(sta * 10) / 10;
    const k = Math.floor(s / 1000);
    const m = s - k * 1000;
    return `${k}K+${m.toFixed(1).padStart(5, '0')}`;
}

/** 이전 ESC Culvert(단일 단면) JSON → 새 프로젝트 */
export function migrateLegacy(old) {
    const p = createProject();
    if (old.projectInfo) {
        p.info.projectName = old.projectInfo.businessName || p.info.projectName;
        p.info.client = old.projectInfo.client || '';
        p.info.contractor = old.projectInfo.constructor || '';
        p.info.siteName = old.projectInfo.siteName || '';
    }
    const sd = old.sectionData;
    if (sd) {
        const n = sd.culvert_count || (sd.B || []).length || 1;
        const sec = resizeSection(defaultBoxSection(n), n);
        Object.assign(sec, {
            H: sd.H, H4: sd.H4 || 0, B: (sd.B || []).slice(0, n), UT: sd.UT, LT: sd.LT, WL: sd.WL, WR: sd.WR,
        });
        sec.walls = (sd.middle_walls || []).map(w => ({ type: w.type === '기둥' ? '사각기둥' : '연속벽체', C: w.thickness }));
        const h = sd.haunch || {};
        const corner = (c) => (c ? { ...defaultHaunch(), S2: c.width || 0, W2: c.height || 0, use: (c.width || 0) > 0 } : defaultHaunch());
        sec.haunch = sec.haunch.map((_, i) => {
            const lw = i === 0 ? h.leftWall : (h.middleWalls || [])[i - 1];
            const rw = i === n - 1 ? h.rightWall : (h.middleWalls || [])[i];
            return { UL: corner(lw && lw.upper), LL: corner(lw && lw.lower), UR: corner(rw && rw.upper), LR: corner(rw && rw.lower) };
        });
        if (sd.antiFloat) {
            sec.antiFloat = {
                use: !!sd.antiFloat.use, brW: sd.antiFloat.leftExtension || 300, brH1: 0,
                brH2: sd.antiFloat.thickness || sd.LT, brH2Auto: sd.antiFloat.thicknessAuto !== false,
            };
        }
        p.culverts[0].section = sec;
    }
    if (old.materials) p.legacyMaterials = { fck: old.materials.fck, fy: old.materials.fy };
    if (old.groundInfo) p.legacyGround = clone(old.groundInfo);
    return p;
}

/** 저장된 데이터의 누락 항목을 기본값으로 채운다 (버전 호환) */
export function normalizeProject(p) {
    const base = createProject();
    const out = { ...base, ...p };
    out.info = { ...base.info, ...(p.info || {}) };
    out.standard = { ...base.standard, ...(p.standard || {}) };
    out.alignment = { ...base.alignment, ...(p.alignment || {}) };
    out.ui = { ...base.ui, ...(p.ui || {}) };
    out.culverts = (p.culverts && p.culverts.length ? p.culverts : base.culverts).map(c => {
        const d = defaultCulvert(c.name, c.type, c.startSta);
        return { ...d, ...c, section: c.section || d.section };
    });
    out.version = FILE_VERSION;
    return out;
}
