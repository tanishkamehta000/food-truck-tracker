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

export default function ProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);

  // user
  const [favorites, setFavorites] = useState([]);
  const [cuisine, setCuisine] = useState('Any');

  // vendor
  const [menuItems, setMenuItems] = useState([]);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');

  useEffect(() => {
    (async () => {
      const type = await AsyncStorage.getItem('userType');
      const email = await AsyncStorage.getItem('userEmail');
      const prefCuisine = await AsyncStorage.getItem('preferredCuisine');
      if (prefCuisine) setCuisine(prefCuisine);
      setUserType(type);
      setUserEmail(email);
      setLoading(false);
    })();
  }, []);

  const handleLogout = async () => {
    try {
      // Firebase sign out
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

    // Reset navigation to Login screen
    try {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } catch (err) {
      // fallback
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

      return () => unsub();
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
      // If doc doesn't exist, catch and show message
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
        // If doc doesn't exist, create it with cuisine
        try {
          const ref = doc(db, 'vendors', userEmail);
          await setDoc(ref, { cuisine: value });
        } catch (e) {
          console.error('save vendor cuisine error', e);
          Alert.alert('Error', 'Could not save cuisine');
        }
      }
    } else {
      // user preference locally
      try {
        await AsyncStorage.setItem('preferredCuisine', value);
      } catch (err) {
        console.error('AsyncStorage save cuisine error', err);
      }
    }
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

    // Round to 2 decimals for storage
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
});
