import ezdxf
import math
from PyQt5.QtWidgets import QGraphicsLineItem, QGraphicsEllipseItem, QGraphicsTextItem, QGraphicsPolygonItem,QGraphicsPathItem
from PyQt5.QtGui import QPen, QColor, QFont, QPolygonF,QPainterPath,QFontMetricsF
from PyQt5.QtCore import Qt, QPointF, QRectF

def setup_dimstyle(doc, scale=50):
    """치수 스타일 설정"""
    # EZDXF dimstyle이 없으면 생성
    if 'EZDXF' not in doc.dimstyles:
        dimstyle = doc.dimstyles.new('EZDXF')
    else:
        dimstyle = doc.dimstyles.get('EZDXF')
    dimstyle.dxf.dimscale = scale
    return dimstyle


def create_sample_dxf(parent_item, child_item):
    doc = ezdxf.new('R2010')
    setup_dimstyle(doc, scale=50)
    msp = doc.modelspace()

    if parent_item == "단면입력" and child_item == "단면제원":
        # 박스 크기 정의
        width = 3000  # 박스 폭 (mm)
        height = 2000  # 박스 높이 (mm)

        # 사각형 박스 그리기
        msp.add_lwpolyline(
            [(0, 0), (width, 0), (width, height), (0, height), (0, 0)],
            dxfattribs={'color': 7}  # 흰색
        )

        # 폭 치수선 (하단)
        msp.add_linear_dim(
            base=(width / 2, -500),
            p1=(0, 0),
            p2=(width, 0),
            dimstyle="EZDXF"
        )

        # 높이 치수선 (우측)
        msp.add_linear_dim(
            base=(width + 500, height / 2),
            p1=(width, 0),
            p2=(width, height),
            angle=90,
            dimstyle="EZDXF"
        )

    elif parent_item == "도면" and child_item == "종단선형":
        # msp.add_line((0, 0), (100, 100),dxfattribs={'color': 1})
        msp.add_circle((50, 50), 25,dxfattribs={'color': 6})
        # center = (150, 50)  # 아크의 중심 좌표
        radius = 30  # 아크의 반지름
        # start_angle = 0  # 아크의 시작 각도 (도 단위)
        # end_angle = 135  # 아크의 끝 각도 (도 단위)
        # msp.add_arc(center, radius, start_angle, end_angle, dxfattribs={'color': 4})
        msp.add_arc((200,50), radius, 135, 270, dxfattribs={'color': 3})
        msp.add_arc((200,0), radius, 270, 90, dxfattribs={'color': 3})
        msp.add_arc((0,-50), radius, 45, 15, dxfattribs={'color': 3})
        # msp.add_lwpolyline([(0, 0), (100, 0), (100, 80), (0, 80), (0, 0)],
        #     dxfattribs={'color': 3})
        #text & ciecle 
        msp.add_text(f"{parent_item}", dxfattribs={'insert': (10, 90),
             'height': 0.5,
             'color': 2,
             'rotation': 30
        })
        msp.add_circle((10,90),25,dxfattribs={'color':1})
        msp.add_linear_dim(
            p1=(0, 0), 
            p2=(100, 100), 
            base=(50, 120), 
            dimstyle="EZDXF"
         )
    elif parent_item == "부모 항목 2":
        msp.add_lwpolyline([(0, 0), (100, 0), (100, 80), (0, 80), (0, 0)])
    elif parent_item == "부모 항목 3":
        msp.add_circle((50, 50), 40)
        msp.add_circle((50, 50), 20)
    elif parent_item == "부모 항목 4":
        msp.add_line((0, 50), (100, 50))
        for x in range(20, 100, 20):
            msp.add_circle((x, 50), 5)
    elif parent_item == "부모 항목 5":
        msp.add_lwpolyline([(0, 0), (20, 40), (40, 20), (60, 50), (80, 10), (100, 30)])

    if child_item:
        msp.add_text(f"{parent_item} - {child_item}", dxfattribs={'insert': (0, 0), 
            'height': 0.5,
            'color': 2,
            'rotation': 0
        })
    else:
        msp.add_text(f"{parent_item}", dxfattribs={'insert': (10, 90),
            'height': 0.5,
            'color': 2,
            'rotation': 0
        })

    return doc

def dxf_color_to_qt(color_index):
    if color_index == 0 or color_index == 256:  # BYBLOCK or BYLAYER
        return QColor(Qt.black)
    else:
        try:
            rgb = ezdxf.colors.DXF_DEFAULT_COLORS[color_index]
            if isinstance(rgb, int):
                # RGB 값이 정수로 인코딩된 경우
                r = (rgb >> 16) & 0xFF
                g = (rgb >> 8) & 0xFF
                b = rgb & 0xFF
                return QColor(r, g, b)
            elif isinstance(rgb, (list, tuple)) and len(rgb) == 3:
                # RGB 값이 리스트나 튜플로 제공된 경우
                return QColor(*rgb)
            else:
                # 알 수 없는 형식의 경우 기본 검정색 반환
                return QColor(Qt.black)
        except IndexError:
            # 색상 인덱스가 범위를 벗어난 경우 기본 검정색 반환
            return QColor(Qt.black)

def create_cosmetic_pen(color, width=1):
    """줌과 관계없이 일정한 두께를 유지하는 펜 생성"""
    pen = QPen(color, width)
    pen.setCosmetic(True)
    return pen


def draw_line(scene, entity, color):
    line = QGraphicsLineItem(entity.dxf.start[0], -entity.dxf.start[1],
                            entity.dxf.end[0], -entity.dxf.end[1])
    line.setPen(create_cosmetic_pen(color, 1))
    scene.addItem(line)

def draw_circle(scene, entity, color):
    circle = QGraphicsEllipseItem(entity.dxf.center[0] - entity.dxf.radius,
                                -entity.dxf.center[1] - entity.dxf.radius,
                                entity.dxf.radius * 2, entity.dxf.radius * 2)
    circle.setPen(create_cosmetic_pen(color, 1))
    scene.addItem(circle)

def draw_arc(scene, entity, color):
    center = entity.dxf.center
    radius = entity.dxf.radius
    start_angle = entity.dxf.start_angle
    end_angle = entity.dxf.end_angle
    if end_angle < start_angle:
        span_angle = (end_angle + 360 - start_angle) % 360
    else:                
        span_angle = (end_angle - start_angle) % 360

    path = QPainterPath()
    startpnt = [center[0] + radius * math.cos(math.radians(start_angle)),
                -center[1] - radius * math.sin(math.radians(start_angle))]
    path.moveTo(startpnt[0], startpnt[1])
    path.arcTo(center[0] - radius, -center[1] - radius, 2 * radius, 2 * radius,
               start_angle, span_angle)

    arc = QGraphicsPathItem(path)
    arc.setPen(create_cosmetic_pen(color, 1))
    scene.addItem(arc)

def draw_text(scene, entity, color):
    text_item = QGraphicsTextItem(entity.dxf.text)
    text_item.setDefaultTextColor(color)
    original_x = entity.dxf.insert[0]
    original_y = entity.dxf.insert[1]
    text_item.setFont(QFont("Arial", int(entity.dxf.height)))
    bounding_rect = text_item.boundingRect()
    text_item.setPos(entity.dxf.insert[0], -entity.dxf.insert[1])
    text_item.setRotation(-entity.dxf.rotation)
    rotation_ang = entity.dxf.rotation
    
    new_x,new_y = polar((original_x,original_y),math.radians(rotation_ang+90.0),bounding_rect.height())
    text_item.setPos(new_x, -new_y)
    scene.addItem(text_item)
    #for check insertpoint
    print(rotation_ang)
    circle = QGraphicsEllipseItem(entity.dxf.insert[0] - 2,
                                -entity.dxf.insert[1] - 2,
                                4, 4)
    circle.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(circle)

    circle = QGraphicsEllipseItem(new_x - 2,
                                -new_y - 2,
                                4, 4)
    circle.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(circle)

def draw_text_with_data(scene,ix,iy,height,ang,text,color):
    #text_item = QGraphicsTextItem(text)
    text_item = QGraphicsTextItem("testtext")
    text_item.setDefaultTextColor(QColor(Qt.white))
    #text_item.setFont(QFont("Arial", int(height)))
    font = QFont()
    font.setPixelSize(20)
    text_item.setFont(font)
    font_metrics = QFontMetricsF(font)
    bounding_rect = text_item.boundingRect()
    tight_rect = font_metrics.tightBoundingRect(text_item.toPlainText())
    #text_item.setFont(QFont("Arial", int(height)))
    
    new_x,new_y = polar((ix,iy),math.radians(ang+90.0),bounding_rect.height())
    #text_item.setPos(new_x, -new_y)
    text_item.setPos(ix, -(iy+tight_rect.top()))
    scene.addItem(text_item)
    circle = QGraphicsEllipseItem(ix - 2, -iy - 2, 4, 4)
    circle.setPen(create_cosmetic_pen(Qt.green, 1))
    scene.addItem(circle)
    print("height:",height,"tight_rect.top():",tight_rect.top(),"tight_rect.top()",tight_rect.height())
    print("tight_rect.bottom():",tight_rect.bottom(),"bounding_rect.width():",bounding_rect.width())
    # text_item.setRotation(-ang)
    # scene.addItem(text_item)
    # print("height:",height,"bounding_rect.height():",bounding_rect.height())
    # #테스트용 좌표확인 
    # circle = QGraphicsEllipseItem(ix - 2, -iy - 2, 4, 4)
    # circle.setPen(QPen(Qt.green, 3))
    # scene.addItem(circle)

    #text_item = QGraphicsTextItem("Sample Text")
    #font = QFont()
    #font.setPixelSize(20)
    #text_item.setFont(font)

    # 정확한 바운딩 박스 계산
    #font_metrics = QFontMetricsF(font)
    #tight_rect = font_metrics.tightBoundingRect(text_item.toPlainText())

    # 위치 조정
    #text_item.setPos(0, -tight_rect.top())

def draw_lwpolyline(scene, entity, color):
    points = entity.get_points()
    polygon = QPolygonF()
    for point in points:
        polygon.append(QPointF(point[0], -point[1]))
    polyline_item = QGraphicsPolygonItem(polygon)
    polyline_item.setPen(create_cosmetic_pen(color, 1))
    scene.addItem(polyline_item)


def draw_dimension(scene, entity, doc):
    dim_text = entity.dxf.text if entity.dxf.text != "<>" else f"{int(calculate_distance(entity.dxf.defpoint2, entity.dxf.defpoint3))}"
    dim_style = entity.dxf.dimstyle
    dim_style_table = doc.dimstyles.get(dim_style)
    dimscale = dim_style_table.dxf.dimscale
    dxf_text_size = dim_style_table.dxf.dimtxt * dimscale

    start_point = entity.dxf.defpoint2
    end_point = entity.dxf.defpoint3
    def_point = entity.dxf.defpoint

    angle = math.atan2(end_point[1] - start_point[1], end_point[0] - start_point[0])
    angle90 = angle + math.pi/2

    dimlinepoint1 = find_intersection(start_point, angle90, def_point, angle)
    dimlinepoint2 = find_intersection(end_point, angle90, def_point, angle)
    
    # Extension lines
    ext_line1 = QGraphicsLineItem(start_point[0], -start_point[1],
                                dimlinepoint1[0], -dimlinepoint1[1])
    ext_line1.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(ext_line1)

    ext_line2 = QGraphicsLineItem(end_point[0], -end_point[1],
                                dimlinepoint2[0], -dimlinepoint2[1])
    ext_line2.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(ext_line2)

    # Dimension line
    dim_line = QGraphicsLineItem(dimlinepoint1[0], -dimlinepoint1[1],
                                dimlinepoint2[0], -dimlinepoint2[1])
    dim_line.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(dim_line)
    
    # Dimension text
    text_insert_point = find_midpoint(dimlinepoint1, dimlinepoint2)
    dim_item = QGraphicsTextItem(dim_text)
    dim_item.setDefaultTextColor(QColor(Qt.white))
    dim_item.setFont(QFont("Arial", int(dxf_text_size)))
    bounding_rect = dim_item.boundingRect()
    text_insert_point = polar(text_insert_point, angle + math.pi, bounding_rect.width() / 2)
    text_insert_point = polar(text_insert_point,
                            calculate_angle(start_point, dimlinepoint1),
                            bounding_rect.height() / 2)  

    dim_item.setPos(text_insert_point[0], -text_insert_point[1])
    dim_item.setRotation(-math.degrees(angle))
    scene.addItem(dim_item)
    #for check insertpoint
    circle = QGraphicsEllipseItem(text_insert_point[0] - 2,
                                -text_insert_point[1] - 2,
                                4, 4)
    circle.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(circle)

    draw_text_with_data(scene,text_insert_point[0],text_insert_point[1],
                        height=2.5, ang=math.degrees(angle),text="TEXT",color=2)




def display_dxf(doc, scene):
    scene.clear()
    msp = doc.modelspace()

    for entity in msp:
        color = dxf_color_to_qt(entity.dxf.color)
        if entity.dxftype() == 'LINE':
            draw_line(scene, entity, color)
        elif entity.dxftype() == 'CIRCLE':
            draw_circle(scene, entity, color)
        elif entity.dxftype() == 'ARC':
            draw_arc(scene, entity, color)
        elif entity.dxftype() == 'TEXT':
            draw_text(scene, entity, color)
        elif entity.dxftype() == 'LWPOLYLINE':
            draw_lwpolyline(scene, entity, color)
        elif entity.dxftype() == 'DIMENSION':
            draw_dimension(scene,entity,doc)

def find_intersection(p1, angle1, p2, angle2):
    x1, y1,_ = p1
    x2, y2,_ = p2
    dx1 = math.cos(angle1)
    dy1 = math.sin(angle1)
    dx2 = math.cos(angle2)
    dy2 = math.sin(angle2)
    
    det = dx1 * dy2 - dy1 * dx2
    if abs(det) < 1e-6:
        return None  # Lines are parallel
    
    t1 = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / det
    
    ix = x1 + t1 * dx1
    iy = y1 + t1 * dy1
    
    return (ix, iy)

def find_midpoint(p1, p2):
    return ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)

def polar(point, angle, distance):
    return (point[0] + distance * math.cos(angle),
            point[1] + distance * math.sin(angle))

def calculate_angle(p1, p2):
    return math.atan2(p2[1] - p1[1], p2[0] - p1[0])

def calculate_distance(p1, p2):
    return math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)


def create_culvert_dxf(culvert_data):
    """
    입력된 제원으로 암거 단면 DXF 생성

    culvert_data: {
        'culvert_count': 암거련수,
        'H': 내공 높이,
        'H4': H4,
        'B': [B1, B2, ...] 각 련의 폭,
        'UT': 상부 슬래브 두께,
        'LT': 하부 슬래브 두께,
        'WL': 좌측벽 두께,
        'WR': 우측벽 두께,
        'middle_walls': [{'type': '연속벽'/'기둥', 'thickness': 두께}, ...]
    }
    """
    doc = ezdxf.new('R2010')
    setup_dimstyle(doc, scale=50)
    msp = doc.modelspace()

    if not culvert_data:
        return doc

    H = culvert_data['H']
    H4 = culvert_data['H4']
    B_list = culvert_data['B']
    UT = culvert_data['UT']
    LT = culvert_data['LT']
    WL = culvert_data['WL']
    WR = culvert_data['WR']
    middle_walls = culvert_data['middle_walls']
    culvert_count = culvert_data['culvert_count']

    # 전체 폭 계산
    total_inner_width = sum(B_list)
    total_middle_wall_thickness = sum(w['thickness'] for w in middle_walls)
    total_width = WL + total_inner_width + total_middle_wall_thickness + WR

    # 전체 높이 계산
    total_height = LT + H + UT

    # 외곽선 그리기 (흰색)
    outer_points = [
        (0, 0),
        (total_width, 0),
        (total_width, total_height),
        (0, total_height),
        (0, 0)
    ]
    msp.add_lwpolyline(outer_points, dxfattribs={'color': 7})

    # 내공 그리기 (각 련별로)
    x_offset = WL
    for i in range(culvert_count):
        B = B_list[i]

        # 내공 사각형
        inner_points = [
            (x_offset, LT),
            (x_offset + B, LT),
            (x_offset + B, LT + H),
            (x_offset, LT + H),
            (x_offset, LT)
        ]
        msp.add_lwpolyline(inner_points, dxfattribs={'color': 3})  # 청록색

        # 다음 련으로 이동 (중간벽 두께 추가)
        x_offset += B
        if i < len(middle_walls):
            x_offset += middle_walls[i]['thickness']

    # 치수선 추가
    dim_offset = 500  # 치수선 오프셋

    # 전체 폭 치수선 (하단)
    msp.add_linear_dim(
        base=(total_width / 2, -dim_offset),
        p1=(0, 0),
        p2=(total_width, 0),
        dimstyle="EZDXF"
    )

    # 전체 높이 치수선 (우측)
    msp.add_linear_dim(
        base=(total_width + dim_offset, total_height / 2),
        p1=(total_width, 0),
        p2=(total_width, total_height),
        angle=90,
        dimstyle="EZDXF"
    )

    # 내공 높이 치수선 (좌측)
    msp.add_linear_dim(
        base=(-dim_offset, LT + H / 2),
        p1=(0, LT),
        p2=(0, LT + H),
        angle=90,
        dimstyle="EZDXF"
    )

    # 각 내공 폭 치수선 (상단)
    x_offset = WL
    for i in range(culvert_count):
        B = B_list[i]
        msp.add_linear_dim(
            base=(x_offset + B / 2, total_height + dim_offset),
            p1=(x_offset, total_height),
            p2=(x_offset + B, total_height),
            dimstyle="EZDXF"
        )
        x_offset += B
        if i < len(middle_walls):
            x_offset += middle_walls[i]['thickness']

    # 슬래브 두께 치수선
    # 상부 슬래브 (UT)
    msp.add_linear_dim(
        base=(-dim_offset * 1.5, LT + H + UT / 2),
        p1=(0, LT + H),
        p2=(0, total_height),
        angle=90,
        dimstyle="EZDXF"
    )

    # 하부 슬래브 (LT)
    msp.add_linear_dim(
        base=(-dim_offset * 1.5, LT / 2),
        p1=(0, 0),
        p2=(0, LT),
        angle=90,
        dimstyle="EZDXF"
    )

    # 좌측벽 두께 치수선
    msp.add_linear_dim(
        base=(WL / 2, -dim_offset * 1.5),
        p1=(0, 0),
        p2=(WL, 0),
        dimstyle="EZDXF"
    )

    # 우측벽 두께 치수선
    msp.add_linear_dim(
        base=(total_width - WR / 2, -dim_offset * 1.5),
        p1=(total_width - WR, 0),
        p2=(total_width, 0),
        dimstyle="EZDXF"
    )

    return doc