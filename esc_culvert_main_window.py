from PyQt5.QtWidgets import QMainWindow, QWidget, QHBoxLayout, QVBoxLayout, QSplitter
from PyQt5.QtCore import Qt
from esc_culvert_menu_bar import create_menu_bar
from esc_culvert_toolbars import create_toolbars
from esc_culvert_tree_widget import CustomTreeWidget
from esc_culvert_table_widget import ESCCulvertTableWidget
from esc_culvert_graphics_view import create_graphics_view

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("철근량 산정 프로그램")
        self.setGeometry(100, 100, 1200, 800)

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

        # 테이블 위젯 업데이트
        self.table_widget.update_content(full_path)

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