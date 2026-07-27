// zoomPan.js - 줌/팬 기능

// 줌/팬 컨트롤러 클래스
export class ZoomPanController {
    constructor(svgElement, containerElement) {
        this.svg = svgElement;
        this.container = containerElement;

        // 상태
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 10;
        this.zoomFactor = 1.15;

        // 뷰박스 상태
        this.viewBox = { x: 0, y: 0, width: 0, height: 0 };
        this.originalViewBox = null;

        // 팬 상태
        this.isPanning = false;
        this.startPoint = { x: 0, y: 0 };
        this.startViewBox = { x: 0, y: 0 };

        // 이벤트 바인딩
        this.handleWheel = this.handleWheel.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleMouseLeave = this.handleMouseLeave.bind(this);

        // 줌 레벨 표시 요소
        this.zoomIndicator = document.getElementById('zoom-level');

        this.init();
    }

    init() {
        // 이벤트 리스너 등록
        this.container.addEventListener('wheel', this.handleWheel, { passive: false });
        this.container.addEventListener('mousedown', this.handleMouseDown);
        this.container.addEventListener('mousemove', this.handleMouseMove);
        this.container.addEventListener('mouseup', this.handleMouseUp);
        this.container.addEventListener('mouseleave', this.handleMouseLeave);

        // 초기 뷰박스 저장
        this.saveOriginalViewBox();
    }

    // 초기 뷰박스 저장
    saveOriginalViewBox() {
        const vb = this.svg.getAttribute('viewBox');
        if (vb) {
            const parts = vb.split(' ').map(Number);
            this.viewBox = {
                x: parts[0],
                y: parts[1],
                width: parts[2],
                height: parts[3]
            };
            this.originalViewBox = { ...this.viewBox };
        }
    }

    // 뷰박스 업데이트
    updateViewBox() {
        const vb = `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`;
        this.svg.setAttribute('viewBox', vb);
    }

    // 줌 레벨 표시 업데이트
    updateZoomIndicator() {
        if (this.zoomIndicator) {
            const percent = Math.round(this.scale * 100);
            this.zoomIndicator.textContent = `${percent}%`;
        }
    }

    // 마우스 휠 줌
    handleWheel(e) {
        e.preventDefault();

        // 현재 뷰박스 확인
        this.saveOriginalViewBox();
        if (!this.originalViewBox) return;

        // 마우스 위치 (컨테이너 기준)
        const rect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 마우스 위치를 SVG 좌표로 변환
        const svgPoint = this.screenToSvg(mouseX, mouseY);

        // 줌 방향 결정
        const delta = e.deltaY > 0 ? 1 / this.zoomFactor : this.zoomFactor;
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * delta));

        if (newScale === this.scale) return;

        // 스케일 변화율
        const scaleRatio = this.scale / newScale;
        this.scale = newScale;

        // 새 뷰박스 크기
        const newWidth = this.viewBox.width * scaleRatio;
        const newHeight = this.viewBox.height * scaleRatio;

        // 마우스 위치 기준으로 뷰박스 조정
        const dx = (svgPoint.x - this.viewBox.x) * (1 - scaleRatio);
        const dy = (svgPoint.y - this.viewBox.y) * (1 - scaleRatio);

        this.viewBox.x += dx;
        this.viewBox.y += dy;
        this.viewBox.width = newWidth;
        this.viewBox.height = newHeight;

        this.updateViewBox();
        this.updateZoomIndicator();
    }

    // 화면 좌표 → SVG 좌표 변환
    screenToSvg(screenX, screenY) {
        const rect = this.container.getBoundingClientRect();
        const ratioX = this.viewBox.width / rect.width;
        const ratioY = this.viewBox.height / rect.height;

        return {
            x: this.viewBox.x + screenX * ratioX,
            y: this.viewBox.y + screenY * ratioY
        };
    }

    // 마우스 다운 (팬 시작)
    handleMouseDown(e) {
        if (e.button !== 0) return; // 좌클릭만

        this.isPanning = true;
        this.startPoint = { x: e.clientX, y: e.clientY };
        this.startViewBox = { x: this.viewBox.x, y: this.viewBox.y };
        this.container.style.cursor = 'grabbing';
    }

    // 마우스 이동 (팬)
    handleMouseMove(e) {
        if (!this.isPanning) return;

        const dx = e.clientX - this.startPoint.x;
        const dy = e.clientY - this.startPoint.y;

        // 화면 이동량을 SVG 좌표로 변환
        const rect = this.container.getBoundingClientRect();
        const ratioX = this.viewBox.width / rect.width;
        const ratioY = this.viewBox.height / rect.height;

        this.viewBox.x = this.startViewBox.x - dx * ratioX;
        this.viewBox.y = this.startViewBox.y - dy * ratioY;

        this.updateViewBox();
    }

    // 마우스 업 (팬 종료)
    handleMouseUp(e) {
        this.isPanning = false;
        this.container.style.cursor = 'grab';
    }

    // 마우스 컨테이너 이탈
    handleMouseLeave(e) {
        this.isPanning = false;
        this.container.style.cursor = 'grab';
    }

    // 줌 인
    zoomIn() {
        this.saveOriginalViewBox();

        const newScale = Math.min(this.maxScale, this.scale * this.zoomFactor);
        const scaleRatio = this.scale / newScale;
        this.scale = newScale;

        // 중앙 기준 줌
        const centerX = this.viewBox.x + this.viewBox.width / 2;
        const centerY = this.viewBox.y + this.viewBox.height / 2;

        const newWidth = this.viewBox.width * scaleRatio;
        const newHeight = this.viewBox.height * scaleRatio;

        this.viewBox.x = centerX - newWidth / 2;
        this.viewBox.y = centerY - newHeight / 2;
        this.viewBox.width = newWidth;
        this.viewBox.height = newHeight;

        this.updateViewBox();
        this.updateZoomIndicator();
    }

    // 줌 아웃
    zoomOut() {
        this.saveOriginalViewBox();

        const newScale = Math.max(this.minScale, this.scale / this.zoomFactor);
        const scaleRatio = this.scale / newScale;
        this.scale = newScale;

        // 중앙 기준 줌
        const centerX = this.viewBox.x + this.viewBox.width / 2;
        const centerY = this.viewBox.y + this.viewBox.height / 2;

        const newWidth = this.viewBox.width * scaleRatio;
        const newHeight = this.viewBox.height * scaleRatio;

        this.viewBox.x = centerX - newWidth / 2;
        this.viewBox.y = centerY - newHeight / 2;
        this.viewBox.width = newWidth;
        this.viewBox.height = newHeight;

        this.updateViewBox();
        this.updateZoomIndicator();
    }

    // 전체 보기 (맞춤)
    fitToView() {
        if (this.originalViewBox) {
            this.viewBox = { ...this.originalViewBox };
            this.scale = 1;
            this.updateViewBox();
            this.updateZoomIndicator();
        }
    }

    // 뷰박스 리셋 (새 렌더링 후 호출)
    reset() {
        this.scale = 1;
        this.saveOriginalViewBox();
        this.updateZoomIndicator();
    }

    // 정리
    destroy() {
        this.container.removeEventListener('wheel', this.handleWheel);
        this.container.removeEventListener('mousedown', this.handleMouseDown);
        this.container.removeEventListener('mousemove', this.handleMouseMove);
        this.container.removeEventListener('mouseup', this.handleMouseUp);
        this.container.removeEventListener('mouseleave', this.handleMouseLeave);
    }
}

// 싱글톤
let zoomPanInstance = null;

export function initZoomPan(svgElement, containerElement) {
    if (zoomPanInstance) {
        zoomPanInstance.destroy();
    }
    zoomPanInstance = new ZoomPanController(svgElement, containerElement);
    return zoomPanInstance;
}

export function getZoomPan() {
    return zoomPanInstance;
}

export default { ZoomPanController, initZoomPan, getZoomPan };
