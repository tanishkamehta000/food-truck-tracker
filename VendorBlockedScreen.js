import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';

export default function VendorBlockedScreen({ screenName }) {
  const navigation = useNavigation();
  const [vendorStatus, setVendorStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const email = await AsyncStorage.getItem('userEmail');
      if (!email) {
        setLoading(false);
        return;
      }

      const vendorRef = doc(db, 'vendors', email);
      const vendorDoc = await getDoc(vendorRef);
      
      if (vendorDoc.exists()) {
        const status = vendorDoc.data().verificationStatus;
        setVendorStatus(status);
        
        if (status === 'pending_photo') {
          navigation.navigate('Map', { screen: 'VendorPendingScreen' });
          return;
        }
      } else {
        setVendorStatus('needs_photo');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error checking status:', error);
      setLoading(false);
    }
  };

  const handleGetVerified = () => {
    if (vendorStatus === 'rejected') {
      navigation.navigate('Map', { 
        screen: 'VendorPhotoVerification', 
        params: { truckName: 'Your Truck' } 
      });
    } else {
      navigation.navigate('Map', { 
        screen: 'VendorPhotoVerification', 
        params: { truckName: 'Your Truck' } 
      });
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#FF9500" />
      </View>
    );
  }

  if (vendorStatus === 'pending_photo') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#FF9500" />
        <Text style={{ marginTop: 10, color: '#666' }}>Loading verification status...</Text>
      </View>
    );
  }

  return (
    <View style={styles.blockedContainer}>
      <View style={styles.blockedIconContainer}>
        <Text style={styles.blockedIcon}>🔒</Text>
      </View>
      
      <Text style={styles.blockedTitle}>Verification Required</Text>
      
      <Text style={styles.blockedMessage}>
        {vendorStatus === 'rejected' ? (
          <>Your verification was rejected. Please submit a new photo to get verified.</>
        ) : (
          <>To access the {screenName} feature, please complete vendor verification first.</>
        )}
      </Text>

      <View style={styles.blockedInfoBox}>
        <Text style={styles.blockedInfoText}>
          ✓ View the map{'\n'}
          ✗ Report/check-in{'\n'}
          ✗ Edit profile
        </Text>
      </View>

      <TouchableOpacity 
        style={styles.blockedButton}
        onPress={handleGetVerified}
      >
        <Text style={styles.blockedButtonText}>
          📸 Get Verified Now
        </Text>
      </TouchableOpacity>

      <Text style={styles.blockedFooter}>
        Usually takes 24 hours
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  blockedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  blockedIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  blockedIcon: {
    fontSize: 50,
  },
  blockedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  blockedMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  blockedInfoBox: {
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  blockedInfoText: {
    fontSize: 14,
    lineHeight: 24,
  },
  blockedButton: {
    backgroundColor: '#FF9500',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    marginBottom: 10,
  },
  blockedButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  blockedFooter: {
    fontSize: 12,
    color: '#999',
    marginTop: 10,
  },
});












































































