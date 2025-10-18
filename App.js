import React, { useState, useEffect , useLayoutEffect} from 'react';
import { StyleSheet, View, Text, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import MapView, { Marker } from 'react-native-maps';
import { collection, onSnapshot, query, where , getDocs, deleteDoc, doc} from 'firebase/firestore';
import { db } from './firebaseConfig';
import * as Location from 'expo-location';
import ReportScreen from './ReportScreen';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function MapScreen({navigation}) {
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
    // Listen for real-time updates from Firebase
    const q = query(collection(db, 'sightings'));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const sightingsData = [];
      querySnapshot.forEach((doc) => {
        sightingsData.push({
          id: doc.id,
          ...doc.data()
        });
      });
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

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
      setLoading(false);
    } catch (error) {
      setErrorMsg('Error getting location');
      setLoading(false);
      console.error(error);
    }
  };

  const getMarkerColor = (status, crowdLevel) => {
    if (status === 'verified') return 'green';
    if (crowdLevel === 'Busy') return 'red';
    if (crowdLevel === 'Moderate') return 'orange';
    return 'blue';
  };

  async function clearOldSightings() {
    try {
      const now = new Date();
  
      // 5 am cutoff
      const cutoff = new Date();
      cutoff.setHours(5, 0, 0, 0);
  
      if (now < cutoff) cutoff.setDate(cutoff.getDate() - 1);
  
      const snap = await getDocs(collection(db, "sightings"));
      const deletions = [];
  
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const ts = data.timestamp?.toMillis?.() ?? 0;
        if (ts < cutoff.getTime()) {
          deletions.push(deleteDoc(doc(db, "sightings", docSnap.id)));
        }
      });
  
      if (deletions.length > 0) {
        await Promise.all(deletions);
        console.log('Cleared ${deletions.length} old sightings before ${cutoff}');
      } else {
        console.log("No old sightings to clear.");
      }
    } catch (err) {
      console.error("Error clearing old sightings: ", err);
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
        <Text style={styles.errorSubtext}>
          Please enable location permissions in your device settings.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={location}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {/* Your current location marker */}
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
        {sightings.map((sighting) => (
          <Marker
            key={sighting.id}
            coordinate={{
              latitude: sighting.location.latitude,
              longitude: sighting.location.longitude,
            }}
            title={sighting.foodTruckName}
            description={`${sighting.cuisineType} • ${sighting.crowdLevel} • ${sighting.status}`}
            pinColor={getMarkerColor(sighting.status, sighting.crowdLevel)}
          />
        ))}
      </MapView>
      
      {/* Map Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Map Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: 'green' }]} />
          <Text style={styles.legendText}>Verified</Text>
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
          <View style={[styles.legendColor, { backgroundColor: 'blue' }]} />
          <Text style={styles.legendText}>Light Crowd</Text>
        </View>
      </View>

      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          {sightings.filter(s => s.status === 'verified').length} Verified 
          {sightings.filter(s => s.status === 'pending').length} Pending
        </Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarActiveTintColor: '#007AFF',
            tabBarInactiveTintColor: 'gray',
            tabBarStyle: {
              paddingVertical: 5,
              backgroundColor: 'white',
            },
          }}
        >

        <Tab.Screen
          name="Map"
          options={{
            headerShown: false,
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: size, color }}>🗺️</Text>
            ),
            title: 'Food Truck Map',
          }}
        >
          {() => (
            <Stack.Navigator>
              <Stack.Screen
                name="Food Truck Map"
                component={MapScreen}
                options={{ title: "Food Truck Map" }}
              />
            </Stack.Navigator>
          )}
        </Tab.Screen>

        <Tab.Screen 
          name="Report" 
          component={ReportScreen}
          options={{
            title: 'Report Sighting',
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: size, color }}>📝</Text>
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
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
    minWidth: 120,
  },
  legendTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    fontSize: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 5,
  },
  legendText: {
    fontSize: 10,
  },
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
  refreshButton: {
    position: "absolute",
    bottom: 80,
    right: 20,
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  refreshText: {
    color: "white",
    fontWeight: "700",
    fontSize: 14,
  },
});