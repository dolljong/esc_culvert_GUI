// formula.js - 입력셀 수식 계산 (매뉴얼 1.2 "입력 셀에 먼저 '=' 를 입력하면 엑셀처럼 수식 입력")
//
// eval 을 쓰지 않는 작은 재귀하강 파서. 지원: + - * / ^ ( ) 와
// SQRT ABS SIN COS TAN ASIN ACOS ATAN RADIANS DEGREES ROUND INT MIN MAX SUM AVERAGE POWER PI
// 삼각함수는 엑셀과 같이 라디안 단위.

const FUNCS = {
    SQRT: Math.sqrt, ABS: Math.abs, SIN: Math.sin, COS: Math.cos, TAN: Math.tan,
    ASIN: Math.asin, ACOS: Math.acos, ATAN: Math.atan, EXP: Math.exp, LN: Math.log,
    LOG: (x, b = 10) => Math.log(x) / Math.log(b),
    RADIANS: (d) => d * Math.PI / 180, DEGREES: (r) => r * 180 / Math.PI,
    ROUND: (x, d = 0) => { const k = Math.pow(10, d); return Math.round(x * k) / k; },
    ROUNDUP: (x, d = 0) => { const k = Math.pow(10, d); return Math.ceil(x * k) / k; },
    ROUNDDOWN: (x, d = 0) => { const k = Math.pow(10, d); return Math.floor(x * k) / k; },
    INT: Math.floor, MIN: Math.min, MAX: Math.max, POWER: Math.pow,
    SUM: (...a) => a.reduce((s, v) => s + v, 0),
    AVERAGE: (...a) => a.reduce((s, v) => s + v, 0) / (a.length || 1),
    PI: () => Math.PI,
};

export function evalFormula(src) {
    const s = String(src).replace(/^=/, '').trim();
    let i = 0;
    const peek = () => s[i];
    const skip = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const expect = (ch) => { skip(); if (s[i] !== ch) throw new Error(`'${ch}' 필요`); i++; };

    function number() {
        skip();
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
        if (!m) throw new Error('숫자 필요');
        i += m[0].length;
        return parseFloat(m[0]);
    }
    function primary() {
        skip();
        const ch = peek();
        if (ch === '(') { i++; const v = expr(); expect(')'); return v; }
        if (ch === '-') { i++; return -power(); }
        if (ch === '+') { i++; return power(); }
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
        if (m) {
            const name = m[0].toUpperCase();
            i += m[0].length;
            const fn = FUNCS[name];
            if (!fn) throw new Error(`알 수 없는 함수 ${name}`);
            skip();
            const args = [];
            if (peek() === '(') {
                i++; skip();
                if (peek() !== ')') {
                    args.push(expr());
                    skip();
                    while (peek() === ',') { i++; args.push(expr()); skip(); }
                }
                expect(')');
            }
            return fn(...args);
        }
        return number();
    }
    function power() {
        let v = primary();
        skip();
        while (peek() === '^') { i++; v = Math.pow(v, primary()); skip(); }
        return v;
    }
    function term() {
        let v = power();
        skip();
        while (peek() === '*' || peek() === '/') {
            const op = s[i++];
            const r = power();
            v = op === '*' ? v * r : v / r;
            skip();
        }
        return v;
    }
    function expr() {
        let v = term();
        skip();
        while (peek() === '+' || peek() === '-') {
            const op = s[i++];
            const r = term();
            v = op === '+' ? v + r : v - r;
            skip();
        }
        return v;
    }
    const v = expr();
    skip();
    if (i < s.length) throw new Error('수식 오류');
    if (!isFinite(v)) throw new Error('계산 결과가 올바르지 않습니다');
    return v;
}

/** 셀 입력 문자열 → 숫자. '=' 로 시작하면 수식, 쉼표 허용. 실패 시 null */
export function parseNumberInput(text) {
    const t = String(text ?? '').trim();
    if (t === '') return null;
    if (t.startsWith('=')) {
        try { return evalFormula(t); } catch { return null; }
    }
    const v = parseFloat(t.replace(/,/g, ''));
    return isFinite(v) ? v : null;
}
