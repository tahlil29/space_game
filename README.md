# Space Survival

Browser arena shooter with Firebase login (or local fallback), cloud saves, shop, and touch-friendly controls.

**V3.5** uses Firebase Authentication + Firestore when configured.

## Run locally

```bash
npm install
cp .env.example .env.local   # add Firebase keys (optional)
npm run dev
```

Open the URL Vite prints (port `43127`).

## Firebase setup (from BUILD PRODUCTS)

Enable these in Firebase Console (project `space-game-fc099`):

1. **Authentication** → enable **Email/Password**, **Google**, and **Anonymous** (no Phone)
2. **Firestore** — create DB, deploy rules from `firestore.rules`
3. Web app config in `.env.local` / Render env vars
4. **Authorized domains** — `localhost` plus your Render host

### Accounts

- **Log in** — email + password, Google, or guest
- **Sign up now!** — email + password or Google
- **Forgot password?** — email → OTP → new password (opens its own screen)

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Without env vars the game still runs with **local** accounts on the device.

Redeploy Firestore rules from `firestore.rules` (includes `passwordOtps`).

Cloud doc: `users/{uid}` → shop, progress, settings, lastScore

## Deploy on Render

Use a **Static Site** (not Web Service).

1. Connect `tahlil29/space_game`, branch `main`
2. Build: `npm install --no-audit --no-fund && npm run build`
3. Publish: `dist`
4. Add the same `VITE_FIREBASE_*` env vars → redeploy

`render.yaml` works with Blueprint too.

## Devices

| Device | Controls |
|--------|----------|
| Laptop | WASD, mouse aim, click/space fire, Shift dash |
| Phone / tablet | Stick, FIRE, DASH, pause |

## Shop / Modes / Controls

Earn coins from kills → buy ship skins, enemy themes, arena props.  
Modes: Classic, Endless, Boss Assault.  
Boosts: shoot glowing targets (6 hits) after eligible waves.
