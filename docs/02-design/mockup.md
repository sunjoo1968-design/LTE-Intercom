# 방송용 인터컴 UI Mockup

## 참조 기준

Clear-Com Agent-IC는 모바일 장치에서 전통적인 인터컴 키패널 경험을 제공하는 방향이다. 특히 큰 Talk/Listen 버튼, swipe-to-latch, 키별 listen level, 오디오 meter, tally 상태 표시, 23-24개 keyset 구조가 핵심 참고 요소다.

우리 앱은 이 사용성을 참고하되, 고유한 시각 스타일과 단순한 MVP 구성을 사용한다.

참조:

- https://www.clearcom.com/Products/Products-by-Name/Agent-IC
- https://www.clearcom.com/Product/agent-ic-mobile-app-for-lq-series?id=14164

## 디자인 원칙

- 첫 화면은 방송용 인터컴 패널이어야 한다.
- 사용자가 장갑을 끼거나 급하게 조작해도 Talk/Mute를 실수 없이 눌러야 한다.
- Talk, Listen, Call, 연결 상태는 색과 meter로 즉시 구분되어야 한다.
- 어두운 현장에서도 눈부심이 적은 dark console UI를 기본으로 한다.
- 버튼 텍스트보다 상태 lamp, meter, 큰 라벨, 고정 위치가 우선이다.
- 긴 채널명은 2줄 이하로 줄이고, 약칭을 별도로 지원한다.

## Android: 서버 접속 화면

```
+------------------------------------------------+
| LTE INTERCOM                         [settings]|
+------------------------------------------------+
|                                                |
| Server                                         |
| [ 192.168.0.10:8443                         ] |
|                                                |
| Room Code                                      |
| [ PROD-A                                      ]|
|                                                |
| Display Name                                   |
| [ CAM-1                                       ]|
|                                                |
| Headset     [wired connected]                  |
| Network     [LTE good]                         |
|                                                |
| [              CONNECT              ]          |
|                                                |
| Recent                                         |
|  PROD-A / CAM-1 / 192.168.0.10                 |
+------------------------------------------------+
```

## Android: 인터컴 패널 화면

```
+------------------------------------------------+
| PROD-A       CAM-1          LTE 42ms    [gear] |
| IN  ▂▃▅▆    OUT ▃▅▅▂       HEADSET OK          |
+------------------------------------------------+
| [MASTER MUTE]       [RECONNECTING hidden]      |
+------------------------------------------------+
| CH 01 PROGRAM                                  |
| [ LISTEN ON ]  level [-----o---]  meter ▂▃▆▇  |
| [        HOLD TO TALK        ]  [CALL]         |
+------------------------------------------------+
| CH 02 DIRECTOR                                 |
| [ LISTEN ON ]  level [------o--]  meter ▂▅▆   |
| [        HOLD TO TALK        ]  [CALL]         |
+------------------------------------------------+
| CH 03 CAMERA                                   |
| [ LISTEN OFF]  level [---o-----]  meter        |
| [        HOLD TO TALK        ]  [CALL]         |
+------------------------------------------------+
| [Reply: PD calling...]                         |
+------------------------------------------------+
```

### 채널 키 상태

| 상태 | 표시 |
| --- | --- |
| Listen on | 녹색 listen lamp, level slider 활성 |
| Talk momentary | 빨간 talk lamp, 누르는 동안 송신 |
| Talk latched | 빨간 talk lamp 고정, 버튼에 LATCHED 표시 |
| Incoming call | 노란 call lamp 점멸, reply bar 표시 |
| Audio present | meter 활성 |
| Disconnected | 회색 비활성, "offline" 표시 |

## Android: 가로 화면 키패널

```
+--------------------------------------------------------------------------------+
| PROD-A  CAM-1    IN ▂▃▆ OUT ▂▅▃    LTE 42ms    HEADSET OK        [MASTER MUTE] |
+--------------------------------------------------------------------------------+
| CH01 PROGRAM       | CH02 DIRECTOR      | CH03 CAMERA        | CH04 IFB         |
| meter ▂▅▇          | meter ▂▃▆          | meter              | meter ▂▂         |
| [LISTEN] [CALL]    | [LISTEN] [CALL]    | [LISTEN] [CALL]    | [LISTEN] [CALL]  |
| [   TALK / PTT   ] | [   TALK / PTT   ] | [   TALK / PTT   ] | [   TALK / PTT ] |
+--------------------------------------------------------------------------------+
| CH05 STAGE         | CH06 AUDIO         | CH07 LIGHT         | CH08 SPARE       |
| ...                | ...                | ...                | ...              |
+--------------------------------------------------------------------------------+
```

## PC: 서버 대시보드

```
+--------------------------------------------------------------------------------+
| LTE Intercom Server                                      [Start] [Stop] [Logs] |
+--------------------------------------------------------------------------------+
| Status: RUNNING      Local: 192.168.0.10:8443      Public: not configured      |
| Rooms: 2             Users: 7                      Media: SFU connected        |
+--------------------------------------------------------------------------------+
| Rooms                                                                          |
| PROD-A   code PROD-A   users 5   channels 8   [open] [qr] [delete]             |
| TEST     code 4921     users 2   channels 4   [open] [qr] [delete]             |
+--------------------------------------------------------------------------------+
| Recent Events                                                                  |
| 14:12 CAM-1 connected over LTE                                                 |
| 14:13 PD talk latched on DIRECTOR                                              |
| 14:14 CAM-2 packet loss 8%                                                     |
+--------------------------------------------------------------------------------+
```

## PC: 룸 운영 화면

```
+--------------------------------------------------------------------------------+
| Room PROD-A                                      [QR] [Invite] [Settings]      |
+--------------------------------------------------------------------------------+
| Participants                         | Channel Matrix                          |
| CAM-1  online  talking  rtt 42ms     |            PGM  DIR  CAM  IFB          |
| PD     online  listening rtt 18ms    | CAM-1 Talk  -    on   on   -           |
| TD     online  muted     rtt 20ms    | PD    Talk  on   on   on   on          |
| CAM-2  weak    loss 8%   rtt 140ms   | TD    Listen on   on   on   off        |
| [mute] [kick] [remote mic kill]      |                                         |
+--------------------------------------------------------------------------------+
| Live Meters                                                                     |
| PGM ▂▃▅▆  DIR ▂▂▇  CAM ▃▅▅  IFB ▂                                             |
+--------------------------------------------------------------------------------+
```

## 반응형 기준

| 대상 | 폭 | 구성 |
| --- | --- | --- |
| Android 세로 | 360-480px | 채널 카드 1열, 큰 PTT |
| Android 가로 | 640px 이상 | 4열 키패널 |
| Tablet | 800px 이상 | 4-6열 키패널, 우측 상태 panel |
| PC | 1280px 이상 | 대시보드 + 룸/참가자/매트릭스 동시 표시 |

## MVP 우선순위

1. Android 세로 인터컴 패널
2. PC 서버 대시보드
3. 룸 운영 화면
4. Android 가로 키패널
5. 채널 매트릭스 편집
