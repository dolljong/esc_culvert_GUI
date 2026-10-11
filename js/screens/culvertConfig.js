// 기본 설정 > 암거 기본 구성 (매뉴얼 1.4)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, txt, lbl, custom } from '../ui/cells.js';
import { h, button, alertBox, confirmBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { CULVERT_TYPES, defaultCulvert, defaultSectionFor, culvertLength, normalizeProject } from '../core/model.js';
import { drawAlignmentPlan, culvertWidth } from '../draw/planDraw.js';
import { getHorizontal, offsetPoint } from '../calc/alignment.js';
import { jointStations } from '../core/model.js';

let sel = 0;

function setType(i, type) {
    const c = clone(store.project.culverts[i]);
    if (c.type === type) return;
    c.type = type;
    c.section = defaultSectionFor(type === '지하차도' ? 'Box형' : type);
    c.blockSections = [];
    const nb = Math.max(1, c.joints.length - 1);
    c.zones = type === '지하차도' ? Array.from({ length: nb }, (_, k) => (k === 0 || k === nb - 1) && nb > 2 ? 'U-Type' : 'BOX구간') : [];
    store.set(`culverts.${i}`, c);
}

function setLength(i, L) {
    if (!(L > 0)) return;
    const c = clone(store.project.culverts[i]);
    const cur = culvertLength(c);
    if (cur <= 0) return;
    // 블록 길이를 비례 조정
    const k = L / cur;
    c.joints = c.joints.map((j, n) => (n === 0 ? j : { ...j, dist: +(j.dist * k).toFixed(6) }));
    store.set(`culverts.${i}`, c);
}

export default {
    scope: 'project',
    hint: '설계하고자 하는 암거명을 입력합니다.',

    render(el, ctx) {
        const cs = ctx.p.culverts;
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        new Grid(left, {
            id: 'culvertConfig',
            onSelect: (cell, r) => { sel = r; },
            head: [[{ t: '구분' }, { t: '암거명' }, { t: '형식' }, { t: '시점 Station(m)' }, { t: '암거 길이(m)' }]],
            rows: cs.map((c, i) => ({
                head: [{ t: String(i + 1) }],
                cells: [
                    txt(`culverts.${i}.name`, { hint: '설계하고자 하는 암거명을 입력합니다.' }),
                    custom('select', () => c.type, (v) => setType(i, v), { options: CULVERT_TYPES, hint: '구조물 형식을 선택합니다. (BOX형, U형, 복층형, 지하차도)' }),
                    num(`culverts.${i}.startSta`, { dec: 3, hint: '선형상의 구조물 시작위치 Station(m)' }),
                    custom('num', () => +culvertLength(c).toFixed(3), (v) => setLength(i, v), { dec: 3, cls: 'ro', hint: '선형상 구조물 길이(m) — [구간 설정]의 블록 길이 합계' }),
                ],
            })),
            colWidths: [40, 160, 100, 120, 110],
        });
        wrap.appendChild(left);
        wrap.appendChild(h('div', { class: 'dlg-col', style: { gap: '3px' } }, [
            button('암거 내보내기', () => exportCulvert()),
            button('암거 불러오기', () => importCulvert()),
            button('위로 이동', () => move(-1)),
            button('아래로 이동', () => move(1)),
        ]));
        el.appendChild(wrap);
    },

    footer(el) {
        el.appendChild(button('추가', () => {
            const cs = store.project.culverts;
            const last = cs[cs.length - 1];
            const st = last ? jointStations(last) : [0];
            const c = defaultCulvert(`암거${cs.length + 1}`, 'Box형', +(st[st.length - 1] + 10).toFixed(3));
            store.set('culverts', [...clone(cs), c]);
        }));
        el.appendChild(button('삭제', async () => {
            const cs = store.project.culverts;
            if (cs.length <= 1) { alertBox('암거는 최소 1개가 있어야 합니다.'); return; }
            if (!(await confirmBox(`[${cs[sel].name}] 을(를) 삭제하시겠습니까?`))) return;
            const next = clone(cs);
            next.splice(sel, 1);
            store.transact(() => {
                store.set('culverts', next);
                store.set('ui.culvert', Math.min(store.project.ui.culvert, next.length - 1), { record: false });
            });
            sel = Math.max(0, sel - 1);
        }));
    },

    defaults() {
        store.set('culverts', [defaultCulvert()]);
        store.set('ui.culvert', 0, { record: false });
    },

    draw(ctx) {
        const al = ctx.p.alignment;
        const hz = getHorizontal(al);
        const d = new Drawing({ textHeight: Math.max(50, hz.length) * 1000 / 70 });
        drawAlignmentPlan(d, al);
        ctx.p.culverts.forEach((c) => {
            const st = jointStations(c);
            const s0 = st[0], s1 = st[st.length - 1];
            const half = culvertWidth(c) / 2000, off = (+c.offset || 0) / 1000;
            const side = (w) => {
                const pts = [];
                for (let s = s0; s <= s1 + 1e-6; s += Math.max(0.5, (s1 - s0) / 50)) { const q = offsetPoint(hz, s, w); pts.push([q.x * 1000, q.y * 1000]); }
                const q = offsetPoint(hz, s1, w); pts.push([q.x * 1000, q.y * 1000]);
                return pts;
            };
            const L = side(off - half), R = side(off + half).reverse();
            d.pline([...L, ...R], { color: COLOR.YELLOW, closed: true, layer: 'CULVERT' });
            const q = offsetPoint(hz, (s0 + s1) / 2, off - half);
            d.text(q.x * 1000, q.y * 1000 + d.textHeight * 0.5, c.name, { color: COLOR.YELLOW, h: d.textHeight, rot: q.th * 180 / Math.PI, layer: 'CULVERT' });
        });
        return d;
    },
};

function move(dir) {
    const cs = clone(store.project.culverts);
    const j = sel + dir;
    if (j < 0 || j >= cs.length) return;
    [cs[sel], cs[j]] = [cs[j], cs[sel]];
    store.set('culverts', cs);
    sel = j;
}

function exportCulvert() {
    const c = store.project.culverts[sel];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ escCulvert: 1, culvert: c }, null, 1)], { type: 'application/json' }));
    a.download = `${c.name}.acx`;
    a.click();
}

function importCulvert() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.acx,.json';
    inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
            const data = JSON.parse(await f.text());
            const c = data.culvert || data;
            if (!c.joints || !c.section) throw new Error('암거 데이터가 아닙니다.');
            const p = normalizeProject({ ...store.project, culverts: [...store.project.culverts, c] });
            store.set('culverts', p.culverts);
        } catch (e) { alertBox('암거 불러오기 실패: ' + e.message); }
    };
    inp.click();
}
