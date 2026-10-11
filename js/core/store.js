// store.js - 프로젝트 데이터 저장소
//
// 모든 입력 데이터는 하나의 project 객체에 들어간다. 화면(screen)은 경로로 값을
// 읽고 쓰며, 저장소는 변경 이벤트를 내보내고 실행취소/복구(Ctrl+Z / Ctrl+Y)
// 기록을 관리한다. 매뉴얼 1.2 "취소: 10개를 수정했다면 Ctrl+Z 를 10번" 동작.
//
// 경로는 'culverts.0.section.H' 같은 점 표기 문자열이나 배열을 쓴다.

const MAX_UNDO = 200;

function toPath(path) {
    if (Array.isArray(path)) return path;
    if (path === '' || path == null) return [];
    return String(path).split('.').map(p => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getIn(obj, path) {
    let cur = obj;
    for (const key of toPath(path)) {
        if (cur == null) return undefined;
        cur = cur[key];
    }
    return cur;
}

function setIn(obj, path, value) {
    const keys = toPath(path);
    if (keys.length === 0) return;
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (cur[k] == null || typeof cur[k] !== 'object') {
            cur[k] = typeof keys[i + 1] === 'number' ? [] : {};
        }
        cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const listeners = new Map();   // event -> Set<fn>

let project = {};
let undoStack = [];
let redoStack = [];
let batch = null;              // 진행 중인 묶음 기록 (beginBatch/endBatch)

function emit(event, payload) {
    const set = listeners.get(event);
    if (set) set.forEach(fn => {
        try { fn(payload); } catch (e) { console.error(`[store] ${event} listener`, e); }
    });
}

function pushRecord(rec) {
    if (batch) { batch.push(rec); return; }
    undoStack.push([rec]);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

export const store = {
    on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event).delete(fn);
    },
    emit,

    /** 전체 프로젝트 (직접 수정하지 말고 set을 쓴다) */
    get project() { return project; },

    get(path) { return getIn(project, path); },

    /**
     * 값 설정. 기본적으로 실행취소 기록을 남기고 'change' 이벤트를 낸다.
     * opts.record=false 이면 기록하지 않는다 (기본값 생성 등 내부 처리).
     */
    set(path, value, opts = {}) {
        const old = clone(getIn(project, path));
        const next = clone(value);
        if (JSON.stringify(old) === JSON.stringify(next)) return;
        setIn(project, path, next);
        if (opts.record !== false) pushRecord({ path: toPath(path), old, next });
        if (!opts.silent) emit('change', { path: toPath(path), value: next });
    },

    /** 여러 변경을 실행취소 1회로 묶는다 */
    beginBatch() { if (!batch) batch = []; },
    endBatch() {
        if (!batch) return;
        const recs = batch;
        batch = null;
        if (recs.length) {
            undoStack.push(recs);
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack = [];
        }
    },
    /** fn 안의 set 들을 한 번의 실행취소 단위로 */
    transact(fn) {
        this.beginBatch();
        try { fn(); } finally { this.endBatch(); }
        emit('change', { path: [] });
    },

    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },

    undo() {
        const recs = undoStack.pop();
        if (!recs) return false;
        for (let i = recs.length - 1; i >= 0; i--) setIn(project, recs[i].path, clone(recs[i].old));
        redoStack.push(recs);
        emit('change', { path: [], undo: true });
        emit('history');
        return true;
    },
    redo() {
        const recs = redoStack.pop();
        if (!recs) return false;
        for (const r of recs) setIn(project, r.path, clone(r.next));
        undoStack.push(recs);
        emit('change', { path: [], redo: true });
        emit('history');
        return true;
    },
    /** 매뉴얼 "전부취소" */
    undoAll() {
        let n = 0;
        while (this.undo()) n++;
        return n;
    },

    /** 프로젝트 교체 (새 파일 / 불러오기). 기록은 초기화된다. */
    replace(next) {
        project = next;
        undoStack = [];
        redoStack = [];
        batch = null;
        emit('replace', project);
        emit('change', { path: [] });
    },
};

export default store;
