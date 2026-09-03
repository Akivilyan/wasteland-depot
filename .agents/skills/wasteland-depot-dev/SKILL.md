---
name: wasteland-depot-dev
description: Develop, build, test, or troubleshoot the WastelandDepot Cocos Creator 3.8 project and its WeChat Mini Game output. Use for gameplay code, project structure, Cocos CLI builds, WeChat developer-tool automation, and release-readiness checks in this repository.
---

# Wasteland Depot Dev

Keep the first deliverable a small, complete WeChat Mini Game. Treat PC as a later port, not current scope.

## Preserve the boundaries

The authoritative, current definition of the layering, per-file responsibilities, save keys, and the reuse-vs-build list is `docs/ARCHITECTURE.md` (enforced statically by `tools/verify-project.mjs`). Summary:

- Keep deterministic game rules under `assets/scripts/core`; files there must not import `cc` or access `wx`. All randomness goes through `core/rng.ts`.
- Keep Cocos nodes, components, input, animation, and layout under `assets/scripts/presentation`; it renders and routes input into core commands, never mutates rule data directly.
- Keep storage, ads, login, sharing, and lifecycle APIs under `assets/scripts/platform`. Access `wx` only through a platform adapter.
- Keep the first prototype 2D and portrait. Do not add 3D, a physics engine, skeletal animation, networking, or a third-party runtime without a demonstrated need.
- Ads must remain optional and user-initiated (product baseline in `docs/GAME_SKELETON.md` §11). Do not add banners, splash ads, forced interstitials, or progression tuned to manufacture ad pain.

## Work through repeatable commands

Run `npm run doctor` before diagnosing environment failures. Run `npm run verify` after code or configuration changes. Use `npm run build:web` or `npm run build:wechat` instead of reconstructing Cocos command lines manually.

`npm run verify` includes `npm run typecheck` (`tsc -p tsconfig.check.json`), the CLI type gate against Cocos engine declarations — the editor compiles on open, but CLI builds/regression do not, so without this gate mistyped engine APIs (`Node.scheduleOnce` doesn't exist; `canPlace(state,def,x,y)` arity; `EventTouch.preventSwallow` is a boolean) survive into the simulator. Do not guess Cocos APIs: check `.d.ts` under the CocosCreator app bundle (`.../engine/bin/.declarations/cc.d.ts`) or the manual, then let typecheck confirm. tsc checks types, not behavior — WeChat build miscompiles (ADR-006, Map spread) still need simulator regression.

Cocos Creator's command-line build still needs a macOS graphical session. If a build exits before producing a Cocos log, distinguish a missing GUI session or sandbox restriction from a project defect.

After a WeChat build, use `npm run wechat:open` for the simulator and `npm run wechat:preview` for a device QR code. Never upload a release unless the user explicitly authorizes the external action.

## Environment assets already in place (do not reinstall)

- `wechat-devtools-mcp` v0.9.16 installed via `uv tool` (`~/.local/bin/`), wired in `.zcode/config.json` (workspace MCP, auto-connects at session start) with the devtools CLI path and `build/wechatgame` as project path. Companion skill at `.agents/skills/wechat-devtools` — read it before driving the tools through MCP. Prerequisite: devtools `设置 → 安全设置 → 服务端口` must be on.
- `minigame-api-typings` in devDependencies, loaded via the `files` array in `tsconfig.json` (global `wx` types; do not switch to `compilerOptions.types`, that would drop Cocos engine declarations from `temp/tsconfig.cocos.json`).
- WeChat build output is patched by `tools/patch-wechat-deprecated.mjs` (seven idempotent patches) after every `npm run build:wechat`; the new devtools runtime removed `window`/`global`/`requestAnimationFrame` globals that the Cocos 3.8.8 template relies on. Details and the control experiment live in `docs/DECISIONS.md`.
- Web search when WebFetch times out on CN sites: `arkcli +chat --tools web_search --tool-choice auto` (see user memory `arkcli-websearch-when-webfetch-fails`). Git to GitHub needs the Clash proxy on port 7897 (see user memory `clash-git-proxy-macos`).

## Verify observable outcomes

- For rule changes, add or update Node tests under `tests`.
- For presentation changes, build at least the Web Mobile target before claiming success.
- For platform changes, verify the generated `build/wechatgame` structure and then use the WeChat developer tools when available.
- Record confirmed decisions and remaining blockers in project documentation; distinguish implemented facts from proposed product ideas.
