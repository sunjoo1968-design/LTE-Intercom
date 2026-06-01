# LTE Intercom MVP Verification Plan

## 목적

이 문서는 LTE Data망 기반 원거리 방송용 인터컴 MVP를 개발 중 반복 검증하기 위한 QA 계획이다. 검증 방식은 Zero Script QA를 기본으로 한다. 별도 자동화 테스트 스크립트를 먼저 만들지 않고, 실행 중인 서버의 API 응답, WebSocket 이벤트, 로그, Android 단말의 실제 동작, LTE 현장 품질을 직접 관찰해 MVP 품질을 판단한다.

## 담당 범위

- 서버 API/WebSocket smoke test 절차 정의
- 서버 로그 기반 상태 검증 절차 정의
- Android 인터컴 UI/오디오 수동 검증 항목 정의
- LTE 원거리 현장 테스트 체크리스트 정의
- 통합 테스트 PASS/FAIL 기준 정의

이 문서는 검증 계획만 다룬다. `server/`와 `android/` 구현 파일은 수정하지 않는다.

## 검증 환경

### 최소 장비

| 구분 | 필요 항목 |
| --- | --- |
| PC 서버 | Windows PC 1대, 서버 실행 가능 환경, 같은 LAN 또는 외부 접속 경로 |
| Android 단말 | Android 휴대폰 2대 이상 |
| 헤드셋 | 유선 3.5mm, USB-C 오디오, Bluetooth 헤드셋 중 최소 1종 |
| 네트워크 | Wi-Fi 1회선, LTE/5G Data망 1회선 이상 |
| 운영자 화면 | PC 서버 상태와 로그를 볼 수 있는 터미널 또는 로컬 웹 UI |

### 권장 장비

| 구분 | 필요 항목 |
| --- | --- |
| Android 단말 | Android 휴대폰 3-4대 |
| 헤드셋 | 유선, USB-C, Bluetooth 각각 1개 이상 |
| 네트워크 | 서로 다른 통신사 LTE/5G 회선 2개 이상 |
| 현장 장비 | 방송 현장 사용 거리와 유사한 이동 환경 |

## 공통 PASS 기준

MVP smoke test는 아래 조건을 만족하면 PASS로 판단한다.

| 항목 | PASS 기준 |
| --- | --- |
| 서버 시작 | 서버가 오류 없이 기동되고 health endpoint가 정상 응답한다. |
| 룸 관리 | 룸 생성, 목록 조회, 참가자 상태 조회가 가능하다. |
| WebSocket | 클라이언트 2개 이상이 접속하고 join/leave 상태가 broadcast된다. |
| Android 접속 | Android 단말이 룸 코드로 접속하고 참가자 목록에 표시된다. |
| 오디오 | 헤드셋 마이크 입력과 수신 오디오가 인터컴 채널 동작과 일치한다. |
| PTT | 누르는 동안만 talk가 켜지고 놓으면 꺼진다. |
| Talk latch | latch 상태가 UI와 서버 상태에 일치하게 유지된다. |
| Listen level | 채널별 수신 레벨 조정이 실제 청감 또는 meter에 반영된다. |
| 재연결 | LTE 끊김 후 복구 시 기존 룸으로 재접속하거나 명확한 재접속 상태를 표시한다. |
| 로그 | 정상 시나리오에서 unhandled error, crash, 무한 reconnect loop가 없다. |

## 서버 Zero Script QA

### 1. 서버 기동 확인

서버 개발자가 제공한 실행 방식으로 서버를 실행한다. Docker 기반이면 아래 방식으로 로그를 확인한다.

```powershell
docker compose up -d
docker compose logs -f --tail 100
```

로컬 실행 기반이면 서버 터미널에서 아래 정보를 확인한다.

| 확인 항목 | 기대 결과 |
| --- | --- |
| Listen address | HTTP/WebSocket 포트가 표시된다. |
| Room store | 초기화 성공 로그가 표시된다. |
| Media/WebRTC module | 사용 중인 media relay 또는 SFU 연결 상태가 표시된다. |
| Fatal error | 없어야 한다. |

### 2. Health smoke test

```powershell
curl.exe -i http://localhost:8080/health
```

기대 결과:

| 항목 | 기대값 |
| --- | --- |
| HTTP status | `200` |
| body | `ok`, `healthy`, 또는 서버 상태 JSON |
| 로그 | health 요청 로그가 남고 error 로그가 없어야 한다. |

서버 구현이 `/api/health`를 쓰는 경우:

```powershell
curl.exe -i http://localhost:8080/api/health
```

### 3. Room create/list smoke test

룸 생성 endpoint 예시는 아래 형식을 기준으로 검증한다. 실제 endpoint는 서버 구현 문서에 맞춘다.

```powershell
curl.exe -i -X POST http://localhost:8080/api/rooms `
  -H "Content-Type: application/json" `
  -d "{\"name\":\"PROD-A\",\"channels\":[\"PROGRAM\",\"DIRECTOR\",\"CAMERA\",\"IFB\"]}"
```

기대 결과:

| 항목 | 기대값 |
| --- | --- |
| HTTP status | `200` 또는 `201` |
| room id/code | 응답에 식별 가능한 room id 또는 room code가 포함된다. |
| channels | 요청한 채널명이 응답 또는 후속 조회에 반영된다. |
| 로그 | room created 이벤트가 남는다. |

룸 목록 조회:

```powershell
curl.exe -i http://localhost:8080/api/rooms
```

기대 결과:

| 항목 | 기대값 |
| --- | --- |
| HTTP status | `200` |
| rooms | 방금 생성한 `PROD-A` 룸이 포함된다. |
| participant count | 초기값이 `0` 또는 빈 참가자 목록으로 표시된다. |

### 4. WebSocket 접속 smoke test

WebSocket 검증은 별도 테스트 스크립트 작성 없이 CLI 또는 브라우저 콘솔로 수행한다. `websocat` 사용 가능 시:

```powershell
websocat ws://localhost:8080/ws
```

접속 직후 기대 결과:

| 항목 | 기대값 |
| --- | --- |
| 연결 | WebSocket handshake 성공 |
| 서버 로그 | client connected 로그 |
| 초기 이벤트 | 서버 정책에 따라 hello/state/snapshot 이벤트 수신 |

`websocat`이 없으면 `wscat`을 임시 실행 도구로 사용할 수 있다.

```powershell
npx wscat -c ws://localhost:8080/ws
```

### 5. Join/leave 검증

WebSocket 연결 후 참가 이벤트를 보낸다. 실제 메시지 스키마가 확정되면 아래 예시를 서버 스키마에 맞춘다.

```json
{"type":"join","roomCode":"PROD-A","displayName":"CAM-1","deviceType":"android"}
```

기대 결과:

| 확인 위치 | 기대 결과 |
| --- | --- |
| WebSocket 응답 | join ack 또는 room state 이벤트 수신 |
| 서버 로그 | `CAM-1 joined PROD-A`에 해당하는 이벤트 |
| room list API | `CAM-1` 참가자 또는 participant count `1` |
| 다른 WebSocket client | participant joined broadcast 수신 |

leave 이벤트:

```json
{"type":"leave","roomCode":"PROD-A"}
```

기대 결과:

| 확인 위치 | 기대 결과 |
| --- | --- |
| WebSocket 응답 | leave ack 또는 room state 이벤트 수신 |
| 서버 로그 | participant left 이벤트 |
| 다른 WebSocket client | participant left broadcast 수신 |
| room list API | 참가자 수 감소 |

### 6. 상태 broadcast 검증

서버는 Android 인터컴 상태를 다른 참가자와 PC 운영 화면에 broadcast해야 한다.

검증 이벤트 예시:

```json
{"type":"talk","roomCode":"PROD-A","channel":"DIRECTOR","active":true,"mode":"ptt"}
```

```json
{"type":"listen","roomCode":"PROD-A","channel":"DIRECTOR","active":true,"level":0.75}
```

기대 결과:

| 이벤트 | 기대 broadcast |
| --- | --- |
| talk on | 해당 참가자/채널의 talk lamp 상태가 on으로 전파된다. |
| talk off | talk lamp 상태가 off로 전파된다. |
| listen on/off | listen 상태가 운영 화면과 다른 client snapshot에 반영된다. |
| level change | level 값이 서버 상태에 저장되거나 broadcast된다. |
| disconnect | 연결 종료 후 offline 또는 leave 상태가 전파된다. |

### 7. 로그 검증

정상 smoke test 직후 최근 로그를 확인한다.

Docker 기반:

```powershell
docker compose logs --tail 200
```

로컬 실행 기반:

```powershell
Get-Content .\logs\server.log -Tail 200
```

확인 기준:

| 로그 패턴 | 판정 |
| --- | --- |
| `ERROR`, `Unhandled`, `panic`, `fatal` | 있으면 FAIL 후보 |
| 반복 reconnect | 10초 이상 계속되면 FAIL 후보 |
| join/leave 누락 | 이벤트 발생과 로그가 맞지 않으면 FAIL |
| room state 불일치 | API 조회와 WebSocket snapshot이 다르면 FAIL |
| media init 실패 | 음성 검증 전 BLOCKED |

## Android 수동 검증

### 1. 설치와 최초 실행

| 절차 | 기대 결과 |
| --- | --- |
| APK 설치 | 설치 오류 없음 |
| 앱 실행 | 서버 접속 화면 표시 |
| 서버 주소 입력 | 입력값 유지 |
| 룸 코드 입력 | 대문자/숫자 코드 입력 가능 |
| 표시 이름 입력 | 참가자명으로 서버에 표시 |

### 2. 마이크 권한

| 절차 | 기대 결과 |
| --- | --- |
| 최초 talk 시도 | Android 마이크 권한 요청 |
| 허용 선택 | talk 가능 상태 전환 |
| 거부 선택 | talk 비활성화와 권한 안내 상태 표시 |
| 설정에서 권한 재허용 | 앱 재시작 없이 또는 재시작 후 talk 가능 |

### 3. 헤드셋 라우팅

| 장치 | 확인 항목 |
| --- | --- |
| 유선 3.5mm | 마이크 입력이 헤드셋으로 들어오고 스피커폰으로 새지 않는다. |
| USB-C 오디오 | 연결/분리 시 route 상태가 갱신된다. |
| Bluetooth | SCO 또는 통화용 route가 적용되고 지연/음질이 기록된다. |
| 헤드셋 분리 | 앱이 speaker fallback 또는 mic unavailable 상태를 명확히 표시한다. |

PASS 기준:

- 헤드셋 연결 상태가 UI에 표시된다.
- talk 중 헤드셋 분리 시 crash가 없어야 한다.
- route 변경 후 5초 이내에 오디오가 복구되거나 사용자에게 실패 상태가 표시된다.

### 4. PTT

| 절차 | 기대 결과 |
| --- | --- |
| 채널 PTT 누름 | 누르는 동안 talk lamp on |
| PTT 놓음 | 300ms 이내 talk lamp off |
| 다른 단말 확인 | 같은 채널 수신자가 음성을 듣는다. |
| 빠른 반복 누름 | 상태가 꼬이지 않고 마지막 입력 상태와 일치 |

### 5. Talk latch

| 절차 | 기대 결과 |
| --- | --- |
| latch on | 버튼 또는 lamp가 latched 상태로 표시 |
| 화면 전환 | latch 상태 유지 |
| 앱 백그라운드 | foreground service 정책에 따라 talk 유지 또는 명확히 중지 |
| latch off | 송신 즉시 중지 |
| 서버 상태 확인 | talk latched 상태가 room state에 반영 |

### 6. Listen level

| 절차 | 기대 결과 |
| --- | --- |
| level 100% | 수신 음량 최대 |
| level 50% | 청감상 감소 또는 meter/volume 상태 반영 |
| level 0% | 해당 채널 mute와 동일하게 동작 |
| 채널별 level 변경 | 다른 채널 level에 영향을 주지 않는다. |

### 7. 재연결

| 시나리오 | 기대 결과 |
| --- | --- |
| LTE 일시 해제 5초 | reconnecting 표시 후 자동 복구 |
| LTE 해제 30초 | 상태 표시 유지, 복구 시 기존 룸 재join |
| 서버 재시작 | 연결 끊김 표시 후 서버 복구 시 재접속 |
| IP 변경 | 자동 복구 실패 시 명확한 재접속/주소 확인 상태 표시 |
| 앱 백그라운드 후 복귀 | 오디오와 WebSocket 상태가 실제 상태와 일치 |

## LTE 현장 테스트 체크리스트

### 1. 네트워크 측정

각 테스트는 같은 room에서 Android 2대 이상, 가능하면 서로 다른 LTE 회선으로 수행한다.

| 항목 | 측정 방법 | 기록값 |
| --- | --- | --- |
| RTT | 앱 표시값, 서버 ping, WebRTC stats 중 사용 가능한 값 | 평균/최대 ms |
| Packet loss | WebRTC stats 또는 서버 media stats | 평균/최대 % |
| Jitter | WebRTC stats | 평균/최대 ms |
| Reconnect 횟수 | 앱/서버 로그 | 회/10분 |
| Audio dropout | 사람이 들은 끊김 횟수 | 회/10분 |
| Battery drain | 30분 사용 전후 배터리 | % |

### 2. LTE 품질 판정 기준

| 품질 | 기준 |
| --- | --- |
| Good | RTT 120ms 이하, packet loss 2% 이하, jitter 30ms 이하 |
| Usable | RTT 250ms 이하, packet loss 5% 이하, jitter 60ms 이하 |
| Risk | RTT 250ms 초과, packet loss 5% 초과, jitter 60ms 초과 |
| Fail | 음성 문장 이해가 어렵거나 10분 내 재연결 3회 이상 |

방송 인터컴 MVP는 `Usable` 이상을 목표로 한다. `Risk` 구간에서는 UI에 약한 네트워크 상태를 표시해야 한다.

### 3. 끊김/복구 테스트

| 절차 | 기대 결과 |
| --- | --- |
| Android 단말에서 비행기 모드 5초 후 해제 | reconnecting 표시 후 자동 복구 |
| 지하/엘리베이터 등 약전계 이동 | 끊김 발생 시 talk/listen 상태가 잘못 고정되지 않는다. |
| LTE와 Wi-Fi 전환 | WebSocket/WebRTC가 재협상되거나 명확한 재접속 상태 표시 |
| 서버 네트워크 케이블 분리/복구 | 모든 client가 disconnect/reconnect 상태를 일관되게 표시 |

### 4. TURN 필요 여부 판단

아래 중 하나라도 반복되면 TURN 또는 클라우드 relay 필요로 기록한다.

| 증상 | 판단 |
| --- | --- |
| signaling은 연결되지만 음성이 연결되지 않음 | ICE/NAT 문제 가능성 높음 |
| 같은 LAN에서는 성공, LTE 외부망에서는 실패 | TURN 또는 포트포워딩 필요 가능성 |
| 특정 통신사 LTE에서만 media 실패 | NAT 정책 차이로 TURN 필요 가능성 |
| WebRTC stats에서 relay candidate만 성공 | TURN 운영 필요 |
| 공인 IP/포트포워딩 없이 현장 접속 요구 | TURN/VPN/클라우드 relay 중 하나 필요 |

## 통합 테스트 시나리오

### Scenario A: 로컬 smoke

| 단계 | 절차 | 기대 결과 |
| --- | --- | --- |
| 1 | PC 서버 실행 | health PASS |
| 2 | PROD-A 룸 생성 | room list에 표시 |
| 3 | WebSocket client 2개 접속 | connected log 2개 |
| 4 | CAM-1, PD join | 참가자 2명 broadcast |
| 5 | CAM-1 talk on/off | PD client에 상태 broadcast |
| 6 | leave | 참가자 수 감소 |

### Scenario B: Android 2대 LAN

| 단계 | 절차 | 기대 결과 |
| --- | --- | --- |
| 1 | Android 2대 같은 Wi-Fi 접속 | room join 성공 |
| 2 | CAM-1 PTT | PD가 음성 수신 |
| 3 | PD latch talk | CAM-1이 음성 수신 |
| 4 | listen level 조정 | 채널별 수신 레벨 변화 |
| 5 | 헤드셋 분리/재연결 | route 상태 갱신, crash 없음 |

### Scenario C: Android LTE 원거리

| 단계 | 절차 | 기대 결과 |
| --- | --- | --- |
| 1 | Android 1대 Wi-Fi, 1대 LTE | 양쪽 room join 성공 |
| 2 | 서로 PTT 교대 | 양방향 음성 수신 |
| 3 | 10분 유지 | reconnect 2회 이하, 음성 이해 가능 |
| 4 | LTE 끊김/복구 | 자동 재연결 또는 명확한 실패 표시 |
| 5 | 서버 로그 확인 | crash, unhandled error 없음 |

## 결함 기록 형식

결함은 아래 형식으로 기록한다.

```markdown
## QA-YYYYMMDD-001

- Severity: Critical / High / Medium / Low
- Area: Server API / WebSocket / Android Audio / Android UI / LTE Network
- Environment: PC, Android model, OS version, network
- Steps:
- Expected:
- Actual:
- Logs:
- Reproducibility:
- Decision: Fix before MVP / Accept for MVP / Needs investigation
```

## 릴리스 후보 판단

MVP 릴리스 후보는 아래 조건을 모두 만족해야 한다.

- Scenario A, B가 모두 PASS
- Scenario C가 최소 1개 LTE 회선에서 PASS
- Critical/High 결함 0개
- Android talk/listen 상태와 서버 room state 불일치 0건
- 10분 LTE 통화 중 앱 crash 0건
- TURN 필요 여부가 기록되어 있고, 필요 시 우회 방식이 결정되어 있음
