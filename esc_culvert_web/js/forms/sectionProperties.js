// sectionProperties.js - 단면제원 폼 (핵심)

import state from '../state.js';
import { getRenderer } from '../viewer/svgRenderer.js';

const WALL_TYPES = ['연속벽', '기둥'];

let currentSectionTab = 'section';

export function renderSectionPropertiesForm(container) {
    const data = state.getSectionData();

    container.innerHTML = `
        <div class="culvert-count-control">
            <label for="input-culvert-count">암거 련수:</label>
            <input type="number" class="form-input" id="input-culvert-count"
                   value="${data.culvert_count}"
                   min="1" max="10" step="1">
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

    // 암거 련수 변경 이벤트
    document.getElementById('input-culvert-count').addEventListener('change', (e) => {
        const count = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
        e.target.value = count;
        state.setCulvertCount(count);
        renderSectionPropertiesForm(container);
        updateSvg();
    });

    // 탭 클릭 이벤트
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

// 탭 콘텐츠 렌더링
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

// 단면제원 테이블 생성
function createSectionTable(data) {
    const culvertCount = data.culvert_count;
    const middleWallCount = culvertCount - 1;

    // 열 개수 계산
    const innerCols = 2 + culvertCount; // H, H4, B1...Bn
    const slabCols = 2; // UT, LT
    const middleWallCols = middleWallCount * 2; // 타입, 두께 쌍

    // 헤더 Row 0: 대분류
    let header0 = '<tr>';
    header0 += `<th colspan="${innerCols}" class="cat-inner">내공제원</th>`;
    header0 += `<th colspan="${slabCols}" class="cat-slab">슬래브두께</th>`;
    header0 += `<th colspan="1" class="cat-wall-left">좌측벽</th>`;
    if (middleWallCount > 0) {
        header0 += `<th colspan="${middleWallCols}" class="cat-wall-middle">중간벽</th>`;
    }
    header0 += `<th colspan="1" class="cat-wall-right">우측벽</th>`;
    header0 += '</tr>';

    // 헤더 Row 1: 소분류
    let header1 = '<tr>';
    header1 += '<th>높이<br>H</th>';
    header1 += '<th>H4</th>';
    for (let i = 0; i < culvertCount; i++) {
        header1 += `<th>폭<br>B${i + 1}</th>`;
    }
    header1 += '<th>상부<br>UT</th>';
    header1 += '<th>하부<br>LT</th>';
    header1 += '<th>WL</th>';
    for (let i = 0; i < middleWallCount; i++) {
        header1 += `<th>벽체${i + 1}</th>`;
        header1 += `<th>두께${i + 1}</th>`;
    }
    header1 += '<th>WR</th>';
    header1 += '</tr>';

    // 데이터 Row
    let dataRow = '<tr>';
    dataRow += `<td><input type="number" id="input-H" value="${data.H}" data-field="H"></td>`;
    dataRow += `<td><input type="number" id="input-H4" value="${data.H4}" data-field="H4"></td>`;
    for (let i = 0; i < culvertCount; i++) {
        const bValue = data.B[i] !== undefined ? data.B[i] : 4000;
        dataRow += `<td><input type="number" id="input-B${i}" value="${bValue}" data-field="B" data-index="${i}"></td>`;
    }
    dataRow += `<td><input type="number" id="input-UT" value="${data.UT}" data-field="UT"></td>`;
    dataRow += `<td><input type="number" id="input-LT" value="${data.LT}" data-field="LT"></td>`;
    dataRow += `<td><input type="number" id="input-WL" value="${data.WL}" data-field="WL"></td>`;

    for (let i = 0; i < middleWallCount; i++) {
        const wall = data.middle_walls[i] || { type: '연속벽', thickness: 600 };
        const typeOptions = WALL_TYPES.map(t =>
            `<option value="${t}" ${wall.type === t ? 'selected' : ''}>${t}</option>`
        ).join('');
        dataRow += `<td><select id="input-wallType${i}" data-field="wallType" data-index="${i}">${typeOptions}</select></td>`;
        dataRow += `<td><input type="number" id="input-wallThickness${i}" value="${wall.thickness}" data-field="wallThickness" data-index="${i}"></td>`;
    }

    dataRow += `<td><input type="number" id="input-WR" value="${data.WR}" data-field="WR"></td>`;
    dataRow += '</tr>';

    return `
        <table class="section-table">
            <thead>
                ${header0}
                ${header1}
            </thead>
            <tbody>
                ${dataRow}
            </tbody>
        </table>
        <div style="margin-top: 12px; color: var(--text-secondary); font-size: 11px;">
            * 모든 치수 단위: mm
        </div>
    `;
}

// 내부헌치 기본값 헬퍼
function safeCorner(c) {
    if (!c) return { width: 150, height: 150 };
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

// 내부헌치 폼 생성
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

// 내부헌치 이벤트 등록
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
            if (wall === 'leftWall') {
                renderSectionTabContent();
            }
        });
    });
}

// 기둥및종거더 폼 생성
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

// 기둥및종거더 이벤트 등록
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

// 부상방지저판 폼 생성
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

// 부상방지저판 이벤트 등록
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

// 테이블 입력 이벤트 등록
function registerTableEvents() {
    const table = document.querySelector('.section-table');
    if (!table) return;

    const inputs = table.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.addEventListener('change', handleInputChange);
    });
}

// 입력 변경 처리
function handleInputChange(e) {
    const field = e.target.dataset.field;
    const index = parseInt(e.target.dataset.index);
    const value = e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;

    const data = state.getSectionData();

    switch (field) {
        case 'H':
            state.updateSectionData('H', value);
            break;
        case 'H4':
            state.updateSectionData('H4', value);
            break;
        case 'B':
            const newB = [...data.B];
            newB[index] = value;
            state.updateSectionData('B', newB);
            break;
        case 'UT':
            state.updateSectionData('UT', value);
            break;
        case 'LT':
            state.updateSectionData('LT', value);
            break;
        case 'WL':
            state.updateSectionData('WL', value);
            break;
        case 'WR':
            state.updateSectionData('WR', value);
            break;
        case 'wallType':
            const newWallsType = [...data.middle_walls];
            if (newWallsType[index]) {
                newWallsType[index] = { ...newWallsType[index], type: value };
                state.updateSectionData('middle_walls', newWallsType);
            }
            break;
        case 'wallThickness':
            const newWallsThick = [...data.middle_walls];
            if (newWallsThick[index]) {
                newWallsThick[index] = { ...newWallsThick[index], thickness: value };
                state.updateSectionData('middle_walls', newWallsThick);
            }
            break;
    }

    // SVG 업데이트
    updateSvg();
}

// SVG 업데이트
function updateSvg() {
    const renderer = getRenderer();
    if (renderer) {
        renderer.render(state.getSectionData());
    }
}

export default { renderSectionPropertiesForm };
