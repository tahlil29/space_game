import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export function isFirebaseConfigured() {
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId,
  );
}

let app = null;
let auth = null;
let db = null;

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  if (!app) app = initializeApp(config);
  return app;
}

export function getFirebaseAuth() {
  if (!isFirebaseConfigured()) return null;
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

export function getFirebaseDb() {
  if (!isFirebaseConfigured()) return null;
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export function firebaseConfigStatus() {
  return isFirebaseConfigured() ? "firebase" : "local";
}
