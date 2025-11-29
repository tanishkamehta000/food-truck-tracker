import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from './firebaseConfig';

function DiscoverScreen({ navigation }) {
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userType, setUserType] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [userId, setUserId] = useState(null);
  const [favorites, setFavorites] = useState([]);

  // Load user identity info
  useEffect(() => {
    (async () => {
      try {
        const type = await AsyncStorage.getItem('userType');
        const email = await AsyncStorage.getItem('userEmail');
        const id = await AsyncStorage.getItem('userId');
        setUserType(type);
        setUserEmail(email);
        setUserId(id);
      } catch (e) {
        console.warn('DiscoverScreen: error loading user info from AsyncStorage', e);
      }
    })();
  }, []);

  // Listen for favorites for this user 
  useEffect(() => {
    if (!(userId || userEmail) || userType !== 'user') {
      setFavorites([]);
      return;
    }

    const docKey = userId || userEmail;
    const favRef = doc(db, 'favorites', docKey);

    const unsub = onSnapshot(
      favRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setFavorites(data.favorites || []);
        } else {
          setFavorites([]);
        }
      },
      (err) => console.error('favorites onSnapshot error (DiscoverScreen):', err)
    );

    return () => unsub();
  }, [userId, userEmail, userType]);

  // Listen for advertised trucks
  useEffect(() => {
    const q = query(collection(db, 'advertisedTrucks'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const activeOnly = list.filter((a) => a.isActive !== false);
        setAds(activeOnly);
        setLoading(false);
      },
      (err) => {
        console.error('advertisedTrucks onSnapshot error:', err);
        setAds([]);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const openOnMap = (truckName) => {
    navigation.navigate('Map', {
      screen: 'Map',
      params: { focusTruckName: truckName },
    });
  };

  const toggleFavorite = async (truckName) => {
    if (!(userId || userEmail)) {
      Alert.alert('Not logged in', 'Please log in to pin trucks.');
      return;
    }

    if (userType !== 'user') {
      Alert.alert('Not allowed', 'Only users can pin trucks.');
      return;
    }

    const docKey = userId || userEmail;
    const favRef = doc(db, 'favorites', docKey);

    try {
      const isFavorited = favorites && favorites.includes(truckName);
      if (isFavorited) {
        await updateDoc(favRef, { favorites: arrayRemove(truckName) });
      } else {
        try {
          await updateDoc(favRef, { favorites: arrayUnion(truckName) });
        } catch (err) {
          await setDoc(favRef, { favorites: [truckName] });
        }
      }
    } catch (err) {
      console.error('toggleFavorite (DiscoverScreen) error', err);
      Alert.alert('Error', 'Could not update favorites.');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 8, color: '#666' }}>Loading featured trucks…</Text>
      </View>
    );
  }

  if (!ads.length) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
          backgroundColor: '#fff',
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 6 }}>
          No advertised trucks yet
        </Text>
        <Text style={{ fontSize: 13, color: '#666', textAlign: 'center' }}>
          When trucks pay for featured placement, they&#39;ll appear here so you can discover them
          even when they&#39;re not currently active.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f5f5f5' }}
      contentContainerStyle={{ padding: 12 }}
    >
      {ads.map((ad) => {
        const truckName = ad.truckName || ad.foodTruckName || 'Food Truck';
        const cuisine = ad.cuisineType || 'Street Food';
        const description = ad.description || 'Featured truck';
        const isFavorited = favorites && favorites.includes(truckName);

        return (
          <View
            key={ad.id}
            style={{
              backgroundColor: 'white',
              borderRadius: 12,
              padding: 12,
              marginBottom: 10,
              shadowColor: '#000',
              shadowOpacity: 0.08,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 10,
                  backgroundColor: '#eee',
                  marginRight: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text>📷</Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>{truckName}</Text>
                {/* Placeholder star rating */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Text style={{ fontSize: 12 }}>⭐ 4.8</Text>
                </View>
                <Text style={{ fontSize: 13, color: '#555' }}>{description}</Text>
                <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{cuisine}</Text>

              </View>

              {/* Pin button (users only) */}
              {userType === 'user' && (
                <TouchableOpacity
                  onPress={() => toggleFavorite(truckName)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 16,
                    backgroundColor: isFavorited ? '#FF3B30' : '#007AFF',
                  }}
                >
                  <Text style={{ color: 'white', fontSize: 12, fontWeight: '600' }}>
                    {isFavorited ? 'Unpin' : 'Pin'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* CTA row */}
            <View style={{ flexDirection: 'row', marginTop: 10 }}>
              <TouchableOpacity
                onPress={() => openOnMap(truckName)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: '#0B0B14',
                  alignItems: 'center',
                  marginRight: 8,
                }}
              >
                <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>
                  View on map
                </Text>
              </TouchableOpacity>

              {ad.website && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(ad.website)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: '#ddd',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#007AFF' }}>
                    Website
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

export default DiscoverScreen;
