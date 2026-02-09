from PyQt5.QtWidgets import (QTableWidget, QTableWidgetItem, QWidget, QVBoxLayout,
    QHBoxLayout, QLabel, QScrollArea, QHeaderView, QComboBox, QDoubleSpinBox,
    QPushButton, QCheckBox, QTabWidget, QFrame, QGridLayout, QSpinBox)
from PyQt5.QtCore import Qt, QEvent, pyqtSignal
from PyQt5.QtGui import QColor, QFont, QKeyEvent

class ESCCulvertTableWidget(QWidget):
    # 단면제원 데이터 변경 시그널
    culvert_data_changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.concrete_strength = 30.0
        self.rebar_yield_strength = 400.0
        self.section_data = []
        # 지반정보 기본값
        self.ground_info = {
            'earthCoverDepth': 2000,
            'groundwaterLevel': 3000,
            'frictionAngle': 30,
            'soilUnitWeight': 18.0
        }
        # 내부헌치 기본값
        self.haunch_data = {
            'leftWall': {'upper': {'width': 300, 'height': 300}, 'lower': {'width': 300, 'height': 300}},
            'middleWalls': [],
            'rightWall': {'upper': {'width': 300, 'height': 300}, 'lower': {'width': 300, 'height': 300}}
        }
        # 부상방지저판 기본값
        self.anti_float_data = {
            'use': False,
            'leftExtension': 500,
            'rightExtension': 500,
            'thickness': 300
        }
        # 단면 데이터 캐시 (위젯이 삭제된 후에도 유지)
        self._cached_culvert_data = {
            'culvert_count': 3,
            'H': 4200, 'H4': 0,
            'B': [4000, 4000, 4000],
            'UT': 600, 'LT': 800,
            'WL': 600, 'WR': 600,
            'middle_walls': [
                {'type': '연속벽', 'thickness': 600},
                {'type': '연속벽', 'thickness': 600}
            ],
            'haunch': self.haunch_data,
            'antiFloat': self.anti_float_data
        }
        self.initUI()

    def initUI(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        self.header_label = QLabel()
        self.header_label.setStyleSheet("""
            font-size: 14px; 
            padding: 10px;
            background-color: #f0f0f0;
            color: #333333;
            border-bottom: 2px solid #e0e0e0;
        """)
        self.header_label.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        layout.addWidget(self.header_label)

        self.table = QTableWidget()
        self.table.setAlternatingRowColors(True)
        self.table.setShowGrid(False)
        self.table.setStyleSheet("""
            QTableWidget {
                background-color: white;
                alternate-background-color: #f9f9f9;
                selection-background-color: #e6f3ff;
            }
            QHeaderView::section {
                background-color: #f0f0f0;
                padding: 5px;
                border: none;
                font-weight: bold;
            }
            QTableWidget::item {
                padding: 5px;
            }
        """)
        self.table.installEventFilter(self)
        self.table.itemChanged.connect(self.on_item_changed)
        layout.addWidget(self.table)

        self.button_layout = QHBoxLayout()
        layout.addLayout(self.button_layout)

    def eventFilter(self, source, event):
        if (source is self.table and event.type() == QEvent.KeyPress and 
            event.key() in (Qt.Key_Enter, Qt.Key_Return)):
            self.moveToNextCell()
            return True
        return super().eventFilter(source, event)

    def moveToNextCell(self):
        current_row = self.table.currentRow()
        current_col = self.table.currentColumn()

        if current_col < self.table.columnCount() - 1:
            next_col = current_col + 1
            next_row = current_row
        elif current_row < self.table.rowCount() - 1:
            next_col = 1  # Skip the checkbox column
            next_row = current_row + 1
        else:
            next_col = 1  # Skip the checkbox column
            next_row = 0

        self.table.setCurrentCell(next_row, next_col)

    def update_content(self, item_text):
        self.header_label.setText(item_text)

        # 기존 단면제원 위젯 제거
        if hasattr(self, 'section_widget') and self.section_widget:
            self.section_widget.setParent(None)
            self.section_widget.deleteLater()
            self.section_widget = None

        # 테이블 다시 표시 및 초기화
        self.table.show()
        self.table.clear()
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels(["항목", "내용"])

        for i in reversed(range(self.button_layout.count())):
            self.button_layout.itemAt(i).widget().setParent(None)

        if "프로젝트 정보" in item_text:
            self.setup_project_info()
        elif "기본환경" in item_text:
            self.setup_basic_environment()
        elif "단면제원" in item_text:
            self.setup_section_properties()
        elif "재료특성" in item_text:
            self.setup_material_properties()
        elif "지반정보" in item_text:
            self.setup_ground_info()
        else:
            self.table.setRowCount(1)
            self.set_table_item(0, 0, "선택된 메뉴", editable=False)
            self.set_table_item(0, 1, item_text)

        self.table.resizeColumnsToContents()
        self.table.resizeRowsToContents()

    def setup_project_info(self):
        self.table.setRowCount(4)
        items = [
            ("사업명", "테스트 사업"),
            ("발주처", "한국도로공사"),
            ("시공사", "(주)ESC"),
            ("현장명", "서울")
        ]
        for row, (item, content) in enumerate(items):
            self.set_table_item(row, 0, item, editable=False)
            self.set_table_item(row, 1, content)

    def set_table_item(self, row, column, text, editable=True):
        item = QTableWidgetItem(text)
        if not editable:
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
        self.table.setItem(row, column, item)

    def set_combo_box(self, row, column, items):
        combo = QComboBox()
        combo.addItems(items)
        self.table.setCellWidget(row, column, combo)

    def setup_basic_environment(self):
        self.table.setRowCount(3)
        items = [
            ("설계기준", ["콘크리트구조기준","도로교설계기준(강도설계법)", "도로교설계기준(한계상태설계법)"]),
            ("설계수명", "100년"),
            ("환경조건", ["건조 환경", "습윤 환경", "부식성 환경", "고부식성 환경"])
        ]
        for row, (item, content) in enumerate(items):
            self.set_table_item(row, 0, item, editable=False)
            if isinstance(content, list):
                self.set_combo_box(row, 1, content)
            else:
                self.set_table_item(row, 1, content)

    def setup_section_properties(self):
        # 기존 테이블 숨기기
        self.table.hide()

        # 단면제원 전용 위젯 생성
        self.section_widget = QWidget()
        section_layout = QVBoxLayout(self.section_widget)
        section_layout.setContentsMargins(5, 5, 5, 5)
        section_layout.setSpacing(5)

        # 상단 컨트롤 영역
        top_control = QHBoxLayout()

        # 암거 콤보박스
        culvert_combo = QComboBox()
        culvert_combo.addItems(["암거 1 : 일반암거", "암거 2 : 일반암거", "암거 3 : 일반암거"])
        culvert_combo.setMinimumWidth(150)
        top_control.addWidget(culvert_combo)

        # BLOCK 콤보박스
        block_combo = QComboBox()
        block_combo.addItems(["BLOCK 1", "BLOCK 2", "BLOCK 3"])
        block_combo.setMinimumWidth(100)
        top_control.addWidget(block_combo)

        # 암거련수
        top_control.addWidget(QLabel("암거련수"))
        self.culvert_count_spin = QSpinBox()
        self.culvert_count_spin.setRange(1, 10)
        self.culvert_count_spin.setValue(3)
        self.culvert_count_spin.setSuffix("련")
        self.culvert_count_spin.valueChanged.connect(self.on_culvert_count_changed)
        top_control.addWidget(self.culvert_count_spin)

        top_control.addStretch()
        section_layout.addLayout(top_control)

        # 탭 위젯
        self.section_tab_widget = QTabWidget()
        self.section_tab_widget.setStyleSheet("""
            QTabWidget::pane {
                border: 1px solid #cccccc;
                background: white;
            }
            QTabBar::tab {
                background: #e0e0e0;
                padding: 5px 15px;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background: white;
                border-bottom: 2px solid #4a90d9;
            }
        """)

        # 단면제원 탭
        self.section_tab = self.create_section_tab(self.culvert_count_spin.value())
        self.section_tab_widget.addTab(self.section_tab, "단면제원")

        # 내부헌치 탭
        self.haunch_tab = self.create_haunch_tab(self.culvert_count_spin.value())
        self.section_tab_widget.addTab(self.haunch_tab, "내부헌치")

        # 부상방지저판 탭
        self.float_tab = self.create_anti_float_tab()
        self.section_tab_widget.addTab(self.float_tab, "부상방지저판")

        section_layout.addWidget(self.section_tab_widget)

        # 레이아웃에 추가
        self.layout().addWidget(self.section_widget)

    def on_culvert_count_changed(self, value):
        """암거련수 변경 시 테이블 재생성"""
        # 기존 단면제원 탭 제거 및 재생성
        self.section_tab_widget.removeTab(0)
        self.section_tab = self.create_section_tab(value)
        self.section_tab_widget.insertTab(0, self.section_tab, "단면제원")

        # 내부헌치 탭도 재생성 (중간벽 수 변경 반영)
        self.section_tab_widget.removeTab(1)
        self.haunch_tab = self.create_haunch_tab(value)
        self.section_tab_widget.insertTab(1, self.haunch_tab, "내부헌치")

        # 헌치 중간벽 배열 크기 조정
        middle_wall_count = value - 1
        while len(self.haunch_data['middleWalls']) < middle_wall_count:
            self.haunch_data['middleWalls'].append(
                {'upper': {'width': 300, 'height': 300}, 'lower': {'width': 300, 'height': 300}})
        self.haunch_data['middleWalls'] = self.haunch_data['middleWalls'][:middle_wall_count]

        self.section_tab_widget.setCurrentIndex(0)
        # 데이터 변경 시그널 emit
        self.culvert_data_changed.emit()

    def create_section_tab(self, culvert_count):
        """단면제원 탭 내용 생성"""
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(0, 0, 0, 0)

        # 중간벽 개수 계산 (암거련수 - 1)
        middle_wall_count = culvert_count - 1

        # 테이블 생성
        section_table = QTableWidget()
        section_table.setStyleSheet("""
            QTableWidget {
                gridline-color: #cccccc;
                background-color: white;
            }
            QTableWidget::item {
                padding: 2px;
            }
        """)

        # 내공제원 열: 높이(2) + 폭(암거련수)
        inner_section_cols = 2 + culvert_count
        # 중간벽 열: 각 중간벽마다 2열 (벽체형식, 두께)
        middle_wall_cols = middle_wall_count * 2
        # 기본 열: 내공제원 + 슬래브두께(2) + 좌측벽(1) + 우측벽(1)
        total_cols = inner_section_cols + 2 + 1 + middle_wall_cols + 1

        section_table.setColumnCount(total_cols)
        section_table.setRowCount(3)  # 헤더2행 + 데이터1행

        # 헤더 숨기기
        section_table.horizontalHeader().setVisible(False)
        section_table.verticalHeader().setVisible(False)

        # 1행: 대분류 헤더
        headers1 = [
            ("내공제원", inner_section_cols),
            ("슬래브두께", 2),
            ("좌측벽", 1),
        ]

        # 중간벽 헤더 추가 (중간벽이 있을 경우)
        if middle_wall_count > 0:
            headers1.append(("중간벽", middle_wall_cols))

        headers1.append(("우측벽", 1))

        col = 0
        for text, span in headers1:
            item = QTableWidgetItem(text)
            item.setTextAlignment(Qt.AlignCenter)
            item.setBackground(QColor("#d6e6f5"))
            item.setFont(QFont("", -1, QFont.Bold))
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
            section_table.setItem(0, col, item)
            if span > 1:
                section_table.setSpan(0, col, 1, span)
            col += span

        # 2행: 소분류 헤더
        headers2 = ["높이\nH", "H4"]

        # 폭 헤더 추가 (암거련수만큼)
        for i in range(culvert_count):
            headers2.append(f"폭\nB{i+1}")

        headers2.extend(["상부\nUT", "하부\nLT", "WL"])

        # 중간벽 소분류 헤더 추가
        for i in range(middle_wall_count):
            headers2.append(f"벽체{i+1}")
            headers2.append(f"C{i+1}")

        headers2.append("WR")

        for col, text in enumerate(headers2):
            item = QTableWidgetItem(text)
            item.setTextAlignment(Qt.AlignCenter)
            item.setBackground(QColor("#e8f0f8"))
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
            section_table.setItem(1, col, item)

        # 3행: 데이터
        data_values = ["4200", "0"]

        # 폭 데이터 추가 (암거련수만큼)
        for i in range(culvert_count):
            data_values.append("4000")

        data_values.extend(["600", "800", "600"])

        # 중간벽 데이터 추가
        for i in range(middle_wall_count):
            data_values.append("연속벽")  # 벽체 형식
            data_values.append("600")     # 두께

        data_values.append("600")  # 우측벽

        for col, value in enumerate(data_values):
            if value == "연속벽":
                combo = QComboBox()
                combo.addItems(["연속벽", "기둥"])
                section_table.setCellWidget(2, col, combo)
            else:
                item = QTableWidgetItem(value)
                item.setTextAlignment(Qt.AlignCenter)
                section_table.setItem(2, col, item)

        # 열 너비 조정
        for col in range(total_cols):
            section_table.setColumnWidth(col, 70)

        # 행 높이 조정
        section_table.setRowHeight(0, 30)
        section_table.setRowHeight(1, 40)
        section_table.setRowHeight(2, 30)

        # 테이블 값 변경 시 시그널 연결
        section_table.itemChanged.connect(self.on_section_table_changed)

        layout.addWidget(section_table)
        layout.addStretch()

        self.section_table = section_table
        return tab

    def on_section_table_changed(self, item):
        """단면제원 테이블 값 변경 시"""
        # 데이터 행(2행)의 값이 변경된 경우에만 시그널 emit
        if item.row() == 2:
            self.culvert_data_changed.emit()

    def create_haunch_tab(self, culvert_count):
        """내부헌치 탭 내용 생성"""
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(5, 5, 5, 5)
        layout.setSpacing(10)

        middle_wall_count = culvert_count - 1

        # 헌치 중간벽 배열 크기 보장
        while len(self.haunch_data['middleWalls']) < middle_wall_count:
            self.haunch_data['middleWalls'].append(
                {'upper': {'width': 300, 'height': 300}, 'lower': {'width': 300, 'height': 300}})

        # 벽체별 헌치 카드 생성
        walls = [('좌측벽체', 'leftWall', self.haunch_data['leftWall'], None)]
        for i in range(middle_wall_count):
            walls.append((f'중간벽체{i+1}', 'middleWall', self.haunch_data['middleWalls'][i], i))
        walls.append(('우측벽체', 'rightWall', self.haunch_data['rightWall'], None))

        cards_layout = QHBoxLayout()
        for title, wall_key, wall_data, idx in walls:
            card = self._create_haunch_card(title, wall_key, wall_data, idx)
            cards_layout.addWidget(card)

        layout.addLayout(cards_layout)

        note = QLabel("* 모든 치수 단위: mm  |  좌측벽체 입력 시 우측벽체 자동 동기화")
        note.setStyleSheet("color: #888; font-size: 11px;")
        layout.addWidget(note)
        layout.addStretch()

        return tab

    def _create_haunch_card(self, title, wall_key, wall_data, index):
        """헌치 벽체 카드 위젯 생성"""
        card = QFrame()
        card.setFrameStyle(QFrame.Box | QFrame.Raised)
        card.setStyleSheet("QFrame { border: 1px solid #ccc; border-radius: 4px; padding: 5px; }")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(5, 5, 5, 5)

        title_label = QLabel(title)
        title_label.setFont(QFont("", -1, QFont.Bold))
        title_label.setAlignment(Qt.AlignCenter)
        card_layout.addWidget(title_label)

        table = QTableWidget(2, 2)
        table.setHorizontalHeaderLabels(["폭", "높이"])
        table.setVerticalHeaderLabels(["상단", "하단"])
        table.horizontalHeader().setStretchLastSection(True)
        table.verticalHeader().setDefaultSectionSize(30)

        for row, pos in enumerate(['upper', 'lower']):
            for col, dim in enumerate(['width', 'height']):
                spin = QSpinBox()
                spin.setRange(0, 10000)
                spin.setSingleStep(50)
                spin.setValue(wall_data[pos][dim])
                spin.setProperty('wall_key', wall_key)
                spin.setProperty('wall_index', index)
                spin.setProperty('h_pos', pos)
                spin.setProperty('h_dim', dim)
                spin.valueChanged.connect(self._on_haunch_changed)
                table.setCellWidget(row, col, spin)

        table.setFixedHeight(100)
        card_layout.addWidget(table)
        return card

    def _on_haunch_changed(self, value):
        """헌치 값 변경 처리"""
        sender = self.sender()
        wall_key = sender.property('wall_key')
        wall_index = sender.property('wall_index')
        h_pos = sender.property('h_pos')
        h_dim = sender.property('h_dim')

        if wall_key == 'middleWall':
            self.haunch_data['middleWalls'][wall_index][h_pos][h_dim] = value
        else:
            self.haunch_data[wall_key][h_pos][h_dim] = value

        # 좌측벽체 → 우측벽체 자동 동기화
        if wall_key == 'leftWall':
            self.haunch_data['rightWall'][h_pos][h_dim] = value
            # 헌치 탭 재생성하여 우측벽체 값 반영
            if hasattr(self, 'section_tab_widget') and hasattr(self, 'culvert_count_spin'):
                current_tab_index = self.section_tab_widget.currentIndex()
                self.section_tab_widget.removeTab(1)
                self.haunch_tab = self.create_haunch_tab(self.culvert_count_spin.value())
                self.section_tab_widget.insertTab(1, self.haunch_tab, "내부헌치")
                self.section_tab_widget.setCurrentIndex(current_tab_index)

        self.culvert_data_changed.emit()

    def create_anti_float_tab(self):
        """부상방지저판 탭 내용 생성"""
        tab = QWidget()
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        # 적용 체크박스
        self.anti_float_check = QCheckBox("부상방지저판 적용")
        self.anti_float_check.setChecked(self.anti_float_data['use'])
        self.anti_float_check.stateChanged.connect(self._on_anti_float_use_changed)
        layout.addWidget(self.anti_float_check)

        # 입력 테이블
        self.anti_float_table = QTableWidget(1, 3)
        self.anti_float_table.setHorizontalHeaderLabels(["좌측 확장폭 (mm)", "우측 확장폭 (mm)", "두께 (mm)"])
        self.anti_float_table.verticalHeader().setVisible(False)
        self.anti_float_table.horizontalHeader().setStretchLastSection(True)
        self.anti_float_table.setFixedHeight(60)

        fields = [
            ('leftExtension', self.anti_float_data['leftExtension']),
            ('rightExtension', self.anti_float_data['rightExtension']),
            ('thickness', self.anti_float_data['thickness'])
        ]
        for col, (key, value) in enumerate(fields):
            spin = QSpinBox()
            spin.setRange(0, 10000)
            spin.setSingleStep(50)
            spin.setValue(value)
            spin.setEnabled(self.anti_float_data['use'])
            spin.setProperty('af_key', key)
            spin.valueChanged.connect(self._on_anti_float_value_changed)
            self.anti_float_table.setCellWidget(0, col, spin)

        layout.addWidget(self.anti_float_table)

        note = QLabel("* 모든 치수 단위: mm")
        note.setStyleSheet("color: #888; font-size: 11px;")
        layout.addWidget(note)
        layout.addStretch()

        return tab

    def _on_anti_float_use_changed(self, state):
        """부상방지저판 적용 체크박스 변경"""
        use = state == Qt.Checked
        self.anti_float_data['use'] = use
        for col in range(3):
            widget = self.anti_float_table.cellWidget(0, col)
            if widget:
                widget.setEnabled(use)
        self.culvert_data_changed.emit()

    def _on_anti_float_value_changed(self, value):
        """부상방지저판 값 변경 처리"""
        sender = self.sender()
        key = sender.property('af_key')
        self.anti_float_data[key] = value
        self.culvert_data_changed.emit()

    def add_section_row(self, section=None):
        row = self.table.rowCount()
        self.table.insertRow(row)
        
        checkbox = QCheckBox()
        self.table.setCellWidget(row, 0, checkbox)
        
        if section is None:
            section = {"구분": f"단면{row+1}", "높이": "", "폭": ""}
        
        self.set_table_item(row, 1, section["구분"])
        self.set_table_item(row, 2, str(section["높이"]))
        self.set_table_item(row, 3, str(section["폭"]))
        
        # Ensure section_data is in sync with the table
        if row >= len(self.section_data):
            self.section_data.append(section)
        else:
            self.section_data[row] = section

    def delete_selected_rows(self):
        rows_to_delete = []
        for row in range(self.table.rowCount()):
            checkbox = self.table.cellWidget(row, 0)
            if checkbox and checkbox.isChecked():
                rows_to_delete.append(row)
        
        for row in sorted(rows_to_delete, reverse=True):
            self.table.removeRow(row)
            if row < len(self.section_data):
                del self.section_data[row]
        
        # Renumber remaining rows
        for row in range(self.table.rowCount()):
            self.table.item(row, 1).setText(f"단면{row+1}")
            self.section_data[row]["구분"] = f"단면{row+1}"
        
        if self.table.rowCount() == 0:
            self.add_section_row()


    def on_item_changed(self, item):
        row = item.row()
        col = item.column()
        if 1 <= col <= 3:  # 구분, 높이, 폭 열만 처리
            key = ["구분", "높이", "폭"][col-1]
            # Ensure the row exists in section_data
            while row >= len(self.section_data):
                self.section_data.append({"구분": "", "높이": "", "폭": ""})
            self.section_data[row][key] = item.text()

    def setup_material_properties(self):
        self.table.setRowCount(2)
        items = [
            ("콘크리트 강도 (fck)", self.concrete_strength),
            ("철근항복강도 (fy)", self.rebar_yield_strength)
        ]
        for row, (item, value) in enumerate(items):
            self.set_table_item(row, 0, item, editable=False)
            spin_box = QDoubleSpinBox()
            spin_box.setRange(0, 1000)
            spin_box.setValue(value)
            spin_box.setSuffix(" MPa")
            spin_box.setDecimals(1)
            spin_box.valueChanged.connect(self.update_material_property)
            self.table.setCellWidget(row, 1, spin_box)

    def setup_ground_info(self):
        """지반정보 입력 폼 설정"""
        self.table.setRowCount(4)
        self.table.setColumnCount(2)
        self.table.setHorizontalHeaderLabels(["항목", "내용"])

        items = [
            ("토피 (mm)", self.ground_info['earthCoverDepth'], 0, 100000, 100, 0, "mm"),
            ("지하수위 (mm)", self.ground_info['groundwaterLevel'], 0, 100000, 100, 0, "mm"),
            ("흙의 내부마찰각 (도)", self.ground_info['frictionAngle'], 0, 90, 1, 0, "°"),
            ("흙의 단위중량 (kN/m³)", self.ground_info['soilUnitWeight'], 0, 100, 0.1, 1, " kN/m³")
        ]

        for row, (label, value, min_val, max_val, step, decimals, suffix) in enumerate(items):
            self.set_table_item(row, 0, label, editable=False)
            spin_box = QDoubleSpinBox()
            spin_box.setRange(min_val, max_val)
            spin_box.setValue(value)
            spin_box.setSingleStep(step)
            spin_box.setDecimals(decimals)
            spin_box.setSuffix(suffix)
            spin_box.valueChanged.connect(self.update_ground_info)
            self.table.setCellWidget(row, 1, spin_box)

    def update_ground_info(self, value):
        """지반정보 값 변경 처리"""
        sender = self.sender()
        keys = ['earthCoverDepth', 'groundwaterLevel', 'frictionAngle', 'soilUnitWeight']
        for row, key in enumerate(keys):
            if sender == self.table.cellWidget(row, 1):
                self.ground_info[key] = value
                break
        self.culvert_data_changed.emit()

    def update_material_property(self, value):
        sender = self.sender()
        if sender == self.table.cellWidget(0, 1):
            self.concrete_strength = value
            print(f"Updated concrete strength: {self.concrete_strength} MPa")
        elif sender == self.table.cellWidget(1, 1):
            self.rebar_yield_strength = value
            print(f"Updated rebar yield strength: {self.rebar_yield_strength} MPa")

    def get_material_properties(self):
        return {
            "concrete_strength": self.concrete_strength,
            "rebar_yield_strength": self.rebar_yield_strength
        }

    def get_section_properties(self):
        return self.section_data

    def get_culvert_section_data(self):
        """단면제원 데이터를 가져옴 (위젯이 삭제된 경우 캐시 반환)"""
        try:
            if not hasattr(self, 'section_table') or not hasattr(self, 'culvert_count_spin'):
                return self._get_cached_data()

            # 위젯이 삭제되었는지 확인
            self.culvert_count_spin.value()
        except RuntimeError:
            return self._get_cached_data()

        culvert_count = self.culvert_count_spin.value()
        middle_wall_count = culvert_count - 1

        data = {
            'culvert_count': culvert_count,
            'H': 0, 'H4': 0,
            'B': [], 'UT': 0, 'LT': 0,
            'WL': 0, 'WR': 0,
            'middle_walls': [],
            'haunch': self.haunch_data,
            'antiFloat': self.anti_float_data
        }

        try:
            data['H'] = float(self.section_table.item(2, 0).text() or 0)
            data['H4'] = float(self.section_table.item(2, 1).text() or 0)

            for i in range(culvert_count):
                col = 2 + i
                data['B'].append(float(self.section_table.item(2, col).text() or 0))

            slab_start_col = 2 + culvert_count
            data['UT'] = float(self.section_table.item(2, slab_start_col).text() or 0)
            data['LT'] = float(self.section_table.item(2, slab_start_col + 1).text() or 0)

            wl_col = slab_start_col + 2
            data['WL'] = float(self.section_table.item(2, wl_col).text() or 0)

            middle_start_col = wl_col + 1
            for i in range(middle_wall_count):
                wall_type_col = middle_start_col + i * 2
                wall_thickness_col = wall_type_col + 1
                combo = self.section_table.cellWidget(2, wall_type_col)
                wall_type = combo.currentText() if combo else "연속벽"
                wall_thickness = float(self.section_table.item(2, wall_thickness_col).text() or 0)
                data['middle_walls'].append({'type': wall_type, 'thickness': wall_thickness})

            wr_col = middle_start_col + middle_wall_count * 2
            data['WR'] = float(self.section_table.item(2, wr_col).text() or 0)

        except (ValueError, AttributeError, RuntimeError) as e:
            print(f"Error getting culvert data: {e}")
            return self._get_cached_data()

        # 캐시 갱신
        self._cached_culvert_data = data
        return data

    def _get_cached_data(self):
        """캐시된 단면 데이터에 최신 헌치/부상방지저판 반영"""
        self._cached_culvert_data['haunch'] = self.haunch_data
        self._cached_culvert_data['antiFloat'] = self.anti_float_data
        return self._cached_culvert_data

    def get_ground_info(self):
        """지반정보 데이터 반환"""
        return self.ground_info