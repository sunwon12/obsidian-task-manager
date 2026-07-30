import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "../../../src/ui/hooks/useIsMobile";

describe("useIsMobile", () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;

  beforeEach(() => {
    listeners = [];
    vi.stubGlobal("matchMedia", (query: string) => {
      const matches = window.innerWidth < 768;
      return {
        matches,
        media: query,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.push(l),
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    });
  });

  it("returns true when viewport is narrow", () => {
    Object.defineProperty(window, "innerWidth", { value: 500, writable: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when viewport is wide", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates when matchMedia change fires", () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => {
      listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });
});
