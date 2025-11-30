import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { storage, db } from './firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';


export default function VendorPhotoVerificationScreen({ navigation, route }) {
  const [loading, setLoading] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [showExample, setShowExample] = useState(false);

const truckName = route.params?.truckName || 'Your Truck Name';
  const todayDate = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });


   const requestCameraPermission = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is needed to take verification photos.');
        return false;
      }
    }
    return true;
  };


  const requestMediaLibraryPermission = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library permission is needed to select photos.');
        return false;
      }
    }
    return true;
  };

  const takePhoto = async () => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled) {
        setPhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };


  const selectPhoto = async () => {
    const hasPermission = await requestMediaLibraryPermission();
    if (!hasPermission) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled) {
        setPhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Error selecting photo:', error);
      Alert.alert('Error', 'Failed to select photo. Please try again.');
    }
  };

  const uploadPhoto = async () => {
    if (!photo) {
      Alert.alert('No Photo', 'Please take or select a photo first.');
      return;
    }

    setLoading(true);

    try {
      const userEmail = await AsyncStorage.getItem('userEmail');


      const response = await fetch(photo.uri);
      const blob = await response.blob();


      //need to double check this
      const filename = `${userEmail}_${Date.now()}.jpg`;
      const storageRef = ref(storage, `verification_photos/${filename}`);
      
      console.log('Uploading photo to Firebase Storage...');
      await uploadBytes(storageRef, blob);

      const photoURL = await getDownloadURL(storageRef);
      console.log('Photo uploaded, URL:', photoURL);


      const vendorRef = doc(db, 'vendors', userEmail);
      await updateDoc(vendorRef, {
        verificationPhotoURL: photoURL,
        verificationStatus: 'pending_photo',
        photoSubmittedAt: new Date().toISOString(),
      });

      console.log('Checkpoint: Vendor document updated');

      Alert.alert(
        'Photo Submitted!',
        'Your verification photo has been submitted for review. You\'ll be notified within 24 hours.',
        [
          {
            text: 'OK',
            onPress: () => navigation.replace('VendorPendingScreen')
          }
        ]
      );

      } catch (error) {
      console.error('Error uploading photo:', error);
      Alert.alert('Upload Failed', 'Failed to upload photo. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📸 Photo Verification</Text>
        <Text style={styles.subtitle}>
          Take a photo to verify your food truck
        </Text>
      </View>

      {/* basic instructions added for users */}
      <View style={styles.instructionsBox}>
        <Text style={styles.instructionsTitle}>Instructions:</Text>
        <Text style={styles.instructionsText}>
          1. Write on a piece of paper:{'\n'}
          {'\n'}
          <Text style={styles.boldText}>   "{truckName}"{'\n'}</Text>
          <Text style={styles.boldText}>   "{todayDate}"{'\n'}</Text>
          <Text style={styles.boldText}>   "Food Truck Tracker"{'\n'}</Text>
          {'\n'}
          2. Hold the paper in front of your truck{'\n'}
          {'\n'}
          3. Take a clear photo showing BOTH:
             • Your food truck
             • The paper with all 3 lines
        </Text>
      </View>

      {/* an example of how to submit */}
      <TouchableOpacity 
        style={styles.exampleButton}
        onPress={() => setShowExample(!showExample)}
      >
        <Text style={styles.exampleButtonText}>
          {showExample ? '▼ Hide Example' : '▶ See Example Photo'}
        </Text>
      </TouchableOpacity>

      {/* showing the example image, probably gonna use fake photo here */}
      {showExample && (
        <View style={styles.exampleContainer}>
          <View style={styles.examplePlaceholder}>
            <Text style={styles.exampleEmoji}>🚚</Text>
            <View style={styles.examplePaper}>
              <Text style={styles.examplePaperText}>
                Joe's Tacos{'\n'}
                Nov 24, 2024{'\n'}
                Food Truck Tracker
              </Text>
            </View>
            <Text style={styles.exampleCaption}>
              ← Paper in front of truck
            </Text>
          </View>
          <Text style={styles.exampleNote}>
            Make sure both your truck and the paper are clearly visible!
          </Text>
        </View>
      )}

      {/* photos */}
      {photo && (
        <View style={styles.photoPreview}>
          <Text style={styles.photoPreviewTitle}>Your Photo:</Text>
          <Image source={{ uri: photo.uri }} style={styles.photoImage} />
          <TouchableOpacity 
            style={styles.retakeButton}
            onPress={() => setPhoto(null)}
          >
            <Text style={styles.retakeButtonText}>Remove Photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* butons to press for vendors */}
      {!photo && (
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={styles.cameraButton}
            onPress={takePhoto}
          >
            <Text style={styles.buttonText}>📷 Take Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.galleryButton}
            onPress={selectPhoto}
          >
            <Text style={styles.buttonText}>📁 Choose from Gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* submit */}
      {photo && (
        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={uploadPhoto}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>✅ Submit for Verification</Text>
          )}
        </TouchableOpacity>
      )}

      {/* any help needed, vendor should use this */}
      <View style={styles.helpBox}>
        <Text style={styles.helpTitle}>💡 Tips:</Text>
        <Text style={styles.helpText}>
          • Write clearly and legibly{'\n'}
          • Make sure the date is today's date{'\n'}
          • Both truck and paper should be in focus{'\n'}
          • Take photo in good lighting{'\n'}
          • Review time: Usually within 24 hours
        </Text>
      </View>

      <TouchableOpacity 
        style={styles.cancelButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
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
  header: {
    marginBottom: 20,
    marginTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  instructionsBox: {
    backgroundColor: '#fff3cd',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9500',
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
    color: '#856404',
  },
  instructionsText: {
    fontSize: 14,
    color: '#856404',
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700',
    fontSize: 15,
  },
  exampleButton: {
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  exampleButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  exampleContainer: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  examplePlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  exampleEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  examplePaper: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#333',
  },
  examplePaperText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    color: '#333',
  },
  exampleCaption: {
    position: 'absolute',
    bottom: 10,
    fontSize: 12,
    color: '#666',
  },
  exampleNote: {
    marginTop: 12,
    fontSize: 13,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  photoPreview: {
    marginBottom: 16,
  },
  photoPreviewTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  photoImage: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    marginBottom: 12,
  },
  retakeButton: {
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  retakeButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonContainer: {
    marginBottom: 16,
  },
  cameraButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  galleryButton: {
    backgroundColor: '#34C759',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  submitButton: {
    backgroundColor: '#FF9500',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  helpBox: {
    backgroundColor: '#e3f2fd',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#1976D2',
  },
  helpText: {
    fontSize: 14,
    color: '#424242',
    lineHeight: 20,
  },
  cancelButton: {
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
});