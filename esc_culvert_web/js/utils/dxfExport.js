// dxfExport.js - DXF 파일 내보내기

import state from '../state.js';

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

// DXF 문서 생성
function generateDXF(data) {
    const dims = calculateDimensions(data);

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
    dxf += '70\n3\n'; // 레이어 개수

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

    dxf += '0\nENDTAB\n';
    dxf += '0\nENDSEC\n';

    // 엔티티 섹션
    dxf += '0\nSECTION\n';
    dxf += '2\nENTITIES\n';

    // 외곽선 (LWPOLYLINE)
    dxf += createPolyline([
        [0, 0],
        [dims.totalWidth, 0],
        [dims.totalWidth, dims.totalHeight],
        [0, dims.totalHeight],
        [0, 0]
    ], 'OUTER');

    // 내부 공간
    let xOffset = data.WL;
    for (let i = 0; i < data.culvert_count; i++) {
        const B = data.B[i];
        dxf += createPolyline([
            [xOffset, dims.LT],
            [xOffset + B, dims.LT],
            [xOffset + B, dims.LT + dims.H],
            [xOffset, dims.LT + dims.H],
            [xOffset, dims.LT]
        ], 'INNER');

        xOffset += B;
        if (i < data.middle_walls.length) {
            xOffset += data.middle_walls[i].thickness;
        }
    }

    // 치수선들
    // 전체 폭
    dxf += createDimension(0, 0, dims.totalWidth, 0, 0, -500, dims.totalWidth.toString(), 'DIMENSION');
    // 전체 높이
    dxf += createDimension(dims.totalWidth, 0, dims.totalWidth, dims.totalHeight, dims.totalWidth + 500, dims.totalHeight / 2, dims.totalHeight.toString(), 'DIMENSION', true);
    // 내공 높이
    dxf += createDimension(0, dims.LT, 0, dims.LT + dims.H, -500, dims.LT + dims.H / 2, dims.H.toString(), 'DIMENSION', true);

    // 각 B 폭
    xOffset = data.WL;
    for (let i = 0; i < data.culvert_count; i++) {
        const B = data.B[i];
        dxf += createDimension(xOffset, dims.totalHeight, xOffset + B, dims.totalHeight, xOffset + B / 2, dims.totalHeight + 500, B.toString(), 'DIMENSION');
        xOffset += B;
        if (i < data.middle_walls.length) {
            xOffset += data.middle_walls[i].thickness;
        }
    }

    // UT, LT
    dxf += createDimension(0, dims.LT + dims.H, 0, dims.totalHeight, -750, dims.LT + dims.H + dims.UT / 2, dims.UT.toString(), 'DIMENSION', true);
    dxf += createDimension(0, 0, 0, dims.LT, -750, dims.LT / 2, dims.LT.toString(), 'DIMENSION', true);

    // WL, WR
    dxf += createDimension(0, 0, dims.WL, 0, dims.WL / 2, -750, dims.WL.toString(), 'DIMENSION');
    dxf += createDimension(dims.totalWidth - dims.WR, 0, dims.totalWidth, 0, dims.totalWidth - dims.WR / 2, -750, dims.WR.toString(), 'DIMENSION');

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

// 치수선 생성 (간단한 형태: 선 + 텍스트)
function createDimension(x1, y1, x2, y2, textX, textY, text, layer, vertical = false) {
    let dxf = '';

    // 치수선 (LINE)
    dxf += '0\nLINE\n';
    dxf += '8\n' + layer + '\n';
    dxf += '10\n' + x1 + '\n';
    dxf += '20\n' + y1 + '\n';
    dxf += '11\n' + x2 + '\n';
    dxf += '21\n' + y2 + '\n';

    // 텍스트
    dxf += '0\nTEXT\n';
    dxf += '8\n' + layer + '\n';
    dxf += '10\n' + textX + '\n';
    dxf += '20\n' + textY + '\n';
    dxf += '40\n100\n'; // 텍스트 높이
    dxf += '1\n' + text + '\n';
    if (vertical) {
        dxf += '50\n90\n'; // 회전 각도
    }
    dxf += '72\n1\n'; // 수평 정렬 (중앙)
    dxf += '11\n' + textX + '\n';
    dxf += '21\n' + textY + '\n';

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
