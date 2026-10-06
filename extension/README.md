# CONTEXT Video Beta Extension

## 목표
- YouTube 시청기록이 중지된 상태에서도 CONTEXT 추천을 홈에 표시
- 추천 후보는 Worker의 현재 영상 DB에서 가져옴
- Gate 통과 여부와 무관하게 전체 저장 영상이 home 추천 후보
- Shorts는 3분 이하 영상을 별도 추천 큐로 제공
- shown/seen 기록은 Chrome local storage에 저장
- 추천 API는 매시간 새로운 snapshot을 생성
- 향후 beta_hourly_random 생성기를 Trend Hub 키워드 기반 생성기로 교체

## 설치
Chrome > 확장 프로그램 > 개발자 모드 > 압축해제된 확장 프로그램을 로드 > 이 extension 폴더 선택

기본 API:
https://context-video.gioblackg.workers.dev

설정 페이지에서 API 주소를 변경할 수 있음.
