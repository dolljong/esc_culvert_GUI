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

        # 내부힌지 탭
        hinge_tab = QWidget()
        self.section_tab_widget.addTab(hinge_tab, "내부힌지")

        # 부상방지저판 탭
        float_tab = QWidget()
        self.section_tab_widget.addTab(float_tab, "부상방지저판")

        section_layout.addWidget(self.section_tab_widget)

        # 레이아웃에 추가
        self.layout().addWidget(self.section_widget)

    def on_culvert_count_changed(self, value):
        """암거련수 변경 시 테이블 재생성"""
        # 기존 단면제원 탭 제거 및 재생성
        self.section_tab_widget.removeTab(0)
        self.section_tab = self.create_section_tab(value)
        self.section_tab_widget.insertTab(0, self.section_tab, "단면제원")
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
        """단면제원 테이블에서 암거 제원 데이터를 가져옴"""
        if not hasattr(self, 'section_table') or not hasattr(self, 'culvert_count_spin'):
            return None

        culvert_count = self.culvert_count_spin.value()
        middle_wall_count = culvert_count - 1

        data = {
            'culvert_count': culvert_count,
            'H': 0,      # 높이
            'H4': 0,     # H4
            'B': [],     # 폭 리스트
            'UT': 0,     # 상부 슬래브 두께
            'LT': 0,     # 하부 슬래브 두께
            'WL': 0,     # 좌측벽 두께
            'WR': 0,     # 우측벽 두께
            'middle_walls': []  # 중간벽 리스트 [{'type': '연속벽', 'thickness': 600}, ...]
        }

        try:
            # 높이 H, H4
            data['H'] = float(self.section_table.item(2, 0).text() or 0)
            data['H4'] = float(self.section_table.item(2, 1).text() or 0)

            # 폭 B1, B2, ...
            for i in range(culvert_count):
                col = 2 + i
                data['B'].append(float(self.section_table.item(2, col).text() or 0))

            # 슬래브 두께
            slab_start_col = 2 + culvert_count
            data['UT'] = float(self.section_table.item(2, slab_start_col).text() or 0)
            data['LT'] = float(self.section_table.item(2, slab_start_col + 1).text() or 0)

            # 좌측벽
            wl_col = slab_start_col + 2
            data['WL'] = float(self.section_table.item(2, wl_col).text() or 0)

            # 중간벽
            middle_start_col = wl_col + 1
            for i in range(middle_wall_count):
                wall_type_col = middle_start_col + i * 2
                wall_thickness_col = wall_type_col + 1

                combo = self.section_table.cellWidget(2, wall_type_col)
                wall_type = combo.currentText() if combo else "연속벽"
                wall_thickness = float(self.section_table.item(2, wall_thickness_col).text() or 0)

                data['middle_walls'].append({
                    'type': wall_type,
                    'thickness': wall_thickness
                })

            # 우측벽
            wr_col = middle_start_col + middle_wall_count * 2
            data['WR'] = float(self.section_table.item(2, wr_col).text() or 0)

        except (ValueError, AttributeError) as e:
            print(f"Error getting culvert data: {e}")
            return None

        return data