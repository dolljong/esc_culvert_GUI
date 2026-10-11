// groundDxf.js - DXF 파일에서 지반선(폴리라인/선) 읽기 (일반 입력 > 지반 정보 > DXF로 지반선 읽기)
//
// LINE / LWPOLYLINE / POLYLINE(VERTEX) 엔티티를 레이어별로 모은다.
// 도면 X = Station, Y = Elevation (단위 배율 scale 로 나눠 m 로 환산)

function pairs(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
    return out;
}

/** DXF 텍스트 → { layers: { name: [[ [x,y], ... ], ...] } } */
export function readDxfPolylines(text) {
    const pr = pairs(text);
    const layers = {};
    const add = (layer, pts) => {
        if (!pts || pts.length < 2) return;
        (layers[layer || '0'] = layers[layer || '0'] || []).push(pts);
    };
    let i = 0;
    let inEntities = false;
    while (i < pr.length) {
        const [code, val] = pr[i];
        if (code === 2 && val === 'ENTITIES') { inEntities = true; i++; continue; }
        if (code === 0 && val === 'ENDSEC') { inEntities = false; i++; continue; }
        if (!inEntities || code !== 0) { i++; continue; }
        const type = val;
        i++;
        if (type === 'LINE') {
            let layer = '0', x1 = 0, y1 = 0, x2 = 0, y2 = 0;
            while (i < pr.length && pr[i][0] !== 0) {
                const [c, v] = pr[i];
                if (c === 8) layer = v; else if (c === 10) x1 = +v; else if (c === 20) y1 = +v; else if (c === 11) x2 = +v; else if (c === 21) y2 = +v;
                i++;
            }
            add(layer, [[x1, y1], [x2, y2]]);
        } else if (type === 'LWPOLYLINE') {
            let layer = '0';
            const pts = [];
            while (i < pr.length && pr[i][0] !== 0) {
                const [c, v] = pr[i];
                if (c === 8) layer = v;
                else if (c === 10) pts.push([+v, 0]);
                else if (c === 20 && pts.length) pts[pts.length - 1][1] = +v;
                i++;
            }
            add(layer, pts);
        } else if (type === 'POLYLINE') {
            let layer = '0';
            while (i < pr.length && pr[i][0] !== 0) { if (pr[i][0] === 8) layer = pr[i][1]; i++; }
            const pts = [];
            while (i < pr.length) {
                const [c, v] = pr[i];
                if (c === 0 && v === 'VERTEX') {
                    i++;
                    let x = 0, y = 0;
                    while (i < pr.length && pr[i][0] !== 0) {
                        if (pr[i][0] === 10) x = +pr[i][1]; else if (pr[i][0] === 20) y = +pr[i][1];
                        i++;
                    }
                    pts.push([x, y]);
                } else if (c === 0 && v === 'SEQEND') { i++; while (i < pr.length && pr[i][0] !== 0) i++; break; }
                else break;
            }
            add(layer, pts);
        } else {
            while (i < pr.length && pr[i][0] !== 0) i++;
        }
    }
    return { layers };
}

/** 레이어의 선들을 X 순서의 한 줄로 합친다 (중복점 제거) */
export function mergeToProfile(polys) {
    const pts = [];
    for (const pl of polys || []) for (const p of pl) pts.push(p);
    pts.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of pts) {
        const l = out[out.length - 1];
        if (l && Math.abs(l[0] - p[0]) < 1e-6) { l[1] = (l[1] + p[1]) / 2; continue; }
        out.push([p[0], p[1]]);
    }
    return out;
}
