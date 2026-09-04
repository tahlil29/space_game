# Space Survival

Browser arena shooter — modes, levels, themes, level map, shootable boosts.

**V3.0** includes Stage 6 polish (mode music + particles) and Stage 7 balance.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`).

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
