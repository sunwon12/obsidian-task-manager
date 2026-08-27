#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}/native/TaskMasterRatko"
VAULT_PATH="${1:-${SCRIPT_DIR:h:h:h:h}}"
APP_DIR="$HOME/Applications/TaskMasterRatko.app"
CONTENTS_DIR="$APP_DIR/Contents"
CONFIG_DIR="$HOME/Library/Application Support/TaskMasterRatko"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.taskmaster.ratko.plist"

if [[ ! -d "$VAULT_PATH/TaskMaster/Tasks" ]]; then
  print -u2 "TaskMaster/Tasks를 찾을 수 없습니다: $VAULT_PATH"
  exit 1
fi

swift build --package-path "$PROJECT_DIR" -c release

RUNNING_PID="$(pgrep -f "^$APP_DIR/Contents/MacOS/TaskMasterRatko$" | head -n 1 || true)"
if [[ -n "$RUNNING_PID" ]]; then
  kill "$RUNNING_PID"
  for _ in {1..30}; do
    kill -0 "$RUNNING_PID" 2>/dev/null || break
    sleep 0.1
  done
fi

mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources" "$CONFIG_DIR" "${LAUNCH_AGENT:h}"
cp "$PROJECT_DIR/.build/release/TaskMasterRatko" "$CONTENTS_DIR/MacOS/TaskMasterRatko"

cat > "$CONTENTS_DIR/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>TaskMasterRatko</string>
  <key>CFBundleIdentifier</key><string>com.taskmaster.ratko</string>
  <key>CFBundleName</key><string>TaskMaster Ratko</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

/usr/bin/python3 - "$CONFIG_DIR/config.json" "$VAULT_PATH" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"vaultPath": sys.argv[2], "dataRoot": "TaskMaster"}, ensure_ascii=False, indent=2) + "\n")
PY

cat > "$LAUNCH_AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.taskmaster.ratko</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>$APP_DIR</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$CONFIG_DIR/ratko.log</string>
  <key>StandardErrorPath</key><string>$CONFIG_DIR/ratko.error.log</string>
</dict></plist>
PLIST

launchctl bootout "gui/$UID/com.taskmaster.ratko" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$LAUNCH_AGENT"
launchctl kickstart "gui/$UID/com.taskmaster.ratko"
print "설치 완료: $APP_DIR"
