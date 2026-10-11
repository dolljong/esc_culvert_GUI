// menu.js - 메뉴 트리 정의 (설계 진행 순서)
//
// 매뉴얼 1.1 "메뉴트리: 실제 설계 DATA 입력창을 설계진행 순서에 맞추어 구성한 것으로
// 이곳의 각 항목을 순차적으로 모두 입력하면 설계가 끝나게 됩니다."
// [이전]/[다음] 버튼은 이 순서를 따른다.

export const MENU = [
    {
        id: 'basic', label: '기본 설정',
        items: [
            { id: 'projectInfo', label: '프로젝트 정보' },
            { id: 'standard', label: '암거 표준도' },
            { id: 'alignment', label: '선형 정보' },
            { id: 'culvertConfig', label: '암거 기본 구성' },
        ],
    },
    {
        id: 'general', label: '일반 입력',
        items: [
            { id: 'segment', label: '구간 설정' },
            { id: 'ground', label: '지반 정보' },
            { id: 'profile', label: '종단 제원' },
            { id: 'section', label: '단면 제원' },
            { id: 'cross', label: '횡단 제원' },
            { id: 'columns', label: '기둥 배치' },
            { id: 'foundType', label: '기초 형식' },
            { id: 'foundation', label: '기초부 설정' },
            { id: 'cip', label: '현장 타설 말뚝 제원' },
        ],
    },
    {
        id: 'detail', label: '상세입력',
        items: [
            { id: 'parapet', label: '난간벽 및 차수벽' },
            { id: 'wingPos', label: '날개벽 위치' },
            { id: 'wingDim', label: '날개벽 제원' },
            { id: 'approach', label: '접속 슬래브' },
            { id: 'cjoint', label: '시공 이음' },
            { id: 'earthwork', label: '토공 상세' },
        ],
    },
    {
        id: 'struct', label: '구조 계산',
        items: [
            { id: 'designCond', label: '설계 조건' },
            { id: 'checkPos', label: '검토 위치 설정' },
            { id: 'loadComb', label: '하중 조합' },
            { id: 'loadDef', label: '하중 정의' },
            { id: 'loadCombWall', label: '하중 조합(옹벽)' },
            { id: 'frame2d', label: '2D Frame 해석' },
            { id: 'plate3d', label: '3D Plate 해석' },
            { id: 'sectionPos', label: '단면 검토 위치 설정' },
            { id: 'girder', label: '종방향 거더 해석' },
        ],
    },
    {
        id: 'rebar', label: '배근 입력',
        items: [
            { id: 'rebarSet', label: '배근 설정' },
            { id: 'main1', label: '주철근 (1Cycle)' },
            { id: 'main3', label: '주철근 (3Cycle)' },
            { id: 'main24', label: '주철근 (2,4Cycle)' },
            { id: 'roadRebar', label: '차도부 철근' },
            { id: 'haunchRebar', label: '헌치, 단절점부 및 브래킷' },
            { id: 'horzRebar', label: '수평 철근' },
            { id: 'rebarPlan', label: '철근 배치' },
            { id: 'shearRebar', label: '전단 철근' },
            { id: 'beamColRebar', label: '보, 기둥 철근' },
            { id: 'wingRebar', label: '날개벽 배근' },
            { id: 'approachRebar', label: '접속슬래브 배근' },
            { id: 'etcRebar', label: '기타 철근' },
            { id: 'rebarTable', label: '철근 제원' },
        ],
    },
    {
        id: 'output', label: '출력',
        items: [
            { id: 'drawingOut', label: '도면 출력' },
            { id: 'reportOut', label: '구조계산서' },
            { id: 'wallReportOut', label: '옹벽 구조계산서' },
            { id: 'quantityOut', label: '수량산출서 (일반)' },
            { id: 'quantityCommon', label: '수량산출서 (공통)' },
            { id: 'quantityEarth', label: '수량산출서 (토공)' },
        ],
    },
];

/** 모든 화면을 순서대로 (이전/다음) */
export const SCREEN_ORDER = MENU.flatMap(g => g.items.map(it => ({ ...it, group: g })));

export function findScreen(id) {
    return SCREEN_ORDER.find(s => s.id === id);
}
