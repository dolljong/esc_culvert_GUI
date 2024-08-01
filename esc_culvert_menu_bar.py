from PyQt5.QtWidgets import QMenuBar, QAction
from PyQt5.QtCore import Qt

def create_menu_bar(window):
    menubar = window.menuBar()
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

    file_menu.triggered.connect(lambda: window.change_toolbar('기본 설정'))
    edit_menu.triggered.connect(lambda: window.change_toolbar('단면 입력'))
    view_menu.triggered.connect(lambda: window.change_toolbar('상세입력'))

    return menubar, file_menu, edit_menu, detail_menu, view_menu, show_tree_action