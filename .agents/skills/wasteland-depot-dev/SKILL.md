---
name: wasteland-depot-dev
description: Develop, build, test, or troubleshoot the WastelandDepot Cocos Creator 3.8 project and its WeChat Mini Game output. Use for gameplay code, project structure, Cocos CLI builds, WeChat developer-tool automation, and release-readiness checks in this repository.
---

# Wasteland Depot Dev

Keep the first deliverable a small, complete WeChat Mini Game. Treat PC as a later port, not current scope.

## Preserve the boundaries

- Keep deterministic game rules under `assets/scripts/core`; files there must not import `cc` or access `wx`.
- Keep Cocos nodes, components, input, animation, and layout under `assets/scripts/presentation`.
- Keep storage, ads, login, sharing, and lifecycle APIs under `assets/scripts/platform`. Access `wx` only through a platform adapter.
- Keep the first prototype 2D and portrait. Do not add 3D, a physics engine, skeletal animation, networking, or a third-party runtime without a demonstrated need.
- Ads must remain optional and user-initiated. Do not add banners, splash ads, forced interstitials, or progression tuned to manufacture ad pain.

## Work through repeatable commands

Run `npm run doctor` before diagnosing environment failures. Run `npm run verify` after code or configuration changes. Use `npm run build:web` or `npm run build:wechat` instead of reconstructing Cocos command lines manually.

Cocos Creator's command-line build still needs a macOS graphical session. If a build exits before producing a Cocos log, distinguish a missing GUI session or sandbox restriction from a project defect.

After a WeChat build, use `npm run wechat:open` for the simulator and `npm run wechat:preview` for a device QR code. Never upload a release unless the user explicitly authorizes the external action.

## Verify observable outcomes

- For rule changes, add or update Node tests under `tests`.
- For presentation changes, build at least the Web Mobile target before claiming success.
- For platform changes, verify the generated `build/wechatgame` structure and then use the WeChat developer tools when available.
- Record confirmed decisions and remaining blockers in project documentation; distinguish implemented facts from proposed product ideas.
