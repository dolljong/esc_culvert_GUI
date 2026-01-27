// sectionProperties.js - 단면제원 폼 (핵심)

import state from '../state.js';
import { getRenderer } from '../viewer/svgRenderer.js';

const WALL_TYPES = ['연속벽', '기둥'];

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

        <div class="section-table-container">
            ${createSectionTable(data)}
        </div>
    `;

    // 암거 련수 변경 이벤트
    document.getElementById('input-culvert-count').addEventListener('change', (e) => {
        const count = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
        e.target.value = count;
        state.setCulvertCount(count);
        // 테이블 재생성
        renderSectionPropertiesForm(container);
        // SVG 업데이트
        updateSvg();
    });

    // 테이블 입력 이벤트 등록
    registerTableEvents();
}

// 단면제원 테이블 생성
function createSectionTable(data) {
    const culvertCount = data.culvert_count;
    const middleWallCount = culvertCount - 1;

    // 열 개수 계산
    // H, H4, B1~Bn, UT, LT, WL, [벽체1, 두께1]...[벽체m, 두께m], WR
    const innerCols = 2 + culvertCount; // H, H4, B1...Bn
    const slabCols = 2; // UT, LT
    const leftWallCol = 1; // WL
    const middleWallCols = middleWallCount * 2; // 타입, 두께 쌍
    const rightWallCol = 1; // WR
    const totalCols = innerCols + slabCols + leftWallCol + middleWallCols + rightWallCol;

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

    // H
    dataRow += `<td><input type="number" id="input-H" value="${data.H}" data-field="H"></td>`;
    // H4
    dataRow += `<td><input type="number" id="input-H4" value="${data.H4}" data-field="H4"></td>`;
    // B1~Bn
    for (let i = 0; i < culvertCount; i++) {
        const bValue = data.B[i] !== undefined ? data.B[i] : 4000;
        dataRow += `<td><input type="number" id="input-B${i}" value="${bValue}" data-field="B" data-index="${i}"></td>`;
    }
    // UT
    dataRow += `<td><input type="number" id="input-UT" value="${data.UT}" data-field="UT"></td>`;
    // LT
    dataRow += `<td><input type="number" id="input-LT" value="${data.LT}" data-field="LT"></td>`;
    // WL
    dataRow += `<td><input type="number" id="input-WL" value="${data.WL}" data-field="WL"></td>`;

    // 중간벽
    for (let i = 0; i < middleWallCount; i++) {
        const wall = data.middle_walls[i] || { type: '연속벽', thickness: 600 };
        // 벽체 타입 (select)
        const typeOptions = WALL_TYPES.map(t =>
            `<option value="${t}" ${wall.type === t ? 'selected' : ''}>${t}</option>`
        ).join('');
        dataRow += `<td><select id="input-wallType${i}" data-field="wallType" data-index="${i}">${typeOptions}</select></td>`;
        // 벽체 두께
        dataRow += `<td><input type="number" id="input-wallThickness${i}" value="${wall.thickness}" data-field="wallThickness" data-index="${i}"></td>`;
    }

    // WR
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

// 테이블 입력 이벤트 등록
function registerTableEvents() {
    const table = document.querySelector('.section-table');
    if (!table) return;

    // 모든 입력 필드에 이벤트 등록
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
