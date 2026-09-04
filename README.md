# Space Survival

Browser arena shooter with Firebase login (or local fallback), cloud saves, shop, and touch-friendly controls.

## Run locally

```bash
npm install
cp .env.example .env.local   # add Firebase + EmailJS (+ optional service account)
npm run dev
```

Open the URL Vite prints (port `43127`).

## Firebase setup

1. **Authentication** → enable **Email/Password**, **Google**, and **Anonymous**
2. **Firestore** — create DB, deploy rules from `firestore.rules`:
   ```bash
   npx firebase-tools deploy --only firestore:rules --project space-game-fc099
   ```
   (or paste the file in Firebase Console → Firestore → Rules)
3. Web app config → `VITE_FIREBASE_*` in `.env.local` / Render
4. **Authorized domains** — add `localhost` and your Render host
5. **Optional service account** — only needed so *existing* accounts can reset before they have logged in once on this build:
   Firebase Console → Project settings → **Service accounts** → **Generate new private key**  
   Put the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env.local` and on Render

### Forgot password flow

1. Player enters email → receives **6-digit OTP** (EmailJS)
2. Enters OTP + **new password** on the same screen
3. App updates the Firebase Auth password (no reset link)
4. Player returns to **Log in** and signs in with the **new password**

How password update works (first match wins):

1. **Stored recovery** — after any successful email login/register, the app saves a recovery secret (this device + Firestore). OTP unlocks it, signs in, and calls `updatePassword`.
2. **Refresh token** — same browser session fallback
3. **Admin API** — `/api/apply-otp-password` when `FIREBASE_SERVICE_ACCOUNT_JSON` is set (covers accounts that never logged in on this build)

EmailJS template vars: `passcode`, `time`, `email` (and `otp` / `to_email` aliases).

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_EMAILJS_SERVICE_ID=...
VITE_EMAILJS_TEMPLATE_ID=...
VITE_EMAILJS_PUBLIC_KEY=...
FIREBASE_SERVICE_ACCOUNT_JSON={...}   # optional if users log in once first
```

## Deploy on Render

Use a **Web Service** (Node), not a Static Site — the password-reset API needs the server.

1. Connect the repo, branch `main`
2. Build: `npm install --no-audit --no-fund && npm run build`
3. Start: `npm start`
4. Add env vars above (service account optional but recommended)
5. Add your Render host to Firebase **Authorized domains**
6. Deploy / clear cache if needed

`render.yaml` is set up for this.

## Devices

| Device | Controls |
|--------|----------|
| Laptop | WASD, mouse aim, click/space fire, Shift dash, Esc pause |
| Phone / tablet | Stick, FIRE, DASH, pause |

Earn coins → shop skins. Modes: Classic, Endless, Boss Assault.
