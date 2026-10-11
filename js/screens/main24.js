// 배근 입력 > 주철근 (2,4Cycle) (매뉴얼 5.4)
// 배치옵션 2Cycle / 4Cycle 에서 활성. 절단점(UD/LD), 조각별 직경(UR/LR)과 배치여부(체크)를 입력한다.
// 4Cycle 은 머리줄에서 2Cycle/4Cycle 을 고르며, 4Cycle 은 직경·배치를 2Cycle 에서 따르고 절단위치만 따로 둔다.
// [철근연결] → culverts[i].rebar.connect[bi], 단절점부 주철근 절곡배치 → culverts[i].rebar.main[bi].bendCorner

import { makeMainScreen } from './main1.js';

export default makeMainScreen(24);
