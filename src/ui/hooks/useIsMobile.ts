// LLD §15 Open Question: viewport vs Platform.isMobile.
// 결정: viewport width 기준. 768px 미만이면 mobile.
// Platform.isMobile은 desktop의 좁은 창에서도 mobile 판단하지 않으므로 UX가 어색해진다.

import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent): void => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    setIsMobile(mql.matches);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, []);

  return isMobile;
}
