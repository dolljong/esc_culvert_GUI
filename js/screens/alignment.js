// 기본 설정 > 선형 정보 (매뉴얼 1.3)
// 평면 선형 / 종단 계획고 / 종단 지반고 / 좌측 편경사 / 우측 편경사

import store, { clone } from '../core/store.js';
import { Grid } from '../ui/grid.js';
import { num, txt, lbl, dash } from '../ui/cells.js';
import { h, button, box, bNumber, bText, modal, alertBox } from '../ui/dom.js';
import { Drawing, COLOR } from '../cad/drawing.js';
import { defaultAlignment } from '../core/model.js';
import { drawAlignmentPlan } from '../draw/planDraw.js';
import { getHorizontal, horizontalReport, elevationAt, interpTable } from '../calc/alignment.js';

const TABS = [
    { id: 'plan', title: '평면 선형' },
    { id: 'vip', title: '종단 계획고' },
    { id: 'ground', title: '종단 지반고' },
    { id: 'superL', title: '좌측 편경사' },
    { id: 'superR', title: '우측 편경사' },
];

let selRow = { plan: 1, vip: 0, ground: 0, superL: 0, superR: 0 };

function rowsOf(tab) {
    const al = store.project.alignment;
    return tab === 'plan' ? al.ip : tab === 'vip' ? al.vip : tab === 'ground' ? al.groundLine : al[tab];
}
function pathOf(tab) {
    return tab === 'plan' ? 'alignment.ip' : tab === 'vip' ? 'alignment.vip' : tab === 'ground' ? 'alignment.groundLine' : `alignment.${tab}`;
}

export default {
    scope: 'project',
    hint: '해당 위치(BP,IP,EP)의 X좌표를 입력합니다. (단위 : m)',
    tabs: () => TABS,

    render(el, ctx, tab) {
        const wrap = h('div', { class: 'dlg-row' });
        const left = h('div');
        wrap.appendChild(left);
        const onSelect = (cell, r) => { selRow[tab] = r; };
        if (tab === 'plan') {
            const ip = store.project.alignment.ip;
            const rows = ip.map((p, i) => {
                const end = i === 0 || i === ip.length - 1;
                const name = i === 0 ? 'BP' : i === ip.length - 1 ? 'EP' : `IP${i}`;
                const base = `alignment.ip.${i}`;
                return {
                    head: [{ t: name }],
                    cells: [
                        num(`${base}.x`, { dec: 6, hint: `해당 위치(${name})의 X좌표를 입력합니다. (단위 : m)` }),
                        num(`${base}.y`, { dec: 6, hint: `해당 위치(${name})의 Y좌표를 입력합니다. (단위 : m)` }),
                        end ? dash() : num(`${base}.R`, { dec: 3, allowEmpty: true, hint: '원곡선 반경 R (m)' }),
                        end ? dash() : num(`${base}.A1`, { dec: 3, allowEmpty: true, hint: '진입 클로소이드 매개변수 A1 (0 = 없음)' }),
                        end ? dash() : num(`${base}.A2`, { dec: 3, allowEmpty: true, hint: '진출 클로소이드 매개변수 A2 (0 = 없음)' }),
                    ],
                };
            });
            new Grid(left, {
                id: 'al-plan', onSelect,
                head: [[{ t: 'IP' }, { t: 'X 좌표 (m)' }, { t: 'Y 좌표 (m)' }, { t: '반경 R (m)' }, { t: '매개변수 A1' }, { t: '매개변수 A2' }]],
                rows, colWidths: [50, 120, 120, 90, 90, 90],
            });
        } else if (tab === 'vip') {
            const v = store.project.alignment.vip;
            new Grid(left, {
                id: 'al-vip', onSelect,
                head: [[{ t: 'NO' }, { t: 'STATION (m)' }, { t: 'ELEVATION (m)' }, { t: '종단곡선 길이 L (m)' }, { t: '경사 (%)' }]],
                rows: v.map((r, i) => ({
                    head: [{ t: i === 0 ? 'BVP' : i === v.length - 1 ? 'EVP' : `VIP${i}` }],
                    cells: [
                        num(`alignment.vip.${i}.sta`, { dec: 3, hint: '종단 변곡점 Station (m)' }),
                        num(`alignment.vip.${i}.el`, { dec: 3, hint: '계획고 (m) — 하부슬래브 상단면 기준' }),
                        i === 0 || i === v.length - 1 ? dash() : num(`alignment.vip.${i}.L`, { dec: 3, hint: '종단곡선 길이 (m)' }),
                        lbl(() => i < v.length - 1 ? +(((v[i + 1].el - v[i].el) / ((v[i + 1].sta - v[i].sta) || 1)) * 100).toFixed(3) : null, { dec: 3 }),
                    ],
                })),
                colWidths: [50, 110, 110, 140, 80],
            });
        } else {
            const key = tab === 'ground' ? 'el' : 'slope';
            const arr = rowsOf(tab);
            const path = pathOf(tab);
            new Grid(left, {
                id: 'al-' + tab, onSelect,
                head: [[{ t: 'NO' }, { t: 'STATION (m)' }, { t: tab === 'ground' ? '지반고 (m)' : '편경사 (%)' }]],
                rows: arr.map((r, i) => ({
                    head: [{ t: String(i + 1) }],
                    cells: [
                        num(`${path}.${i}.sta`, { dec: 3, hint: '측점 Station (m)' }),
                        num(`${path}.${i}.${key}`, { dec: 3, hint: tab === 'ground' ? '지반고 EL (m)' : '편경사 (%) — 진행방향 기준, 하향 -' }),
                    ],
                })),
                colWidths: [50, 120, 120],
            });
        }
        // 우측 패널
        const al = store.project.alignment;
        const hz = getHorizontal(al);
        const right = h('div', { class: 'dlg-col' }, [
            box('선형', [
                h('div', { class: 'opt' }, [bNumber('alignment.startSta', { label: '시작 Station(m)', dec: 3, width: 90 })]),
                h('div', { class: 'opt' }, [bText('alignment.name', { label: '선형 이름', width: 90 })]),
                h('div', { class: 'opt', style: { color: '#345' } }, `선형 연장 : ${hz.length.toFixed(3)} m`),
            ]),
            box(null, [
                h('div', { class: 'dlg-col', style: { gap: '3px' } }, [
                    button('선형 파일 읽기', () => readLin()),
                    button('선형 파일 저장', () => saveLin()),
                    button('DXF 파일 읽기', () => readDxf()),
                    button('편경사 계산서', () => report('super')),
                    button('종단 선형 계산서', () => report('vip')),
                    button('평면 선형 계산서', () => report('plan')),
                ]),
            ]),
        ]);
        wrap.appendChild(right);
        el.appendChild(wrap);
    },

    footer(el, ctx, tab) {
        el.appendChild(button('추가', () => addRow(tab)));
        el.appendChild(button('삭제', () => delRow(tab)));
        const sup = tab === 'superL' || tab === 'superR';
        const other = tab === 'superL' ? '우측' : '좌측';
        el.appendChild(button(`${other}과 동일`, () => copySuper(tab, false), { disabled: !sup }));
        el.appendChild(button(`${other}과 대칭`, () => copySuper(tab, true), { disabled: !sup }));
    },

    defaults(ctx, tab) {
        const d = defaultAlignment();
        if (!tab || tab === 'plan') store.set('alignment', { ...d, startSta: store.project.alignment.startSta });
        else if (tab === 'vip') store.set('alignment.vip', d.vip);
        else if (tab === 'ground') store.set('alignment.groundLine', d.groundLine);
        else store.set(`alignment.${tab}`, d[tab]);
    },

    draw(ctx, tab) {
        const al = ctx.p.alignment;
        const hz = getHorizontal(al);
        const L = Math.max(50, hz.length) * 1000;
        if (tab === 'vip' || tab === 'ground') return drawProfileView(al, tab);
        if (tab === 'superL' || tab === 'superR') return drawSuperView(al);
        const d = new Drawing({ textHeight: L / 70 });
        drawAlignmentPlan(d, al, { ip: true });
        return d;
    },
};

// ── 행 추가/삭제 ──────────────────────────────────────────────────────

function addRow(tab) {
    const path = pathOf(tab);
    const arr = clone(rowsOf(tab));
    if (tab === 'plan') {
        // BP 와 EP 사이에 IP 삽입 (선택행 뒤, 마지막 앞)
        const at = Math.min(Math.max(1, selRow.plan + 1), arr.length - 1);
        const a = arr[at - 1], b = arr[at];
        arr.splice(at, 0, { name: 'IP', x: +((a.x + b.x) / 2).toFixed(6), y: +((a.y + b.y) / 2).toFixed(6), R: 100, A1: 0, A2: 0 });
    } else {
        const at = Math.min(selRow[tab] + 1, arr.length);
        const a = arr[at - 1] || arr[0], b = arr[at] || a;
        const row = { ...a, sta: +(((+a.sta) + (+b.sta)) / 2).toFixed(3) };
        if (tab === 'vip') row.L = 0;
        if (at === arr.length) row.sta = (+a.sta) + 20;
        arr.splice(at, 0, row);
    }
    store.set(path, arr);
}

function delRow(tab) {
    const arr = clone(rowsOf(tab));
    const i = selRow[tab];
    if (tab === 'plan') {
        if (i <= 0 || i >= arr.length - 1) { alertBox('BP, EP 는 삭제할 수 없습니다. 삭제할 IP 행을 선택하세요.'); return; }
    } else if (arr.length <= 1) return;
    arr.splice(i, 1);
    store.set(pathOf(tab), arr);
}

function copySuper(tab, mirror) {
    const src = tab === 'superL' ? 'superR' : 'superL';
    const rows = clone(store.project.alignment[src]).map(r => ({ ...r, slope: mirror ? -r.slope : r.slope }));
    store.set(`alignment.${tab}`, rows);
}

// ── 파일 ──────────────────────────────────────────────────────────────

function pickFile(accept) {
    return new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = accept;
        inp.onchange = async () => resolve(inp.files[0] ? { name: inp.files[0].name, text: await inp.files[0].text() } : null);
        inp.click();
    });
}

/** *.lin : 간단한 텍스트 형식 (섹션 [IP] [VIP] [GROUND] [SUPERL] [SUPERR], 공백 구분) */
async function readLin() {
    const f = await pickFile('.lin,.txt');
    if (!f) return;
    const al = clone(store.project.alignment);
    let sec = null;
    const sections = { IP: [], VIP: [], GROUND: [], SUPERL: [], SUPERR: [] };
    for (const raw of f.text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const m = /^\[(\w+)\]$/.exec(line);
        if (m) { sec = m[1].toUpperCase(); continue; }
        const v = line.split(/[\s,]+/).map(Number);
        if (sec && sections[sec]) sections[sec].push(v);
        else if (/^NAME/i.test(line)) al.name = line.split(/[=\s]+/)[1];
    }
    if (sections.IP.length >= 2) al.ip = sections.IP.map((v, i, a) => ({ name: i === 0 ? 'BP' : i === a.length - 1 ? 'EP' : 'IP', x: v[0], y: v[1], R: v[2] || null, A1: v[3] || null, A2: v[4] || null }));
    if (sections.VIP.length) al.vip = sections.VIP.map(v => ({ sta: v[0], el: v[1], L: v[2] || 0 }));
    if (sections.GROUND.length) al.groundLine = sections.GROUND.map(v => ({ sta: v[0], el: v[1] }));
    if (sections.SUPERL.length) al.superL = sections.SUPERL.map(v => ({ sta: v[0], slope: v[1] }));
    if (sections.SUPERR.length) al.superR = sections.SUPERR.map(v => ({ sta: v[0], slope: v[1] }));
    store.set('alignment', al);
}

function saveLin() {
    const al = store.project.alignment;
    const out = [`# ESC Culvert 선형 파일`, `NAME=${al.name}`, `STARTSTA=${al.startSta}`, '[IP]'];
    al.ip.forEach(r => out.push(`${r.x} ${r.y} ${r.R || 0} ${r.A1 || 0} ${r.A2 || 0}`));
    out.push('[VIP]'); al.vip.forEach(r => out.push(`${r.sta} ${r.el} ${r.L || 0}`));
    out.push('[GROUND]'); al.groundLine.forEach(r => out.push(`${r.sta} ${r.el}`));
    out.push('[SUPERL]'); al.superL.forEach(r => out.push(`${r.sta} ${r.slope}`));
    out.push('[SUPERR]'); al.superR.forEach(r => out.push(`${r.sta} ${r.slope}`));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.join('\r\n')], { type: 'text/plain' }));
    a.download = `${al.name || 'alignment'}.lin`;
    a.click();
}

/** DXF 에서 LINE/POLYLINE 꼭짓점을 IP 로 읽기 (도면 단위 m 가정, mm 이면 1/1000) */
async function readDxf() {
    const f = await pickFile('.dxf');
    if (!f) return;
    const lines = f.text.split(/\r?\n/).map(s => s.trim());
    const pts = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
        const code = lines[i], val = lines[i + 1];
        if (code === '10') {
            const x = parseFloat(val);
            const yIdx = lines.indexOf('20', i + 2);
            if (yIdx > 0 && yIdx - i < 6) pts.push([x, parseFloat(lines[yIdx + 1])]);
        }
    }
    const uniq = [];
    for (const p of pts) if (!uniq.length || Math.hypot(p[0] - uniq[uniq.length - 1][0], p[1] - uniq[uniq.length - 1][1]) > 1e-6) uniq.push(p);
    if (uniq.length < 2) { alertBox('DXF 파일에서 선형 꼭짓점을 찾지 못했습니다.'); return; }
    const big = Math.max(...uniq.map(p => Math.abs(p[0]) + Math.abs(p[1]))) > 1e6;
    const k = big ? 0.001 : 1;
    // DXF x=동(E), y=북(N) → 입력 X=N, Y=E
    const ip = uniq.map((p, i) => ({ name: i === 0 ? 'BP' : i === uniq.length - 1 ? 'EP' : 'IP', x: +(p[1] * k).toFixed(6), y: +(p[0] * k).toFixed(6), R: i === 0 || i === uniq.length - 1 ? null : 100, A1: null, A2: null }));
    store.set('alignment.ip', ip);
}

function report(kind) {
    const al = store.project.alignment;
    let html = '';
    if (kind === 'plan') {
        const r = horizontalReport(al);
        html = `<h2>평면 선형 계산서</h2><p>선형명: ${al.name}, 연장 L = ${r.length.toFixed(3)} m</p>` + table(r.rows);
        const hz = getHorizontal(al);
        const rows = [['STATION', 'X(m)', 'Y(m)', '방향각(°)']];
        for (let s = Math.ceil(hz.startSta / 20) * 20; s <= hz.startSta + hz.length + 1e-6; s += 20) {
            const p = hz.pointAt(s);
            let az = 90 - p.th * 180 / Math.PI; while (az < 0) az += 360;
            rows.push([s.toFixed(3), p.y.toFixed(4), p.x.toFixed(4), az.toFixed(4)]);
        }
        html += '<h3>측점별 좌표 (20m 간격)</h3>' + table(rows);
    } else if (kind === 'vip') {
        const rows = [['STATION', '계획고(m)']];
        const v = al.vip;
        const s0 = Math.min(...v.map(r => +r.sta)), s1 = Math.max(...v.map(r => +r.sta));
        for (let s = Math.ceil(s0 / 20) * 20; s <= s1 + 1e-6; s += 20) rows.push([s.toFixed(3), elevationAt(v, s).toFixed(4)]);
        html = '<h2>종단 선형 계산서</h2>' + table([['VIP', 'STATION', 'EL', 'L'], ...v.map((r, i) => [i, r.sta, r.el, r.L || 0])]) + '<h3>측점별 계획고</h3>' + table(rows);
    } else {
        const rows = [['STATION', '좌측(%)', '우측(%)']];
        const all = [...al.superL, ...al.superR].map(r => +r.sta);
        const s0 = Math.min(...all), s1 = Math.max(...all);
        for (let s = Math.ceil(s0 / 20) * 20; s <= s1 + 1e-6; s += 20) rows.push([s.toFixed(3), interpTable(al.superL, s, 'slope').toFixed(3), interpTable(al.superR, s, 'slope').toFixed(3)]);
        html = '<h2>편경사 계산서</h2>' + table(rows);
    }
    modal({ title: '계산서', width: 760, body: h('div', { class: 'report', html }) });
}

function table(rows) {
    return '<table>' + rows.map((r, i) => '<tr>' + r.map(c => (i === 0 ? `<th>${c}</th>` : `<td class="num">${c}</td>`)).join('') + '</tr>').join('') + '</table>';
}

// ── 종단/편경사 도면 ──────────────────────────────────────────────────

function drawProfileView(al) {
    const v = al.vip.map(r => ({ sta: +r.sta, el: +r.el }));
    const g = al.groundLine.map(r => ({ sta: +r.sta, el: +r.el }));
    const s0 = Math.min(...v.map(r => r.sta), ...g.map(r => r.sta));
    const s1 = Math.max(...v.map(r => r.sta), ...g.map(r => r.sta));
    const L = Math.max(10, s1 - s0);
    const d = new Drawing({ textHeight: L * 1000 / 70 });
    const ex = 10;  // 종단 과장 (세로 10배)
    const X = (s) => (s - s0) * 1000, Y = (e) => e * 1000 * ex;
    const pts = [];
    for (let s = s0; s <= s1 + 1e-6; s += L / 200) pts.push([X(s), Y(elevationAt(al.vip, s))]);
    d.pline(pts, { color: COLOR.RED, layer: 'PROFILE' });
    d.pline(g.sort((a, b) => a.sta - b.sta).map(r => [X(r.sta), Y(r.el)]), { color: COLOR.GREEN, layer: 'GROUND' });
    al.vip.forEach((r, i) => {
        d.circle(X(+r.sta), Y(+r.el), d.textHeight * 0.3, { color: COLOR.YELLOW });
        d.text(X(+r.sta), Y(+r.el) + d.textHeight * 0.8, `${i === 0 ? 'BVP' : i === al.vip.length - 1 ? 'EVP' : 'VIP' + i} EL.${(+r.el).toFixed(3)}`, { color: COLOR.YELLOW, h: d.textHeight * 0.7 });
    });
    d.legend = '종단 (세로 10배 과장)  빨강: 계획고  초록: 지반고';
    return d;
}

function drawSuperView(al) {
    const all = [...al.superL, ...al.superR].map(r => +r.sta);
    const s0 = Math.min(...all), s1 = Math.max(...all);
    const L = Math.max(10, s1 - s0);
    const d = new Drawing({ textHeight: L * 1000 / 70 });
    const X = (s) => (s - s0) * 1000, Y = (pct) => pct * L * 1000 / 30;
    d.line(X(s0), 0, X(s1), 0, { color: COLOR.GRAY });
    d.pline(al.superL.map(r => [X(+r.sta), Y(+r.slope)]), { color: COLOR.CYAN });
    d.pline(al.superR.map(r => [X(+r.sta), Y(+r.slope)]), { color: COLOR.MAGENTA });
    d.legend = '편경사도  하늘: 좌측  자홍: 우측';
    return d;
}
