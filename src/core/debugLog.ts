// Obsidian 개발자 콘솔을 열어두지 않아도 백그라운드 AI 프로세스의 실행 경계를
// 사후에 확인할 수 있게 최소 진단 로그를 남긴다.
const LOG_PATH = "/tmp/taskmaster-plugin.log";

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
