# PEOPLEENT 운영 사이트 색인 가능성 점검

도메인: https://peopleent.pagero.kr

이번 점검은 로컬 파일 검사를 넘어 **배포된 사이트가 실제 HTTP 요청에 어떻게 응답하는지** 검사한다. 단, Google Search Console의 색인 판정이 아니다.

## 검사 항목

- `robots.txt`가 HTTP 200과 `text/plain`으로 응답하고, 등록된 35개 사이트맵 URL에 Googlebot 접근을 허용하는지
- 배포된 `sitemap.xml`이 HTTP 200의 정상 XML인지, 저장소의 사이트맵에 포함된 URL과 일치하는지
- 모든 사이트맵 페이지의 HTTP 200 응답, URL 리다이렉트, HTML 콘텐츠 유형
- 각 페이지의 단일 정식 URL(canonical)과 HTML 제목, 렌더링 전에도 보이는 최소 본문 텍스트
- 운영 HTML 및 HTTP 응답 헤더에 `noindex` 또는 `nofollow`가 없는지
- 홈·인사이트 허브·기업행사 서비스·견적 글을 Googlebot과 유사한 User-Agent로 요청할 때 응답이 달라지는지

이 점검은 User-Agent 문자열만 흉내 내며 **실제 Googlebot의 검증된 크롤링을 보증하지 않는다.**

## 확인 방법

GitHub → Actions → `PEOPLEENT live search indexability audit`

- main 콘텐츠 검사에 성공하면 운영 사이트 배포를 짧게 기다린 뒤 실행
- 매일 오전 8:17(KST) 기준 정기 실행을 설정했으나 GitHub 일정 실행은 지연될 수 있음
- Actions에서 수동 실행 가능
- 성공 여부와 `peopleent-live-indexability-...` 결과 아티팩트의 `live-indexability-report.json` 확인

실패 시 `summary.diagnostics`에서 **문제 발생 URL·HTTP 응답·canonical·noindex·본문 노출** 확인. 배포가 진행 중인 경우 라이브 사이트맵의 URL 집합이 저장소와 일시적으로 다를 수 있으므로 배포 완료 후 재검사한다. 반복되는 HTTP 403/429 또는 챌린지 응답은 Cloudflare Bot/WAF 설정도 확인한다.

## 로컬 실행

```bash
python3 scripts/test_live_indexability.py
python3 scripts/check_live_indexability.py --samples-only
python3 scripts/check_live_indexability.py --output=live-indexability-report.json
```

`--samples-only`는 빠른 HTTP 점검, 전체 실행은 사이트맵에 있는 35개 URL을 점검한다. 보고서에는 공개 URL·응답 상태·canonical·진단 메시지만 저장하며 방문자 개인정보를 수집하지 않는다.

## 무엇을 아직 알 수 없나?

- Google이 어떤 URL을 실제 색인했는지
- Google에서 어떤 검색어로 노출되는지
- 중복·품질 판단에 따른 Google의 색인 제외 사유

위 항목은 Google Search Console의 페이지 색인 보고서, URL 검사, 검색 실적 데이터로 확인해야 한다. **실배포 색인 가능성 검사 통과와 Google 실제 검색 노출은 다른 결과**다.
