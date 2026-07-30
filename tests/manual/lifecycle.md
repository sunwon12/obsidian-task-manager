# Lifecycle & External Modify Manual QA

PRD §12.2 정량 품질 지표 + §7.4 §7.1 시나리오를 수동 검증.
T-702, T-703, T-704, T-705 통합 checklist.

## 환경

- Obsidian 1.5+ desktop
- 빈 vault에서 시작 (또는 기존 vault에 별도 TaskMaster 폴더)

## T-702: View open/close 50회 — 메모리 stable

목표: React root와 EventBus listener가 누적되지 않음.

1. Obsidian 켜고 이 plugin 활성화.
2. Chrome DevTools 열기 (Cmd+Option+I).
3. Memory 탭 → Heap snapshot 1회 캡처 (baseline).
4. Performance 탭 → Memory 체크박스 활성.
5. 다음 동작 50회 반복:
   - ribbon icon 클릭 → view 열림
   - view 탭 닫기 (X 버튼)
6. Memory 탭 → 다시 Heap snapshot.

검증:
- [ ] Detached HTMLDivElement 수가 5개 이하 (background tasks의 GC 지연 허용).
- [ ] Performance Memory 그래프가 우상향 직선이 아니어야 함 (안정 또는 톱니).
- [ ] 50회 후 console에 React unmount warning 없음.

## T-703: 외부 modify 반영

목표: PRD §7.4. 250ms 이내 UI 반영.

1. 보드 view 열고 카드 1개 만들기 (status: todo).
2. Obsidian editor에서 같은 task의 Markdown 파일 열기.
3. frontmatter `status: todo`를 `status: doing`으로 수정 → Cmd+S.
4. 보드 view 탭으로 돌아가기.

검증:
- [ ] 카드가 자동으로 doing 컬럼으로 이동 (수동 reload 불필요).
- [ ] 시각적으로 250ms 이내 (사용자가 잠깐 잠시 기다리는 정도면 fail).
- [ ] frontmatter에 사용자가 직접 추가한 `tags: [foo]`도 그대로 남음.

추가:
- [ ] 외부 텍스트 에디터(VS Code 등)로 수정 → Obsidian metadataCache가 갱신되면 보드 반영.
- [ ] 파일 직접 삭제 → 카드 사라짐.
- [ ] 파일 rename (Obsidian 안에서 F2) → 카드 그대로 유지 (id 매칭).

## T-704: 두 leaf 동시 view

목표: PRD §7.1. 두 view가 같은 store 공유.

1. 첫 번째 view 열기.
2. 탭을 split (오른쪽 클릭 → "Split right").
3. 같은 view를 한 번 더 열기 (ribbon 클릭).

검증:
- [ ] 두 view에 같은 카드 표시.
- [ ] 한 쪽에서 카드 끌어 옮기기 → 다른 쪽도 즉시 반영.
- [ ] 한 쪽에서 + 새 할 일 → 다른 쪽에도 즉시 등장.
- [ ] 두 view 모두 닫기 → onClose 정상 (DevTools 콘솔에 error 없음).
- [ ] 다시 ribbon 클릭 시 새 view가 정상 mount.

## T-705: .board.json 삭제 후 reload

목표: PRD §12.2 결정적 재구성.

1. 카드 5개 만들고 같은 column 안에서 순서 바꾸기.
2. 약 1초 대기 (debounce 통과).
3. Vault → `TaskMaster/.board.json` 파일을 file explorer에서 삭제.
4. Obsidian 명령 palette → "Reload app without saving".

검증:
- [ ] 30초 이내 보드 재구성.
- [ ] 카드들이 전부 등장.
- [ ] 정렬 순서: status별 + updatedAt 내림차순 + 파일명 사전순 (PRD §9.4).
- [ ] `.board.json`이 자동 재생성.

## 결과 기록

| 일자 | 검증자 | T-702 | T-703 | T-704 | T-705 |
| --- | --- | --- | --- | --- | --- |
| _YYYY-MM-DD_ | _name_ | _pass/fail_ | _pass/fail_ | _pass/fail_ | _pass/fail_ |
