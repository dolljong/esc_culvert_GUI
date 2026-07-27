// basicEnvironment.js - 기본환경 폼

import state from '../state.js';

const DESIGN_STANDARDS = [
    '콘크리트구조기준',
    '도로교설계기준(강도설계법)',
    '도로교설계기준(한계상태설계법)'
];

const ENVIRONMENT_CONDITIONS = [
    '건조 환경',
    '습윤 환경',
    '부식성 환경',
    '고부식성 환경'
];

export function renderBasicEnvironmentForm(container) {
    const data = state.getDesignConditions();

    // 설계기준 옵션 생성
    const standardOptions = DESIGN_STANDARDS.map(s =>
        `<option value="${s}" ${data.standard === s ? 'selected' : ''}>${s}</option>`
    ).join('');

    // 환경조건 옵션 생성
    const envOptions = ENVIRONMENT_CONDITIONS.map(e =>
        `<option value="${e}" ${data.environment === e ? 'selected' : ''}>${e}</option>`
    ).join('');

    container.innerHTML = `
        <div class="form-grid">
            <label class="form-label">설계기준</label>
            <select class="form-select" id="select-standard">
                ${standardOptions}
            </select>

            <label class="form-label">설계수명</label>
            <div class="input-with-unit">
                <input type="text" class="form-input" id="input-designLife"
                       value="${data.designLife || '100년'}" style="width: 100px;">
            </div>

            <label class="form-label">환경조건</label>
            <select class="form-select" id="select-environment">
                ${envOptions}
            </select>
        </div>
    `;

    // 이벤트 리스너 등록
    document.getElementById('select-standard').addEventListener('change', (e) => {
        state.updateDesignConditions('standard', e.target.value);
    });

    document.getElementById('input-designLife').addEventListener('change', (e) => {
        state.updateDesignConditions('designLife', e.target.value);
    });

    document.getElementById('select-environment').addEventListener('change', (e) => {
        state.updateDesignConditions('environment', e.target.value);
    });
}

export default { renderBasicEnvironmentForm };
