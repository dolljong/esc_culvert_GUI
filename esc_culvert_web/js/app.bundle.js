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
        groundInfo: {
            earthCoverDepth: 2000,
            groundwaterLevel: 3000,
            frictionAngle: 30,
            soilUnitWeight: 18
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
            columnGirder: {
                columnCTC: 3000,
                columnWidth: 500,
                upperAdditionalHeight: 0,
                lowerAdditionalHeight: 0
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
        updateGroundInfo(key, value) {
            appState.groundInfo[key] = value;
            this.emit('stateChange', appState);
        },
        getGroundInfo() { return appState.groundInfo; },
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
            { label: '지반정보' },
            { label: '기타환경' }
        ]},
        { label: '단면입력', children: [
            { label: '단면제원' },
            { label: '분점 정의' },
            { label: '하중 정의' }
        ]},
        { label: '하중입력', children: null },
        { label: '안정검토', children: [
            { label: '부력검토' }
        ]},
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
            this.drawColumnGirders(mainGroup, culvertData, dims);
            this.drawColumnLeaders(mainGroup, culvertData, dims);
            this.drawGroundLevel(mainGroup, culvertData, dims);
            this.drawGroundwaterLevel(mainGroup, culvertData, dims);
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
            const groundInfo = state.getGroundInfo();
            const earthCover = groundInfo.earthCoverDepth || 0;
            const topY = dims.totalHeight + earthCover;
            const minX = -extL - PADDING;
            const width = dims.totalWidth + extL + extR + PADDING * 2;
            const height = topY + PADDING * 2;
            this.svg.setAttribute('viewBox', `${minX} ${-topY - PADDING} ${width} ${height}`);
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

                        if (upperAdd > 0) {
                            const yStart = top - upperH;
                            const yEnd = yStart - upperAdd;
                            parent.appendChild(this.createLine(wLeft, yStart, wLeft, yEnd, 'girder-line'));
                            parent.appendChild(this.createLine(wRight, yStart, wRight, yEnd, 'girder-line'));
                            parent.appendChild(this.createLine(wLeft, yEnd, wRight, yEnd, 'girder-line'));
                        }

                        if (lowerAdd > 0) {
                            const yStart = bottom + lowerH;
                            const yEnd = yStart + lowerAdd;
                            parent.appendChild(this.createLine(wLeft, yStart, wLeft, yEnd, 'girder-line'));
                            parent.appendChild(this.createLine(wRight, yStart, wRight, yEnd, 'girder-line'));
                            parent.appendChild(this.createLine(wLeft, yEnd, wRight, yEnd, 'girder-line'));
                        }

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

                        parent.appendChild(this.createLine(wSurface, midY, leaderEnd, midY, 'leader-line'));
                        parent.appendChild(this.createLine(leaderEnd, midY, leaderEnd, midY + textSize * 0.3, 'leader-line'));

                        const t1 = this.createText(leaderEnd + 50, midY + lineGap * 0.5, `CTC=${cg.columnCTC}`);
                        t1.setAttribute('class', 'leader-text');
                        t1.setAttribute('font-size', textSize);
                        t1.setAttribute('text-anchor', 'start');
                        parent.appendChild(t1);

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

        createPolyline(points, className) {
            const polyline = document.createElementNS(SVG_NS, 'polyline');
            polyline.setAttribute('points', points.map(p => `${p[0]},${p[1]}`).join(' '));
            polyline.setAttribute('class', className);
            return polyline;
        }

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
            groundGroup.appendChild(this.createLine(lineLeft, groundY, lineRight, groundY, 'ground-line'));

            const hatchSpacing = 400;
            const hatchSize = 200;
            for (let x = lineLeft + hatchSpacing / 2; x <= lineRight; x += hatchSpacing) {
                groundGroup.appendChild(this.createLine(x, groundY, x - hatchSize, groundY - hatchSize, 'ground-hatch'));
            }
            parent.appendChild(groundGroup);
        }

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

        drawDimensions(parent, data, dims) {
            const dimGroup = this.createGroup('dimensions');

            // 부상방지저판 유무에 따른 수직치수선 원점
            const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
            const leftX = afData ? -(afData.leftExtension || 0) : 0;
            const rightX = afData ? dims.totalWidth + (afData.rightExtension || 0) : dims.totalWidth;

            // 전체 폭/높이
            this.drawHorizontalDimension(dimGroup, 0, dims.totalWidth, 0, -DIM_OFFSET, dims.totalWidth.toString());
            this.drawVerticalDimension(dimGroup, rightX, 0, dims.totalHeight, DIM_OFFSET_FAR, dims.totalHeight.toString(), EXT_LINE_GAP + 500);
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
                    this.drawHorizontalDimension(dimGroup, -lExt, 0, 0, -DIM_OFFSET, lExt.toString());
                }
                if (t > 0) {
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

        drawHorizontalDimension(parent, x1, x2, y, offset, text) {
            const dimY = y + offset;
            const sign = offset > 0 ? 1 : -1;
            const extStart = y + sign * EXT_LINE_GAP;
            parent.appendChild(this.createLine(x1, extStart, x1, dimY, 'extension-line'));
            parent.appendChild(this.createLine(x2, extStart, x2, dimY, 'extension-line'));
            parent.appendChild(this.createLine(x1, dimY, x2, dimY, 'dimension-line'));
            this.drawArrow(parent, x1, dimY, 'right');
            this.drawArrow(parent, x2, dimY, 'left');
            parent.appendChild(this.createText((x1 + x2) / 2, dimY + 175, text, offset < 0));
        }

        drawVerticalDimension(parent, x, y1, y2, offset, text, extGap) {
            const dimX = x + offset;
            const sign = offset > 0 ? 1 : -1;
            const extStart = x + sign * (extGap !== undefined ? extGap : EXT_LINE_GAP);
            parent.appendChild(this.createLine(extStart, y1, dimX, y1, 'extension-line'));
            parent.appendChild(this.createLine(extStart, y2, dimX, y2, 'extension-line'));
            parent.appendChild(this.createLine(dimX, y1, dimX, y2, 'dimension-line'));
            this.drawArrow(parent, dimX, y1, 'up');
            this.drawArrow(parent, dimX, y2, 'down');
            parent.appendChild(this.createText(dimX - 175, (y1 + y2) / 2, text, false, true));
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

            // 텍스트 높이 계산
            function textH(w, h) { return Math.max(Math.min(w * 0.13, h * 0.13, 220), 60); }

            // 번호+이름 부착 사각형
            const me = this;
            function addRect(x1, y1, x2, y2, name, cls) {
                shapeNo++;
                const poly = me.createPolyline([[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]], cls);
                mainGroup.appendChild(poly);
                const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
                const th = textH(w, h);
                // 번호
                const numT = me._buoyText(cx, cy + th * 0.3, `No.${shapeNo}`, th, 'buoy-num-text');
                mainGroup.appendChild(numT);
                // 이름
                const nth = th * 0.7;
                if (name.length * nth < w * 0.95) {
                    const nameT = me._buoyText(cx, cy - th * 0.6, name, nth, 'buoy-name-text');
                    mainGroup.appendChild(nameT);
                }
            }

            // 점선 사각형 (기둥본체)
            function addRectDashed(x1, y1, x2, y2, name, cls) {
                shapeNo++;
                mainGroup.appendChild(me.createLine(x1, y1, x2, y1, cls + ' buoy-dashed'));
                mainGroup.appendChild(me.createLine(x2, y1, x2, y2, cls + ' buoy-dashed'));
                mainGroup.appendChild(me.createLine(x2, y2, x1, y2, cls + ' buoy-dashed'));
                mainGroup.appendChild(me.createLine(x1, y2, x1, y1, cls + ' buoy-dashed'));
                const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
                const th = textH(w, h);
                mainGroup.appendChild(me._buoyText(cx, cy, `No.${shapeNo}`, th, 'buoy-num-text'));
            }

            // 삼각형
            function addTri(p1, p2, p3, cls, label) {
                if (label) shapeNo++;
                const poly = me.createPolyline([p1, p2, p3, p1], cls);
                mainGroup.appendChild(poly);
                if (label) {
                    const cx = (p1[0] + p2[0] + p3[0]) / 3;
                    const cy = (p1[1] + p2[1] + p3[1]) / 3;
                    const xs = [p1[0], p2[0], p3[0]], ys = [p1[1], p2[1], p3[1]];
                    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
                    const th = Math.min(textH(w, h), 130);
                    mainGroup.appendChild(me._buoyText(cx, cy, `No.${shapeNo}`, th, 'buoy-num-text'));
                }
            }

            // 전체 윤곽선 (회색)
            mainGroup.appendChild(this.createPolyline(
                [[0,0],[totalWidth,0],[totalWidth,totalHeight],[0,totalHeight],[0,0]], 'buoy-outline'));

            // 내공 윤곽선
            let xOff = WL;
            for (let i = 0; i < culvertCount; i++) {
                const B = B_list[i];
                const l = xOff, r = xOff + B;
                mainGroup.appendChild(this.createPolyline(
                    [[l,LT],[r,LT],[r,LT+H],[l,LT+H],[l,LT]], 'buoy-outline'));
                xOff += B;
                if (i < middleWalls.length) xOff += (middleWalls[i].thickness || 0);
            }

            // === 도형 (generate_buoyancy_report 순서 동일) ===
            // 상부슬래브
            addRect(0, LT + H, totalWidth, totalHeight, '상부슬래브', 'buoy-rect');
            // 하부슬래브
            addRect(0, 0, totalWidth, LT, '하부슬래브', 'buoy-rect');
            // 좌측벽체
            addRect(0, LT, WL, LT + H, '좌측벽', 'buoy-rect');

            // 중간벽체
            xOff = WL;
            for (let i = 0; i < culvertCount; i++) {
                xOff += B_list[i];
                if (i < middleWalls.length) {
                    const mw = middleWalls[i];
                    const mwT = mw.thickness || 600;
                    const mwType = mw.type || '연속벽';
                    const mwH = middleHaunches[i] || {};

                    if (mwType === '연속벽') {
                        addRect(xOff, LT, xOff + mwT, LT + H, `중간벽${i+1}`, 'buoy-rect');
                    } else {
                        const mhUH = (mwH.upper && mwH.upper.height) || 0;
                        const mhLH = (mwH.lower && mwH.lower.height) || 0;
                        const ugH = mhUH + upperAddH;
                        const lgH = mhLH + lowerAddH;
                        // 상부종거더
                        addRect(xOff, LT + H - ugH, xOff + mwT, LT + H, '상부거더', 'buoy-girder');
                        // 하부종거더
                        addRect(xOff, LT, xOff + mwT, LT + lgH, '하부거더', 'buoy-girder');
                        // 기둥본체
                        const colBot = LT + lgH, colTop = LT + H - ugH;
                        if (colTop > colBot) {
                            addRectDashed(xOff, colBot, xOff + mwT, colTop, `기둥${i+1}`, 'buoy-girder');
                        }
                    }
                    xOff += mwT;
                }
            }

            // 우측벽체
            addRect(totalWidth - WR, LT, totalWidth, LT + H, '우측벽', 'buoy-rect');

            // === 헌치 (삼각형) ===
            // 좌측벽 상부헌치
            const luW = (leftHaunch.upper && leftHaunch.upper.width) || 0;
            const luH = (leftHaunch.upper && leftHaunch.upper.height) || 0;
            if (luW > 0 && luH > 0) addTri([WL, LT+H], [WL+luW, LT+H], [WL, LT+H-luH], 'buoy-tri', true);

            // 좌측벽 하부헌치
            const llW = (leftHaunch.lower && leftHaunch.lower.width) || 0;
            const llH = (leftHaunch.lower && leftHaunch.lower.height) || 0;
            if (llW > 0 && llH > 0) addTri([WL, LT], [WL+llW, LT], [WL, LT+llH], 'buoy-tri', true);

            // 중간벽 헌치 (연속벽/기둥 모두)
            xOff = WL;
            for (let i = 0; i < culvertCount; i++) {
                xOff += B_list[i];
                if (i < middleWalls.length) {
                    const mwT = middleWalls[i].thickness || 600;
                    const mwH = middleHaunches[i] || {};

                    const muW = (mwH.upper && mwH.upper.width) || 0;
                    const muH = (mwH.upper && mwH.upper.height) || 0;
                    if (muW > 0 && muH > 0) {
                        addTri([xOff, LT+H], [xOff-muW, LT+H], [xOff, LT+H-muH], 'buoy-tri', true);
                        const curNo = shapeNo;
                        addTri([xOff+mwT, LT+H], [xOff+mwT+muW, LT+H], [xOff+mwT, LT+H-muH], 'buoy-tri', false);
                        const cx2 = (xOff+mwT + xOff+mwT+muW + xOff+mwT) / 3;
                        const cy2 = (LT+H + LT+H + LT+H-muH) / 3;
                        const th2 = Math.min(textH(muW, muH), 130);
                        mainGroup.appendChild(this._buoyText(cx2, cy2, `No.${curNo}`, th2, 'buoy-num-text'));
                    }

                    const mlW = (mwH.lower && mwH.lower.width) || 0;
                    const mlH = (mwH.lower && mwH.lower.height) || 0;
                    if (mlW > 0 && mlH > 0) {
                        addTri([xOff, LT], [xOff-mlW, LT], [xOff, LT+mlH], 'buoy-tri', true);
                        const curNo = shapeNo;
                        addTri([xOff+mwT, LT], [xOff+mwT+mlW, LT], [xOff+mwT, LT+mlH], 'buoy-tri', false);
                        const cx2 = (xOff+mwT + xOff+mwT+mlW + xOff+mwT) / 3;
                        const cy2 = (LT + LT + LT+mlH) / 3;
                        const th2 = Math.min(textH(mlW, mlH), 130);
                        mainGroup.appendChild(this._buoyText(cx2, cy2, `No.${curNo}`, th2, 'buoy-num-text'));
                    }

                    xOff += mwT;
                }
            }

            // 우측벽 상부헌치
            const rwLeft = totalWidth - WR;
            const ruW = (rightHaunch.upper && rightHaunch.upper.width) || 0;
            const ruH = (rightHaunch.upper && rightHaunch.upper.height) || 0;
            if (ruW > 0 && ruH > 0) addTri([rwLeft, LT+H], [rwLeft-ruW, LT+H], [rwLeft, LT+H-ruH], 'buoy-tri', true);

            // 우측벽 하부헌치
            const rlW = (rightHaunch.lower && rightHaunch.lower.width) || 0;
            const rlH = (rightHaunch.lower && rightHaunch.lower.height) || 0;
            if (rlW > 0 && rlH > 0) addTri([rwLeft, LT], [rwLeft-rlW, LT], [rwLeft, LT+rlH], 'buoy-tri', true);

            // 부상방지저판
            if (afUse && afT > 0) {
                addRect(-afLeft, -afT, totalWidth + afRight, 0, '부상방지저판', 'buoy-af');
            }

            this.svg.appendChild(mainGroup);

            // 뷰박스 설정
            const pad = 500;
            const minX = (afUse ? -afLeft : 0) - pad;
            const minY = (afUse ? -afT : 0) - pad;
            const vW = totalWidth + (afUse ? afLeft + afRight : 0) + pad * 2;
            const vH = totalHeight + (afUse ? afT : 0) + pad * 2;
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

    // 지반정보 폼
    function renderGroundInfoForm(container) {
        const data = state.getGroundInfo();
        container.innerHTML = `
            <div class="form-grid">
                <label class="form-label">토피</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-earthCoverDepth" value="${data.earthCoverDepth}" min="0" step="100" style="width: 100px;">
                    <span class="input-unit">mm</span>
                </div>
                <label class="form-label">지하수위</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-groundwaterLevel" value="${data.groundwaterLevel}" min="0" step="100" style="width: 100px;">
                    <span class="input-unit">mm</span>
                </div>
                <label class="form-label">흙의 내부마찰각</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-frictionAngle" value="${data.frictionAngle}" min="0" max="90" step="1" style="width: 100px;">
                    <span class="input-unit">도</span>
                </div>
                <label class="form-label">흙의 단위중량</label>
                <div class="input-with-unit">
                    <input type="number" class="form-input" id="input-soilUnitWeight" value="${data.soilUnitWeight}" min="0" max="100" step="0.1" style="width: 100px;">
                    <span class="input-unit">kN/m&sup3;</span>
                </div>
            </div>
            <div class="form-section">
                <div class="form-section-title">참고</div>
                <div style="color: var(--text-secondary); font-size: 12px; line-height: 1.6;">
                    <p>• 토피: 구조물 상부슬래브 상면에서 지표면까지의 거리</p>
                    <p>• 지하수위: 지표면에서 지하수위까지의 거리</p>
                    <p>• 흙의 내부마찰각: 일반적으로 25~35도</p>
                    <p>• 흙의 단위중량: 일반적으로 16~20 kN/m&sup3;</p>
                </div>
            </div>
        `;
        document.getElementById('input-earthCoverDepth').addEventListener('change', (e) => state.updateGroundInfo('earthCoverDepth', parseFloat(e.target.value) || 2000));
        document.getElementById('input-groundwaterLevel').addEventListener('change', (e) => state.updateGroundInfo('groundwaterLevel', parseFloat(e.target.value) || 3000));
        document.getElementById('input-frictionAngle').addEventListener('change', (e) => state.updateGroundInfo('frictionAngle', parseFloat(e.target.value) || 30));
        document.getElementById('input-soilUnitWeight').addEventListener('change', (e) => state.updateGroundInfo('soilUnitWeight', parseFloat(e.target.value) || 18));
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
                <button class="section-tab ${currentSectionTab === 'columngirder' ? 'active' : ''}" data-tab="columngirder">기둥및종거더</button>
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
            case 'columngirder':
                contentEl.innerHTML = createColumnGirderForm(data);
                registerColumnGirderEvents();
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

    // 기둥및종거더 폼
    function createColumnGirderForm(data) {
        const cg = data.columnGirder || { columnCTC: 3000, columnWidth: 500, upperAdditionalHeight: 0, lowerAdditionalHeight: 0 };
        const h = getHaunchData(data);
        const upperHaunchHeight = h.leftWall.upper.height;
        const lowerHaunchHeight = h.leftWall.lower.height;
        const UT = data.UT || 0;
        const LT = data.LT || 0;
        const upperGirder = UT + upperHaunchHeight + cg.upperAdditionalHeight;
        const lowerGirder = LT + lowerHaunchHeight + cg.lowerAdditionalHeight;

        return `
            <div class="haunch-cards">
                <div class="haunch-card">
                    <div class="haunch-card-title">기둥</div>
                    <table class="sub-section-table">
                        <tbody>
                            <tr><th>기둥 CTC</th><td><input type="number" id="cg-columnCTC" value="${cg.columnCTC}" step="100"> mm</td></tr>
                            <tr><th>기둥 폭</th><td><input type="number" id="cg-columnWidth" value="${cg.columnWidth}" step="50"> mm</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="haunch-card">
                    <div class="haunch-card-title">종거더</div>
                    <table class="sub-section-table">
                        <tbody>
                            <tr><th>상부 추가높이</th><td><input type="number" id="cg-upperAdditionalHeight" value="${cg.upperAdditionalHeight}" step="50"> mm</td></tr>
                            <tr><th>하부 추가높이</th><td><input type="number" id="cg-lowerAdditionalHeight" value="${cg.lowerAdditionalHeight}" step="50"> mm</td></tr>
                        </tbody>
                    </table>
                </div>
                <div class="haunch-card">
                    <div class="haunch-card-title">종거더 높이 계산</div>
                    <table class="sub-section-table">
                        <tbody>
                            <tr><th>상부</th><td>UT(${UT}) + 헌치높이(${upperHaunchHeight}) + 추가높이(${cg.upperAdditionalHeight}) = <strong>${upperGirder}</strong> mm</td></tr>
                            <tr><th>하부</th><td>LT(${LT}) + 헌치높이(${lowerHaunchHeight}) + 추가높이(${cg.lowerAdditionalHeight}) = <strong>${lowerGirder}</strong> mm</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div style="margin-top: 12px; color: var(--text-secondary); font-size: 11px;">* 모든 치수 단위: mm &nbsp;|&nbsp; 헌치높이는 좌측벽체 기준</div>`;
    }

    function registerColumnGirderEvents() {
        const fields = [
            { id: 'cg-columnCTC', key: 'columnCTC' },
            { id: 'cg-columnWidth', key: 'columnWidth' },
            { id: 'cg-upperAdditionalHeight', key: 'upperAdditionalHeight' },
            { id: 'cg-lowerAdditionalHeight', key: 'lowerAdditionalHeight' }
        ];
        fields.forEach(({ id, key }) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', (e) => {
                    const value = parseFloat(e.target.value) || 0;
                    const data = state.getSectionData();
                    const cg = { ...(data.columnGirder || {}) };
                    cg[key] = value;
                    state.updateSectionData('columnGirder', cg);
                    renderSectionTabContent();
                });
            }
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

    // 칸별 헌치 데이터 가져오기 (SVG 렌더러와 동일 로직)
    function getDxfCompartmentHaunches(data, i) {
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

    function exportDXF() {
        const data = state.getSectionData();
        if (!data || !data.H || data.H <= 0 || !data.B || data.B.length === 0) {
            alert('단면제원 데이터가 올바르지 않습니다.');
            return false;
        }

        const dims = calculateDims(data);
        const groundInfo = state.getGroundInfo();
        const earthCover = groundInfo.earthCoverDepth || 0;
        const waterLevel = groundInfo.groundwaterLevel || 0;
        const dxf = new DxfWriter();

        // 부상방지저판 데이터
        const afData = (data.antiFloat && data.antiFloat.use) ? data.antiFloat : null;
        const afT = afData ? (afData.thickness || 0) : 0;
        const afLeftExt = afData ? (afData.leftExtension || 0) : 0;
        const afRightExt = afData ? (afData.rightExtension || 0) : 0;

        // 레이어 설정
        dxf.addLayer('OUTER', 7);    // 흰색
        dxf.addLayer('INNER', 3);    // 청록
        dxf.addLayer('DIMENSION', 1); // 빨강
        dxf.addLayer('GROUND', 3);   // 녹색
        dxf.addLayer('WATER', 4);    // 청록

        // === 외곽선 ===
        dxf.setLayer('OUTER');
        if (afData && afT > 0) {
            // 부상방지저판이 있는 경우
            dxf.drawPolyline([
                [0, afT], [0, dims.totalHeight],
                [dims.totalWidth, dims.totalHeight], [dims.totalWidth, afT]
            ]);
            dxf.drawLine(0, 0, dims.totalWidth, 0);
        } else {
            dxf.drawPolyline([
                [0, 0], [dims.totalWidth, 0],
                [dims.totalWidth, dims.totalHeight],
                [0, dims.totalHeight], [0, 0]
            ], true);
        }

        // === 내부 공간 (헌치 고려) ===
        dxf.setLayer('INNER');
        let xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            const left = xOffset, right = xOffset + B;
            const bottom = dims.LT, top = dims.LT + dims.H;
            const { ul, ur, ll, lr } = getDxfCompartmentHaunches(data, i);

            dxf.drawLine(left + ll.width, bottom, right - lr.width, bottom);
            dxf.drawLine(right, bottom + lr.height, right, top - ur.height);
            dxf.drawLine(right - ur.width, top, left + ul.width, top);
            dxf.drawLine(left, top - ul.height, left, bottom + ll.height);

            xOffset += B;
            if (i < data.middle_walls.length) xOffset += data.middle_walls[i].thickness;
        }

        // === 헌치 대각선 ===
        xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            const left = xOffset, right = xOffset + B;
            const bottom = dims.LT, top = dims.LT + dims.H;
            const { ul, ur, ll, lr } = getDxfCompartmentHaunches(data, i);

            if (ul.width > 0 && ul.height > 0)
                dxf.drawLine(left, top - ul.height, left + ul.width, top);
            if (ur.width > 0 && ur.height > 0)
                dxf.drawLine(right - ur.width, top, right, top - ur.height);
            if (ll.width > 0 && ll.height > 0)
                dxf.drawLine(left, bottom + ll.height, left + ll.width, bottom);
            if (lr.width > 0 && lr.height > 0)
                dxf.drawLine(right - lr.width, bottom, right, bottom + lr.height);

            xOffset += B;
            if (i < data.middle_walls.length) xOffset += data.middle_walls[i].thickness;
        }

        // === 부상방지저판 ===
        dxf.setLayer('OUTER');
        if (afData) {
            if (afLeftExt > 0) {
                dxf.drawPolyline([
                    [0, afT], [-afLeftExt, afT],
                    [-afLeftExt, 0], [0, 0]
                ]);
            }
            if (afRightExt > 0) {
                dxf.drawPolyline([
                    [dims.totalWidth, afT], [dims.totalWidth + afRightExt, afT],
                    [dims.totalWidth + afRightExt, 0], [dims.totalWidth, 0]
                ]);
            }
        }

        // === 지반선 ===
        if (earthCover > 0) {
            dxf.setLayer('GROUND');
            const groundY = dims.totalHeight + earthCover;
            const lineLeft = (afData ? -afLeftExt : 0) - 500;
            const lineRight = (afData ? dims.totalWidth + afRightExt : dims.totalWidth) + 500;

            dxf.drawLine(lineLeft, groundY, lineRight, groundY);

            const hatchSpacing = 400;
            const hatchSize = 200;
            for (let x = lineLeft + hatchSpacing / 2; x <= lineRight; x += hatchSpacing) {
                dxf.drawLine(x, groundY, x - hatchSize, groundY - hatchSize);
            }
        }

        // === 지하수위 ===
        if (waterLevel > 0 && earthCover > 0) {
            dxf.setLayer('WATER');
            const groundY = dims.totalHeight + earthCover;
            const waterY = groundY - waterLevel;
            const triBase = 400;
            const triH = 350;
            const lineLen = 800;

            // 우측
            dxf.drawLine(dims.totalWidth, waterY, dims.totalWidth + lineLen, waterY);
            const rCx = dims.totalWidth + lineLen / 2;
            dxf.drawLine(rCx - triBase / 2, waterY + triH, rCx + triBase / 2, waterY + triH);
            dxf.drawLine(rCx - triBase / 2, waterY + triH, rCx, waterY);
            dxf.drawLine(rCx + triBase / 2, waterY + triH, rCx, waterY);

            // 좌측
            dxf.drawLine(0, waterY, -lineLen, waterY);
            const lCx = -lineLen / 2;
            dxf.drawLine(lCx - triBase / 2, waterY + triH, lCx + triBase / 2, waterY + triH);
            dxf.drawLine(lCx - triBase / 2, waterY + triH, lCx, waterY);
            dxf.drawLine(lCx + triBase / 2, waterY + triH, lCx, waterY);
        }

        // === 치수선 (SVG 렌더러와 동일 설정) ===
        dxf.setLayer('DIMENSION');
        const dimOffset = 1000;       // SVG: DIM_OFFSET = 1000
        const dimOffsetFar = 1500;    // SVG: DIM_OFFSET_FAR = 1500
        const extLineGap = 500;      // SVG: EXT_LINE_GAP = 500
        const textHeight = 250;

        const leftX = afData ? -afLeftExt : 0;
        const rightX = afData ? dims.totalWidth + afRightExt : dims.totalWidth;

        // 전체 폭 (하단)
        drawDimH(dxf, 0, dims.totalWidth, 0, -dimOffset, dims.totalWidth.toString(), textHeight, extLineGap);

        // 전체 높이 (우측, 외측 tier) - extGap = EXT_LINE_GAP + 500
        drawDimV(dxf, rightX, 0, dims.totalHeight, dimOffsetFar, dims.totalHeight.toString(), textHeight, extLineGap + 500);

        // 내공 높이 H (좌측)
        drawDimV(dxf, leftX, dims.LT, dims.LT + dims.H, -dimOffset, dims.H.toString(), textHeight, extLineGap);

        // 각 내공 폭 (상단)
        xOffset = data.WL;
        for (let i = 0; i < data.culvert_count; i++) {
            const B = data.B[i];
            drawDimH(dxf, xOffset, xOffset + B, dims.totalHeight, dimOffset, B.toString(), textHeight, extLineGap);
            xOffset += B;
            if (i < data.middle_walls.length) {
                xOffset += data.middle_walls[i].thickness;
            }
        }

        // 상부 슬래브 UT (좌측)
        drawDimV(dxf, leftX, dims.LT + dims.H, dims.totalHeight, -dimOffset, dims.UT.toString(), textHeight, extLineGap);

        // 하부 슬래브 LT (좌측)
        drawDimV(dxf, leftX, 0, dims.LT, -dimOffset, dims.LT.toString(), textHeight, extLineGap);

        // 좌측 벽 WL (상단)
        drawDimH(dxf, 0, dims.WL, dims.totalHeight, dimOffset, dims.WL.toString(), textHeight, extLineGap);

        // 우측 벽 WR (상단)
        drawDimH(dxf, dims.totalWidth - dims.WR, dims.totalWidth, dims.totalHeight, dimOffset, dims.WR.toString(), textHeight, extLineGap);

        // 중간벽 치수 (상단)
        if (data.middle_walls && data.middle_walls.length > 0) {
            xOffset = data.WL;
            for (let i = 0; i < data.culvert_count; i++) {
                xOffset += data.B[i];
                if (i < data.middle_walls.length) {
                    const wt = data.middle_walls[i].thickness;
                    drawDimH(dxf, xOffset, xOffset + wt, dims.totalHeight, dimOffset, wt.toString(), textHeight, extLineGap);
                    xOffset += wt;
                }
            }
        }

        // 부상방지저판 치수
        if (afData) {
            if (afLeftExt > 0) {
                drawDimH(dxf, -afLeftExt, 0, 0, -dimOffset, afLeftExt.toString(), textHeight, extLineGap);
                drawDimV(dxf, -afLeftExt, 0, afT, -dimOffset, afT.toString(), textHeight, extLineGap);
            }
        }

        // 토피 치수 (우측, 전체 높이와 같은 tier) - extGap = EXT_LINE_GAP + 500
        if (earthCover > 0) {
            const groundY = dims.totalHeight + earthCover;
            drawDimV(dxf, rightX, dims.totalHeight, groundY, dimOffsetFar, earthCover.toString(), textHeight, extLineGap + 500);

            // 지하수위 깊이 치수 (구조물쪽 가까운 tier)
            if (waterLevel > 0) {
                const waterY = groundY - waterLevel;
                drawDimV(dxf, rightX, waterY, groundY, dimOffset, waterLevel.toString(), textHeight, extLineGap);
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

    // 수평 치수선 그리기 (SVG 렌더러 drawHorizontalDimension과 동일 로직)
    function drawDimH(dxf, x1, x2, y, offset, text, textHeight, extGap) {
        const dimY = y + offset;
        const sign = offset > 0 ? 1 : -1;
        const extStart = y + sign * (extGap || 500);
        // 보조선 (간격 두고 시작)
        dxf.drawLine(x1, extStart, x1, dimY);
        dxf.drawLine(x2, extStart, x2, dimY);
        // 치수선
        dxf.drawLine(x1, dimY, x2, dimY);
        // 텍스트
        const textX = (x1 + x2) / 2;
        const textY = dimY + sign * textHeight * 0.6;
        dxf.drawText(textX, textY, textHeight, 0, text);
    }

    // 수직 치수선 그리기 (SVG 렌더러 drawVerticalDimension과 동일 로직)
    function drawDimV(dxf, x, y1, y2, offset, text, textHeight, extGap) {
        const dimX = x + offset;
        const sign = offset > 0 ? 1 : -1;
        const extStart = x + sign * (extGap || 500);
        // 보조선 (간격 두고 시작)
        dxf.drawLine(extStart, y1, dimX, y1);
        dxf.drawLine(extStart, y2, dimX, y2);
        // 치수선
        dxf.drawLine(dimX, y1, dimX, y2);
        // 텍스트
        const textX = dimX + sign * textHeight * 0.6;
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
            // 부력검토가 아닌 메뉴로 이동하면 단면도 복원
            if (menu !== '부력검토') {
                const renderer = getRenderer();
                if (renderer) {
                    renderer.render(state.getSectionData());
                    if (getZoomPan()) getZoomPan().reset();
                }
            }
        });

        state.on('sectionDataChange', (data) => {
            const renderer = getRenderer();
            if (renderer) {
                renderer.render(data);
                if (getZoomPan()) getZoomPan().reset();
            }
            autoSave();
        });

        state.on('stateChange', () => {
            autoSave();
            const renderer = getRenderer();
            if (renderer) renderer.render(state.getSectionData());
        });

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
            case '지반정보': renderGroundInfoForm(container); break;
            case '단면제원': renderSectionPropertiesForm(container); break;
            case '부력검토': renderBuoyancyCheckForm(container); break;
            default: renderPlaceholder(container, menu);
        }
    }

    // ========================================
    // BUOYANCY CHECK - 부력 검토
    // ========================================
    const GAMMA_C = 24.5;
    const GAMMA_W = 9.81;

    function bFmt(val) {
        if (val === Math.floor(val)) return Math.floor(val).toLocaleString();
        return val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    function bFmt2(val) {
        return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function bFmt3(val) {
        return val.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }

    function generateBuoyancyReport(sectionData, groundInfo) {
        const culvertCount = parseInt(sectionData.culvert_count || 3);
        const H = parseFloat(sectionData.H || 4200);
        const B_list = (sectionData.B || [4000, 4000, 4000]).map(Number);
        const UT = parseFloat(sectionData.UT || 600);
        const LT = parseFloat(sectionData.LT || 800);
        const WL = parseFloat(sectionData.WL || 600);
        const WR = parseFloat(sectionData.WR || 600);
        const middleWalls = sectionData.middle_walls || [];
        const haunchData = sectionData.haunch || {};
        const columnGirder = sectionData.columnGirder || {};
        const antiFloat = sectionData.antiFloat || {};

        const earthCover = parseFloat(groundInfo.earthCoverDepth || 2000);
        const gwl = parseFloat(groundInfo.groundwaterLevel || 3000);
        const gammaS = parseFloat(groundInfo.soilUnitWeight || 18.0);

        const ctc = parseFloat(columnGirder.columnCTC || 3000);
        const colWidth = parseFloat(columnGirder.columnWidth || 500);
        const upperAddH = parseFloat(columnGirder.upperAdditionalHeight || 200);
        const lowerAddH = parseFloat(columnGirder.lowerAdditionalHeight || 200);

        const leftHaunch = haunchData.leftWall || { upper: { width: 300, height: 300 }, lower: { width: 300, height: 300 } };
        const rightHaunch = haunchData.rightWall || { upper: { width: 300, height: 300 }, lower: { width: 300, height: 300 } };
        const middleHaunches = haunchData.middleWalls || [];

        const afUse = antiFloat.use || false;
        const afLeftExt = parseFloat(antiFloat.leftExtension || 500);
        const afRightExt = parseFloat(antiFloat.rightExtension || 500);
        const afThickness = parseFloat(antiFloat.thickness || 300);

        const totalInnerWidth = B_list.reduce((a, b) => a + b, 0);
        const totalMwThickness = middleWalls.reduce((s, mw) => s + parseFloat(mw.thickness || 0), 0);
        const totalWidth = WL + totalInnerWidth + totalMwThickness + WR;
        const totalHeight = LT + H + UT;

        let bottomWidth, bottomDepth;
        if (afUse) {
            bottomWidth = afLeftExt + totalWidth + afRightExt;
            bottomDepth = earthCover + totalHeight + afThickness;
        } else {
            bottomWidth = totalWidth;
            bottomDepth = earthCover + totalHeight;
        }

        const lines = [];
        const add = (text = '') => lines.push(text);

        add('\u2550'.repeat(60));
        add('         부 력 검 토 (Buoyancy Check)');
        add('\u2550'.repeat(60));
        add();

        add('1. 설계 조건');
        add('\u2500'.repeat(55));
        add(`   콘크리트 단위중량 (γc)  = ${bFmt2(GAMMA_C)} kN/m\u00B3`);
        add(`   물의 단위중량 (γw)      = ${bFmt2(GAMMA_W)} kN/m\u00B3`);
        add(`   흙의 단위중량 (γs)      = ${bFmt2(gammaS)} kN/m\u00B3`);
        add(`   토피 (Dc)              = ${bFmt(earthCover)} mm`);
        add(`   지하수위 (GWL)          = ${bFmt(gwl)} mm (지표면 기준)`);
        add();

        add('2. 구조물 제원');
        add('\u2500'.repeat(55));
        const widthParts = [`WL(${bFmt(WL)})`];
        for (let i = 0; i < B_list.length; i++) {
            widthParts.push(`B${i + 1}(${bFmt(B_list[i])})`);
            if (i < middleWalls.length) {
                widthParts.push(`MW${i + 1}(${bFmt(parseFloat(middleWalls[i].thickness || 0))})`);
            }
        }
        widthParts.push(`WR(${bFmt(WR)})`);
        add(`   암거련수              = ${culvertCount}련`);
        add(`   내공높이 (H)          = ${bFmt(H)} mm`);
        add(`   총 폭 (B_total)      = ${widthParts.join(' + ')}`);
        add(`                         = ${bFmt(totalWidth)} mm = ${bFmt3(totalWidth / 1000)} m`);
        add(`   총 높이 (H_total)     = LT(${bFmt(LT)}) + H(${bFmt(H)}) + UT(${bFmt(UT)})`);
        add(`                         = ${bFmt(totalHeight)} mm = ${bFmt3(totalHeight / 1000)} m`);
        if (afUse) {
            add(`   부상방지저판           = 적용`);
            add(`     좌측확장: ${bFmt(afLeftExt)} mm, 우측확장: ${bFmt(afRightExt)} mm, 두께: ${bFmt(afThickness)} mm`);
            add(`     하단 총폭 = ${bFmt(afLeftExt)} + ${bFmt(totalWidth)} + ${bFmt(afRightExt)} = ${bFmt(bottomWidth)} mm`);
        }
        add();

        add('3. 구조물 자중 산정 (단위 m 당)');
        add('\u2500'.repeat(55));
        add('   ※ 구조물 단면을 사각형/삼각형으로 분할하여 산정합니다.');
        add();

        let shapeNo = 0;
        let totalWeight = 0;

        function addRect(label, w, h) {
            shapeNo++;
            const area = w * h;
            const weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [사각형 No.${shapeNo}] ${label}`);
            add(`     크기 = ${bFmt(w)} × ${bFmt(h)} mm`);
            add(`     면적 A = ${bFmt(w)} × ${bFmt(h)} = ${bFmt(area)} mm\u00B2`);
            add(`     무게 W = γc × A / 10\u2076 = ${bFmt2(GAMMA_C)} × ${bFmt(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
            add();
        }

        function addTriangle(label, w, h) {
            if (w <= 0 || h <= 0) return;
            shapeNo++;
            const area = 0.5 * w * h;
            const weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [삼각형 No.${shapeNo}] ${label}`);
            add(`     면적 = 0.5 × ${bFmt(w)} × ${bFmt(h)} = ${bFmt2(area)} mm\u00B2`);
            add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt2(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
            add();
        }

        function addTriangleDouble(label, w, h) {
            if (w <= 0 || h <= 0) return;
            shapeNo++;
            const area = 2 * 0.5 * w * h;
            const weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [삼각형 No.${shapeNo}] ${label}`);
            add(`     면적 = 2 × 0.5 × ${bFmt(w)} × ${bFmt(h)} = ${bFmt2(area)} mm\u00B2`);
            add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt2(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
            add();
        }

        // 상부슬래브
        addRect('상부슬래브', totalWidth, UT);
        // 하부슬래브
        addRect('하부슬래브', totalWidth, LT);
        // 좌측벽체
        addRect('좌측벽체', WL, H);

        // 중간벽체
        for (let i = 0; i < middleWalls.length; i++) {
            const mw = middleWalls[i];
            const mwThickness = parseFloat(mw.thickness || 600);
            const mwType = mw.type || '연속벽';
            const mwHaunch = middleHaunches[i] || {
                upper: { width: 300, height: 300 },
                lower: { width: 300, height: 300 }
            };

            if (mwType === '연속벽') {
                addRect(`중간벽체${i + 1} (연속벽)`, mwThickness, H);
            } else {
                const mhUpperH = parseFloat(mwHaunch.upper.height || 0);
                const mhLowerH = parseFloat(mwHaunch.lower.height || 0);
                add(`   ---- 중간벽체${i + 1} (기둥, CTC=${bFmt(ctc)} mm) ----`);
                add();

                const upperGirderH = mhUpperH + upperAddH;
                shapeNo++;
                let area = mwThickness * upperGirderH;
                let weight = GAMMA_C * area / 1e6;
                totalWeight += weight;
                add(`   [사각형 No.${shapeNo}] 중간벽체${i + 1} 상부종거더 (연속)`);
                add(`     거더높이 = 헌치높이(${bFmt(mhUpperH)}) + 추가높이(${bFmt(upperAddH)}) = ${bFmt(upperGirderH)} mm`);
                add(`     크기 = ${bFmt(mwThickness)} × ${bFmt(upperGirderH)} mm`);
                add(`     면적 A = ${bFmt(mwThickness)} × ${bFmt(upperGirderH)} = ${bFmt(area)} mm\u00B2`);
                add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
                add();

                const lowerGirderH = mhLowerH + lowerAddH;
                shapeNo++;
                area = mwThickness * lowerGirderH;
                weight = GAMMA_C * area / 1e6;
                totalWeight += weight;
                add(`   [사각형 No.${shapeNo}] 중간벽체${i + 1} 하부종거더 (연속)`);
                add(`     거더높이 = 헌치높이(${bFmt(mhLowerH)}) + 추가높이(${bFmt(lowerAddH)}) = ${bFmt(lowerGirderH)} mm`);
                add(`     크기 = ${bFmt(mwThickness)} × ${bFmt(lowerGirderH)} mm`);
                add(`     면적 A = ${bFmt(mwThickness)} × ${bFmt(lowerGirderH)} = ${bFmt(area)} mm\u00B2`);
                add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
                add();

                const colClearH = H - upperGirderH - lowerGirderH;
                if (colClearH > 0 && ctc > 0) {
                    shapeNo++;
                    const areaFull = mwThickness * colClearH;
                    const areaPerM = areaFull * colWidth / ctc;
                    weight = GAMMA_C * areaPerM / 1e6;
                    totalWeight += weight;
                    add(`   [사각형 No.${shapeNo}] 중간벽체${i + 1} 기둥본체 (CTC 고려)`);
                    add(`     기둥높이 = H(${bFmt(H)}) - 상부거더(${bFmt(upperGirderH)}) - 하부거더(${bFmt(lowerGirderH)}) = ${bFmt(colClearH)} mm`);
                    add(`     기둥 단면적 = ${bFmt(mwThickness)} × ${bFmt(colClearH)} = ${bFmt(areaFull)} mm\u00B2`);
                    add(`     단위m 환산 = ${bFmt(areaFull)} × 기둥폭(${bFmt(colWidth)}) / CTC(${bFmt(ctc)})`);
                    add(`                = ${bFmt2(areaPerM)} mm\u00B2/m`);
                    add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt2(areaPerM)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
                    add();
                }
            }
        }

        // 우측벽체
        addRect('우측벽체', WR, H);

        // 헌치 (삼각형)
        add('   \u2500\u2500 헌치 (삼각형) \u2500\u2500');
        add();

        addTriangle('좌측벽 상부헌치', parseFloat(leftHaunch.upper.width || 0), parseFloat(leftHaunch.upper.height || 0));
        addTriangle('좌측벽 하부헌치', parseFloat(leftHaunch.lower.width || 0), parseFloat(leftHaunch.lower.height || 0));

        // 중간벽 헌치 (연속벽/기둥 모두)
        for (let i = 0; i < middleWalls.length; i++) {
            const mwHaunch = middleHaunches[i] || {
                upper: { width: 300, height: 300 },
                lower: { width: 300, height: 300 }
            };
            addTriangleDouble(`중간벽${i + 1} 상부헌치 (양쪽 2개)`,
                parseFloat(mwHaunch.upper.width || 0), parseFloat(mwHaunch.upper.height || 0));
            addTriangleDouble(`중간벽${i + 1} 하부헌치 (양쪽 2개)`,
                parseFloat(mwHaunch.lower.width || 0), parseFloat(mwHaunch.lower.height || 0));
        }

        addTriangle('우측벽 상부헌치', parseFloat(rightHaunch.upper.width || 0), parseFloat(rightHaunch.upper.height || 0));
        addTriangle('우측벽 하부헌치', parseFloat(rightHaunch.lower.width || 0), parseFloat(rightHaunch.lower.height || 0));

        // 부상방지저판
        if (afUse) {
            const afTotalWidth = afLeftExt + totalWidth + afRightExt;
            shapeNo++;
            const area = afTotalWidth * afThickness;
            const weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [사각형 No.${shapeNo}] 부상방지저판`);
            add(`     폭 = ${bFmt(afLeftExt)} + ${bFmt(totalWidth)} + ${bFmt(afRightExt)} = ${bFmt(afTotalWidth)} mm`);
            add(`     크기 = ${bFmt(afTotalWidth)} × ${bFmt(afThickness)} mm`);
            add(`     면적 A = ${bFmt(afTotalWidth)} × ${bFmt(afThickness)} = ${bFmt(area)} mm\u00B2`);
            add(`     무게 W = ${bFmt2(GAMMA_C)} × ${bFmt(area)} / 10\u2076 = ${bFmt2(weight)} kN/m`);
            add();
        }

        add('   ' + '\u2500'.repeat(51));
        add(`   구조물 자중 합계 (Wc) = ${bFmt2(totalWeight)} kN/m`);
        add();

        // 4. 상재토
        add('4. 상재토 무게 (단위 m 당)');
        add('\u2500'.repeat(55));
        const soilArea = totalWidth * earthCover;
        const soilWeight = gammaS * soilArea / 1e6;
        add(`   토피고 = ${bFmt(earthCover)} mm = ${bFmt3(earthCover / 1000)} m`);
        add(`   폭    = ${bFmt(totalWidth)} mm = ${bFmt3(totalWidth / 1000)} m`);
        add(`   면적  = ${bFmt(totalWidth)} × ${bFmt(earthCover)} = ${bFmt(soilArea)} mm\u00B2`);
        add(`   무게 (Ws) = γs × A / 10\u2076 = ${bFmt2(gammaS)} × ${bFmt(soilArea)} / 10\u2076 = ${bFmt2(soilWeight)} kN/m`);
        add();

        // 5. 부력
        add('5. 부력 산정 (단위 m 당)');
        add('\u2500'.repeat(55));
        if (afUse) {
            add(`   구조물 하단 깊이 = 토피(${bFmt(earthCover)}) + 총높이(${bFmt(totalHeight)}) + 부상방지저판(${bFmt(afThickness)})`);
        } else {
            add(`   구조물 하단 깊이 = 토피(${bFmt(earthCover)}) + 총높이(${bFmt(totalHeight)})`);
        }
        add(`                     = ${bFmt(bottomDepth)} mm (지표면 기준)`);
        add(`   지하수위            = ${bFmt(gwl)} mm (지표면 기준)`);
        add();

        let hw = bottomDepth - gwl;
        let buoyancy = 0;
        if (hw <= 0) {
            hw = 0;
            add('   \u2192 지하수위가 구조물 하단보다 깊으므로 부력이 발생하지 않음');
        } else {
            add(`   수두 높이 (hw) = ${bFmt(bottomDepth)} - ${bFmt(gwl)} = ${bFmt(hw)} mm = ${bFmt3(hw / 1000)} m`);
            add(`   부력 작용 폭   = ${bFmt(bottomWidth)} mm = ${bFmt3(bottomWidth / 1000)} m`);
            add();
            buoyancy = GAMMA_W * (hw / 1000) * (bottomWidth / 1000);
            add(`   부력 (U) = γw × hw × B_bottom`);
            add(`            = ${bFmt2(GAMMA_W)} × ${bFmt3(hw / 1000)} × ${bFmt3(bottomWidth / 1000)}`);
            add(`            = ${bFmt2(buoyancy)} kN/m`);
        }
        add();

        // 6. 안전율
        add('6. 안전율 검토');
        add('\u2500'.repeat(55));
        const totalResist = totalWeight + soilWeight;
        add(`   저항력 (R) = Wc + Ws`);
        add(`              = ${bFmt2(totalWeight)} + ${bFmt2(soilWeight)}`);
        add(`              = ${bFmt2(totalResist)} kN/m`);
        add();
        add(`   부력 (U)   = ${bFmt2(buoyancy)} kN/m`);
        add();

        if (buoyancy > 0) {
            const fs = totalResist / buoyancy;
            add(`   안전율 (FS) = R / U`);
            add(`               = ${bFmt2(totalResist)} / ${bFmt2(buoyancy)}`);
            add(`               = ${bFmt2(fs)}`);
            add();
            add(`   필요 안전율 \u2265 1.20`);
            add();
            if (fs >= 1.20) {
                add(`   FS = ${bFmt2(fs)} \u2265 1.20  \u2192  O.K.`);
            } else {
                add(`   FS = ${bFmt2(fs)} < 1.20  \u2192  N.G.`);
            }
        } else {
            add('   지하수위가 구조물 하단보다 깊으므로 부력이 작용하지 않습니다.');
            add('   부력 검토가 필요하지 않습니다. \u2192 O.K.');
        }
        add();
        add('\u2550'.repeat(60));
        return lines.join('\n');
    }

    function showBuoyancyCheckModal() {
        const sectionData = state.getSectionData();
        const groundInfo = state.getGroundInfo();
        const report = generateBuoyancyReport(sectionData, groundInfo);

        const existing = document.getElementById('buoyancy-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'buoyancy-modal';
        overlay.className = 'modal-overlay';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const modal = document.createElement('div');
        modal.className = 'modal-container';

        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = '<span class="modal-title">부력 검토 결과</span><button class="modal-close-btn" title="닫기">\u2715</button>';
        header.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
        modal.appendChild(header);

        const body = document.createElement('div');
        body.className = 'modal-body';
        const pre = document.createElement('pre');
        pre.className = 'buoyancy-report';
        pre.textContent = report;
        body.appendChild(pre);
        modal.appendChild(body);

        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-btn';
        closeBtn.textContent = '닫기';
        closeBtn.addEventListener('click', () => overlay.remove());
        footer.appendChild(closeBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const onKeydown = (e) => {
            if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKeydown); }
        };
        document.addEventListener('keydown', onKeydown);
    }

    function renderBuoyancyCheckForm(container) {
        container.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="margin-bottom: 16px; color: #555;">
                    부력과 구조물에 작용하는 수직하중을 비교하여 안전율을 검토합니다.
                </p>
                <button id="btn-buoyancy-check" style="
                    padding: 10px 24px;
                    background-color: #0066cc;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    font-size: 13px;
                    cursor: pointer;
                ">부력 검토 실행</button>
            </div>
        `;
        container.querySelector('#btn-buoyancy-check').addEventListener('click', () => {
            // SVG 뷰어에 분할 도형 그리기
            const renderer = getRenderer();
            if (renderer) {
                renderer.renderBuoyancyShapes(state.getSectionData());
                const zp = getZoomPan();
                if (zp) zp.reset();
            }
            showBuoyancyCheckModal();
        });
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
