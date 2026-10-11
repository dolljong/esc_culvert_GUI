// 배근 입력 > 주철근 (3Cycle) (매뉴얼 5.3)
// 배근설정의 배치옵션이 4Cycle 일 때만 활성. 이음수·직경은 1Cycle 과 같고 겹이음 위치(UD/LD)만 입력한다.
// 데이터: culverts[i].rebar.main[bi].c3[zone]['L'+단][member][face] = { D[] }

import { makeMainScreen } from './main1.js';

export default makeMainScreen(3);
