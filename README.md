# Space Survival

A browser arena shooter with full menu flow: home screen, settings, pause menu, wave-complete upgrades, and game over.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (port `43127`).

## Screens

- **Home** — Play and Settings
- **Settings** — Music and vibration toggles (saved to localStorage)
- **Pause** (Esc or pause button) — Resume, Restart, Settings, Back to Menu
- **Wave complete** — Stats + upgrade choices
- **Game over** — Final stats, Play Again, Main Menu

## Controls

- **WASD / Arrow keys** — move
- **Mouse** — aim
- **Click / Space** — fire
- **Shift** — dash
- **Esc** — pause

## Bosses

Tank enemies and wave bosses vibrate your device on hit (when vibration is enabled in Settings). Bosses spawn mid-wave from wave 2 onward.
