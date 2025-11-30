#!/usr/bin/env node
/**
 * Compute metrics using Firebase client auth (email/password) in CI.
 * Expects env vars (set as GitHub Secrets):
 * - FIREBASE_API_KEY
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_AUTH_DOMAIN (optional)
 * - FIREBASE_ADMIN_EMAIL
 * - FIREBASE_ADMIN_PASSWORD
 *
 * Run: node scripts/computeMetricsAuth.js
 */

const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');

async function main() {
  const {
    FIREBASE_API_KEY,
    FIREBASE_PROJECT_ID,
    FIREBASE_AUTH_DOMAIN,
    FIREBASE_ADMIN_EMAIL,
    FIREBASE_ADMIN_PASSWORD,
  } = process.env;

  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID || !FIREBASE_ADMIN_EMAIL || !FIREBASE_ADMIN_PASSWORD) {
    console.error('Missing required env vars. Set FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD');
    process.exit(2);
  }

  const config = {
    apiKey: FIREBASE_API_KEY,
    projectId: FIREBASE_PROJECT_ID,
  };
  if (FIREBASE_AUTH_DOMAIN) config.authDomain = FIREBASE_AUTH_DOMAIN;

  if (!firebase.apps.length) {
    firebase.initializeApp(config);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  try {
    console.log('Signing in automation user...');
    const userCred = await auth.signInWithEmailAndPassword(FIREBASE_ADMIN_EMAIL, FIREBASE_ADMIN_PASSWORD);
    console.log('Signed in as', userCred.user.uid);

    console.log('Reading collections...');
    const [usersSnap, favSnap, sightingsSnap, vendorsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('favorites').get(),
      db.collection('sightings').get(),
      db.collection('vendors').get(),
    ]);

    const totalUsers = usersSnap.size;

    let sumPinned = 0;
    favSnap.forEach(d => {
      const data = d.data();
      if (Array.isArray(data.favorites)) sumPinned += data.favorites.length;
    });
    const avgPinnedPerPerson = totalUsers > 0 ? (sumPinned / totalUsers) : 0;

    const totalReports = sightingsSnap.size;

    const reporterSet = new Set();
    sightingsSnap.forEach(d => {
      const s = d.data();
      const id = s.reporterId || s.reporterEmail || null;
      if (id) reporterSet.add(id);
    });
    const uniqueReporters = reporterSet.size;
    const avgReportsPerUser = uniqueReporters > 0 ? (totalReports / uniqueReporters) : 0;

    let sumConfirmations = 0;
    sightingsSnap.forEach(d => { sumConfirmations += Number(d.data().confirmationCount || 1); });
    const avgIssuesReported = totalReports > 0 ? (sumConfirmations / totalReports) : 0;

    const trucks = new Map();
    sightingsSnap.forEach(d => { const n = d.data().foodTruckName || 'unknown'; trucks.set(n, (trucks.get(n)||0)+1); });
    const avgIssuesPerTruck = trucks.size > 0 ? (totalReports / trucks.size) : 0;

    const oneWeekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const countsThisWeek = {};
    sightingsSnap.forEach(d => {
      const s = d.data();
      let ts = null;
      if (s.timestamp && s.timestamp.toDate) ts = s.timestamp.toDate(); else if (s.timestamp) ts = new Date(s.timestamp);
      if (ts && ts >= oneWeekAgo) {
        const name = s.foodTruckName || 'unknown';
        countsThisWeek[name] = (countsThisWeek[name] || 0) + 1;
      }
    });
    const topTrucksThisWeek = Object.entries(countsThisWeek).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,count])=>({name,count}));

    const vendorDocs = vendorsSnap.docs.map(d=>({id:d.id, ...d.data()}));
    const reportsLast7 = {};
    sightingsSnap.forEach(d => {
      const s = d.data();
      let ts = null;
      if (s.timestamp && s.timestamp.toDate) ts = s.timestamp.toDate(); else if (s.timestamp) ts = new Date(s.timestamp);
      if (ts && ts >= oneWeekAgo) {
        const name = s.foodTruckName || 'unknown';
        reportsLast7[name] = (reportsLast7[name]||0)+1;
      }
    });
    const perVendorPerDay = vendorDocs.length > 0 ? (vendorDocs.reduce((sum,v)=>sum + ((reportsLast7[v.truckName]||0)/7),0) / vendorDocs.length) : 0;

    const ratings = [];
    vendorDocs.forEach(v => {
      const r = v.avgRating ?? v.rating ?? v.ratingAverage ?? null;
      if (r != null) ratings.push(Number(r));
    });
    const avgRatingPerTruck = ratings.length > 0 ? (ratings.reduce((s,x)=>s+x,0)/ratings.length) : null;
    const topFavoriteVendorThisWeek = ratings.length > 0 ? vendorDocs.filter(v => (v.avgRating??v.rating??v.ratingAverage)!=null).sort((a,b)=>(b.avgRating||b.rating||b.ratingAverage)-(a.avgRating||a.rating||a.ratingAverage))[0] : null;

    const payload = {
      avgPinnedPerPerson,
      totalReports,
      avgReportsPerUser,
      avgIssuesReported,
      avgIssuesPerTruck,
      topTrucksThisWeek,
      perVendorPerDay,
      topFavoriteVendorThisWeek: topFavoriteVendorThisWeek ? { name: topFavoriteVendorThisWeek.truckName || topFavoriteVendorThisWeek.id, rating: topFavoriteVendorThisWeek.avgRating ?? topFavoriteVendorThisWeek.rating ?? topFavoriteVendorThisWeek.ratingAverage } : null,
      avgRatingPerTruck,
      computedAt: new Date().toISOString(),
    };

    await db.collection('adminCache').doc('metrics').set({
      ...payload,
      lastUpdated: firebase.firestore.FieldValue && firebase.firestore.FieldValue.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
    });

    console.log('Wrote adminCache/metrics');
    await auth.signOut();
    process.exit(0);
  } catch (err) {
    console.error('Error computing metrics', err);
    try { await auth.signOut(); } catch(e){}
    process.exit(1);
  }
}

main();
