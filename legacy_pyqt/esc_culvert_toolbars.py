from PyQt5.QtWidgets import QToolBar, QAction
from PyQt5.QtGui import QIcon
import os

def create_toolbars(window):
    icon_path = r"D:\Python\Icon"  # 아이콘 파일 경로

    basic_toolbar = QToolBar("기본 설정")
    window.addToolBar(basic_toolbar)
    basic_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-new-file-50.png')), '프로젝트 정보', window))
    basic_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-open-50.png')), '열기', window))
    basic_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-save-50.png')), '저장', window))

    section_toolbar = QToolBar("단면 입력")
    window.addToolBar(section_toolbar)
    section_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-calculate-50.png')), '단면 추가', window))
    section_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-edit-50.png')), '단면 편집', window))

    detail_toolbar = QToolBar("상세 입력")
    window.addToolBar(detail_toolbar)
    detail_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-detail-50.png')), '상세 정보', window))
    detail_toolbar.addAction(QAction(QIcon(os.path.join(icon_path, 'icons8-calculate-50.png')), '계산', window))

    return basic_toolbar, section_toolbar, detail_toolbar