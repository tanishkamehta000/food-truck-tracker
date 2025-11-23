import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Linking,
  Platform,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker, Callout } from 'react-native-maps';
import { collection, where, onSnapshot, query, getDocs, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove, setDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import * as Location from 'expo-location';
import ReportScreen from './ReportScreen';
import LoginScreen from "./LoginScreen";
import ProfileScreen from './ProfileScreen';
import AsyncStorage from "@react-native-async-storage/async-storage";

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

async function deleteByTruckName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    Alert.alert('Validation', 'Enter a truck name.');
    return;
  }

  try {
    // First try exact match via Firestore query (fast path)
    let docs = [];
    {
      const q = query(collection(db, 'sightings'), where('foodTruckName', '==', trimmed));
      const snap = await getDocs(q);
      docs = snap.docs;
    }

    // Fallback: case-insensitive match (client-side filter) if nothing found
    if (docs.length === 0) {
      const all = await getDocs(collection(db, 'sightings'));
      docs = all.docs.filter(d =>
        String((d.data().foodTruckName || '')).toLowerCase() === trimmed.toLowerCase()
      );
    }

    if (docs.length === 0) {
      Alert.alert('No results', `No sightings found for "${trimmed}".`);
      return;
    }

    await Promise.all(docs.map(d => deleteDoc(d.ref)));
    Alert.alert('Deleted', `Removed ${docs.length} sighting(s) for "${trimmed}".`);
    console.log(`Deleted ${docs.length} docs for ${trimmed}`);
  } catch (err) {
    console.error('Error deleting by truck name:', err);
    Alert.alert('Error', 'Could not delete truck sightings.');
  }
}

// delete everything
async function deleteAllSightings() {
  try {
    const snap = await getDocs(collection(db, 'sightings'));
    if (snap.empty) {
      Alert.alert('No data', 'There are no sightings to delete.');
      return;
    }
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    Alert.alert('Deleted', `Removed ${snap.docs.length} total sightings.`);
    console.log(`Deleted all ${snap.docs.length} docs`);
  } catch (err) {
    console.error('Error deleting all sightings:', err);
    Alert.alert('Error', 'Could not delete all sightings.');
  }
}
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function MapScreen({ navigation, route }) {
  const [devDeleteName, setDevDeleteName] = useState('');
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [sightings, setSightings] = useState([]);
  const [mapRegion, setMapRegion] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [showDebug, setShowDebug] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  const [selected, setSelected] = useState(null); // the clicked sighting
  const [sheetVisible, setSheetVisible] = useState(false);
  const [popular, setPopular] = useState([]);     // array of strings, aggregated
  const [confirmCount, setConfirmCount] = useState(0);
  const [lastConfirmedMin, setLastConfirmedMin] = useState(null);

  useEffect(() => {
    requestLocationPermission();
    clearOldSightings();
    const unsub = setupFirebaseListener();
  
    // Create Android notification channel
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
          console.log('Android notification channel set');
        }
      } catch (err) {
        console.warn('Failed to set Android notification channel', err);
      }
    })();
  
    // Load user type/email
    (async () => {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      setUserType(type);
      setUserEmail(email);
    })();
  
    return () => {
      if (unsub) unsub();
    };
  }, []);
  

  useEffect(() => {
    if (!userEmail || userType !== 'user') {
      setFavorites([]);
      return;
    }

    const favRef = doc(db, 'favorites', userEmail);
    const unsub = onSnapshot(favRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setFavorites(data.favorites || []);
      } else {
        setFavorites([]);
      }
    }, (err) => console.error('favorites onSnapshot error (map):', err));

    return () => unsub();
  }, [userEmail, userType]);

  // truck focus
  useEffect(() => {
    const focusName = route?.params?.focusTruckName;
    if (!focusName) return;

    const match = sightings.find(s => s.foodTruckName === focusName && s.location && typeof s.location.latitude === 'number' && typeof s.location.longitude === 'number');
    if (match) {
      const { latitude, longitude } = match.location;
      const region = {
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      try {
        if (mapRef.current && mapRef.current.animateToRegion) {
          mapRef.current.animateToRegion(region, 500);
        } else {
          setMapRegion(region);
        }

        setTimeout(() => {
          const ref = markerRefs.current[match.id];
          if (ref && ref.showCallout) {
            try { ref.showCallout(); } catch (e) { console.warn('showCallout failed', e); }
          }
        }, 600);
      } catch (err) {
        console.error('focus error', err);
      }
    }

    try { navigation.setParams({ focusTruckName: null }); } catch (e) { /* ignore */ }
  }, [route?.params, sightings]);

  function getCrowdTextColor(level) {
    if (level === 'Busy') return '#CC0000';
    if (level === 'Moderate') return '#C9A900';
    if (level === 'Light') return '#2E7D32';
    return '#6B7280';
  }

  // distance helper (meters)
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // open the bottom sheet and aggregate details for this truck
  async function openTruckSheet(sighting) {
    try {
      setSelected(sighting);

      // fetch all sightings of the same truck (e.g., last 24h is typical — you can add a date filter later)
      const snap = await getDocs(
        query(collection(db, 'sightings'), where('foodTruckName', '==', sighting.foodTruckName))
      );

      // aggregate popular items + verification stats + latest notes timestamp
      const itemsFreq = {};
      let latestISO = null;
      let latestNotes = sighting.additionalNotes || '';
      let verifiedCount = 0;

      snap.forEach((d) => {
        const data = d.data();

        // collect popular items users reported on ReportScreen (favoriteItems: string[])
        if (Array.isArray(data.favoriteItems)) {
          data.favoriteItems.forEach((it) => {
            const key = String(it || '').trim();
            if (!key) return;
            itemsFreq[key] = (itemsFreq[key] || 0) + 1;
          });
        }

        if (data.status === 'verified') verifiedCount += 1;

        // pick freshest description
        const raw = data.timestamp || data.verifiedAt || data.createdAt;
        const ts = raw ? new Date(raw) : null;
        if (ts && (!latestISO || ts > new Date(latestISO))) {
          latestISO = ts.toISOString();
          if ((data.additionalNotes || '').trim()) {
            latestNotes = data.additionalNotes;
          }
        }
      });

      // turn frequency map into top chips
      const popularItems = Object.entries(itemsFreq)
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)
        .slice(0, 8);

      setPopular(popularItems);
      setConfirmCount(verifiedCount);
      setLastConfirmedMin(
        latestISO ? Math.max(0, Math.round((Date.now() - new Date(latestISO).getTime()) / 60000)) : null
      );

      // ensure selected carries the freshest notes for display
      setSelected((prev) => ({ ...prev, additionalNotes: latestNotes }));

      setSheetVisible(true);
    } catch (e) {
      console.error('openTruckSheet error', e);
      setSheetVisible(true); // still show something
    }
  }

  const setupFirebaseListener = () => {
    const q = query(collection(db, 'sightings'));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sightingsData = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        
        const sightingData = {
          id: doc.id,
          ...data,
          
          location: data.location || {
            latitude: data.lat,
            longitude: data.lng
          }
        };
        
        sightingsData.push(sightingData);
      });
      
      const sortedSightings = sightingsData.sort((a, b) => {
        if (a.status === 'verified' && b.status !== 'verified') return -1;
        if (a.status !== 'verified' && b.status === 'verified') return 1;
        return 0;
      });
      
      setSightings(sortedSightings);
      setLastUpdate(Date.now());
      
      console.log('Firebase update - Total sightings:', sortedSightings.length);
      console.log('✅ Verified:', sortedSightings.filter(s => s.status === 'verified').length);
      console.log('⏳ Pending:', sortedSightings.filter(s => s.status === 'pending').length);
      
      // debugging
      sortedSightings.forEach(sighting => {
        const hasLocation = sighting.location && sighting.location.latitude && sighting.location.longitude;
        console.log(`📍 ${sighting.foodTruckName}: ${sighting.status} | Location: ${hasLocation ? '✅' : '❌'} | Coords: ${sighting.location?.latitude}, ${sighting.location?.longitude}`);
      });
    });

    return unsubscribe;
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
    
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        setLoading(false);
        Alert.alert(
          'Location Permission',
          'We need your location permission to show you on the map and help you find food trucks nearby.',
          [{ text: 'OK' }]
        );
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const userRegion = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
      
      setLocation(currentLocation.coords);
      setMapRegion(userRegion);
      setLoading(false);
      
      console.log('📍 Your location:', currentLocation.coords.latitude, currentLocation.coords.longitude);
    } catch (error) {
      setErrorMsg('Error getting location');
      setLoading(false);
      console.error(error);
    }
  };

  const getMarkerColor = (crowdLevel) => {
    if (crowdLevel === 'Light') return 'green';
    if (crowdLevel === 'Moderate') return 'yellow';
    if (crowdLevel === 'Busy') return 'red';
    return 'gray'; // fallback
  };

  const getMarkerDescription = (sighting) => {
    if (sighting.status === 'pending') {
      return `${sighting.cuisineType} • ${sighting.crowdLevel} • ⏳ Pending Verification`;
    }
    return `${sighting.cuisineType} • ${sighting.crowdLevel} • ✅ Verified`;
  };

  // Only show markers with valid coordinates
  const getValidMarkers = () => {
    const validMarkers = sightings.filter(sighting => {
      const hasValidCoords = sighting.location && 
                            sighting.location.latitude && 
                            sighting.location.longitude &&
                            typeof sighting.location.latitude === 'number' &&
                            typeof sighting.location.longitude === 'number';
      
      if (!hasValidCoords) {
        console.log('❌ Skipping invalid marker:', sighting.foodTruckName, 'Location:', sighting.location);
      }
      
      return hasValidCoords;
    });

    // Group by food truck name and location to handle duplicates
    const groupedMarkers = {};
    validMarkers.forEach(marker => {
      const key = `${marker.foodTruckName}_${marker.location.latitude}_${marker.location.longitude}`;
      if (!groupedMarkers[key] || marker.status === 'verified') {
        groupedMarkers[key] = marker;
      }
    });

    const uniqueMarkers = Object.values(groupedMarkers);
    console.log('Unique markers after grouping:', uniqueMarkers.length);
    
    return uniqueMarkers;
  };

  const toggleFavorite = async (sighting) => {
    console.log('toggleFavorite called for', sighting.foodTruckName);
    if (!userEmail) {
      Alert.alert('Not logged in', 'Please log in to pin trucks.');
      return;
    }

    if (userType !== 'user') {
      Alert.alert('Not allowed', 'Only users can pin trucks.');
      return;
    }

    const name = sighting.foodTruckName;
    const favRef = doc(db, 'favorites', userEmail);

    try {
      const isFavorited = favorites && favorites.includes(name);
      if (isFavorited) {
        await updateDoc(favRef, { favorites: arrayRemove(name) });
      } else {
        try {
          await updateDoc(favRef, { favorites: arrayUnion(name) });
        } catch (err) {
          
          await setDoc(favRef, { favorites: [name] });
        }
      }
    } catch (err) {
      console.error('toggleFavorite error', err);
      Alert.alert('Error', 'Could not update favorites.');
    }
  };

  async function clearOldSightings() {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours
      
      const snap = await getDocs(collection(db, "sightings"));
      const deletions = [];
  
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const timestamp = data.timestamp;
        
        // deleting 
        if (timestamp) {
          const sightingTime = new Date(timestamp);
          if (sightingTime < cutoff && data.status !== "verified") {
            deletions.push(deleteDoc(doc(db, "sightings", docSnap.id)));
          }
        }
      });
  
      if (deletions.length > 0) {
        await Promise.all(deletions);
        console.log(`Cleared ${deletions.length} old sightings (older than 24 hours)`);
      }
    } catch (err) {
      console.error("Error clearing old sightings:", err);
    }
  }

  const handleRefresh = async () => {
    try {
      setLoading(true);
      await requestLocationPermission();
      await clearOldSightings();
      setupFirebaseListener();
      setLoading(false);
      console.log("Map refreshed successfully");
    } catch (error) {
      console.error("Error refreshing map:", error);
      setLoading(false);
      Alert.alert("Error", "Unable to refresh the map right now.");
    }
  };

  const centerOnMarkers = () => {
    const validMarkers = getValidMarkers();
    if (validMarkers.length > 0 && location) {
      const allLatitudes = [location.latitude, ...validMarkers.map(m => m.location.latitude)];
      const allLongitudes = [location.longitude, ...validMarkers.map(m => m.location.longitude)];
      
      const minLat = Math.min(...allLatitudes);
      const maxLat = Math.max(...allLatitudes);
      const minLng = Math.min(...allLongitudes);
      const maxLng = Math.max(...allLongitudes);
      
      const newRegion = {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: (maxLat - minLat) * 1.5,
        longitudeDelta: (maxLng - minLng) * 1.5,
      };
      
      setMapRegion(newRegion);
      console.log('Centered map on markers');
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setShowDebug(!showDebug)} style={{ marginRight: 15 }}>
            <Text style={{ fontSize: 24, color: '#007AFF' }}>🐛</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={{ marginRight: 15 }}>
            <Text style={{ fontSize: 32, fontWeight: '700', color: '#007AFF' }}>⟳</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, showDebug]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  if (errorMsg) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{errorMsg}</Text>
        <Text style={styles.errorSubtext}>Please enable location permissions in settings.</Text>
      </View>
    );
  }

  const validMarkers = getValidMarkers();
  console.log(' endering markers:', validMarkers.length, 'valid out of', sightings.length, 'total');
  console.log('Marker status breakdown:', {
    verified: validMarkers.filter(m => m.status === 'verified').length,
    pending: validMarkers.filter(m => m.status === 'pending').length
  });

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        region={mapRegion} 
        showsUserLocation={true}
        showsMyLocationButton={true}
        onMapReady={() => console.log('Map is ready')}
      >
        {/* Current user location */}
        {location && (
          <Marker
            coordinate={{
              latitude: location.latitude,
              longitude: location.longitude,
            }}
            title="You are here"
            description="Your current location"
            pinColor="purple"
          />
        )}
        
        {/* Food truck sightings - Only valid markers */}
        {validMarkers.map((sighting) => {
          const markerColor = getMarkerColor(sighting.crowdLevel);
          console.log(`📍 Rendering marker: ${sighting.foodTruckName} with color: ${markerColor} (status: ${sighting.status})`);

          const isFavorited = favorites && favorites.includes(sighting.foodTruckName);

          return (
            <Marker
              ref={(ref) => { if (ref) markerRefs.current[sighting.id] = ref; }}
              key={sighting.id}
              coordinate={{
                latitude: sighting.location.latitude,
                longitude: sighting.location.longitude,
              }}
              title={sighting.foodTruckName}
              description={getMarkerDescription(sighting)}
              pinColor={markerColor}
              onPress={() => openTruckSheet(sighting)}
              onCalloutPress={() => toggleFavorite(sighting)}
            >
              <Callout tooltip={false} onPress={() => { /* noop */ }}>
                <View style={styles.calloutContainer}>
                  <Text style={styles.calloutTitle}>{sighting.foodTruckName}</Text>
                  <Text style={styles.calloutDesc}>{getMarkerDescription(sighting)}</Text>
                  {userType === 'user' ? (
                    <TouchableOpacity
                      style={[styles.pinButton, isFavorited ? styles.unpinStyle : styles.pinStyle]}
                      onPress={() => toggleFavorite(sighting)}
                    >
                      <Text style={styles.pinButtonText}>{isFavorited ? 'Unpin' : 'Pin'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={styles.calloutNote}>Only users can pin trucks</Text>
                  )}
                </View>
              </Callout>
            </Marker>
          );
        })}
      </MapView>

      {/* Truck detail bottom-sheet */}
      <Modal
        animationType="slide"
        transparent
        visible={sheetVisible}
        onRequestClose={() => setSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          {/* tap backdrop to close */}
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setSheetVisible(false)} />
          <View style={styles.sheet}>
            {selected && (
              <>
                {/* Header */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  {/* Placeholder image */}
                  <View style={{
                    width: 52, height: 52, borderRadius: 10, backgroundColor: '#eee', marginRight: 12,
                    alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Text>📷</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 18, fontWeight: '700' }}>{selected.foodTruckName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <View style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#f1f5f9', borderRadius: 6, marginRight: 8 }}>
                        <Text style={{ fontSize: 12 }}>{selected.cuisineType || '—'}</Text>
                      </View>
                      <Text>⭐ 4.8</Text>
                    </View>
                  </View>

                  <TouchableOpacity onPress={() => setSheetVisible(false)}>
                    <Text style={{ fontSize: 18 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                {/* Stats row (compact 2x2 like the mock) */}
                {(() => {
                  const hasLoc = !!location && !!selected?.location;
                  const distM = hasLoc
                    ? distanceMeters(
                        location.latitude, location.longitude,
                        selected.location.latitude, selected.location.longitude
                      )
                    : null;
                  const mins = distM != null ? Math.max(1, Math.round(distM / 80)) : null; // ~80 m/min walk
                  const miles = distM != null ? (distM / 1609.34).toFixed(1) : null;

                  return (
                    <>
                      <View style={styles.statGrid}>
                        {/* Left column: time + distance */}
                        <View style={styles.statCol}>
                          <View style={styles.statItem}>
                            <Text style={styles.statIcon}>🕒</Text>
                            <Text style={styles.statText}>{mins != null ? `${mins} min` : '—'}</Text>
                          </View>
                          <View style={styles.statItem}>
                            <Text style={styles.statIcon}>📍</Text>
                            <Text style={styles.statText}>{miles != null ? `${miles} mi` : '—'}</Text>
                          </View>
                        </View>

                        {/* Right column: crowd + confirmed time */}
                        <View style={styles.statCol}>
                          <View style={styles.statItem}>
                            <Text style={styles.statIcon}>👥</Text>
                            <Text style={[styles.statText, { color: getCrowdTextColor(selected.crowdLevel), fontWeight: '600' }]}>
                              {selected.crowdLevel ? `${selected.crowdLevel} crowd` : '—'}
                            </Text>
                          </View>
                          <View style={styles.statItem}>
                            <Text style={styles.statIcon}>✔︎</Text>
                            <Text style={styles.statText}>
                              {lastConfirmedMin != null ? `Confirmed ${lastConfirmedMin} min ago` : 'Confirmed recently'}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.statDivider} />
                    </>
                  );
                })()}

                {/* Description */}
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontSize: 14, color: '#444' }}>
                    {selected.additionalNotes?.trim() || 'No description yet.'}
                  </Text>
                </View>

                {/* Popular items */}
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontWeight: '700', marginBottom: 6 }}>Popular Items</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {(popular.length ? popular : ['Carne Asada','Fish Tacos','Carnitas','Elote']).map((item, i) => (
                      <View key={i} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f0f0f0', borderRadius: 16, marginRight: 6, marginBottom: 6 }}>
                        <Text>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* Confirmation count */}
                <View style={{ marginTop: 12 }}>
                  <Text style={{ fontSize: 12, color: '#666' }}>
                    Location confirmed by {Math.max(confirmCount, 1)} user{Math.max(confirmCount, 1) === 1 ? '' : 's'}
                  </Text>
                </View>

                {/* Actions */}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  <TouchableOpacity
                    onPress={() => Alert.alert('Thanks!', 'Your confirmation has been recorded (prototype).')}
                    style={{ paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#f5f5f5', borderRadius: 10, marginRight: 10 }}
                  >
                    <Text>✅ Confirm</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setSheetVisible(false);
                      navigation.navigate('Report');
                    }}
                    style={{ paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#f5f5f5', borderRadius: 10 }}
                  >
                    <Text>🚩 Report</Text>
                  </TouchableOpacity>
                </View>

                {/* Navigate CTA */}
                <TouchableOpacity
                  onPress={() => {
                    const { latitude, longitude } = selected.location;
                    const url = Platform.select({
                      ios: `http://maps.apple.com/?daddr=${latitude},${longitude}`,
                      android: `geo:0,0?q=${latitude},${longitude}(${encodeURIComponent(selected.foodTruckName)})`,
                    });
                    Linking.openURL(url);
                  }}
                  style={{ marginTop: 16, backgroundColor: '#0B0B14', padding: 14, borderRadius: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: 'white', fontWeight: '700' }}>▸ Navigate to {selected.foodTruckName}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
      
      {/* Debug Panel */}
      {showDebug && (
        <View style={styles.debugPanel}>
          <Text style={styles.debugText}>DEBUG INFO - VERIFICATION STATUS</Text>
          <Text style={styles.debugText}>Your Location: {location ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : 'Unknown'}</Text>
          <Text style={styles.debugText}>Total Sightings: {sightings.length}</Text>
          <Text style={styles.debugText}>Valid Markers: {validMarkers.length}</Text>
          <Text style={styles.debugText}>✅ Verified: {validMarkers.filter(m => m.status === 'verified').length}</Text>
          <Text style={styles.debugText}>⏳ Pending: {validMarkers.filter(m => m.status === 'pending').length}</Text>
          {validMarkers.map((marker, index) => (
            <Text key={marker.id} style={[
              styles.debugText,
              marker.status === 'verified' ? { color: 'lightgreen', fontWeight: 'bold' } : { color: 'white' }
            ]}>
              {index + 1}. {marker.foodTruckName}: {marker.location.latitude.toFixed(6)}, {marker.location.longitude.toFixed(6)} - {marker.status.toUpperCase()}
            </Text>
          ))}
          <TouchableOpacity onPress={centerOnMarkers} style={styles.debugButton}>
            <Text style={styles.debugButtonText}> Center on Markers</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={[styles.debugButton, { backgroundColor: '#FF9500', marginTop: 5 }]}>
            <Text style={styles.debugButtonText}> Force Refresh</Text>
          </TouchableOpacity>

          {/* Debug input for delete-by-name */}
          <View style={{ marginTop: 10 }}>
            <Text style={[styles.debugText, { fontWeight: '700', marginBottom: 4 }]}>
              Danger Zone (Dev)
            </Text>

            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={[styles.debugText, { width: 80 }]}>Truck:</Text>
              <View style={{ flex: 1, backgroundColor: 'white', borderRadius: 6, paddingHorizontal: 8 }}>
                <TextInput
                  placeholder="Enter exact name"
                  onChangeText={(t) => setDevDeleteName(t)}
                  value={devDeleteName}
                  style={{ height: 34 }}
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={() => deleteByTruckName(devDeleteName)}
              style={[styles.debugButton, { backgroundColor: '#D0021B', marginTop: 6 }]}
            >
              <Text style={styles.debugButtonText}> Delete by Truck Name</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={deleteAllSightings}
              style={[styles.debugButton, { backgroundColor: '#9500FF', marginTop: 6 }]}
            >
              <Text style={styles.debugButtonText}> Delete ALL Sightings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Map Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'green' }]} />
          <Text style={styles.legendText}>Light</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'yellow' }]} />
          <Text style={styles.legendText}>Moderate</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'red' }]} />
          <Text style={styles.legendText}>Busy</Text>
        </View>
      </View>

      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {validMarkers.filter(s => s.status === 'verified').length} Verified • 
          {validMarkers.filter(s => s.status === 'pending').length} Pending •
          Total: {validMarkers.length}
        </Text>
      </View>
    </View>
  );
}

function MainApp() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: { paddingVertical: 5, backgroundColor: 'white' },
      }}
    >
      <Tab.Screen
        name="Map"
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size, color }}>🗺️</Text>,
          title: 'Food Truck Map',
        }}
      >
        {() => (
          <Stack.Navigator>
            <Stack.Screen name="Food Truck Map" component={MapScreen} options={{ title: "Food Truck Map" }} />
          </Stack.Navigator>
        )}
      </Tab.Screen>

      <Tab.Screen
        name="Report"
        component={ReportScreen}
        options={{
          title: 'Report Sighting',
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size, color }}>📝</Text>,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size, color }}>👤</Text>,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasUserType, setHasUserType] = useState(false);

  useEffect(() => {
    const checkUserType = async () => {
      const userType = await AsyncStorage.getItem("userType");
      setHasUserType(!!userType);
      setLoading(false);
    };
    checkUserType();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="MainApp" component={MainApp} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { width: '100%', height: '100%' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  legend: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 130,
  },
  legendTitle: { fontWeight: 'bold', marginBottom: 5, fontSize: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  legendColor: { width: 12, height: 12, borderRadius: 6, marginRight: 5 },
  legendText: { fontSize: 10 },
  statsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 10,
  },
  statsText: {
    color: 'white',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  debugPanel: {
    position: 'absolute',
    top: 150,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    padding: 10,
    borderRadius: 8,
    maxHeight: 300,
  },
  debugText: {
    color: 'white',
    fontSize: 10,
    marginBottom: 2,
  },
  debugButton: {
    backgroundColor: '#007AFF',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
    marginTop: 5,
  },
  debugButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  calloutContainer: {
    width: 200,
    padding: 8,
    backgroundColor: 'white',
    borderRadius: 8,
    alignItems: 'center',
  },
  calloutTitle: { fontWeight: '700', marginBottom: 4 },
  calloutDesc: { fontSize: 12, color: '#444', marginBottom: 8, textAlign: 'center' },
  pinButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  pinButtonText: { color: 'white', fontWeight: '700' },
  pinStyle: { backgroundColor: '#007AFF' },
  unpinStyle: { backgroundColor: '#FF3B30' },
  calloutNote: { fontSize: 12, color: '#666' },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: 'white',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '85%',
  },
  statGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 8,
  },
  statCol: { flex: 1 },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statIcon: {
    width: 18,
    textAlign: 'center',
    marginRight: 6,
    color: '#6B7280', // gray-600
  },
  statText: {
    fontSize: 12,
    color: '#6B7280', // gray-600
  },
  statDivider: {
    height: 1,
    backgroundColor: '#E5E7EB', // gray-200
    marginTop: 6,
    marginBottom: 8,
  },
});