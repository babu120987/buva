import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyDzBzP4O033Kohmv5Z7Mo3D6EpILAZGkvY",
  authDomain: "buva-90d4b.firebaseapp.com",
  projectId: "buva-90d4b",
  storageBucket: "buva-90d4b.firebasestorage.app",
  messagingSenderId: "531761011639",
  appId: "1:531761011639:web:eae636215af6cb02fda632",
  measurementId: "G-VWZFCED685"
};

export const firebaseApp = initializeApp(firebaseConfig);
getAnalytics(firebaseApp);
