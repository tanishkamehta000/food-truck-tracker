# Scripts — setup & usage

This folder contains CI/admin helper scripts used to compute cached admin metrics.

Files
- `computeMetricsAuth.js` — signs in with an automation Firebase user (email/password), computes metrics by reading Firestore collections, and writes the result to `adminCache/metrics`.
- `printAuthUid.js` — helper that signs in with the same automation user and prints its `uid`. Use this to create the `users/{uid}` doc with `isAdmin: true`.

Required environment variables (use GitHub Secrets in CI or `export` locally):
- `FIREBASE_API_KEY` — Web API key (from Firebase Project Settings)
- `FIREBASE_PROJECT_ID` — Firebase project id
- `FIREBASE_AUTH_DOMAIN` — (optional) e.g. `your-project.firebaseapp.com`
- `FIREBASE_ADMIN_EMAIL` — automation user email (created in Firebase Auth)
- `FIREBASE_ADMIN_PASSWORD` — automation user password (store as secret)

Local quickstart
1. Export environment variables in your shell (do not paste secrets into chat):
```bash
export FIREBASE_API_KEY="AIzaSyBO6598e6Cy0IhOUV4PHePyXi96nhxmRxs"
export FIREBASE_PROJECT_ID="food-truck-tracker-77775"
export FIREBASE_AUTH_DOMAIN="food-truck-tracker-77775.firebaseapp.com"
export FIREBASE_ADMIN_EMAIL="YOUR_EMAIL"
export FIREBASE_ADMIN_PASSWORD="YOUR_PASSWORD"
```

3. In Firestore Console, create the document `users/{UID}` and set `isAdmin: true`.

4. Run the compute script to write `adminCache/metrics`:
```bash
npm run compute-metrics-auth
```

5. After success, verify Firestore → `adminCache/metrics` exists. In the app Dashboard, press "Refresh Cached" to load it.