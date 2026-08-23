# ADR-0006: Tailwind v3 + `tm-` prefix + scoped CSS

## Date

2026-05-10

## Context

Obsidian 플러그인은 host 앱의 DOM 안에 mount된다. CSS가 leak되면 다음 문제가 생긴다.

- Obsidian 전역 UI(setting tab, command palette, file explorer)의 스타일이 깨짐.
- 다른 플러그인의 UI를 망가뜨림.
- Obsidian 다크/라이트 테마 전환 시 우리 plugin만 동작 안 함.

기존 React 앱은 Tailwind CSS를 사용한다. Tailwind는 utility class를 광범위하게 만들어내고, 기본 설정으로는 `* { box-sizing: border-box }` 같은 reset(preflight)을 전역에 적용한다. 그대로 들고 오면 host CSS와 충돌이 보장되어 있다.

추가로 Tailwind v4는 prefix/preflight API가 변동 중이라 명세 안정성이 떨어진다.

## Decision

**Tailwind v3에 `tm-` prefix와 preflight 비활성화를 적용하고, 모든 CSS는 `.taskmaster-root` 하위로 scope한다.**

```js
// tailwind.config.js
module.exports = {
  prefix: "tm-",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        // Obsidian theme variable 매핑 (다크/라이트 자동 따라감)
        "tm-bg": "var(--background-primary)",
        "tm-text": "var(--text-normal)",
        "tm-accent": "var(--interactive-accent)",
      },
    },
  },
};
```

- 모든 React UI는 `.taskmaster-root` div 안에 mount.
- 색상은 가능한 한 Obsidian CSS variable을 사용 (다크/라이트 자동 적응).
- Tailwind 버전은 `^3`으로 핀.

## Alternatives Considered

| 옵션 | 장점 | 단점 | 탈락 사유 |
| --- | --- | --- | --- |
| A. Tailwind v4 | 최신 버전 | prefix와 preflight API가 변경 중 | Obsidian 환경에서의 검증 사례가 부족해 안정성이 떨어진다 |
| B. Tailwind 없이 CSS Modules 또는 vanilla CSS | 의존성 0. 충돌 가능성 낮음 | 기존 React 앱이 Tailwind 기반이라 재작성 비용이 큼 | utility class의 개발 속도 이점을 포기하게 된다 |
| C. Tailwind preflight 유지 + iframe 격리 | 완전한 격리 | Obsidian View 안의 iframe은 ItemView API와 마찰 | event·keyboard handler가 부자연스러워진다 |
| D. Tailwind + prefix 없이 그냥 사용 | 마크업이 깔끔 | `flex`·`block`·`hidden`은 모든 CSS에 흔한 이름 | utility class 충돌 가능성이 매우 높다 |

## Consequences

- **긍정적**: Obsidian 전역 CSS와 충돌하지 않는다. CSS variable 매핑 덕에 다크/라이트 테마 전환이 자동으로 반영된다. 기존 React 앱의 Tailwind 코드를 재사용할 수 있다.
- **부정적**: 마크업이 약간 verbose하다(`tm-flex tm-gap-2`). preflight 없이는 일부 유틸리티가 의도와 다르게 동작할 수 있다(`button` 기본 background 등).
- **리스크**: v4가 안정화되면 마이그레이션이 필요하다. 완화 — `tm-` prefix는 IDE auto-complete로 충분히 빠르게 입력하고, preflight이 필요한 element는 명시적으로 reset class(`tm-bg-transparent tm-border-0`)를 적용한다. v4 마이그레이션은 별도 ADR로 검토한다(Phase 4 이후 후보).
- **검증**: Obsidian sample vault에 plugin 설치 후 기본 setting tab과 file explorer 스타일이 변하지 않는지 확인. 다크 → 라이트 테마 전환 시 보드 색상이 함께 변하는지 확인. 다른 인기 plugin(Calendar, Tasks)을 함께 활성화한 환경에서 충돌 없는지 수동 QA.

## References

- 관련 문서: PRD §8.6, §13.4, PLAN §2, §8
