#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wechat_cli="${WECHAT_DEVTOOLS_CLI:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"
wechat_project="$project_root/build/wechatgame"
command_name="${1:-open}"

if [[ ! -x "$wechat_cli" ]]; then
  echo "WeChat developer tools CLI not found: $wechat_cli" >&2
  exit 1
fi

case "$command_name" in
  islogin)
    "$wechat_cli" islogin --lang zh
    ;;
  open)
    [[ -d "$wechat_project" ]] || { echo "Build first: npm run build:wechat" >&2; exit 1; }
    "$wechat_cli" open --project "$wechat_project" --lang zh
    ;;
  preview)
    [[ -d "$wechat_project" ]] || { echo "Build first: npm run build:wechat" >&2; exit 1; }
    mkdir -p "$project_root/artifacts"
    "$wechat_cli" preview --project "$wechat_project" --qr-format image --qr-output "$project_root/artifacts/wechat-preview.png" --info-output "$project_root/artifacts/wechat-preview.json" --lang zh
    ;;
  *)
    echo "Usage: $0 [islogin|open|preview]" >&2
    exit 2
    ;;
esac
