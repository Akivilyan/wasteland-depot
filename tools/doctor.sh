#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
creator_bin="${COCOS_CREATOR_BIN:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"
wechat_cli="${WECHAT_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"

check_executable() {
  local label="$1"
  local executable="$2"
  if [[ ! -x "$executable" ]]; then
    echo "[FAIL] $label: $executable"
    return 1
  fi
  echo "[OK]   $label: $executable"
}

check_file() {
  local relative_path="$1"
  if [[ ! -f "$project_root/$relative_path" ]]; then
    echo "[FAIL] missing $relative_path"
    return 1
  fi
  echo "[OK]   $relative_path"
}

echo "WastelandDepot environment"
echo "Node:   $(node --version)"
echo "npm:    $(npm --version)"
check_executable "Cocos Creator" "$creator_bin"
check_executable "WeChat CLI" "$wechat_cli"
check_file "package.json"
check_file "assets/scenes/Prototype.scene"
check_file "assets/scripts/presentation/PrototypeScene.ts"
echo "[OK]   project root: $project_root"
