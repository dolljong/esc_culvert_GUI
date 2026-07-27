// dxfExport.js - DXF 파일 내보내기

import state from '../state.js';

// 치수선 오프셋 (svgRenderer와 동일)
const DIM_OFFSET = 1000;
const DIM_OFFSET_FAR = 1500;
const EXT_LINE_GAP = 500;

// 치수 문자/화살표 (도면 단위 mm 기준, svgRenderer와 동일 값)
const ARROW_SIZE = 100;
const DIM_TEXT_SIZE = 250;
// 치수선과 문자 사이 간격 (svgRenderer와 동일)
const DIM_TEXT_GAP = 175;

// DXF 파일 생성 및 다운로드
export function exportDXF() {
    const data = state.getSectionData();

    if (!validateData(data)) {
        alert('단면제원 데이터가 올바르지 않습니다.');
        return false;
    }

    // DXF 콘텐츠 생성
    const dxfContent = generateDXF(data);

    // 파일 다운로드
    downloadFile(dxfContent, 'culvert_section.dxf', 'application/dxf');
    return true;
}

// 데이터 검증
function validateData(data) {
    if (!data) return false;
    if (!data.H || data.H <= 0) return false;
    if (!data.B || !Array.isArray(data.B) || data.B.length === 0) return false;
    return true;
}

// 칸별 헌치 데이터 가져오기 (svgRenderer와 동일 로직)
function getCompartmentHaunches(data, i) {
    const h = data.haunch || {};
    const lw = h.leftWall || {};
    const rw = h.rightWall || {};
    const mw = Array.isArray(h.middleWalls) ? h.middleWalls : [];
    const last = data.culvert_count - 1;
    const zero = { width: 0, height: 0 };

    const leftWall  = (i === 0)    ? lw : (mw[i - 1] || {});
    const rightWall = (i === last)  ? rw : (mw[i] || {});

    return {
        ul: leftWall.upper  || zero,
        ll: leftWall.lower  || zero,
        ur: rightWall.upper || zero,
        lr: rightWall.lower || zero
    };
}

// DXF 문서 생성
function generateDXF(data) {
    const dims = calculateDimensions(data);
    const groundInfo = state.getGroundInfo();
    const earthCover = groundInfo.earthCoverDepth || 0;
    const waterLevel = groundInfo.groundwaterLevel || 0;

    // 부상방지저판 데이터
    const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
    const afT = afData ? (afData.thickness || 0) : 0;
    const afLeftExt = afData ? (afData.leftExtension || 0) : 0;
    const afRightExt = afData ? (afData.rightExtension || 0) : 0;

    let dxf = '';

    // 헤더 섹션
    dxf += '0\nSECTION\n';
    dxf += '2\nHEADER\n';
    dxf += '9\n$ACADVER\n1\nAC1015\n'; // AutoCAD 2000
    dxf += '9\n$INSUNITS\n70\n4\n'; // mm
    dxf += '0\nENDSEC\n';

    // 테이블 섹션 (레이어 정의)
    dxf += '0\nSECTION\n';
    dxf += '2\nTABLES\n';

    // 레이어 테이블
    dxf += '0\nTABLE\n';
    dxf += '2\nLAYER\n';
    dxf += '70\n5\n'; // 레이어 개수

    // 외곽선 레이어 (White)
    dxf += '0\nLAYER\n';
    dxf += '2\nOUTER\n';
    dxf += '70\n0\n';
    dxf += '62\n7\n'; // White
    dxf += '6\nCONTINUOUS\n';

    // 내부선 레이어 (Cyan)
    dxf += '0\nLAYER\n';
    dxf += '2\nINNER\n';
    dxf += '70\n0\n';
    dxf += '62\n3\n'; // Cyan
    dxf += '6\nCONTINUOUS\n';

    // 치수선 레이어 (Red)
    dxf += '0\nLAYER\n';
    dxf += '2\nDIMENSION\n';
    dxf += '70\n0\n';
    dxf += '62\n1\n'; // Red
    dxf += '6\nCONTINUOUS\n';

    // 지반선 레이어 (Green)
    dxf += '0\nLAYER\n';
    dxf += '2\nGROUND\n';
    dxf += '70\n0\n';
    dxf += '62\n3\n'; // Green
    dxf += '6\nCONTINUOUS\n';

    // 지하수위 레이어 (Cyan)
    dxf += '0\nLAYER\n';
    dxf += '2\nWATER\n';
    dxf += '70\n0\n';
    dxf += '62\n4\n'; // Cyan
    dxf += '6\nCONTINUOUS\n';

    dxf += '0\nENDTAB\n';
    dxf += '0\nENDSEC\n';

    // 엔티티 섹션
    dxf += '0\nSECTION\n';
    dxf += '2\nENTITIES\n';

    // === 외곽선 ===
    // 부상방지저판은 측면 날개라서 본체 외곽선에 영향을 주지 않는다 (아래에서 따로 그린다).
    dxf += createPolyline([
        [0, 0], [dims.totalWidth, 0],
        [dims.totalWidth, dims.totalHeight],
        [0, dims.totalHeight], [0, 0]
    ], 'OUTER');

    // === 내부 공간 (헌치 고려) ===
    let xOffset = data.WL;
    for (let i = 0; i < data.culvert_count; i++) {
        const B = data.B[i];
        const left = xOffset;
        const right = xOffset + B;
        const bottom = dims.LT;
        const top = dims.LT + dims.H;
        const { ul, ur, ll, lr } = getCompartmentHaunches(data, i);

        // 내공 사각형 (헌치를 고려하여 각 변)
        dxf += createLine(left + ll.width, bottom, right - lr.width, bottom, 'INNER');   // 하변
        dxf += createLine(right, bottom + lr.height, right, top - ur.height, 'INNER');    // 우변
        dxf += createLine(right - ur.width, top, left + ul.width, top, 'INNER');           // 상변
        dxf += createLine(left, top - ul.height, left, bottom + ll.height, 'INNER');       // 좌변

        xOffset += B;
        if (i < data.middle_walls.length) {
            xOffset += data.middle_walls[i].thickness;
        }
    }

    // === 헌치 대각선 ===
    xOffset = data.WL;
    for (let i = 0; i < data.culvert_count; i++) {
        const B = data.B[i];
        const left = xOffset;
        const right = xOffset + B;
        const bottom = dims.LT;
        const top = dims.LT + dims.H;
        const { ul, ur, ll, lr } = getCompartmentHaunches(data, i);

        if (ul.width > 0 && ul.height > 0)
            dxf += createLine(left, top - ul.height, left + ul.width, top, 'INNER');
        if (ur.width > 0 && ur.height > 0)
            dxf += createLine(right - ur.width, top, right, top - ur.height, 'INNER');
        if (ll.width > 0 && ll.height > 0)
            dxf += createLine(left, bottom + ll.height, left + ll.width, bottom, 'INNER');
        if (lr.width > 0 && lr.height > 0)
            dxf += createLine(right - lr.width, bottom, right, bottom + lr.height, 'INNER');

        xOffset += B;
        if (i < data.middle_walls.length) {
            xOffset += data.middle_walls[i].thickness;
        }
    }

    // === 부상방지저판 ===
    if (afData) {
        if (afLeftExt > 0) {
            dxf += createPolyline([
                [0, afT], [-afLeftExt, afT],
                [-afLeftExt, 0], [0, 0]
            ], 'OUTER');
        }
        if (afRightExt > 0) {
            dxf += createPolyline([
                [dims.totalWidth, afT], [dims.totalWidth + afRightExt, afT],
                [dims.totalWidth + afRightExt, 0], [dims.totalWidth, 0]
            ], 'OUTER');
        }
    }

    // === 지반선 ===
    if (earthCover > 0) {
        const groundY = dims.totalHeight + earthCover;
        const lineLeft = (afData ? -afLeftExt : 0) - 500;
        const lineRight = (afData ? dims.totalWidth + afRightExt : dims.totalWidth) + 500;

        // 지반선
        dxf += createLine(lineLeft, groundY, lineRight, groundY, 'GROUND');

        // 해치 마크
        const hatchSpacing = 400;
        const hatchSize = 200;
        for (let x = lineLeft + hatchSpacing / 2; x <= lineRight; x += hatchSpacing) {
            dxf += createLine(x, groundY, x - hatchSize, groundY - hatchSize, 'GROUND');
        }
    }

    // === 지하수위 ===
    if (waterLevel > 0 && earthCover > 0) {
        const groundY = dims.totalHeight + earthCover;
        const waterY = groundY - waterLevel;
        const triBase = 400;
        const triH = 350;
        const lineLen = 800;

        // 우측 벽체 바깥쪽
        dxf += createLine(dims.totalWidth, waterY, dims.totalWidth + lineLen, waterY, 'WATER');
        const rCx = dims.totalWidth + lineLen / 2;
        dxf += createLine(rCx - triBase / 2, waterY + triH, rCx + triBase / 2, waterY + triH, 'WATER');
        dxf += createLine(rCx - triBase / 2, waterY + triH, rCx, waterY, 'WATER');
        dxf += createLine(rCx + triBase / 2, waterY + triH, rCx, waterY, 'WATER');

        // 좌측 벽체 바깥쪽
        dxf += createLine(0, waterY, -lineLen, waterY, 'WATER');
        const lCx = -lineLen / 2;
        dxf += createLine(lCx - triBase / 2, waterY + triH, lCx + triBase / 2, waterY + triH, 'WATER');
        dxf += createLine(lCx - triBase / 2, waterY + triH, lCx, waterY, 'WATER');
        dxf += createLine(lCx + triBase / 2, waterY + triH, lCx, waterY, 'WATER');
    }

    // === 치수선 (SVG 렌더러와 동일 설정) ===
    const leftX = afData ? -afLeftExt : 0;
    const rightX = afData ? dims.totalWidth + afRightExt : dims.totalWidth;

    // 1. 전체 폭 (하단)
    dxf += createHDim(0, dims.totalWidth, 0, -DIM_OFFSET, dims.totalWidth.toString(), 'DIMENSION');

    // 2. 전체 높이 (우측, 외측 tier) - extGap = EXT_LINE_GAP + 500
    dxf += createVDim(rightX, 0, dims.totalHeight, DIM_OFFSET_FAR, dims.totalHeight.toString(), 'DIMENSION', EXT_LINE_GAP + 500);

    // 3. 내공 높이 H (좌측)
    dxf += createVDim(leftX, dims.LT, dims.LT + dims.H, -DIM_OFFSET, dims.H.toString(), 'DIMENSION');

    // 4. 각 내공 폭 (상단)
    xOffset = data.WL;
    for (let i = 0; i < data.culvert_count; i++) {
        const B = data.B[i];
        dxf += createHDim(xOffset, xOffset + B, dims.totalHeight, DIM_OFFSET, B.toString(), 'DIMENSION');
        xOffset += B;
        if (i < data.middle_walls.length) {
            xOffset += data.middle_walls[i].thickness;
        }
    }

    // 5. 상부 슬래브 UT (좌측)
    dxf += createVDim(leftX, dims.LT + dims.H, dims.totalHeight, -DIM_OFFSET, dims.UT.toString(), 'DIMENSION');

    // 6. 하부 슬래브 LT (좌측)
    dxf += createVDim(leftX, 0, dims.LT, -DIM_OFFSET, dims.LT.toString(), 'DIMENSION');

    // 7. 좌측벽 WL (상단)
    dxf += createHDim(0, dims.WL, dims.totalHeight, DIM_OFFSET, dims.WL.toString(), 'DIMENSION');

    // 8. 우측벽 WR (상단)
    dxf += createHDim(dims.totalWidth - dims.WR, dims.totalWidth, dims.totalHeight, DIM_OFFSET, dims.WR.toString(), 'DIMENSION');

    // 9. 중간벽 치수 (상단)
    if (data.middle_walls && data.middle_walls.length > 0) {
        xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            xOffset += data.B[i];
            if (i < data.middle_walls.length) {
                const wallThickness = data.middle_walls[i].thickness;
                dxf += createHDim(xOffset, xOffset + wallThickness, dims.totalHeight, DIM_OFFSET, wallThickness.toString(), 'DIMENSION');
                xOffset += wallThickness;
            }
        }
    }

    // 10. 부상방지저판 치수
    if (afData) {
        if (afLeftExt > 0) {
            dxf += createHDim(-afLeftExt, 0, 0, -DIM_OFFSET, afLeftExt.toString(), 'DIMENSION');
            dxf += createVDim(-afLeftExt, 0, afT, -DIM_OFFSET, afT.toString(), 'DIMENSION');
        }
    }

    // 11. 토피 치수 (우측, 전체 높이와 같은 tier) - extGap = EXT_LINE_GAP + 500
    if (earthCover > 0) {
        const groundY = dims.totalHeight + earthCover;
        dxf += createVDim(rightX, dims.totalHeight, groundY, DIM_OFFSET_FAR, earthCover.toString(), 'DIMENSION', EXT_LINE_GAP + 500);

        // 12. 지하수위 깊이 치수
        if (waterLevel > 0) {
            const waterY = groundY - waterLevel;
            dxf += createVDim(rightX, waterY, groundY, DIM_OFFSET, waterLevel.toString(), 'DIMENSION');
        }
    }

    dxf += '0\nENDSEC\n';

    // 파일 끝
    dxf += '0\nEOF\n';

    return dxf;
}

// 치수 계산
function calculateDimensions(data) {
    const totalInnerWidth = data.B.reduce((a, b) => a + b, 0);
    const totalMiddleWallThickness = data.middle_walls
        ? data.middle_walls.reduce((s, w) => s + w.thickness, 0)
        : 0;
    const totalWidth = data.WL + totalInnerWidth + totalMiddleWallThickness + data.WR;
    const totalHeight = data.LT + data.H + data.UT;

    return {
        totalWidth,
        totalHeight,
        H: data.H,
        LT: data.LT,
        UT: data.UT,
        WL: data.WL,
        WR: data.WR
    };
}

// LINE 엔티티 생성
function createLine(x1, y1, x2, y2, layer) {
    let dxf = '0\nLINE\n';
    dxf += '8\n' + layer + '\n';
    dxf += '10\n' + x1 + '\n';
    dxf += '20\n' + y1 + '\n';
    dxf += '11\n' + x2 + '\n';
    dxf += '21\n' + y2 + '\n';
    return dxf;
}

// LWPOLYLINE 생성
function createPolyline(points, layer) {
    let dxf = '0\nLWPOLYLINE\n';
    dxf += '8\n' + layer + '\n';
    dxf += '90\n' + points.length + '\n';
    dxf += '70\n0\n'; // 닫힌 폴리라인 아님

    for (const [x, y] of points) {
        dxf += '10\n' + x + '\n';
        dxf += '20\n' + y + '\n';
    }

    return dxf;
}

// 치수 화살표 생성 (SOLID 채움 삼각형 — svgRenderer.drawArrow와 동일 형상)
function createArrow(x, y, direction, layer) {
    const s = ARROW_SIZE;
    let p;
    switch (direction) {
        case 'right': p = [[x, y], [x + s, y - s / 3], [x + s, y + s / 3]]; break;
        case 'left':  p = [[x, y], [x - s, y - s / 3], [x - s, y + s / 3]]; break;
        case 'up':    p = [[x, y], [x - s / 3, y + s], [x + s / 3, y + s]]; break;
        case 'down':  p = [[x, y], [x - s / 3, y - s], [x + s / 3, y - s]]; break;
        default: return '';
    }
    // SOLID는 정점 4개를 요구한다. 삼각형은 3번째 정점을 반복해 표현한다.
    let dxf = '0\nSOLID\n';
    dxf += '8\n' + layer + '\n';
    dxf += '10\n' + p[0][0] + '\n20\n' + p[0][1] + '\n30\n0\n';
    dxf += '11\n' + p[1][0] + '\n21\n' + p[1][1] + '\n31\n0\n';
    dxf += '12\n' + p[2][0] + '\n22\n' + p[2][1] + '\n32\n0\n';
    dxf += '13\n' + p[2][0] + '\n23\n' + p[2][1] + '\n33\n0\n';
    return dxf;
}

// 수평 치수선 생성 (SVG drawHorizontalDimension과 동일 로직)
function createHDim(x1, x2, y, offset, text, layer, extGap) {
    const dimY = y + offset;
    const sign = offset > 0 ? 1 : -1;
    const extStart = y + sign * (extGap || EXT_LINE_GAP);
    let dxf = '';

    // 보조선 (간격 두고 시작)
    dxf += createLine(x1, extStart, x1, dimY, layer);
    dxf += createLine(x2, extStart, x2, dimY, layer);
    // 치수선
    dxf += createLine(x1, dimY, x2, dimY, layer);
    // 화살표
    dxf += createArrow(x1, dimY, 'right', layer);
    dxf += createArrow(x2, dimY, 'left', layer);
    // 텍스트 — 치수선 위쪽(+Y)에 둔다. 치수선이 도형 위/아래 어디에 있든 같다.
    const textX = (x1 + x2) / 2;
    const textY = dimY + DIM_TEXT_GAP;
    dxf += createText(textX, textY, DIM_TEXT_SIZE, 0, text, layer);

    return dxf;
}

// 수직 치수선 생성 (SVG drawVerticalDimension과 동일 로직)
function createVDim(x, y1, y2, offset, text, layer, extGap) {
    const dimX = x + offset;
    const sign = offset > 0 ? 1 : -1;
    const extStart = x + sign * (extGap || EXT_LINE_GAP);
    let dxf = '';

    // 보조선 (간격 두고 시작)
    dxf += createLine(extStart, y1, dimX, y1, layer);
    dxf += createLine(extStart, y2, dimX, y2, layer);
    // 치수선
    dxf += createLine(dimX, y1, dimX, y2, layer);
    // 화살표
    dxf += createArrow(dimX, y1, 'up', layer);
    dxf += createArrow(dimX, y2, 'down', layer);
    // 텍스트 — 90° 회전 문자 기준의 "위쪽"은 치수선 왼쪽(-X)이다. 수평 치수선과 같은 규칙.
    const textX = dimX - DIM_TEXT_GAP;
    const textY = (y1 + y2) / 2;
    dxf += createText(textX, textY, DIM_TEXT_SIZE, 90, text, layer);

    return dxf;
}

// 텍스트 엔티티 생성
function createText(x, y, height, rotation, text, layer) {
    let dxf = '0\nTEXT\n';
    dxf += '8\n' + layer + '\n';
    dxf += '10\n' + x + '\n';
    dxf += '20\n' + y + '\n';
    dxf += '40\n' + height + '\n';
    dxf += '1\n' + text + '\n';
    if (rotation !== 0) {
        dxf += '50\n' + rotation + '\n';
    }
    dxf += '72\n1\n'; // 수평 정렬 (중앙)
    dxf += '11\n' + x + '\n';
    dxf += '21\n' + y + '\n';
    return dxf;
}

// 파일 다운로드
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export default { exportDXF };
