import React, { useState, useEffect, useLayoutEffect } from 'react';
import { StyleSheet, View, Text, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker } from 'react-native-maps';
import { collection, onSnapshot, query, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import * as Location from 'expo-location';
import ReportScreen from './ReportScreen';
import LoginScreen from "./LoginScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function MapScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [sightings, setSightings] = useState([]);
  const [mapRegion, setMapRegion] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [showDebug, setShowDebug] = useState(true);

  useEffect(() => {
    requestLocationPermission();
    clearOldSightings();
    setupFirebaseListener();
  }, []);

  const setupFirebaseListener = () => {
    const q = query(collection(db, 'sightings'));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sightingsData = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        
        // Handle different data structures
        const sightingData = {
          id: doc.id,
          ...data,
          // Normalize the location field
          location: data.location || {
            latitude: data.lat,
            longitude: data.lng
          }
        };
        
        sightingsData.push(sightingData);
      });
      
      // Sort by status to ensure verified markers are processed correctly
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
      
      // Enhanced debugging - show status changes
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

  async function clearOldSightings() {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago
      
      const snap = await getDocs(collection(db, "sightings"));
      const deletions = [];
  
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const timestamp = data.timestamp;
        
        // Only delete if timestamp exists and is older than 24 hours
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

  // Function to center map on markers
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
  console.log('🗺️ Rendering markers:', validMarkers.length, 'valid out of', sightings.length, 'total');
  console.log('📊 Marker status breakdown:', {
    verified: validMarkers.filter(m => m.status === 'verified').length,
    pending: validMarkers.filter(m => m.status === 'pending').length
  });

  return (
    <View style={styles.container}>
      <MapView
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
          
          return (
            <Marker
              key={sighting.id}
              coordinate={{
                latitude: sighting.location.latitude,
                longitude: sighting.location.longitude,
              }}
              title={sighting.foodTruckName}
              description={getMarkerDescription(sighting)}
              pinColor={markerColor}
              onPress={() => console.log('📍 Marker pressed:', sighting.foodTruckName, 'Status:', sighting.status, 'Color:', markerColor)}
            />
          );
        })}
      </MapView>
      
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
            <Text style={styles.debugButtonText}>🎯 Center on Markers</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={[styles.debugButton, { backgroundColor: '#FF9500', marginTop: 5 }]}>
            <Text style={styles.debugButtonText}>🔄 Force Refresh</Text>
          </TouchableOpacity>
        </View>
      )}
      
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
});