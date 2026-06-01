# MVP 로드맵

## Phase 1: 설계 확정

- 동시 접속 인원 목표 확정
- 서버 접속 방식 확정: 공인 IP, 포트포워딩, VPN, TURN, 클라우드 중계 중 선택
- PTT/상시 송신 기본 모드 확정
- Android 최소 버전 확정

## Phase 2: 서버 프로토타입

- WebSocket signaling 서버
- 룸 생성/참가
- 참가자 상태 브로드캐스트
- media server 연동 방식 검증

## Phase 3: Android 오디오 프로토타입

- 마이크 권한
- 헤드셋 라우팅
- Foreground service
- WebRTC 송수신
- PTT 버튼과 mute 상태 처리

## Phase 4: 통합 테스트

- PC 1대와 Android 2대 이상 연결
- LTE 환경에서 지연/끊김 테스트
- 재연결 테스트
- 헤드셋 종류별 테스트

## Phase 5: 현장 사용성 개선

- 룸 코드 QR 표시
- 접속 품질 표시
- 운영자용 참가자 mute/kick
- 로그 저장

## 첫 구현 산출물

- `server/`: PC 서버 프로토타입
- `android/`: Android 앱
- `docs/`: 요구사항, 아키텍처, 테스트 기록

## 주요 리스크

- LTE 단말에서 PC 서버까지 들어오는 네트워크 경로 확보
- Android 백그라운드 오디오 정책
- 블루투스 헤드셋 지연
- 다자 통화 시 서버 CPU와 업로드 대역폭
- 현장 네트워크 품질 편차
