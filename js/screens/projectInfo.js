// 기본 설정 > 프로젝트 정보 (매뉴얼 1.1)

import store from '../core/store.js';
import { propGrid } from '../ui/grid.js';
import { txt } from '../ui/cells.js';
import { h, bCheck } from '../ui/dom.js';
import { createProject } from '../core/model.js';

const ROWS = [
    { key: 'projectName', label: '사 업 명', hint: '현재 진행중인 프로젝트 이름을 입력합니다.' },
    { key: 'client', label: '발 주 처', hint: '발주처명을 입력합니다.' },
    { key: 'contractor', label: '시 공 사', hint: '시공사 명을 입력합니다.' },
    { key: 'siteName', label: '현 장 명', hint: '현장명을 입력합니다.' },
    { key: 'designer', label: '설 계 사', hint: '설계사 명을 입력합니다.' },
    { key: 'dirForward', label: '선형 진행 방향', hint: '선형진행방향에 대해 입력합니다. 예) 서울방향' },
    { key: 'dirBackward', label: '선형 반대 방향', hint: '선형반대방향에 대해 입력합니다. 예) 부산방향' },
];

export default {
    scope: 'project',
    hint: '현재 진행중인 프로젝트 이름을 입력합니다.',

    render(el) {
        propGrid(el, ROWS.map(r => ({ label: r.label, cell: txt(`info.${r.key}`, { hint: r.hint, field: r.key }) })), { id: 'projectInfo', colWidths: [130, 560] });
        el.appendChild(h('div', { style: { marginTop: '6px', color: '#fff' } }, [bCheck('standard.applied', ' 표준도 적용 프로젝트')]));
    },

    defaults() {
        store.set('info', createProject().info);
    },
};
