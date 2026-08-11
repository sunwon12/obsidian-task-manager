import { describe, expect, it } from "vitest";
import * as React from "react";
import { fireEvent, render } from "@testing-library/react";
import { __setLocaleForTest } from "../../../src/i18n";
import {
  normalizePlanSteps,
  WorkPlanEditor,
} from "../../../src/ui/kanban/WorkPlanEditor";

const Harness: React.FC<{ initial?: string[] }> = ({ initial = [""] }) => {
  const [steps, setSteps] = React.useState(initial);
  return <WorkPlanEditor steps={steps} onChange={setSteps} />;
};

describe("WorkPlanEditor", () => {
  it("작업 단계를 1단계, 2단계 개별 입력으로 추가한다", () => {
    __setLocaleForTest("ko");
    const ui = render(<Harness />);

    fireEvent.change(ui.getByLabelText("1단계"), { target: { value: "서버 프롬프트" } });
    fireEvent.click(ui.getByRole("button", { name: "+ 단계 추가" }));
    fireEvent.change(ui.getByLabelText("2단계"), { target: { value: "QA 검증" } });

    expect((ui.getByLabelText("1단계") as HTMLInputElement).value).toBe("서버 프롬프트");
    expect((ui.getByLabelText("2단계") as HTMLInputElement).value).toBe("QA 검증");
  });

  it("중간 단계를 삭제하면 뒤 단계 번호를 앞당겨 다시 붙인다", () => {
    __setLocaleForTest("ko");
    const ui = render(<Harness initial={["하나", "둘", "셋"]} />);
    fireEvent.click(ui.getByRole("button", { name: "2단계 삭제" }));

    expect((ui.getByLabelText("2단계") as HTMLInputElement).value).toBe("셋");
    expect(ui.queryByLabelText("3단계")).toBeNull();
  });

  it("저장 전 빈 행과 앞뒤 공백을 제거한다", () => {
    expect(normalizePlanSteps([" 하나 ", "", "  ", "둘"])).toEqual(["하나", "둘"]);
  });
});
