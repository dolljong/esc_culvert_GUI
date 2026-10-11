// alignment.js - 선형 계산 (평면 IP 법 + 클로소이드, 종단 VIP 포물선)
//
// 좌표: 입력의 X 는 북(N), Y 는 동(E) — 국내 측량 좌표 관례.
// 도면 좌표는 (E, N) = (Y, X) 로 그린다. 방향각 th 는 도면 좌표 +x 축에서 반시계(rad).
// Station 은 m. 오프셋은 진행방향 기준 우측 +.

const STEP = 0.5;   // 적분/샘플 간격 (m)

function unit(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L, L];
}

/**
 * 평면선형 구성. al.ip = [{x, y, R, A1, A2}, ...] (첫 행 BP, 끝 행 EP)
 * 반환: { samples:[{s,x,y,th}], length, ipInfo:[...], pointAt(sta), startSta }
 */
export function buildHorizontal(al) {
    const startSta = +al.startSta || 0;
    const pts = (al.ip || []).map(p => ({ E: +p.y || 0, N: +p.x || 0, R: +p.R || 0, A1: +p.A1 || 0, A2: +p.A2 || 0, name: p.name }));
    const samples = [];
    const ipInfo = [];
    if (pts.length < 2) {
        return { samples: [{ s: startSta, x: 0, y: 0, th: 0 }], length: 0, ipInfo, startSta, pointAt: () => ({ x: 0, y: 0, th: 0 }) };
    }

    // 각 IP 의 접선길이 계산
    const geo = pts.map(() => null);
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], c = pts[i + 1];
        const [ux1, uy1] = unit(a.E, a.N, b.E, b.N);
        const [ux2, uy2] = unit(b.E, b.N, c.E, c.N);
        const t1 = Math.atan2(uy1, ux1), t2 = Math.atan2(uy2, ux2);
        let D = t2 - t1;
        while (D > Math.PI) D -= 2 * Math.PI;
        while (D < -Math.PI) D += 2 * Math.PI;
        const R = b.R;
        if (!(R > 0) || Math.abs(D) < 1e-9) { geo[i] = { D, R: 0, T1: 0, T2: 0, L1: 0, L2: 0, Lc: 0, ux1, uy1, ux2, uy2 }; continue; }
        const L1 = b.A1 > 0 ? b.A1 * b.A1 / R : 0;
        const L2 = b.A2 > 0 ? b.A2 * b.A2 / R : 0;
        const p1 = L1 * L1 / (24 * R), p2 = L2 * L2 / (24 * R);
        const xm1 = L1 / 2 - L1 ** 3 / (240 * R * R), xm2 = L2 / 2 - L2 ** 3 / (240 * R * R);
        const aD = Math.abs(D);
        const T1 = xm1 + (R + p1) * Math.tan(aD / 2) + (p2 - p1) / Math.sin(aD);
        const T2 = xm2 + (R + p2) * Math.tan(aD / 2) - (p2 - p1) / Math.sin(aD);
        const thc = aD - L1 / (2 * R) - L2 / (2 * R);
        const Lc = Math.max(0, R * thc);
        geo[i] = { D, R, T1, T2, L1, L2, Lc, ux1, uy1, ux2, uy2 };
    }

    // 주행: 접선 → 클로소이드 → 원곡선 → 클로소이드 → 접선
    let x = pts[0].E, y = pts[0].N;
    let [ux0, uy0] = unit(pts[0].E, pts[0].N, pts[1].E, pts[1].N);
    let th = Math.atan2(uy0, ux0);
    let s = startSta;
    samples.push({ s, x, y, th });

    const advance = (len, k0, k1) => {
        // 곡률 k0 → k1 선형변화 (좌회전 +)
        if (len <= 1e-9) return;
        const n = Math.max(1, Math.ceil(len / STEP));
        const ds = len / n;
        for (let k = 0; k < n; k++) {
            const km = k0 + (k1 - k0) * ((k + 0.5) / n);
            const thm = th + km * ds / 2;
            x += Math.cos(thm) * ds;
            y += Math.sin(thm) * ds;
            th += km * ds;
            s += ds;
            samples.push({ s, x, y, th });
        }
    };

    for (let i = 1; i < pts.length; i++) {
        const b = pts[i];
        const g = geo[i];
        // 현재 위치에서 다음 점(또는 곡선 시점)까지 직선
        const T1 = g ? g.T1 : 0;
        const tx = b.E - (g ? g.ux1 : 0) * T1, ty = b.N - (g ? g.uy1 : 0) * T1;
        const [dx, dy, L] = unit(x, y, tx, ty);
        th = Math.atan2(dy, dx);
        advance(L, 0, 0);
        x = tx; y = ty;   // 누적오차 보정
        if (g && g.R > 0) {
            const sign = Math.sign(g.D);
            const k = sign / g.R;
            const info = { index: i, name: b.name || `IP${i}`, E: b.E, N: b.N, R: g.R, A1: b.A1, A2: b.A2, D: g.D * 180 / Math.PI, T1: g.T1, T2: g.T2 };
            info.TS = s;
            advance(g.L1, 0, k);
            info.SC = s;
            advance(g.Lc, k, k);
            info.CS = s;
            advance(g.L2, k, 0);
            info.ST = s;
            ipInfo.push(info);
            // 곡선 종점을 접선 위 정확한 위치로
            x = b.E + g.ux2 * g.T2; y = b.N + g.uy2 * g.T2;
            th = Math.atan2(g.uy2, g.ux2);
            samples[samples.length - 1] = { s, x, y, th };
        } else if (i < pts.length - 1) {
            ipInfo.push({ index: i, name: b.name || `IP${i}`, E: b.E, N: b.N, R: 0, D: g ? g.D * 180 / Math.PI : 0, TS: s, ST: s });
        }
    }
    const length = s - startSta;

    function pointAt(sta) {
        if (samples.length === 1) return { ...samples[0] };
        if (sta <= samples[0].s) {
            const p = samples[0];
            const d = sta - p.s;
            return { x: p.x + Math.cos(p.th) * d, y: p.y + Math.sin(p.th) * d, th: p.th };
        }
        const last = samples[samples.length - 1];
        if (sta >= last.s) {
            const d = sta - last.s;
            return { x: last.x + Math.cos(last.th) * d, y: last.y + Math.sin(last.th) * d, th: last.th };
        }
        // 이분탐색
        let lo = 0, hi = samples.length - 1;
        while (hi - lo > 1) {
            const m = (lo + hi) >> 1;
            if (samples[m].s <= sta) lo = m; else hi = m;
        }
        const a = samples[lo], b = samples[hi];
        const t = (sta - a.s) / (b.s - a.s || 1);
        let dth = b.th - a.th;
        while (dth > Math.PI) dth -= 2 * Math.PI;
        while (dth < -Math.PI) dth += 2 * Math.PI;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, th: a.th + dth * t };
    }

    return { samples, length, ipInfo, startSta, pointAt };
}

/** 선형상 sta 위치에서 우측으로 off(m) 떨어진 점 */
export function offsetPoint(h, sta, off) {
    const p = h.pointAt(sta);
    return { x: p.x + Math.sin(p.th) * off, y: p.y - Math.cos(p.th) * off, th: p.th };
}

/**
 * 종단 계획고: vip = [{sta, el, L}] (L: 종단곡선 길이 m, 포물선)
 */
export function elevationAt(vip, sta) {
    const v = (vip || []).filter(r => isFinite(+r.sta)).map(r => ({ sta: +r.sta, el: +r.el || 0, L: +r.L || 0 })).sort((a, b) => a.sta - b.sta);
    if (v.length === 0) return 0;
    if (v.length === 1) return v[0].el;
    const grade = (i) => (v[i + 1].el - v[i].el) / ((v[i + 1].sta - v[i].sta) || 1);
    // 직선 구간 값
    let i = 0;
    while (i < v.length - 2 && sta > v[i + 1].sta) i++;
    let el = v[i].el + grade(i) * (sta - v[i].sta);
    // 종단곡선 보정 (가까운 VIP)
    for (let k = 1; k < v.length - 1; k++) {
        const L = v[k].L;
        if (!(L > 0)) continue;
        const bvc = v[k].sta - L / 2, evc = v[k].sta + L / 2;
        if (sta >= bvc && sta <= evc) {
            const g1 = grade(k - 1), g2 = grade(k);
            const elBvc = v[k].el - g1 * L / 2;
            const xx = sta - bvc;
            return elBvc + g1 * xx + (g2 - g1) / (2 * L) * xx * xx;
        }
    }
    return el;
}

/** sta-값 표의 선형보간 (지반고, 편경사 등) */
export function interpTable(rows, sta, key = 'el') {
    const r = (rows || []).filter(x => isFinite(+x.sta)).map(x => ({ sta: +x.sta, v: +x[key] || 0 })).sort((a, b) => a.sta - b.sta);
    if (r.length === 0) return 0;
    if (sta <= r[0].sta) return r[0].v;
    if (sta >= r[r.length - 1].sta) return r[r.length - 1].v;
    for (let i = 0; i < r.length - 1; i++) {
        if (sta >= r[i].sta && sta <= r[i + 1].sta) {
            const t = (sta - r[i].sta) / ((r[i + 1].sta - r[i].sta) || 1);
            return r[i].v + (r[i + 1].v - r[i].v) * t;
        }
    }
    return r[r.length - 1].v;
}

/** 캐시: 같은 선형 데이터면 재계산하지 않는다 */
let _cacheKey = null, _cache = null;
export function getHorizontal(al) {
    const key = JSON.stringify([al.startSta, al.ip]);
    if (key !== _cacheKey) { _cache = buildHorizontal(al); _cacheKey = key; }
    return _cache;
}

/** 평면선형 계산서 (텍스트 표) */
export function horizontalReport(al) {
    const h = getHorizontal(al);
    const rows = [];
    rows.push(['IP', 'X(m)', 'Y(m)', 'R(m)', 'A1', 'A2', '교각(°)', 'T1(m)', 'T2(m)', 'TS', 'ST']);
    for (const ip of h.ipInfo) {
        rows.push([ip.name, ip.N.toFixed(3), ip.E.toFixed(3), ip.R ? ip.R.toFixed(3) : '-', ip.A1 || '-', ip.A2 || '-',
            ip.D.toFixed(4), ip.T1 ? ip.T1.toFixed(3) : '-', ip.T2 ? ip.T2.toFixed(3) : '-', ip.TS.toFixed(3), ip.ST.toFixed(3)]);
    }
    return { rows, length: h.length };
}
