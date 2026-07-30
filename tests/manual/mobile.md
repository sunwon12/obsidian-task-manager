# Mobile Manual QA

PRD §10.5, ADR-0009 모바일 정책 검증.

## 환경

- iOS Obsidian 1.5+ (iPhone 또는 iPad)
- Android Obsidian 1.5+ (Android 9+)
- 같은 vault를 데스크톱에서 작업한 뒤 sync로 모바일에서 열기 권장 (실제 사용 패턴)

## Setup

1. 데스크톱에서 카드 5~10개 만들기 (다양한 status, project).
2. iCloud Drive 또는 Obsidian Sync로 vault 동기화.
3. 모바일 Obsidian에서 같은 vault 열기.
4. plugin 활성화.

## 1. 진입과 레이아웃

- [ ] ribbon 또는 left sidebar에서 TaskMaster 아이콘 보임.
- [ ] 클릭 시 view 열림.
- [ ] **dnd-kit이 발동되지 않음** (카드를 끌어도 옮겨지지 않음 — ADR-0009 의도된 동작).
- [ ] Status visibility chip bar와 status tab이 상단에 서로 구분되어 보임.
- [ ] Status tab (HOLD / TODO / DOING / IN REVIEW / DONE)이 상단에 보임.
- [ ] 활성 tab이 시각적으로 명확 (accent color border).

## 2. Status visibility chips

- [ ] rounded-full chip으로 HOLD / TODO / DOING / IN REVIEW / DONE 표시 여부를 켜고 끌 수 있음.
- [ ] chip을 끄면 해당 status tab과 카드 목록이 세로 막대/placeholder 없이 사라짐.
- [ ] chip을 다시 켜면 원래 status order 위치에 tab이 돌아옴.
- [ ] 현재 active tab을 숨기면 status order상 다음 visible status tab으로 이동.
- [ ] 마지막 남은 visible status는 꺼지지 않음.

## 3. Status tab 전환

- [ ] 각 tab 클릭 → 해당 status 카드만 표시.
- [ ] 카드 수가 tab 라벨에 표시 (예: "Todo (3)").
- [ ] tab 전환이 즉각적 (< 100ms 체감).

## 4. 액션 버튼

- [ ] 카드 우측에 → 화살표 버튼 (다음 status가 있을 때).
- [ ] → 클릭 → status 변경 + 카드가 현재 tab에서 사라짐.
- [ ] 마지막 status (done)에서는 → 버튼 없음.
- [ ] 첫 status (todo)에서 ← 버튼 없음, 다른 status에는 있음.
- [ ] aria-label 정상 (VoiceOver/TalkBack로 "Move to next status (doing)" 정도로 read).

## 5. 더 보기 메뉴 (⋮)

- [ ] ⋮ 버튼 탭 → "Archive", "Delete" 메뉴 등장.
- [ ] Archive 클릭 → 카드 사라짐, 파일이 `TaskMaster/Archive/`로 이동.
- [ ] Delete 클릭 → confirm dialog 표시 (settings.confirmOnDelete=true 기준).
- [ ] confirm 후 카드 + 파일 모두 삭제.
- [ ] outside tap으로 메뉴 닫기.

## 6. 카드 클릭 → Markdown 열기

- [ ] 카드 본문 영역 (제목/priority badge) 탭 → 해당 Markdown note가 새 탭으로 열림.
- [ ] 본문 편집 후 보드 view로 돌아오면 frontmatter status 변경 시 카드 자동 이동.

## 7. + 새 할 일

- [ ] 헤더의 + 새 할 일 버튼 탭 → modal 등장.
- [ ] 키보드(soft keyboard)가 input 위로 올라옴.
- [ ] 제목 입력 + 만들기 → 카드 등장.
- [ ] modal 바깥 탭으로 닫기.

## 8. Project quick memo

- [ ] 특정 project 선택 시 project context header가 보임.
- [ ] quick memo textarea를 탭해도 soft keyboard가 composer를 가리지 않음.
- [ ] memo 입력 후 저장 버튼이 status tabs 또는 board content와 겹치지 않음.
- [ ] 저장 후 composer가 비워지고 preview가 갱신됨.
- [ ] preview의 Create task / Promote note / Copy link 버튼이 한 줄에 못 들어가면 자연스럽게 다음 줄로 감김.

## 9. 메모리 안정성

- [ ] view 5회 open/close → Obsidian이 죽지 않음.
- [ ] iOS의 경우 background로 갔다가 돌아와도 정상.
- [ ] vault sync 도중에도 plugin이 깨지지 않음.

## 10. Dark / Light theme

- [ ] Settings → Appearance에서 테마 전환 → 카드 색상 함께 적응.
- [ ] modal overlay가 두 테마 모두에서 인지 가능.

## 결과 기록

| 일자 | 검증자 | OS / Obsidian 버전 | 통과 / 실패 항목 |
| --- | --- | --- | --- |
| _YYYY-MM-DD_ | _name_ | _e.g., iOS 17.4 / Obsidian 1.5.11_ | _all pass / 4.2 fail (..)_ |
