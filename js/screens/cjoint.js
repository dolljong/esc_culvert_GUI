// 상세입력 > 시공 이음 (매뉴얼 3.5)
// 시공이음 위치 (벽체별 개수, H1, H2) / 시공이음 수치 (W1, W2, H)
//
// c.cjoint = { same, walls: [{ n, H1, H2 }] (좌측벽, 벽체1..n, 우측벽), W1, W2, H }
//   H1 = 기초(하부슬래브) 하면에서 첫 번째 시공이음까지, H2 = 첫 번째에서 두 번째 시공이음까지 (mm)

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, sel, custom, dash } from '../ui/cells.js';
import { h, bCheck } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { sectionGeom, haunchSize } from '../calc/sectionGeom.js';
import { sectionDrawing } from '../draw/sectionDraw.js';

const COUNTS = [{ value: 0, label: '없음' }, { value: 1, label: '1 개' }, { value: 2, label: '2 개' }];

/** 벽체 목록 (복층은 1층 기준) */
function wallsOf(c) {
    const g = sectionGeom(c, 0);
    return { g, walls: g.walls.filter(w => w.floor !== 2) };
}

export function defaultCjointWall(c) {
    const g = sectionGeom(c, 0);
    const sec = g.sec || {};
    const hcTop = sec.haunch && sec.haunch[0] ? haunchSize(sec.haunch[0].UL).w : 0;
    const H1 = Math.round(g.LT + 300);
    const top = g.kind === 'U' ? g.Htot : g.Htot - g.UT - Math.max(300, hcTop);
    const H2 = Math.max(0, Math.round(top - H1));
    return { n: 2, H1, H2 };
}

export function defaultCjoint(c) {
    const { walls } = wallsOf(c);
    const w = defaultCjointWall(c);
    return { same: false, walls: walls.map(() => ({ ...w })), W1: 100, W2: 50, H: 100 };
}

export function ensureCjoint(ctx) {
    const c = ctx.c;
    const { walls } = wallsOf(c);
    let cj = c.cjoint;
    if (!cj || !Array.isArray(cj.walls)) {
        cj = { ...defaultCjoint(c), ...(cj || {}) };
        cj.walls = defaultCjoint(c).walls;
        store.set(`${ctx.cp}.cjoint`, cj, { record: false, silent: true });
    } else if (cj.walls.length !== walls.length) {
        // 련수 변경: 좌측벽/우측벽 유지, 중간벽 맞춤
        const d = defaultCjointWall(c);
        const L = cj.walls[0] || d, R = cj.walls[cj.walls.length - 1] || d;
        const mids = cj.walls.slice(1, -1);
        const out = [clone(L)];
        for (let i = 0; i < walls.length - 2; i++) out.push(clone(mids[i] || mids[mids.length - 1] || L));
        out.push(clone(R));
        store.set(`${ctx.cp}.cjoint.walls`, out, { record: false, silent: true });
    }
    return store.get(`${ctx.cp}.cjoint`);
}

const HINT = {
    n: '각 벽체별 시공이음 개수를 설정합니다.',
    H1: '기초 하면에서 첫 번째 시공이음까지의 거리를 입력합니다. (mm)',
    H2: '첫 번째 시공이음에서 두 번째 시공이음까지의 거리를 입력합니다. (mm)',
    W1: '시공이음 상세에서 직선부의 폭', W2: '시공이음 상세에서 경사부의 폭', H: '시공이음 상세의 높이',
};

export default {
    scope: 'culvert',
    hint: '시공이음 위치와 상세 수치를 설정합니다.',

    tabs: () => [{ id: 'pos', title: '시공이음 위치' }, { id: 'dim', title: '시공이음 수치' }],

    header(el, ctx) {
        ensureCjoint(ctx);
        el.appendChild(h('span', { style: { marginLeft: 'auto' } }, [
            bCheck(`${ctx.cp}.cjoint.same`, ' 시공이음 동일 적용', {
                onChange: (v) => store.transact(() => {
                    store.set(`${ctx.cp}.cjoint.same`, v);
                    if (v) copyLeft(ctx);
                }),
                title: '좌측벽의 개수/H1/H2 를 모든 벽체에 적용합니다.',
            }),
        ]));
    },

    render(el, ctx, tab) {
        const cj = ensureCjoint(ctx);
        const cp = `${ctx.cp}.cjoint`;
        if (tab === 'dim') {
            new Grid(el, {
                id: 'cj-dim',
                head: [[{ t: 'W1' }, { t: 'W2' }, { t: 'H' }]],
                rows: [{ cells: [num(`${cp}.W1`, { field: 'W1', hint: HINT.W1 }), num(`${cp}.W2`, { field: 'W2', hint: HINT.W2 }), num(`${cp}.H`, { field: 'H', hint: HINT.H })] }],
                colWidths: [80, 80, 80],
            });
            return;
        }
        const { walls } = wallsOf(ctx.c);
        let mi = 0;
        const names = walls.map(w => (w.kind === 'outer' ? (w.side === 'L' ? '좌측벽' : '우측벽') : `벽체 ${++mi}`));
        const same = !!cj.same;
        // 동일적용: 좌측벽 입력이 전체에 반영된다
        const setter = (k) => (i) => (v) => store.transact(() => {
            if (same) cj.walls.forEach((_, j) => store.set(`${cp}.walls.${j}.${k}`, v));
            else store.set(`${cp}.walls.${i}.${k}`, v);
        });
        const row = (k, label, fieldFn) => ({
            head: [{ t: label }],
            cells: cj.walls.map((w, i) => {
                const ro = same && i > 0;
                if (k === 'n') {
                    return ro ? { ...sel(`${cp}.walls.${i}.n`, COUNTS), ro: true } : custom('select', () => store.get(`${cp}.walls.${i}.n`), setter('n')(i), { options: COUNTS, hint: HINT.n });
                }
                const need = k === 'H1' ? 1 : 2;
                if ((+w.n || 0) < need) return dash();
                if (ro) return num(`${cp}.walls.${i}.${k}`, { disabled: true });
                return custom('num', () => store.get(`${cp}.walls.${i}.${k}`), setter(k)(i), {
                    hint: HINT[k], field: i === 0 ? fieldFn : undefined,
                    validate: v => (v > 0 ? null : '0 보다 큰 값을 입력합니다.'),
                });
            }),
        });
        new Grid(el, {
            id: 'cj-pos',
            head: [[{ t: '구분' }, ...names.map(t => ({ t }))]],
            rows: [row('n', '개수'), row('H1', 'H 1', 'H1'), row('H2', 'H 2', 'H2')],
            colWidths: [60, ...names.map(() => 80)],
        });
        el.appendChild(h('div', { class: 'note' }, '* H1: 기초 하면 ~ 첫 번째 시공이음, H2: 첫 번째 ~ 두 번째 시공이음 (mm)'));
    },

    defaults(ctx, tab) {
        const cur = clone(ensureCjoint(ctx));
        const d = defaultCjoint(ctx.c);
        if (tab === 'dim') { cur.W1 = d.W1; cur.W2 = d.W2; cur.H = d.H; } else { cur.walls = d.walls; cur.same = false; }
        store.set(`${ctx.cp}.cjoint`, cur);
    },

    draw(ctx, tab) {
        const cj = ensureCjoint(ctx);
        if (tab === 'dim') return keywayDrawing(cj);
        const d = sectionDrawing(ctx.p, ctx.c, 0, { names: false });
        drawJoints(d, ctx.c, cj);
        return d;
    },
    viewKey: (ctx, tab) => `cjoint|${ctx.ci}|${tab}`,
};

function copyLeft(ctx) {
    const cp = `${ctx.cp}.cjoint`;
    const ws = store.get(`${cp}.walls`) || [];
    if (!ws.length) return;
    store.set(`${cp}.walls`, ws.map(() => clone(ws[0])));
}

/** 시공이음 위치 표시 (단면도 위) */
export function drawJoints(d, c, cj) {
    const { g, walls } = wallsOf(c);
    const th = d.textHeight;
    let dimDone = false;
    walls.forEach((w, i) => {
        const r = cj.walls[i];
        if (!r || !(+r.n > 0)) return;
        const ys = [+r.H1 || 0];
        if (+r.n > 1) ys.push(ys[0] + (+r.H2 || 0));
        for (const y of ys) {
            d.line(w.x0, y, w.x1, y, { color: COLOR.YELLOW, layer: 'CJOINT', width: 2 });
            // 전단키 표시 (벽체 중앙 작은 홈)
            const xm = (w.x0 + w.x1) / 2, k = Math.min(60, w.t * 0.15);
            d.pline([[xm - k * 1.5, y], [xm - k * 0.7, y - k], [xm + k * 0.7, y - k], [xm + k * 1.5, y]], { color: COLOR.YELLOW, layer: 'CJOINT' });
        }
        if (!dimDone) {
            dimDone = true;
            // 첫 시공이음 벽체 옆 내공 안에 치수
            const cell = g.cells.find(cc => (cc.floor || 1) === 1 && Math.abs(cc.x0 - w.x1) < 1e-6) || g.cells[0];
            const x = (cell ? cell.x0 : w.x1) + th * 2.5;
            const chain = [0, ...ys, g.Htot];
            const names = ['H1', 'H2'];
            for (let k = 0; k < chain.length - 1; k++) d.dimV(chain[k], chain[k + 1], w.x1, x, undefined, { name: names[k] });
        }
    });
}

/** 시공이음 상세 (전단키 단면) */
export function keywayDrawing(cj) {
    const W1 = +cj.W1 || 0, W2 = +cj.W2 || 0, H = +cj.H || 0;
    const tot = W1 + 2 * W2;
    const d = new Drawing({ textHeight: Math.max(8, Math.max(tot, H * 2) / 16) });
    const th = d.textHeight;
    const ext = Math.max(tot * 0.6, 60);
    const x0 = -tot / 2;
    d.pline([[x0 - ext, 0], [x0, 0], [x0 + W2, -H], [x0 + W2 + W1, -H], [x0 + tot, 0], [x0 + tot + ext, 0]], { color: COLOR.CYAN, layer: 'CONC' });
    const s = Math.min(W1, H) * 0.18;
    d.pline([[-s / 2, -H], [s / 2, -H], [s / 2, -H + s], [-s / 2, -H + s]], { color: COLOR.CYAN, layer: 'CONC', closed: true, fill: COLOR.CYAN });
    const yb = -H - th * 2.4;
    d.dimH(x0, x0 + W2, -H, yb, undefined, { name: 'W2' });
    d.dimH(x0 + W2, x0 + W2 + W1, -H, yb, undefined, { name: 'W1' });
    d.dimH(x0 + W2 + W1, x0 + tot, -H, yb, undefined, { name: 'W2' });
    d.dimH(x0, x0 + tot, -H, yb - th * 2.6);
    d.dimV(-H, 0, x0 + tot, x0 + tot + ext * 0.6, undefined, { name: 'H' });
    d.text(0, th * 2.5, '시공이음 상세', { color: COLOR.GREEN, h: th, layer: 'TEXT' });
    return d;
}
