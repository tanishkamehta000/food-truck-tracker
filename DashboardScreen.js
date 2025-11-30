import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebaseConfig';

export default function DashboardScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [cachedMetrics, setCachedMetrics] = useState(null);
  
  //now have a new thing for feature flags (just for now since we actually have another dashboard that we ended up using for tracking
  const [verificationMode, setVerificationMode] = useState('blocking');
  const [verificationMethod, setVerificationMethod] = useState('both');
  const [savingFlag, setSavingFlag] = useState(false);

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }
    fetchUsers();
    loadFeatureFlag();
    fetchCachedMetrics();
  }, []);

  const fetchCachedMetrics = async () => {
    try {
      const ref = doc(db, 'adminCache', 'metrics');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() || {};
        setCachedMetrics(data);
      } else {
        setCachedMetrics(null);
      }
    } catch (err) {
      console.error('Failed to load cached metrics', err);
    }
  };

  const loadFeatureFlag = async () => {
    try {
      const flagRef = doc(db, 'featureFlags', 'vendorVerification');
      const snap = await getDoc(flagRef);
      if (snap.exists()) {
        const data = snap.data() || {};
        setVerificationMode(data.mode || 'blocking');
        setVerificationMethod(data.method || 'both');
      }
    } catch (err) {
      console.error('Failed to load feature flag', err);
    }
  };

  const updateVerificationMode = async (newMode) => {
    setSavingFlag(true);
    try {
      const flagRef = doc(db, 'featureFlags', 'vendorVerification');
      const existing = (await getDoc(flagRef)).data() || {};
      await setDoc(flagRef, {
        ...existing,
        mode: newMode,
        enabled: true,
        lastUpdated: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'unknown',
        description: 'Controls vendor verification UX flow'
      });
      setVerificationMode(newMode);
      Alert.alert('Success', `Verification mode set to: ${newMode}`);
    } catch (err) {
      console.error('Failed to update feature flag', err);
      Alert.alert('Error', 'Could not update feature flag');
    } finally {
      setSavingFlag(false);
    }
  };

  const updateVerificationMethod = async (newMethod) => {
    setSavingFlag(true);
    try {
      const flagRef = doc(db, 'featureFlags', 'vendorVerification');
      const existing = (await getDoc(flagRef)).data() || {};
      await setDoc(flagRef, {
        ...existing,
        method: newMethod,
        enabled: true,
        lastUpdated: new Date().toISOString(),
        updatedBy: auth.currentUser?.email || 'unknown',
      });
      setVerificationMethod(newMethod);
      Alert.alert('Success', `Verification method set to: ${newMethod}`);
    } catch (err) {
      console.error('Failed to update feature flag', err);
      Alert.alert('Error', 'Could not update feature flag');
    } finally {
      setSavingFlag(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, 'users'));
      setUserCount(snap.size);
      setDocs(snap.docs.map(d => ({ id: d.id, data: d.data() })));
    } catch (err) {
      console.error('Failed to fetch users count', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const computeMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersSnap, favSnap, sightingsSnap, vendorsSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'favorites')),
        getDocs(collection(db, 'sightings')),
        getDocs(collection(db, 'vendors')),
      ]);

      const totalUsers = usersSnap.size;

      // avg pinned trucks per person (/total users)
      let sumPinned = 0;
      favSnap.forEach(d => {
        const data = d.data();
        if (Array.isArray(data.favorites)) sumPinned += data.favorites.length;
      });
      const avgPinnedPerPerson = totalUsers > 0 ? (sumPinned / totalUsers) : 0;

      const totalReports = sightingsSnap.size;

      // this should be avg reports per user
      const reporterSet = new Set();
      sightingsSnap.forEach(d => {
        const s = d.data();
        const id = s.reporterId || s.reporterEmail || null;
        if (id) reporterSet.add(id);
      });
      const uniqueReporters = reporterSet.size;
      const avgReportsPerUser = uniqueReporters > 0 ? (totalReports / uniqueReporters) : 0;

      // avg issues reported vs confirmation counts
      let sumConfirmations = 0;
      sightingsSnap.forEach(d => { sumConfirmations += Number(d.data().confirmationCount || 1); });
      const avgIssuesReported = totalReports > 0 ? (sumConfirmations / totalReports) : 0;

      // avg issues reported for truck
      const trucks = new Map();
      sightingsSnap.forEach(d => { const n = d.data().foodTruckName || 'unknown'; trucks.set(n, (trucks.get(n)||0)+1); });
      const avgIssuesPerTruck = trucks.size > 0 ? (totalReports / trucks.size) : 0;

      // top 3 truck sightings (how many sightings each truck has)
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

      // avg reports per day per vendor
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

      // ratings: must compute avg
      const ratings = [];
      vendorDocs.forEach(v => {
        const r = v.avgRating ?? v.rating ?? v.ratingAverage ?? null;
        if (r != null) ratings.push(Number(r));
      });
      const avgRatingPerTruck = ratings.length > 0 ? (ratings.reduce((s,x)=>s+x,0)/ratings.length) : null;
      const topFavoriteVendorThisWeek = ratings.length > 0 ? vendorDocs.filter(v => (v.avgRating??v.rating??v.ratingAverage)!=null).sort((a,b)=>(b.avgRating||b.rating||b.ratingAverage)-(a.avgRating||a.rating||a.ratingAverage))[0] : null;

      setMetrics({
        avgPinnedPerPerson,
        totalReports,
        avgReportsPerUser,
        avgIssuesReported,
        avgIssuesPerTruck,
        topTrucksThisWeek,
        perVendorPerDay,
        topFavoriteVendorThisWeek: topFavoriteVendorThisWeek ? { name: topFavoriteVendorThisWeek.truckName || topFavoriteVendorThisWeek.id, rating: topFavoriteVendorThisWeek.avgRating ?? topFavoriteVendorThisWeek.rating ?? topFavoriteVendorThisWeek.ratingAverage } : null,
        avgRatingPerTruck,
      });

    } catch (err) {
      console.error('computeMetrics failed', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!auth.currentUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <View style={styles.card}>
          <Text style={{ marginBottom: 8 }}>You must be signed in to view admin data.</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginButton}>
            <Text style={styles.loginButtonText}>Go to Login</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  //if something goes wrong we'll try to figure it out 
  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <View style={[styles.card, { backgroundColor: '#ffeeee' }]}>
          <Text style={{ color: '#a00', fontWeight: '700', marginBottom: 8 }}>Permission error</Text>
          <Text style={{ color: '#333', marginBottom: 8 }}>{String(error.message || error)}</Text>
          <Text style={{ color: '#444', marginTop: 6 }}>
            Your Firestore rules are blocking the listing of the <Text style={{ fontWeight: '700' }}>users</Text> collection.
          </Text>

          <View style={{ backgroundColor: '#fff', padding: 8, marginTop: 8, borderRadius: 6 }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
{`match /databases/{database}/documents {
  match /users/{userId} {
    allow read: if request.auth != null &&
      (request.auth.uid == userId ||
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true);
    allow write: if request.auth != null && request.auth.uid == userId;
  }
}`}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Admin Dashboard</Text>

      {/* this is for feature flags */}
      <View style={[styles.card, { marginBottom: 16 }]}>
        <Text style={styles.sectionTitle}>Feature Flags</Text>
        
        <View style={{ marginTop: 12 }}>
          <Text style={{ fontWeight: '600', marginBottom: 8 }}>
            Vendor Verification Mode: <Text style={{ color: '#007AFF' }}>{verificationMode}</Text>
          </Text>
          
          <View style={{ flexDirection: 'row', marginBottom: 12 }}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                verificationMode === 'blocking' && styles.modeButtonActive
              ]}
              onPress={() => updateVerificationMode('blocking')}
              disabled={savingFlag}
            >
              <Text style={[
                styles.modeButtonText,
                verificationMode === 'blocking' && styles.modeButtonTextActive
              ]}>
                Block Access
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[
                styles.modeButton,
                verificationMode === 'non-blocking' && styles.modeButtonActive,
                { marginLeft: 8 }
              ]}
              onPress={() => updateVerificationMode('non-blocking')}
              disabled={savingFlag}
            >
              <Text style={[
                styles.modeButtonText,
                verificationMode === 'non-blocking' && styles.modeButtonTextActive
              ]}>
                Banner Only
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={{ fontWeight: '600', marginBottom: 8 }}>
              Verification Method: <Text style={{ color: '#007AFF' }}>{verificationMethod}</Text>
            </Text>

            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              <TouchableOpacity
                style={[styles.modeButton, verificationMethod === 'photo' && styles.modeButtonActive]}
                onPress={() => updateVerificationMethod('photo')}
                disabled={savingFlag}
              >
                <Text style={[styles.modeButtonText, verificationMethod === 'photo' && styles.modeButtonTextActive]}>Photo Proof</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeButton, verificationMethod === 'community' && styles.modeButtonActive, { marginLeft: 8 }]}
                onPress={() => updateVerificationMethod('community')}
                disabled={savingFlag}
              >
                <Text style={[styles.modeButtonText, verificationMethod === 'community' && styles.modeButtonTextActive]}>Crowd Approval</Text>
              </TouchableOpacity>

            </View>

            {savingFlag && (
              <ActivityIndicator style={{ marginTop: 8 }} color="#007AFF" />
            )}

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                <Text style={{ fontWeight: '700' }}>Blocking:</Text> Unverified vendors cannot access Report/Profile/Discover tabs
              </Text>
              <Text style={styles.infoText}>
                <Text style={{ fontWeight: '700' }}>Banner:</Text> Unverified vendors see reminder banner but have full access
              </Text>
            </View>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}><Text style={{ fontWeight: '700' }}>Photo Proof:</Text> Vendors must submit photo verification to be approved.</Text>
              <Text style={styles.infoText}><Text style={{ fontWeight: '700' }}>Crowd Approval:</Text> Vendors may be verified automatically via community confirmations.</Text>
            </View>
          </View>
          
          {savingFlag && (
            <ActivityIndicator style={{ marginTop: 8 }} color="#007AFF" />
          )}
          
        </View>
      </View>

      {/* this is the same as before with metrics */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>📊 Metrics</Text>
        <Text style={styles.metricLabel}>Total users</Text>
        <Text style={styles.metricValue}>{userCount}</Text>

        <TouchableOpacity onPress={fetchUsers} style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={computeMetrics} style={[styles.refreshButton, { marginTop: 10, backgroundColor: '#34A853' }] }>
          <Text style={styles.refreshButtonText}>Get Metrics</Text>
        </TouchableOpacity>

        {(metrics || cachedMetrics) && (
          <View style={{ marginTop: 12, padding: 12, backgroundColor: '#fff', borderRadius: 8 }}>
            <Text style={{ fontWeight: '700', marginBottom: 8 }}>Computed Metrics {cachedMetrics ? '(cached)' : ''}</Text>
            {cachedMetrics && (
              <Text style={{ color: '#666', marginBottom: 8 }}>Last computed: {cachedMetrics.lastUpdated && cachedMetrics.lastUpdated.toDate ? cachedMetrics.lastUpdated.toDate().toLocaleString() : (cachedMetrics.computedAt || 'unknown')}</Text>
            )}
            {(() => {
              const display = cachedMetrics || metrics;
              if (!display) return null;
              return (
                <>
                  <Text>Avg pinned trucks per person: {display.avgPinnedPerPerson != null && display.avgPinnedPerPerson.toFixed ? display.avgPinnedPerPerson.toFixed(2) : String(display.avgPinnedPerPerson)}</Text>
                  <Text>Total reports: {display.totalReports}</Text>
                  <Text>Avg reports per reporting user: {display.avgReportsPerUser != null && display.avgReportsPerUser.toFixed ? display.avgReportsPerUser.toFixed(2) : String(display.avgReportsPerUser)}</Text>
                  <Text>Avg issues reported: {display.avgIssuesReported != null && display.avgIssuesReported.toFixed ? display.avgIssuesReported.toFixed(2) : String(display.avgIssuesReported)}</Text>
                  <Text>Avg issues per truck: {display.avgIssuesPerTruck != null && display.avgIssuesPerTruck.toFixed ? display.avgIssuesPerTruck.toFixed(2) : String(display.avgIssuesPerTruck)}</Text>
                  <Text style={{ marginTop: 8, fontWeight: '700' }}>Top trucks this week:</Text>
                  {(!display.topTrucksThisWeek || display.topTrucksThisWeek.length === 0) ? <Text style={{ color: '#666' }}>No reports this week</Text> : display.topTrucksThisWeek.map(t => (
                    <Text key={t.name}>{t.name} — {t.count}</Text>
                  ))}
                </>
              );
            })()}

            {/** prefer cachedMetrics if present */}
            {(() => {
              const display = cachedMetrics || metrics;
              return (
                <>
                  <Text style={{ marginTop: 8 }}>Avg reports/day per vendor (last 7 days): {display.perVendorPerDay != null && display.perVendorPerDay.toFixed ? display.perVendorPerDay.toFixed(2) : String(display.perVendorPerDay)}</Text>
                  <Text>Top favorite vendor this week: {display.topFavoriteVendorThisWeek ? `${display.topFavoriteVendorThisWeek.name} (${display.topFavoriteVendorThisWeek.rating})` : 'N/A'}</Text>
                  <Text>Avg rating per truck: {display.avgRatingPerTruck != null ? display.avgRatingPerTruck.toFixed(2) : 'N/A'}</Text>
                </>
              );
            })()}
            <View style={{ marginTop: 8, flexDirection: 'row' }}>
              <TouchableOpacity onPress={fetchCachedMetrics} style={[styles.refreshButton, { marginRight: 8, backgroundColor: '#007AFF' }]}>
                <Text style={styles.refreshButtonText}>Refresh Cached</Text>
              </TouchableOpacity>
  
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f5f5f5' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  metricLabel: { color: '#666', marginBottom: 6 },
  metricValue: { fontSize: 28, fontWeight: '800' },

  loginButton: { marginTop: 12, backgroundColor: '#007AFF', padding: 8, borderRadius: 6, alignItems: 'center' },
  loginButtonText: { color: 'white', fontWeight: '700' },

  refreshButton: { marginTop: 12, backgroundColor: '#007AFF', padding: 8, borderRadius: 6, alignItems: 'center' },
  refreshButtonText: { color: 'white', fontWeight: '700' },

  modeButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ddd',
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  modeButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#E3F2FD',
  },
  modeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  modeButtonTextActive: {
    color: '#007AFF',
  },
  infoBox: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 6,
    marginTop: 8,
  },
  infoText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },

  docRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  docId: { fontSize: 12, fontFamily: 'monospace' },
  docData: { fontSize: 12, color: '#444' },
});