#!/usr/bin/env node
/**
 * Helper: sign in with an automation Firebase user (email/password) and print UID.
 * WARNING: Do NOT paste credentials into chat. Set them as env vars or GitHub Secrets.
 *
 * Required env vars:
 * - FIREBASE_API_KEY
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_AUTH_DOMAIN (optional)
 * - FIREBASE_ADMIN_EMAIL
 * - FIREBASE_ADMIN_PASSWORD
 *
 * Run locally:
 * export FIREBASE_API_KEY=...
 * export FIREBASE_PROJECT_ID=...
 * export FIREBASE_ADMIN_EMAIL=...
 * export FIREBASE_ADMIN_PASSWORD=...
 * node scripts/printAuthUid.js
 */

const firebase = require('firebase/compat/app');
require('firebase/compat/auth');

async function main() {
  const { FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_AUTH_DOMAIN, FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD } = process.env;
  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_ADMIN_EMAIL || !FIREBASE_ADMIN_PASSWORD) {
    console.error('Missing required env vars. See script header.');
    process.exit(2);
  }

  const config = { apiKey: FIREBASE_API_KEY, projectId: FIREBASE_PROJECT_ID };
  if (FIREBASE_AUTH_DOMAIN) config.authDomain = FIREBASE_AUTH_DOMAIN;

  if (!firebase.apps.length) firebase.initializeApp(config);

  try {
    const auth = firebase.auth();
    const userCred = await auth.signInWithEmailAndPassword(FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD);
    console.log('Signed in. UID:', userCred.user.uid);
    await auth.signOut();
    process.exit(0);
  } catch (err) {
    console.error('Failed to sign-in:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
