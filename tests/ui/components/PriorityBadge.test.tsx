import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PriorityBadge } from "../../../src/ui/components/PriorityBadge";

describe("PriorityBadge", () => {
  it("renders nothing when priority is null", () => {
    const { container } = render(<PriorityBadge priority={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders label text + aria-label for each priority", () => {
    for (const p of ["low", "medium", "high"] as const) {
      const { getByLabelText } = render(<PriorityBadge priority={p} />);
      const label = `Priority ${p[0]!.toUpperCase()}${p.slice(1)}`;
      expect(getByLabelText(label).textContent).toMatch(new RegExp(p, "i"));
    }
  });
});
