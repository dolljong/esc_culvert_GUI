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
    dimstyle.dxf.dimexo = 10
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
    linetype = entity.dxf.get('linetype', '')
    if linetype == 'DASHED':
        pen = QPen(color, 1)
        pen.setCosmetic(True)
        pen.setStyle(Qt.DashLine)
        line.setPen(pen)
    else:
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

    # dimexo: 원점에서 보조선 시작점까지 오프셋
    dimexo = dim_style_table.dxf.dimexo * dimscale
    ext_dir1 = calculate_angle(start_point, dimlinepoint1)
    ext_dir2 = calculate_angle(end_point, dimlinepoint2)
    ext_start1 = polar(start_point, ext_dir1, dimexo)
    ext_start2 = polar(end_point, ext_dir2, dimexo)

    # Extension lines (원점에서 dimexo만큼 떨어진 곳부터 시작)
    ext_line1 = QGraphicsLineItem(ext_start1[0], -ext_start1[1],
                                dimlinepoint1[0], -dimlinepoint1[1])
    ext_line1.setPen(create_cosmetic_pen(Qt.red, 1))
    scene.addItem(ext_line1)

    ext_line2 = QGraphicsLineItem(ext_start2[0], -ext_start2[1],
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
                            angle + math.pi / 2,
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


def get_compartment_haunches(haunch_data, culvert_count, i):
    """칸별 헌치 데이터 가져오기"""
    if not haunch_data:
        zero = {'width': 0, 'height': 0}
        return {'ul': zero, 'll': zero, 'ur': zero, 'lr': zero}

    lw = haunch_data.get('leftWall', {})
    rw = haunch_data.get('rightWall', {})
    mw = haunch_data.get('middleWalls', [])
    last = culvert_count - 1
    zero = {'width': 0, 'height': 0}

    left_wall = lw if i == 0 else (mw[i - 1] if i - 1 < len(mw) else {})
    right_wall = rw if i == last else (mw[i] if i < len(mw) else {})

    return {
        'ul': left_wall.get('upper', zero),
        'll': left_wall.get('lower', zero),
        'ur': right_wall.get('upper', zero),
        'lr': right_wall.get('lower', zero)
    }


def create_culvert_dxf(culvert_data, ground_info=None):
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
        'middle_walls': [{'type': '연속벽'/'기둥', 'thickness': 두께}, ...],
        'haunch': 헌치 데이터,
        'antiFloat': 부상방지저판 데이터
    }
    ground_info: {
        'earthCoverDepth': 토피,
        'groundwaterLevel': 지하수위,
        'frictionAngle': 내부마찰각,
        'soilUnitWeight': 단위중량
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
    haunch_data = culvert_data.get('haunch', None)
    anti_float = culvert_data.get('antiFloat', None)

    if ground_info is None:
        ground_info = {}

    # 전체 폭 계산
    total_inner_width = sum(B_list)
    total_middle_wall_thickness = sum(w['thickness'] for w in middle_walls)
    total_width = WL + total_inner_width + total_middle_wall_thickness + WR

    # 전체 높이 계산
    total_height = LT + H + UT

    # 부상방지저판 데이터
    af_use = anti_float and anti_float.get('use', False)
    af_t = anti_float.get('thickness', 0) if af_use else 0
    af_left_ext = anti_float.get('leftExtension', 0) if af_use else 0
    af_right_ext = anti_float.get('rightExtension', 0) if af_use else 0

    # 외곽선 그리기 (흰색)
    if af_use and (af_left_ext > 0 or af_right_ext > 0):
        # 부상방지저판이 있는 경우: 좌우 벽체 수직선은 LT(저판 상단)에서 끝남
        msp.add_lwpolyline([
            (0, LT), (0, total_height),
            (total_width, total_height), (total_width, LT)
        ], dxfattribs={'color': 7})
        # 하부 바닥선
        msp.add_line((0, 0), (total_width, 0), dxfattribs={'color': 7})
    else:
        outer_points = [
            (0, 0), (total_width, 0),
            (total_width, total_height),
            (0, total_height), (0, 0)
        ]
        msp.add_lwpolyline(outer_points, dxfattribs={'color': 7})

    # 내공 그리기 (각 련별로 - 헌치 고려)
    x_offset = WL
    for i in range(culvert_count):
        B = B_list[i]
        left = x_offset
        right = x_offset + B
        bottom = LT
        top = LT + H
        h = get_compartment_haunches(haunch_data, culvert_count, i)
        ul, ur, ll, lr = h['ul'], h['ur'], h['ll'], h['lr']

        # 내공 사각형 (헌치를 고려하여 각 변 그리기)
        msp.add_line((left + ll.get('width', 0), bottom), (right - lr.get('width', 0), bottom), dxfattribs={'color': 3})
        msp.add_line((right, bottom + lr.get('height', 0)), (right, top - ur.get('height', 0)), dxfattribs={'color': 3})
        msp.add_line((right - ur.get('width', 0), top), (left + ul.get('width', 0), top), dxfattribs={'color': 3})
        msp.add_line((left, top - ul.get('height', 0)), (left, bottom + ll.get('height', 0)), dxfattribs={'color': 3})

        x_offset += B
        if i < len(middle_walls):
            x_offset += middle_walls[i]['thickness']

    # 헌치 대각선 그리기
    x_offset = WL
    for i in range(culvert_count):
        B = B_list[i]
        left = x_offset
        right = x_offset + B
        bottom = LT
        top = LT + H
        h = get_compartment_haunches(haunch_data, culvert_count, i)
        ul, ur, ll, lr = h['ul'], h['ur'], h['ll'], h['lr']

        if ul.get('width', 0) > 0 and ul.get('height', 0) > 0:
            msp.add_line((left, top - ul['height']), (left + ul['width'], top), dxfattribs={'color': 3})
        if ur.get('width', 0) > 0 and ur.get('height', 0) > 0:
            msp.add_line((right - ur['width'], top), (right, top - ur['height']), dxfattribs={'color': 3})
        if ll.get('width', 0) > 0 and ll.get('height', 0) > 0:
            msp.add_line((left, bottom + ll['height']), (left + ll['width'], bottom), dxfattribs={'color': 3})
        if lr.get('width', 0) > 0 and lr.get('height', 0) > 0:
            msp.add_line((right - lr['width'], bottom), (right, bottom + lr['height']), dxfattribs={'color': 3})

        x_offset += B
        if i < len(middle_walls):
            x_offset += middle_walls[i]['thickness']

    # 기둥 종거더 그리기 (점선 + X표시)
    column_girder = culvert_data.get('columnGirder', None)
    if column_girder and len(middle_walls) > 0:
        upper_add = column_girder.get('upperAdditionalHeight', 0)
        lower_add = column_girder.get('lowerAdditionalHeight', 0)
        if upper_add > 0 or lower_add > 0:
            # DASHED 라인타입 등록
            if 'DASHED' not in doc.linetypes:
                doc.linetypes.add('DASHED', pattern=[0.5, 0.25, -0.25])
            bottom = LT
            top_y = LT + H
            x_off = WL
            for i in range(culvert_count):
                x_off += B_list[i]
                if i < len(middle_walls):
                    wall = middle_walls[i]
                    if wall['type'] == '기둥':
                        w_left = x_off
                        w_right = x_off + wall['thickness']
                        mw_haunch = haunch_data.get('middleWalls', []) if haunch_data else []
                        mw_h = mw_haunch[i] if i < len(mw_haunch) else {}
                        upper_h = mw_h.get('upper', {}).get('height', 0)
                        lower_h = mw_h.get('lower', {}).get('height', 0)

                        # 상부 거더 (헌치끝에서 아래로)
                        if upper_add > 0:
                            y_start = top_y - upper_h
                            y_end = y_start - upper_add
                            msp.add_line((w_left, y_start), (w_left, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})
                            msp.add_line((w_right, y_start), (w_right, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})
                            msp.add_line((w_left, y_end), (w_right, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})

                        # 하부 거더 (헌치끝에서 위로)
                        if lower_add > 0:
                            y_start = bottom + lower_h
                            y_end = y_start + lower_add
                            msp.add_line((w_left, y_start), (w_left, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})
                            msp.add_line((w_right, y_start), (w_right, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})
                            msp.add_line((w_left, y_end), (w_right, y_end), dxfattribs={'color': 3, 'linetype': 'DASHED'})

                        # X 표시 (상부 거더 하단 ~ 하부 거더 상단)
                        x_top = (top_y - upper_h - upper_add) if upper_add > 0 else (top_y - upper_h)
                        x_bottom = (bottom + lower_h + lower_add) if lower_add > 0 else (bottom + lower_h)
                        if x_top > x_bottom:
                            msp.add_line((w_left, x_top), (w_right, x_bottom), dxfattribs={'color': 3})
                            msp.add_line((w_right, x_top), (w_left, x_bottom), dxfattribs={'color': 3})

                    x_off += wall['thickness']

    # 기둥 리더선 그리기 (CTC, W 표시)
    if column_girder and len(middle_walls) > 0:
        mid_y = LT + H / 2
        leader_len = 800
        text_height = 150
        line_gap = text_height * 1.5
        x_off = WL
        for i in range(culvert_count):
            x_off += B_list[i]
            if i < len(middle_walls):
                wall = middle_walls[i]
                if wall['type'] == '기둥':
                    w_surface = x_off + wall['thickness']
                    leader_end = w_surface + leader_len

                    # 리더선
                    msp.add_line((w_surface, mid_y), (leader_end, mid_y), dxfattribs={'color': 7})
                    # 꺾임 tick
                    msp.add_line((leader_end, mid_y), (leader_end, mid_y + text_height * 0.3),
                                 dxfattribs={'color': 7})

                    # CTC 텍스트
                    msp.add_text(
                        f"CTC={int(column_girder.get('columnCTC', 0))}",
                        dxfattribs={
                            'insert': (leader_end + 50, mid_y + line_gap * 0.1),
                            'height': text_height,
                            'color': 7
                        }
                    )
                    # W 텍스트
                    msp.add_text(
                        f"W={int(column_girder.get('columnWidth', 0))}",
                        dxfattribs={
                            'insert': (leader_end + 50, mid_y - line_gap * 0.9),
                            'height': text_height,
                            'color': 7
                        }
                    )

                x_off += wall['thickness']

    # 부상방지저판 그리기 (암거 저판과 같은 레벨에서 벽체 바깥으로 연장)
    if af_use:
        if af_left_ext > 0:
            msp.add_lwpolyline([
                (0, LT), (-af_left_ext, LT),
                (-af_left_ext, 0), (0, 0)
            ], dxfattribs={'color': 7})
        if af_right_ext > 0:
            msp.add_lwpolyline([
                (total_width, LT), (total_width + af_right_ext, LT),
                (total_width + af_right_ext, 0), (total_width, 0)
            ], dxfattribs={'color': 7})

    # 지반선 그리기
    earth_cover = ground_info.get('earthCoverDepth', 0)
    if earth_cover > 0:
        ground_y = total_height + earth_cover
        line_left = (-af_left_ext if af_use else 0) - 500
        line_right = (total_width + af_right_ext if af_use else total_width) + 500

        # 지반선 (녹색)
        msp.add_line((line_left, ground_y), (line_right, ground_y), dxfattribs={'color': 3})

        # 해치 마크
        hatch_spacing = 400
        hatch_size = 200
        x = line_left + hatch_spacing / 2
        while x <= line_right:
            msp.add_line((x, ground_y), (x - hatch_size, ground_y - hatch_size), dxfattribs={'color': 3})
            x += hatch_spacing

    # 지하수위 표시 (수평선 + 역삼각형, 좌우 벽체 바깥쪽)
    water_level = ground_info.get('groundwaterLevel', 0)
    if water_level > 0 and earth_cover > 0:
        ground_y = total_height + earth_cover
        water_y = ground_y - water_level
        tri_base = 400
        tri_h = 350
        line_len = 800

        # 우측 벽체 바깥쪽
        r_x0 = total_width
        # 수평선
        msp.add_line((r_x0, water_y), (r_x0 + line_len, water_y), dxfattribs={'color': 4})
        # 역삼각형 (수평선 위: 밑변이 위, 꼭짓점이 수평선에 닿음)
        r_cx = r_x0 + line_len / 2
        msp.add_line((r_cx - tri_base / 2, water_y + tri_h), (r_cx + tri_base / 2, water_y + tri_h), dxfattribs={'color': 4})
        msp.add_line((r_cx - tri_base / 2, water_y + tri_h), (r_cx, water_y), dxfattribs={'color': 4})
        msp.add_line((r_cx + tri_base / 2, water_y + tri_h), (r_cx, water_y), dxfattribs={'color': 4})

        # 좌측 벽체 바깥쪽
        l_x0 = 0
        # 수평선
        msp.add_line((l_x0, water_y), (l_x0 - line_len, water_y), dxfattribs={'color': 4})
        # 역삼각형 (수평선 위: 밑변이 위, 꼭짓점이 수평선에 닿음)
        l_cx = l_x0 - line_len / 2
        msp.add_line((l_cx - tri_base / 2, water_y + tri_h), (l_cx + tri_base / 2, water_y + tri_h), dxfattribs={'color': 4})
        msp.add_line((l_cx - tri_base / 2, water_y + tri_h), (l_cx, water_y), dxfattribs={'color': 4})
        msp.add_line((l_cx + tri_base / 2, water_y + tri_h), (l_cx, water_y), dxfattribs={'color': 4})

    # 치수선 추가
    dim_offset = 1000
    dim_offset_far = 1500
    ext_line_gap = 500

    # 치수선 기준점
    left_x = -af_left_ext if af_use else 0
    right_x = total_width + 500       # 지하수위 치수선 원점
    right_x_far = total_width + 1000  # 전체높이/토피 치수선 원점

    # 전체 폭 치수선 (하단)
    msp.add_linear_dim(
        base=(total_width / 2, -dim_offset),
        p1=(0, 0),
        p2=(total_width, 0),
        dimstyle="EZDXF"
    )

    # 전체 높이 치수선 (우측, 외측 tier)
    msp.add_linear_dim(
        base=(right_x_far + dim_offset, total_height / 2),
        p1=(right_x_far, 0),
        p2=(right_x_far, total_height),
        angle=90,
        dimstyle="EZDXF"
    )

    # 내공 높이 H (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT + H / 2),
        p1=(left_x, LT),
        p2=(left_x, LT + H),
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

    # 상부 슬래브 UT (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT + H + UT / 2),
        p1=(left_x, LT + H),
        p2=(left_x, total_height),
        angle=90,
        dimstyle="EZDXF"
    )

    # 하부 슬래브 LT (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT / 2),
        p1=(left_x, 0),
        p2=(left_x, LT),
        angle=90,
        dimstyle="EZDXF"
    )

    # 좌측벽 WL (상단)
    msp.add_linear_dim(
        base=(WL / 2, total_height + dim_offset),
        p1=(0, total_height),
        p2=(WL, total_height),
        dimstyle="EZDXF"
    )

    # 우측벽 WR (상단)
    msp.add_linear_dim(
        base=(total_width - WR / 2, total_height + dim_offset),
        p1=(total_width - WR, total_height),
        p2=(total_width, total_height),
        dimstyle="EZDXF"
    )

    # 중간벽 치수 (상단)
    if middle_walls:
        x_offset = WL
        for i in range(culvert_count):
            x_offset += B_list[i]
            if i < len(middle_walls):
                wall_thickness = middle_walls[i]['thickness']
                msp.add_linear_dim(
                    base=(x_offset + wall_thickness / 2, total_height + dim_offset),
                    p1=(x_offset, total_height),
                    p2=(x_offset + wall_thickness, total_height),
                    dimstyle="EZDXF"
                )
                x_offset += wall_thickness

    # 부상방지저판 치수
    if af_use:
        if af_left_ext > 0:
            # 좌측 돌출폭 (수평)
            msp.add_linear_dim(
                base=(-af_left_ext / 2, -dim_offset),
                p1=(-af_left_ext, 0),
                p2=(0, 0),
                dimstyle="EZDXF"
            )
            # 저판 두께 (수직, LT와 동일 레벨)
            msp.add_linear_dim(
                base=(-af_left_ext - dim_offset, LT / 2),
                p1=(-af_left_ext, 0),
                p2=(-af_left_ext, LT),
                angle=90,
                dimstyle="EZDXF"
            )

    # 토피 치수 (우측)
    if earth_cover > 0:
        ground_y = total_height + earth_cover
        msp.add_linear_dim(
            base=(right_x_far + dim_offset, total_height + earth_cover / 2),
            p1=(right_x_far, total_height),
            p2=(right_x_far, ground_y),
            angle=90,
            dimstyle="EZDXF"
        )

        # 지하수위 깊이 치수
        if water_level > 0:
            water_y = ground_y - water_level
            msp.add_linear_dim(
                base=(right_x + dim_offset, ground_y - water_level / 2),
                p1=(right_x, water_y),
                p2=(right_x, ground_y),
                angle=90,
                dimstyle="EZDXF"
            )


    return doc