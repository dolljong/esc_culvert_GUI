# 화면(screen) 개발 가이드

사용자 설명서(`docs/A-Culvert-매뉴얼`)의 화면 구성을 웹으로 재현한다. 정적 웹앱(빌드 없음, 바닐라 ES 모듈).
실행: 저장소 루트에서 `python -m http.server 8000` → http://localhost:8000

## 구조

```
index.html, css/esc-culvert.css  프로그램 틀 (Office 2007 파란 테마)
js/main.js                       진입점: 파일 열기/저장(.ecu), 자동저장, 단축키
js/core/store.js                 프로젝트 저장소: get/set(경로), 실행취소(Ctrl+Z/Y), 'change' 이벤트
js/core/model.js                 데이터 구조·기본값·공용 조회 (blocks, jointStations, sectionOf ...)
js/core/menu.js                  메뉴/메뉴트리 순서 (화면 id 목록)
js/ui/shell.js                   메뉴(드롭다운)·트리·다이얼로그·확인창·[기본값][이전][다음][적용]
js/ui/grid.js                    엑셀형 그리드 (Grid, propGrid)
js/ui/cells.js                   그리드 셀 ↔ store 경로 바인딩 (num, txt, sel, chk, lbl, dash, custom, btn)
js/ui/dom.js                     h(), box(), bCheck/bSelect/bNumber/bText/bRadio, button(), modal(), confirmBox(), alertBox()
js/cad/drawing.js                CAD 엔티티 (line, pline, rect, circle, arc, text, hatch, dimH/dimV/dimA, elMark, tag, bubble, varLabel, leader)
js/cad/cadView.js                검은 바탕 SVG 뷰 (휠 줌, 드래그 이동)
js/cad/dxfWriter.js              Drawing → DXF (R12), saveDrawingAsDxf()
js/calc/alignment.js             평면(IP+클로소이드)/종단(VIP)/보간
js/calc/sectionGeom.js           단면 형상 (Box/U/복층) — 모든 도면·해석·수량은 이것을 사용
js/calc/ground.js                지반정보 층 조회 (layerAt, boringAt)
js/draw/sectionDraw.js           횡단면도 (drawSection, sectionDrawing)
js/draw/planDraw.js              평면도/종단면도 (drawAlignmentPlan, drawCulvertPlan, drawCenterLine, drawProfile)
js/screens/<id>.js               화면 하나 = 파일 하나 (id 는 js/core/menu.js)
```

## 화면 모듈 형식

```js
export default {
    scope: 'project' | 'culvert',          // culvert → 머리줄에 "암거 n : 이름 ▼ ◀ ▶" 자동
    perBlock: bool | (ctx) => bool,         // 정의하면 BLOCK 선택기 표시 (false 면 회색)
    enabled: (ctx) => bool,                 // false → 트리 회색, [이전][다음] 건너뜀
    hint: '안내줄 문구',
    tabs: (ctx) => [{ id, title, disabled }],
    header(el, ctx) {},                     // 머리줄 추가 컨트롤 (암거 선택기 뒤)
    render(el, ctx, tabId) {},              // 본문 (파란 배경). 그리드/박스 배치
    footer(el, ctx, tabId) {},              // 하단 왼쪽, [기본값] 뒤 (추가/삭제 등)
    defaults(ctx, tabId) {},                // [기본값] — store.set 들이 한 번의 실행취소로 묶임
    draw(ctx, tabId) { return drawing; },   // 입력결과 확인창 Drawing
    viewKey: (ctx, tabId) => 'key',         // 같으면 확대상태 유지 (값 편집 시 화면이 튀지 않게)
    apply(ctx) {},                          // [적용]
};
```

`ctx = { p (project), c (현재 암거), ci, cp ('culverts.N' 경로), bi (블록), blocks, tab, store, rerender(), redraw(), setHint(t), go(id) }`

- 값은 반드시 `store.set(path, value)` 로 바꾼다 → 자동으로 다시 그리고, 실행취소 기록, 자동저장.
- 화면은 store 'change' 때마다 통째로 다시 렌더된다 (그리드 선택 위치는 grid id 로 유지). 렌더는 가볍게.
- 데이터가 아직 없으면(기존 파일) 렌더 시점에 기본값을 만들어 `store.set(path, v, { record: false, silent: true })` 로 넣는다.
- 그리드 셀에 `hint` 를 주면 선택 시 노란 안내줄에 표시, `field: 'H'` 를 주면 도면의 변수명 클릭 시 그 셀로 이동.
- 회색(계산값) 셀: `lbl(fn, {cls:'ro'})`, 사용하지 않는 셀: `dash()`.
- 다단 헤더: `head: [[{t, cs, rs}], ...]`, 행 머리: `rows: [{ head: [{t, rs}], cells: [...] }]`, 셀 병합: cell.cs / cell.rs.

## 도면 색 규칙 (매뉴얼 화면)
- 구조물 외곽 하늘색(4), 숨은선/내측 초록 파선, 중심선 빨간 일점쇄선(dash:'center')
- 치수선 빨강(1) + 치수문자 초록(3) — `dimH/dimV/dimA` 기본값
- 변수명 노랑(2) — `d.varLabel(x, y, 'H')` 또는 dim 옵션 `{ name: 'H' }` (클릭 시 입력셀 이동)
- EL 표시 `d.elMark(x, y, el)` (빨간 ▽ + 'EL. x.xxx'), Station 태그 `d.tag(x, y, '암거시점', 'STA. 0K+010.0')`
- 철근 빨강/노랑, 지반: 토사 자홍, 풍화암 빨간 파선, 지하수위 초록
- 단위: 도면 좌표 mm. 문자 높이는 `new Drawing({ textHeight })` 로 도면 크기에 맞춘다 (폭/45 정도)

## 데이터 소유 (화면별 store 경로)
| 영역 | 경로 | 소유 화면 |
|---|---|---|
| 프로젝트 정보 | `info` | projectInfo |
| 암거표준도 | `standard` | standard |
| 선형 | `alignment` | alignment |
| 암거 목록 | `culverts[i].{name,type,startSta}` | culvertConfig |
| 신축이음/블록 | `culverts[i].{joints,zones,dowel,blockCount,blockLen}` | segment |
| 지반정보 | `culverts[i].ground` (calc/ground.js 형식) | ground |
| 종단제원 | `culverts[i].profile` | profile |
| 단면 | `culverts[i].section`, `blockSections[]`, `offset` | section |
| 횡단(차도부/측구) | `culverts[i].cross` | cross |
| 기둥배치 | `culverts[i].columns` | columns |
| 기초형식 | `culverts[i].foundType` (버림 두께/너비 → section.lean 도 갱신) | foundType |
| 기초부설정 | `culverts[i].foundation` | foundation |
| 현장타설말뚝 | `culverts[i].cip` | cip |
| 상세입력 | `culverts[i].{parapet,wings,approach,cjoint,earthwork}` | 상세입력 화면들 |
| 설계조건 | `design` (프로젝트 공통) | designCond |
| 검토위치 | `culverts[i].checks` | checkPos |
| 하중조합 | `culverts[i].loadComb` | loadComb |
| 하중정의 | `culverts[i].loadDef` | loadDef |
| 옹벽 하중조합 | `culverts[i].wallComb` | loadCombWall |
| 해석 옵션 | `culverts[i].analysis` | frame2d / plate3d |
| 단면검토 위치 | `culverts[i].secCheck` | sectionPos |
| 배근 | `culverts[i].rebar.*` , 공통값 `rebarCommon` | 배근입력 화면들 |
| 출력 설정 | `output.report`, `output.wallReport`, `output.drawing`, `output.quantity` | 출력 화면들 |
| 3D Plate 옵션 | `culverts[i].plate3d` | plate3d |
| 해석 보기 옵션 | `culverts[i].analysis`, `culverts[i].secView` | frame2d, sectionPos |

## 구조계산 계약 (하중 → 해석 → 단면검토)
- `js/calc/design.js` (designCond 소유): `getDesign(p)` 설계조건 기본값 병합 반환.
- `js/calc/loads.js` (하중정의 소유): `loadCases(p, c, checkIndex)` →
  `[{ key, name, mark, cat, items: [{ target, kind:'dist', w1, w2, dir } | { target, kind:'point', pos, P, dir }], temp }]`
  - target: `'top' | 'bottom' | 'left' | 'right' | 'mid:0' ...` (부재군), w1/w2 = 부재 시점/종점 분포하중(kN/m, 단위폭 1m)
  - 부재 방향: 슬래브는 왼쪽→오른쪽, 벽은 아래→위. dir: 'gravity'(아래로 +) | 'x'(오른쪽 +) | 'normal'(구조물 안쪽 +)
- `js/calc/combos.js` (하중조합 소유): `combos(p, c)` → `[{ name, kind:'factored'|'factoredEcc'|'service'|'eqCollapse'|'eqFunction', factors: { [key]: f } }]`
- `js/calc/frame2d.js` (2D Frame 소유): `analyze(p, c, checkIndex)` → `{ nodes, members, cases: {key: result}, combos: [{name, kind, member forces}] , envelope(memberGroup, x) }`
- `js/calc/rcDesign.js` (단면검토 소유): 강도설계 휨/전단/균열/철근비 검토.

## 확인 방법
- 문법: `node --experimental-default-type=module --check js/screens/x.js`
- 계산: node 에서 `import('file:///C:/dev/esc_culvert_GUI/js/calc/x.js')` (store/model 은 DOM 없이 동작)
- 화면: 브라우저에서 메뉴트리 클릭. 콘솔 오류가 없어야 한다.
