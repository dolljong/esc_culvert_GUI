// 상세입력 > 날개벽 위치 (매뉴얼 3.2)
// 시점/종점 × 좌측/우측 날개벽의 설치형식, 길이, 각도, 전면위치

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, lbl, dash } from '../ui/cells.js';
import { h, alertBox } from '../ui/dom.js';
import { Drawing } from '../cad/drawing.js';
import { drawCulvertPlan, drawCenterLine } from '../draw/planDraw.js';
import { drawWingsPlan } from '../draw/wingDraw.js';
import { sectionGeom } from '../calc/sectionGeom.js';
import {
    WING_KEYS, WING_LABELS, WING_TYPES, FRONT_POS, defaultWingPosFor, wallThick, frontDist,
} from '../calc/wingGeom.js';

/** wings 데이터가 없으면 기본값 생성 (실행취소 기록 없이) */
export function ensureWings(ctx) {
    const c = ctx.c;
    if (!c.wings || !c.wings.pos) {
        store.set(`${ctx.cp}.wings`, { ...(c.wings || {}), pos: defaultWingPosFor(c), dim: (c.wings && c.wings.dim) || {} }, { record: false, silent: true });
    }
    return store.get(`${ctx.cp}.wings`);
}

const HINT = {
    type: '날개벽의 설치여부와 형식을 선택합니다. (설치안함 / 일체식 / 옹벽식)',
    len: '평면상 날개벽의 길이를 입력합니다. (mm)',
    angle: '평면상 구조물 벽체에서 외측방향으로 날개벽까지의 각도를 입력합니다. (°)',
    front: '날개벽 시작위치의 기준을 선택합니다. (벽체내측 / 벽체외측 / 기준거리)',
    dist: '벽체 내측면에서 날개벽 시작위치까지의 거리를 입력합니다. (벽체 두께보다 작아야 합니다)',
};

export default {
    scope: 'culvert',
    hint: '날개벽의 설치여부 및 평면상의 위치를 설정합니다.',

    render(el, ctx) {
        const w = ensureWings(ctx);
        const cp = `${ctx.cp}.wings.pos`;
        const rows = WING_KEYS.map((k, i) => {
            const p = w.pos[k] || {};
            const off = !p.type || p.type === '설치안함';
            const t = wallThick(ctx.c, k);
            const head = i % 2 === 0 ? [{ t: WING_LABELS[k][0], rs: 2 }, { t: WING_LABELS[k][1] }] : [{ t: WING_LABELS[k][1] }];
            const cells = [sel(`${cp}.${k}.type`, WING_TYPES, { hint: HINT.type })];
            if (off) cells.push(dash(), dash(), dash(), dash());
            else {
                cells.push(
                    num(`${cp}.${k}.len`, { dec: 0, field: `${k}.len`, hint: HINT.len, validate: v => (v > 0 ? null : '길이는 0보다 커야 합니다.') }),
                    num(`${cp}.${k}.angle`, { dec: 0, field: `${k}.angle`, hint: HINT.angle, validate: v => (v > 0 && v < 270 ? null : '각도는 0 ~ 270° 사이로 입력합니다.') }),
                    sel(`${cp}.${k}.front`, FRONT_POS, { hint: HINT.front }),
                    p.front === '기준거리'
                        ? num(`${cp}.${k}.dist`, {
                            dec: 2, hint: HINT.dist,
                            validate: v => {
                                if (v < 0 || v >= t) {
                                    const msg = `거리는 벽체 두께(${t} mm)보다 작아야 합니다.`;
                                    alertBox(msg, '날개벽 위치');
                                    return msg;
                                }
                                return null;
                            },
                        })
                        : lbl(() => frontDist(ctx.c, k, p), { dec: 2, cls: 'ro', disabled: true, hint: HINT.dist }),
                );
            }
            return { head, cells };
        });
        new Grid(el, {
            id: 'wing-pos',
            head: [[{ t: '구분', cs: 2 }, { t: '설치' }, { t: '길이(mm)' }, { t: '각도(°)' }, { t: '전면위치' }, { t: '거리(mm)' }]],
            rows,
            colWidths: [50, 50, 90, 90, 80, 90, 90],
        });
        el.appendChild(h('div', { class: 'note' }, '* 각도: 평면상 구조물 벽체(암거 안쪽 방향)에서 날개벽까지 외측으로 잰 각도. 180° = 벽체 연장선.'));
    },

    defaults(ctx) {
        const w = clone(ensureWings(ctx));
        w.pos = defaultWingPosFor(ctx.c);
        store.set(`${ctx.cp}.wings`, w);
    },

    draw(ctx) {
        ensureWings(ctx);
        let W = 10000;
        try { W = sectionGeom(ctx.c, 0).W; } catch { /* */ }
        const d = new Drawing({ textHeight: Math.max(120, Math.min(600, W / 38)) });
        drawCenterLine(d, ctx.p, ctx.c, 8);
        drawCulvertPlan(d, ctx.p, ctx.c, { dims: false });
        drawWingsPlan(d, ctx.p, ctx.c, { dims: true });
        d.legend = '일체식: 하늘색 벽체 / 옹벽식: 노란 단선';
        return d;
    },
    viewKey: (ctx) => `wingPos|${ctx.ci}`,
};
