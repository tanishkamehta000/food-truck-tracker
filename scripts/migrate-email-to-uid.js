#!/usr/bin/env node
/*
Migration script: migrate email-keyed Firestore documents to uid-keyed documents.

Usage (recommended dry-run first):

  node scripts/migrate-email-to-uid.js --serviceAccount ./serviceAccountKey.json --dryRun

To perform migration and remove old email-keyed docs after copying:

  node scripts/migrate-email-to-uid.js --serviceAccount ./serviceAccountKey.json --deleteOld

Options:
  --serviceAccount  Path to Firebase service account JSON (required)
  --collections     Comma-separated collection list to migrate (default: users,favorites,vendors)
  --dryRun          If present, do not write any data; only log actions
  --deleteOld       If present, delete the old email-keyed documents after copying (use with caution)

Important:
 - This script requires a Firebase service account (Admin SDK) JSON file. Keep it secret.
 - Backup your Firestore data before running real migration (no undo).
*/

const admin = require('firebase-admin');
const fs = require('fs');
const yargs = require('yargs');

const argv = yargs
  .option('serviceAccount', { type: 'string', demandOption: true, describe: 'Path to service account JSON' })
  .option('collections', { type: 'string', describe: 'Comma-separated collections to migrate', default: 'users,favorites,vendors' })
  .option('dryRun', { type: 'boolean', describe: 'Do not write, only log', default: false })
  .option('deleteOld', { type: 'boolean', describe: 'Delete old email-keyed docs after copying', default: false })
  .help()
  .argv;

if (!fs.existsSync(argv.serviceAccount)) {
  console.error('Service account file not found:', argv.serviceAccount);
  process.exit(2);
}

const serviceAccount = require(argv.serviceAccount);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
const auth = admin.auth();

const collections = argv.collections.split(',').map(s => s.trim()).filter(Boolean);

(async function main() {
  console.log('Starting migration');
  console.log('Collections:', collections.join(','));
  console.log('dryRun:', argv.dryRun, 'deleteOld:', argv.deleteOld);

  const summary = { copied: 0, skippedNoUser: 0, errors: 0, deleted: 0 };

  for (const col of collections) {
    console.log('\n--- Processing collection:', col, '---');
    try {
      const snapshot = await db.collection(col).get();
      console.log(`Found ${snapshot.size} documents in ${col}`);

      for (const docSnap of snapshot.docs) {
        const id = docSnap.id;

        // only migrate docs that look like emails (simple heuristic)
        if (!id.includes('@')) {
          // skip non-email ids
          continue;
        }

        let uid = null;
        try {
          const userRecord = await auth.getUserByEmail(id);
          uid = userRecord.uid;
        } catch (e) {
          console.warn(`[${col}] No auth user for email ${id}:`, e.code || e.message || e);
          summary.skippedNoUser++;
          continue;
        }

        const data = docSnap.data();
        const newRef = db.collection(col).doc(uid);

        console.log(`[${col}] ${id} -> ${uid}`);

        if (!argv.dryRun) {
          try {
            await newRef.set(data, { merge: true });
            summary.copied++;
            if (argv.deleteOld) {
              try {
                await docSnap.ref.delete();
                summary.deleted++;
                console.log(`  deleted old doc ${id}`);
              } catch (delErr) {
                console.error(`  failed deleting old doc ${id}:`, delErr);
                summary.errors++;
              }
            }
          } catch (writeErr) {
            console.error(`  failed writing ${col}/${uid}:`, writeErr);
            summary.errors++;
          }
        }
      }
    } catch (err) {
      console.error('Error processing collection', col, err);
      summary.errors++;
    }
  }

  console.log('\nMigration complete. Summary:');
  console.log(summary);

  if (summary.errors > 0) process.exit(1);
  process.exit(0);
})();
