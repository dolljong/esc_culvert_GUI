// titleBlock.js - 도면 시트 틀 (도각) : 외곽선 + 하단 표제란 + 도면 제목
//
// 좌표는 용지 mm (A1 841×594, 왼쪽 아래 0,0). 도면출력(calc/sheets.js) 이 사용한다.
// 표제란 모양은 매뉴얼 m3 의 KHC 도각(KHCBLKA1-A.dgk)을 단순화한 것:
//   | 발주처 | 설계사/시공사 | 개정 2행 + 머리행 | 공구/이정거리 | 도면명(시설명/도면명) | 사업명 |
//   | 공사명                | 개정번호 일자 내용 작성 검토 확인 | 분야 토목 단계 실시설계 | 축척 | 일자 | 도면번호 |
// 선 하늘색(4), 항목명 흰색(7), 입력값 자홍(6), 도면 제목 흰색.

export const PAPER = {
    A1: { w: 841, h: 594 },
    A2: { w: 594, h: 420 },
    A3: { w: 420, h: 297 },
};

const LINE = { color: 4, layer: 'FRAME' };
const LBL = { color: 7, layer: 'FRAME-TEXT' };
const VAL = { color: 6, layer: 'FRAME-TEXT' };

/** 표제란 기본 항목 (도면 환경 설정 > 도면 일반 오른쪽 아래 표) */
export function defaultTitleFields() {
    return {
        mainTitle: '', subTitle: '', stage: '실시설계', field: '토목',
        builder: '', designer: '', vScale: '', hScale: '', distance: '',
        section: '제0공구', project: '고속도로건설공사', name2: '', name1: '',
        rev: [
            { date: '00/00/00', content: '', author: '', checker: '', approver: '' },
            { date: '', content: '', author: '', checker: '', approver: '' },
        ],
    };
}

/** 표제란 항목 목록 (설정 표 행: [key, 라벨]) */
export const TITLE_FIELD_ROWS = [
    ['mainTitle', '주타이틀'], ['subTitle', '부타이틀'], ['stage', '설계 및 시공단계'], ['field', '분야명'],
    ['builder', '시공회사'], ['designer', '설계회사'], ['vScale', '수직 축척'], ['hScale', '수평 축척'],
    ['distance', '이정거리'], ['section', '공구명(하단)'], ['project', '공사명(하단)'], ['name2', '도면명2(도면명)'], ['name1', '도면명1(시설명)'],
    ['rev.0.date', '1차 개정날짜'], ['rev.0.content', '1차 개정내용'], ['rev.0.author', '1차 작성자'], ['rev.0.checker', '1차 검토자(설계자)'], ['rev.0.approver', '1차 확인자'],
    ['rev.1.date', '2차 개정날짜'], ['rev.1.content', '2차 개정내용'], ['rev.1.author', '2차 작성자'], ['rev.1.checker', '2차 검토자(설계자)'], ['rev.1.approver', '2차 확인자'],
];

function cellText(d, x0, x1, y0, y1, str, st, h = 2.6, align = 'center') {
    if (str == null || str === '') return;
    const x = align === 'left' ? x0 + 1.5 : align === 'right' ? x1 - 1.5 : (x0 + x1) / 2;
    // 칸 폭에 맞게 문자 높이 줄이기
    const maxH = Math.max(1.2, (x1 - x0 - 2) / Math.max(1, String(str).length * 0.95));
    d.text(x, (y0 + y1) / 2, str, { ...st, h: Math.min(h, maxH), align, valign: 'middle' });
}

/**
 * 시트 틀을 그린다.
 * info: { size:'A1', title (도면 제목), projectName, client, designer, contractor, site, name1 (시설명), scaleText, date,
 *         number (도면번호), fields (defaultTitleFields 형식), dgk (도각 파일명), fileName }
 * 반환: { W, H, area:{ x, y, w, h } }  ← 도면을 배치할 영역 (용지 mm)
 */
export function drawSheetFrame(d, info = {}) {
    const P = PAPER[info.size] || PAPER.A1;
    const W = P.w, H = P.h;
    const f = { ...defaultTitleFields(), ...(info.fields || {}) };
    const rev = Array.isArray(f.rev) ? f.rev : [];
    // 용지 외곽 (가는 회색) + 도곽 (하늘색)
    d.rect(0, 0, W, H, { color: 8, layer: 'FRAME' });
    const X0 = 15, X1 = W - 15, Y0 = 10, Y1 = H - 10;
    d.rect(X0, Y0, X1 - X0, Y1 - Y0, { ...LINE, width: 2 });
    // ── 표제란 (하단 띠) ──
    const tbH = 28, r = tbH / 3;
    const y0 = Y0, y1 = Y0 + r, y2 = Y0 + 2 * r, y3 = Y0 + tbH;
    d.line(X0, y3, X1, y3, LINE);
    const sx = (X1 - X0) / 811;          // 폭 811mm 기준 비례
    const X = (v) => X0 + v * sx;
    const vline = (v, a, b) => d.line(X(v), a, X(v), b, LINE);
    const hline = (a, b, y) => d.line(X(a), y, X(b), y, LINE);
    // 상단 2행 / 하단 1행 경계
    hline(0, 811, y1);
    // 세로 구분선
    for (const v of [80, 165, 345, 430, 640]) vline(v, y0, y3);
    for (const v of [98, 363, 448, 658]) vline(v, y1, y3);
    // 설계사/시공사, 공구/이정거리 칸 가로선
    hline(80, 165, y2); hline(345, 430, y2); hline(448, 640, y2);
    // 개정 표
    const revCols = [165, 185, 210, 285, 305, 325, 345];
    for (const v of revCols.slice(1, -1)) vline(v, y0, y3);
    hline(165, 345, y2);
    // 하단 행 칸
    for (const v of [18, 363, 385, 403, 448, 560, 578, 670]) vline(v, y0, y1);

    // 문자
    cellText(d, X(0), X(80), y1, y3, info.client || '', { color: 3, layer: 'FRAME-TEXT' }, 4.2);
    cellText(d, X(80), X(98), y2, y3, '설계사', LBL);
    cellText(d, X(80), X(98), y1, y2, '시공사', LBL);
    cellText(d, X(98), X(165), y2, y3, f.designer || info.designer || '', VAL);
    cellText(d, X(98), X(165), y1, y2, f.builder || info.contractor || '', VAL);
    rev.slice(0, 2).forEach((rv, i) => {
        const ya = i === 0 ? y2 : y1, yb = i === 0 ? y3 : y2;
        const vals = [rv.date || rv.content || rv.author ? String(i + 1) : '', rv.date, rv.content, rv.author, rv.checker, rv.approver];
        vals.forEach((t, k) => cellText(d, X(revCols[k]), X(revCols[k + 1]), ya, yb, t || '', VAL, 2.2));
    });
    ['개정번호', '일자', '내 용', '작성', '검토', '확인'].forEach((t, k) => cellText(d, X(revCols[k]), X(revCols[k + 1]), y0, y1, t, LBL, 2.2));
    cellText(d, X(345), X(363), y2, y3, '공 구', LBL);
    cellText(d, X(345), X(363), y1, y2, '이정거리', LBL, 2.2);
    cellText(d, X(363), X(430), y2, y3, info.site || f.section || '', VAL);
    cellText(d, X(363), X(430), y1, y2, f.distance || '', VAL);
    cellText(d, X(430), X(448), y1, y3, '도면명', LBL);
    cellText(d, X(448), X(640), y2, y3, f.name1 || info.name1 || '', VAL, 3);
    cellText(d, X(448), X(640), y1, y2, f.name2 || info.title || '', { color: 7, layer: 'FRAME-TEXT' }, 3.4);
    cellText(d, X(640), X(658), y1, y3, '사업명', LBL);
    cellText(d, X(658), X(811), y1, y3, f.mainTitle || info.projectName || '', { color: 7, layer: 'FRAME-TEXT' }, 4.2);
    if (f.subTitle) d.text((X(658) + X(811)) / 2, y1 + 1.2, f.subTitle, { color: 6, layer: 'FRAME-TEXT', h: 2, valign: 'bottom' });
    // 하단 행
    cellText(d, X(0), X(18), y0, y1, '공사명', LBL, 2.2);
    cellText(d, X(18), X(165), y0, y1, f.project || '', VAL);
    cellText(d, X(345), X(363), y0, y1, '분 야', LBL, 2.2);
    cellText(d, X(363), X(385), y0, y1, f.field || '', VAL, 2.2);
    cellText(d, X(385), X(403), y0, y1, '단 계', LBL, 2.2);
    cellText(d, X(403), X(430), y0, y1, f.stage || '', VAL, 2.2);
    cellText(d, X(430), X(448), y0, y1, '축 척', LBL, 2.2);
    const sc = [f.hScale, f.vScale].filter(Boolean).join('  ') || info.scaleText || '';
    cellText(d, X(448), X(560), y0, y1, sc, VAL, 2.4);
    cellText(d, X(560), X(578), y0, y1, '일 자', LBL, 2.2);
    cellText(d, X(578), X(640), y0, y1, info.date || '', VAL, 2.2);
    cellText(d, X(640), X(670), y0, y1, '도면번호', LBL, 2.2);
    cellText(d, X(670), X(811), y0, y1, info.number || '', { color: 7, layer: 'FRAME-TEXT' }, 3);

    // ── 도면 제목 / 사업명 (위) ──
    const yT = Y1 - 9;
    d.text(W / 2, yT, info.title || '', { color: 7, layer: 'FRAME-TEXT', h: 6, valign: 'bottom' });
    d.line(W / 2 - (info.title || '').length * 3.2, yT - 1.2, W / 2 + (info.title || '').length * 3.2, yT - 1.2, { color: 7, layer: 'FRAME-TEXT' });
    d.text(X0 + 4, Y1 - 5, info.projectName || '', { color: 7, layer: 'FRAME-TEXT', h: 2.6, align: 'left', valign: 'middle' });
    d.text(X0 + 4, Y1 - 9, `도면번호 : ${info.number || ''}`, { color: 7, layer: 'FRAME-TEXT', h: 2, align: 'left', valign: 'middle' });
    // 도각 아래 오른쪽 작은 상자 (도각/파일 참조)
    const bw = 110;
    d.rect(X1 - bw, 2, bw, 6, { color: 4, layer: 'FRAME' });
    d.text(X1 - bw + 2, 5, `${info.fileName || '도면파일명'}  [${info.dgk || 'KHCBLKA1-A.dgk'}]`, { color: 4, layer: 'FRAME-TEXT', h: 1.8, align: 'left', valign: 'middle' });

    return { W, H, area: { x: X0 + 5, y: y3 + 5, w: X1 - X0 - 10, h: (yT - 4) - (y3 + 5) } };
}
