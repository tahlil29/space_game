# Space Survival

Browser arena shooter — modes, levels, themes, shop, and touch-friendly controls for phone, tablet, and laptop.

**V3.3** completes arcade gamification: combos, floating rewards, wave toasts, career stats, and loadout rarity.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`). Works in mobile browsers too (same Wi‑Fi / localhost tunnel).

## Deploy on Render

Use a **Static Site** only — do **not** create a Web Service. Web Services are much slower on the free plan.

### Fastest setup (manual Static Site)

1. Render → **New → Static Site**
2. Connect `tahlil29/space_game`, branch `main`
3. Settings:
   - **Build command:** `npm install --no-audit --no-fund && npm run build`
   - **Publish directory:** `dist`
4. Deploy

### Blueprint

`render.yaml` is already in the repo (Static Site). **New → Blueprint** → connect the repo.

### If deploy feels stuck

- Free tier often waits in a **build queue** (can be several minutes before it even starts)
- First deploy is slowest; later pushes only rebuild when game files change
- Confirm the service type is **Static**, not **Web**
- Build itself is tiny (Vite only) — long waits are almost always the free queue

Shop progress stays in the browser (`localStorage`). No database needed.

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
