// buoyancyCheck.js - 부력 검토 계산 및 모달 팝업

import state from '../state.js';
import { getRenderer } from '../viewer/svgRenderer.js';
import { getZoomPan } from '../viewer/zoomPan.js';

const GAMMA_C = 24.5;  // 콘크리트 단위중량 (kN/m³)
const GAMMA_W = 9.81;  // 물의 단위중량 (kN/m³)

function fmt(val) {
    if (val === Math.floor(val)) return Math.floor(val).toLocaleString();
    return val.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmt2(val) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt3(val) {
    return val.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

/**
 * 부력검토 계산 보고서 생성
 */
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

    // 기본 치수
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

    add('═'.repeat(60));
    add('         부 력 검 토 (Buoyancy Check)');
    add('═'.repeat(60));
    add();

    // 1. 설계 조건
    add('1. 설계 조건');
    add('─'.repeat(55));
    add(`   콘크리트 단위중량 (γc)  = ${fmt2(GAMMA_C)} kN/m³`);
    add(`   물의 단위중량 (γw)      = ${fmt2(GAMMA_W)} kN/m³`);
    add(`   흙의 단위중량 (γs)      = ${fmt2(gammaS)} kN/m³`);
    add(`   토피 (Dc)              = ${fmt(earthCover)} mm`);
    add(`   지하수위 (GWL)          = ${fmt(gwl)} mm (지표면 기준)`);
    add();

    // 2. 구조물 제원
    add('2. 구조물 제원');
    add('─'.repeat(55));

    const widthParts = [`WL(${fmt(WL)})`];
    for (let i = 0; i < B_list.length; i++) {
        widthParts.push(`B${i + 1}(${fmt(B_list[i])})`);
        if (i < middleWalls.length) {
            widthParts.push(`MW${i + 1}(${fmt(parseFloat(middleWalls[i].thickness || 0))})`);
        }
    }
    widthParts.push(`WR(${fmt(WR)})`);

    add(`   암거련수              = ${culvertCount}련`);
    add(`   내공높이 (H)          = ${fmt(H)} mm`);
    add(`   총 폭 (B_total)      = ${widthParts.join(' + ')}`);
    add(`                         = ${fmt(totalWidth)} mm = ${fmt3(totalWidth / 1000)} m`);
    add(`   총 높이 (H_total)     = LT(${fmt(LT)}) + H(${fmt(H)}) + UT(${fmt(UT)})`);
    add(`                         = ${fmt(totalHeight)} mm = ${fmt3(totalHeight / 1000)} m`);

    if (afUse) {
        add(`   부상방지저판           = 적용`);
        add(`     좌측확장: ${fmt(afLeftExt)} mm, 우측확장: ${fmt(afRightExt)} mm, 두께: ${fmt(afThickness)} mm`);
        add(`     하단 총폭 = ${fmt(afLeftExt)} + ${fmt(totalWidth)} + ${fmt(afRightExt)} = ${fmt(bottomWidth)} mm`);
    }
    add();

    // 3. 구조물 자중 산정
    add('3. 구조물 자중 산정 (단위 m 당)');
    add('─'.repeat(55));
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
        add(`     크기 = ${fmt(w)} × ${fmt(h)} mm`);
        add(`     면적 A = ${fmt(w)} × ${fmt(h)} = ${fmt(area)} mm²`);
        add(`     무게 W = γc × A / 10⁶ = ${fmt2(GAMMA_C)} × ${fmt(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
        add();
    }

    function addRectCtc(label, w, h, colW, ctcVal) {
        shapeNo++;
        const areaFull = w * h;
        const areaPerM = areaFull * colW / ctcVal;
        const weight = GAMMA_C * areaPerM / 1e6;
        totalWeight += weight;
        add(`   [사각형 No.${shapeNo}] ${label}`);
        add(`     기둥높이 = ${fmt(h)} mm`);
        add(`     기둥 단면적 = ${fmt(w)} × ${fmt(h)} = ${fmt(areaFull)} mm²`);
        add(`     단위m 환산 = ${fmt(areaFull)} × 기둥폭(${fmt(colW)}) / CTC(${fmt(ctcVal)})`);
        add(`                = ${fmt2(areaPerM)} mm²/m`);
        add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt2(areaPerM)} / 10⁶ = ${fmt2(weight)} kN/m`);
        add();
    }

    function addTriangle(label, w, h) {
        if (w <= 0 || h <= 0) return;
        shapeNo++;
        const area = 0.5 * w * h;
        const weight = GAMMA_C * area / 1e6;
        totalWeight += weight;
        add(`   [삼각형 No.${shapeNo}] ${label}`);
        add(`     면적 = 0.5 × ${fmt(w)} × ${fmt(h)} = ${fmt2(area)} mm²`);
        add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt2(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
        add();
    }

    function addTriangleDouble(label, w, h) {
        if (w <= 0 || h <= 0) return;
        shapeNo++;
        const area = 2 * 0.5 * w * h;
        const weight = GAMMA_C * area / 1e6;
        totalWeight += weight;
        add(`   [삼각형 No.${shapeNo}] ${label}`);
        add(`     면적 = 2 × 0.5 × ${fmt(w)} × ${fmt(h)} = ${fmt2(area)} mm²`);
        add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt2(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
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

            add(`   ---- 중간벽체${i + 1} (기둥, CTC=${fmt(ctc)} mm) ----`);
            add();

            // 상부종거더
            const upperGirderH = mhUpperH + upperAddH;
            shapeNo++;
            let area = mwThickness * upperGirderH;
            let weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [사각형 No.${shapeNo}] 중간벽체${i + 1} 상부종거더 (연속)`);
            add(`     거더높이 = 헌치높이(${fmt(mhUpperH)}) + 추가높이(${fmt(upperAddH)}) = ${fmt(upperGirderH)} mm`);
            add(`     크기 = ${fmt(mwThickness)} × ${fmt(upperGirderH)} mm`);
            add(`     면적 A = ${fmt(mwThickness)} × ${fmt(upperGirderH)} = ${fmt(area)} mm²`);
            add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
            add();

            // 하부종거더
            const lowerGirderH = mhLowerH + lowerAddH;
            shapeNo++;
            area = mwThickness * lowerGirderH;
            weight = GAMMA_C * area / 1e6;
            totalWeight += weight;
            add(`   [사각형 No.${shapeNo}] 중간벽체${i + 1} 하부종거더 (연속)`);
            add(`     거더높이 = 헌치높이(${fmt(mhLowerH)}) + 추가높이(${fmt(lowerAddH)}) = ${fmt(lowerGirderH)} mm`);
            add(`     크기 = ${fmt(mwThickness)} × ${fmt(lowerGirderH)} mm`);
            add(`     면적 A = ${fmt(mwThickness)} × ${fmt(lowerGirderH)} = ${fmt(area)} mm²`);
            add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
            add();

            // 기둥본체
            const colClearH = H - upperGirderH - lowerGirderH;
            if (colClearH > 0 && ctc > 0) {
                addRectCtc(`중간벽체${i + 1} 기둥본체 (CTC 고려)`, mwThickness, colClearH, colWidth, ctc);
            }
        }
    }

    // 우측벽체
    addRect('우측벽체', WR, H);

    // 헌치 (삼각형)
    add('   ── 헌치 (삼각형) ──');
    add();

    // 좌측벽 헌치
    addTriangle('좌측벽 상부헌치',
        parseFloat(leftHaunch.upper.width || 0),
        parseFloat(leftHaunch.upper.height || 0));
    addTriangle('좌측벽 하부헌치',
        parseFloat(leftHaunch.lower.width || 0),
        parseFloat(leftHaunch.lower.height || 0));

    // 중간벽 헌치 (연속벽/기둥 모두 - 헌치는 인접 셀로 돌출되어 거더와 별개)
    for (let i = 0; i < middleWalls.length; i++) {
        const mwHaunch = middleHaunches[i] || {
            upper: { width: 300, height: 300 },
            lower: { width: 300, height: 300 }
        };

        addTriangleDouble(`중간벽${i + 1} 상부헌치 (양쪽 2개)`,
            parseFloat(mwHaunch.upper.width || 0),
            parseFloat(mwHaunch.upper.height || 0));
        addTriangleDouble(`중간벽${i + 1} 하부헌치 (양쪽 2개)`,
            parseFloat(mwHaunch.lower.width || 0),
            parseFloat(mwHaunch.lower.height || 0));
    }

    // 우측벽 헌치
    addTriangle('우측벽 상부헌치',
        parseFloat(rightHaunch.upper.width || 0),
        parseFloat(rightHaunch.upper.height || 0));
    addTriangle('우측벽 하부헌치',
        parseFloat(rightHaunch.lower.width || 0),
        parseFloat(rightHaunch.lower.height || 0));

    // 부상방지저판
    if (afUse) {
        const afTotalWidth = afLeftExt + totalWidth + afRightExt;
        shapeNo++;
        const area = afTotalWidth * afThickness;
        const weight = GAMMA_C * area / 1e6;
        totalWeight += weight;
        add(`   [사각형 No.${shapeNo}] 부상방지저판`);
        add(`     폭 = ${fmt(afLeftExt)} + ${fmt(totalWidth)} + ${fmt(afRightExt)} = ${fmt(afTotalWidth)} mm`);
        add(`     크기 = ${fmt(afTotalWidth)} × ${fmt(afThickness)} mm`);
        add(`     면적 A = ${fmt(afTotalWidth)} × ${fmt(afThickness)} = ${fmt(area)} mm²`);
        add(`     무게 W = ${fmt2(GAMMA_C)} × ${fmt(area)} / 10⁶ = ${fmt2(weight)} kN/m`);
        add();
    }

    add('   ' + '─'.repeat(51));
    add(`   구조물 자중 합계 (Wc) = ${fmt2(totalWeight)} kN/m`);
    add();

    // 4. 상재토 무게
    add('4. 상재토 무게 (단위 m 당)');
    add('─'.repeat(55));
    const soilArea = totalWidth * earthCover;
    const soilWeight = gammaS * soilArea / 1e6;
    add(`   토피고 = ${fmt(earthCover)} mm = ${fmt3(earthCover / 1000)} m`);
    add(`   폭    = ${fmt(totalWidth)} mm = ${fmt3(totalWidth / 1000)} m`);
    add(`   면적  = ${fmt(totalWidth)} × ${fmt(earthCover)} = ${fmt(soilArea)} mm²`);
    add(`   무게 (Ws) = γs × A / 10⁶ = ${fmt2(gammaS)} × ${fmt(soilArea)} / 10⁶ = ${fmt2(soilWeight)} kN/m`);
    add();

    // 5. 부력 산정
    add('5. 부력 산정 (단위 m 당)');
    add('─'.repeat(55));

    if (afUse) {
        add(`   구조물 하단 깊이 = 토피(${fmt(earthCover)}) + 총높이(${fmt(totalHeight)}) + 부상방지저판(${fmt(afThickness)})`);
    } else {
        add(`   구조물 하단 깊이 = 토피(${fmt(earthCover)}) + 총높이(${fmt(totalHeight)})`);
    }
    add(`                     = ${fmt(bottomDepth)} mm (지표면 기준)`);
    add(`   지하수위            = ${fmt(gwl)} mm (지표면 기준)`);
    add();

    let hw = bottomDepth - gwl;
    let buoyancy = 0;
    if (hw <= 0) {
        hw = 0;
        add('   → 지하수위가 구조물 하단보다 깊으므로 부력이 발생하지 않음');
    } else {
        add(`   수두 높이 (hw) = ${fmt(bottomDepth)} - ${fmt(gwl)} = ${fmt(hw)} mm = ${fmt3(hw / 1000)} m`);
        add(`   부력 작용 폭   = ${fmt(bottomWidth)} mm = ${fmt3(bottomWidth / 1000)} m`);
        add();
        buoyancy = GAMMA_W * (hw / 1000) * (bottomWidth / 1000);
        add(`   부력 (U) = γw × hw × B_bottom`);
        add(`            = ${fmt2(GAMMA_W)} × ${fmt3(hw / 1000)} × ${fmt3(bottomWidth / 1000)}`);
        add(`            = ${fmt2(buoyancy)} kN/m`);
    }
    add();

    // 6. 안전율 검토
    add('6. 안전율 검토');
    add('─'.repeat(55));

    const totalResist = totalWeight + soilWeight;
    add(`   저항력 (R) = Wc + Ws`);
    add(`              = ${fmt2(totalWeight)} + ${fmt2(soilWeight)}`);
    add(`              = ${fmt2(totalResist)} kN/m`);
    add();
    add(`   부력 (U)   = ${fmt2(buoyancy)} kN/m`);
    add();

    if (buoyancy > 0) {
        const fs = totalResist / buoyancy;
        add(`   안전율 (FS) = R / U`);
        add(`               = ${fmt2(totalResist)} / ${fmt2(buoyancy)}`);
        add(`               = ${fmt2(fs)}`);
        add();
        add(`   필요 안전율 ≥ 1.20`);
        add();
        if (fs >= 1.20) {
            add(`   FS = ${fmt2(fs)} ≥ 1.20  →  O.K.`);
        } else {
            add(`   FS = ${fmt2(fs)} < 1.20  →  N.G.`);
        }
    } else {
        add('   지하수위가 구조물 하단보다 깊으므로 부력이 작용하지 않습니다.');
        add('   부력 검토가 필요하지 않습니다. → O.K.');
    }

    add();
    add('═'.repeat(60));

    return lines.join('\n');
}

/**
 * 부력검토 모달 팝업 표시
 */
export function showBuoyancyCheckModal() {
    const sectionData = state.getSectionData();
    const groundInfo = state.getGroundInfo();
    const report = generateBuoyancyReport(sectionData, groundInfo);

    // 기존 모달 제거
    const existing = document.getElementById('buoyancy-modal');
    if (existing) existing.remove();

    // 모달 오버레이
    const overlay = document.createElement('div');
    overlay.id = 'buoyancy-modal';
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // 모달 컨테이너
    const modal = document.createElement('div');
    modal.className = 'modal-container';

    // 헤더
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `
        <span class="modal-title">부력 검토 결과</span>
        <button class="modal-close-btn" title="닫기">✕</button>
    `;
    header.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
    modal.appendChild(header);

    // 본문 (텍스트 뷰어)
    const body = document.createElement('div');
    body.className = 'modal-body';

    const pre = document.createElement('pre');
    pre.className = 'buoyancy-report';
    pre.textContent = report;
    body.appendChild(pre);
    modal.appendChild(body);

    // 푸터 버튼
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

    // ESC 키로 닫기
    const onKeydown = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', onKeydown);
        }
    };
    document.addEventListener('keydown', onKeydown);
}

/**
 * 부력검토 폼 렌더링 (폼 패널에 버튼 표시)
 */
export function renderBuoyancyCheckForm(container) {
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

export default { showBuoyancyCheckModal, renderBuoyancyCheckForm };
