// Vitest 전역 setup. jsdom 환경 보강.
import { afterEach, vi } from "vitest";

// Obsidian sample plugin들과 동일하게 fake timer 사용 안 함 (debounce 테스트 시 명시적으로 사용).
afterEach(() => {
  vi.useRealTimers();
});
