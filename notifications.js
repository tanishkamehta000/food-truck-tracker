import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from './firebaseConfig';

export async function registerForPushNotificationsAsync(userEmail) {
  try {
    if (!Device.isDevice) {
      console.log('Push notifications are not supported on emulators/simulators. Use a physical device.');
      return null;
    }

    console.log('Checking notification permissions...');
    const perm = await Notifications.getPermissionsAsync();
    console.log('Existing permissions:', perm);
    let finalStatus = perm.status;
    if (finalStatus !== 'granted') {
      console.log('Requesting notification permissions...');
      const req = await Notifications.requestPermissionsAsync();
      console.log('Request result:', req);
      finalStatus = req.status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token permission');
      return null;
    }

    let pushToken = null;
    try {
      console.log('Attempting to get Expo push token via getExpoPushTokenAsync...');
      const tokenResponse = await Notifications.getExpoPushTokenAsync();
      console.log('getExpoPushTokenAsync response:', tokenResponse);
      pushToken = tokenResponse.data || tokenResponse;
    } catch (e1) {
      console.warn('getExpoPushTokenAsync failed, trying getDevicePushTokenAsync:', e1);
      try {
        const devToken = await Notifications.getDevicePushTokenAsync();
        console.log('getDevicePushTokenAsync response:', devToken);
        // devToken may be an object { data: '<token>' } or string
        pushToken = devToken.data || devToken;
      } catch (e2) {
        console.error('Both getExpoPushTokenAsync and getDevicePushTokenAsync failed', e2);
        return null;
      }
    }

    if (!pushToken) {
      console.warn('No push token returned after attempts');
      return null;
    }

    // Save token to AsyncStorage for quick access
    try {
      await AsyncStorage.setItem('pushToken', pushToken);
    } catch (e) {
      console.warn('Unable to persist push token locally', e);
    }

    // Save token to Firestore under users/{email}.pushTokens map
    try {
      const userRef = doc(db, 'users', userEmail);
      await setDoc(userRef, { pushTokens: { [pushToken]: { createdAt: new Date().toISOString(), platform: Device.osName || 'unknown' } } }, { merge: true });
      console.log('Saved push token to Firestore for', userEmail);
    } catch (err) {
      console.error('Error saving push token to Firestore', err);
    }

    return pushToken;
  } catch (err) {
    console.error('registerForPushNotificationsAsync error', err);
    return null;
  }
}

export async function subscribeToTruck(userEmail, pushToken, truckId) {
  if (!userEmail || !pushToken || !truckId) return;

  try {
    const userRef = doc(db, 'users', userEmail);
    await updateDoc(userRef, { subscribedTrucks: arrayUnion(truckId) });
  } catch (err) {
    try {
      const userRef = doc(db, 'users', userEmail);
      await setDoc(userRef, { subscribedTrucks: [truckId] }, { merge: true });
    } catch (e) {
      console.error('subscribeToTruck: could not update user doc', e);
    }
  }

  try {
    const subRef = doc(db, 'subscriptions', truckId);
    await setDoc(subRef, { tokens: arrayUnion(pushToken) }, { merge: true });
  } catch (err) {
    console.error('subscribeToTruck: could not update subscriptions doc', err);
  }
}

export async function unsubscribeFromTruck(userEmail, pushToken, truckId) {
  if (!userEmail || !pushToken || !truckId) return;

  try {
    const userRef = doc(db, 'users', userEmail);
    await updateDoc(userRef, { subscribedTrucks: arrayRemove(truckId) });
  } catch (err) {
    console.warn('unsubscribeFromTruck: user update failed', err);
  }

  try {
    const subRef = doc(db, 'subscriptions', truckId);
    await updateDoc(subRef, { tokens: arrayRemove(pushToken) });
  } catch (err) {
    console.warn('unsubscribeFromTruck: subscription update failed', err);
  }
}

export function listenToUserSubscriptions(userEmail, onChange) {
  if (!userEmail) return () => {};
  const ref = doc(db, 'users', userEmail);
  const unsub = onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      onChange(data.subscribedTrucks || []);
    } else {
      onChange([]);
    }
  }, (err) => {
    console.error('listenToUserSubscriptions onSnapshot error', err);
    onChange([]);
  });

  return unsub;
}

export async function getCurrentPushToken(userEmail) {
  try {
    const local = await AsyncStorage.getItem('pushToken');
    if (local) return local;

    if (!userEmail) return null;
    const userRef = doc(db, 'users', userEmail);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return null;
    const data = snap.data();
    const tokens = data.pushTokens || {};
    const keys = Object.keys(tokens);
    return keys.length > 0 ? keys[0] : null;
  } catch (err) {
    console.error('getCurrentPushToken error', err);
    return null;
  }
}

export default {
  registerForPushNotificationsAsync,
  subscribeToTruck,
  unsubscribeFromTruck,
  listenToUserSubscriptions,
  getCurrentPushToken,
};
