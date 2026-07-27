// storage.js - 프로젝트 저장소
//
// 저장 방식은 localStorageBackend 하나에 갇혀 있고, 나머지 코드는 아래
// storage 인터페이스(save/load/remove/exists/list)만 사용한다.
// 나중에 사내 서버에 백엔드를 붙여 프로젝트를 공유 저장하기로 하면
// 이 파일의 backend만 교체하면 되고 forms/*, app.js는 손대지 않는다.
//
// 주의: 현재 구현은 브라우저 localStorage다. 따라서
//   - 데이터는 접속한 브라우저·PC에만 남는다 (설계자 간 공유 안 됨)
//   - 오리진(호스트:포트)이 바뀌면 기존 데이터가 보이지 않는다
//   - 시크릿 모드나 브라우저 데이터 삭제 시 사라진다
// 설계자 간 전달은 "저장"(JSON 파일 내려받기) / "불러오기"로 한다.

const STORAGE_KEY = 'esc_culvert_project';

// ── 저장 백엔드 (교체 지점) ─────────────────────────────
const localStorageBackend = {
    name: 'localStorage',

    read(key) {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.error('저장소 읽기 실패:', e);
            return null;
        }
    },

    write(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            // 용량 초과(QuotaExceededError)가 대표적
            console.error('저장소 쓰기 실패:', e);
            return false;
        }
    },

    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.error('저장소 삭제 실패:', e);
            return false;
        }
    },

    keys() {
        try {
            return Object.keys(localStorage);
        } catch (e) {
            console.error('저장소 조회 실패:', e);
            return [];
        }
    }
};

let backend = localStorageBackend;

// 백엔드 교체용 (예: 서버 저장소 도입 시)
export function setBackend(next) {
    backend = next;
}

// ── 프로젝트 저장소 인터페이스 ──────────────────────────
export const storage = {
    // 데이터 저장
    save(data, key = STORAGE_KEY) {
        try {
            return backend.write(key, JSON.stringify(data));
        } catch (e) {
            console.error('직렬화 실패:', e);
            return false;
        }
    },

    // 데이터 불러오기
    load(key = STORAGE_KEY) {
        const json = backend.read(key);
        if (!json) return null;
        try {
            return JSON.parse(json);
        } catch (e) {
            console.error('저장된 데이터를 해석할 수 없습니다:', e);
            return null;
        }
    },

    // 데이터 삭제
    remove(key = STORAGE_KEY) {
        return backend.remove(key);
    },

    // 하위 호환 별칭
    clear(key = STORAGE_KEY) {
        return this.remove(key);
    },

    // 저장된 데이터 존재 여부
    exists(key = STORAGE_KEY) {
        return backend.read(key) !== null;
    },

    // 저장된 프로젝트 키 목록
    list() {
        return backend.keys().filter(k => k.startsWith(STORAGE_KEY));
    },

    // JSON 파일로 내보내기
    exportToFile(data, filename = 'esc_culvert_project.json') {
        try {
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return true;
        } catch (e) {
            console.error('파일 내보내기 실패:', e);
            return false;
        }
    },

    // JSON 파일에서 가져오기
    importFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    reject(new Error('선택된 파일이 없습니다'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        resolve(JSON.parse(event.target.result));
                    } catch (parseError) {
                        reject(new Error('올바른 JSON 파일이 아닙니다'));
                    }
                };
                reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
                reader.readAsText(file);
            };

            input.click();
        });
    }
};

export default storage;
