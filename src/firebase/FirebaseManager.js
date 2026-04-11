import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = { 
    apiKey: "AIzaSyC0yzzu9f6PM0zfnr463jRdsRrXpkqP-YA", 
    authDomain: "solosola-v4.firebaseapp.com", 
    projectId: "solosola-v4", 
    storageBucket: "solosola-v4.firebasestorage.app", 
    messagingSenderId: "937332002715", 
    appId: "1:937332002715:web:17d4933814874b2d7adb3e" 
};

let app, auth, db, storage;

export const FirebaseManager = {
    init(onAuthStateChangedCallback) {
        if (!app) {
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            storage = getStorage(app);
        }
        if (onAuthStateChangedCallback) {
            onAuthStateChanged(auth, onAuthStateChangedCallback);
        }
    },

    async login() {
        if (!auth) throw new Error("Firebase is not initialized");
        const provider = new GoogleAuthProvider();
        return await signInWithPopup(auth, provider);
    },

    async logout() {
        if (!auth) throw new Error("Firebase is not initialized");
        return await signOut(auth);
    },

    async loadAllSets(targetUserId = null) {
        if (!db) throw new Error("Firebase is not initialized");
        const setsData = {};
        
        let q;
        if (targetUserId) {
            q = query(collection(db, "sets"), where("ownerId", "==", targetUserId));
        } else {
            q = collection(db, "sets");
        }

        const querySnapshot = await getDocs(q);
        let defaultSetId = null;
        let mainSetId = null;

        if (!querySnapshot.empty) {
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                setsData[doc.id] = data;
                if (!defaultSetId) defaultSetId = doc.id;
                if (data.isMain === true) mainSetId = doc.id;
            });
        }
        return { data: setsData, defaultSetId, mainSetId };
    },

    async updateSetSamples(setId, newSamples) {
        if (!db) throw new Error("Firebase is not initialized");
        const setRef = doc(db, "sets", setId);
        await updateDoc(setRef, { samples: newSamples });
    },

    async uploadAudioFile(userId, setId, fileBlob, filename) {
        if (!storage) throw new Error("Firebase is not initialized");
        const storageRef = ref(storage, `users/${userId}/${setId}/${Date.now()}_${filename}`);
        await uploadBytes(storageRef, fileBlob);
        return await getDownloadURL(storageRef);
    }
};
