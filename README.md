# Space Survival

A browser arena shooter: survive enemy waves, collect XP, and pick ship upgrades between battles.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (default is configured for port `43127`).

## Controls

- **WASD / Arrow keys** — move
- **Mouse** — aim
- **Click / Space** — fire
- **Shift** — dash

## Combat note (V1.3)

Ship **strength absorbs damage first**. Hull only takes damage after strength is depleted. Contact damage is capped and applies a short knockback/hit cooldown so enemy piles no longer melt both bars at once.
