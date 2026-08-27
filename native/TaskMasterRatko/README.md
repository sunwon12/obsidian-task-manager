# TaskMaster Ratko

Obsidian/Electron과 별도 프로세스로 실행되는 macOS 메뉴바 앱이다. SwiftUI가
`TaskMaster/Tasks/*.md`와 `TaskMaster/.timers.json`을 직접 읽고 쓴다.

## 소유권

- Swift 랏코: 메뉴바·빠른 패널·타이머·단계 시간·메모·Task 파일 상태 변경
- Obsidian 플러그인: Kanban 보드·Jira·미팅·프로젝트·AI 기능
- 공유 정본: Markdown Task 파일. 타이머 정본은 Swift 랏코만 쓴다.

플러그인이 열려 있으면 vault 파일 변경 이벤트로 Swift 앱의 수정을 즉시 반영한다.
플러그인이 닫혀 있어도 랏코는 독립적으로 동작한다.

앱을 시작할 때마다 macOS가 저장한 Wi-Fi 상태 아이템 위치를 읽고 랏코의
`NSStatusItem Preferred Position Item-0`을 바로 왼쪽 값으로 다시 기록한다. 따라서
다른 메뉴바 앱이 많아져도 랏코는 Wi-Fi 옆의 항상 보이는 영역을 우선한다.
메뉴바·패널 헤더·포커스 창은 기존 Electron 버전에서 사용하던 `src/assets`의 랏코
PNG를 앱 번들에 복사해 그대로 사용하며, 일반 수달 이모지로 대체하지 않는다.
메뉴바 자산은 14pt로 그린다. 랏코는 사각형을 꽉 채운 컬러 이미지라 18pt에서도
선형 아이콘인 Wi-Fi보다 크게 보여, 픽셀 크기보다 체감 크기를 맞추는 값을 쓴다.

패널의 AI 피드백은 기존 `02_일상/03_성찰/일일-일정-피드백.md` 최신 섹션을 읽는다.
접힌 상태에는 오늘의 하이라이트, 펼친 상태에는 스냅샷·불릿 전체를 보여준다.
`피드백 받기`는 기존 `/daily-schedule-feedback` 스킬을 같은 vault에서 실행한다. 08:40
자동 실행은 Obsidian 플러그인이 계속 소유하고 Swift는 수동 실행만 제공해 중복을 막는다.

집중 카드의 기존 단계 문구나 연필 아이콘을 누르면 그 자리에서 수정한다. Enter 또는
체크로 저장하고 ×로 취소한다. 문구만 바꾸므로 현재 단계와 단계별 누적 시간은 보존된다.

## 빌드와 설치

```bash
swift test --package-path native/TaskMasterRatko
scripts/install-ratko.sh /absolute/path/to/vault
```

설치 스크립트는 실행 중인 이전 앱을 종료한 뒤 `~/Applications/TaskMasterRatko.app`을
교체하고 로그인 LaunchAgent를 만든 다음 새 바이너리를 실행한다. 설치 시 만든
`config.json`에서 피드백 노트 경로·Claude 실행 파일·프롬프트·제한 시간을 바꿀 수 있다.
