// projectInfo.js - 프로젝트 정보 폼

import state from '../state.js';

export function renderProjectInfoForm(container) {
    const data = state.getProjectInfo();

    container.innerHTML = `
        <div class="form-grid">
            <label class="form-label">사업명</label>
            <input type="text" class="form-input" id="input-businessName"
                   value="${data.businessName || ''}"
                   placeholder="사업명을 입력하세요">

            <label class="form-label">발주처</label>
            <input type="text" class="form-input" id="input-client"
                   value="${data.client || ''}"
                   placeholder="발주처를 입력하세요">

            <label class="form-label">시공사</label>
            <input type="text" class="form-input" id="input-constructor"
                   value="${data.constructor || ''}"
                   placeholder="시공사를 입력하세요">

            <label class="form-label">현장명</label>
            <input type="text" class="form-input" id="input-siteName"
                   value="${data.siteName || ''}"
                   placeholder="현장명을 입력하세요">
        </div>
    `;

    // 이벤트 리스너 등록
    const fields = ['businessName', 'client', 'constructor', 'siteName'];
    fields.forEach(field => {
        const input = document.getElementById(`input-${field}`);
        if (input) {
            input.addEventListener('change', (e) => {
                state.updateProjectInfo(field, e.target.value);
            });
            input.addEventListener('input', (e) => {
                state.updateProjectInfo(field, e.target.value);
            });
        }
    });
}

export default { renderProjectInfoForm };
