// state.js - 상태 관리

// 기본 상태 구조
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

// 앱 상태 객체
let appState = JSON.parse(JSON.stringify(defaultState));

// 이벤트 리스너 저장소
const listeners = {
    menuChange: [],
    sectionDataChange: [],
    stateChange: []
};

// 상태 관리 함수들
export const state = {
    // 현재 상태 가져오기
    get() {
        return appState;
    },

    // 전체 상태 설정
    set(newState) {
        appState = { ...appState, ...newState };
        this.emit('stateChange', appState);
    },

    // 메뉴 변경
    setCurrentMenu(menu) {
        appState.currentMenu = menu;
        this.emit('menuChange', menu);
    },

    getCurrentMenu() {
        return appState.currentMenu;
    },

    // 프로젝트 정보 업데이트
    updateProjectInfo(key, value) {
        appState.projectInfo[key] = value;
        this.emit('stateChange', appState);
    },

    getProjectInfo() {
        return appState.projectInfo;
    },

    // 설계조건 업데이트
    updateDesignConditions(key, value) {
        appState.designConditions[key] = value;
        this.emit('stateChange', appState);
    },

    getDesignConditions() {
        return appState.designConditions;
    },

    // 재료 특성 업데이트
    updateMaterials(key, value) {
        appState.materials[key] = value;
        this.emit('stateChange', appState);
    },

    getMaterials() {
        return appState.materials;
    },

    // 지반정보 업데이트
    updateGroundInfo(key, value) {
        appState.groundInfo[key] = value;
        this.emit('stateChange', appState);
    },

    getGroundInfo() {
        return appState.groundInfo;
    },

    // 단면 데이터 업데이트
    updateSectionData(key, value) {
        appState.sectionData[key] = value;
        this.emit('sectionDataChange', appState.sectionData);
    },

    setSectionData(data) {
        appState.sectionData = { ...appState.sectionData, ...data };
        this.emit('sectionDataChange', appState.sectionData);
    },

    getSectionData() {
        return appState.sectionData;
    },

    // 암거 련수 변경 (중간벽 배열 조정)
    setCulvertCount(count) {
        const oldCount = appState.sectionData.culvert_count;
        count = Math.max(1, Math.min(10, count));

        // B 배열 크기 조정
        const newB = [...appState.sectionData.B];
        while (newB.length < count) {
            newB.push(4000); // 기본값 4000mm
        }
        newB.length = count;

        // 중간벽 배열 크기 조정
        const newMiddleWalls = [...appState.sectionData.middle_walls];
        const middleWallCount = count - 1;
        while (newMiddleWalls.length < middleWallCount) {
            newMiddleWalls.push({ type: '연속벽', thickness: 600 });
        }
        newMiddleWalls.length = middleWallCount;

        // 헌치 중간벽 배열 크기 조정
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

    // 상태 초기화
    reset() {
        appState = JSON.parse(JSON.stringify(defaultState));
        this.emit('stateChange', appState);
        this.emit('sectionDataChange', appState.sectionData);
        this.emit('menuChange', appState.currentMenu);
    },

    // 이벤트 리스너 등록
    on(event, callback) {
        if (listeners[event]) {
            listeners[event].push(callback);
        }
    },

    // 이벤트 리스너 제거
    off(event, callback) {
        if (listeners[event]) {
            listeners[event] = listeners[event].filter(cb => cb !== callback);
        }
    },

    // 이벤트 발생
    emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(callback => callback(data));
        }
    },

    // JSON으로 내보내기
    toJSON() {
        return JSON.stringify(appState, null, 2);
    },

    // JSON에서 불러오기
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

export default state;
