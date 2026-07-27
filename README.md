# ESC Culvert — 암거 설계 프로그램 (웹)

브라우저에서 동작하는 암거(box culvert) 설계 프로그램. 단면 제원을 입력하면
단면도를 실시간으로 그리고, 부력검토 계산서와 DXF 도면을 만들어 준다.

빌드 도구나 서버 사이드 로직이 없는 **정적 웹앱**이다. HTML/CSS/바닐라 JS(ES 모듈)만
쓴다. 설치할 의존성도, 실행할 빌드도 없다.

> 이 저장소는 원래 PyQt5 데스크톱 프로그램이었다. 웹으로 전환하면서 Python 구현은
> 제거했고, 전환 직전 상태는 `pyqt-final` 태그에 남아 있다.

---

## 실행

ES 모듈은 `file://`에서 CORS 정책상 로드되지 않는다. **반드시 HTTP로 서빙**해야 한다.
`index.html`을 파일 탐색기에서 더블클릭하면 빈 화면만 나온다.

저장소 루트에서:

```bash
npx serve .              # Node가 있으면
python -m http.server    # Python이 있으면 (개발 도구로만 사용)
```

접속: `http://localhost:3000` 또는 `http://localhost:8000`

### 개발 중 캐시 주의

브라우저가 JS/CSS를 메모리 캐시에 잡아두면 수정한 내용이 반영되지 않는다.
개발자 도구(F12)를 열고 Network 탭의 **Disable cache**를 켜두거나, 강제 새로고침
(`Ctrl+Shift+R`)을 쓴다.

---

## 사내 서버 배포

정적 파일만 올리면 된다. 웹서버(nginx / IIS / Caddy 등) 문서 루트를 이 저장소
루트로 지정한다. 애플리케이션 서버, 데이터베이스, 런타임 모두 필요 없다.

```
/index.html
/css/       main.css, tree.css, forms.css, viewer.css
/js/        app.js, state.js, tree.js, forms/, viewer/, utils/, ui/
/data/      defaultProject.json
/docs/      A-Culvert 사용자 설명서, 분석 문서
```

### 서버 설정에서 반드시 확인할 것

| 항목 | 이유 |
|---|---|
| `charset utf-8` | 파일과 UI 전체가 한글이다. 빠지면 글자가 깨진다. |
| `.js` → `Content-Type: text/javascript` | ES 모듈은 MIME 타입이 틀리면 **로드 자체가 거부**된다. |
| `.js`/`.css`에 `Cache-Control: no-cache` | 사용자 브라우저에 구버전이 박히는 사고를 막는다. |

nginx 예시:

```nginx
server {
    listen 80;
    server_name culvert.example.local;
    root /srv/esc_culvert;
    charset utf-8;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css)$ {
        add_header Cache-Control "no-cache";
    }
}
```

배포 후 헤더에 표시되는 버전(`js/ui/statusBar.js`의 `APP_VERSION`)을 올려두면,
설계자들이 서로 다른 버전을 보고 있는 상황을 화면 우하단에서 바로 확인할 수 있다.

---

## 데이터가 저장되는 위치 — 중요

**서버에는 아무것도 저장되지 않는다.** 백엔드가 없기 때문이다.

- 작업 내용은 접속한 **브라우저의 localStorage에 자동 저장**된다(변경 후 1초).
  하단 상태 표시줄에서 마지막 자동저장 시각을 볼 수 있다.
- 따라서 데이터는 **그 PC, 그 브라우저에만** 남는다. 다른 설계자에게 보이지 않고,
  같은 사람이라도 다른 PC에서 접속하면 보이지 않는다.
- 브라우저 데이터 삭제, 시크릿 모드, 접속 주소(호스트·포트) 변경 시 사라진다.

### 그래서 프로젝트 공유·보관은 파일로 한다

- **저장**(`Ctrl+S`) — 현재 프로젝트를 JSON 파일로 내려받는다.
- **불러오기**(`Ctrl+O`) — 받은 JSON 파일을 연다.

중요한 작업은 JSON 파일로 내려받아 공용 드라이브에 보관하는 것을 권장한다.

> 여러 설계자가 서버에 프로젝트를 공유 저장해야 한다면 백엔드가 필요하다.
> 그때를 대비해 저장 계층은 `js/utils/storage.js` 한 파일에 격리해 두었다
> (`setBackend()`로 교체). 폼이나 화면 코드는 수정할 필요가 없다.

---

## 기능

| 메뉴 | 상태 |
|---|---|
| 프로젝트 정보 | 구현 |
| 설계조건 › 기본환경 / 재료특성 / 지반정보 | 구현 |
| 설계조건 › 기타환경 | 미구현 |
| 단면입력 › 단면제원 (단면제원·내부헌치·기둥및종거더·부상방지저판) | 구현 |
| 단면입력 › 분점 정의 / 하중 정의 | 미구현 |
| 하중입력 | 미구현 |
| 안정검토 › 부력검토 | 구현 |
| 배근 입력 › 휨철근 / 전단철근 | 미구현 |
| 출력 | 미구현 |

그 밖에: SVG 단면도 실시간 렌더링, 줌/팬, DXF 내보내기(치수선·화살표 포함).

### 단축키

| 키 | 동작 |
|---|---|
| `Ctrl+S` | 프로젝트를 JSON 파일로 저장 |
| `Ctrl+O` | JSON 파일에서 불러오기 |

---

## 코드 구조

```
js/
  app.js                 진입점, 이벤트 연결, 자동저장
  state.js               앱 상태 + 변경 이벤트 (menuChange / sectionDataChange / stateChange)
  tree.js                좌측 트리 메뉴
  forms/                 메뉴별 입력 폼
  viewer/
    svgRenderer.js       단면도·부력검토 도형 SVG 렌더링
    zoomPan.js           줌/팬
  utils/
    dxfExport.js         DXF 생성 (svgRenderer와 같은 좌표·치수 규칙)
    storage.js           저장소 (localStorage, 교체 가능)
  ui/
    layout.js            트리 토글, 패널 크기 조절
    statusBar.js         상태 표시줄, 버전
```

화면(`svgRenderer.js`)과 DXF(`dxfExport.js`)는 같은 도면을 각각 그린다.
도형·치수를 고칠 때는 **두 파일을 함께** 수정해야 화면과 출력이 어긋나지 않는다.
