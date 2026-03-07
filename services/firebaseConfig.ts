import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDIqWgUuLjkrrg1vQe5FuN1TY22WHoPQQs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "consultorfiscalapp.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "consultorfiscalapp",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "consultorfiscalapp.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "631239634290",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:631239634290:web:1edfcab8ba8e21f27c41eb",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);
