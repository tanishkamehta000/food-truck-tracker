import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBO6598e6Cy0IhOUV4PHePyXi96nhxmRxs",
    authDomain: "food-truck-tracker-77775.firebaseapp.com",
    projectId: "food-truck-tracker-77775",
    storageBucket: "food-truck-tracker-77775.firebasestorage.app",
    messagingSenderId: "1093111358141",
    appId: "1:1093111358141:web:c051a80ae711c9eb1acdd4"
  };
  
// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore
const db = getFirestore(app);
export const auth = getAuth(app);

const storage = getStorage(app);

export { db, auth, storage };