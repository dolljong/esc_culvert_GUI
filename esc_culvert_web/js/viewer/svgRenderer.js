// svgRenderer.js - SVG 생성 (utils.py의 create_culvert_dxf 포팅)

import state from '../state.js';

// SVG 네임스페이스
const SVG_NS = 'http://www.w3.org/2000/svg';

// 색상 매핑 (DXF 색상 인덱스 → CSS 색상)
const DXF_COLORS = {
    1: '#FF0000',   // Red
    3: '#00FFFF',   // Cyan (내부)
    7: '#FFFFFF'    // White (외곽)
};

// 치수선 오프셋
const DIM_OFFSET = 1000;
const DIM_OFFSET_FAR = 1500;
const ARROW_SIZE = 100;
const EXT_LINE_GAP = 500;

// 패딩 (뷰박스용)
const PADDING = 1500;

// SVG 렌더러 클래스
export class SvgRenderer {
    constructor(svgElement) {
        this.svg = svgElement;
        this.scale = 1;
        this.viewBox = { x: 0, y: 0, width: 0, height: 0 };
    }

    // 전체 렌더링
    render(culvertData) {
        // SVG 초기화
        this.svg.innerHTML = '';

        if (!culvertData) {
            culvertData = state.getSectionData();
        }

        // 데이터 검증
        if (!this.validateData(culvertData)) {
            this.renderPlaceholder();
            return;
        }

        // 치수 계산
        const dims = this.calculateDimensions(culvertData);

        // 그룹 생성
        const mainGroup = this.createGroup('main-group');

        // 외곽선 그리기
        this.drawOuterProfile(mainGroup, culvertData, dims);

        // 내부 공간 그리기
        this.drawInnerCompartments(mainGroup, culvertData, dims);

        // 헌치 그리기
        this.drawHaunches(mainGroup, culvertData, dims);

        // 기둥 종거더 그리기
        this.drawColumnGirders(mainGroup, culvertData, dims);

        // 기둥 리더선 그리기
        this.drawColumnLeaders(mainGroup, culvertData, dims);

        // 부상방지저판 그리기
        this.drawAntiFloatSlab(mainGroup, culvertData, dims);

        // 지반선 그리기
        this.drawGroundLevel(mainGroup, culvertData, dims);

        // 지하수위 표시
        this.drawGroundwaterLevel(mainGroup, culvertData, dims);

        // 치수선 그리기
        this.drawDimensions(mainGroup, culvertData, dims);

        this.svg.appendChild(mainGroup);

        // 뷰박스 설정
        this.setViewBox(culvertData, dims);
    }

    // 데이터 검증
    validateData(data) {
        if (!data) return false;
        if (!data.H || data.H <= 0) return false;
        if (!data.B || !Array.isArray(data.B) || data.B.length === 0) return false;
        if (!data.UT || data.UT <= 0) return false;
        if (!data.LT || data.LT <= 0) return false;
        if (!data.WL || data.WL <= 0) return false;
        if (!data.WR || data.WR <= 0) return false;
        return true;
    }

    // 플레이스홀더 렌더링
    renderPlaceholder() {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', '50%');
        text.setAttribute('y', '50%');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('fill', '#666');
        text.setAttribute('font-size', '14');
        text.textContent = '단면제원 데이터를 입력하세요';
        this.svg.appendChild(text);
        this.svg.setAttribute('viewBox', '0 0 400 200');
    }

    // 치수 계산
    calculateDimensions(data) {
        const totalInnerWidth = data.B.reduce((a, b) => a + b, 0);
        const totalMiddleWallThickness = data.middle_walls
            ? data.middle_walls.reduce((s, w) => s + w.thickness, 0)
            : 0;
        const totalWidth = data.WL + totalInnerWidth + totalMiddleWallThickness + data.WR;
        const totalHeight = data.LT + data.H + data.UT;

        return {
            totalWidth,
            totalHeight,
            totalInnerWidth,
            totalMiddleWallThickness,
            H: data.H,
            LT: data.LT,
            UT: data.UT,
            WL: data.WL,
            WR: data.WR
        };
    }

    // 뷰박스 설정
    setViewBox(data, dims) {
        const af = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
        const extL = af ? (af.leftExtension || 0) : 0;
        const extR = af ? (af.rightExtension || 0) : 0;
        const groundInfo = state.getGroundInfo();
        const earthCover = groundInfo.earthCoverDepth || 0;
        const topY = dims.totalHeight + earthCover;
        const minX = -extL - PADDING;
        const width = dims.totalWidth + extL + extR + PADDING * 2;
        const height = topY + PADDING * 2;

        // Y축 반전을 위해 transform 사용
        this.svg.setAttribute('viewBox', `${minX} ${-topY - PADDING} ${width} ${height}`);
        this.viewBox = { x: minX, y: -PADDING, width, height };

        // 전체 그룹에 Y축 반전 적용
        const mainGroup = this.svg.querySelector('.main-group');
        if (mainGroup) {
            mainGroup.setAttribute('transform', 'scale(1, -1)');
        }
    }

    // 그룹 생성
    createGroup(className) {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', className);
        return g;
    }

    // 외곽선 그리기
    drawOuterProfile(parent, data, dims) {
        const af = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
        const t = af ? (af.thickness || 0) : 0;

        if (af && t > 0) {
            // 부상방지저판이 있는 경우: 벽체 하단을 저판 상단(y=t)으로
            const points = [
                [0, t], [0, dims.totalHeight],
                [dims.totalWidth, dims.totalHeight], [dims.totalWidth, t]
            ];
            parent.appendChild(this.createPolyline(points, 'outer-line'));
            // 하부 바닥선
            parent.appendChild(this.createLine(0, 0, dims.totalWidth, 0, 'outer-line'));
        } else {
            const points = [
                [0, 0], [dims.totalWidth, 0],
                [dims.totalWidth, dims.totalHeight],
                [0, dims.totalHeight], [0, 0]
            ];
            parent.appendChild(this.createPolyline(points, 'outer-line'));
        }
    }

    // 칸별 헌치 데이터 가져오기
    getCompartmentHaunches(data, i) {
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

    // 내부 공간 그리기
    drawInnerCompartments(parent, data, dims) {
        let xOffset = data.WL;

        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            const left = xOffset;
            const right = xOffset + B;
            const bottom = dims.LT;
            const top = dims.LT + dims.H;
            const { ul, ur, ll, lr } = this.getCompartmentHaunches(data, i);

            parent.appendChild(this.createLine(left + ll.width, bottom, right - lr.width, bottom, 'inner-line'));
            parent.appendChild(this.createLine(right, bottom + lr.height, right, top - ur.height, 'inner-line'));
            parent.appendChild(this.createLine(right - ur.width, top, left + ul.width, top, 'inner-line'));
            parent.appendChild(this.createLine(left, top - ul.height, left, bottom + ll.height, 'inner-line'));

            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }
    }

    // 헌치 그리기
    drawHaunches(parent, data, dims) {
        let xOffset = data.WL;

        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            const left = xOffset;
            const right = xOffset + B;
            const bottom = dims.LT;
            const top = dims.LT + dims.H;
            const { ul, ur, ll, lr } = this.getCompartmentHaunches(data, i);

            if (ul.width > 0 && ul.height > 0)
                parent.appendChild(this.createLine(left, top - ul.height, left + ul.width, top, 'inner-line'));
            if (ur.width > 0 && ur.height > 0)
                parent.appendChild(this.createLine(right - ur.width, top, right, top - ur.height, 'inner-line'));
            if (ll.width > 0 && ll.height > 0)
                parent.appendChild(this.createLine(left, bottom + ll.height, left + ll.width, bottom, 'inner-line'));
            if (lr.width > 0 && lr.height > 0)
                parent.appendChild(this.createLine(right - lr.width, bottom, right, bottom + lr.height, 'inner-line'));

            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }
    }

    // 기둥 종거더 그리기
    drawColumnGirders(parent, data, dims) {
        if (!data.middle_walls || data.middle_walls.length === 0) return;
        const cg = data.columnGirder;
        if (!cg) return;
        const upperAdd = cg.upperAdditionalHeight || 0;
        const lowerAdd = cg.lowerAdditionalHeight || 0;
        if (upperAdd <= 0 && lowerAdd <= 0) return;

        const bottom = dims.LT;
        const top = dims.LT + dims.H;

        let xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            xOffset += data.B[i];
            if (i < data.middle_walls.length) {
                const wall = data.middle_walls[i];
                if (wall.type === '기둥') {
                    const wLeft = xOffset;
                    const wRight = xOffset + wall.thickness;
                    const mwHaunch = (data.haunch && data.haunch.middleWalls && data.haunch.middleWalls[i]) || {};
                    const upperH = (mwHaunch.upper && mwHaunch.upper.height) || 0;
                    const lowerH = (mwHaunch.lower && mwHaunch.lower.height) || 0;

                    // 상부 거더 (헌치끝에서 아래로)
                    if (upperAdd > 0) {
                        const yStart = top - upperH;
                        const yEnd = yStart - upperAdd;
                        parent.appendChild(this.createLine(wLeft, yStart, wLeft, yEnd, 'girder-line'));
                        parent.appendChild(this.createLine(wRight, yStart, wRight, yEnd, 'girder-line'));
                        parent.appendChild(this.createLine(wLeft, yEnd, wRight, yEnd, 'girder-line'));
                    }

                    // 하부 거더 (헌치끝에서 위로)
                    if (lowerAdd > 0) {
                        const yStart = bottom + lowerH;
                        const yEnd = yStart + lowerAdd;
                        parent.appendChild(this.createLine(wLeft, yStart, wLeft, yEnd, 'girder-line'));
                        parent.appendChild(this.createLine(wRight, yStart, wRight, yEnd, 'girder-line'));
                        parent.appendChild(this.createLine(wLeft, yEnd, wRight, yEnd, 'girder-line'));
                    }

                    // X 표시 (상부 거더 하단 ~ 하부 거더 상단)
                    const xTop = upperAdd > 0 ? (top - upperH - upperAdd) : (top - upperH);
                    const xBottom = lowerAdd > 0 ? (bottom + lowerH + lowerAdd) : (bottom + lowerH);
                    if (xTop > xBottom) {
                        parent.appendChild(this.createLine(wLeft, xTop, wRight, xBottom, 'girder-x-line'));
                        parent.appendChild(this.createLine(wRight, xTop, wLeft, xBottom, 'girder-x-line'));
                    }
                }
                xOffset += wall.thickness;
            }
        }
    }

    // 기둥 리더선 그리기
    drawColumnLeaders(parent, data, dims) {
        if (!data.middle_walls || data.middle_walls.length === 0) return;
        const cg = data.columnGirder;
        if (!cg) return;

        const bottom = dims.LT;
        const top = dims.LT + dims.H;
        const midY = (bottom + top) / 2;
        const leaderLen = 800;
        const textSize = 200;
        const lineGap = textSize * 1.3;

        let xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            xOffset += data.B[i];
            if (i < data.middle_walls.length) {
                const wall = data.middle_walls[i];
                if (wall.type === '기둥') {
                    const wSurface = xOffset + wall.thickness;
                    const leaderEnd = wSurface + leaderLen;

                    // 리더선: 벽체 중심에서 우측으로
                    parent.appendChild(this.createLine(wSurface, midY, leaderEnd, midY, 'leader-line'));
                    // 꺾임 (작은 수직 tick)
                    parent.appendChild(this.createLine(leaderEnd, midY, leaderEnd, midY + textSize * 0.3, 'leader-line'));

                    // CTC 텍스트
                    const t1 = this.createText(leaderEnd + 50, midY + lineGap * 0.5, `CTC=${cg.columnCTC}`);
                    t1.setAttribute('class', 'leader-text');
                    t1.setAttribute('font-size', textSize);
                    t1.setAttribute('text-anchor', 'start');
                    parent.appendChild(t1);

                    // W 텍스트
                    const t2 = this.createText(leaderEnd + 50, midY - lineGap * 0.5, `W=${cg.columnWidth}`);
                    t2.setAttribute('class', 'leader-text');
                    t2.setAttribute('font-size', textSize);
                    t2.setAttribute('text-anchor', 'start');
                    parent.appendChild(t2);
                }
                xOffset += wall.thickness;
            }
        }
    }

    // 부상방지저판 그리기
    drawAntiFloatSlab(parent, data, dims) {
        const af = data.antiFloat;
        if (!af || !af.use) return;
        const lExt = af.leftExtension || 0;
        const rExt = af.rightExtension || 0;
        const t = af.thickness || 0;
        if (lExt <= 0 && rExt <= 0 && t <= 0) return;
        // 좌측 돌출부 (벽체 하단에서 바깥쪽, 바닥 y=0 일치)
        if (lExt > 0) {
            const leftPoly = this.createPolyline([
                [0, t], [-lExt, t], [-lExt, 0], [0, 0]
            ], 'outer-line');
            parent.appendChild(leftPoly);
        }
        // 우측 돌출부
        if (rExt > 0) {
            const rightPoly = this.createPolyline([
                [dims.totalWidth, t], [dims.totalWidth + rExt, t],
                [dims.totalWidth + rExt, 0], [dims.totalWidth, 0]
            ], 'outer-line');
            parent.appendChild(rightPoly);
        }
    }

    // Polyline 생성
    createPolyline(points, className) {
        const polyline = document.createElementNS(SVG_NS, 'polyline');
        const pointsStr = points.map(p => `${p[0]},${p[1]}`).join(' ');
        polyline.setAttribute('points', pointsStr);
        polyline.setAttribute('class', className);
        return polyline;
    }

    // 지반선 그리기
    drawGroundLevel(parent, data, dims) {
        const groundInfo = state.getGroundInfo();
        const earthCover = groundInfo.earthCoverDepth || 0;
        if (earthCover <= 0) return;

        const groundY = dims.totalHeight + earthCover;

        const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
        const leftX = afData ? -(afData.leftExtension || 0) : 0;
        const rightX = afData ? dims.totalWidth + (afData.rightExtension || 0) : dims.totalWidth;

        const lineLeft = leftX - 500;
        const lineRight = rightX + 500;

        const groundGroup = this.createGroup('ground-level');

        // 지반선
        groundGroup.appendChild(this.createLine(lineLeft, groundY, lineRight, groundY, 'ground-line'));

        // 해치 마크 (지반선 아래쪽)
        const hatchSpacing = 400;
        const hatchSize = 200;
        for (let x = lineLeft + hatchSpacing / 2; x <= lineRight; x += hatchSpacing) {
            groundGroup.appendChild(this.createLine(x, groundY, x - hatchSize, groundY - hatchSize, 'ground-hatch'));
        }

        parent.appendChild(groundGroup);
    }

    // 지하수위 표시
    drawGroundwaterLevel(parent, data, dims) {
        const groundInfo = state.getGroundInfo();
        const waterLevel = groundInfo.groundwaterLevel || 0;
        if (waterLevel <= 0) return;

        const earthCover = groundInfo.earthCoverDepth || 0;
        const groundY = dims.totalHeight + earthCover;
        const waterY = groundY - waterLevel;
        const waterGroup = this.createGroup('water-level');

        const triBase = 300;
        const triH = 260;

        // 우측 벽체 바깥쪽
        const rLineStart = dims.totalWidth;
        const rLineEnd = dims.totalWidth + 700;
        waterGroup.appendChild(this.createLine(rLineStart, waterY, rLineEnd, waterY, 'water-level-line'));

        const rTriCx = dims.totalWidth + 350;
        const rTri = document.createElementNS(SVG_NS, 'polygon');
        rTri.setAttribute('points',
            `${rTriCx - triBase / 2},${waterY + triH} ${rTriCx + triBase / 2},${waterY + triH} ${rTriCx},${waterY}`
        );
        rTri.setAttribute('class', 'water-level-symbol');
        waterGroup.appendChild(rTri);

        // 좌측 벽체 바깥쪽
        const lLineStart = 0;
        const lLineEnd = -700;
        waterGroup.appendChild(this.createLine(lLineStart, waterY, lLineEnd, waterY, 'water-level-line'));

        const lTriCx = -350;
        const lTri = document.createElementNS(SVG_NS, 'polygon');
        lTri.setAttribute('points',
            `${lTriCx - triBase / 2},${waterY + triH} ${lTriCx + triBase / 2},${waterY + triH} ${lTriCx},${waterY}`
        );
        lTri.setAttribute('class', 'water-level-symbol');
        waterGroup.appendChild(lTri);

        parent.appendChild(waterGroup);
    }

    // 치수선 그리기
    drawDimensions(parent, data, dims) {
        const dimGroup = this.createGroup('dimensions');

        // 부상방지저판 유무에 따른 수직치수선 원점
        const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
        const leftX = afData ? -(afData.leftExtension || 0) : 0;
        const rightX = afData ? dims.totalWidth + (afData.rightExtension || 0) : dims.totalWidth;

        // 1. 전체 폭 (하단, 바깥 tier)
        this.drawHorizontalDimension(
            dimGroup, 0, dims.totalWidth, 0,
            -DIM_OFFSET, dims.totalWidth.toString()
        );

        // 2. 전체 높이 (우측, 외측 tier)
        this.drawVerticalDimension(
            dimGroup, rightX, 0, dims.totalHeight,
            DIM_OFFSET_FAR, dims.totalHeight.toString(),
            EXT_LINE_GAP + 500
        );

        // 3. 내공 높이 H (좌측)
        this.drawVerticalDimension(
            dimGroup, leftX, dims.LT, dims.LT + dims.H,
            -DIM_OFFSET, dims.H.toString()
        );

        // 4. 각 내공 폭 (상단)
        let xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            this.drawHorizontalDimension(
                dimGroup, xOffset, xOffset + B, dims.totalHeight,
                DIM_OFFSET, B.toString()
            );
            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }

        // 5. 상부 슬래브 UT (좌측, H와 동일 tier)
        this.drawVerticalDimension(
            dimGroup, leftX, dims.LT + dims.H, dims.totalHeight,
            -DIM_OFFSET, dims.UT.toString()
        );

        // 6. 하부 슬래브 LT (좌측, H와 동일 tier)
        this.drawVerticalDimension(
            dimGroup, leftX, 0, dims.LT,
            -DIM_OFFSET, dims.LT.toString()
        );

        // 7. 좌측 벽 WL (상단)
        this.drawHorizontalDimension(
            dimGroup, 0, dims.WL, dims.totalHeight,
            DIM_OFFSET, dims.WL.toString()
        );

        // 8. 우측 벽 WR (상단)
        this.drawHorizontalDimension(
            dimGroup, dims.totalWidth - dims.WR, dims.totalWidth, dims.totalHeight,
            DIM_OFFSET, dims.WR.toString()
        );

        // 9. 중간벽 치수 (상단)
        if (data.middle_walls && data.middle_walls.length > 0) {
            xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                xOffset += data.B[i];
                if (i < data.middle_walls.length) {
                    const wallThickness = data.middle_walls[i].thickness;
                    this.drawHorizontalDimension(
                        dimGroup, xOffset, xOffset + wallThickness, dims.totalHeight,
                        DIM_OFFSET, wallThickness.toString()
                    );
                    xOffset += wallThickness;
                }
            }
        }

        // 부상방지저판 치수 (좌측에만)
        if (afData) {
            const lExt = afData.leftExtension || 0;
            const t = afData.thickness || 0;
            if (lExt > 0) {
                // 좌측 돌출폭 (수평, 바닥 y=0 기준)
                this.drawHorizontalDimension(dimGroup, -lExt, 0, 0, -DIM_OFFSET, lExt.toString());
            }
            if (t > 0) {
                // 두께 (수직, 좌측 돌출부 왼쪽 면)
                this.drawVerticalDimension(dimGroup, -lExt, 0, t, -DIM_OFFSET, t.toString());
            }
        }

        // 토피 치수 (우측, 전체 높이 치수선과 동일 x 위치)
        const groundInfo = state.getGroundInfo();
        const earthCover = groundInfo.earthCoverDepth || 0;
        if (earthCover > 0) {
            const groundY = dims.totalHeight + earthCover;
            this.drawVerticalDimension(
                dimGroup, rightX, dims.totalHeight, groundY,
                DIM_OFFSET_FAR, earthCover.toString(),
                EXT_LINE_GAP + 500
            );

            // 지하수위 깊이 치수 (지표면부터, 구조물쪽 가까운 tier)
            const waterLevel = groundInfo.groundwaterLevel || 0;
            if (waterLevel > 0) {
                const waterY = groundY - waterLevel;
                this.drawVerticalDimension(
                    dimGroup, rightX, waterY, groundY,
                    DIM_OFFSET, waterLevel.toString()
                );
            }
        }

        parent.appendChild(dimGroup);
    }

    // 수평 치수선
    drawHorizontalDimension(parent, x1, x2, y, offset, text) {
        const dimY = y + offset;
        const sign = offset > 0 ? 1 : -1;
        const extStart = y + sign * EXT_LINE_GAP;

        // 보조선 (연장선)
        const ext1 = this.createLine(x1, extStart, x1, dimY, 'extension-line');
        const ext2 = this.createLine(x2, extStart, x2, dimY, 'extension-line');
        parent.appendChild(ext1);
        parent.appendChild(ext2);

        // 치수선
        const dimLine = this.createLine(x1, dimY, x2, dimY, 'dimension-line');
        parent.appendChild(dimLine);

        // 화살표
        this.drawArrow(parent, x1, dimY, 'right');
        this.drawArrow(parent, x2, dimY, 'left');

        // 텍스트
        const textX = (x1 + x2) / 2;
        const textY = dimY + 25;
        const textEl = this.createText(textX, textY, text, offset < 0);
        parent.appendChild(textEl);
    }

    // 수직 치수선
    drawVerticalDimension(parent, x, y1, y2, offset, text, extGap) {
        const dimX = x + offset;
        const sign = offset > 0 ? 1 : -1;
        const extStart = x + sign * (extGap !== undefined ? extGap : EXT_LINE_GAP);

        // 보조선 (연장선)
        const ext1 = this.createLine(extStart, y1, dimX, y1, 'extension-line');
        const ext2 = this.createLine(extStart, y2, dimX, y2, 'extension-line');
        parent.appendChild(ext1);
        parent.appendChild(ext2);

        // 치수선
        const dimLine = this.createLine(dimX, y1, dimX, y2, 'dimension-line');
        parent.appendChild(dimLine);

        // 화살표
        this.drawArrow(parent, dimX, y1, 'up');
        this.drawArrow(parent, dimX, y2, 'down');

        // 텍스트 (회전)
        const textX = dimX - 25;
        const textY = (y1 + y2) / 2;
        const textEl = this.createText(textX, textY, text, false, true);
        parent.appendChild(textEl);
    }

    // 선 생성
    createLine(x1, y1, x2, y2, className) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('class', className);
        return line;
    }

    // 화살표 그리기
    drawArrow(parent, x, y, direction) {
        const size = ARROW_SIZE;
        let points;

        switch (direction) {
            case 'right':
                points = `${x},${y} ${x + size},${y - size / 3} ${x + size},${y + size / 3}`;
                break;
            case 'left':
                points = `${x},${y} ${x - size},${y - size / 3} ${x - size},${y + size / 3}`;
                break;
            case 'up':
                points = `${x},${y} ${x - size / 3},${y + size} ${x + size / 3},${y + size}`;
                break;
            case 'down':
                points = `${x},${y} ${x - size / 3},${y - size} ${x + size / 3},${y - size}`;
                break;
        }

        const polygon = document.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('points', points);
        polygon.setAttribute('class', 'dimension-arrow');
        parent.appendChild(polygon);
    }

    // 텍스트 생성
    createText(x, y, text, flipY = false, vertical = false) {
        const textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('class', 'dimension-text');

        // Y축이 반전되어 있으므로 텍스트도 반전 필요
        let transform = `scale(1, -1) translate(0, ${-2 * y})`;
        if (vertical) {
            transform += ` rotate(-90, ${x}, ${y})`;
        }
        textEl.setAttribute('transform', transform);

        textEl.textContent = text;
        return textEl;
    }

    // 화면에 맞추기
    fitToView() {
        // 현재 데이터로 다시 렌더링 (뷰박스 재설정)
        const data = state.getSectionData();
        this.render(data);
    }

    // ── 부력검토 분할 도형 렌더링 ──
    renderBuoyancyShapes(culvertData) {
        this.svg.innerHTML = '';
        if (!culvertData) culvertData = state.getSectionData();
        if (!this.validateData(culvertData)) { this.renderPlaceholder(); return; }

        const H = culvertData.H;
        const B_list = culvertData.B;
        const UT = culvertData.UT;
        const LT = culvertData.LT;
        const WL = culvertData.WL;
        const WR = culvertData.WR;
        const middleWalls = culvertData.middle_walls || [];
        const culvertCount = culvertData.culvert_count || B_list.length;
        const haunchData = culvertData.haunch || {};
        const columnGirder = culvertData.columnGirder || {};
        const antiFloat = culvertData.antiFloat || {};

        const totalInnerWidth = B_list.reduce((a, b) => a + b, 0);
        const totalMwThickness = middleWalls.reduce((s, mw) => s + (mw.thickness || 0), 0);
        const totalWidth = WL + totalInnerWidth + totalMwThickness + WR;
        const totalHeight = LT + H + UT;

        const upperAddH = columnGirder.upperAdditionalHeight || 0;
        const lowerAddH = columnGirder.lowerAdditionalHeight || 0;

        const leftHaunch = haunchData.leftWall || { upper: { width: 0, height: 0 }, lower: { width: 0, height: 0 } };
        const rightHaunch = haunchData.rightWall || { upper: { width: 0, height: 0 }, lower: { width: 0, height: 0 } };
        const middleHaunches = haunchData.middleWalls || [];

        const afUse = antiFloat && antiFloat.use;
        const afLeft = afUse ? (antiFloat.leftExtension || 0) : 0;
        const afRight = afUse ? (antiFloat.rightExtension || 0) : 0;
        const afT = afUse ? (antiFloat.thickness || 0) : 0;

        const mainGroup = this.createGroup('main-group');
        let shapeNo = 0;

        function textH(w, h) { return Math.max(Math.min(w * 0.13, h * 0.13, 220), 60); }

        const me = this;
        function addRect(x1, y1, x2, y2, name, cls) {
            shapeNo++;
            mainGroup.appendChild(me.createPolyline([[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]], cls));
            const cx = (x1+x2)/2, cy = (y1+y2)/2;
            const w = Math.abs(x2-x1), h = Math.abs(y2-y1);
            const th = textH(w, h);
            mainGroup.appendChild(me._buoyText(cx, cy + th*0.3, `No.${shapeNo}`, th, 'buoy-num-text'));
            const nth = th * 0.7;
            if (name.length * nth < w * 0.95) {
                mainGroup.appendChild(me._buoyText(cx, cy - th*0.6, name, nth, 'buoy-name-text'));
            }
        }

        function addRectDashed(x1, y1, x2, y2, name, cls) {
            shapeNo++;
            mainGroup.appendChild(me.createLine(x1,y1,x2,y1, cls + ' buoy-dashed'));
            mainGroup.appendChild(me.createLine(x2,y1,x2,y2, cls + ' buoy-dashed'));
            mainGroup.appendChild(me.createLine(x2,y2,x1,y2, cls + ' buoy-dashed'));
            mainGroup.appendChild(me.createLine(x1,y2,x1,y1, cls + ' buoy-dashed'));
            const cx = (x1+x2)/2, cy = (y1+y2)/2;
            const th = textH(Math.abs(x2-x1), Math.abs(y2-y1));
            mainGroup.appendChild(me._buoyText(cx, cy, `No.${shapeNo}`, th, 'buoy-num-text'));
        }

        function addTri(p1, p2, p3, cls, label) {
            if (label) shapeNo++;
            mainGroup.appendChild(me.createPolyline([p1,p2,p3,p1], cls));
            if (label) {
                const cx = (p1[0]+p2[0]+p3[0])/3, cy = (p1[1]+p2[1]+p3[1])/3;
                const xs = [p1[0],p2[0],p3[0]], ys = [p1[1],p2[1],p3[1]];
                const th = Math.min(textH(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)), 130);
                mainGroup.appendChild(me._buoyText(cx, cy, `No.${shapeNo}`, th, 'buoy-num-text'));
            }
        }

        // 전체 윤곽선
        mainGroup.appendChild(this.createPolyline([[0,0],[totalWidth,0],[totalWidth,totalHeight],[0,totalHeight],[0,0]], 'buoy-outline'));
        let xOff = WL;
        for (let i = 0; i < culvertCount; i++) {
            const B = B_list[i]; const l = xOff, r = xOff + B;
            mainGroup.appendChild(this.createPolyline([[l,LT],[r,LT],[r,LT+H],[l,LT+H],[l,LT]], 'buoy-outline'));
            xOff += B;
            if (i < middleWalls.length) xOff += (middleWalls[i].thickness || 0);
        }

        // 도형 (report 순서 동일)
        addRect(0, LT+H, totalWidth, totalHeight, '상부슬래브', 'buoy-rect');
        addRect(0, 0, totalWidth, LT, '하부슬래브', 'buoy-rect');
        addRect(0, LT, WL, LT+H, '좌측벽', 'buoy-rect');

        xOff = WL;
        for (let i = 0; i < culvertCount; i++) {
            xOff += B_list[i];
            if (i < middleWalls.length) {
                const mw = middleWalls[i]; const mwT = mw.thickness || 600;
                const mwType = mw.type || '연속벽'; const mwH = middleHaunches[i] || {};
                if (mwType === '연속벽') {
                    addRect(xOff, LT, xOff+mwT, LT+H, `중간벽${i+1}`, 'buoy-rect');
                } else {
                    const mhUH = (mwH.upper&&mwH.upper.height)||0, mhLH = (mwH.lower&&mwH.lower.height)||0;
                    const ugH = mhUH+upperAddH, lgH = mhLH+lowerAddH;
                    addRect(xOff, LT+H-ugH, xOff+mwT, LT+H, '상부거더', 'buoy-girder');
                    addRect(xOff, LT, xOff+mwT, LT+lgH, '하부거더', 'buoy-girder');
                    const colBot = LT+lgH, colTop = LT+H-ugH;
                    if (colTop > colBot) addRectDashed(xOff, colBot, xOff+mwT, colTop, `기둥${i+1}`, 'buoy-girder');
                }
                xOff += mwT;
            }
        }

        addRect(totalWidth-WR, LT, totalWidth, LT+H, '우측벽', 'buoy-rect');

        // 헌치
        const luW = (leftHaunch.upper&&leftHaunch.upper.width)||0, luH_v = (leftHaunch.upper&&leftHaunch.upper.height)||0;
        if (luW > 0 && luH_v > 0) addTri([WL,LT+H],[WL+luW,LT+H],[WL,LT+H-luH_v], 'buoy-tri', true);
        const llW = (leftHaunch.lower&&leftHaunch.lower.width)||0, llH_v = (leftHaunch.lower&&leftHaunch.lower.height)||0;
        if (llW > 0 && llH_v > 0) addTri([WL,LT],[WL+llW,LT],[WL,LT+llH_v], 'buoy-tri', true);

        xOff = WL;
        for (let i = 0; i < culvertCount; i++) {
            xOff += B_list[i];
            if (i < middleWalls.length) {
                const mwT = middleWalls[i].thickness || 600; const mwH = middleHaunches[i] || {};
                const muW = (mwH.upper&&mwH.upper.width)||0, muH = (mwH.upper&&mwH.upper.height)||0;
                if (muW > 0 && muH > 0) {
                    addTri([xOff,LT+H],[xOff-muW,LT+H],[xOff,LT+H-muH], 'buoy-tri', true);
                    const curNo = shapeNo;
                    addTri([xOff+mwT,LT+H],[xOff+mwT+muW,LT+H],[xOff+mwT,LT+H-muH], 'buoy-tri', false);
                    const cx2 = (xOff+mwT+xOff+mwT+muW+xOff+mwT)/3, cy2 = (LT+H+LT+H+LT+H-muH)/3;
                    mainGroup.appendChild(this._buoyText(cx2, cy2, `No.${curNo}`, Math.min(textH(muW,muH),130), 'buoy-num-text'));
                }
                const mlW = (mwH.lower&&mwH.lower.width)||0, mlH = (mwH.lower&&mwH.lower.height)||0;
                if (mlW > 0 && mlH > 0) {
                    addTri([xOff,LT],[xOff-mlW,LT],[xOff,LT+mlH], 'buoy-tri', true);
                    const curNo = shapeNo;
                    addTri([xOff+mwT,LT],[xOff+mwT+mlW,LT],[xOff+mwT,LT+mlH], 'buoy-tri', false);
                    const cx2 = (xOff+mwT+xOff+mwT+mlW+xOff+mwT)/3, cy2 = (LT+LT+LT+mlH)/3;
                    mainGroup.appendChild(this._buoyText(cx2, cy2, `No.${curNo}`, Math.min(textH(mlW,mlH),130), 'buoy-num-text'));
                }
                xOff += mwT;
            }
        }

        const rwLeft = totalWidth - WR;
        const ruW = (rightHaunch.upper&&rightHaunch.upper.width)||0, ruH_v = (rightHaunch.upper&&rightHaunch.upper.height)||0;
        if (ruW > 0 && ruH_v > 0) addTri([rwLeft,LT+H],[rwLeft-ruW,LT+H],[rwLeft,LT+H-ruH_v], 'buoy-tri', true);
        const rlW = (rightHaunch.lower&&rightHaunch.lower.width)||0, rlH_v = (rightHaunch.lower&&rightHaunch.lower.height)||0;
        if (rlW > 0 && rlH_v > 0) addTri([rwLeft,LT],[rwLeft-rlW,LT],[rwLeft,LT+rlH_v], 'buoy-tri', true);

        if (afUse && afT > 0) addRect(-afLeft, -afT, totalWidth+afRight, 0, '부상방지저판', 'buoy-af');

        this.svg.appendChild(mainGroup);
        const pad = 500;
        const minX = (afUse ? -afLeft : 0) - pad;
        const vW = totalWidth + (afUse ? afLeft+afRight : 0) + pad*2;
        const vH = totalHeight + (afUse ? afT : 0) + pad*2;
        this.svg.setAttribute('viewBox', `${minX} ${-totalHeight - pad} ${vW} ${vH}`);
        mainGroup.setAttribute('transform', 'scale(1, -1)');
    }

    // 부력 도형용 텍스트 (Y 반전 보정)
    _buoyText(x, y, text, fontSize, cls) {
        const textEl = document.createElementNS(SVG_NS, 'text');
        textEl.setAttribute('x', x);
        textEl.setAttribute('y', y);
        textEl.setAttribute('class', cls);
        textEl.setAttribute('font-size', fontSize);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('transform', `scale(1, -1) translate(0, ${-2 * y})`);
        textEl.textContent = text;
        return textEl;
    }
}

// 싱글톤 인스턴스 생성 함수
let rendererInstance = null;

export function initRenderer(svgElement) {
    rendererInstance = new SvgRenderer(svgElement);
    return rendererInstance;
}

export function getRenderer() {
    return rendererInstance;
}

export default { SvgRenderer, initRenderer, getRenderer };
