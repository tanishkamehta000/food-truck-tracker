import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

export default function VerificationBanner({ noMargin = false }) {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState(null);
  const [userType, setUserType] = useState(null);
  const navigation = useNavigation();

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    try {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      
      setUserType(type);

      // Only show for vendors
      if (type !== 'vendor' || !email) {
        setShow(false);
        return;
      }

      const vendorRef = doc(db, 'vendors', email);
      const vendorDoc = await getDoc(vendorRef);
      
      if (!vendorDoc.exists()) {
        setStatus('needs_photo');
        setShow(true);
        return;
      }

      const vendorStatus = vendorDoc.data().verificationStatus;
      
      if (vendorStatus === 'approved') {
        setShow(false);
      } else {
        setStatus(vendorStatus);
        setShow(true);
      }
    } catch (error) {
      console.error('Error checking verification:', error);
      setShow(false);
    }
  };

  const handlePress = () => {
  if (status === 'pending_photo') {
    navigation.navigate('Map', { screen: 'VendorPendingScreen' });
  } else {
    navigation.navigate('Map', { 
      screen: 'VendorPhotoVerification',
      params: { truckName: 'Your Truck' }
    });
  }
};

  if (!show || userType !== 'vendor') {
    return null;
  }

  const getBannerConfig = () => {
    switch (status) {
      case 'pending_photo':
        return {
          bg: '#fff3cd',
          text: ' Verification pending - Under review',
          buttonText: 'Check Status',
        };
      case 'rejected':
        return {
          bg: '#f8d7da',
          text: 'Verification rejected - Please resubmit',
          buttonText: 'Resubmit Photo',
        };
      default:
        return {
          bg: '#d1ecf1',
          text: 'Get verified for more credibility with potential customers!',
          buttonText: 'Get Verified',
        };
    }
  };

  const config = getBannerConfig();

  return (
    <TouchableOpacity 
      style={[styles.banner, { backgroundColor: config.bg }, noMargin && { marginBottom: 0 }]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <Text style={styles.bannerText}>{config.text}</Text>
      <Text style={styles.bannerButton}>{config.buttonText} →</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  bannerButton: {
    fontSize: 14,
    fontWeight: '700',
    color: '#007AFF',
  },
});