---
name: wasteland-depot-dev
description: Develop, build, test, or troubleshoot the WastelandDepot Cocos Creator 3.8 project and its WeChat Mini Game output. Use for gameplay code, project structure, Cocos CLI builds, WeChat developer-tool automation, regression, and release-readiness checks in this repository.
---

# Wasteland Depot Dev

Keep the first deliverable a small, complete WeChat Mini Game. Treat PC as a later port, not current scope.

## Authoritative guides (official docs layer)

- `cocos-creator-guide` (user-level skill) — official Cocos Creator 3.8 build CLI, WeChat publish, decorators, 2D UI, atlas facts with source URLs. Load when writing components or touching the build.
- `wechat-minigame-guide` (user-level skill) — official WeChat minigame version/release flow, package-size & subpackage limits, storage/ad/CLI facts with source URLs. Load when touching platform features or publishing.
- Platform limits (package sizes, upload whitelist, ad rules) are date-stamped there — re-verify from the official URLs when stale, never trust memory.
- Layering rule (user-set): the official guides are the bedrock and are **not edited from this repo**; this skill and `references/` only supplement with project-specific application. On any conflict the official guides win and the project side defers. Mismatches we cannot resolve are flagged to the user, not silently changed in either file.

## Preserve the boundaries

The authoritative, current definition of the layering, per-file responsibilities, save keys, and the reuse-vs-build list is `docs/ARCHITECTURE.md` (enforced statically by `tools/verify-project.mjs`). Summary:

- Keep deterministic game rules under `assets/scripts/core`; files there must not import `cc` or access `wx`. All randomness goes through `core/rng.ts`.
- Keep Cocos nodes, components, input, animation, and layout under `assets/scripts/presentation`; it renders and routes input into core commands, never mutates rule data directly.
- Keep storage, ads, login, sharing, and lifecycle APIs under `assets/scripts/platform`. Access `wx` only through a platform adapter.
- Keep the first prototype 2D and portrait. Do not add 3D, a physics engine, skeletal animation, networking, or a third-party runtime without a demonstrated need (ADR-001).
- The engine stays Cocos Creator 3.8.8. Do not propose rebuilding the project or upgrading Cocos: the white-screen/deprecated-API fallout comes from the vendored WeChat adapter template and is not eliminated by either (ADR-001/002) — remediation is the post-build patch script.
- Ads must remain optional and user-initiated (product baseline in `docs/GAME_SKELETON.md` §13). Do not add banners, splash ads, forced interstitials, or progression tuned to manufacture ad pain.
- Gameplay numbers live in `core/constants.ts`; structured data in `core/game.ts`; loot weights in `core/loot.ts`. When a pending decision lands, change those files first.

## Work through repeatable commands

Run `npm run doctor` before diagnosing environment failures. Run `npm run verify` after code or configuration changes. Use `npm run build:web` / `npm run build:wechat` / `npm run wechat:open` / `npm run wechat:preview` instead of reconstructing Cocos or devtools CLI command lines manually.

`npm run verify` = doctor → typecheck → node tests → static guard (`tools/verify-project.mjs`). Full chain is currently green at 76 tests.

- The typecheck gate (`tsc -p tsconfig.check.json`, ADR-007) is non-negotiable: the editor compiles on open, but CLI builds/regression do not, so mistyped engine APIs (`Node.scheduleOnce` doesn't exist; `canPlace(state,def,x,y)` arity; `EventTouch.preventSwallow` is a boolean property) survive into the simulator otherwise. It needs `temp/declarations` (open the project in Cocos Creator once); when absent it self-skips — that skip is fine for a fresh clone, never "fix" it by deleting the gate.
- Do not guess Cocos APIs: check `.d.ts` under the CocosCreator app bundle (`.../engine/bin/.declarations/cc.d.ts`) or the manual, then let typecheck confirm. tsc checks types, not behavior — WeChat build miscompiles (ADR-006, Map spread) still need simulator regression.
- Cocos command-line build still needs a macOS graphical session. If a build exits before producing a Cocos log, distinguish a missing GUI session or sandbox restriction from a project defect. Exit codes follow the official table (32=invalid build args, 34=build error, 36=success); `tools/cocos-build.sh` maps 36 to 0 accordingly.
- After a WeChat build, `npm run wechat:open` for the simulator, `npm run wechat:preview` for a device QR code (written to `artifacts/`). Never `upload` a release unless the user explicitly authorizes the external action.

## Verification cadence (when to run what)

The sole authority for verification layers and triggers is `docs/VERIFY_CADENCE.md` (ADR-009). Default for daily slices: **T0 only** (`npm run verify`, zero token). T1 targeted regression (one flow module via simulator), T2 smoke, T3 full regression + whole-project review trigger only on risk: save-schema changes, build-pipeline changes, guard changes, stage ends, pre-release. Global-risk changes (guard/patch/build config) trigger T3 even for a one-line diff.

Regression flow modules are player-visible flows F1~F6 (trip / road events / loot / depot intake / day loop / trunk), each = injected save → operation sequence → CDP asserts. Task-card format lives in `docs/VERIFY_CADENCE.md` §5.

## WeChat regression on this project (canvas mini game)

Detailed pitfall tables, environment assets, and gotchas live in `references/`:

- `references/pitfalls.md` — symptom → cause → fix table covering build miscompiles, runtime shims, engine-API traps, and simulator noise. Read it when anything fails oddly.
- The companion `.agents/skills/wechat-devtools/SKILL.md` — read before driving `wechat-devtools` MCP tools (parameter tables, SOPs, tool fault tables for DOM mini-program pages). For this project's canvas-mini-game regression, the sole authority is our own `references/minigame-regression.md` (migrated there 2026-09-14); the platform-level root cause sits in official `wechat-minigame-guide` §七.

Non-negotiables of this project's regression loop (details in the references above):

- `wechat_automator` (port 9420) does **not** work on canvas mini games — never retry it. Drive input with system-level real clicks (computer-use) and assert state with `node tools/cdp-eval.mjs '<expr>'` over CDP 9222; cc lives under `__gameContextWindow.cc`, scene components via `canvas.components.find(c => c.__classname__ === '...')`, multi-statement expressions wrapped in an IIFE.
- Screenshots are for click coordinates only; assert via cdp-eval, not by eyeballing. Session discipline: status assertions converge on terminal commands; failed retries ≤2 then switch method.
- Console noise from the simulator (jsbridge/getSystemInfo/HarmonyOS hints, `WAGame.js`/`cc.js` stacks) is not our bug. Stack frames landing in our files (`assets/main/index.js`, scene/core files) are. When suspicious, pull full CDP logs — real errors have been masked by noise before.
- Simulator timers pause/catch up when the window loses focus — travel tweens may appear to finish instantly; assert component state, not wall-clock animation.

## Environment assets already in place (do not reinstall)

- `wechat-devtools-mcp` v0.9.16 installed via `uv tool` (`~/.local/bin/`), wired in `.zcode/config.json` (workspace MCP, auto-connects at session start) with the devtools CLI path and `build/wechatgame` as project path. Prerequisite: devtools `设置 → 安全设置 → 服务端口` must be on.
- `minigame-api-typings` in devDependencies, loaded via the `files` array in `tsconfig.json` (global `wx` types; do not switch to `compilerOptions.types`, that would drop Cocos engine declarations from `temp/tsconfig.cocos.json`).
- WeChat build output is patched by `tools/patch-wechat-deprecated.mjs` (seven idempotent patches) after every `npm run build:wechat`; the new devtools runtime removed `window`/`global`/`requestAnimationFrame` globals that the Cocos 3.8.8 template relies on (ADR-002). If upstream templates change, patches warn `[WARN] 未匹配到模板` instead of failing — check patch output after every build.
- Web search when WebFetch times out on CN sites: `arkcli +chat --tools web_search --tool-choice auto`. Git to GitHub needs the Clash proxy on port 7897. These are machine-level facts kept in the user's ZCode memory, not repo rules — do not copy them here.

## Verify observable outcomes

- For rule changes, add or update Node tests under `tests` (node native `--test`, imports core `.ts` directly via type stripping; requires Node ≥22.18).
- Record confirmed decisions as ADRs in `docs/DECISIONS.md`; pending product items in `docs/PENDING_DECISIONS.md`. Distinguish implemented facts from proposed product ideas.
- Commit messages use the `zcode:` prefix (the `codex/` prefix is legacy, do not reuse).
