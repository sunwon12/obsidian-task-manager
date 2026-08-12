// T-901 (task_01KZN31H): DOING 타이머 알림 배너 — UI 레이어.
//
// 맥북 슬랙 알림창 스타일: 화면 우상단에 직사각형 배너가 태스크별로 하나씩 스택(최신이 위),
// 오른쪽 스와이프로 닫기, 스타트/정지(일시정지)/스탑 버튼.
// 스펙: tests/ui/timer/TimerNotificationStack.test.tsx (U1~U10).
//
// - mountTimerOverlay는 ItemView와 무관하게 document.body에 컨테이너를 붙인다.
//   TaskMaster 뷰가 닫혀 있어도 배너가 보여야 하므로 main.ts onload에서 호출하고,
//   반환된 dispose를 onunload에서 호출한다.
// - 시간 계산은 서비스가 wall-clock으로 하고, 여기의 interval은 표시 갱신용일 뿐이다.
// - 스와이프는 pointer 이벤트 기반. 오른쪽으로 SWIPE_DISMISS_THRESHOLD_PX 이상 밀면
//   service.dismiss(). 왼쪽은 무시(맥 알림과 동일). setPointerCapture는 jsdom에 없을 수
//   있어 가드한다.

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Pause, Pin, PinOff, Play, Square } from "lucide-react";
import { t } from "../../i18n";
import {
  SWIPE_DISMISS_THRESHOLD_PX,
  TIMER_TICK_MS,
  formatElapsed,
  type TaskTimerService,
  type TaskTimerSnapshot,
} from "../../services/TaskTimerService";
import type { TimerFloatingController } from "./TimerFloatingWindow";

export interface TimerNotificationStackProps {
  service: TaskTimerService;
  floatingWindow?: TimerFloatingController | undefined;
}

export const TimerNotificationStack: React.FC<TimerNotificationStackProps> = ({
  service,
  floatingWindow,
}) => {
  const [, force] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => service.subscribe(force), [service]);
  React.useEffect(
    () => floatingWindow?.subscribe(force),
    [floatingWindow],
  );

  // running 배너가 보이는 동안만 초 단위 표시 갱신.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (service.getTimers().some((timer) => timer.phase === "running" && !timer.dismissed)) {
        force();
      }
    }, TIMER_TICK_MS);
    return () => window.clearInterval(id);
  }, [service]);

  const timers = service.getTimers();
  const visible = timers.filter((timer) => !timer.dismissed);
  if (timers.length === 0) return null;

  return (
    <div data-testid="tm-timer-stack" className="tm-flex tm-flex-col tm-gap-2">
      {visible.map((timer) => (
        <TimerBanner
          key={timer.taskId}
          service={service}
          timer={timer}
          floatingWindow={floatingWindow}
        />
      ))}
    </div>
  );
};

const TimerBanner: React.FC<{
  service: TaskTimerService;
  timer: TaskTimerSnapshot;
  floatingWindow?: TimerFloatingController | undefined;
}> = ({ service, timer, floatingWindow }) => {
  const [dragX, setDragX] = React.useState(0);
  const dragOrigin = React.useRef<number | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    // 버튼 위에서 시작한 드래그는 무시 — 클릭이 스와이프로 오작동하지 않게.
    if ((e.target as HTMLElement).closest("button")) return;
    dragOrigin.current = e.clientX;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // jsdom 등 pointer capture 미지원 환경
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragOrigin.current == null) return;
    setDragX(Math.max(0, e.clientX - dragOrigin.current));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (dragOrigin.current == null) return;
    const delta = Math.max(0, e.clientX - dragOrigin.current);
    dragOrigin.current = null;
    setDragX(0);
    if (delta >= SWIPE_DISMISS_THRESHOLD_PX) service.dismiss(timer.taskId);
  }

  function onPointerCancel(): void {
    dragOrigin.current = null;
    setDragX(0);
  }

  const dragging = dragOrigin.current != null && dragX > 0;
  const style: React.CSSProperties = {
    transform: `translateX(${dragX}px)`,
    opacity: 1 - Math.min(dragX / (SWIPE_DISMISS_THRESHOLD_PX * 2), 0.6),
    transition: dragging ? "none" : "transform 0.18s ease, opacity 0.18s ease",
    touchAction: "pan-y",
  };

  return (
    <div
      data-testid="tm-timer-banner"
      role="status"
      aria-label={timer.title}
      className="tm-timer-banner tm-rounded-lg tm-border tm-border-tm-border tm-bg-tm-bg tm-px-3 tm-py-2 tm-shadow-lg tm-select-none tm-cursor-grab"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="tm-flex tm-items-center tm-gap-3">
        <div className="tm-flex-1 tm-min-w-0">
          <div className="tm-text-sm tm-font-medium tm-truncate tm-text-tm-text">
            {timer.title}
          </div>
          <div className="tm-text-xs tm-text-tm-muted tm-tabular-nums">
            <span data-testid="tm-timer-elapsed">{formatElapsed(timer.elapsedMs)}</span>
          </div>
        </div>

        {floatingWindow?.isSupported() && (
          <BannerButton
            testId="tm-timer-floating-toggle"
            label={floatingWindow.isOpen() ? t("timer.floating.unpin") : t("timer.floating.pin")}
            pressed={floatingWindow.isOpen()}
            onClick={() => floatingWindow.toggle()}
          >
            {floatingWindow.isOpen() ? <PinOff size={14} /> : <Pin size={14} />}
          </BannerButton>
        )}
        {timer.phase === "running" ? (
          <BannerButton
            testId="tm-timer-pause"
            label={t("timer.pause")}
            onClick={() => service.pause(timer.taskId)}
          >
            <Pause size={14} />
          </BannerButton>
        ) : (
          <BannerButton
            testId="tm-timer-start"
            label={timer.phase === "paused" ? t("timer.resume") : t("timer.start")}
            onClick={() => service.start(timer.taskId)}
          >
            <Play size={14} />
          </BannerButton>
        )}
        <BannerButton
          testId="tm-timer-stop"
          label={t("timer.stop")}
          onClick={() => void service.stop(timer.taskId)}
        >
          <Square size={14} />
        </BannerButton>
      </div>

      {timer.steps.length > 0 && (
        <ol
          data-testid="tm-timer-steps"
          aria-label={t("timer.steps")}
          className="tm-mt-2 tm-border-t tm-border-tm-border tm-pt-2 tm-space-y-1"
        >
          {timer.steps.map((step, index) => {
            const number = index + 1;
            const state = timer.currentStep == null
              ? "pending"
              : number < timer.currentStep
                ? "completed"
                : number === timer.currentStep
                  ? "current"
                  : "pending";
            const stateLabel = state === "completed"
              ? t("timer.stepCompleted")
              : state === "current"
                ? t("timer.stepCurrent")
                : t("timer.stepPending");
            return (
              <li
                key={`${number}-${step}`}
                data-step={number}
                data-state={state}
                aria-label={`${number}. ${step}: ${stateLabel}`}
                className="tm-text-xs tm-leading-5"
              >
                <button
                  type="button"
                  data-testid={`tm-timer-step-${number}`}
                  aria-pressed={state === "current"}
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={() => void service.selectStep(timer.taskId, number)}
                  style={state === "current" ? {
                    backgroundColor: "var(--interactive-accent)",
                    color: "var(--text-on-accent)",
                  } : undefined}
                  className={
                    "tm-flex tm-w-full tm-min-w-0 tm-items-start tm-gap-2 tm-overflow-hidden tm-rounded tm-px-1 tm-text-left " +
                    (state === "current"
                      ? "tm-font-semibold"
                      : state === "completed"
                        ? "tm-bg-tm-bg-alt tm-text-tm-muted hover:tm-bg-tm-bg-hover"
                        : "tm-bg-tm-bg-alt tm-text-tm-text hover:tm-bg-tm-bg-hover")
                  }
                >
                  <span aria-hidden="true" className="tm-w-4 tm-shrink-0 tm-text-center tm-tabular-nums">
                    {state === "completed" ? "✓" : state === "current" ? "→" : number}
                  </span>
                  <span
                    title={step}
                    className={
                      "tm-min-w-0 tm-flex-1 tm-truncate " +
                      (state === "completed" ? "tm-line-through" : "")
                    }
                  >
                    {step}
                  </span>
                  <span
                    data-testid={`tm-timer-step-elapsed-${number}`}
                    className="tm-ml-auto tm-shrink-0 tm-tabular-nums tm-opacity-80"
                  >
                    {formatElapsed(timer.stepElapsedMs[index] ?? 0)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};

const BannerButton: React.FC<{
  testId: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}> = ({ testId, label, onClick, pressed, children }) => (
  <button
    type="button"
    data-testid={testId}
    aria-label={label}
    aria-pressed={pressed}
    title={label}
    onClick={onClick}
    className={
      "tm-flex tm-h-7 tm-w-7 tm-shrink-0 tm-items-center tm-justify-center tm-rounded-full tm-border tm-border-tm-border hover:tm-bg-tm-bg-hover hover:tm-text-tm-text " +
      (pressed ? "tm-bg-tm-accent tm-text-white" : "tm-bg-tm-bg-alt tm-text-tm-muted")
    }
  >
    {children}
  </button>
);

/**
 * document.body에 오버레이 컨테이너를 만들어 스택을 mount한다.
 * @returns unmount + 컨테이너 제거를 수행하는 dispose 함수.
 */
export function mountTimerOverlay(
  service: TaskTimerService,
  floatingWindow?: TimerFloatingController,
): () => void {
  const host = document.createElement("div");
  host.className = "taskmaster-root tm-timer-overlay";
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<TimerNotificationStack service={service} floatingWindow={floatingWindow} />);
  return () => {
    root.unmount();
    host.remove();
  };
}
