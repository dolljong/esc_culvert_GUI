from PyQt5.QtWidgets import QTableWidget, QTableWidgetItem, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QScrollArea, QHeaderView, QComboBox, QDoubleSpinBox, QPushButton, QCheckBox
from PyQt5.QtCore import Qt, QEvent
from PyQt5.QtGui import QColor, QFont, QKeyEvent

class ESCCulvertTableWidget(QWidget):
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
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(["선택", "구분", "높이(m)", "폭(m)"])
        self.table.setRowCount(0)
        
        if not self.section_data:
            self.add_section_row()
        else:
            for section in self.section_data:
                self.add_section_row(section)

        add_button = QPushButton("행 추가")
        add_button.clicked.connect(self.add_section_row)
        delete_button = QPushButton("선택 삭제")
        delete_button.clicked.connect(self.delete_selected_rows)

        self.button_layout.addWidget(add_button)
        self.button_layout.addWidget(delete_button)

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