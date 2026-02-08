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
        this.drawOuterProfile(mainGroup, dims);

        // 내부 공간 그리기
        this.drawInnerCompartments(mainGroup, culvertData, dims);

        // 치수선 그리기
        this.drawDimensions(mainGroup, culvertData, dims);

        this.svg.appendChild(mainGroup);

        // 뷰박스 설정
        this.setViewBox(dims);
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
    setViewBox(dims) {
        const minX = -PADDING;
        const minY = -PADDING;
        const width = dims.totalWidth + PADDING * 2;
        const height = dims.totalHeight + PADDING * 2;

        // Y축 반전을 위해 transform 사용
        this.svg.setAttribute('viewBox', `${minX} ${-dims.totalHeight - PADDING} ${width} ${height}`);
        this.viewBox = { x: minX, y: minY, width, height };

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
    drawOuterProfile(parent, dims) {
        const points = [
            [0, 0],
            [dims.totalWidth, 0],
            [dims.totalWidth, dims.totalHeight],
            [0, dims.totalHeight],
            [0, 0]
        ];

        const polyline = this.createPolyline(points, 'outer-line');
        parent.appendChild(polyline);
    }

    // 내부 공간 그리기
    drawInnerCompartments(parent, data, dims) {
        let xOffset = data.WL;

        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            const points = [
                [xOffset, dims.LT],
                [xOffset + B, dims.LT],
                [xOffset + B, dims.LT + dims.H],
                [xOffset, dims.LT + dims.H],
                [xOffset, dims.LT]
            ];

            const polyline = this.createPolyline(points, 'inner-line');
            parent.appendChild(polyline);

            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
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

    // 치수선 그리기
    drawDimensions(parent, data, dims) {
        const dimGroup = this.createGroup('dimensions');

        // 1. 전체 폭 (하단, 바깥 tier)
        this.drawHorizontalDimension(
            dimGroup, 0, dims.totalWidth, 0,
            -DIM_OFFSET_FAR, dims.totalWidth.toString()
        );

        // 2. 전체 높이 (우측)
        this.drawVerticalDimension(
            dimGroup, dims.totalWidth, 0, dims.totalHeight,
            DIM_OFFSET, dims.totalHeight.toString()
        );

        // 3. 내공 높이 H (좌측)
        this.drawVerticalDimension(
            dimGroup, 0, dims.LT, dims.LT + dims.H,
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
            dimGroup, 0, dims.LT + dims.H, dims.totalHeight,
            -DIM_OFFSET, dims.UT.toString()
        );

        // 6. 하부 슬래브 LT (좌측, H와 동일 tier)
        this.drawVerticalDimension(
            dimGroup, 0, 0, dims.LT,
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
        const textY = dimY + (offset > 0 ? 150 : -100);
        const textEl = this.createText(textX, textY, text, offset < 0);
        parent.appendChild(textEl);
    }

    // 수직 치수선
    drawVerticalDimension(parent, x, y1, y2, offset, text) {
        const dimX = x + offset;
        const sign = offset > 0 ? 1 : -1;
        const extStart = x + sign * EXT_LINE_GAP;

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
        const textX = dimX + (offset > 0 ? 150 : -100);
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
