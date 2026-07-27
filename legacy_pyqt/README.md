# legacy_pyqt — 전환 이전 PyQt5 원본

웹앱으로 전환하기 전의 PyQt5 데스크톱 구현이다. `pyqt-final` 태그(`efab28d`,
2026-02-11) 시점 그대로이며, **참조용 동결 사본**이다.

## 유지보수하지 않는다

기능 추가·수정은 저장소 루트의 웹 구현에만 한다. 이 폴더의 코드를 고치면
예전에 겪었던 이중 관리 문제(`cb9aef7` — Python에만 반영된 변경분을 뒤늦게
웹으로 이식)가 그대로 재발한다.

여기 있는 이유는 하나다: 아직 웹으로 옮기지 않은 메뉴(하중입력, 기타환경,
배근 입력, 출력)의 **계산 로직과 화면 구성을 확인하기 위해서**.

## 파일

| 파일 | 내용 |
|---|---|
| `esc_culvert_main.py` | 진입점 |
| `esc_culvert_main_window.py` | 메인 윈도우, 레이아웃 |
| `esc_culvert_menu_bar.py` | 메뉴바 |
| `esc_culvert_toolbars.py` | 툴바 |
| `esc_culvert_tree_widget.py` | 좌측 트리 메뉴 |
| `esc_culvert_table_widget.py` | 메뉴별 입력 테이블 (웹의 `js/forms/`에 대응) |
| `esc_culvert_graphics_view.py` | 단면도 뷰 (웹의 `js/viewer/`에 대응) |
| `buoyancy_check.py` | 부력검토 계산 |
| `utils.py` | 도형·좌표·DXF 유틸 |
| `services.py` | 프로젝트 저장/불러오기 |
| `단면제원입력Grid.png` | 단면제원 입력 화면 참조 이미지 |
| `프로젝트 정보.json` | 저장 파일 예시 |

## 실행 (원본 동작을 직접 확인해야 할 때)

```bash
pip install PyQt5
cd legacy_pyqt
python esc_culvert_main.py
```

`esc_culvert_main.py`가 같은 폴더의 모듈을 최상위 이름으로 임포트하므로
(`from esc_culvert_main_window import MainWindow`) 반드시 이 폴더 안에서
실행해야 한다.
