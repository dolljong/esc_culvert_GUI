from PyQt5.QtWidgets import QMenuBar, QAction
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QKeySequence

def create_menu_bar(window):
    menubar = window.menuBar()

    # 파일 메뉴
    file_io_menu = menubar.addMenu('파일')

    save_action = QAction('저장하기', window)
    save_action.setShortcut(QKeySequence.Save)
    save_action.triggered.connect(window.save_project)
    file_io_menu.addAction(save_action)

    load_action = QAction('불러오기', window)
    load_action.setShortcut(QKeySequence.Open)
    load_action.triggered.connect(window.load_project)
    file_io_menu.addAction(load_action)

    file_io_menu.addSeparator()

    export_dxf_action = QAction('DXF 파일로 내보내기', window)
    export_dxf_action.triggered.connect(window.export_dxf)
    file_io_menu.addAction(export_dxf_action)

    # 기존 메뉴들
    file_menu = menubar.addMenu('기본 설정')
    edit_menu = menubar.addMenu('단면 입력')
    detail_menu = menubar.addMenu('상세입력')

    # 보기 메뉴 추가
    view_menu = menubar.addMenu('보기')

    # 트리메뉴 보기 액션 생성
    show_tree_action = QAction('트리메뉴 보기', window)
    show_tree_action.setCheckable(True)
    show_tree_action.setChecked(True)
    show_tree_action.triggered.connect(window.toggle_tree_widget)

    # 보기 메뉴에 트리메뉴 보기 액션 추가
    view_menu.addAction(show_tree_action)

    return menubar, file_menu, edit_menu, detail_menu, view_menu, show_tree_action
