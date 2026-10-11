// parapetGeom.js - 난간벽 / 차수벽 / 유출입부 접속판 / 잡석채움 (상세입력 > 난간벽 및 차수벽)
//
// c.parapet = {
//   view: '측면' | '평면' | '모두표현',
//   ends: [시점, 종점] 각각 {
//     cut:    { use, H, CT1, CT2 },                 차수벽 (높이, 하단두께, 상단 추가두께)
//     apron:  { use, T, S, L1, L2, A1, A2 },        유출입부 접속판 (두께, 종단경사 %, 좌/우 길이, 좌/우 각도)
//     rubble: { use, T },                           잡석채움 (접속판 하부 두께)
//     rail:   { use, Wh, Wt1, Wt2 },                난간벽 (높이, 상단/하단 두께)
//   } }
//
// 측면 국부좌표 (mm): x = 단부면에서 암거 안쪽 방향 +, y = 기초(하부슬래브) 하면 0.

const n0 = (v) => (isFinite(+v) ? +v : 0);

export function defaultParapetEnd(end = 0) {
    return {
        cut: { use: true, H: 600, CT1: 300, CT2: 0 },
        apron: end === 0
            ? { use: true, T: 200, S: -4, L1: 5000, L2: 10000, A1: 130, A2: 130 }
            : { use: false, T: 200, S: -4, L1: 7000, L2: 7000, A1: 135, A2: 135 },
        rubble: { use: true, T: 300 },
        rail: { use: true, Wh: 600, Wt1: 300, Wt2: 300 },
    };
}

export function defaultParapet() {
    return { view: '측면', ends: [defaultParapetEnd(0), defaultParapetEnd(1)] };
}

export function getParapet(c) {
    return c.parapet && c.parapet.ends ? c.parapet : defaultParapet();
}

/** 난간벽/차수벽을 둘 수 있는 단면인가 (Box 계열) */
export function parapetApplicable(c) {
    return c.type !== 'U형';
}

/**
 * 측면 형상 (국부좌표). g = sectionGeom 결과.
 * 반환: { rail, cut, apron, apronTop(x), rubble, L } (없으면 null)
 */
export function parapetSide(e, g) {
    const out = { rail: null, cut: null, apron: null, rubble: null };
    if (e.rail && e.rail.use) {
        const Wh = n0(e.rail.Wh), t1 = n0(e.rail.Wt1), t2 = n0(e.rail.Wt2) || t1;
        out.rail = [[0, g.Htot], [t2, g.Htot], [t1, g.Htot + Wh], [0, g.Htot + Wh]];
    }
    if (e.cut && e.cut.use) {
        const H = n0(e.cut.H), c1 = n0(e.cut.CT1), c2 = n0(e.cut.CT2);
        out.cut = [[0, 0], [0, -H], [c1, -H], [c1 + c2, 0]];
    }
    if (e.apron && e.apron.use) {
        const T = n0(e.apron.T), S = n0(e.apron.S) / 100;
        const L = Math.max(n0(e.apron.L1), n0(e.apron.L2));
        const y0 = g.LT;
        out.apronL = L;
        out.apron = [[0, y0], [-L, y0 + S * L], [-L, y0 + S * L - T], [0, y0 - T]];
        if (e.rubble && e.rubble.use && n0(e.rubble.T) > 0) {
            const R = n0(e.rubble.T);
            out.rubble = [[0, y0 - T], [-L, y0 + S * L - T], [-L, y0 + S * L - T - R], [0, y0 - T - R]];
        }
    }
    return out;
}
