// app.js - 앱 진입점, 초기화

import state from './state.js';
import { renderTree } from './tree.js';
import { initRenderer, getRenderer } from './viewer/svgRenderer.js';
import { initZoomPan, getZoomPan } from './viewer/zoomPan.js';
import { renderProjectInfoForm } from './forms/projectInfo.js';
import { renderBasicEnvironmentForm } from './forms/basicEnvironment.js';
import { renderMaterialsForm } from './forms/materials.js';
import { renderGroundInfoForm } from './forms/groundInfo.js';
import { renderSectionPropertiesForm } from './forms/sectionProperties.js';
import { renderBuoyancyCheckForm } from './forms/buoyancyCheck.js';
import storage from './utils/storage.js';
import { exportDXF } from './utils/dxfExport.js';
import { initLayout } from './ui/layout.js';
import { initStatusBar, setMessage, setDirty, setSaved } from './ui/statusBar.js';

// 앱 초기화
document.addEventListener('DOMContentLoaded', () => {
    console.log('ESC Culvert Web App 초기화...');

    // LocalStorage에서 데이터 복원
    const savedData = storage.load();
    if (savedData) {
        state.fromJSON(JSON.stringify(savedData));
        console.log('저장된 데이터 복원됨');
    }

    // 상태 표시줄 / 레이아웃 (트리 토글, 패널 크기 조절)
    initStatusBar();
    initLayout({
        onResize: () => {
            const zoomPan = getZoomPan();
            if (zoomPan) zoomPan.fitToView();
        }
    });

    // 트리 메뉴 렌더링
    renderTree('tree-menu');

    // SVG 렌더러 초기화
    const svgElement = document.getElementById('culvert-svg');
    const svgContainer = document.getElementById('svg-container');

    if (svgElement && svgContainer) {
        initRenderer(svgElement);
        initZoomPan(svgElement, svgContainer);

        // 초기 SVG 렌더링
        const renderer = getRenderer();
        renderer.render(state.getSectionData());
    }

    // 초기 폼 렌더링
    // renderTree()가 이미 menuChange를 발생시켰지만 그 시점엔 리스너가 없으므로
    // 제목/내용을 여기서 함께 맞춘다. (제목만 기본값으로 남는 문제 방지)
    updateFormTitle(state.getCurrentMenu());
    updateFormContent(state.getCurrentMenu());

    // 이벤트 리스너 등록
    setupEventListeners();

    // 상태 변경 감지
    state.on('menuChange', (menu) => {
        updateFormTitle(menu);
        updateFormContent(menu);
        setMessage(`${menu}이(가) 선택되었습니다`);
        // 부력검토가 아닌 메뉴로 이동하면 단면도 복원
        if (menu !== '부력검토') {
            const renderer = getRenderer();
            if (renderer) {
                renderer.render(state.getSectionData());
                const zoomPan = getZoomPan();
                if (zoomPan) zoomPan.reset();
            }
        }
    });

    state.on('sectionDataChange', (data) => {
        // SVG 업데이트
        const renderer = getRenderer();
        if (renderer) {
            renderer.render(data);
            // 줌/팬 리셋
            const zoomPan = getZoomPan();
            if (zoomPan) {
                zoomPan.reset();
            }
        }
        // 자동 저장
        autoSave();
    });

    state.on('stateChange', () => {
        // 자동 저장
        autoSave();
        // SVG 업데이트 (지반정보 변경 반영)
        const renderer = getRenderer();
        if (renderer) {
            renderer.render(state.getSectionData());
        }
    });

    console.log('초기화 완료');
});

// 프로젝트 파일로 저장
function saveProjectToFile() {
    const data = state.get();
    if (storage.exportToFile(data, 'esc_culvert_project.json')) {
        setMessage('프로젝트 파일을 내려받았습니다.');
    } else {
        setMessage('프로젝트 저장에 실패했습니다.');
    }
}

// 프로젝트 파일 불러오기
async function loadProjectFromFile() {
    try {
        const data = await storage.importFromFile();
        state.fromJSON(JSON.stringify(data));
        updateFormContent(state.getCurrentMenu());
        setMessage('프로젝트를 불러왔습니다.');
    } catch (e) {
        setMessage('파일을 불러오는데 실패했습니다: ' + e.message);
        alert('파일을 불러오는데 실패했습니다: ' + e.message);
    }
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 새 프로젝트
    document.getElementById('btn-new').addEventListener('click', () => {
        if (confirm('현재 프로젝트를 초기화하시겠습니까?\n저장하지 않은 변경 내용은 사라집니다.')) {
            state.reset();
            storage.clear();
            updateFormContent(state.getCurrentMenu());
            setMessage('새 프로젝트가 생성되었습니다.');
        }
    });

    // 저장 / 불러오기
    document.getElementById('btn-save').addEventListener('click', saveProjectToFile);
    document.getElementById('btn-load').addEventListener('click', loadProjectFromFile);

    // DXF 내보내기
    document.getElementById('btn-export-dxf').addEventListener('click', () => {
        if (exportDXF()) {
            setMessage('DXF 파일을 내려받았습니다.');
        }
    });

    // 단축키 (PyQt QKeySequence.Save / .Open 대응)
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const key = e.key.toLowerCase();
        if (key === 's') {
            e.preventDefault();
            saveProjectToFile();
        } else if (key === 'o') {
            e.preventDefault();
            loadProjectFromFile();
        }
    });

    // 뷰어 컨트롤
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
        const zoomPan = getZoomPan();
        if (zoomPan) zoomPan.zoomIn();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
        const zoomPan = getZoomPan();
        if (zoomPan) zoomPan.zoomOut();
    });

    document.getElementById('btn-fit').addEventListener('click', () => {
        const zoomPan = getZoomPan();
        if (zoomPan) zoomPan.fitToView();
    });
}

// 폼 타이틀 업데이트
function updateFormTitle(menu) {
    const titleElement = document.getElementById('form-title');
    if (titleElement) {
        titleElement.textContent = menu;
    }
}

// 폼 콘텐츠 업데이트
function updateFormContent(menu) {
    const container = document.getElementById('form-content');
    if (!container) return;

    switch (menu) {
        case '프로젝트 정보':
            renderProjectInfoForm(container);
            break;
        case '기본환경':
            renderBasicEnvironmentForm(container);
            break;
        case '재료특성':
            renderMaterialsForm(container);
            break;
        case '지반정보':
            renderGroundInfoForm(container);
            break;
        case '단면제원':
            renderSectionPropertiesForm(container);
            break;
        case '부력검토':
            renderBuoyancyCheckForm(container);
            break;
        case '기타환경':
        case '분점 정의':
        case '하중 정의':
        case '하중입력':
        case '휨철근':
        case '전단철근':
        case '출력':
            renderPlaceholder(container, menu);
            break;
        default:
            renderPlaceholder(container, menu);
    }
}

// 플레이스홀더 렌더링
function renderPlaceholder(container, menu) {
    container.innerHTML = `
        <div class="placeholder-message">
            "${menu}" 기능은 개발 중입니다.
        </div>
    `;
}

// 자동 저장 (디바운스)
let autoSaveTimeout = null;
function autoSave() {
    setDirty();
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    autoSaveTimeout = setTimeout(() => {
        autoSaveTimeout = null;
        const data = state.get();
        if (storage.save(data)) {
            setSaved();
        } else {
            setMessage('자동 저장에 실패했습니다. 브라우저 저장 공간을 확인하세요.');
        }
    }, 1000);
}

// 탭을 닫기 전, 디바운스 대기 중인 변경분을 즉시 저장한다.
// 그래도 남아 있으면 브라우저 기본 확인창을 띄운다.
// (데스크톱과 달리 브라우저는 실수로 탭을 닫으면 되돌릴 수 없다)
function flushPendingSave() {
    if (!autoSaveTimeout) return true;
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    return storage.save(state.get());
}

// 탭 종료 시 미저장 변경분 보호
window.addEventListener('beforeunload', (e) => {
    if (flushPendingSave()) return;
    e.preventDefault();
    e.returnValue = '';
});

// 전역 에러 핸들러
window.addEventListener('error', (e) => {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
});
