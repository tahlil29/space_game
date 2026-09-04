# Space Survival

Browser arena shooter — modes, levels, themes, level map, shootable boosts, and a coin shop.

**V3.1** adds a shop: earn coins from kills, then buy ship skins, enemy themes, and arena props.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`).

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

Shoot glowing targets (**6 hits**) after eligible waves. Each mode has its own upgrade pool.

## Controls

WASD move · Mouse aim · Click/Space fire · Shift dash · Esc pause
