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

## 빌드와 설치

```bash
swift test --package-path native/TaskMasterRatko
scripts/install-ratko.sh /absolute/path/to/vault
```

설치 스크립트는 실행 중인 이전 앱을 종료한 뒤 `~/Applications/TaskMasterRatko.app`을
교체하고 로그인 LaunchAgent를 만든 다음 새 바이너리를 실행한다.
