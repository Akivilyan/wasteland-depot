#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
creator_bin="${COCOS_CREATOR_BIN:-/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator}"
target="${1:-web}"

case "$target" in
  web)
    platform="web-mobile"
    output_name="web-mobile"
    config_path="$project_root/configs/build-web.json"
    ;;
  wechat)
    platform="wechatgame"
    output_name="wechatgame"
    config_path="$project_root/configs/build-wechat.json"
    ;;
  *)
    echo "Usage: $0 [web|wechat]" >&2
    exit 2
    ;;
esac

if [[ ! -x "$creator_bin" ]]; then
  echo "Cocos Creator executable not found: $creator_bin" >&2
  exit 1
fi

mkdir -p "$project_root/logs"
log_path="$project_root/logs/cocos-${output_name}.log"
build_options="configPath=${config_path};logDest=${log_path}"

echo "Building ${platform} with Cocos Creator"
set +e
"$creator_bin" --project "$project_root" --build "$build_options"
status=$?
set -e

if [[ $status -eq 36 ]]; then
  status=0
fi
if [[ $status -ne 0 ]]; then
  echo "Cocos build failed with exit code $status. Check $log_path" >&2
  exit "$status"
fi

node "$project_root/tools/verify-build.mjs" "$target"
