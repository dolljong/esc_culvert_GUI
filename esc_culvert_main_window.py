import json
import os
from PyQt5.QtWidgets import (QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
                              QSplitter, QFileDialog, QMessageBox)
from PyQt5.QtCore import Qt
from esc_culvert_menu_bar import create_menu_bar
from esc_culvert_toolbars import create_toolbars
from esc_culvert_tree_widget import CustomTreeWidget
from esc_culvert_table_widget import ESCCulvertTableWidget
from esc_culvert_graphics_view import create_graphics_view
from utils import create_sample_dxf, display_dxf, create_culvert_dxf
from buoyancy_check import generate_buoyancy_report, BuoyancyCheckDialog, create_buoyancy_shapes_dxf

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("암거설계프로그램")
        self.setGeometry(100, 100, 1200, 800)
        self._current_file_path = None

        self.create_menu_bar()
        self.create_toolbars()

        self.create_central_widget()

        self.statusBar().showMessage('기본 정보를 입력하세요')
        # 프로그램 시작 시 첫 번째 아이템 선택
        self.select_default_tree_item()

    def create_menu_bar(self):
        menu_items = create_menu_bar(self)
        self.menuBar = menu_items[0]
        self.file_menu = menu_items[1]
        self.edit_menu = menu_items[2]
        self.detail_menu = menu_items[3]
        self.view_menu = menu_items[4]
        self.show_tree_action = menu_items[5]

    def create_toolbars(self):
        self.basic_toolbar, _, _ = create_toolbars(self)
        self.addToolBar(self.basic_toolbar)

        # 기본 툴바만 표시
        self.basic_toolbar.show()

    def create_central_widget(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_layout = QHBoxLayout(central_widget)

        # 스플리터 생성
        self.splitter = QSplitter(Qt.Horizontal)
        main_layout.addWidget(self.splitter)

        # CustomTreeWidget 생성 및 추가
        self.custom_tree_widget = CustomTreeWidget()
        self.splitter.addWidget(self.custom_tree_widget)

        # 오른쪽 레이아웃을 위한 위젯 생성
        right_widget = QWidget()
        right_layout = QVBoxLayout(right_widget)
        self.splitter.addWidget(right_widget)

        # 그래픽 뷰 생성 및 추가
        self.graphics_view = create_graphics_view()
        right_layout.addWidget(self.graphics_view, 2)

        # 테이블 위젯 생성 및 추가
        self.table_widget = ESCCulvertTableWidget()
        self.table_widget.culvert_data_changed.connect(self.draw_culvert_section)
        right_layout.addWidget(self.table_widget, 1)

        # 스플리터 비율 설정
        self.splitter.setSizes([int(self.width() * 0.3), int(self.width() * 0.7)])

        # 트리 위젯 아이템 클릭 이벤트 연결
        self.custom_tree_widget.tree_widget.itemClicked.connect(self.on_tree_item_clicked)

        # CustomTreeWidget의 closed 시그널 연결
        self.custom_tree_widget.closed.connect(self.handle_tree_widget_closed)

    def on_tree_item_clicked(self, item):
        menu_name = item.text(0)
        full_path = self.get_full_item_path(item)

        # 하위 메뉴가 있는지 확인
        if item.childCount() > 0:
            # 하위 메뉴가 있다면 첫 번째 하위 메뉴 항목을 선택
            first_child = item.child(0)
            menu_name = first_child.text(0)
            full_path += " > " + menu_name
            # 첫 번째 하위 메뉴 항목을 선택된 상태로 만듦
            self.custom_tree_widget.tree_widget.setCurrentItem(first_child)

        self.statusBar().showMessage(f'{menu_name}이(가) 선택되었습니다')

        # 부력검토 메뉴 처리
        if menu_name == '부력검토':
            self.show_buoyancy_check()
            return

        # 테이블 위젯 업데이트
        self.table_widget.update_content(full_path)

        # DXF 표시 업데이트
        self.update_dxf_view(item)

    def get_full_item_path(self, item):
        path = []
        while item is not None:
            path.append(item.text(0))
            item = item.parent()
        return " > ".join(reversed(path))

    def select_default_tree_item(self):
        # 트리 위젯의 첫 번째 아이템 선택
        root_item = self.custom_tree_widget.tree_widget.topLevelItem(0)
        if root_item:
            self.custom_tree_widget.tree_widget.setCurrentItem(root_item)
            self.on_tree_item_clicked(root_item)

    def handle_tree_widget_closed(self):
        self.show_tree_action.setChecked(False)
        self.update_splitter()

    def update_splitter(self):
        if self.custom_tree_widget.isVisible():
            self.splitter.setSizes([int(self.width() * 0.3), int(self.width() * 0.7)])
        else:
            self.splitter.setSizes([0, int(self.width())])

    def toggle_tree_widget(self):
        if self.custom_tree_widget.isVisible():
            self.custom_tree_widget.hide()
            self.show_tree_action.setChecked(False)
        else:
            self.custom_tree_widget.show()
            self.show_tree_action.setChecked(True)
        self.update_splitter()

    def update_dxf_view(self, item):
        """트리 아이템에 따라 DXF 뷰를 업데이트"""
        parent_item = item.parent()
        if parent_item:
            parent_name = parent_item.text(0)
            child_name = item.text(0)
        else:
            parent_name = item.text(0)
            child_name = None

        # 단면제원인 경우 입력된 데이터로 암거 그리기
        if child_name == "단면제원":
            self.draw_culvert_section()
        else:
            # 샘플 DXF 생성 및 표시
            doc = create_sample_dxf(parent_name, child_name)
            scene = self.graphics_view.scene()
            display_dxf(doc, scene)
            # 뷰를 씬 내용에 맞게 조정
            self.graphics_view.fit_to_scene()

    def draw_culvert_section(self):
        """단면제원 데이터로 암거 단면 그리기"""
        culvert_data = self.table_widget.get_culvert_section_data()
        if culvert_data:
            ground_info = self.table_widget.get_ground_info()
            doc = create_culvert_dxf(culvert_data, ground_info)
            scene = self.graphics_view.scene()
            display_dxf(doc, scene)
            self.graphics_view.fit_to_scene()

    def show_buoyancy_check(self):
        """부력검토 실행: 분할 도형 그리기 + 결과 팝업 표시"""
        self.table_widget._save_section_data_to_cache()
        section_data = self.table_widget.get_culvert_section_data()
        ground_info = self.table_widget.get_ground_info()

        if not section_data:
            QMessageBox.warning(self, '부력검토', '단면제원 데이터가 없습니다.')
            return

        # 그림 영역에 분할 도형 표시
        doc = create_buoyancy_shapes_dxf(section_data)
        scene = self.graphics_view.scene()
        display_dxf(doc, scene)
        self.graphics_view.fit_to_scene()

        # 계산서 팝업
        report = generate_buoyancy_report(section_data, ground_info)
        dialog = BuoyancyCheckDialog(report, self)
        dialog.exec_()

    # ========================================
    # 파일 저장/불러오기/DXF 내보내기
    # ========================================

    def _collect_project_data(self):
        """현재 프로젝트의 전체 데이터를 딕셔너리로 수집"""
        # 단면제원 위젯이 열려 있으면 최신 값 캐시
        self.table_widget._save_section_data_to_cache()

        return {
            'projectInfo': {
                'businessName': '',
                'client': '',
                'constructor': '',
                'siteName': ''
            },
            'designConditions': {
                'standard': '콘크리트구조기준',
                'designLife': '100년',
                'environment': '건조 환경'
            },
            'materials': self.table_widget.get_material_properties(),
            'groundInfo': self.table_widget.get_ground_info(),
            'sectionData': self.table_widget.get_culvert_section_data()
        }

    def _apply_project_data(self, data):
        """불러온 데이터를 위젯에 적용"""
        tw = self.table_widget

        # 재료 특성
        mat = data.get('materials', {})
        tw.concrete_strength = mat.get('fck', 30.0)
        tw.rebar_yield_strength = mat.get('fy', 400.0)

        # 지반정보
        gi = data.get('groundInfo', {})
        tw.ground_info = {
            'earthCoverDepth': gi.get('earthCoverDepth', 2000),
            'groundwaterLevel': gi.get('groundwaterLevel', 3000),
            'frictionAngle': gi.get('frictionAngle', 30),
            'soilUnitWeight': gi.get('soilUnitWeight', 18.0)
        }

        # 단면 데이터
        sd = data.get('sectionData', {})
        if sd:
            # 헌치
            haunch = sd.get('haunch', None)
            if haunch:
                tw.haunch_data = haunch

            # 기둥및종거더
            cg = sd.get('columnGirder', None)
            if cg:
                tw.column_girder_data = cg

            # 부상방지저판
            af = sd.get('antiFloat', None)
            if af:
                tw.anti_float_data = af

            # 캐시 갱신 (단면 테이블 값)
            tw._cached_culvert_data = {
                'culvert_count': sd.get('culvert_count', 3),
                'H': sd.get('H', 4200),
                'H4': sd.get('H4', 0),
                'B': sd.get('B', [4000, 4000, 4000]),
                'UT': sd.get('UT', 600),
                'LT': sd.get('LT', 800),
                'WL': sd.get('WL', 600),
                'WR': sd.get('WR', 600),
                'middle_walls': sd.get('middle_walls', [
                    {'type': '연속벽', 'thickness': 600},
                    {'type': '연속벽', 'thickness': 600}
                ]),
                'haunch': tw.haunch_data,
                'columnGirder': tw.column_girder_data,
                'antiFloat': tw.anti_float_data
            }

        # 현재 보고 있는 폼 다시 그리기
        current_item = self.custom_tree_widget.tree_widget.currentItem()
        if current_item:
            self.on_tree_item_clicked(current_item)

    def save_project(self):
        """프로젝트를 JSON 파일로 저장"""
        file_path, _ = QFileDialog.getSaveFileName(
            self, '프로젝트 저장',
            self._current_file_path or 'esc_culvert_project.json',
            'JSON 파일 (*.json);;모든 파일 (*)'
        )
        if not file_path:
            return

        try:
            data = self._collect_project_data()
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            self._current_file_path = file_path
            self.statusBar().showMessage(f'저장 완료: {os.path.basename(file_path)}')
        except Exception as e:
            QMessageBox.critical(self, '저장 오류', f'파일 저장에 실패했습니다.\n{e}')

    def load_project(self):
        """JSON 파일에서 프로젝트 불러오기"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, '프로젝트 불러오기',
            '',
            'JSON 파일 (*.json);;모든 파일 (*)'
        )
        if not file_path:
            return

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            self._apply_project_data(data)
            self._current_file_path = file_path
            self.statusBar().showMessage(f'불러오기 완료: {os.path.basename(file_path)}')
        except json.JSONDecodeError:
            QMessageBox.critical(self, '불러오기 오류', '유효하지 않은 JSON 파일입니다.')
        except Exception as e:
            QMessageBox.critical(self, '불러오기 오류', f'파일을 불러오는데 실패했습니다.\n{e}')

    def export_dxf(self):
        """현재 단면을 DXF 파일로 내보내기"""
        file_path, _ = QFileDialog.getSaveFileName(
            self, 'DXF 파일로 내보내기',
            'esc_culvert_section.dxf',
            'DXF 파일 (*.dxf);;모든 파일 (*)'
        )
        if not file_path:
            return

        try:
            culvert_data = self.table_widget.get_culvert_section_data()
            if not culvert_data:
                QMessageBox.warning(self, '내보내기 오류', '단면제원 데이터가 없습니다.')
                return

            ground_info = self.table_widget.get_ground_info()
            doc = create_culvert_dxf(culvert_data, ground_info)
            doc.saveas(file_path)
            self.statusBar().showMessage(f'DXF 내보내기 완료: {os.path.basename(file_path)}')
        except Exception as e:
            QMessageBox.critical(self, '내보내기 오류', f'DXF 파일 내보내기에 실패했습니다.\n{e}')
