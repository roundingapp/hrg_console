// Firebase for the read-only console: same project + login as the HRG Pay Tracker.
// Memory cache only — no PHI is persisted in the browser (no IndexedDB/offline cache).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeFirestore, doc, getDocFromServer, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const app = initializeApp({
  apiKey: "AIzaSyBm0eGHFnFq91_Swjz5IYNi1t4YDzCRt60",
  authDomain: "hrg-pay-tracker.firebaseapp.com",
  projectId: "hrg-pay-tracker",
  storageBucket: "hrg-pay-tracker.firebasestorage.app",
  messagingSenderId: "236025870367",
  appId: "1:236025870367:web:87f5177336b0df6211bd2a",
});
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
window._fb = { db, auth: getAuth(app), fns: { doc, getDocFromServer, onSnapshot, onAuthStateChanged, signInWithEmailAndPassword, signOut } };
window.dispatchEvent(new Event("firebase-ready"));
