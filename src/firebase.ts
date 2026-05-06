// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Copie estas chaves do seu painel do Firebase (Configurações do Projeto > Web)
const firebaseConfig = {
  apiKey: "AIzaSyAQLSb2Gux6E7dV-E_k-KzbLytBiLINFvQ",
  authDomain: "waze-do-sertao.firebaseapp.com",
  projectId: "waze-do-sertao",
  storageBucket: "waze-do-sertao.firebasestorage.app",
  messagingSenderId: "580213455503",
  appId: "1:580213455503:web:bacd658166e62728fc4efa"    
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);