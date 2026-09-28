import { deleteToken, getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-messaging.js";
import { firebaseApp } from "./firebase.js";

const messaging = getMessaging(firebaseApp);
onMessage(messaging, (payload) => {
  window.dispatchEvent(new CustomEvent("buva:notification", { detail: payload.notification || {} }));
});

const VAPID_KEY = "BEgTYw-_ccf5NvEB6-3z2OK3LFXnqxL0a5yE108-C6gnQlXNO6Du50_Mdq5H_BSoIw_pWuD56KKOZoz_jq2xxyY";

export async function requestNotificationPermission() {
  try {
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      console.log("BUVA notifications permission:", permission);
      return null;
    }

    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js"
    );

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) localStorage.setItem("buvaNotificationToken", token);
    return token;
  } catch (error) {
    console.error("BUVA FCM setup failed:", error);
    return null;
  }
}

export async function removeNotificationDevice() {
  try { await deleteToken(messaging); } catch (error) { console.warn("Could not remove browser notification token", error); }
  localStorage.removeItem("buvaNotificationToken");
}

window.requestBuvaNotificationPermission = requestNotificationPermission;
