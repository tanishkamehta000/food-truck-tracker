import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebaseConfig';
import { signOut } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';


export default function VendorPendingScreen({ navigation }) {
  const [vendorData, setVendorData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVendorData();

    const userEmail = AsyncStorage.getItem('userEmail').then(email => {
      if (!email) return;
      
      const vendorRef = doc(db, 'vendors', email);
      const unsubscribe = onSnapshot(vendorRef, (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          setVendorData(data);

        if (data.verificationStatus === 'approved') {
            Alert.alert(
              '🎉 Approved!',
              'Your vendor account has been verified! You can now start checking in.',
              [
                {
                  text: 'Start Using App',
                  onPress: () => navigation.replace('Main')
                }
              ]
            );
          }


          if (data.verificationStatus === 'rejected') {
            Alert.alert(
              '❌ Application Rejected',
              data.rejectionReason || 'Your verification photo did not meet our requirements. Please try again with a clearer photo.',
              [
                {
                  text: 'Try Again',
                  onPress: () => navigation.replace('VendorPhotoVerification', {
                    truckName: data.truckName
                  })
                }
              ]
            );
          }
        }
      });

      return () => unsubscribe();
    });
  }, []);

  const loadVendorData = async () => {
    try {
      const userEmail = await AsyncStorage.getItem('userEmail');
      if (!userEmail) {
        navigation.replace('Login');
        return;
      }

      const vendorRef = doc(db, 'vendors', userEmail);
      const vendorDoc = await getDoc(vendorRef);
      
      if (vendorDoc.exists()) {
        setVendorData(vendorDoc.data());
      }
    } catch (error) {
      console.error('Error loading vendor data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      await AsyncStorage.removeItem('userType');
      await AsyncStorage.removeItem('userEmail');
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const formatDate = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF9500" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ flexGrow: 1, paddingBottom: 40, alignItems: 'center' }}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>⏳</Text>
      </View>

      <Text style={styles.title}>Verification Pending</Text>
      
      <Text style={styles.message}>
        Your verification photo is being reviewed by our team.
        {'\n\n'}
        This typically takes <Text style={styles.bold}>24 hours</Text> during business hours.
        {'\n\n'}
        We'll send you an email when approved!
      </Text>

      {vendorData?.photoSubmittedAt && (
        <View style={styles.infoBox}>
          <Text style={styles.infoLabel}>Submitted:</Text>
          <Text style={styles.infoValue}>
            {formatDate(vendorData.photoSubmittedAt)}
          </Text>
        </View>
      )}

      {vendorData?.truckName && (
        <View style={styles.infoBox}>
          <Text style={styles.infoLabel}>Truck Name:</Text>
          <Text style={styles.infoValue}>{vendorData.truckName}</Text>
        </View>
      )}

      {vendorData?.verificationPhotoURL && (
        <View style={styles.photoSection}>
          <Text style={styles.photoLabel}>Your Submitted Photo:</Text>
          <Image 
            source={{ uri: vendorData.verificationPhotoURL }} 
            style={styles.photo}
            resizeMode="contain"
          />
        </View>
      )}

      <View style={styles.timelineContainer}>
        <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, styles.timelineDotComplete]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Photo Submitted</Text>
            <Text style={styles.timelineText}>Your photo has been received</Text>
          </View>
        </View>

        <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, styles.timelineDotActive]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Under Review</Text>
            <Text style={styles.timelineText}>Admin is verifying your photo</Text>
          </View>
        </View>

        <View style={styles.timelineItem}>
          <View style={styles.timelineDot} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Approved</Text>
            <Text style={styles.timelineText}>You'll be able to use the app</Text>
          </View>
        </View>
      </View>

      <View style={styles.helpBox}>
        <Text style={styles.helpText}>
          <Text style={styles.bold}>Need help?</Text>
          {'\n\n'}
          If your photo is rejected, you can resubmit with a clearer photo.
          {'\n\n'}
          Make sure your truck and the paper are both clearly visible!
        </Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
  flex: 1,
  backgroundColor: '#fff',
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
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#fff3cd',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 24,
  },
  icon: {
    fontSize: 50,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 16,
    color: '#333',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  bold: {
    fontWeight: '700',
    color: '#333',
  },
  infoBox: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  photoSection: {
    width: '100%',
    marginBottom: 24,
  },
  photoLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#666',
  },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#f8f9fa',
  },
  timelineContainer: {
    width: '100%',
    marginBottom: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#dee2e6',
    marginRight: 16,
    marginTop: 4,
  },
  timelineDotComplete: {
    backgroundColor: '#4CAF50',
  },
  timelineDotActive: {
    backgroundColor: '#FF9500',
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
    color: '#333',
  },
  timelineText: {
    fontSize: 14,
    color: '#666',
  },
  helpBox: {
    width: '100%',
    backgroundColor: '#e3f2fd',
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  helpText: {
    fontSize: 14,
    color: '#424242',
    lineHeight: 20,
  },
  logoutButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  logoutText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
});