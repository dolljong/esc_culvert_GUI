from PyQt5.QtWidgets import QTreeWidget, QTreeWidgetItem, QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QScrollArea
from PyQt5.QtGui import QIcon
from PyQt5.QtCore import Qt, pyqtSignal

class ESCCulvertTreeWidget(QTreeWidget):
    def __init__(self):
        super().__init__()
        self.setHeaderHidden(True)  # 기본 헤더를 숨깁니다
        self.create_tree_items()

    def create_tree_items(self):
        items = ['프로젝트 정보', '설계조건', '단면입력', '하중입력', '배근 입력', '출력']

        for item_text in items:
            item = QTreeWidgetItem(self)
            item.setText(0, item_text)
            
            if item_text == '설계조건':
                subitems = ['기본환경', '재료특성', '기타환경']
            elif item_text == '단면입력':
                subitems = ['단면제원', '분점 정의', '하중 정의']
            elif item_text == '배근입력':
                subitems = ['휨철근', '전단철근']
            else:
                subitems = []

            for subitem_text in subitems:
                subitem = QTreeWidgetItem(item)
                subitem.setText(0, subitem_text)

        self.expandAll()

class CustomTreeWidget(QWidget):
    closed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.initUI()

    def initUI(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        # 헤더 생성
        header_widget = QWidget()
        header_layout = QHBoxLayout(header_widget)
        header_layout.setContentsMargins(5, 5, 5, 5)

        label = QLabel("프로젝트 구조")
        label.setStyleSheet("font-weight: bold;")
        header_layout.addWidget(label)

        close_button = QPushButton()
        close_button.setIcon(QIcon("D:\Python\Icon/icons8-close-24.png"))  # 닫기 아이콘 경로를 지정해주세요
        close_button.setFixedSize(24, 24)  # 버튼 크기를 아이콘 크기에 맞게 조정
        close_button.setStyleSheet("""
            QPushButton {
                border: 1px solid #cccccc;
                border-radius: 3px;
                padding: 2px;
            }
            QPushButton:hover {
                background-color: #f0f0f0;
            }
        """)
        close_button.clicked.connect(self.close_widget)
        header_layout.addWidget(close_button, alignment=Qt.AlignRight)

        layout.addWidget(header_widget)

        # 구분선 추가
        line = QWidget()
        line.setFixedHeight(1)
        line.setStyleSheet("background-color: #cccccc;")
        layout.addWidget(line)

        # 트리 위젯을 스크롤 영역에 추가
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)

        self.tree_widget = ESCCulvertTreeWidget()
        scroll_area.setWidget(self.tree_widget)

        layout.addWidget(scroll_area)

    def close_widget(self):
        self.closed.emit()
        self.hide()