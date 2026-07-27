// storage.js - LocalStorage 관리

const STORAGE_KEY = 'esc_culvert_project';

export const storage = {
    // 데이터 저장
    save(data) {
        try {
            const json = JSON.stringify(data);
            localStorage.setItem(STORAGE_KEY, json);
            return true;
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
            return false;
        }
    },

    // 데이터 불러오기
    load() {
        try {
            const json = localStorage.getItem(STORAGE_KEY);
            if (json) {
                return JSON.parse(json);
            }
            return null;
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
            return null;
        }
    },

    // 데이터 삭제
    clear() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            return true;
        } catch (e) {
            console.error('Failed to clear localStorage:', e);
            return false;
        }
    },

    // 저장된 데이터 존재 여부
    exists() {
        return localStorage.getItem(STORAGE_KEY) !== null;
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
            console.error('Failed to export to file:', e);
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
                    reject(new Error('No file selected'));
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        resolve(data);
                    } catch (parseError) {
                        reject(new Error('Invalid JSON file'));
                    }
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsText(file);
            };

            input.click();
        });
    }
};

export default storage;
