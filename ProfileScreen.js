import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, auth } from './firebaseConfig';
import { signOut } from 'firebase/auth';
import { Picker } from '@react-native-picker/picker';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayRemove,
  onSnapshot,
} from 'firebase/firestore';
import { listenToUserSubscriptions, subscribeToTruck, unsubscribeFromTruck, getCurrentPushToken, registerForPushNotificationsAsync } from './notifications';

function NotificationToggle({ truckId, userEmail, subscribed }) {
  const [loading, setLoading] = React.useState(false);

  const handleToggle = async () => {
    setLoading(true);
    try {
      const token = await getCurrentPushToken(userEmail);
      if (!token) {
        alert('Push notifications not enabled on this device. Go to Login and enable notifications.');
        setLoading(false);
        return;
      }

      if (subscribed) {
        await unsubscribeFromTruck(userEmail, token, truckId);
      } else {
        await subscribeToTruck(userEmail, token, truckId);
      }
    } catch (err) {
      console.error('Notification toggle error', err);
      alert('Unable to update notification preference.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.notifyButton, subscribed ? styles.notifyOn : styles.notifyOff]}
      onPress={handleToggle}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.notifyText}>{subscribed ? 'Stop 🔕' : 'Notify 🔔'}</Text>
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  const [phoneNumber, setPhoneNumber] = useState('');

  // user
  const [favorites, setFavorites] = useState([]);
  const [subscribedTrucks, setSubscribedTrucks] = useState([]);
  const [cuisine, setCuisine] = useState('Any');

  // vendor
  const [menuItems, setMenuItems] = useState([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');

  useEffect(() => {
    (async () => {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      setUserType(type);
      setUserEmail(email);
      // load phone number from users/{email}
      if (email) {
        try {
          const userRef = doc(db, 'users', email);
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            const data = snap.data();
            if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
          }
        } catch (err) {
          console.warn('Could not load phone number', err);
        }
      }
      setLoading(false);
    })();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('signOut error', err);
      // continue to clear local storage even if signOut fails
    }

    try {
      await AsyncStorage.removeItem('userType');
      await AsyncStorage.removeItem('userEmail');
    } catch (err) {
      console.warn('AsyncStorage clear error', err);
    }

    try {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (err) {
      navigation.navigate('Login');
    }
  };

  useEffect(() => {
    if (!userEmail || !userType) return;

    if (userType === 'user') {
      const ref = doc(db, 'favorites', userEmail);
      const unsub = onSnapshot(ref, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setFavorites(data.favorites || []);
        } else {
          setFavorites([]);
        }
      }, (err) => console.error('favorites onSnapshot error', err));

      const unsubSubs = listenToUserSubscriptions(userEmail, (list) => setSubscribedTrucks(list || []));

      return () => { unsub(); if (typeof unsubSubs === 'function') unsubSubs(); };
    }

    if (userType === 'vendor') {
      const ref = doc(db, 'vendors', userEmail);
      const unsub = onSnapshot(ref, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          // Ensure prices are numbers rounded to 2 decimals
          const normalized = (data.menu || []).map((it) => {
            const price = Number(it.price);
            return { ...it, price: Number.isFinite(price) ? Math.round(price * 100) / 100 : 0 };
          });
          setMenuItems(normalized);
          if (data.cuisine) setCuisine(data.cuisine);
        } else {
          setMenuItems([]);
        }
      }, (err) => console.error('vendors onSnapshot error', err));

      return () => unsub();
    }
  }, [userEmail, userType]);

  

  const unpin = async (truckName) => {
    if (!userEmail) return;
    try {
      const ref = doc(db, 'favorites', userEmail);
      await updateDoc(ref, { favorites: arrayRemove(truckName) });
    } catch (err) {
      console.error('unpin error', err);
      Alert.alert('Error', 'Unable to remove favorite.');
    }
  };

    const cuisineOptions = [
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
  const handleCuisineChange = async (value) => {
    setCuisine(value);
    if (userType === 'vendor') {
      if (!userEmail) return;
      try {
        const ref = doc(db, 'vendors', userEmail);
        await updateDoc(ref, { cuisine: value });
      } catch (err) {
        try {
          const ref = doc(db, 'vendors', userEmail);
          await setDoc(ref, { cuisine: value });
        } catch (e) {
          console.error('save vendor cuisine error', e);
          Alert.alert('Error', 'Could not save cuisine');
        }
      }
  };
  };

  const addMenuItem = () => {
    if (!newItemName.trim() || !newItemPrice.trim()) {
      Alert.alert('Validation', 'Please enter item name and price.');
      return;
    }

    const parsed = parseFloat(newItemPrice);
    if (isNaN(parsed)) {
      Alert.alert('Validation', 'Please enter a valid number for price.');
      return;
    }

    // Round to 2 decimals
    const priceNumber = Math.round(parsed * 100) / 100;

    const item = { name: newItemName.trim(), price: priceNumber };
    setMenuItems((prev) => [...prev, item]);
    setNewItemName('');
    setNewItemPrice('');
  };

  const removeMenuItem = (index) => {
    setMenuItems((prev) => prev.filter((_, i) => i !== index));
  };

  const saveMenu = async () => {
    if (!userEmail) return;
    try {
      const ref = doc(db, 'vendors', userEmail);
      await setDoc(ref, { menu: menuItems });
      Alert.alert('Saved', 'Menu saved successfully.');
    } catch (err) {
      console.error('saveMenu error', err);
      Alert.alert('Error', 'Unable to save menu.');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!userEmail || !userType) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Please login to view your profile.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Profile</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {userType === 'vendor' && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: '600', marginBottom: 6 }}>Cuisine</Text>
          <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 8, overflow: 'hidden' }}>
            <Picker selectedValue={cuisine} onValueChange={handleCuisineChange}>
              {cuisineOptions.map((c) => (
                <Picker.Item key={c} label={c} value={c} />
              ))}
            </Picker>
          </View>
        </View>
      )}

      {/* Phone number (stored in users/{email}) */}
      <View style={{ marginBottom: 12 }}>
        <Text style={{ fontWeight: '600', marginBottom: 6 }}>Phone number</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            placeholder="(555) 555-5555"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            style={[styles.input, { flex: 1 }]}
            keyboardType="phone-pad"
            returnKeyType="done"
            blurOnSubmit={true}
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          <TouchableOpacity
            style={[styles.saveButton, { marginLeft: 8 }]}
            onPress={async () => {
              Keyboard.dismiss();
              if (!userEmail) return Alert.alert('Not logged in', 'Please log in to save phone number.');
              try {
                const userRef = doc(db, 'users', userEmail);
                await setDoc(userRef, { phoneNumber }, { merge: true });
                Alert.alert('Saved', 'Phone number saved.');
              } catch (err) {
                console.error('save phone error', err);
                Alert.alert('Error', 'Could not save phone number.');
              }
            }}
          >
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapButton, { marginLeft: 8 }]}
            onPress={async () => {
              if (!userEmail) return Alert.alert('Not logged in', 'Please log in to view push token.');
              try {
                let token = await getCurrentPushToken(userEmail);
                if (!token) {
                  // try registering anew
                  token = await registerForPushNotificationsAsync(userEmail);
                }
                Alert.alert('Push Token', token || 'No push token available');
              } catch (err) {
                console.error('show token error', err);
                Alert.alert('Error', 'Could not retrieve push token.');
              }
            }}
          >
            <Text style={styles.mapButtonText}>Show Push Token</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapButton, { marginLeft: 8 }]}
            onPress={async () => {
              if (!userEmail) return Alert.alert('Not logged in', 'Please log in to receive test notifications.');
              try {
                let token = await getCurrentPushToken(userEmail);
                if (!token) {
                  token = await registerForPushNotificationsAsync(userEmail);
                }
                if (!token) {
                  return Alert.alert('No token', 'No push token available to send a test.');
                }

                // Quick token type check: Expo tokens start with "ExponentPushToken["
                const isExpoToken = typeof token === 'string' && token.startsWith('ExponentPushToken[');
                if (!isExpoToken) {
                  return Alert.alert(
                    'Not an Expo token',
                    'The token returned is not an Expo push token (it looks like a native FCM/APNs token).\n\n' +
                    'Options:\n' +
                    '• Run the local send script (uses Firebase admin) to send to native tokens.\n' +
                    '• Open the app in Expo Go to get an Expo token (ExponentPushToken[...]) and then use Send Test Push.\n' +
                    '\nTell me which you prefer and I can help with the next steps.'
                  );
                }

                const message = {
                  to: token,
                  title: 'Food Truck Tracker — Test',
                  body: 'This is a test notification sent from your device.',
                  data: { test: 'true' },
                };

                const res = await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(message),
                });

                const json = await res.json().catch(() => null);
                if (!res.ok) {
                  console.error('Expo push send failed', res.status, json);
                  return Alert.alert('Send failed', JSON.stringify(json) || `Status ${res.status}`);
                }

                // The API may return an object with data or errors
                if (json && json.data && json.data.status === 'error') {
                  return Alert.alert('Send error', json.data.message || 'Unknown error');
                }

                Alert.alert('Sent', 'Test notification sent — check your device.');
              } catch (err) {
                console.error('send test push error', err);
                Alert.alert('Error', err.message || String(err));
              }
            }}
          >
            <Text style={styles.mapButtonText}>Send Test Push</Text>
          </TouchableOpacity>
          {/* Debug buttons removed to keep profile UI minimal during testing. */}
        </View>
      </View>

      {userType === 'user' && (
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Your Pinned Trucks</Text>
          {favorites.length === 0 ? (
            <Text style={styles.message}>You haven't pinned any trucks yet.</Text>
          ) : (
            <FlatList
              data={favorites}
              keyExtractor={(item, idx) => item + idx}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <Text style={styles.rowText}>{item}</Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                      style={styles.mapButton}
                      onPress={() => navigation.navigate('Map', { screen: 'Food Truck Map', params: { focusTruckName: item } })}
                    >
                      <Text style={styles.mapButtonText}>See on map 🗺️</Text>
                    </TouchableOpacity>

                        <TouchableOpacity style={styles.unpinButton} onPress={() => unpin(item)}>
                          <Text style={styles.unpinText}>Unpin</Text>
                        </TouchableOpacity>

                        {/* Notification toggle button */}
                        {userType === 'user' && (
                          <NotificationToggle
                            truckId={item}
                            userEmail={userEmail}
                            subscribed={subscribedTrucks && subscribedTrucks.includes(item)}
                          />
                        )}
                  </View>
                </View>
              )}
            />
          )}
        </View>
      )}

      {userType === 'vendor' && (
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Edit Menu</Text>

          <View style={styles.addRow}>
            <TextInput
              placeholder="Item name"
              value={newItemName}
              onChangeText={setNewItemName}
              style={styles.input}
            />
            <TextInput
              placeholder="Price"
              value={newItemPrice}
              onChangeText={setNewItemPrice}
              style={[styles.input, { width: 100 }]}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.addButton} onPress={addMenuItem}>
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {menuItems.length === 0 ? (
            <Text style={styles.message}>No menu items yet. Add items and save.</Text>
          ) : (
            <FlatList
              data={menuItems}
              keyExtractor={(_, idx) => String(idx)}
              renderItem={({ item, index }) => (
                <View style={styles.menuRow}>
                  <Text style={styles.rowText}>{item.name} — ${Number(item.price).toFixed(2)}</Text>
                  <TouchableOpacity style={styles.deleteButton} onPress={() => removeMenuItem(index)}>
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}

          <TouchableOpacity style={styles.saveButton} onPress={saveMenu}>
            <Text style={styles.saveText}>Save Menu</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginVertical: 10 },
  message: { color: '#666' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  rowText: { fontSize: 16 },
  unpinButton: { backgroundColor: '#FF3B30', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  unpinText: { color: 'white', fontWeight: '600' },
  mapButton: { backgroundColor: '#007AFF', padding: 8, borderRadius: 6, marginRight: 8 },
  mapButtonText: { color: 'white', fontSize: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  logoutButton: { backgroundColor: '#FF3B30', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  logoutText: { color: 'white', fontWeight: '700' },
  addRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, marginRight: 8 },
  addButton: { backgroundColor: '#007AFF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  addButtonText: { color: 'white', fontWeight: '700' },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  deleteButton: { backgroundColor: '#FF3B30', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  deleteText: { color: 'white', fontWeight: '600' },
  saveButton: { backgroundColor: '#34C759', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  saveText: { color: 'white', fontWeight: '700' },
  notifyButton: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginLeft: 8 },
  notifyOn: { backgroundColor: '#FF9500' },
  notifyOff: { backgroundColor: '#007AFF' },
  notifyText: { color: 'white', fontWeight: '700' },
});
