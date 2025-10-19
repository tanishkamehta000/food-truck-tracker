import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  ActionSheetIOS
} from 'react-native';
import * as Location from 'expo-location';
import { db } from './firebaseConfig';
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import AsyncStorage from "@react-native-async-storage/async-storage";

const CUISINE_TYPES = [
  'Mexican',
  'Asian',
  'American',
  'Mediterranean',
  'Italian',
  'Korean',
  'Vietnamese',
  'Chinese',
  'Japanese',
  'Indian',
  'Middle Eastern',
  'Dessert',
  'Coffee',
  'Other'
];

export default function ReportScreen({ navigation }) {
  const [location, setLocation] = useState(null);
  const [address, setAddress] = useState('');
  const [foodTruckName, setFoodTruckName] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [crowdLevel, setCrowdLevel] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    getCurrentLocation();
  
    const loadUserInfo = async () => {
      const type = await AsyncStorage.getItem("userType");
      const email = await AsyncStorage.getItem("userEmail");
      setUserType(type || "user");
      setUserEmail(email || "");
    };
  
    loadUserInfo();
  }, []);
  

  const showCuisineActionSheet = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', ...CUISINE_TYPES],
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        if (buttonIndex > 0) {
          setCuisineType(CUISINE_TYPES[buttonIndex - 1]);
        }
      }
    );
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is required to report a food truck.');
        setLocationLoading(false);
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Reverse geocode to get address
      const [addressResult] = await Location.reverseGeocodeAsync({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });

      setLocation(currentLocation.coords);
      setAddress(
        addressResult.name || 
        addressResult.street || 
        `${addressResult.city}, ${addressResult.region}` ||
        'Current Location'
      );
      setLocationLoading(false);
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get current location');
      setLocationLoading(false);
    }
  };

  // Check for nearby similar reports to group them - FIXED VERSION
  const findSimilarSightings = async (truckName, userLocation) => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      
      const sightingsRef = collection(db, 'sightings');
      const q = query(
        sightingsRef,
        where('foodTruckName', '==', truckName)
        // REMOVED status filter to check for already verified trucks
      );
  
      const querySnapshot = await getDocs(q);
      const similarSightings = [];
  
      querySnapshot.forEach((doc) => {
        const sighting = doc.data();
        
        // Manual timestamp filtering to handle both timestamp formats
        let sightingTime;
        if (sighting.timestamp && sighting.timestamp.toDate) {
          // It's a serverTimestamp
          sightingTime = sighting.timestamp.toDate();
        } else {
          // It's a regular timestamp string
          sightingTime = new Date(sighting.timestamp);
        }
        
        // Skip if older than 1 hour or invalid timestamp
        if (!sightingTime || sightingTime < oneHourAgo) return;
        
        // Calculate distance between locations
        const distance = calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          sighting.location.latitude,
          sighting.location.longitude
        );
  
        // If within 100 meters, consider it similar
        if (distance < 100) {
          similarSightings.push({
            id: doc.id,
            ...sighting
          });
        }
      });
  
      // DEBUG LOGGING
      console.log('🔍 Found similar sightings:', similarSightings.length);
      console.log('📊 Status breakdown:', {
        verified: similarSightings.filter(s => s.status === 'verified').length,
        pending: similarSightings.filter(s => s.status === 'pending').length
      });
      
      return similarSightings;
    } catch (error) {
      console.error('Error finding similar sightings:', error);
      return [];
    }
  };

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c * 1000; // Convert to meters
    return distance;
  };

  // Verify a sighting when it reaches 3 confirmations
  const verifySighting = async (sightingIds) => {
    try {
      // Update all related sightings to verified
      const updatePromises = sightingIds.map(sightingId => 
        updateDoc(doc(db, 'sightings', sightingId), {
          status: 'verified',
          verifiedAt: new Date().toISOString()
        })
      );

      await Promise.all(updatePromises);
      console.log(`✅ Verified ${sightingIds.length} sightings`);
    } catch (error) {
      console.error('Error verifying sightings:', error);
    }
  };

   // For testing multiple users
const simulateMultipleUsers = async () => {
  if (!foodTruckName.trim() || !cuisineType || !crowdLevel || !location) {
    Alert.alert('Missing Information', 'Please fill out the form first');
    return;
  }

  console.log('🧪 Simulating 3 different users reporting the same truck...');
  
  // Simulate 3 different users
  for (let i = 1; i <= 3; i++) {
    const testReport = {
      foodTruckName: foodTruckName.trim(),
      cuisineType,
      crowdLevel,
      additionalNotes: `Test report from user ${i}`,
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        address
      },
      timestamp: new Date().toISOString(),
      status: "pending",
      reporterEmail: `testuser${i}@example.com`,
      reporterId: `test_user_${i}_${Date.now()}`,
      confirmationCount: 1,
      verifiedBy: "user",
    };

    try {
      await addDoc(collection(db, "sightings"), testReport);
      console.log(`✅ Added test report from user ${i}`);
    } catch (error) {
      console.error(`❌ Error adding test report ${i}:`, error);
    }
  }
  
  Alert.alert(
    'Test Data Added',
    '3 test reports from different users have been added. Now submit your own report to trigger verification.',
    [{ text: 'OK' }]
  );
};

  const handleSubmit = async () => {
    if (!foodTruckName.trim()) {
      Alert.alert('Missing Information', 'Please enter the food truck name');
      return;
    }
  
    if (!cuisineType) {
      Alert.alert('Missing Information', 'Please select a cuisine type');
      return;
    }
  
    if (!crowdLevel) {
      Alert.alert('Missing Information', 'Please select crowd level');
      return;
    }
  
    if (!location) {
      Alert.alert('Error', 'Location is required');
      return;
    }
  
    setLoading(true);
  
    try {
      // Find similar recent sightings
      let currentUserType = userType;
      if (!currentUserType) {
        currentUserType = await AsyncStorage.getItem("userType");
        setUserType(currentUserType);
      }
      
      console.log('🔍 Searching for similar sightings...');
      const similarSightings = await findSimilarSightings(foodTruckName.trim(), location);
      const isVendor = userType === "vendor";
  
      // Check if this food truck is already verified
      const alreadyVerified = similarSightings.some(sighting => sighting.status === 'verified');
      
      if (alreadyVerified) {
        Alert.alert(
          'Already Verified!',
          `${foodTruckName} is already verified on the map.`,
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.navigate('Map');
                resetForm();
              }
            }
          ]
        );
        setLoading(false);
        return;
      }
  
      // Create a unique user identifier for testing
      const uniqueUserId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create the new report - ensure consistent location structure
      const report = {
        foodTruckName: foodTruckName.trim(),
        cuisineType,
        crowdLevel,
        additionalNotes: additionalNotes.trim(),
        location: { // Always use this structure
          latitude: location.latitude,
          longitude: location.longitude,
          address
        },
        timestamp: new Date().toISOString(),
        status: isVendor ? "verified" : "pending",
        reporterEmail: userEmail || uniqueUserId,
        reporterId: uniqueUserId,
        confirmationCount: 1,
        verifiedBy: userType,
};
  
      // Add the new report to Firebase
      const docRef = await addDoc(collection(db, "sightings"), report);
      console.log("📝 Report submitted with ID:", docRef.id);
  
      // Check if we've reached the verification threshold
      const allSightings = [...similarSightings, { id: docRef.id, ...report }];
      
      // Count unique reporters for verification (not just total reports)
      const uniqueReporters = new Set();
      allSightings.forEach(sighting => {
        // Use reporterId if available, otherwise fall back to reporterEmail
        const reporterIdentifier = sighting.reporterId || sighting.reporterEmail;
        if (reporterIdentifier) {
          uniqueReporters.add(reporterIdentifier);
        }
      });
      
      const uniqueReporterCount = uniqueReporters.size;
      
      // DEBUG: Log all reporters
      console.log('👥 All unique reporters:', Array.from(uniqueReporters));
      console.log('📊 Unique reporter count:', uniqueReporterCount, 'out of', allSightings.length, 'total reports');
      console.log('🔍 All sightings details:', allSightings.map(s => ({
        id: s.id,
        reporterId: s.reporterId,
        reporterEmail: s.reporterEmail,
        status: s.status
      })));
  
      if (isVendor) {
        Alert.alert(
          'Vendor Report Verified!',
          `${foodTruckName} has been added as a verified truck on the map.`,
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.navigate('Map');
                resetForm();
              }
            }
          ]
        );
      } else if (uniqueReporterCount >= 3) {
        // We have 3 or more UNIQUE confirmations - verify these sightings
        console.log('🎉 Reached 3 unique confirmations! Verifying sightings...');
        await verifySighting(allSightings.map(s => s.id));
        
        Alert.alert(
          'Sighting Verified!',
          `Thanks for confirming! ${foodTruckName} is now verified on the map.`,
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.navigate('Map');
                resetForm();
              }
            }
          ]
        );
      } else {
        // Not enough confirmations yet
        const needed = 3 - uniqueReporterCount;
        console.log('⏳ Need more unique confirmations:', needed, 'more needed');
        Alert.alert(
          'Success!',
          `Food truck reported successfully. Need ${needed} more unique confirmation${needed > 1 ? 's' : ''} to verify.`,
          [
            {
              text: 'OK',
              onPress: () => {
                navigation.navigate('Map');
                resetForm();
              }
            }
          ]
        );
      }
  
    } catch (error) {
      console.error('❌ Error submitting report:', error);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setLoading(false);
    }
  };



  const resetForm = () => {
    setFoodTruckName('');
    setCuisineType('');
    setCrowdLevel('');
    setAdditionalNotes('');
  };

  if (locationLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.label}>Current Location</Text>
        <View style={styles.locationContainer}>
          <Text style={styles.locationText}>{address}</Text>
          <TouchableOpacity style={styles.changeButton} onPress={getCurrentLocation}>
            <Text style={styles.changeButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Food Truck Name *</Text>
        <TextInput
          style={styles.textInput}
          placeholder="e.g., Joe's Tacos, Burger Express..."
          value={foodTruckName}
          onChangeText={setFoodTruckName}
          maxLength={50}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Cuisine Type *</Text>
        <TouchableOpacity 
          style={styles.cuisineSelector}
          onPress={showCuisineActionSheet}
        >
          <Text style={cuisineType ? styles.cuisineSelectorText : styles.cuisineSelectorPlaceholder}>
            {cuisineType || 'Select cuisine type'}
          </Text>
          <Text style={styles.cuisineSelectorArrow}>▼</Text>
        </TouchableOpacity>
        {cuisineType ? (
          <Text style={styles.selectedCuisineText}>
            Selected: {cuisineType}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Current Crowd Level *</Text>
        <View style={styles.crowdLevelContainer}>
          {['Light', 'Moderate', 'Busy'].map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.crowdLevelButton,
                crowdLevel === level && styles.crowdLevelButtonSelected
              ]}
              onPress={() => setCrowdLevel(level)}
            >
              <Text
                style={[
                  styles.crowdLevelText,
                  crowdLevel === level && styles.crowdLevelTextSelected
                ]}
              >
                {level}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Additional Notes (Optional)</Text>
        <TextInput
          style={[styles.textInput, styles.textArea]}
          placeholder="Menu highlights, wait time, special deals..."
          value={additionalNotes}
          onChangeText={setAdditionalNotes}
          multiline
          numberOfLines={3}
          maxLength={200}
        />
      </View>

      <View style={styles.verificationSection}>
        <Text style={styles.verificationText}>
          This sighting will be marked with current time and your location. 
          Other users will be able to confirm or update this information.
          {"\n\n"}
          <Text style={styles.verificationBold}>
            This sighting needs 3 independent reports to become verified.
          </Text>
        </Text>
      </View>

            {/* Add this temporary test button - remove after testing */}
            <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: '#FF9500', marginBottom: 10 }]}
        onPress={simulateMultipleUsers}
      >
        <Text style={styles.submitButtonText}>🧪 Simulate 3 Users (Test)</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.submitButton, loading && styles.submitButtonDisabled]}
        onPress={handleSubmit}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>Submit Report</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
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
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  locationText: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  changeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  changeButtonText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  cuisineSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  cuisineSelectorText: {
    fontSize: 16,
    color: '#333',
  },
  cuisineSelectorPlaceholder: {
    fontSize: 16,
    color: '#999',
  },
  cuisineSelectorArrow: {
    fontSize: 12,
    color: '#666',
  },
  selectedCuisineText: {
    marginTop: 8,
    fontSize: 14,
    color: '#007AFF',
    fontStyle: 'italic',
  },
  crowdLevelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  crowdLevelButton: {
    flex: 1,
    padding: 12,
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  crowdLevelButtonSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  crowdLevelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  crowdLevelTextSelected: {
    color: '#fff',
  },
  verificationSection: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  verificationText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
  },
  verificationBold: {
    fontWeight: '600',
    color: '#333',
  },
  submitButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 24,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});