// groundInfo.js - 지반정보 폼

import state from '../state.js';

export function renderGroundInfoForm(container) {
    const data = state.getGroundInfo();

    container.innerHTML = `
        <div class="form-grid">
            <label class="form-label">토피</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-earthCoverDepth"
                       value="${data.earthCoverDepth}"
                       min="0" step="100"
                       style="width: 100px;">
                <span class="input-unit">mm</span>
            </div>

            <label class="form-label">지하수위</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-groundwaterLevel"
                       value="${data.groundwaterLevel}"
                       min="0" step="100"
                       style="width: 100px;">
                <span class="input-unit">mm</span>
            </div>

            <label class="form-label">흙의 내부마찰각</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-frictionAngle"
                       value="${data.frictionAngle}"
                       min="0" max="90" step="1"
                       style="width: 100px;">
                <span class="input-unit">도</span>
            </div>

            <label class="form-label">흙의 단위중량</label>
            <div class="input-with-unit">
                <input type="number" class="form-input" id="input-soilUnitWeight"
                       value="${data.soilUnitWeight}"
                       min="0" max="100" step="0.1"
                       style="width: 100px;">
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

    // 이벤트 리스너 등록
    document.getElementById('input-earthCoverDepth').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 2000;
        state.updateGroundInfo('earthCoverDepth', value);
    });

    document.getElementById('input-groundwaterLevel').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 3000;
        state.updateGroundInfo('groundwaterLevel', value);
    });

    document.getElementById('input-frictionAngle').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 30;
        state.updateGroundInfo('frictionAngle', value);
    });

    document.getElementById('input-soilUnitWeight').addEventListener('change', (e) => {
        const value = parseFloat(e.target.value) || 18;
        state.updateGroundInfo('soilUnitWeight', value);
    });
}

export default { renderGroundInfoForm };
