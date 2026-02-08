// tree.js - 트리 네비게이션

import state from './state.js';

// 트리 구조 정의
const treeData = [
    {
        label: '프로젝트 정보',
        children: null
    },
    {
        label: '설계조건',
        children: [
            { label: '기본환경' },
            { label: '재료특성' },
            { label: '지반정보' },
            { label: '기타환경' }
        ]
    },
    {
        label: '단면입력',
        children: [
            { label: '단면제원' },
            { label: '분점 정의' },
            { label: '하중 정의' }
        ]
    },
    {
        label: '하중입력',
        children: null
    },
    {
        label: '배근 입력',
        children: [
            { label: '휨철근' },
            { label: '전단철근' }
        ]
    },
    {
        label: '출력',
        children: null
    }
];

// 트리 렌더링
export function renderTree(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    treeData.forEach((item, index) => {
        const li = createTreeItem(item, 0);
        container.appendChild(li);
    });

    // 초기 선택 상태 설정
    const currentMenu = state.getCurrentMenu();
    selectTreeItem(currentMenu);
}

// 트리 아이템 생성
function createTreeItem(item, level) {
    const li = document.createElement('li');
    li.className = 'tree-item';
    li.dataset.level = level;
    li.dataset.label = item.label;

    const content = document.createElement('div');
    content.className = 'tree-item-content';

    // 토글 아이콘
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    if (item.children && item.children.length > 0) {
        toggle.innerHTML = '▶';
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleExpand(li);
        });
    } else {
        toggle.className += ' hidden';
    }

    // 라벨
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = item.label;

    content.appendChild(toggle);
    content.appendChild(label);

    // 클릭 이벤트
    content.addEventListener('click', () => {
        handleItemClick(item, li);
    });

    li.appendChild(content);

    // 자식 항목
    if (item.children && item.children.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'tree-children';
        item.children.forEach(child => {
            ul.appendChild(createTreeItem(child, level + 1));
        });
        li.appendChild(ul);
    }

    return li;
}

// 확장/축소 토글
function toggleExpand(li) {
    const toggle = li.querySelector('.tree-toggle');
    const children = li.querySelector('.tree-children');

    if (children) {
        const isExpanded = children.classList.contains('expanded');
        if (isExpanded) {
            children.classList.remove('expanded');
            toggle.classList.remove('expanded');
        } else {
            children.classList.add('expanded');
            toggle.classList.add('expanded');
        }
    }
}

// 항목 클릭 처리
function handleItemClick(item, li) {
    // 자식이 있는 경우 첫 번째 자식 선택
    if (item.children && item.children.length > 0) {
        // 먼저 확장
        const children = li.querySelector('.tree-children');
        const toggle = li.querySelector('.tree-toggle');
        if (children && !children.classList.contains('expanded')) {
            children.classList.add('expanded');
            toggle.classList.add('expanded');
        }
        // 첫 번째 자식 선택
        selectTreeItem(item.children[0].label);
    } else {
        selectTreeItem(item.label);
    }
}

// 트리 아이템 선택
function selectTreeItem(label) {
    // 이전 선택 해제
    document.querySelectorAll('.tree-item-content.selected').forEach(el => {
        el.classList.remove('selected');
    });

    // 새 아이템 선택
    const allItems = document.querySelectorAll('.tree-item');
    for (const item of allItems) {
        if (item.dataset.label === label) {
            const content = item.querySelector('.tree-item-content');
            content.classList.add('selected');

            // 부모 확장
            let parent = item.parentElement;
            while (parent) {
                if (parent.classList && parent.classList.contains('tree-children')) {
                    parent.classList.add('expanded');
                    const parentToggle = parent.parentElement.querySelector('.tree-toggle');
                    if (parentToggle) parentToggle.classList.add('expanded');
                }
                parent = parent.parentElement;
            }

            break;
        }
    }

    // 상태 업데이트
    state.setCurrentMenu(label);
}

// 외부에서 사용할 수 있도록 export
export function selectMenu(label) {
    selectTreeItem(label);
}

export default { renderTree, selectMenu };
