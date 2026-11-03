# PEOPLEENT GA4 콘텐츠 탐색 이벤트

운영 사이트: `https://peopleent.pagero.kr`  
기존 GA4 측정 ID: `G-501Z526B8H`  
코드: `assets/peopleent-engagement.js` (Cloudflare Pages `functions/_middleware.js`가 운영 HTML에만 삽입)

## 보내는 이벤트

| 이벤트명 | 발생 조건 | 의미 |
| --- | --- | --- |
| `pe_article_click` | 사이트 내 인사이트 글 링크 클릭 | 글을 이어 읽으려는 행동 |
| `pe_service_click` | 사이트 내 6개 행사 서비스 페이지 링크 클릭 | 서비스 상세 정보를 확인하려는 행동 |
| `pe_contact_click` | `https://peopleent.com/contact`로 이동하는 링크 클릭 | **문의 화면 열기 클릭**. 실제 문의 제출이나 접수 성공이 아님 |
| `pe_search_used` | 인사이트 검색창에 처음으로 비어 있지 않은 검색어 입력 | 검색창 사용 여부만 확인. 검색어, 글자 수, 결과 개수 수집 안 함 |
| `pe_topic_filter` | 인사이트 허브의 허용된 주제 필터 클릭 | 클릭한 고정 주제명만 기록 |

## 고정된 이벤트 매개변수

- `source_type`: `home`, `insight_hub`, `article`, `service`, `other`
- `source_path`: 쿼리 문자열이 제거된 공개 페이지 경로 (예: `/insight/event-agency-cost/`)
- `link_position`: `sticky`, `related_service`, `reading_path`, `article_card`, `hero`, `inline_cta`, `body`
- `destination_path`: 서비스·인사이트 페이지로 이동할 때의 공개 페이지 경로만
- `topic_group`: 사전에 정한 6개 주제 필터 중 하나

클릭 링크의 전체 URL, UTM·검색 매개변수, 검색어, 연락처, 문의 내용, 편집 양식 입력값은 이 이벤트에서 **전송하지 않음**. 사용자가 스크립트를 차단하거나 Analytics가 작동하지 않아도 링크 이동은 계속되어야 함.

## GA4에서 확인할 내용

1. Analytics의 실시간 보고서나 DebugView에서 위 이벤트 5개가 전송되는지 확인.
2. 이벤트 매개변수를 분석 보고서에서 쓰려면 **관리자 → 맞춤 정의 → 맞춤 측정기준**에서 `source_type`, `source_path`, `link_position`, `destination_path`, `topic_group`을 각각 **이벤트 범위** 측정기준으로 등록. 기존 GA4 권한과 UI에 따라 메뉴명이 달라질 수 있음.
3. 분석: `pe_article_click` → `pe_service_click` → `pe_contact_click` 흐름은 사이트 내 이동 의향을 보여줌. 서로 다른 세션의 이벤트 수를 그대로 연결하여 실제 전환율이라고 단정하지 말 것.
4. **`pe_contact_click`을 `generate_lead`나 문의 성공으로 해석하지 말 것.** 실제 문의 제출 성공은 `peopleent.com` 문의폼에서 별도 확인할 수 있는 제출 완료 이벤트나 서버 접수 자료로만 측정 가능.

## 검증

`node scripts/test_engagement_events.mjs` — 실제 네트워크 없이 클릭 분류·출처·이벤트 입력값 보호·운영 도메인 제한을 검사.

`node scripts/test_middleware_seo.mjs` — 운영 HTML에만 스크립트가 한 번 삽입되고 미리보기/관리자에는 들어가지 않는지 검사.

`.github/workflows/insight-quality.yml` — PR 및 main 변경 때 위 검사를 자동 실행.

> 색인 상태나 실제 문의 수에 관한 결론은 이 코드만으로 얻을 수 없다. GA4의 실시간 수신, 실제 문의폼 제출과 Google Search Console의 검색 노출은 별개로 확인해야 한다.
