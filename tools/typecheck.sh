#!/usr/bin/env bash
# 全项目 TypeScript 类型检查（命令行闸门）。
#
# Cocos 编辑器自身按 temp/tsconfig.cocos.json 全量编译业务代码，但命令行
# 构建/验证没有「编辑器打开」这一步，根 tsconfig.json 的 files 又只含微信
# 类型声明——直接跑 tsc 不会检查 assets/scripts。tsconfig.check.json 补上
# include，对引擎声明做全量类型检查（ADR-007）。
#
# temp/declarations 由 Cocos 编辑器打开项目时生成；未生成过（全新克隆、
# 编辑器未打开）时跳过，不当作失败。
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ ! -f "temp/tsconfig.cocos.json" || ! -f "temp/declarations/cc.d.ts" ]]; then
  echo "[SKIP] 类型检查：temp/declarations 尚未生成（先用 Cocos 编辑器打开一次项目）"
  exit 0
fi

npx tsc -p tsconfig.check.json
echo "[OK]   类型检查通过（tsc -p tsconfig.check.json）"
