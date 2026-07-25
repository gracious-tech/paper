
import {initializeApp} from 'firebase/app'
import {getAuth, connectAuthEmulator} from 'firebase/auth'
import {initializeFirestore, connectFirestoreEmulator} from 'firebase/firestore'
import {getStorage, connectStorageEmulator} from 'firebase/storage'


// Firebase web config (public identifiers, safe to commit — access is controlled by security
// rules, not by hiding these values)
const config = {
    apiKey: "AIzaSyA79zfGv_3w-kiyGbE-2iPQNDxD-J3pcqs",
    authDomain: "paper-bible.firebaseapp.com",
    projectId: "paper-bible",
    storageBucket: "paper-bible.firebasestorage.app",
    messagingSenderId: "886725246097",
    appId: "1:886725246097:web:6921eb0f43f9312dfa1330",
}


// Exposed so callers can build public Storage download URLs deterministically (see
// content_images.ts) without an extra getDownloadURL() round-trip
export const storage_bucket = config.storageBucket


// Init the app and the services used throughout the frontend
export const firebase_app = initializeApp(config)
export const firebase_auth = getAuth(firebase_app)
// NOTE ignoreUndefinedProperties strips undefined values (e.g. optional rich-text attrs)
// rather than erroring, since Firestore has no undefined type
export const firestore = initializeFirestore(firebase_app, {ignoreUndefinedProperties: true})
export const firebase_storage = getStorage(firebase_app)


// Use the local emulator suite during development (see .bin/serve_emulators)
if (import.meta.env.DEV){
    connectAuthEmulator(firebase_auth, 'http://localhost:9099', {disableWarnings: true})
    connectFirestoreEmulator(firestore, 'localhost', 8080)
    connectStorageEmulator(firebase_storage, 'localhost', 9199)
}
