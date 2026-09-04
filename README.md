# Space Survival

A browser arena shooter with full menu flow: home screen, settings, pause menu, wave-complete upgrades, and game over.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`).

## Modes (Stage 1)

- **Classic Survival** — standard waves and mid-wave bosses
- **Endless Void** — faster spawns, rising speed, no end
- **Boss Assault** — boss every wave with a small escort

Home → **PLAY** → choose a mode → **START MISSION**. Selected mode is saved.

## Screens

- **Home** — Play and Settings
- **Settings** — Music and vibration toggles (saved to localStorage)
- **Pause** (Esc or pause button) — Resume, Restart, Settings, Back to Menu
- **Wave complete** — Three glowing targets spawn from random edges; shoot one 6 times to unlock that boost
- **Game over** — Final stats, Play Again, Main Menu

## Controls

- **WASD / Arrow keys** — move
- **Mouse** — aim
- **Click / Space** — fire
- **Shift** — dash
- **Esc** — pause

## Bosses

Tank enemies and wave bosses vibrate your device on hit (when vibration is enabled in Settings). Bosses spawn mid-wave from wave 2 onward.
