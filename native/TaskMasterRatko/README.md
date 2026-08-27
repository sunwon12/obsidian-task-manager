# TaskMaster Ratko

Obsidian/Electron과 별도 프로세스로 실행되는 macOS 메뉴바 앱이다. SwiftUI가
`TaskMaster/Tasks/*.md`와 `TaskMaster/.timers.json`을 직접 읽고 쓴다.

## 소유권

- Swift 랏코: 메뉴바·빠른 패널·타이머·단계 시간·메모·Task 파일 상태 변경
- Obsidian 플러그인: Kanban 보드·Jira·미팅·프로젝트·AI 기능
- 공유 정본: Markdown Task 파일. 타이머 정본은 Swift 랏코만 쓴다.

플러그인이 열려 있으면 vault 파일 변경 이벤트로 Swift 앱의 수정을 즉시 반영한다.
플러그인이 닫혀 있어도 랏코는 독립적으로 동작한다.

## 빌드와 설치

```bash
swift test --package-path native/TaskMasterRatko
scripts/install-ratko.sh /absolute/path/to/vault
```

설치 스크립트는 `~/Applications/TaskMasterRatko.app`과 로그인 LaunchAgent를 만든다.
