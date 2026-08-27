import Foundation

enum TaskStatus: String, CaseIterable, Codable {
    case backlog
    case hold
    case todo
    case doing
    case inReview = "in-review"
    case done
}

struct TaskCard: Identifiable, Equatable {
    let id: String
    var title: String
    var status: TaskStatus
    let url: URL
    var steps: [String]
    var currentStep: Int?
    var stepSeconds: [Int]
    var actualMd: Double?
    var due: String?
    var updatedAt: String
    var body: String
}

enum TimerPhase: String, Codable {
    case idle
    case running
    case paused
}

struct TimerRecord: Identifiable, Codable, Equatable {
    var id: String { taskId }
    let taskId: String
    var phase: TimerPhase
    var accumulatedMs: Double
    var runningSince: Double?
    var stepAccumulatedMs: [Double]
    var activeStep: Int?
    var stepRunningSince: Double?
    var dismissed: Bool
    var enteredDoingAt: Double

    init(
        taskId: String,
        phase: TimerPhase = .idle,
        accumulatedMs: Double = 0,
        runningSince: Double? = nil,
        stepAccumulatedMs: [Double] = [],
        activeStep: Int? = nil,
        stepRunningSince: Double? = nil,
        dismissed: Bool = false,
        enteredDoingAt: Double = Date().millisecondsSince1970
    ) {
        self.taskId = taskId
        self.phase = phase
        self.accumulatedMs = accumulatedMs
        self.runningSince = runningSince
        self.stepAccumulatedMs = stepAccumulatedMs
        self.activeStep = activeStep
        self.stepRunningSince = stepRunningSince
        self.dismissed = dismissed
        self.enteredDoingAt = enteredDoingAt
    }

    private enum CodingKeys: String, CodingKey {
        case taskId, phase, accumulatedMs, runningSince, stepAccumulatedMs
        case activeStep, stepRunningSince, dismissed, enteredDoingAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        taskId = try values.decode(String.self, forKey: .taskId)
        phase = try values.decodeIfPresent(TimerPhase.self, forKey: .phase) ?? .idle
        accumulatedMs = try values.decodeIfPresent(Double.self, forKey: .accumulatedMs) ?? 0
        runningSince = try values.decodeIfPresent(Double.self, forKey: .runningSince)
        stepAccumulatedMs = try values.decodeIfPresent([Double].self, forKey: .stepAccumulatedMs) ?? []
        activeStep = try values.decodeIfPresent(Int.self, forKey: .activeStep)
        stepRunningSince = try values.decodeIfPresent(Double.self, forKey: .stepRunningSince)
        dismissed = try values.decodeIfPresent(Bool.self, forKey: .dismissed) ?? false
        enteredDoingAt = try values.decodeIfPresent(Double.self, forKey: .enteredDoingAt)
            ?? Date().millisecondsSince1970
    }
}

struct TimerFile: Codable {
    var version = 1
    var timers: [TimerRecord]
}

extension Date {
    var millisecondsSince1970: Double { timeIntervalSince1970 * 1_000 }
}

func elapsedMilliseconds(for timer: TimerRecord, now: Double = Date().millisecondsSince1970) -> Double {
    timer.accumulatedMs + (
        timer.phase == .running && timer.runningSince != nil
            ? max(0, now - (timer.runningSince ?? now))
            : 0
    )
}

func formattedElapsed(_ milliseconds: Double) -> String {
    let total = max(0, Int(milliseconds / 1_000))
    let hours = total / 3_600
    let minutes = (total % 3_600) / 60
    let seconds = total % 60
    if hours > 0 {
        return String(format: "%d:%02d:%02d", hours, minutes, seconds)
    }
    return String(format: "%02d:%02d", minutes, seconds)
}

func elapsedMd(_ milliseconds: Double) -> Double {
    guard milliseconds > 0 else { return 0 }
    let rounded = (milliseconds / (8 * 60 * 60 * 1_000) * 100).rounded() / 100
    return max(0.01, rounded)
}
