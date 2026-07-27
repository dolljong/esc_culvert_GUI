// materials.js - 재료특성 폼

import state from '../state.js';

export function renderMaterialsForm(container) {
    const data = state.getMaterials();

    container.innerHTML = `
        <div class="form-grid">
            <label class="form-label">콘크리트 강도 (fck)</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-fck"
                       value="${data.fck}"
                       min="0" max="1000" step="0.1"
                       style="width: 100px;">
                <span class="input-unit">MPa</span>
            </div>

            <label class="form-label">철근 항복강도 (fy)</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-fy"
                       value="${data.fy}"
                       min="0" max="1000" step="0.1"
                       style="width: 100px;">
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

    // 이벤트 리스너 등록
    document.getElementById('input-fck').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 30.0;
        state.updateMaterials('fck', value);
    });

    document.getElementById('input-fy').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 400.0;
        state.updateMaterials('fy', value);
    });
}

export default { renderMaterialsForm };
