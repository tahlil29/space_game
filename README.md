# Space Survival

A browser arena shooter with modes, levels, themes, shootable upgrades, and full menu flow.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`).

## Modes (Stage 1)

- **Classic Survival** — standard waves and mid-wave bosses
- **Endless Void** — faster spawns, rising speed per level, no end
- **Boss Assault** — boss every wave with a small escort

Home → **PLAY** → choose a mode → **START MISSION**. Selected mode is saved.

## Levels (Stage 2)

- Every **3 waves** = 1 level
- HUD shows `LEVEL` and `WAVE (x/3)`
- After clearing a level’s last wave (and picking a boost), a **Level Complete** screen appears
- Partial hull/strength repair between levels (amount depends on mode)

## Themes (Stage 3)

Each mode has its own look: background, stars, ship, bullets, and enemy colors.

| Mode | Theme |
|------|--------|
| Classic | Deep blue / cyan |
| Endless | Purple nebula / magenta |
| Boss Assault | War-zone orange / gold |

## Screens

- **Home** — Play and Settings
- **Mode select** — Classic / Endless / Boss
- **Settings** — Music and vibration toggles
- **Pause** — Resume, Restart, Settings, Back to Menu
- **Wave clear** — Shoot glowing targets (6 hits) for a boost
- **Level complete** — Stats + continue
- **Game over** — Final stats

## Controls

- **WASD / Arrow keys** — move
- **Mouse** — aim
- **Click / Space** — fire
- **Shift** — dash
- **Esc** — pause
