"""부력 검토 (Buoyancy Check) 모듈"""

import ezdxf
from PyQt5.QtWidgets import (QDialog, QVBoxLayout, QTextEdit, QPushButton,
                              QHBoxLayout)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont
from utils import setup_dimstyle

GAMMA_C = 24.5   # 콘크리트 단위중량 (kN/m³)
GAMMA_W = 9.81   # 물의 단위중량 (kN/m³)


def _fmt(val):
    """숫자 포맷 (정수면 정수로, 아니면 소수점 1자리)"""
    if val == int(val):
        return f"{int(val):,}"
    return f"{val:,.1f}"


def _fmt2(val):
    """소수점 2자리"""
    return f"{val:,.2f}"


def _fmt3(val):
    """소수점 3자리 (m 변환용)"""
    return f"{val:,.3f}"


def generate_buoyancy_report(section_data, ground_info):
    """부력검토 계산 보고서 생성

    Args:
        section_data: 단면제원 데이터 (dict)
        ground_info: 지반정보 데이터 (dict)

    Returns:
        str: 상세 계산 보고서 텍스트
    """
    # ── 데이터 추출 ──
    culvert_count = int(section_data.get('culvert_count', 3))
    H = float(section_data.get('H', 4200))
    B_list = [float(b) for b in section_data.get('B', [4000] * culvert_count)]
    UT = float(section_data.get('UT', 600))
    LT = float(section_data.get('LT', 800))
    WL = float(section_data.get('WL', 600))
    WR = float(section_data.get('WR', 600))
    middle_walls = section_data.get('middle_walls', [])
    haunch_data = section_data.get('haunch', {})
    column_girder = section_data.get('columnGirder', {})
    anti_float = section_data.get('antiFloat', {})

    earth_cover = float(ground_info.get('earthCoverDepth', 2000))
    gwl = float(ground_info.get('groundwaterLevel', 3000))
    gamma_s = float(ground_info.get('soilUnitWeight', 18.0))

    # 기둥/종거더 데이터
    ctc = float(column_girder.get('columnCTC', 3000))
    col_width = float(column_girder.get('columnWidth', 500))
    upper_add_h = float(column_girder.get('upperAdditionalHeight', 200))
    lower_add_h = float(column_girder.get('lowerAdditionalHeight', 200))

    # 헌치 데이터
    left_haunch = haunch_data.get('leftWall', {
        'upper': {'width': 300, 'height': 300},
        'lower': {'width': 300, 'height': 300}
    })
    right_haunch = haunch_data.get('rightWall', {
        'upper': {'width': 300, 'height': 300},
        'lower': {'width': 300, 'height': 300}
    })
    middle_haunches = haunch_data.get('middleWalls', [])

    # 부상방지저판 데이터
    af_use = anti_float.get('use', False)
    af_left_ext = float(anti_float.get('leftExtension', 500))
    af_right_ext = float(anti_float.get('rightExtension', 500))
    af_thickness = float(anti_float.get('thickness', 300))

    # ── 기본 치수 계산 ──
    total_inner_width = sum(B_list)
    total_mw_thickness = sum(float(mw.get('thickness', 0)) for mw in middle_walls)
    total_width = WL + total_inner_width + total_mw_thickness + WR
    total_height = LT + H + UT

    # 부력 계산용 하단 치수
    if af_use:
        bottom_width = af_left_ext + total_width + af_right_ext
        bottom_depth = earth_cover + total_height + af_thickness
    else:
        bottom_width = total_width
        bottom_depth = earth_cover + total_height

    # ── 보고서 생성 ──
    lines = []

    def add(text=''):
        lines.append(text)

    add("═" * 60)
    add("         부 력 검 토 (Buoyancy Check)")
    add("═" * 60)
    add()

    # ────────────────────────────────────────
    # 1. 설계 조건
    # ────────────────────────────────────────
    add("1. 설계 조건")
    add("─" * 55)
    add(f"   콘크리트 단위중량 (γc)  = {_fmt2(GAMMA_C)} kN/m³")
    add(f"   물의 단위중량 (γw)      = {_fmt2(GAMMA_W)} kN/m³")
    add(f"   흙의 단위중량 (γs)      = {_fmt2(gamma_s)} kN/m³")
    add(f"   토피 (Dc)              = {_fmt(earth_cover)} mm")
    add(f"   지하수위 (GWL)          = {_fmt(gwl)} mm (지표면 기준)")
    add()

    # ────────────────────────────────────────
    # 2. 구조물 제원
    # ────────────────────────────────────────
    add("2. 구조물 제원")
    add("─" * 55)

    width_parts = [f"WL({_fmt(WL)})"]
    for i, b in enumerate(B_list):
        width_parts.append(f"B{i+1}({_fmt(b)})")
        if i < len(middle_walls):
            mw_t = float(middle_walls[i].get('thickness', 0))
            width_parts.append(f"MW{i+1}({_fmt(mw_t)})")
    width_parts.append(f"WR({_fmt(WR)})")

    add(f"   암거련수              = {culvert_count}련")
    add(f"   내공높이 (H)          = {_fmt(H)} mm")
    add(f"   총 폭 (B_total)      = {' + '.join(width_parts)}")
    add(f"                         = {_fmt(total_width)} mm = {_fmt3(total_width / 1000)} m")
    add(f"   총 높이 (H_total)     = LT({_fmt(LT)}) + H({_fmt(H)}) + UT({_fmt(UT)})")
    add(f"                         = {_fmt(total_height)} mm = {_fmt3(total_height / 1000)} m")

    if af_use:
        add(f"   부상방지저판           = 적용")
        add(f"     좌측확장: {_fmt(af_left_ext)} mm, 우측확장: {_fmt(af_right_ext)} mm, 두께: {_fmt(af_thickness)} mm")
        add(f"     하단 총폭 = {_fmt(af_left_ext)} + {_fmt(total_width)} + {_fmt(af_right_ext)}"
            f" = {_fmt(bottom_width)} mm")
    add()

    # ────────────────────────────────────────
    # 3. 구조물 자중 산정
    # ────────────────────────────────────────
    add("3. 구조물 자중 산정 (단위 m 당)")
    add("─" * 55)
    add("   ※ 구조물 단면을 사각형/삼각형으로 분할하여 산정합니다.")
    add()

    shape_no = 0
    total_weight = 0.0

    # ── 사각형: 상부슬래브 ──
    shape_no += 1
    area = total_width * UT
    weight = GAMMA_C * area / 1e6
    total_weight += weight
    add(f"   [사각형 No.{shape_no}] 상부슬래브")
    add(f"     크기 = {_fmt(total_width)} × {_fmt(UT)} mm")
    add(f"     면적 A = {_fmt(total_width)} × {_fmt(UT)} = {_fmt(area)} mm²")
    add(f"     무게 W = γc × A / 10⁶ = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
    add()

    # ── 사각형: 하부슬래브 ──
    shape_no += 1
    area = total_width * LT
    weight = GAMMA_C * area / 1e6
    total_weight += weight
    add(f"   [사각형 No.{shape_no}] 하부슬래브")
    add(f"     크기 = {_fmt(total_width)} × {_fmt(LT)} mm")
    add(f"     면적 A = {_fmt(total_width)} × {_fmt(LT)} = {_fmt(area)} mm²")
    add(f"     무게 W = γc × A / 10⁶ = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
    add()

    # ── 사각형: 좌측벽체 ──
    shape_no += 1
    area = WL * H
    weight = GAMMA_C * area / 1e6
    total_weight += weight
    add(f"   [사각형 No.{shape_no}] 좌측벽체")
    add(f"     크기 = {_fmt(WL)} × {_fmt(H)} mm")
    add(f"     면적 A = {_fmt(WL)} × {_fmt(H)} = {_fmt(area)} mm²")
    add(f"     무게 W = γc × A / 10⁶ = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
    add()

    # ── 중간벽체 ──
    for i, mw in enumerate(middle_walls):
        mw_thickness = float(mw.get('thickness', 600))
        mw_type = mw.get('type', '연속벽')
        mw_haunch = (middle_haunches[i] if i < len(middle_haunches) else
                     {'upper': {'width': 300, 'height': 300},
                      'lower': {'width': 300, 'height': 300}})

        if mw_type == '연속벽':
            # 연속벽 → 단일 사각형
            shape_no += 1
            area = mw_thickness * H
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [사각형 No.{shape_no}] 중간벽체{i+1} (연속벽)")
            add(f"     크기 = {_fmt(mw_thickness)} × {_fmt(H)} mm")
            add(f"     면적 A = {_fmt(mw_thickness)} × {_fmt(H)} = {_fmt(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
            add()
        else:
            # 기둥 → 상부종거더 + 하부종거더 + 기둥본체
            mh_upper_h = float(mw_haunch['upper']['height'])
            mh_lower_h = float(mw_haunch['lower']['height'])

            add(f"   ---- 중간벽체{i+1} (기둥, CTC={_fmt(ctc)} mm) ----")
            add()

            # 상부종거더 (연속부재)
            upper_girder_h = mh_upper_h + upper_add_h
            shape_no += 1
            area = mw_thickness * upper_girder_h
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [사각형 No.{shape_no}] 중간벽체{i+1} 상부종거더 (연속)")
            add(f"     거더높이 = 헌치높이({_fmt(mh_upper_h)}) + 추가높이({_fmt(upper_add_h)})"
                f" = {_fmt(upper_girder_h)} mm")
            add(f"     크기 = {_fmt(mw_thickness)} × {_fmt(upper_girder_h)} mm")
            add(f"     면적 A = {_fmt(mw_thickness)} × {_fmt(upper_girder_h)} = {_fmt(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
            add()

            # 하부종거더 (연속부재)
            lower_girder_h = mh_lower_h + lower_add_h
            shape_no += 1
            area = mw_thickness * lower_girder_h
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [사각형 No.{shape_no}] 중간벽체{i+1} 하부종거더 (연속)")
            add(f"     거더높이 = 헌치높이({_fmt(mh_lower_h)}) + 추가높이({_fmt(lower_add_h)})"
                f" = {_fmt(lower_girder_h)} mm")
            add(f"     크기 = {_fmt(mw_thickness)} × {_fmt(lower_girder_h)} mm")
            add(f"     면적 A = {_fmt(mw_thickness)} × {_fmt(lower_girder_h)} = {_fmt(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
            add()

            # 기둥 본체 (CTC 고려)
            col_clear_h = H - upper_girder_h - lower_girder_h
            if col_clear_h > 0 and ctc > 0:
                shape_no += 1
                area_full = mw_thickness * col_clear_h
                area_per_m = area_full * col_width / ctc
                weight = GAMMA_C * area_per_m / 1e6
                total_weight += weight
                add(f"   [사각형 No.{shape_no}] 중간벽체{i+1} 기둥본체 (CTC 고려)")
                add(f"     기둥높이 = H({_fmt(H)}) - 상부거더({_fmt(upper_girder_h)})"
                    f" - 하부거더({_fmt(lower_girder_h)}) = {_fmt(col_clear_h)} mm")
                add(f"     기둥 단면적 = {_fmt(mw_thickness)} × {_fmt(col_clear_h)}"
                    f" = {_fmt(area_full)} mm²")
                add(f"     단위m 환산 = {_fmt(area_full)} × 기둥폭({_fmt(col_width)})"
                    f" / CTC({_fmt(ctc)})")
                add(f"                = {_fmt2(area_per_m)} mm²/m")
                add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt2(area_per_m)} / 10⁶"
                    f" = {_fmt2(weight)} kN/m")
                add()

    # ── 사각형: 우측벽체 ──
    shape_no += 1
    area = WR * H
    weight = GAMMA_C * area / 1e6
    total_weight += weight
    add(f"   [사각형 No.{shape_no}] 우측벽체")
    add(f"     크기 = {_fmt(WR)} × {_fmt(H)} mm")
    add(f"     면적 A = {_fmt(WR)} × {_fmt(H)} = {_fmt(area)} mm²")
    add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
    add()

    # ── 삼각형: 헌치 ──
    add("   ── 헌치 (삼각형) ──")
    add()

    def add_haunch_triangle(label, w, h, scale=1.0, scale_desc=None):
        nonlocal shape_no, total_weight
        if w <= 0 or h <= 0:
            return
        shape_no += 1
        area = 0.5 * w * h
        if scale != 1.0 and scale_desc:
            area_eff = area * scale
            weight = GAMMA_C * area_eff / 1e6
            total_weight += weight
            add(f"   [삼각형 No.{shape_no}] {label}")
            add(f"     면적 = 0.5 × {_fmt(w)} × {_fmt(h)} = {_fmt2(area)} mm²")
            add(f"     단위m 환산 = {_fmt2(area)} × {scale_desc} = {_fmt2(area_eff)} mm²/m")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt2(area_eff)} / 10⁶ = {_fmt2(weight)} kN/m")
        else:
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [삼각형 No.{shape_no}] {label}")
            add(f"     면적 = 0.5 × {_fmt(w)} × {_fmt(h)} = {_fmt2(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt2(area)} / 10⁶ = {_fmt2(weight)} kN/m")
        add()

    # 좌측벽 헌치
    add_haunch_triangle(
        "좌측벽 상부헌치",
        float(left_haunch['upper']['width']),
        float(left_haunch['upper']['height']))
    add_haunch_triangle(
        "좌측벽 하부헌치",
        float(left_haunch['lower']['width']),
        float(left_haunch['lower']['height']))

    # 중간벽 헌치
    for i, mw in enumerate(middle_walls):
        mw_haunch = (middle_haunches[i] if i < len(middle_haunches) else
                     {'upper': {'width': 300, 'height': 300},
                      'lower': {'width': 300, 'height': 300}})

        # 연속벽/기둥 모두: 양쪽 헌치 (×2) - 헌치는 인접 셀로 돌출되어 거더와 별개
        mu_w = float(mw_haunch['upper']['width'])
        mu_h = float(mw_haunch['upper']['height'])
        if mu_w > 0 and mu_h > 0:
            shape_no += 1
            area = 2 * 0.5 * mu_w * mu_h
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [삼각형 No.{shape_no}] 중간벽{i+1} 상부헌치 (양쪽 2개)")
            add(f"     면적 = 2 × 0.5 × {_fmt(mu_w)} × {_fmt(mu_h)} = {_fmt2(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt2(area)} / 10⁶ = {_fmt2(weight)} kN/m")
            add()

        ml_w = float(mw_haunch['lower']['width'])
        ml_h = float(mw_haunch['lower']['height'])
        if ml_w > 0 and ml_h > 0:
            shape_no += 1
            area = 2 * 0.5 * ml_w * ml_h
            weight = GAMMA_C * area / 1e6
            total_weight += weight
            add(f"   [삼각형 No.{shape_no}] 중간벽{i+1} 하부헌치 (양쪽 2개)")
            add(f"     면적 = 2 × 0.5 × {_fmt(ml_w)} × {_fmt(ml_h)} = {_fmt2(area)} mm²")
            add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt2(area)} / 10⁶ = {_fmt2(weight)} kN/m")
            add()

    # 우측벽 헌치
    add_haunch_triangle(
        "우측벽 상부헌치",
        float(right_haunch['upper']['width']),
        float(right_haunch['upper']['height']))
    add_haunch_triangle(
        "우측벽 하부헌치",
        float(right_haunch['lower']['width']),
        float(right_haunch['lower']['height']))

    # ── 부상방지저판 ──
    if af_use:
        shape_no += 1
        af_total_width = af_left_ext + total_width + af_right_ext
        area = af_total_width * af_thickness
        weight = GAMMA_C * area / 1e6
        total_weight += weight
        add(f"   [사각형 No.{shape_no}] 부상방지저판")
        add(f"     폭 = {_fmt(af_left_ext)} + {_fmt(total_width)} + {_fmt(af_right_ext)}"
            f" = {_fmt(af_total_width)} mm")
        add(f"     크기 = {_fmt(af_total_width)} × {_fmt(af_thickness)} mm")
        add(f"     면적 A = {_fmt(af_total_width)} × {_fmt(af_thickness)} = {_fmt(area)} mm²")
        add(f"     무게 W = {_fmt2(GAMMA_C)} × {_fmt(area)} / 10⁶ = {_fmt2(weight)} kN/m")
        add()

    add("   " + "─" * 51)
    add(f"   구조물 자중 합계 (Wc) = {_fmt2(total_weight)} kN/m")
    add()

    # ────────────────────────────────────────
    # 4. 상재토 무게
    # ────────────────────────────────────────
    add("4. 상재토 무게 (단위 m 당)")
    add("─" * 55)
    soil_area = total_width * earth_cover
    soil_weight = gamma_s * soil_area / 1e6
    add(f"   토피고 = {_fmt(earth_cover)} mm = {_fmt3(earth_cover / 1000)} m")
    add(f"   폭    = {_fmt(total_width)} mm = {_fmt3(total_width / 1000)} m")
    add(f"   면적  = {_fmt(total_width)} × {_fmt(earth_cover)} = {_fmt(soil_area)} mm²")
    add(f"   무게 (Ws) = γs × A / 10⁶ = {_fmt2(gamma_s)} × {_fmt(soil_area)} / 10⁶"
        f" = {_fmt2(soil_weight)} kN/m")
    add()

    # ────────────────────────────────────────
    # 5. 부력 산정
    # ────────────────────────────────────────
    add("5. 부력 산정 (단위 m 당)")
    add("─" * 55)

    if af_use:
        add(f"   구조물 하단 깊이 = 토피({_fmt(earth_cover)}) + 총높이({_fmt(total_height)})"
            f" + 부상방지저판({_fmt(af_thickness)})")
    else:
        add(f"   구조물 하단 깊이 = 토피({_fmt(earth_cover)}) + 총높이({_fmt(total_height)})")
    add(f"                     = {_fmt(bottom_depth)} mm (지표면 기준)")
    add(f"   지하수위            = {_fmt(gwl)} mm (지표면 기준)")
    add()

    hw = bottom_depth - gwl
    if hw <= 0:
        hw = 0
        buoyancy = 0
        add("   → 지하수위가 구조물 하단보다 깊으므로 부력이 발생하지 않음")
    else:
        add(f"   수두 높이 (hw) = {_fmt(bottom_depth)} - {_fmt(gwl)}"
            f" = {_fmt(hw)} mm = {_fmt3(hw / 1000)} m")
        add(f"   부력 작용 폭   = {_fmt(bottom_width)} mm = {_fmt3(bottom_width / 1000)} m")
        add()
        buoyancy = GAMMA_W * (hw / 1000) * (bottom_width / 1000)
        add(f"   부력 (U) = γw × hw × B_bottom")
        add(f"            = {_fmt2(GAMMA_W)} × {_fmt3(hw / 1000)} × {_fmt3(bottom_width / 1000)}")
        add(f"            = {_fmt2(buoyancy)} kN/m")
    add()

    # ────────────────────────────────────────
    # 6. 안전율 검토
    # ────────────────────────────────────────
    add("6. 안전율 검토")
    add("─" * 55)

    total_resist = total_weight + soil_weight
    add(f"   저항력 (R) = Wc + Ws")
    add(f"              = {_fmt2(total_weight)} + {_fmt2(soil_weight)}")
    add(f"              = {_fmt2(total_resist)} kN/m")
    add()
    add(f"   부력 (U)   = {_fmt2(buoyancy)} kN/m")
    add()

    if buoyancy > 0:
        fs = total_resist / buoyancy
        add(f"   안전율 (FS) = R / U")
        add(f"               = {_fmt2(total_resist)} / {_fmt2(buoyancy)}")
        add(f"               = {_fmt2(fs)}")
        add()
        add(f"   필요 안전율 ≥ 1.20")
        add()
        if fs >= 1.20:
            add(f"   FS = {_fmt2(fs)} ≥ 1.20  →  O.K.")
        else:
            add(f"   FS = {_fmt2(fs)} < 1.20  →  N.G.")
    else:
        add("   지하수위가 구조물 하단보다 깊으므로 부력이 작용하지 않습니다.")
        add("   부력 검토가 필요하지 않습니다. → O.K.")

    add()
    add("═" * 60)

    return '\n'.join(lines)


def create_buoyancy_shapes_dxf(section_data):
    """부력검토용 - 단면을 번호 매긴 삼각형/사각형으로 분할하여 DXF 생성

    번호는 generate_buoyancy_report()의 도형 번호와 일치합니다.
    """
    doc = ezdxf.new('R2010')
    msp = doc.modelspace()

    if not section_data:
        return doc

    # ── 데이터 추출 ──
    H = float(section_data.get('H', 4200))
    B_list = [float(b) for b in section_data.get('B', [4000])]
    UT = float(section_data.get('UT', 600))
    LT = float(section_data.get('LT', 800))
    WL = float(section_data.get('WL', 600))
    WR = float(section_data.get('WR', 600))
    middle_walls = section_data.get('middle_walls', [])
    culvert_count = int(section_data.get('culvert_count', len(B_list)))
    haunch_data = section_data.get('haunch', {})
    column_girder = section_data.get('columnGirder', {})
    anti_float = section_data.get('antiFloat', {})

    total_inner_width = sum(B_list)
    total_mw_thickness = sum(float(mw.get('thickness', 0)) for mw in middle_walls)
    total_width = WL + total_inner_width + total_mw_thickness + WR
    total_height = LT + H + UT

    upper_add_h = float(column_girder.get('upperAdditionalHeight', 0))
    lower_add_h = float(column_girder.get('lowerAdditionalHeight', 0))

    left_haunch = haunch_data.get('leftWall', {
        'upper': {'width': 0, 'height': 0}, 'lower': {'width': 0, 'height': 0}})
    right_haunch = haunch_data.get('rightWall', {
        'upper': {'width': 0, 'height': 0}, 'lower': {'width': 0, 'height': 0}})
    middle_haunches = haunch_data.get('middleWalls', [])

    af_use = anti_float and anti_float.get('use', False)
    af_left = float(anti_float.get('leftExtension', 0)) if af_use else 0
    af_right = float(anti_float.get('rightExtension', 0)) if af_use else 0
    af_t = float(anti_float.get('thickness', 0)) if af_use else 0

    # DASHED 라인타입 등록
    if 'DASHED' not in doc.linetypes:
        doc.linetypes.add('DASHED', pattern=[0.5, 0.25, -0.25])

    # 색상
    CLR_OUTLINE = 7   # 흰색 (전체 윤곽)
    CLR_RECT = 7      # 흰색 (사각형)
    CLR_TRI = 7       # 흰색 (삼각형)
    CLR_GIRDER = 7    # 흰색 (기둥/종거더)
    CLR_NUM = 2       # 노랑 (번호)
    CLR_NAME = 3      # 녹색 (이름)
    CLR_AF = 7        # 흰색 (부상방지저판)

    shape_no = 0

    def _text_h(w, h):
        """도형 크기에 맞는 텍스트 높이"""
        th = min(w * 0.13, h * 0.13, 220)
        return max(th, 60)

    def _add_rect(x1, y1, x2, y2, name, color):
        """사각형 외곽선 + 번호/이름 라벨"""
        nonlocal shape_no
        shape_no += 1
        msp.add_lwpolyline(
            [(x1, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1)],
            dxfattribs={'color': color})
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = abs(x2 - x1), abs(y2 - y1)
        th = _text_h(w, h)
        num = f"No.{shape_no}"
        msp.add_text(num, dxfattribs={
            'insert': (cx - len(num) * th * 0.3, cy + th * 0.15),
            'height': th, 'color': CLR_NUM})
        nth = th * 0.7
        if len(name) * nth < w * 0.95:
            msp.add_text(name, dxfattribs={
                'insert': (cx - len(name) * nth * 0.45, cy - th * 0.9),
                'height': nth, 'color': CLR_NAME})

    def _add_rect_dashed(x1, y1, x2, y2, name, color):
        """점선 사각형 (기둥본체용)"""
        nonlocal shape_no
        shape_no += 1
        for p1, p2 in [((x1, y1), (x2, y1)), ((x2, y1), (x2, y2)),
                        ((x2, y2), (x1, y2)), ((x1, y2), (x1, y1))]:
            msp.add_line(p1, p2, dxfattribs={'color': color, 'linetype': 'DASHED'})
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        w, h = abs(x2 - x1), abs(y2 - y1)
        th = _text_h(w, h)
        num = f"No.{shape_no}"
        msp.add_text(num, dxfattribs={
            'insert': (cx - len(num) * th * 0.3, cy),
            'height': th, 'color': CLR_NUM})

    def _add_tri(p1, p2, p3, color, label=True):
        """삼각형 외곽선 + 라벨 (label=False면 외곽선만)"""
        nonlocal shape_no
        if label:
            shape_no += 1
        msp.add_lwpolyline([p1, p2, p3, p1], dxfattribs={'color': color})
        if label:
            cx = (p1[0] + p2[0] + p3[0]) / 3
            cy = (p1[1] + p2[1] + p3[1]) / 3
            xs = [p1[0], p2[0], p3[0]]
            ys = [p1[1], p2[1], p3[1]]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            th = min(_text_h(w, h), 130)
            num = f"No.{shape_no}"
            msp.add_text(num, dxfattribs={
                'insert': (cx - len(num) * th * 0.3, cy - th * 0.4),
                'height': th, 'color': CLR_NUM})

    # ── 전체 윤곽선 (참조용, 회색) ──
    msp.add_lwpolyline(
        [(0, 0), (total_width, 0), (total_width, total_height),
         (0, total_height), (0, 0)],
        dxfattribs={'color': CLR_OUTLINE})
    # 내공 윤곽선
    x_off = WL
    for i in range(culvert_count):
        B = B_list[i]
        left, right = x_off, x_off + B
        msp.add_lwpolyline(
            [(left, LT), (right, LT), (right, LT + H),
             (left, LT + H), (left, LT)],
            dxfattribs={'color': CLR_OUTLINE})
        x_off += B
        if i < len(middle_walls):
            x_off += float(middle_walls[i].get('thickness', 0))

    # ══════════════════════════════════════════
    # 도형 번호 (generate_buoyancy_report 순서와 동일)
    # ══════════════════════════════════════════

    # [사각형] 상부슬래브
    _add_rect(0, LT + H, total_width, total_height, "상부슬래브", CLR_RECT)

    # [사각형] 하부슬래브
    _add_rect(0, 0, total_width, LT, "하부슬래브", CLR_RECT)

    # [사각형] 좌측벽체
    _add_rect(0, LT, WL, LT + H, "좌측벽", CLR_RECT)

    # [중간벽체]
    x_off = WL
    for i in range(culvert_count):
        x_off += B_list[i]
        if i < len(middle_walls):
            mw = middle_walls[i]
            mw_t = float(mw.get('thickness', 600))
            mw_type = mw.get('type', '연속벽')
            mw_h = middle_haunches[i] if i < len(middle_haunches) else {}

            if mw_type == '연속벽':
                _add_rect(x_off, LT, x_off + mw_t, LT + H,
                          f"중간벽{i+1}", CLR_RECT)
            else:
                mh_u_h = float(mw_h.get('upper', {}).get('height', 0))
                mh_l_h = float(mw_h.get('lower', {}).get('height', 0))
                ug_h = mh_u_h + upper_add_h
                lg_h = mh_l_h + lower_add_h

                # 상부종거더 (연속)
                _add_rect(x_off, LT + H - ug_h, x_off + mw_t, LT + H,
                          f"상부거더", CLR_GIRDER)
                # 하부종거더 (연속)
                _add_rect(x_off, LT, x_off + mw_t, LT + lg_h,
                          f"하부거더", CLR_GIRDER)
                # 기둥본체 (CTC - 점선)
                col_bot = LT + lg_h
                col_top = LT + H - ug_h
                if col_top > col_bot:
                    _add_rect_dashed(x_off, col_bot, x_off + mw_t, col_top,
                                     f"기둥{i+1}", CLR_GIRDER)

            x_off += mw_t

    # [사각형] 우측벽체
    _add_rect(total_width - WR, LT, total_width, LT + H, "우측벽", CLR_RECT)

    # ── 헌치 (삼각형) ──

    # 좌측벽 상부헌치
    lu_w = float(left_haunch.get('upper', {}).get('width', 0))
    lu_h = float(left_haunch.get('upper', {}).get('height', 0))
    if lu_w > 0 and lu_h > 0:
        _add_tri((WL, LT + H), (WL + lu_w, LT + H), (WL, LT + H - lu_h), CLR_TRI)

    # 좌측벽 하부헌치
    ll_w = float(left_haunch.get('lower', {}).get('width', 0))
    ll_h = float(left_haunch.get('lower', {}).get('height', 0))
    if ll_w > 0 and ll_h > 0:
        _add_tri((WL, LT), (WL + ll_w, LT), (WL, LT + ll_h), CLR_TRI)

    # 중간벽 헌치 (연속벽/기둥 모두 - 양쪽 2개를 같은 번호로)
    x_off = WL
    for i in range(culvert_count):
        x_off += B_list[i]
        if i < len(middle_walls):
            mw = middle_walls[i]
            mw_t = float(mw.get('thickness', 600))
            mw_h = middle_haunches[i] if i < len(middle_haunches) else {}

            mu_w = float(mw_h.get('upper', {}).get('width', 0))
            mu_h = float(mw_h.get('upper', {}).get('height', 0))
            if mu_w > 0 and mu_h > 0:
                # 좌측 삼각형 (번호 부여)
                _add_tri(
                    (x_off, LT + H), (x_off - mu_w, LT + H),
                    (x_off, LT + H - mu_h), CLR_TRI, label=True)
                cur_no = shape_no
                # 우측 삼각형 (같은 번호 - 외곽선만)
                _add_tri(
                    (x_off + mw_t, LT + H), (x_off + mw_t + mu_w, LT + H),
                    (x_off + mw_t, LT + H - mu_h), CLR_TRI, label=False)
                # 우측에도 번호 표시
                cx2 = (x_off + mw_t + x_off + mw_t + mu_w + x_off + mw_t) / 3
                cy2 = (LT + H + LT + H + LT + H - mu_h) / 3
                th2 = min(_text_h(mu_w, mu_h), 130)
                msp.add_text(f"No.{cur_no}", dxfattribs={
                    'insert': (cx2 - 4 * th2 * 0.3, cy2 - th2 * 0.4),
                    'height': th2, 'color': CLR_NUM})

            ml_w = float(mw_h.get('lower', {}).get('width', 0))
            ml_h = float(mw_h.get('lower', {}).get('height', 0))
            if ml_w > 0 and ml_h > 0:
                _add_tri(
                    (x_off, LT), (x_off - ml_w, LT),
                    (x_off, LT + ml_h), CLR_TRI, label=True)
                cur_no = shape_no
                _add_tri(
                    (x_off + mw_t, LT), (x_off + mw_t + ml_w, LT),
                    (x_off + mw_t, LT + ml_h), CLR_TRI, label=False)
                cx2 = (x_off + mw_t + x_off + mw_t + ml_w + x_off + mw_t) / 3
                cy2 = (LT + LT + LT + ml_h) / 3
                th2 = min(_text_h(ml_w, ml_h), 130)
                msp.add_text(f"No.{cur_no}", dxfattribs={
                    'insert': (cx2 - 4 * th2 * 0.3, cy2 - th2 * 0.4),
                    'height': th2, 'color': CLR_NUM})

            x_off += mw_t

    # 우측벽 상부헌치
    rw_left = total_width - WR
    ru_w = float(right_haunch.get('upper', {}).get('width', 0))
    ru_h = float(right_haunch.get('upper', {}).get('height', 0))
    if ru_w > 0 and ru_h > 0:
        _add_tri((rw_left, LT + H), (rw_left - ru_w, LT + H),
                 (rw_left, LT + H - ru_h), CLR_TRI)

    # 우측벽 하부헌치
    rl_w = float(right_haunch.get('lower', {}).get('width', 0))
    rl_h = float(right_haunch.get('lower', {}).get('height', 0))
    if rl_w > 0 and rl_h > 0:
        _add_tri((rw_left, LT), (rw_left - rl_w, LT),
                 (rw_left, LT + rl_h), CLR_TRI)

    # 부상방지저판
    if af_use and af_t > 0:
        _add_rect(-af_left, -af_t, total_width + af_right, 0,
                  "부상방지저판", CLR_AF)

    # ══════════════════════════════════════════
    # 치수선 추가
    # ══════════════════════════════════════════
    setup_dimstyle(doc, scale=50)

    dim_offset = 1000
    left_x = -af_left if af_use else 0
    right_x = total_width + af_right if af_use else total_width

    # 전체 폭 (하단)
    msp.add_linear_dim(
        base=(total_width / 2, -dim_offset),
        p1=(0, 0), p2=(total_width, 0),
        dimstyle="EZDXF"
    ).render()

    # 전체 높이 (우측)
    msp.add_linear_dim(
        base=(right_x + dim_offset, total_height / 2),
        p1=(right_x, 0), p2=(right_x, total_height),
        angle=90, dimstyle="EZDXF"
    ).render()

    # 내공 높이 H (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT + H / 2),
        p1=(left_x, LT), p2=(left_x, LT + H),
        angle=90, dimstyle="EZDXF"
    ).render()

    # 상부 슬래브 UT (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT + H + UT / 2),
        p1=(left_x, LT + H), p2=(left_x, total_height),
        angle=90, dimstyle="EZDXF"
    ).render()

    # 하부 슬래브 LT (좌측)
    msp.add_linear_dim(
        base=(left_x - dim_offset, LT / 2),
        p1=(left_x, 0), p2=(left_x, LT),
        angle=90, dimstyle="EZDXF"
    ).render()

    # 각 내공 폭 (상단)
    x_off = WL
    for i in range(culvert_count):
        B = B_list[i]
        msp.add_linear_dim(
            base=(x_off + B / 2, total_height + dim_offset),
            p1=(x_off, total_height), p2=(x_off + B, total_height),
            dimstyle="EZDXF"
        ).render()
        x_off += B
        if i < len(middle_walls):
            x_off += float(middle_walls[i].get('thickness', 0))

    # 좌측벽 WL (상단)
    msp.add_linear_dim(
        base=(WL / 2, total_height + dim_offset),
        p1=(0, total_height), p2=(WL, total_height),
        dimstyle="EZDXF"
    ).render()

    # 우측벽 WR (상단)
    msp.add_linear_dim(
        base=(total_width - WR / 2, total_height + dim_offset),
        p1=(total_width - WR, total_height), p2=(total_width, total_height),
        dimstyle="EZDXF"
    ).render()

    # 중간벽 치수 (상단)
    if middle_walls:
        x_off = WL
        for i in range(culvert_count):
            x_off += B_list[i]
            if i < len(middle_walls):
                mw_t = float(middle_walls[i].get('thickness', 0))
                msp.add_linear_dim(
                    base=(x_off + mw_t / 2, total_height + dim_offset),
                    p1=(x_off, total_height), p2=(x_off + mw_t, total_height),
                    dimstyle="EZDXF"
                ).render()
                x_off += mw_t

    # 부상방지저판 치수
    if af_use and af_left > 0:
        msp.add_linear_dim(
            base=(-af_left / 2, -dim_offset),
            p1=(-af_left, 0), p2=(0, 0),
            dimstyle="EZDXF"
        ).render()
    if af_use and af_t > 0:
        msp.add_linear_dim(
            base=(-af_left - dim_offset, -af_t / 2),
            p1=(-af_left, -af_t), p2=(-af_left, 0),
            angle=90, dimstyle="EZDXF"
        ).render()

    return doc


class BuoyancyCheckDialog(QDialog):
    """부력검토 결과 팝업 대화상자"""

    def __init__(self, report_text, parent=None):
        super().__init__(parent)
        self.setWindowTitle("부력 검토 결과")
        self.setMinimumSize(700, 600)
        self.resize(750, 850)
        self.setWindowFlags(self.windowFlags() | Qt.WindowMaximizeButtonHint)

        layout = QVBoxLayout(self)

        # 텍스트 뷰어
        self.text_edit = QTextEdit()
        self.text_edit.setReadOnly(True)
        self.text_edit.setFont(QFont("Consolas", 10))
        self.text_edit.setPlainText(report_text)
        self.text_edit.setStyleSheet("""
            QTextEdit {
                background-color: #fafafa;
                border: 1px solid #ddd;
                padding: 10px;
            }
        """)
        layout.addWidget(self.text_edit)

        # 버튼 영역
        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        close_btn = QPushButton("닫기")
        close_btn.setMinimumWidth(100)
        close_btn.clicked.connect(self.accept)
        btn_layout.addWidget(close_btn)

        layout.addLayout(btn_layout)
