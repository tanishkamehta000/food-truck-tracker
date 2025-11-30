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
import { collection, addDoc, query, where, getDocs, updateDoc, doc, getDoc } from 'firebase/firestore';
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

//confirmed working as of today 

const INVENTORY_LEVELS = ['Plenty', 'Running Low', 'Almost Out'];

export default function ReportScreen({ navigation, verificationMethod = 'both' }) {
  const [favoriteItemInput, setFavoriteItemInput] = useState('');
  const [favoriteItems, setFavoriteItems] = useState([]);
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
  const [userId, setUserId] = useState(null);
  const [inventoryLevel, setInventoryLevel] = useState('');
  const [vendorProfile, setVendorProfile] = useState(null); //both of these are for inventory level and vendor profile


  useEffect(() => {
    getCurrentLocation();
  
    const loadUserInfo = async () => {
      const type = await AsyncStorage.getItem("userType");
      const email = await AsyncStorage.getItem("userEmail");
      const id = await AsyncStorage.getItem('userId');
      setUserType(type || "user");
      setUserEmail(email || "");
      setUserId(id || null);

      if (type == "vendor") {
        const docKey = id || email;
        if (docKey) await loadVendorProfile(docKey, email);
      }
    };
  
    loadUserInfo();
  }, []);


  //adding a new load vendor profile method
  const loadVendorProfile = async (docKey, emailFallback) => {
    try {
      // Try direct doc read first (supports uid-keyed docs)
      if (docKey) {
        try {
          const docRef = doc(db, 'vendors', docKey);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const vendorData = snap.data();
            setVendorProfile(vendorData);
            setFoodTruckName(vendorData.truckName || '');
            setCuisineType(vendorData.cuisineType || '');
            console.log('✅ Loaded vendor profile (by uid):', vendorData);
            return;
          }
        } catch (e) {
          console.warn('Direct vendor doc read failed:', e);
        }
      }

      // Fallback: query by email
      if (emailFallback) {
        const vendorsRef = collection(db, 'vendors');
        const q = query(vendorsRef, where('email', '==', emailFallback));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          const vendorData = querySnapshot.docs[0].data();
          setVendorProfile(vendorData);
          // Auto-fill truck info from profile
          setFoodTruckName(vendorData.truckName || '');
          setCuisineType(vendorData.cuisineType || '');
          console.log('✅ Loaded vendor profile (by email):', vendorData);
          return;
        }
      }

      console.log('⚠️ No vendor profile found for:', docKey || emailFallback);
      Alert.alert('Profile Setup Required', 'Please set up your food truck profile first.', [{ text: 'OK' }]);
    } catch (error) {
      console.error('Error loading vendor profile:', error);
    }
  };



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
    //added seperate case for isVendor

    const isVendor = userType === "vendor";

    if (isVendor) {
      // basically vendors only need location
      if (!location) {
        Alert.alert('Error', 'Location is required');
        return;
      }
      if (!foodTruckName.trim() || !cuisineType) {
        Alert.alert('Error', 'Vendor profile incomplete. Please contact support.');
        return;
      }
    } else {
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
        crowdLevel: crowdLevel || (isVendor ? 'Light' : ''),
        inventoryLevel: isVendor ? inventoryLevel : null,
        additionalNotes: additionalNotes.trim(),
        location: { // Always use this structure
          latitude: location.latitude,
          longitude: location.longitude,
          address
        },
        timestamp: new Date().toISOString(),
        status: isVendor ? "verified" : "pending",
        reporterEmail: userEmail || uniqueUserId,
        reporterId: userId || uniqueUserId,
        confirmationCount: 1,
        verifiedBy: userType,
        favoriteItems,
};
  
      // Add the new report to Firebase
      const docRef = await addDoc(collection(db, "sightings"), report);
      console.log("📝 Report submitted with ID:", docRef.id);

      //new path for vendor
      if (isVendor) {
        Alert.alert(
          '✅ Check-In Successful!',
          `${foodTruckName} is now live on the map and visible to customers!`,
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
  
      if (uniqueReporterCount >= 3) {
        // We have 3 or more UNIQUE confirmations
        console.log('🎉 Reached 3 unique confirmations!');
        if (verificationMethod === 'community' || verificationMethod === 'both') {
          // community verification allowed -> verify sightings
          console.log('🔔 Community verification in effect: auto-verifying sightings');
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
          // photo-only verification configured -> do not auto-verify via community
          console.log('⏸ Photo-only verification configured: skipping community auto-verify');
          Alert.alert(
            'Report Submitted',
            `Thanks! ${foodTruckName} has been submitted. This project requires photo verification, so the truck will be visible once the vendor is approved.`,
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
    if (userType != "vendor") {
      setFoodTruckName('');
      setCuisineType('');
    }

    setCrowdLevel('');
    setInventoryLevel('');
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

  const isVendor = userType == "vendor";

  return (
  <ScrollView style={styles.container}>
    {/* NEW: Vendor info banner */}
    {isVendor && vendorProfile && (
      <View style={styles.vendorInfoBanner}>
        <Text style={styles.vendorInfoLabel}>Checking in as:</Text>
        <Text style={styles.vendorTruckName}>🚚 {vendorProfile.truckName}</Text>
        <Text style={styles.vendorInfoSubtext}>
          {vendorProfile.cuisineType} • {vendorProfile.location || 'Atlanta'}
        </Text>
      </View>
    )}

    <View style={styles.section}>
      <Text style={styles.label}>Current Location</Text>
      <View style={styles.locationContainer}>
        <Text style={styles.locationText}>{address}</Text>
        <TouchableOpacity style={styles.changeButton} onPress={getCurrentLocation}>
          <Text style={[styles.changeButtonText, isVendor && styles.vendorAccent]}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>

    {/* CONDITIONAL: Only show for users */}
    {!isVendor && (
      <>
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
      </>
    )}

    {/* NEW: Vendor-only field */}
    {isVendor && (
      <View style={styles.section}>
        <Text style={styles.label}>Food Inventory Level (Optional)</Text>
        <View style={styles.crowdLevelContainer}>
          {INVENTORY_LEVELS.map((level) => (
            <TouchableOpacity
              key={level}
              style={[
                styles.crowdLevelButton,
                inventoryLevel === level && (isVendor ? styles.vendorButtonSelected : styles.crowdLevelButtonSelected)
              ]}
              onPress={() => setInventoryLevel(level)}
            >
              <Text
                style={[
                  styles.crowdLevelText,
                  inventoryLevel === level && styles.crowdLevelTextSelected
                ]}
              >
                {level}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    )}

    <View style={styles.section}>
      <Text style={styles.label}>
        Current Crowd Level {isVendor ? '(Optional)' : '*'}
      </Text>
      <View style={styles.crowdLevelContainer}>
        {['Light', 'Moderate', 'Busy'].map((level) => (
          <TouchableOpacity
            key={level}
            style={[
              styles.crowdLevelButton,
              crowdLevel === level && (isVendor ? styles.vendorButtonSelected : styles.crowdLevelButtonSelected)
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
        placeholder={
          isVendor 
            ? "Special deals today, estimated closing time, popular items..."
            : "Menu highlights, wait time, special deals..."
        }
        value={additionalNotes}
        onChangeText={setAdditionalNotes}
        multiline
        numberOfLines={3}
        maxLength={200}
      />
    </View>

    <View style={styles.section}>
      <Text style={styles.label}>Popular Items (Optional)</Text>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          style={[styles.textInput, { flex: 1, marginRight: 8 }]}
          placeholder="Add an item, e.g., Carne Asada"
          value={favoriteItemInput}
          onChangeText={setFavoriteItemInput}
          onSubmitEditing={() => {
            if (favoriteItemInput.trim().length) {
              setFavoriteItems(prev => [...prev, favoriteItemInput.trim()]);
              setFavoriteItemInput('');
            }
          }}
        />
        <TouchableOpacity
          style={[styles.submitButton, { paddingHorizontal: 12 }]}
          onPress={() => {
            if (favoriteItemInput.trim().length) {
              setFavoriteItems(prev => [...prev, favoriteItemInput.trim()]);
              setFavoriteItemInput('');
            }
          }}
        >
          <Text style={styles.submitButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* chips */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
        {favoriteItems.map((it, i) => (
          <View key={i} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f0f0f0', borderRadius: 16, marginRight: 6, marginBottom: 6 }}>
            <Text>{it}</Text>
          </View>
        ))}
      </View>
    </View>

    <View style={[styles.verificationSection, isVendor && styles.vendorVerificationSection]}>
      <Text style={styles.verificationText}>
        {isVendor ? (
          <>
            ✅ Your check-in will be <Text style={styles.verificationBold}>immediately verified</Text> and visible to customers on the map.
            {"\n\n"}
            <Text style={styles.verificationBold}>
              This helps customers find you and see your current status!
            </Text>
          </>
        ) : (
          <>
            This sighting will be marked with current time and your location. 
            Other users will be able to confirm or update this information.
            {"\n\n"}
            <Text style={styles.verificationBold}>
              ⚠️ This sighting needs 2 other reports to become verified.
            </Text>
          </>
        )}
      </Text>
    </View>

    {/* Test button - only for users */}
    {!isVendor && (
      <TouchableOpacity
        style={[styles.submitButton, { backgroundColor: '#FF9500', marginBottom: 10 }]}
        onPress={simulateMultipleUsers}
      >
        <Text style={styles.submitButtonText}>🧪 Simulate 2 Users (Test)</Text>
      </TouchableOpacity>
    )}

    <TouchableOpacity
      style={[
        styles.submitButton, 
        loading && styles.submitButtonDisabled,
        isVendor && styles.vendorSubmitButton
      ]}
      onPress={handleSubmit}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.submitButtonText}>
          {isVendor ? 'Check In Now' : 'Submit Report'}
        </Text>
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
  vendorInfoBanner: {
    backgroundColor: '#fff3cd',
    padding: 16,
    borderRadius: 8,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9500',
  },
  vendorInfoLabel: {
    fontSize: 14,
    color: '#856404',
    marginBottom: 4,
  },
  vendorTruckName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FF9500',
    marginBottom: 4,
  },
  vendorInfoSubtext: {
    fontSize: 13,
    color: '#856404',
  },
  vendorAccent: {
    color: '#FF9500',
  },
  vendorButtonSelected: {
    backgroundColor: '#FF9500',
    borderColor: '#FF9500',
  },
  vendorVerificationSection: {
    backgroundColor: '#e7f8ef',
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
  },
  vendorSubmitButton: {
    backgroundColor: '#FF9500',
  },
});