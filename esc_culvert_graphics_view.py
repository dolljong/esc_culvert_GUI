from PyQt5.QtWidgets import QGraphicsView, QGraphicsScene
from PyQt5.QtGui import QPainter
from PyQt5.QtCore import Qt

def create_graphics_view():
    view = QGraphicsView()
    scene = QGraphicsScene()
    view.setScene(scene)
    view.setRenderHint(QPainter.Antialiasing)
    view.setViewportUpdateMode(QGraphicsView.FullViewportUpdate)
    view.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
    view.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

    # 배경색 설정 (선택사항)
    view.setBackgroundBrush(Qt.white)

    return view