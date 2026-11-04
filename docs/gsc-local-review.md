# PEOPLEENT Search Console URL 대조 도구

도구 주소: https://peopleent.pagero.kr/tools/gsc-review.html

이 도구는 기존 사이트맵에 등록된 35개 URL과 사용자가 직접 내보낸 Google Search Console 자료를 **브라우저 안에서** 대조한다. GSC API나 구독 서비스는 필요하지 않다.

## 사용 절차

1. Google Search Console에서 `https://peopleent.pagero.kr/`이 포함된 속성을 연다.
2. `페이지 색인` 보고서에서 제외 사유 하나를 선택한다. 예시 URL 목록을 CSV로 내보낼 수 있는 경우 해당 파일을 내려받는다.
3. 도구 상단에서 파일에 해당하는 제외 사유를 고르고 CSV를 가져온다. 다른 사유도 반복한다.
4. 원하는 경우 Search Console `검색 실적 → 페이지`에서 CSV를 별도로 가져온다. **실적 파일은 색인 여부의 근거로 사용하지 않는다.**
5. 결과표를 CSV로 내려받아 우선 점검할 URL을 확인한다.

주의: 페이지 색인 화면에서 내보낸 '사유별 페이지 수' 집계표는 개별 URL을 나타내지 않는다. 이 도구는 해당 파일을 거부한다. Search Console 화면의 예시 목록이 전체 URL을 모두 나열한다는 보장은 없다.

## 상태 판단

- `색인됨`은 사용자가 **그 근거가 있는 URL 목록**으로 명시해 가져왔을 때만 표시한다.
- `크롤링됨 - 현재 색인이 생성되지 않음`, `발견됨 - 현재 색인이 생성되지 않음`, 중복 canonical, 차단·오류 등은 해당 사유의 예시 CSV에 포함된 URL에만 적용한다.
- 어떤 색인 상태 CSV에도 없는 URL은 **미확인**이다. 이를 '정상 색인'이나 '미색인'으로 자동 판정하지 않는다.
- 같은 URL이 서로 다른 사유의 CSV에 나타나면 `자료 간 상태 충돌`로 표시하고 수집일·최신 URL 검사 데이터를 확인한다.
- 검색 성과 CSV에 없는 URL은 '노출 0회'도 '미색인'도 아니다. 미포함을 의미하는 `—`로 표시한다.
- 도구는 전체 35개 사이트맵 URL만 대상으로 한다. 다른 호스트의 URL과 사이트맵에 없는 URL은 제외 수량을 알린다.
- 검색 성과 CSV를 다시 가져오면 이전 성과 데이터를 대체한다. 중복 파일을 단순 누적하지 않는다.

## 개인정보·보안

- CSV는 브라우저 메모리에서만 처리한다. 서버 업로드, 별도 DB 저장, 로컬스토리지 저장 없음.
- CSV 안의 URL query와 fragment는 비교 전 제거. 쿼리 값은 결과 CSV로 내보내지 않는다.
- CSV 결과에 스프레드시트 수식으로 해석될 수 있는 값은 앞에 작은따옴표를 붙여 내보낸다.
- `tools/gsc-review.html`은 `noindex,nofollow` 메타와 운영 사이트 응답의 `X-Robots-Tag: noindex,nofollow`를 적용한다.
- 해당 페이지에서는 GA4 및 이벤트 추적 스크립트를 로드하지 않는다.

## 테스트

`node scripts/test_gsc_review.mjs` — CSV 인코딩·한글/영문 헤더·중복·URL 정규화·상태 충돌·성과와 색인 구분·CSV 수식 보호.

`node scripts/test_middleware_seo.mjs` — CSV 도구에 운영 추적이 삽입되지 않고, 크롤러 차단 응답을 내보내는지.

`node scripts/test_insight_interactions.mjs` — 실제 Chrome에서 35 URL 로드, 색인 예시 CSV 가져오기, 검색 실적 추가, 충돌 상태 필터, 초기화를 확인한다.

**이 도구는 GSC에서 직접 가져온 원본 자료가 있어야만 실제 색인 상태를 보여준다.** API 접근이 없어도 분석은 가능하지만, 파일이 없다면 35개 URL 전체를 미확인으로 표시한다. Google 색인 결정과 검색 노출은 원본 Search Console에서 확인해야 한다.
