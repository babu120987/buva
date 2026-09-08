import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyCxxoNDwoy2QqPtjN6Sm5Ski2eb_VY_I9I",
  authDomain: "buva-90d4b.firebaseapp.com",
  projectId: "buva-90d4b",
  storageBucket: "buva-90d4b.firebasestorage.app",
  messagingSenderId: "531761011639",
  appId: "1:531761011639:web:eae636215af6cb02fda632",
  measurementId: "G-VWZFCED685"
};

const firebaseApp = initializeApp(firebaseConfig);
getAnalytics(firebaseApp);
