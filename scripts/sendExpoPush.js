const { Expo } = require('expo-server-sdk');
const admin = require('firebase-admin');
const { argv } = require('process');

function parseArgs() {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i+1];
      args[key] = val;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const truck = args.truck;
  const title = args.title || 'Update';
  const body = args.body || '';
  const directTokens = args.token ? String(args.token).split(',').map(s => s.trim()).filter(Boolean) : null;

  if (!truck) {
    console.error('Missing --truck "Truck Name"');
    process.exit(1);
  }

  const fs = require('fs');
  const path = require('path');
  const saPath = args.serviceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (saPath) {
    try {
      const resolvedPath = path.isAbsolute(saPath) ? saPath : path.resolve(process.cwd(), saPath);
      if (!fs.existsSync(resolvedPath)) {
        console.error('Service account file not found at', resolvedPath);
        process.exit(1);
      }
      const sa = require(resolvedPath);
      const projectId = sa.project_id || args.projectId || process.env.FIREBASE_PROJECT_ID;
      console.log('Using service account:', resolvedPath);
      console.log('Detected projectId:', projectId);
      try {
        admin.initializeApp({
          credential: admin.credential.cert(sa),
          projectId: projectId,
        });
      } catch (e) {
        // if already initialized, ignore
        // but rethrow other errors
        if (!/already exists/.test(String(e))) throw e;
      }
    } catch (err) {
      console.error('Failed to initialize firebase-admin with service account:', err);
      process.exit(1);
    }
  } else {
    try {
      admin.initializeApp();
    } catch (e) {
      console.error('firebase-admin initializeApp failed and no service account provided.');
      console.error('Provide a service account JSON via --serviceAccount ./serviceAccountKey.json or set GOOGLE_APPLICATION_CREDENTIALS env var.');
      console.error('You can create a service account in Firebase Console → Project settings → Service accounts.');
      process.exit(1);
    }
  }

  const db = admin.firestore();

  let tokens = [];
  if (directTokens && directTokens.length > 0) {
    tokens = directTokens.slice();
    console.log('Using direct tokens provided via --token');
  } else {
    if (!truck) {
      console.error('Missing --truck "Truck Name"');
      process.exit(1);
    }
    const subDoc = await db.collection('subscriptions').doc(truck).get();
    if (!subDoc.exists) {
      console.log('No subscriptions found for truck:', truck);
      return;
    }

    tokens = (subDoc.data().tokens || []).slice();
  }

  if (!tokens || tokens.length === 0) {
    console.log('No tokens to send to for', truck);
    return;
  }

  const expo = new Expo();

  const expoMessages = [];
  const nativeTokens = [];
  for (const t of tokens) {
    if (Expo.isExpoPushToken(t)) {
      expoMessages.push({
        to: t,
        sound: 'default',
        title,
        body,
        data: { truck },
      });
    } else if (t && typeof t === 'string') {
      nativeTokens.push(t);
    }
  }

  const tickets = [];
  const receiptIdToToken = {};
  if (expoMessages.length > 0) {
    console.log(`Sending ${expoMessages.length} Expo tokens via Expo push service`);
    const chunks = expo.chunkPushNotifications(expoMessages);
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        ticketChunk.forEach((t, idx) => {
          tickets.push(t);
          if (t.id) receiptIdToToken[t.id] = chunk[idx].to;
        });
      } catch (err) {
        console.error('Error sending Expo chunk', err);
      }
    }

    await new Promise((res) => setTimeout(res, 2000));
    const receiptIds = tickets.map(t => t.id).filter(Boolean);
    const receipts = {};
    if (receiptIds.length > 0) {
      try {
        const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
        for (const rchunk of receiptIdChunks) {
          try {
            const res = await expo.getPushNotificationReceiptsAsync(rchunk);
            Object.assign(receipts, res);
          } catch (err) {
            console.error('Error fetching Expo receipts', err);
          }
        }
      } catch (err) {
        console.warn('No Expo receipts to fetch or error parsing receipts', err);
      }

      const invalidExpoTokens = new Set();
      for (const receiptId in receipts) {
        const rec = receipts[receiptId];
        if (!rec) continue;
        if (rec.status === 'ok') continue;
        if (rec.status === 'error') {
          const token = receiptIdToToken[receiptId];
          console.error('Expo receipt error for token', token, rec);
          const err = rec.details && rec.details.error;
          if (err === 'DeviceNotRegistered' || err === 'InvalidCredentials') {
            invalidExpoTokens.add(token);
          }
        }
      }

      if (invalidExpoTokens.size > 0) {
        console.log('Pruning invalid Expo tokens:', Array.from(invalidExpoTokens));
        for (const tkn of Array.from(invalidExpoTokens)) {
          try {
            await db.collection('subscriptions').doc(truck).update({ tokens: admin.firestore.FieldValue.arrayRemove(tkn) });
          } catch (err) {
            console.warn('Failed to remove Expo token from subscriptions', err);
          }
          try {
            const usersSnap = await db.collection('users').get();
            for (const udoc of usersSnap.docs) {
              const data = udoc.data() || {};
              const pushTokens = data.pushTokens || {};
              if (Object.prototype.hasOwnProperty.call(pushTokens, tkn)) {
                await db.collection('users').doc(udoc.id).update({ [`pushTokens.${tkn}`]: admin.firestore.FieldValue.delete() });
              }
            }
          } catch (err) {
            console.warn('Error scanning users to remove invalid Expo token', err);
          }
        }
      }
    }
    console.log('Expo send done. Tickets:', tickets.length);
  }

  if (nativeTokens.length > 0) {
    console.log(`Sending ${nativeTokens.length} native tokens via Firebase Admin (sendMulticast)`);
    try {
      const message = {
        tokens: nativeTokens,
        notification: { title, body },
        data: { truck },
      };
      const resp = await admin.messaging().sendMulticast(message);
      console.log(`Native send: success ${resp.successCount}, failure ${resp.failureCount}`);

      const invalidNativeTokens = new Set();
      resp.responses.forEach((r, idx) => {
        if (!r.success) {
          const err = r.error;
          const token = nativeTokens[idx];
          console.error('Native send error for token', token, err && err.code ? err.code : String(err));
          // common codes: registration-token-not-registered, invalid-registration-token
          const code = err && err.code ? err.code : '';
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token' || code === 'registration-token-not-registered' || code === 'invalid-registration-token') {
            invalidNativeTokens.add(token);
          }
        }
      });

      if (invalidNativeTokens.size > 0) {
        console.log('Pruning invalid native tokens:', Array.from(invalidNativeTokens));
        for (const tkn of Array.from(invalidNativeTokens)) {
          try {
            await db.collection('subscriptions').doc(truck).update({ tokens: admin.firestore.FieldValue.arrayRemove(tkn) });
          } catch (err) {
            console.warn('Failed to remove native token from subscriptions', err);
          }
          try {
            const usersSnap = await db.collection('users').get();
            for (const udoc of usersSnap.docs) {
              const data = udoc.data() || {};
              const pushTokens = data.pushTokens || {};
              if (Object.prototype.hasOwnProperty.call(pushTokens, tkn)) {
                await db.collection('users').doc(udoc.id).update({ [`pushTokens.${tkn}`]: admin.firestore.FieldValue.delete() });
              }
            }
          } catch (err) {
            console.warn('Error scanning users to remove invalid native token', err);
          }
        }
      }
    } catch (err) {
      console.error('Error sending native tokens via Firebase Admin', err);
    }
  }

  console.log('Done sending notifications for truck:', truck);
}

main().catch(err => {
  console.error('sendExpoPush error', err);
  process.exit(1);
});
