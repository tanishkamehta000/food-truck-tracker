import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import { StyleSheet, View, Text, Alert, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker, Callout } from 'react-native-maps';
import { collection, onSnapshot, query, getDocs, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove, setDoc, getDoc } from 'firebase/firestore';
import { auth } from './firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { db } from './firebaseConfig';
import * as Location from 'expo-location';
import ReportScreen from './ReportScreen';
import LoginScreen from "./LoginScreen";
import ProfileScreen from './ProfileScreen';
import DashboardScreen from './DashboardScreen';
import AsyncStorage from "@react-native-async-storage/async-storage";

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
            <Text style={{ color: 'white', fontSize: 12 }}>{String(this.state.error && this.state.error.toString())}</Text>
            <Text style={{ color: '#ccc', marginTop: 8, fontSize: 11 }}>{this.state.errorInfo ? this.state.errorInfo.componentStack : ''}</Text>
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

  useEffect(() => {
    requestLocationPermission();
    clearOldSightings();
    setupFirebaseListener();
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
    (async () => {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      const id = await AsyncStorage.getItem('userId');
      setUserType(type);
      setUserEmail(email);
      setUserId(id);
    })();
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
      
      console.log('🔄 Firebase update - Total sightings:', sortedSightings.length);
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

  const getMarkerColor = (status, crowdLevel) => {
    console.log(`🎨 Getting color for status: ${status}, crowd: ${crowdLevel}`); // Debug color selection
    if (status === 'verified') return 'green';
    if (status === 'pending') return 'gray';
    if (crowdLevel === 'Busy') return 'red';
    if (crowdLevel === 'Moderate') return 'orange';
    if (crowdLevel === 'Light') return 'yellow';
    return 'gray';
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
    console.log('👥 Unique markers after grouping:', uniqueMarkers.length);
    
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
      console.log("🔄 Map refreshed successfully");
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
      console.log('🎯 Centered map on markers');
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
  console.log('🗺️ Rendering markers:', validMarkers.length, 'valid out of', sightings.length, 'total');
  console.log('📊 Marker status breakdown:', {
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
        onMapReady={() => console.log('🗺️ Map is ready')}
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
          const markerColor = getMarkerColor(sighting.status, sighting.crowdLevel);
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
      
      {/* Debug Panel removed */}
      
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Map Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'green' }]} />
          <Text style={styles.legendText}>Verified</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'gray' }]} />
          <Text style={styles.legendText}>Pending</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'red' }]} />
          <Text style={styles.legendText}>Busy</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'orange' }]} />
          <Text style={styles.legendText}>Moderate</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'yellow' }]} />
          <Text style={styles.legendText}>Light Crowd</Text>
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

function MainApp({ isAdmin }) {
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
      {isAdmin && (
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => <Text style={{ fontSize: size, color }}>📊</Text>,
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
        // If there's no authenticated user but we have a stored userId, try to read the users/{uid} doc as a fallback.
        // This will only succeed if your Firestore rules allow reads without auth or allow reads for that uid.
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
          // fallback read failed; silently ignore to avoid noisy logs
        }
      } catch (err) {
        // AsyncStorage error; ignore for now
      } finally {
        setLoading(false);
      }
    };
    checkUserType();

    // listen for auth state changes to refresh isAdmin
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Run async work inside an IIFE so we don't pass an async fn directly to the listener
      (async () => {
        try {
          const uid = user?.uid;
          if (!uid) {
            setUserId(null);
            setIsAdmin(false);
            setUserDoc(null);
            return;
          }

          // At this point we have a uid
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

    // Also check current user immediately in case auth state is already established
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
        {/* DEBUG badge showing current auth uid, isAdmin flag, and fetched users/{uid} doc */}
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
});