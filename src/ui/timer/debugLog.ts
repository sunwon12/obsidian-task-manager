// 메뉴바 Tray와 팝오버는 Obsidian 창 밖에서 살기 때문에, 개발자 콘솔을 열어두지 않으면
// 실패가 아무 데도 안 남는다. 창 생성·표시·정리만 파일 한 줄로 남겨 사후에 짚을 수 있게 한다.
const LOG_PATH = "/tmp/taskmaster-popover.log";

export function debugLog(line: string): void {
  try {
    const req = (window as Window & { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return;
    const fs = req("fs") as { appendFileSync(path: string, data: string): void };
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // 진단 로그 실패는 기능에 영향을 주지 않는다.
  }
}
