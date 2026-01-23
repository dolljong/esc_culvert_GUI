from PyQt5.QtWidgets import QGraphicsView, QGraphicsScene
from PyQt5.QtGui import QPainter, QPalette
from PyQt5.QtCore import Qt, QRectF


class ZoomPanGraphicsView(QGraphicsView):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorUnderMouse)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        self._scene = QGraphicsScene(self)
        self.setScene(self._scene)

        # 배경색을 검은색으로 설정
        palette = self.palette()
        palette.setColor(QPalette.Base, Qt.black)
        self.setPalette(palette)
        self._scene.setBackgroundBrush(Qt.black)

    def wheelEvent(self, event):
        zoom_factor = 1.15
        if event.angleDelta().y() > 0:
            self.scale(zoom_factor, zoom_factor)
        else:
            self.scale(1 / zoom_factor, 1 / zoom_factor)

    def fit_to_scene(self):
        """씬 내용에 맞게 뷰를 조정하고 패닝 영역 확장"""
        items_rect = self._scene.itemsBoundingRect()

        # 아이템 영역을 기준으로 패닝 가능 영역 확장 (3배)
        margin = max(items_rect.width(), items_rect.height()) * 1.5
        expanded_rect = QRectF(
            items_rect.x() - margin,
            items_rect.y() - margin,
            items_rect.width() + margin * 2,
            items_rect.height() + margin * 2
        )
        self._scene.setSceneRect(expanded_rect)

        # 뷰를 아이템에 맞게 조정
        self.fitInView(items_rect, Qt.KeepAspectRatio)


def create_graphics_view():
    view = ZoomPanGraphicsView()
    return view
