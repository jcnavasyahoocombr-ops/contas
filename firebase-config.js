export const firebaseConfig = {
  apiKey: "AIzaSyDw0sTOdPcGJcGz5XnJvsfK4FF3koHiz0c",
  authDomain: "livro-de-contas-972cb.firebaseapp.com",
  projectId: "livro-de-contas-972cb",
  storageBucket: "livro-de-contas-972cb.firebasestorage.app",
  messagingSenderId: "238626180162",
  appId: "1:238626180162:web:aead022fbad1b2b50731db"
};

// Identificador do "espaço compartilhado" do casal. Pode deixar como está —
// só precisa ser o mesmo valor nos dois logins para que os dois vejam os
// mesmos dados. Se um dia quiser separar em espaços diferentes, é só mudar
// esse texto (e as regras do Firestore, ver README).
export const householdId = "nosso-espaco";

// Nomes usados no formulário de lançamento para marcar de quem é a conta.
// Edite com os nomes de vocês dois. Pode adicionar mais nomes se precisar.
export const pessoas = ["Eu", "Parceiro(a)"];