// 일반 입력 > 구간 설정 (매뉴얼 2.1)
// 신축이음위치 / 구간별설정(지하차도) / Dowel Bar

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, chk, lbl, dash, custom } from '../ui/cells.js';
import { h, button, bNumber, bCheck, bRadio, alertBox } from '../ui/dom.js';
import { REBAR_DIAS, defaultJoints, jointStations, culvertLength, blocks, fmtSta } from '../core/model.js';
import { drawAlignmentPlan, drawCulvertPlan, drawCenterLine, drawProfile, newPlanDrawing } from '../draw/planDraw.js';

let selRow = 1;

/** 블록 수가 바뀌면 블록별 배열(구간타입 등) 길이를 맞춘다 */
export function syncBlockArrays(c) {
    const nb = Math.max(1, c.joints.length - 1);
    if (c.type === '지하차도') {
        const z = (c.zones || []).slice(0, nb);
        while (z.length < nb) z.push('BOX구간');
        c.zones = z;
    }
    if (Array.isArray(c.blockSections)) c.blockSections = c.blockSections.slice(0, nb);
    return c;
}

export default {
    scope: 'culvert',
    hint: '[암거기본구성]에서 입력된 구조물 시종점외에 신축이음위치에 대한 Station 과 제원을 입력합니다.',

    tabs(ctx) {
        const t = [{ id: 'joint', title: '신축이음위치' }];
        if (ctx.c.type === '지하차도') t.push({ id: 'zone', title: '구간별설정' });
        t.push({ id: 'dowel', title: 'Dowel Bar' });
        return t;
    },

    header(el, ctx) {
        el.appendChild(bNumber(`${ctx.cp}.startSta`, { label: '시점 station(m)', dec: 3, width: 80 }));
        el.appendChild(h('label', {}, `암거 총길이 : ${culvertLength(ctx.c).toFixed(3)} m`));
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [bRadio(`${ctx.cp}.planView`, [{ value: 'plan', label: '평면도' }, { value: 'profile', label: '종단면도' }])]));
    },

    render(el, ctx, tab) {
        const c = ctx.c, cp = ctx.cp;
        if (tab === 'joint') {
            const st = jointStations(c);
            const n = c.joints.length;
            new Grid(el, {
                id: 'seg-joint',
                onSelect: (cell, r) => { selRow = r; },
                head: [
                    [{ t: '구분', cs: 4 }, { t: '신축이음', cs: 2 }],
                    [{ t: 'NO.' }, { t: '위치' }, { t: 'Station(m)' }, { t: '거리(m)' }, { t: '폭원' }, { t: '각도' }],
                ],
                rows: c.joints.map((j, i) => {
                    const end = i === 0 || i === n - 1;
                    return {
                        cells: [
                            lbl(i + 1, { align: 'center' }),
                            lbl(i === 0 ? '암거시점' : i === n - 1 ? '암거종점' : '신축이음', { cls: 'ro', hint: i === 0 ? '암거시점' : i === n - 1 ? '암거종점' : '신축이음' }),
                            lbl(() => st[i], { dec: 6, cls: 'ro' }),
                            i === 0 ? lbl(0, { dec: 3, cls: 'ro' }) : num(`${cp}.joints.${i}.dist`, { dec: 3, hint: '블록간의 거리를 입력합니다. (m)', validate: v => (v > 0 ? null : '거리는 0보다 커야 합니다.') }),
                            end ? lbl(0, { cls: 'ro' }) : num(`${cp}.joints.${i}.gap`, { dec: 0, hint: '신축이음 폭원(이격거리, mm)' }),
                            num(`${cp}.joints.${i}.angle`, { dec: 3, hint: '선형진행방향에서 시계반대방향으로의 각도 (90 = 직각)', validate: v => (v > 0 && v < 180 ? null : '각도는 0~180° 사이로 입력합니다.') }),
                        ],
                    };
                }),
                colWidths: [40, 80, 110, 80, 60, 80],
            });
        } else if (tab === 'zone') {
            const bl = blocks(c);
            new Grid(el, {
                id: 'seg-zone',
                head: [[{ t: 'NO' }, { t: '시점(m)' }, { t: '종점(m)' }, { t: '길이(m)' }, { t: '구간타입' }]],
                rows: bl.map((b, i) => ({
                    cells: [
                        lbl(i + 1, { align: 'center' }),
                        lbl(b.sta0, { dec: 3, cls: 'ro' }), lbl(b.sta1, { dec: 3, cls: 'ro' }), lbl(b.length, { dec: 3, cls: 'ro' }),
                        sel(`${cp}.zones.${i}`, ['U-Type', 'BOX구간'], { hint: '각 구간별 타입을 설정합니다. 예) U-Type+BOX구간+U-Type' }),
                    ],
                })),
                colWidths: [40, 90, 90, 90, 100],
            });
        } else {
            const d = `${cp}.dowel`;
            new Grid(el, {
                id: 'seg-dowel',
                head: [[{ t: '설치' }, { t: '직경' }, { t: 'CTC' }, { t: '길이' }, { t: '상부' }, { t: '벽체' }]],
                rows: [{
                    cells: [
                        chk(`${d}.use`, { hint: '신축이음에 다웰바 설치유무 (설치시 기초부만 배치)' }),
                        sel(`${d}.dia`, REBAR_DIAS, { disabled: !c.dowel.use }),
                        num(`${d}.ctc`, { dec: 0, disabled: !c.dowel.use, hint: '설치간격 (mm)' }),
                        num(`${d}.len`, { dec: 0, disabled: !c.dowel.use, hint: '다웰바 길이 (mm)' }),
                        chk(`${d}.top`, { disabled: !c.dowel.use, hint: '상부슬래브에도 설치' }),
                        chk(`${d}.wall`, { disabled: !c.dowel.use, hint: '벽체에도 설치' }),
                    ],
                }],
                colWidths: [50, 80, 70, 70, 50, 50],
            });
        }
    },

    footer(el, ctx) {
        const cp = ctx.cp;
        const cnt = h('select', {});
        for (let i = 1; i <= 20; i++) {
            const o = h('option', { value: i }, `${i}개`);
            if (i === (ctx.c.blockCount || 3)) o.selected = true;
            cnt.appendChild(o);
        }
        cnt.addEventListener('change', () => store.set(`${cp}.blockCount`, +cnt.value));
        el.appendChild(h('label', {}, ['BLOCK 개수 ', cnt]));
        el.appendChild(bNumber(`${cp}.blockLen`, { label: 'BLOCK 길이 (m)', dec: 1, width: 55 }));
        el.appendChild(button('위치추가', () => addJoint(ctx)));
        el.appendChild(button('위치삭제', () => delJoint(ctx)));
        el.appendChild(bCheck(`${cp}.showIP`, ' IP 정보 출력'));
    },

    defaults(ctx) {
        const c = clone(ctx.c);
        const startAngle = c.joints[0] ? c.joints[0].angle : 90;
        c.joints = defaultJoints(c.blockCount || 3, c.blockLen || 10);
        c.joints[0].angle = startAngle || 90;
        if (c.type === '지하차도') {
            const nb = c.joints.length - 1;
            c.zones = Array.from({ length: nb }, (_, k) => (nb > 2 && (k === 0 || k === nb - 1)) ? 'U-Type' : 'BOX구간');
        }
        c.dowel = { use: true, dia: 'D32', ctc: 150, len: 1000, top: true, wall: true };
        store.set(ctx.cp, syncBlockArrays(c));
    },

    draw(ctx) {
        const d = newPlanDrawing(ctx.p, ctx.c);
        if (ctx.c.planView === 'profile') {
            drawProfile(d, ctx.p, ctx.c, {});
            return d;
        }
        drawCenterLine(d, ctx.p, ctx.c);
        drawCulvertPlan(d, ctx.p, ctx.c, { dims: true });
        if (ctx.c.showIP) drawAlignmentPlan(d, ctx.p.alignment, { ip: true, staText: false });
        return d;
    },
    viewKey: (ctx) => `segment|${ctx.ci}|${ctx.c.planView}`,
};

function addJoint(ctx) {
    const c = clone(ctx.c);
    const i = Math.max(1, Math.min(selRow, c.joints.length - 1));
    // 선택한 블록(i-1 ~ i)을 둘로 나눈다
    const j = c.joints[i];
    const half = +(j.dist / 2).toFixed(6);
    c.joints.splice(i, 1, { dist: half, gap: 20, angle: 90 }, { ...j, dist: +(j.dist - half).toFixed(6) });
    if (c.type === '지하차도') c.zones.splice(i - 1, 0, c.zones[i - 1] || 'BOX구간');
    c.blockCount = c.joints.length - 1;
    store.set(ctx.cp, syncBlockArrays(c));
}

function delJoint(ctx) {
    const c = clone(ctx.c);
    const i = selRow;
    if (i <= 0 || i >= c.joints.length - 1) { alertBox('암거 시점/종점은 삭제할 수 없습니다. 삭제할 신축이음 행을 선택하세요.'); return; }
    // 이음 i 를 없애고 다음 블록과 합친다
    c.joints[i + 1].dist = +(c.joints[i + 1].dist + c.joints[i].dist).toFixed(6);
    c.joints.splice(i, 1);
    if (c.type === '지하차도') c.zones.splice(i, 1);
    c.blockCount = c.joints.length - 1;
    store.set(ctx.cp, syncBlockArrays(c));
}

export { fmtSta };
