// ESC Culvert Web App - Bundled JavaScript
// 모든 모듈을 하나의 파일로 통합

(function() {
    'use strict';

    // ========================================
    // STATE - 상태 관리
    // ========================================
    const defaultState = {
        currentMenu: '프로젝트 정보',
        projectInfo: {
            businessName: '',
            client: '',
            constructor: '',
            siteName: ''
        },
        designConditions: {
            standard: '콘크리트구조기준',
            designLife: '100년',
            environment: '건조 환경'
        },
        materials: {
            fck: 30.0,
            fy: 400.0
        },
        sectionData: {
            culvert_count: 3,
            H: 4200,
            H4: 0,
            B: [4000, 4000, 4000],
            UT: 600,
            LT: 800,
            WL: 600,
            WR: 600,
            middle_walls: [
                { type: '연속벽', thickness: 600 },
                { type: '연속벽', thickness: 600 }
            ],
            haunch: {
                leftWall:  { upper: { width: 150, height: 150 }, lower: { width: 150, height: 150 } },
                middleWalls: [
                    { upper: { width: 150, height: 150 }, lower: { width: 150, height: 150 } },
                    { upper: { width: 150, height: 150 }, lower: { width: 150, height: 150 } }
                ],
                rightWall: { upper: { width: 150, height: 150 }, lower: { width: 150, height: 150 } }
            },
            antiFloat: {
                use: false,
                leftExtension: 500,
                rightExtension: 500,
                thickness: 300
            }
        }
    };

    let appState = JSON.parse(JSON.stringify(defaultState));
    const listeners = {
        menuChange: [],
        sectionDataChange: [],
        stateChange: []
    };

    const state = {
        get() { return appState; },
        set(newState) {
            appState = { ...appState, ...newState };
            this.emit('stateChange', appState);
        },
        setCurrentMenu(menu) {
            appState.currentMenu = menu;
            this.emit('menuChange', menu);
        },
        getCurrentMenu() { return appState.currentMenu; },
        updateProjectInfo(key, value) {
            appState.projectInfo[key] = value;
            this.emit('stateChange', appState);
        },
        getProjectInfo() { return appState.projectInfo; },
        updateDesignConditions(key, value) {
            appState.designConditions[key] = value;
            this.emit('stateChange', appState);
        },
        getDesignConditions() { return appState.designConditions; },
        updateMaterials(key, value) {
            appState.materials[key] = value;
            this.emit('stateChange', appState);
        },
        getMaterials() { return appState.materials; },
        updateSectionData(key, value) {
            appState.sectionData[key] = value;
            this.emit('sectionDataChange', appState.sectionData);
        },
        setSectionData(data) {
            appState.sectionData = { ...appState.sectionData, ...data };
            this.emit('sectionDataChange', appState.sectionData);
        },
        getSectionData() { return appState.sectionData; },
        setCulvertCount(count) {
            count = Math.max(1, Math.min(10, count));
            const newB = [...appState.sectionData.B];
            while (newB.length < count) newB.push(4000);
            newB.length = count;

            const newMiddleWalls = [...appState.sectionData.middle_walls];
            const middleWallCount = count - 1;
            while (newMiddleWalls.length < middleWallCount) {
                newMiddleWalls.push({ type: '연속벽', thickness: 600 });
            }
            newMiddleWalls.length = middleWallCount;

            // 헌치 중간벽 배열 동기화
            const haunch = appState.sectionData.haunch || {};
            const haunchMW = haunch.middleWalls ? [...haunch.middleWalls] : [];
            while (haunchMW.length < middleWallCount) {
                haunchMW.push({ upper: { width: 150, height: 150 }, lower: { width: 150, height: 150 } });
            }
            haunchMW.length = middleWallCount;
            if (!appState.sectionData.haunch) appState.sectionData.haunch = {};
            appState.sectionData.haunch.middleWalls = haunchMW;

            appState.sectionData.culvert_count = count;
            appState.sectionData.B = newB;
            appState.sectionData.middle_walls = newMiddleWalls;
            this.emit('sectionDataChange', appState.sectionData);
        },
        reset() {
            appState = JSON.parse(JSON.stringify(defaultState));
            this.emit('stateChange', appState);
            this.emit('sectionDataChange', appState.sectionData);
            this.emit('menuChange', appState.currentMenu);
        },
        on(event, callback) {
            if (listeners[event]) listeners[event].push(callback);
        },
        off(event, callback) {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(cb => cb !== callback);
            }
        },
        emit(event, data) {
            if (listeners[event]) {
                listeners[event].forEach(callback => callback(data));
            }
        },
        toJSON() { return JSON.stringify(appState, null, 2); },
        fromJSON(json) {
            try {
                const data = JSON.parse(json);
                appState = { ...defaultState, ...data };
                this.emit('stateChange', appState);
                this.emit('sectionDataChange', appState.sectionData);
                this.emit('menuChange', appState.currentMenu);
                return true;
            } catch (e) {
                console.error('Failed to parse state JSON:', e);
                return false;
            }
        }
    };

    // ========================================
    // STORAGE - LocalStorage 관리
    // ========================================
    const STORAGE_KEY = 'esc_culvert_project';
    const storage = {
        save(data) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                return true;
            } catch (e) { return false; }
        },
        load() {
            try {
                const json = localStorage.getItem(STORAGE_KEY);
                return json ? JSON.parse(json) : null;
            } catch (e) { return null; }
        },
        clear() {
            try {
                localStorage.removeItem(STORAGE_KEY);
                return true;
            } catch (e) { return false; }
        },
        exportToFile(data, filename = 'esc_culvert_project.json') {
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
        importFromFile() {
            return new Promise((resolve, reject) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (!file) { reject(new Error('No file')); return; }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        try { resolve(JSON.parse(ev.target.result)); }
                        catch (err) { reject(err); }
                    };
                    reader.onerror = () => reject(new Error('Read error'));
                    reader.readAsText(file);
                };
                input.click();
            });
        }
    };

    // ========================================
    // TREE - 트리 네비게이션
    // ========================================
    const treeData = [
        { label: '프로젝트 정보', children: null },
        { label: '설계조건', children: [
            { label: '기본환경' },
            { label: '재료특성' },
            { label: '기타환경' }
        ]},
        { label: '단면입력', children: [
            { label: '단면제원' },
            { label: '분점 정의' },
            { label: '하중 정의' }
        ]},
        { label: '하중입력', children: null },
        { label: '배근 입력', children: [
            { label: '휨철근' },
            { label: '전단철근' }
        ]},
        { label: '출력', children: null }
    ];

    function renderTree(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        treeData.forEach(item => container.appendChild(createTreeItem(item, 0)));
        selectTreeItem(state.getCurrentMenu());
    }

    function createTreeItem(item, level) {
        const li = document.createElement('li');
        li.className = 'tree-item';
        li.dataset.level = level;
        li.dataset.label = item.label;

        const content = document.createElement('div');
        content.className = 'tree-item-content';

        const toggle = document.createElement('span');
        toggle.className = 'tree-toggle';
        if (item.children && item.children.length > 0) {
            toggle.innerHTML = '▶';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleExpand(li);
            });
        } else {
            toggle.className += ' hidden';
        }

        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = item.label;

        content.appendChild(toggle);
        content.appendChild(label);
        content.addEventListener('click', () => handleTreeItemClick(item, li));
        li.appendChild(content);

        if (item.children && item.children.length > 0) {
            const ul = document.createElement('ul');
            ul.className = 'tree-children';
            item.children.forEach(child => ul.appendChild(createTreeItem(child, level + 1)));
            li.appendChild(ul);
        }
        return li;
    }

    function toggleExpand(li) {
        const toggle = li.querySelector('.tree-toggle');
        const children = li.querySelector('.tree-children');
        if (children) {
            const isExpanded = children.classList.contains('expanded');
            children.classList.toggle('expanded', !isExpanded);
            toggle.classList.toggle('expanded', !isExpanded);
        }
    }

    function handleTreeItemClick(item, li) {
        if (item.children && item.children.length > 0) {
            const children = li.querySelector('.tree-children');
            const toggle = li.querySelector('.tree-toggle');
            if (children && !children.classList.contains('expanded')) {
                children.classList.add('expanded');
                toggle.classList.add('expanded');
            }
            selectTreeItem(item.children[0].label);
        } else {
            selectTreeItem(item.label);
        }
    }

    function selectTreeItem(label) {
        document.querySelectorAll('.tree-item-content.selected').forEach(el => el.classList.remove('selected'));
        document.querySelectorAll('.tree-item').forEach(item => {
            if (item.dataset.label === label) {
                item.querySelector('.tree-item-content').classList.add('selected');
                let parent = item.parentElement;
                while (parent) {
                    if (parent.classList && parent.classList.contains('tree-children')) {
                        parent.classList.add('expanded');
                        const parentToggle = parent.parentElement.querySelector('.tree-toggle');
                        if (parentToggle) parentToggle.classList.add('expanded');
                    }
                    parent = parent.parentElement;
                }
            }
        });
        state.setCurrentMenu(label);
    }

    // ========================================
    // SVG RENDERER - SVG 생성
    // ========================================
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const DIM_OFFSET = 1000;
    const DIM_OFFSET_FAR = 1500;
    const ARROW_SIZE = 100;
    const EXT_LINE_GAP = 500;
    const PADDING = 1500;

    let svgRenderer = null;

    class SvgRenderer {
        constructor(svgElement) {
            this.svg = svgElement;
        }

        render(culvertData) {
            this.svg.innerHTML = '';
            if (!culvertData) culvertData = state.getSectionData();
            if (!this.validateData(culvertData)) {
                this.renderPlaceholder();
                return;
            }

            const dims = this.calculateDimensions(culvertData);
            const mainGroup = this.createGroup('main-group');

            this.drawOuterProfile(mainGroup, culvertData, dims);
            this.drawAntiFloatSlab(mainGroup, culvertData, dims);
            this.drawInnerCompartments(mainGroup, culvertData, dims);
            this.drawHaunches(mainGroup, culvertData, dims);
            this.drawDimensions(mainGroup, culvertData, dims);

            this.svg.appendChild(mainGroup);
            this.setViewBox(culvertData, dims);
        }

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

        renderPlaceholder() {
            const text = document.createElementNS(SVG_NS, 'text');
            text.setAttribute('x', '50%');
            text.setAttribute('y', '50%');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('fill', '#999');
            text.setAttribute('font-size', '14');
            text.textContent = '단면제원 데이터를 입력하세요';
            this.svg.appendChild(text);
            this.svg.setAttribute('viewBox', '0 0 400 200');
        }

        calculateDimensions(data) {
            const totalInnerWidth = data.B.reduce((a, b) => a + b, 0);
            const totalMiddleWallThickness = data.middle_walls
                ? data.middle_walls.reduce((s, w) => s + w.thickness, 0) : 0;
            const totalWidth = data.WL + totalInnerWidth + totalMiddleWallThickness + data.WR;
            const totalHeight = data.LT + data.H + data.UT;
            return { totalWidth, totalHeight, totalInnerWidth, totalMiddleWallThickness,
                     H: data.H, LT: data.LT, UT: data.UT, WL: data.WL, WR: data.WR };
        }

        setViewBox(data, dims) {
            const af = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
            const extL = af ? (af.leftExtension || 0) : 0;
            const extR = af ? (af.rightExtension || 0) : 0;
            const minX = -extL - PADDING;
            const width = dims.totalWidth + extL + extR + PADDING * 2;
            const height = dims.totalHeight + PADDING * 2;
            this.svg.setAttribute('viewBox', `${minX} ${-dims.totalHeight - PADDING} ${width} ${height}`);
            const mainGroup = this.svg.querySelector('.main-group');
            if (mainGroup) mainGroup.setAttribute('transform', 'scale(1, -1)');
        }

        createGroup(className) {
            const g = document.createElementNS(SVG_NS, 'g');
            g.setAttribute('class', className);
            return g;
        }

        drawOuterProfile(parent, data, dims) {
            const af = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
            const t = af ? (af.thickness || 0) : 0;

            if (af && t > 0) {
                // 부상방지저판이 있는 경우: 벽체 하단을 저판 상단(y=t)으로
                const points = [[0, t], [0, dims.totalHeight], [dims.totalWidth, dims.totalHeight],
                               [dims.totalWidth, t]];
                parent.appendChild(this.createPolyline(points, 'outer-line'));
                // 하부 바닥선
                parent.appendChild(this.createLine(0, 0, dims.totalWidth, 0, 'outer-line'));
            } else {
                const points = [[0, 0], [dims.totalWidth, 0], [dims.totalWidth, dims.totalHeight],
                               [0, dims.totalHeight], [0, 0]];
                parent.appendChild(this.createPolyline(points, 'outer-line'));
            }
        }

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

        getCompartmentHaunches(data, i) {
            const h = getHaunchData(data);
            const last = data.culvert_count - 1;
            const leftWall  = (i === 0)    ? h.leftWall  : h.middleWalls[i - 1];
            const rightWall = (i === last)  ? h.rightWall : h.middleWalls[i];
            return {
                ul: leftWall  ? leftWall.upper  : { width: 0, height: 0 },
                ll: leftWall  ? leftWall.lower  : { width: 0, height: 0 },
                ur: rightWall ? rightWall.upper : { width: 0, height: 0 },
                lr: rightWall ? rightWall.lower : { width: 0, height: 0 }
            };
        }

        drawInnerCompartments(parent, data, dims) {
            let xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                const B = data.B[i];
                const left = xOffset, right = xOffset + B;
                const bottom = dims.LT, top = dims.LT + dims.H;
                const { ul, ur, ll, lr } = this.getCompartmentHaunches(data, i);
                parent.appendChild(this.createLine(left + ll.width, bottom, right - lr.width, bottom, 'inner-line'));
                parent.appendChild(this.createLine(right, bottom + lr.height, right, top - ur.height, 'inner-line'));
                parent.appendChild(this.createLine(right - ur.width, top, left + ul.width, top, 'inner-line'));
                parent.appendChild(this.createLine(left, top - ul.height, left, bottom + ll.height, 'inner-line'));
                xOffset += B;
                if (i < data.middle_walls.length) xOffset += data.middle_walls[i].thickness;
            }
        }

        drawHaunches(parent, data, dims) {
            let xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                const B = data.B[i];
                const left = xOffset, right = xOffset + B;
                const bottom = dims.LT, top = dims.LT + dims.H;
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
                if (i < data.middle_walls.length) xOffset += data.middle_walls[i].thickness;
            }
        }

        createPolyline(points, className) {
            const polyline = document.createElementNS(SVG_NS, 'polyline');
            polyline.setAttribute('points', points.map(p => `${p[0]},${p[1]}`).join(' '));
            polyline.setAttribute('class', className);
            return polyline;
        }

        drawDimensions(parent, data, dims) {
            const dimGroup = this.createGroup('dimensions');

            // 부상방지저판 유무에 따른 수직치수선 원점
            const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
            const leftX = afData ? -(afData.leftExtension || 0) : 0;
            const rightX = afData ? dims.totalWidth + (afData.rightExtension || 0) : dims.totalWidth;

            // 전체 폭/높이
            this.drawHorizontalDimension(dimGroup, 0, dims.totalWidth, 0, -DIM_OFFSET, dims.totalWidth.toString());
            this.drawVerticalDimension(dimGroup, rightX, 0, dims.totalHeight, DIM_OFFSET, dims.totalHeight.toString());
            this.drawVerticalDimension(dimGroup, leftX, dims.LT, dims.LT + dims.H, -DIM_OFFSET, dims.H.toString());

            // 각 내공 폭
            let xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                const B = data.B[i];
                this.drawHorizontalDimension(dimGroup, xOffset, xOffset + B, dims.totalHeight, DIM_OFFSET, B.toString());
                xOffset += B;
                if (i < data.middle_walls.length) xOffset += data.middle_walls[i].thickness;
            }

            // 슬래브, 벽체
            this.drawVerticalDimension(dimGroup, leftX, dims.LT + dims.H, dims.totalHeight, -DIM_OFFSET, dims.UT.toString());
            this.drawVerticalDimension(dimGroup, leftX, 0, dims.LT, -DIM_OFFSET, dims.LT.toString());
            this.drawHorizontalDimension(dimGroup, 0, dims.WL, dims.totalHeight, DIM_OFFSET, dims.WL.toString());
            this.drawHorizontalDimension(dimGroup, dims.totalWidth - dims.WR, dims.totalWidth, dims.totalHeight, DIM_OFFSET, dims.WR.toString());

            // 중간벽 치수
            if (data.middle_walls && data.middle_walls.length > 0) {
                xOffset = data.WL;
                for (let i = 0; i < data.culvert_count; i++) {
                    xOffset += data.B[i];
                    if (i < data.middle_walls.length) {
                        const wt = data.middle_walls[i].thickness;
                        this.drawHorizontalDimension(dimGroup, xOffset, xOffset + wt, dims.totalHeight, DIM_OFFSET, wt.toString());
                        xOffset += wt;
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

            parent.appendChild(dimGroup);
        }

        drawHorizontalDimension(parent, x1, x2, y, offset, text) {
            const dimY = y + offset;
            const sign = offset > 0 ? 1 : -1;
            const extStart = y + sign * EXT_LINE_GAP;
            parent.appendChild(this.createLine(x1, extStart, x1, dimY, 'extension-line'));
            parent.appendChild(this.createLine(x2, extStart, x2, dimY, 'extension-line'));
            parent.appendChild(this.createLine(x1, dimY, x2, dimY, 'dimension-line'));
            this.drawArrow(parent, x1, dimY, 'right');
            this.drawArrow(parent, x2, dimY, 'left');
            parent.appendChild(this.createText((x1 + x2) / 2, dimY + 300, text, offset < 0));
        }

        drawVerticalDimension(parent, x, y1, y2, offset, text) {
            const dimX = x + offset;
            const sign = offset > 0 ? 1 : -1;
            const extStart = x + sign * EXT_LINE_GAP;
            parent.appendChild(this.createLine(extStart, y1, dimX, y1, 'extension-line'));
            parent.appendChild(this.createLine(extStart, y2, dimX, y2, 'extension-line'));
            parent.appendChild(this.createLine(dimX, y1, dimX, y2, 'dimension-line'));
            this.drawArrow(parent, dimX, y1, 'up');
            this.drawArrow(parent, dimX, y2, 'down');
            parent.appendChild(this.createText(dimX - 300, (y1 + y2) / 2, text, false, true));
        }

        createLine(x1, y1, x2, y2, className) {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', x1);
            line.setAttribute('y1', y1);
            line.setAttribute('x2', x2);
            line.setAttribute('y2', y2);
            line.setAttribute('class', className);
            return line;
        }

        drawArrow(parent, x, y, direction) {
            const size = ARROW_SIZE;
            let points;
            switch (direction) {
                case 'right': points = `${x},${y} ${x + size},${y - size / 3} ${x + size},${y + size / 3}`; break;
                case 'left': points = `${x},${y} ${x - size},${y - size / 3} ${x - size},${y + size / 3}`; break;
                case 'up': points = `${x},${y} ${x - size / 3},${y + size} ${x + size / 3},${y + size}`; break;
                case 'down': points = `${x},${y} ${x - size / 3},${y - size} ${x + size / 3},${y - size}`; break;
            }
            const polygon = document.createElementNS(SVG_NS, 'polygon');
            polygon.setAttribute('points', points);
            polygon.setAttribute('class', 'dimension-arrow');
            parent.appendChild(polygon);
        }

        createText(x, y, text, flipY = false, vertical = false) {
            const textEl = document.createElementNS(SVG_NS, 'text');
            textEl.setAttribute('x', x);
            textEl.setAttribute('y', y);
            textEl.setAttribute('class', 'dimension-text');
            textEl.setAttribute('font-size', '250');
            let transform = `scale(1, -1) translate(0, ${-2 * y})`;
            if (vertical) transform += ` rotate(-90, ${x}, ${y})`;
            textEl.setAttribute('transform', transform);
            textEl.textContent = text;
            return textEl;
        }
    }

    function initRenderer(svgElement) {
        svgRenderer = new SvgRenderer(svgElement);
        return svgRenderer;
    }

    function getRenderer() { return svgRenderer; }

    // ========================================
    // ZOOM/PAN - 줌/팬 기능
    // ========================================
    let zoomPanController = null;

    class ZoomPanController {
        constructor(svgElement, containerElement) {
            this.svg = svgElement;
            this.container = containerElement;
            this.scale = 1;
            this.minScale = 0.1;
            this.maxScale = 10;
            this.zoomFactor = 1.15;
            this.viewBox = { x: 0, y: 0, width: 0, height: 0 };
            this.originalViewBox = null;
            this.isPanning = false;
            this.startPoint = { x: 0, y: 0 };
            this.startViewBox = { x: 0, y: 0 };
            this.zoomIndicator = document.getElementById('zoom-level');

            this.handleWheel = this.handleWheel.bind(this);
            this.handleMouseDown = this.handleMouseDown.bind(this);
            this.handleMouseMove = this.handleMouseMove.bind(this);
            this.handleMouseUp = this.handleMouseUp.bind(this);
            this.handleMouseLeave = this.handleMouseLeave.bind(this);
            this.init();
        }

        init() {
            this.container.addEventListener('wheel', this.handleWheel, { passive: false });
            this.container.addEventListener('mousedown', this.handleMouseDown);
            this.container.addEventListener('mousemove', this.handleMouseMove);
            this.container.addEventListener('mouseup', this.handleMouseUp);
            this.container.addEventListener('mouseleave', this.handleMouseLeave);
            this.saveOriginalViewBox();
        }

        saveOriginalViewBox() {
            const vb = this.svg.getAttribute('viewBox');
            if (vb) {
                const parts = vb.split(' ').map(Number);
                this.viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
                this.originalViewBox = { ...this.viewBox };
            }
        }

        updateViewBox() {
            this.svg.setAttribute('viewBox', `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
        }

        updateZoomIndicator() {
            if (this.zoomIndicator) this.zoomIndicator.textContent = `${Math.round(this.scale * 100)}%`;
        }

        handleWheel(e) {
            e.preventDefault();
            this.saveOriginalViewBox();
            if (!this.originalViewBox) return;

            const rect = this.container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const svgPoint = this.screenToSvg(mouseX, mouseY);

            const delta = e.deltaY > 0 ? 1 / this.zoomFactor : this.zoomFactor;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * delta));
            if (newScale === this.scale) return;

            const scaleRatio = this.scale / newScale;
            this.scale = newScale;

            const dx = (svgPoint.x - this.viewBox.x) * (1 - scaleRatio);
            const dy = (svgPoint.y - this.viewBox.y) * (1 - scaleRatio);

            this.viewBox.x += dx;
            this.viewBox.y += dy;
            this.viewBox.width *= scaleRatio;
            this.viewBox.height *= scaleRatio;

            this.updateViewBox();
            this.updateZoomIndicator();
        }

        screenToSvg(screenX, screenY) {
            const rect = this.container.getBoundingClientRect();
            return {
                x: this.viewBox.x + screenX * this.viewBox.width / rect.width,
                y: this.viewBox.y + screenY * this.viewBox.height / rect.height
            };
        }

        handleMouseDown(e) {
            if (e.button !== 0) return;
            this.isPanning = true;
            this.startPoint = { x: e.clientX, y: e.clientY };
            this.startViewBox = { x: this.viewBox.x, y: this.viewBox.y };
            this.container.style.cursor = 'grabbing';
        }

        handleMouseMove(e) {
            if (!this.isPanning) return;
            const rect = this.container.getBoundingClientRect();
            const ratioX = this.viewBox.width / rect.width;
            const ratioY = this.viewBox.height / rect.height;
            this.viewBox.x = this.startViewBox.x - (e.clientX - this.startPoint.x) * ratioX;
            this.viewBox.y = this.startViewBox.y - (e.clientY - this.startPoint.y) * ratioY;
            this.updateViewBox();
        }

        handleMouseUp() {
            this.isPanning = false;
            this.container.style.cursor = 'grab';
        }

        handleMouseLeave() {
            this.isPanning = false;
            this.container.style.cursor = 'grab';
        }

        zoomIn() {
            this.saveOriginalViewBox();
            const newScale = Math.min(this.maxScale, this.scale * this.zoomFactor);
            const scaleRatio = this.scale / newScale;
            this.scale = newScale;
            const cx = this.viewBox.x + this.viewBox.width / 2;
            const cy = this.viewBox.y + this.viewBox.height / 2;
            this.viewBox.width *= scaleRatio;
            this.viewBox.height *= scaleRatio;
            this.viewBox.x = cx - this.viewBox.width / 2;
            this.viewBox.y = cy - this.viewBox.height / 2;
            this.updateViewBox();
            this.updateZoomIndicator();
        }

        zoomOut() {
            this.saveOriginalViewBox();
            const newScale = Math.max(this.minScale, this.scale / this.zoomFactor);
            const scaleRatio = this.scale / newScale;
            this.scale = newScale;
            const cx = this.viewBox.x + this.viewBox.width / 2;
            const cy = this.viewBox.y + this.viewBox.height / 2;
            this.viewBox.width *= scaleRatio;
            this.viewBox.height *= scaleRatio;
            this.viewBox.x = cx - this.viewBox.width / 2;
            this.viewBox.y = cy - this.viewBox.height / 2;
            this.updateViewBox();
            this.updateZoomIndicator();
        }

        fitToView() {
            if (this.originalViewBox) {
                this.viewBox = { ...this.originalViewBox };
                this.scale = 1;
                this.updateViewBox();
                this.updateZoomIndicator();
            }
        }

        reset() {
            this.scale = 1;
            this.saveOriginalViewBox();
            this.updateZoomIndicator();
        }
    }

    function initZoomPan(svgElement, containerElement) {
        zoomPanController = new ZoomPanController(svgElement, containerElement);
        return zoomPanController;
    }

    function getZoomPan() { return zoomPanController; }

    // ========================================
    // FORMS - 폼 렌더링
    // ========================================

    // 프로젝트 정보 폼
    function renderProjectInfoForm(container) {
        const data = state.getProjectInfo();
        container.innerHTML = `
            <div class="form-grid">
                <label class="form-label">사업명</label>
                <input type="text" class="form-input" id="input-businessName" value="${data.businessName || ''}" placeholder="사업명을 입력하세요">
                <label class="form-label">발주처</label>
                <input type="text" class="form-input" id="input-client" value="${data.client || ''}" placeholder="발주처를 입력하세요">
                <label class="form-label">시공사</label>
                <input type="text" class="form-input" id="input-constructor" value="${data.constructor || ''}" placeholder="시공사를 입력하세요">
                <label class="form-label">현장명</label>
                <input type="text" class="form-input" id="input-siteName" value="${data.siteName || ''}" placeholder="현장명을 입력하세요">
            </div>
        `;
        ['businessName', 'client', 'constructor', 'siteName'].forEach(field => {
            const input = document.getElementById(`input-${field}`);
            if (input) {
                input.addEventListener('change', (e) => state.updateProjectInfo(field, e.target.value));
                input.addEventListener('input', (e) => state.updateProjectInfo(field, e.target.value));
            }
        });
    }

    // 기본환경 폼
    function renderBasicEnvironmentForm(container) {
        const data = state.getDesignConditions();
        const standards = ['콘크리트구조기준', '도로교설계기준(강도설계법)', '도로교설계기준(한계상태설계법)'];
        const envs = ['건조 환경', '습윤 환경', '부식성 환경', '고부식성 환경'];

        container.innerHTML = `
            <div class="form-grid">
                <label class="form-label">설계기준</label>
                <select class="form-select" id="select-standard">
                    ${standards.map(s => `<option value="${s}" ${data.standard === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <label class="form-label">설계수명</label>
                <div class="input-with-unit">
                    <input type="text" class="form-input" id="input-designLife" value="${data.designLife || '100년'}" style="width: 100px;">
                </div>
                <label class="form-label">환경조건</label>
                <select class="form-select" id="select-environment">
                    ${envs.map(e => `<option value="${e}" ${data.environment === e ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
            </div>
        `;
        document.getElementById('select-standard').addEventListener('change', (e) => state.updateDesignConditions('standard', e.target.value));
        document.getElementById('input-designLife').addEventListener('change', (e) => state.updateDesignConditions('designLife', e.target.value));
        document.getElementById('select-environment').addEventListener('change', (e) => state.updateDesignConditions('environment', e.target.value));
    }

    // 재료특성 폼
    function renderMaterialsForm(container) {
        const data = state.getMaterials();
        container.innerHTML = `
            <div class="form-grid">
                <label class="form-label">콘크리트 강도 (fck)</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-fck" value="${data.fck}" min="0" max="1000" step="0.1" style="width: 100px;">
                    <span class="input-unit">MPa</span>
                </div>
                <label class="form-label">철근 항복강도 (fy)</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-fy" value="${data.fy}" min="0" max="1000" step="0.1" style="width: 100px;">
                    <span class="input-unit">MPa</span>
                </div>
            </div>
            <div class="form-section">
                <div class="form-section-title">참고</div>
                <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.6;">
                    <p>• 콘크리트 강도 (fck): 일반적으로 24~40 MPa 사용</p>
                    <p>• 철근 항복강도 (fy): SD400 = 400 MPa, SD500 = 500 MPa</p>
                </div>
            </div>
        `;
        document.getElementById('input-fck').addEventListener('change', (e) => state.updateMaterials('fck', parseFloat(e.target.value) || 30.0));
        document.getElementById('input-fy').addEventListener('change', (e) => state.updateMaterials('fy', parseFloat(e.target.value) || 400.0));
    }

    // 단면제원 폼
    const WALL_TYPES = ['연속벽', '기둥'];

    let currentSectionTab = 'section';

    function renderSectionPropertiesForm(container) {
        const data = state.getSectionData();
        container.innerHTML = `
            <div class="culvert-count-control">
                <label for="input-culvert-count">암거 련수:</label>
                <input type="number" class="form-input" id="input-culvert-count" value="${data.culvert_count}" min="1" max="10" step="1">
                <span class="input-unit">(1~10)</span>
            </div>
            <div class="section-tabs">
                <button class="section-tab ${currentSectionTab === 'section' ? 'active' : ''}" data-tab="section">단면제원</button>
                <button class="section-tab ${currentSectionTab === 'haunch' ? 'active' : ''}" data-tab="haunch">내부헌치</button>
                <button class="section-tab ${currentSectionTab === 'antifloat' ? 'active' : ''}" data-tab="antifloat">부상방지저판</button>
            </div>
            <div class="section-tab-content" id="section-tab-content"></div>
        `;

        document.getElementById('input-culvert-count').addEventListener('change', (e) => {
            const count = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
            e.target.value = count;
            state.setCulvertCount(count);
            renderSectionPropertiesForm(container);
            updateSvg();
        });

        document.querySelectorAll('.section-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentSectionTab = tab.dataset.tab;
                document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderSectionTabContent();
            });
        });

        renderSectionTabContent();
    }

    function renderSectionTabContent() {
        const contentEl = document.getElementById('section-tab-content');
        if (!contentEl) return;
        const data = state.getSectionData();

        switch (currentSectionTab) {
            case 'section':
                contentEl.innerHTML = `<div class="section-table-container">${createSectionTable(data)}</div>`;
                registerTableEvents();
                break;
            case 'haunch':
                contentEl.innerHTML = createHaunchForm(data);
                registerHaunchEvents();
                break;
            case 'antifloat':
                contentEl.innerHTML = createAntiFloatForm(data);
                registerAntiFloatEvents();
                break;
        }
    }

    function createSectionTable(data) {
        const cc = data.culvert_count;
        const mwc = cc - 1;
        const innerCols = 2 + cc;
        const slabCols = 2;
        const middleWallCols = mwc * 2;

        let header0 = '<tr>';
        header0 += `<th colspan="${innerCols}" class="cat-inner">내공제원</th>`;
        header0 += `<th colspan="${slabCols}" class="cat-slab">슬래브두께</th>`;
        header0 += `<th colspan="1" class="cat-wall-left">좌측벽</th>`;
        if (mwc > 0) header0 += `<th colspan="${middleWallCols}" class="cat-wall-middle">중간벽</th>`;
        header0 += `<th colspan="1" class="cat-wall-right">우측벽</th></tr>`;

        let header1 = '<tr><th>높이<br>H</th><th>H4</th>';
        for (let i = 0; i < cc; i++) header1 += `<th>폭<br>B${i + 1}</th>`;
        header1 += '<th>상부<br>UT</th><th>하부<br>LT</th><th>WL</th>';
        for (let i = 0; i < mwc; i++) header1 += `<th>벽체${i + 1}</th><th>두께${i + 1}</th>`;
        header1 += '<th>WR</th></tr>';

        let dataRow = '<tr>';
        dataRow += `<td><input type="number" id="input-H" value="${data.H}" data-field="H"></td>`;
        dataRow += `<td><input type="number" id="input-H4" value="${data.H4}" data-field="H4"></td>`;
        for (let i = 0; i < cc; i++) {
            const bv = data.B[i] !== undefined ? data.B[i] : 4000;
            dataRow += `<td><input type="number" id="input-B${i}" value="${bv}" data-field="B" data-index="${i}"></td>`;
        }
        dataRow += `<td><input type="number" id="input-UT" value="${data.UT}" data-field="UT"></td>`;
        dataRow += `<td><input type="number" id="input-LT" value="${data.LT}" data-field="LT"></td>`;
        dataRow += `<td><input type="number" id="input-WL" value="${data.WL}" data-field="WL"></td>`;

        for (let i = 0; i < mwc; i++) {
            const wall = data.middle_walls[i] || { type: '연속벽', thickness: 600 };
            const opts = WALL_TYPES.map(t => `<option value="${t}" ${wall.type === t ? 'selected' : ''}>${t}</option>`).join('');
            dataRow += `<td><select id="input-wallType${i}" data-field="wallType" data-index="${i}">${opts}</select></td>`;
            dataRow += `<td><input type="number" id="input-wallThickness${i}" value="${wall.thickness}" data-field="wallThickness" data-index="${i}"></td>`;
        }
        dataRow += `<td><input type="number" id="input-WR" value="${data.WR}" data-field="WR"></td></tr>`;

        return `<table class="section-table"><thead>${header0}${header1}</thead><tbody>${dataRow}</tbody></table>
                <div style="margin-top: 12px; color: var(--text-secondary); font-size: 11px;">* 모든 치수 단위: mm</div>`;
    }

    function registerTableEvents() {
        const table = document.querySelector('.section-table');
        if (!table) return;
        table.querySelectorAll('input, select').forEach(input => {
            input.addEventListener('change', handleSectionInputChange);
        });
    }

    function handleSectionInputChange(e) {
        const field = e.target.dataset.field;
        const index = parseInt(e.target.dataset.index);
        const value = e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
        const data = state.getSectionData();

        switch (field) {
            case 'H': state.updateSectionData('H', value); break;
            case 'H4': state.updateSectionData('H4', value); break;
            case 'B':
                const newB = [...data.B];
                newB[index] = value;
                state.updateSectionData('B', newB);
                break;
            case 'UT': state.updateSectionData('UT', value); break;
            case 'LT': state.updateSectionData('LT', value); break;
            case 'WL': state.updateSectionData('WL', value); break;
            case 'WR': state.updateSectionData('WR', value); break;
            case 'wallType':
                const mwt = [...data.middle_walls];
                if (mwt[index]) { mwt[index] = { ...mwt[index], type: value }; state.updateSectionData('middle_walls', mwt); }
                break;
            case 'wallThickness':
                const mwk = [...data.middle_walls];
                if (mwk[index]) { mwk[index] = { ...mwk[index], thickness: value }; state.updateSectionData('middle_walls', mwk); }
                break;
        }
        updateSvg();
    }

    function updateSvg() {
        const renderer = getRenderer();
        if (renderer) renderer.render(state.getSectionData());
    }

    // 내부헌치 기본값 헬퍼
    const DEFAULT_CORNER = { width: 150, height: 150 };

    function safeCorner(c) {
        if (!c) return { ...DEFAULT_CORNER };
        return { width: c.width || 150, height: c.height || 150 };
    }

    function getHaunchData(data) {
        const h = data.haunch || {};
        const lw = h.leftWall || {};
        const rw = h.rightWall || {};
        const mw = Array.isArray(h.middleWalls) ? h.middleWalls : [];
        const middleWallCount = (data.culvert_count || 1) - 1;
        const middleWalls = [];
        for (let i = 0; i < middleWallCount; i++) {
            const m = mw[i] || {};
            middleWalls.push({ upper: safeCorner(m.upper), lower: safeCorner(m.lower) });
        }
        return {
            leftWall:  { upper: safeCorner(lw.upper), lower: safeCorner(lw.lower) },
            middleWalls,
            rightWall: { upper: safeCorner(rw.upper), lower: safeCorner(rw.lower) }
        };
    }

    // 벽체 카드 HTML 생성
    function createWallCard(title, wallKey, wallData, index) {
        const idx = index !== undefined ? ` data-index="${index}"` : '';
        return `<div class="haunch-card">
            <div class="haunch-card-title">${title}</div>
            <table class="sub-section-table">
                <thead><tr><th></th><th>폭</th><th>높이</th></tr></thead>
                <tbody>
                    <tr><th>상단</th>
                        <td><input type="number" value="${wallData.upper.width}" data-wall="${wallKey}"${idx} data-pos="upper" data-dim="width" step="50"></td>
                        <td><input type="number" value="${wallData.upper.height}" data-wall="${wallKey}"${idx} data-pos="upper" data-dim="height" step="50"></td>
                    </tr>
                    <tr><th>하단</th>
                        <td><input type="number" value="${wallData.lower.width}" data-wall="${wallKey}"${idx} data-pos="lower" data-dim="width" step="50"></td>
                        <td><input type="number" value="${wallData.lower.height}" data-wall="${wallKey}"${idx} data-pos="lower" data-dim="height" step="50"></td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    }

    // 내부헌치 폼
    function createHaunchForm(data) {
        const h = getHaunchData(data);
        const middleWallCount = (data.culvert_count || 1) - 1;

        let cards = createWallCard('좌측벽체', 'leftWall', h.leftWall);
        for (let i = 0; i < middleWallCount; i++) {
            cards += createWallCard(`중간벽체${i + 1}`, 'middleWall', h.middleWalls[i], i);
        }
        cards += createWallCard('우측벽체', 'rightWall', h.rightWall);

        return `
            <div class="haunch-cards">${cards}</div>
            <div style="margin-top: 12px; color: var(--text-secondary); font-size: 11px;">* 모든 치수 단위: mm &nbsp;|&nbsp; 좌측벽체 입력 시 우측벽체 자동 동기화</div>`;
    }

    function registerHaunchEvents() {
        document.querySelectorAll('.haunch-card input[type="number"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const wall = e.target.dataset.wall;
                const pos = e.target.dataset.pos;
                const dim = e.target.dataset.dim;
                const value = parseFloat(e.target.value) || 0;
                const data = state.getSectionData();
                const haunch = getHaunchData(data);
                if (wall === 'middleWall') {
                    const idx = parseInt(e.target.dataset.index);
                    haunch.middleWalls[idx][pos][dim] = value;
                } else {
                    haunch[wall][pos][dim] = value;
                }
                // 좌측벽체 → 우측벽체 자동 동기화
                if (wall === 'leftWall') {
                    haunch.rightWall[pos][dim] = value;
                }
                state.updateSectionData('haunch', haunch);
                updateSvg();
                // 우측벽체 UI도 갱신
                if (wall === 'leftWall') {
                    renderSectionTabContent();
                }
            });
        });
    }

    // 부상방지저판 폼
    function createAntiFloatForm(data) {
        const af = data.antiFloat || { use: false, leftExtension: 500, rightExtension: 500, thickness: 300 };
        return `
            <div style="margin-bottom: 12px;">
                <label style="font-size:13px; cursor:pointer;">
                    <input type="checkbox" id="antifloat-use" ${af.use ? 'checked' : ''}> 부상방지저판 적용
                </label>
            </div>
            <table class="sub-section-table">
                <thead>
                    <tr>
                        <th>좌측 확장폭 (mm)</th>
                        <th>우측 확장폭 (mm)</th>
                        <th>두께 (mm)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><input type="number" id="antifloat-left" value="${af.leftExtension}" ${af.use ? '' : 'disabled'}></td>
                        <td><input type="number" id="antifloat-right" value="${af.rightExtension}" ${af.use ? '' : 'disabled'}></td>
                        <td><input type="number" id="antifloat-thickness" value="${af.thickness}" ${af.use ? '' : 'disabled'}></td>
                    </tr>
                </tbody>
            </table>
            <div style="margin-top: 12px; color: var(--text-secondary); font-size: 11px;">* 모든 치수 단위: mm</div>`;
    }

    function registerAntiFloatEvents() {
        const useCheck = document.getElementById('antifloat-use');
        if (!useCheck) return;

        useCheck.addEventListener('change', (e) => {
            const data = state.getSectionData();
            const af = { ...(data.antiFloat || {}) };
            af.use = e.target.checked;
            state.updateSectionData('antiFloat', af);
            renderSectionTabContent();
            updateSvg();
        });

        const fields = [
            { id: 'antifloat-left', key: 'leftExtension' },
            { id: 'antifloat-right', key: 'rightExtension' },
            { id: 'antifloat-thickness', key: 'thickness' }
        ];
        fields.forEach(({ id, key }) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    const value = parseFloat(e.target.value) || 0;
                    const data = state.getSectionData();
                    const af = { ...(data.antiFloat || {}) };
                    af[key] = value;
                    state.updateSectionData('antiFloat', af);
                    updateSvg();
                });
            }
        });
    }

    // 플레이스홀더 폼
    function renderPlaceholder(container, menu) {
        container.innerHTML = `<div class="placeholder-message">"${menu}" 기능은 개발 중입니다.</div>`;
    }

    // ========================================
    // DXF EXPORT - DXF 내보내기 (R12 형식)
    // ========================================

    // DXF 생성 클래스 (R12 호환)
    class DxfWriter {
        constructor() {
            this.entities = [];
            this.layers = [];
            this.currentLayer = '0';
        }

        addLayer(name, color) {
            this.layers.push({ name, color });
        }

        setLayer(name) {
            this.currentLayer = name;
        }

        drawLine(x1, y1, x2, y2) {
            this.entities.push({ type: 'LINE', layer: this.currentLayer, x1, y1, x2, y2 });
        }

        drawPolyline(points, closed = false) {
            this.entities.push({ type: 'POLYLINE', layer: this.currentLayer, points, closed });
        }

        drawText(x, y, height, rotation, text) {
            this.entities.push({ type: 'TEXT', layer: this.currentLayer, x, y, height, rotation, text });
        }

        toDxfString() {
            let s = '';

            // HEADER
            s += '0\nSECTION\n2\nHEADER\n';
            s += '9\n$ACADVER\n1\nAC1009\n';
            s += '9\n$INSUNITS\n70\n4\n';
            s += '0\nENDSEC\n';

            // TABLES
            s += '0\nSECTION\n2\nTABLES\n';

            // LTYPE
            s += '0\nTABLE\n2\nLTYPE\n70\n1\n';
            s += '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n';
            s += '0\nENDTAB\n';

            // LAYER
            s += '0\nTABLE\n2\nLAYER\n70\n' + (this.layers.length + 1) + '\n';
            s += '0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n';
            for (const lyr of this.layers) {
                s += '0\nLAYER\n2\n' + lyr.name + '\n70\n0\n62\n' + lyr.color + '\n6\nCONTINUOUS\n';
            }
            s += '0\nENDTAB\n';

            // STYLE
            s += '0\nTABLE\n2\nSTYLE\n70\n1\n';
            s += '0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n250.0\n3\ntxt\n4\n\n';
            s += '0\nENDTAB\n';

            s += '0\nENDSEC\n';

            // ENTITIES
            s += '0\nSECTION\n2\nENTITIES\n';

            for (const e of this.entities) {
                if (e.type === 'LINE') {
                    s += '0\nLINE\n8\n' + e.layer + '\n';
                    s += '10\n' + e.x1 + '\n20\n' + e.y1 + '\n30\n0\n';
                    s += '11\n' + e.x2 + '\n21\n' + e.y2 + '\n31\n0\n';
                } else if (e.type === 'POLYLINE') {
                    s += '0\nPOLYLINE\n8\n' + e.layer + '\n66\n1\n70\n' + (e.closed ? 1 : 0) + '\n';
                    for (const pt of e.points) {
                        s += '0\nVERTEX\n8\n' + e.layer + '\n10\n' + pt[0] + '\n20\n' + pt[1] + '\n30\n0\n';
                    }
                    s += '0\nSEQEND\n8\n' + e.layer + '\n';
                } else if (e.type === 'TEXT') {
                    s += '0\nTEXT\n8\n' + e.layer + '\n';
                    s += '10\n' + e.x + '\n20\n' + e.y + '\n30\n0\n';
                    s += '40\n' + e.height + '\n1\n' + e.text + '\n';
                    if (e.rotation !== 0) s += '50\n' + e.rotation + '\n';
                    s += '72\n1\n11\n' + e.x + '\n21\n' + e.y + '\n31\n0\n73\n2\n';
                }
            }

            s += '0\nENDSEC\n0\nEOF\n';
            return s;
        }
    }

    function exportDXF() {
        const data = state.getSectionData();
        if (!data || !data.H || data.H <= 0 || !data.B || data.B.length === 0) {
            alert('단면제원 데이터가 올바르지 않습니다.');
            return false;
        }

        const dims = calculateDims(data);
        const dxf = new DxfWriter();

        // 레이어 설정 (색상: 7=흰색, 3=청록, 1=빨강)
        dxf.addLayer('OUTER', 7);
        dxf.addLayer('INNER', 3);
        dxf.addLayer('DIMENSION', 1);

        // 외곽선 그리기
        dxf.setLayer('OUTER');
        dxf.drawPolyline([
            [0, 0],
            [dims.totalWidth, 0],
            [dims.totalWidth, dims.totalHeight],
            [0, dims.totalHeight],
            [0, 0]
        ], true);

        // 내부 공간 그리기
        dxf.setLayer('INNER');
        let xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            dxf.drawPolyline([
                [xOffset, dims.LT],
                [xOffset + B, dims.LT],
                [xOffset + B, dims.LT + dims.H],
                [xOffset, dims.LT + dims.H],
                [xOffset, dims.LT]
            ], true);
            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }

        // 치수선 그리기
        dxf.setLayer('DIMENSION');
        const dimOffset = 500;
        const dimOffsetFar = 750;
        const textHeight = 250;

        // 전체 폭 (하단)
        drawDimH(dxf, 0, dims.totalWidth, 0, -dimOffset, dims.totalWidth.toString(), textHeight);

        // 전체 높이 (우측)
        drawDimV(dxf, dims.totalWidth, 0, dims.totalHeight, dimOffset, dims.totalHeight.toString(), textHeight);

        // 내공 높이 H (좌측)
        drawDimV(dxf, 0, dims.LT, dims.LT + dims.H, -dimOffset, dims.H.toString(), textHeight);

        // 각 내공 폭 (상단)
        xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            drawDimH(dxf, xOffset, xOffset + B, dims.totalHeight, dimOffset, B.toString(), textHeight);
            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }

        // 상부 슬래브 UT
        drawDimV(dxf, 0, dims.LT + dims.H, dims.totalHeight, -dimOffsetFar, dims.UT.toString(), textHeight);

        // 하부 슬래브 LT
        drawDimV(dxf, 0, 0, dims.LT, -dimOffsetFar, dims.LT.toString(), textHeight);

        // 좌측 벽 WL
        drawDimH(dxf, 0, dims.WL, 0, -dimOffsetFar, dims.WL.toString(), textHeight);

        // 우측 벽 WR
        drawDimH(dxf, dims.totalWidth - dims.WR, dims.totalWidth, 0, -dimOffsetFar, dims.WR.toString(), textHeight);

        // 중간벽 치수
        if (data.middle_walls && data.middle_walls.length > 0) {
            xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                xOffset += data.B[i];
                if (i < data.middle_walls.length) {
                    const wt = data.middle_walls[i].thickness;
                    drawDimH(dxf, xOffset, xOffset + wt, dims.totalHeight, dimOffsetFar, wt.toString(), textHeight);
                    xOffset += wt;
                }
            }
        }

        // DXF 파일 다운로드
        const dxfString = dxf.toDxfString();
        const blob = new Blob([dxfString], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'culvert_section.dxf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    function calculateDims(data) {
        const tiw = data.B.reduce((a, b) => a + b, 0);
        const tmw = data.middle_walls ? data.middle_walls.reduce((s, w) => s + w.thickness, 0) : 0;
        return {
            totalWidth: data.WL + tiw + tmw + data.WR,
            totalHeight: data.LT + data.H + data.UT,
            H: data.H, LT: data.LT, UT: data.UT, WL: data.WL, WR: data.WR
        };
    }

    // 수평 치수선 그리기
    function drawDimH(dxf, x1, x2, y, offset, text, textHeight) {
        const dimY = y + offset;
        dxf.drawLine(x1, y, x1, dimY);
        dxf.drawLine(x2, y, x2, dimY);
        dxf.drawLine(x1, dimY, x2, dimY);
        const textX = (x1 + x2) / 2;
        const textY = dimY + (offset > 0 ? textHeight * 0.5 : -textHeight * 0.8);
        dxf.drawText(textX, textY, textHeight, 0, text);
    }

    // 수직 치수선 그리기
    function drawDimV(dxf, x, y1, y2, offset, text, textHeight) {
        const dimX = x + offset;
        dxf.drawLine(x, y1, dimX, y1);
        dxf.drawLine(x, y2, dimX, y2);
        dxf.drawLine(dimX, y1, dimX, y2);
        const textX = dimX + (offset > 0 ? textHeight * 0.5 : -textHeight * 0.8);
        const textY = (y1 + y2) / 2;
        dxf.drawText(textX, textY, textHeight, 90, text);
    }

    // ========================================
    // APP INIT - 앱 초기화
    // ========================================
    document.addEventListener('DOMContentLoaded', () => {
        console.log('ESC Culvert Web App 초기화...');

        // LocalStorage에서 복원
        const savedData = storage.load();
        if (savedData) {
            state.fromJSON(JSON.stringify(savedData));
            console.log('저장된 데이터 복원됨');
        }

        // 트리 메뉴
        renderTree('tree-menu');

        // SVG 렌더러
        const svgElement = document.getElementById('culvert-svg');
        const svgContainer = document.getElementById('svg-container');
        if (svgElement && svgContainer) {
            initRenderer(svgElement);
            initZoomPan(svgElement, svgContainer);
            getRenderer().render(state.getSectionData());
        }

        // 초기 폼
        updateFormContent(state.getCurrentMenu());

        // 이벤트 리스너
        document.getElementById('btn-new').addEventListener('click', () => {
            if (confirm('현재 프로젝트를 초기화하시겠습니까?')) {
                state.reset();
                storage.clear();
                updateFormContent(state.getCurrentMenu());
                alert('새 프로젝트가 생성되었습니다.');
            }
        });

        document.getElementById('btn-save').addEventListener('click', () => {
            storage.exportToFile(state.get(), 'esc_culvert_project.json');
        });

        document.getElementById('btn-load').addEventListener('click', async () => {
            try {
                const data = await storage.importFromFile();
                state.fromJSON(JSON.stringify(data));
                updateFormContent(state.getCurrentMenu());
                alert('프로젝트를 불러왔습니다.');
            } catch (e) {
                alert('파일을 불러오는데 실패했습니다: ' + e.message);
            }
        });

        document.getElementById('btn-export-dxf').addEventListener('click', () => exportDXF());

        document.getElementById('btn-zoom-in').addEventListener('click', () => { if (getZoomPan()) getZoomPan().zoomIn(); });
        document.getElementById('btn-zoom-out').addEventListener('click', () => { if (getZoomPan()) getZoomPan().zoomOut(); });
        document.getElementById('btn-fit').addEventListener('click', () => { if (getZoomPan()) getZoomPan().fitToView(); });

        // 상태 변경 감지
        state.on('menuChange', (menu) => {
            updateFormTitle(menu);
            updateFormContent(menu);
        });

        state.on('sectionDataChange', (data) => {
            const renderer = getRenderer();
            if (renderer) {
                renderer.render(data);
                if (getZoomPan()) getZoomPan().reset();
            }
            autoSave();
        });

        state.on('stateChange', () => autoSave());

        console.log('초기화 완료');
    });

    function updateFormTitle(menu) {
        const el = document.getElementById('form-title');
        if (el) el.textContent = menu;
    }

    function updateFormContent(menu) {
        const container = document.getElementById('form-content');
        if (!container) return;

        switch (menu) {
            case '프로젝트 정보': renderProjectInfoForm(container); break;
            case '기본환경': renderBasicEnvironmentForm(container); break;
            case '재료특성': renderMaterialsForm(container); break;
            case '단면제원': renderSectionPropertiesForm(container); break;
            default: renderPlaceholder(container, menu);
        }
    }

    let autoSaveTimeout = null;
    function autoSave() {
        if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            storage.save(state.get());
            console.log('자동 저장됨');
        }, 1000);
    }

})();
