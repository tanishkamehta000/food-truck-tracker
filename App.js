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

  useEffect(() => {
    requestLocationPermission();
    clearOldSightings();
    setupFirebaseListener();
  }, []);

  const setupFirebaseListener = () => {
    const q = query(collection(db, 'sightings'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sightingsData = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
    
        // Normalize field names to always include location
        const latitude = data.location?.latitude ?? data.lat;
        const longitude = data.location?.longitude ?? data.lon;
    
        if (latitude && longitude) {
          sightingsData.push({
            id: docSnap.id,
            ...data,
            location: { latitude, longitude },
          });
        }
      });
    
      console.log("🔥 Normalized sightings:", sightingsData);
      setSightings(sightingsData);
    });      
    return unsubscribe;
  };  

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        setLoading(false);
        Alert.alert('Location Permission', 'We need your location permission to show nearby food trucks.');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setLoading(false);
    } catch (error) {
      console.error(error);
      setErrorMsg('Error getting location');
      setLoading(false);
    }
  };

  const getMarkerColor = (status, verifiedBy, crowdLevel) => {
    if (verifiedBy === 'vendor') return 'green';
    if (crowdLevel === 'Busy') return 'red';
    if (crowdLevel === 'Moderate') return 'orange';
    if (crowdLevel === 'Light') return 'yellow';
    return 'gray';
  };

  async function clearOldSightings() {
    try {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setHours(5, 0, 0, 0);
      if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);

      const snap = await getDocs(collection(db, "sightings"));
      const deletions = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const ts = data.timestamp?.toMillis?.() ?? 0;
        if (ts < cutoff.getTime() && data.status !== "verified") {
          deletions.push(deleteDoc(doc(db, "sightings", docSnap.id)));
        }
      });

      if (deletions.length > 0) {
        await Promise.all(deletions);
        console.log(`Cleared ${deletions.length} old sightings`);
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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={handleRefresh} style={{ marginRight: 15 }}>
          <Text style={{ fontSize: 32, fontWeight: '700', color: '#007AFF' }}>⟳</Text>
        </TouchableOpacity>
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

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={location}
        showsUserLocation
        showsMyLocationButton
      >
        {/* Current user location */}
        {location && (
          <Marker
            coordinate={location}
            title="You are here"
            description="Your current location"
            pinColor="purple"
          />
        )}

        {/* Food truck sightings */}
        {sightings
          .filter((sighting, _, allSightings) => {
            if (!sighting.location?.latitude || !sighting.location?.longitude) return false;

            // Vendors always show
            if (sighting.verifiedBy?.toLowerCase() === "vendor") return true;

            // Users need 3+ confirmations nearby
            const sameTruckSightings = allSightings.filter((s) => {
              if (!s.location?.latitude || !s.location?.longitude) return false;
              const distance = Math.sqrt(
                Math.pow(s.location.latitude - sighting.location.latitude, 2) +
                Math.pow(s.location.longitude - sighting.location.longitude, 2)
              );
              return (
                s.foodTruckName?.toLowerCase() === sighting.foodTruckName?.toLowerCase() &&
                distance < 0.001
              );
            });

            const verifiedCount = sameTruckSightings.filter(
              (s) => s.status === "verified"
            ).length;

            return verifiedCount >= 3;
          })
          .map((sighting) => {
            console.log(
              "Rendering marker:",
              sighting.foodTruckName,
              sighting.verifiedBy,
              sighting.location
            );

            return (
              <Marker
                key={sighting.id}
                coordinate={{
                  latitude: sighting.location.latitude,
                  longitude: sighting.location.longitude,
                }}
                title={sighting.foodTruckName}
                description={`${sighting.cuisineType} • ${sighting.crowdLevel}`}
                pinColor={
                  sighting.verifiedBy?.toLowerCase() === "vendor"
                    ? "green"
                    : sighting.crowdLevel === "Busy"
                    ? "red"
                    : sighting.crowdLevel === "Moderate"
                    ? "orange"
                    : sighting.crowdLevel === "Light"
                    ? "yellow"
                    : "gray"
                }
              />
            );
          })}

      </MapView>


      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Map Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'green' }]} />
          <Text style={styles.legendText}>Vendor verified</Text>
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
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, fontSize: 16, color: '#666' },
  legend: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    minWidth: 120,
  },
  legendTitle: { fontWeight: 'bold', marginBottom: 5, fontSize: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  legendColor: { width: 12, height: 12, borderRadius: 6, marginRight: 5 },
  legendText: { fontSize: 10 },
});