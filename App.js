import DiscoverScreen from './DiscoverScreen';
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Linking,
  Platform,
  TextInput, 
  KeyboardAvoidingView, 
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker, Callout } from 'react-native-maps';
import {
  collection,
  where,
  onSnapshot,
  query,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  setDoc,
  getDoc,
  addDoc,  
} from 'firebase/firestore';
import { auth } from './firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { db } from './firebaseConfig';
import * as Location from 'expo-location';
import ReportScreen from './ReportScreen';
import LoginScreen from './LoginScreen';
import ProfileScreen from './ProfileScreen';
import DashboardScreen from './DashboardScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#111', padding: 12 }}>
          <Text style={{ color: 'white', fontWeight: '700', marginBottom: 8 }}>App Error</Text>
          <ScrollView style={{ maxHeight: 400 }}>
            <Text style={{ color: 'white', fontSize: 12 }}>
              {String(this.state.error && this.state.error.toString())}
            </Text>
            <Text style={{ color: '#ccc', marginTop: 8, fontSize: 11 }}>
              {this.state.errorInfo ? this.state.errorInfo.componentStack : ''}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
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
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [userId, setUserId] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const mapRef = useRef(null);
  const markerRefs = useRef({});
  const [selected, setSelected] = useState(null); // the clicked sighting
  const [sheetVisible, setSheetVisible] = useState(false);
  const [popular, setPopular] = useState([]);     // array of strings, aggregated
  const [confirmCount, setConfirmCount] = useState(0);
  const [lastConfirmedMin, setLastConfirmedMin] = useState(null);
  const [reportedIssues, setReportedIssues] = useState([]);    
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueText, setIssueText] = useState('');

  const loadIssuesForTruck = async (truckName) => {
    try {
      const snap = await getDocs(
        query(
          collection(db, 'reportedIssues'),
          where('truckName', '==', truckName)
        )
      );
      const issues = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setReportedIssues(issues);
    } catch (err) {
      console.error('loadIssuesForTruck error', err);
      setReportedIssues([]);
    }
  };

  const submitIssue = async () => {
    const text = issueText.trim();
    if (!selected || !text) {
      Alert.alert('Missing info', 'Please enter an issue description.');
      return;
    }
  
    try {
      await addDoc(collection(db, 'reportedIssues'), {
        truckName: selected.foodTruckName,
        sightingId: selected.id,
        reporterId: userId || null,
        reporterEmail: userEmail || null,
        description: text,
        createdAt: new Date().toISOString(),
      });
  
      setIssueText('');
      setIssueModalVisible(false);
  
      // reload issues so the new one appears in the list
      await loadIssuesForTruck(selected.foodTruckName);
      Alert.alert('Thank you', 'Your issue has been reported.');
    } catch (err) {
      console.error('submitIssue error', err);
      Alert.alert('Error', 'Could not submit issue.');
    }
  };




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
      const id = await AsyncStorage.getItem('userId');
      setUserType(type);
      setUserEmail(email);
      setUserId(id);
    })();
  
    return () => {
      if (unsub) unsub();
    };
  }, []);
  

  useEffect(() => {
    if (!(userId || userEmail) || userType !== 'user') {
      setFavorites([]);
      return;
    }

    const docKey = userId || userEmail;
    const favRef = doc(db, 'favorites', docKey);
    const unsub = onSnapshot(favRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setFavorites(data.favorites || []);
      } else {
        setFavorites([]);
      }
    }, (err) => console.error('favorites onSnapshot error (map):', err));

    return () => unsub();
  }, [userId, userEmail, userType]);

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

      await loadIssuesForTruck(sighting.foodTruckName);

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
      console.log('Verified:', sortedSightings.filter(s => s.status === 'verified').length);
      console.log('Pending:', sortedSightings.filter(s => s.status === 'pending').length);
      
      // debugging
      sortedSightings.forEach(sighting => {
        const hasLocation = sighting.location && sighting.location.latitude && sighting.location.longitude;
        console.log(`${sighting.foodTruckName}: ${sighting.status} | Location: ${hasLocation ? 'true' : 'false'} | Coords: ${sighting.location?.latitude}, ${sighting.location?.longitude}`);
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
      
      console.log('Your location:', currentLocation.coords.latitude, currentLocation.coords.longitude);
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
      return `${sighting.cuisineType} • ${sighting.crowdLevel} • Verification: Pending `;
    }
    return `${sighting.cuisineType} • ${sighting.crowdLevel} • Verification: Verified`;
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
        console.log('Skipping invalid marker:', sighting.foodTruckName, 'Location:', sighting.location);
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
    if (!(userId || userEmail)) {
      Alert.alert('Not logged in', 'Please log in to pin trucks.');
      return;
    }

    if (userType !== 'user') {
      Alert.alert('Not allowed', 'Only users can pin trucks.');
      return;
    }

    const name = sighting.foodTruckName;
    const docKey = userId || userEmail;
    const favRef = doc(db, 'favorites', docKey);

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

  const fetchAdminOnce = async () => {
    try {
      const uid = auth?.currentUser?.uid || (await AsyncStorage.getItem('userId'));
      if (!uid) return Alert.alert('No user', 'Not signed in or no stored userId');
      const uref = doc(db, 'users', uid);
      const snap = await getDoc(uref);
      if (!snap.exists()) return Alert.alert('User doc not found', `users/${uid} does not exist`);
      const data = snap.data();
      return Alert.alert('User doc', `uid: ${uid}\nadmin: ${!!data.isAdmin}\n\n${JSON.stringify(data, null, 2)}`);
    } catch (err) {
      return Alert.alert('Fetch error', String(err.message || err));
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={fetchAdminOnce} style={{ marginRight: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#007AFF' }}>Check</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={{ marginRight: 15 }}>
            <Text style={{ fontSize: 32, fontWeight: '700', color: '#007AFF' }}>⟳</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

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
  
        {/* Food truck sightings */}
        {validMarkers.map((sighting) => {
          const markerColor = getMarkerColor(sighting.crowdLevel);
          const isFavorited = favorites && favorites.includes(sighting.foodTruckName);
  
          return (
            <Marker
              ref={(ref) => {
                if (ref) markerRefs.current[sighting.id] = ref;
              }}
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
              <Callout tooltip={false}>
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
        onRequestClose={() => {
          setSheetVisible(false);
          setIssueModalVisible(false); // reset when closing sheet
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={80} // tweak if it’s still a bit low/high
        >
          <View style={styles.sheetBackdrop}>
            {/* tap backdrop to close */}
            <TouchableOpacity
              style={{ flex: 1 }}
              onPress={() => {
                setSheetVisible(false);
                setIssueModalVisible(false);
              }}
            />

            <View style={styles.sheet}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {/* === DETAILS VIEW === */}
                {selected && !issueModalVisible && (
                  <>
                    {/* Header */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <View
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 10,
                          backgroundColor: '#eee',
                          marginRight: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text>📷</Text>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700' }}>{selected.foodTruckName}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                          <View
                            style={{
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              backgroundColor: '#f1f5f9',
                              borderRadius: 6,
                              marginRight: 8,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>{selected.cuisineType || '—'}</Text>
                          </View>
                          <Text>⭐ 4.8</Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => {
                          setSheetVisible(false);
                          setIssueModalVisible(false);
                        }}
                      >
                        <Text style={{ fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Stats */}
                    {(() => {
                      const hasLoc = !!location && !!selected?.location;
                      const distM = hasLoc
                        ? distanceMeters(
                            location.latitude,
                            location.longitude,
                            selected.location.latitude,
                            selected.location.longitude
                          )
                        : null;

                      const mins = distM != null ? Math.max(1, Math.round(distM / 80)) : null;
                      const miles = distM != null ? (distM / 1609.34).toFixed(1) : null;

                      return (
                        <>
                          <View style={styles.statGrid}>
                            <View style={styles.statCol}>
                              <View style={styles.statItem}>
                                <Text style={styles.statIcon} />
                                <Text style={styles.statText}>{mins != null ? `${mins} min` : '—'}</Text>
                              </View>
                              <View style={styles.statItem}>
                                <Text style={styles.statIcon} />
                                <Text style={styles.statText}>{miles != null ? `${miles} mi` : '—'}</Text>
                              </View>
                            </View>

                            <View style={styles.statCol}>
                              <View style={styles.statItem}>
                                <Text style={styles.statIcon} />
                                <Text
                                  style={[
                                    styles.statText,
                                    { color: getCrowdTextColor(selected.crowdLevel), fontWeight: '600' },
                                  ]}
                                >
                                  {selected.crowdLevel ? `${selected.crowdLevel} crowd` : '—'}
                                </Text>
                              </View>
                              <View style={styles.statItem}>
                                <Text style={styles.statIcon}>✔︎</Text>
                                <Text style={styles.statText}>
                                  {lastConfirmedMin != null
                                    ? `Confirmed ${lastConfirmedMin} min ago`
                                    : 'Confirmed recently'}
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
                        {(popular.length ? popular : ['Carne Asada', 'Fish Tacos', 'Carnitas', 'Elote']).map(
                          (item, i) => (
                            <View
                              key={i}
                              style={{
                                paddingVertical: 6,
                                paddingHorizontal: 10,
                                backgroundColor: '#f0f0f0',
                                borderRadius: 16,
                                marginRight: 6,
                                marginBottom: 6,
                              }}
                            >
                              <Text>{item}</Text>
                            </View>
                          )
                        )}
                      </View>
                    </View>

                    {/* Confirmation count */}
                    <View style={{ marginTop: 12 }}>
                      <Text style={{ fontSize: 12, color: '#666' }}>
                        Location confirmed by {Math.max(confirmCount, 1)} user
                        {Math.max(confirmCount, 1) === 1 ? '' : 's'}
                      </Text>
                    </View>

                    {/* Issues summary */}
                    <View style={{ marginTop: 8 }}>
                      <Text style={{ fontSize: 12, color: '#666', fontWeight: '600' }}>
                        {reportedIssues.length} issue{reportedIssues.length === 1 ? '' : 's'} reported
                      </Text>

                      {reportedIssues.length > 0 && (
                        <View style={{ marginTop: 6 }}>
                          {reportedIssues.slice(0, 3).map((issue) => (
                            <View key={issue.id} style={{ marginBottom: 4 }}>
                              <Text style={{ fontSize: 12, color: '#444' }}>• {issue.description}</Text>
                              {issue.createdAt && (
                                <Text style={{ fontSize: 10, color: '#999' }}>
                                  {new Date(issue.createdAt).toLocaleString()}
                                </Text>
                              )}
                            </View>
                          ))}
                          {reportedIssues.length > 3 && (
                            <Text style={{ fontSize: 11, color: '#007AFF', marginTop: 4 }}>
                              + {reportedIssues.length - 3} more…
                            </Text>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                      <TouchableOpacity
                        onPress={() =>
                          Alert.alert('Thanks!', 'Your confirmation has been recorded (prototype).')
                        }
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          backgroundColor: '#f5f5f5',
                          borderRadius: 10,
                          marginRight: 10,
                        }}
                      >
                        <Text>Confirm</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setIssueModalVisible(true)}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          backgroundColor: '#f5f5f5',
                          borderRadius: 10,
                        }}
                      >
                        <Text>Report issue</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Navigate */}
                    <TouchableOpacity
                      onPress={() => {
                        const { latitude, longitude } = selected.location;
                        const url = Platform.select({
                          ios: `http://maps.apple.com/?daddr=${latitude},${longitude}`,
                          android: `geo:0,0?q=${latitude},${longitude}(${encodeURIComponent(
                            selected.foodTruckName
                          )})`,
                        });
                        Linking.openURL(url);
                      }}
                      style={{
                        marginTop: 16,
                        backgroundColor: '#0B0B14',
                        padding: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: '700' }}>
                        ▸ Navigate to {selected.foodTruckName}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}

                {/* === ISSUE FORM VIEW === */}
                {selected && issueModalVisible && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700' }}>
                          Report an issue for {selected.foodTruckName}
                        </Text>
                      </View>

                      <TouchableOpacity onPress={() => setIssueModalVisible(false)}>
                        <Text style={{ fontSize: 18 }}>✕</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
                      Example: “Truck not here”, “Wrong hours”, “Pin in wrong spot”, etc.
                    </Text>

                    <TextInput
                      style={{
                        borderWidth: 1,
                        borderColor: '#ddd',
                        borderRadius: 8,
                        padding: 10,
                        minHeight: 80,
                        textAlignVertical: 'top',
                        fontSize: 14,
                      }}
                      multiline
                      placeholder="Describe the issue..."
                      value={issueText}
                      onChangeText={setIssueText}
                    />

                    <View style={{ flexDirection: 'row', marginTop: 12, justifyContent: 'flex-end' }}>
                      <TouchableOpacity
                        onPress={() => {
                          setIssueModalVisible(false);
                          setIssueText('');
                        }}
                        style={{ paddingVertical: 10, paddingHorizontal: 14, marginRight: 8 }}
                      >
                        <Text style={{ color: '#555' }}>Cancel</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={submitIssue}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 18,
                          backgroundColor: '#007AFF',
                          borderRadius: 8,
                        }}
                      >
                        <Text style={{ color: 'white', fontWeight: '600' }}>Submit</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

  
      {/* Legend */}
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
  
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {validMarkers.filter((s) => s.status === 'verified').length} Verified •
          {validMarkers.filter((s) => s.status === 'pending').length} Pending •
          Total: {validMarkers.length}
        </Text>
      </View>
    </View>
  );
}  

function MainApp({ isAdmin }) {
  const [loading, setLoading] = useState(true);
  const [vendorVerified, setVendorVerified] = useState(false);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  
  //now have a feature flag state
  const [verificationMode, setVerificationMode] = useState('blocking'); // just defaulting to blocking

  useEffect(() => {
    checkVendorStatus();
    
    // feature flag changes, real time
    const flagRef = doc(db, 'featureFlags', 'vendorVerification');
    const unsubscribe = onSnapshot(
      flagRef,
      (snap) => {
        if (snap.exists()) {
          const mode = snap.data().mode || 'blocking';
          setVerificationMode(mode);
          console.log('Feature flag updated:', mode);
        } else {
          // if flag doesn't exist we need to go back to blocking
          setVerificationMode('blocking');
        }
      },
      (err) => {
        console.error('Feature flag listener error:', err);
        setVerificationMode('blocking');
      }
    );

    return () => unsubscribe();
  }, []);

  const checkVendorStatus = async () => {
    try {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      
      setUserType(type);
      setUserEmail(email);

      // only need to check for vendors
      if (type !== 'vendor') {
        setVendorVerified(true);
        setLoading(false);
        return;
      }

      // checking vendor status
      if (!email) {
        setLoading(false);
        return;
      }

      const vendorRef = doc(db, 'vendors', email);
      const vendorDoc = await getDoc(vendorRef);
      
      if (!vendorDoc.exists()) {
        // if no profile exists need to apply
        setVendorVerified(false);
        setLoading(false);
        return;
      }

      const vendorData = vendorDoc.data();
      const status = vendorData.verificationStatus;

      if (status === 'approved') {
        setVendorVerified(true);
      } else {
        setVendorVerified(false);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error checking vendor status:', error);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: { paddingVertical: 5, backgroundColor: 'white' },
      }}
    >
      {/* map tab should always be accessible - need to double check with Tanishka and Alvin */}
      <Tab.Screen
        name="Map"
        options={{
          headerShown: false,
          title: 'Map',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      >
        {() => (
          <Stack.Navigator>
            <Stack.Screen 
              name="Map" 
              component={MapScreen} 
              options={{ title: "Map" }} 
            />
            <Stack.Screen 
              name="VendorPhotoVerification" 
              component={VendorPhotoVerificationScreen} 
              options={{ title: 'Vendor Verification' }} 
            />
            <Stack.Screen 
              name="VendorPendingScreen" 
              component={VendorPendingScreen} 
              options={{ title: 'Verification Pending', headerLeft: () => null }} 
            />
          </Stack.Navigator>
        )}
      </Tab.Screen>

      {/* discover tab */}
      <Tab.Screen
        name="Discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="star-outline" size={size} color={color} />
          ),
        }}
      >
        {() => {
          // blocking
          if (verificationMode === 'blocking' && userType === 'vendor' && !vendorVerified) {
            return <VendorBlockedScreen screenName="Discover" />;
          }
          // not blocking
          return <DiscoverScreen />;
        }}
      </Tab.Screen>

      {/* profile tab */}
      <Tab.Screen
        name="Profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size} color={color} />
          ),
        }}
      >
        {() => {
          // now we're in blocking here: Show blocked screen
          if (verificationMode === 'blocking' && userType === 'vendor' && !vendorVerified) {
            return <VendorBlockedScreen screenName="Profile" />;
          }
          // if verified or non blocked we show regular screen
          return <ProfileScreen />;
        }}
      </Tab.Screen>

      {/* based on feature flag we'll be in either blocking or nonblocking mode */}
      <Tab.Screen
        name="Report"
        options={{
          title: 'Report Sighting',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="create-outline" size={size} color={color} />
          ),
        }}
      >
        {() => {
          // blocking agan -  if this works properly than vendors should see blocking mode for this
          if (verificationMode === 'blocking' && userType === 'vendor' && !vendorVerified) {
            return <VendorBlockedScreen screenName="Report" />;
          }
          // if its not on blocking mode we can just show this as normal
          return <ReportScreen />;
        }}
      </Tab.Screen>

      {/* dashboard tab for admins*/}
      {isAdmin && (
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="stats-chart-outline" size={size} color={color} />
            ),
          }}
        />
      )}
    </Tab.Navigator>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasUserType, setHasUserType] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);



  useEffect(() => {
    const checkUserType = async () => {
      try {
        const userType = await AsyncStorage.getItem("userType");
        setHasUserType(!!userType);
        // also load stored userId if present
        const storedId = await AsyncStorage.getItem('userId');
        if (storedId) setUserId(storedId);
        try {
          if (!auth.currentUser && storedId) {
            const uref = doc(db, 'users', storedId);
            const snap = await getDoc(uref);
            if (snap.exists()) {
              const data = snap.data();
              setUserDoc(data);
              const adminFlag = !!data.isAdmin;
              setIsAdmin(adminFlag);
            }
          }
        } catch (readErr) {
        }
      } catch (err) {
      } finally {
        setLoading(false);
      }
    };
    checkUserType();

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      (async () => {
        try {
          const uid = user?.uid;
          if (!uid) {
            setUserId(null);
            setIsAdmin(false);
            setUserDoc(null);
            return;
          }

          setUserId(uid);
          const uref = doc(db, 'users', uid);
          const snap = await getDoc(uref);
          const adminFlag = snap.exists() && !!snap.data().isAdmin;
          setIsAdmin(adminFlag);
          setUserDoc(snap.exists() ? snap.data() : null);
        } catch (err) {
          setIsAdmin(false);
          setUserDoc(null);
        }
      })();
    });

    try {
      const current = auth.currentUser;
      if (current?.uid) {
        (async () => {
          try {
            const curUid = current.uid;
            const uref = doc(db, 'users', curUid);
            const snap = await getDoc(uref);
            const adminFlag = snap.exists() && !!snap.data().isAdmin;
            setIsAdmin(adminFlag);
            setUserId(curUid);
            setUserDoc(snap.exists() ? snap.data() : null);
          } catch (err) {
            setUserDoc(null);
          }
        })();
      }
    } catch (e) {
      // ignore
    }

    return () => unsubAuth();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="MainApp">
            {(props) => <MainApp {...props} isAdmin={isAdmin} />}
          </Stack.Screen>
        </Stack.Navigator>
        {/* debugging badge showing current auth uid, isAdmin flag, and fetched users/{uid} doc */}
        <View style={{ position: 'absolute', top: 36, right: 12, backgroundColor: 'rgba(0,0,0,0.82)', padding: 8, borderRadius: 8, zIndex: 999, maxWidth: 260 }}>
          <Text style={{ color: 'white', fontSize: 12, fontWeight: '700' }}>Auth UID:</Text>
          <Text style={{ color: 'white', fontSize: 11, marginBottom: 6 }}>{userId || 'none'}</Text>
          <Text style={{ color: isAdmin ? '#4CD964' : '#FF3B30', fontWeight: '700', fontSize: 13 }}>{`admin: ${isAdmin}`}</Text>
        </View>
      </NavigationContainer>
    </ErrorBoundary>
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
    maxHeight: '90%',
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