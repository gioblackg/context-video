# CONTEXT Video

YouTube를 직접 찾아다니기보다 **틀어놓고 듣기 좋은 긴 영상**을 발견하도록 돕는 웹 서비스 실험 프로젝트입니다.

## v0 목표

1. 검증된 Seed 채널의 업로드 영상 수집
2. 서버에서 Video Gate 판정
3. PASS 영상만 추천 Pool에 저장
4. 30분 / 1시간 / 1시간+ 기준으로 추천 API 제공
5. 사용자 검색은 YouTube 검색으로 연결하고, 우리 서버의 API quota를 사용하지 않음

## 현재 원칙

- `trend_collector`와 완전히 독립된 프로젝트
- 사용자 PC 설정을 변경하지 않음
- YouTube API Key를 브라우저에 노출하지 않음
- `search.list` 기반 신규 채널 발굴은 초기 버전에서 제외
- 먼저 CONTEXT 추천 기능만 검증
- 최종 서비스는 웹 기반

## 예정 구조

`YouTube Data API -> Cloudflare Worker -> Video Gate -> D1 -> Recommendation API -> Web UI`

> 현재 저장소는 초기 골격 단계입니다. Cloudflare 계정 리소스나 API Secret은 아직 생성/변경하지 않습니다.


## Beta 확장프로그램

현재 베타는 기존 수집 DB를 그대로 사용한다.

- 수집 단계의 Gate 결과와 무관하게 저장된 전체 영상을 home 추천 후보로 사용
- 3분 이하 영상은 Shorts 추천 후보로 별도 제공
- Worker가 매시간 임시 random 추천 snapshot 생성
- Chrome 확장프로그램은 `/api/recommendations/current`만 읽음
- shown / seen 기록은 사용자 브라우저 local storage에 저장
- 향후 추천 생성기만 Trend Hub 키워드 기반으로 교체하고 확장프로그램 API 계약은 유지

현재 베타 API:
- `GET /api/recommendations/current?mode=home&limit=30`
- `GET /api/recommendations/current?mode=shorts&limit=30`

확장프로그램 소스는 `extension/`에 있다.
