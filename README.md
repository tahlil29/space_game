# Space Survival

Browser arena shooter — modes, levels, themes, shop, and touch-friendly controls for phone, tablet, and laptop.

**V3.2** stabilizes UI/gameplay across devices (responsive menus + on-screen stick / FIRE / DASH).

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`). Works in mobile browsers too (same Wi‑Fi / localhost tunnel).

## Deploy on Render

This repo is ready as a **Static Site** (best fit — no server needed).

### Option A — Blueprint (easiest)

1. Push is already on GitHub: `https://github.com/tahlil29/space_game`
2. In Render: **New → Blueprint**
3. Connect the repo (uses `render.yaml`)
4. Deploy — live URL will look like `https://space-survival.onrender.com`

### Option B — Manual Static Site

1. Render → **New → Static Site**
2. Connect `tahlil29/space_game`, branch `main`
3. Settings:
   - **Build command:** `npm ci && npm run build`
   - **Publish directory:** `dist`
4. Create Static Site → wait for build

Auto-deploys on every push to `main`.

Shop coins / unlocks stay in each player’s browser (`localStorage`), so Render does not need a database.

## Devices

| Device | Controls | UI |
|--------|----------|----|
| **Laptop / desktop** | WASD, mouse aim, click/space fire, Shift dash | Full HUD + help text |
| **Phone / tablet** | Left stick move, FIRE (auto-aim), DASH, pause button | Compact HUD, safe-area padding, touch pads |

Menus scroll on short screens; zoom/scroll gestures are blocked during play.

## Shop

- Kill enemies to earn coins (shown on the home screen and in-game HUD)
- Open **SHOP** from home to buy and equip:
  - **Ship** skins (hull / glow colors)
  - **Enemy** themes (hostile color sets)
  - **Props** (asteroids, beacons, debris, energy rings — cosmetic only)
- Wallet and unlocks save in the browser (`localStorage`)

## Modes

| Mode | Rules | Feel |
|------|--------|------|
| **Classic** | Boost every wave · level map · balanced rams | Blue / calm music |
| **Endless** | Boost every **2** waves · +10% speed/level · no map | Purple trails · faster music |
| **Boss Assault** | Boss each wave · **2× boss ram** · orbit bosses · map | Orange embers · heavier music |

## Levels & map

- 3 waves = 1 level
- **Classic / Boss:** Mode → Level map (1–10) → play
- Clear a level to unlock the next (saved in browser)
- Stars: ★ clear · ★★ hull ≥ 50% · ★★★ hull ≥ 50% and no rams

## Boosts

Shoot glowing targets (**6 hits**) after eligible waves. On touch, hold **FIRE** (auto-aims) or tap a target.

## Controls

**Desktop:** WASD move · Mouse aim · Click/Space fire · Shift dash · Esc pause  

**Touch:** Left stick · FIRE · DASH · Pause (top-right)
