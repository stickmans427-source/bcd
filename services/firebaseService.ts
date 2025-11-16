import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth, User } from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    collection, 
    onSnapshot, 
    Firestore,
    addDoc,
    query,
    where,
    Timestamp,
    serverTimestamp
} from 'firebase/firestore';
import type { PlayerData, BlastData } from '../types';

// Firebase configuration is now read from environment variables.
// You must set these variables in your environment for the app to connect to Firebase.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

export class FirebaseService {
  private static instance: FirebaseService;
  public app: FirebaseApp;
  public auth: Auth;
  public db: Firestore;

  private constructor() {
    this.app = initializeApp(firebaseConfig);
    this.auth = getAuth(this.app);
    this.db = getFirestore(this.app);
  }

  public static getInstance(): FirebaseService {
    if (!FirebaseService.instance) {
      // Basic validation to ensure config is loaded
      if (!firebaseConfig.apiKey) {
        const errorMessage = "Firebase configuration is missing or invalid. Please ensure environment variables (e.g., FIREBASE_API_KEY) are set correctly.";
        console.error(errorMessage);
        // This will prevent the app from trying to connect with invalid credentials.
        throw new Error(errorMessage);
      }
      FirebaseService.instance = new FirebaseService();
    }
    return FirebaseService.instance;
  }

  async signIn(): Promise<User> {
    const userCredential = await signInAnonymously(this.auth);
    return userCredential.user;
  }

  async updatePlayerPosition(playerData: Omit<PlayerData, 'lastUpdate'>): Promise<void> {
    const playerRef = doc(this.db, 'players', playerData.id);
    await setDoc(playerRef, { ...playerData, lastUpdate: serverTimestamp() }, { merge: true });
  }

  onPlayersUpdate(callback: (players: PlayerData[]) => void): () => void {
    const playersRef = collection(this.db, 'players');
    // Query for players updated in the last 30 seconds to avoid loading old data
    const q = query(playersRef, where("lastUpdate", ">", new Timestamp(Date.now()/1000 - 30, 0)));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const players: PlayerData[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        players.push({
          id: doc.id,
          x: data.x,
          y: data.y,
          z: data.z,
          rotY: data.rotY,
          lastUpdate: (data.lastUpdate as Timestamp)?.toMillis() || Date.now()
        });
      });
      callback(players);
    });

    return unsubscribe;
  }

  async sendBlast(blastData: Omit<BlastData, 'id' | 'timestamp'>): Promise<void> {
    const blastsRef = collection(this.db, 'blasts');
    await addDoc(blastsRef, { ...blastData, timestamp: serverTimestamp() });
  }

  onBlastsUpdate(callback: (blasts: BlastData[]) => void): () => void {
    const blastsRef = collection(this.db, 'blasts');
    // Only listen for blasts created in the last 5 seconds
    const q = query(blastsRef, where("timestamp", ">", new Timestamp(Date.now()/1000 - 5, 0)));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const blasts: BlastData[] = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          blasts.push({
            id: change.doc.id,
            playerId: data.playerId,
            position: data.position,
            direction: data.direction,
            timestamp: (data.timestamp as Timestamp)?.toMillis() || Date.now()
          });
        }
      });
      if (blasts.length > 0) {
        callback(blasts);
      }
    });

    return unsubscribe;
  }
}

export const getFirebaseService = (): FirebaseService => {
    return FirebaseService.getInstance();
};
