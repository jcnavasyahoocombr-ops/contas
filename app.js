import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, householdId, pessoas } from "./firebase-config.js";
import {
  competenciaDaCompra,
  gerarCompetenciasParceladas,
  nomeMesCompetencia,
} from "./fatura.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- ESTADO EM MEMÓRIA ----------
let uid = null;
let cartoes = [];      // [{id, nome, virada, vencimento}]
let lancamentos = [];  // [{id, descricao, valor, dataCompra, owner, pagamento, cartaoId, competencia, parcelaAtual, parcelasTotal, groupId}]
let mesSelecionado = formatoAnoMes(new Date());

function formatoAnoMes(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatarMoeda(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------- AUTENTICAÇÃO ----------
const telaLogin = document.getElementById("tela-login");
const telaApp = document.getElementById("app");
const formLogin = document.getElementById("form-login");
const loginErro = document.getElementById("login-erro");

formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErro.hidden = true;
  const email = document.getElementById("login-email").value;
  const senha = document.getElementById("login-senha").value;
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    mostrarErroLogin(err);
  }
});

document.getElementById("btn-cadastrar").addEventListener("click", async () => {
  loginErro.hidden = true;
  const email = document.getElementById("login-email").value;
  const senha = document.getElementById("login-senha").value;
  if (!email || !senha) {
    loginErro.textContent = "Preencha e-mail e senha para criar a conta.";
    loginErro.hidden = false;
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, senha);
  } catch (err) {
    mostrarErroLogin(err);
  }
});

function mostrarErroLogin(err) {
  const mapa = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail — tente entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
  };
  loginErro.textContent = mapa[err.code] || "Não foi possível entrar. Tente de novo.";
  loginErro.hidden = false;
}

document.getElementById("btn-sair").addEventListener("click", () => signOut(auth));

let unsubCartoes = null;
let unsubLancamentos = null;

onAuthStateChanged(auth, (user) => {
  if (user) {
    uid = user.uid;
    telaLogin.hidden = true;
    telaApp.hidden = false;
    iniciarListeners();
  } else {
    uid = null;
    telaApp.hidden = true;
    telaLogin.hidden = false;
    if (unsubCartoes) unsubCartoes();
    if (unsubLancamentos) unsubLancamentos();
    cartoes = [];
    lancamentos = [];
  }
});

function iniciarListeners() {
  const refCartoes = query(collection(db, "households", householdId, "cards"), orderBy("nome"));
  unsubCartoes = onSnapshot(refCartoes, (snap) => {
    cartoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarCartoes();
    preencherSelectCartoes();
    renderizarResumo();
  });

  const refLanc = query(collection(db, "households", householdId, "expenses"), orderBy("dataCompra", "desc"));
  unsubLancamentos = onSnapshot(refLanc, (snap) => {
    lancamentos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarLancamentos();
    renderizarResumo();
  });
}

// ---------- NAVEGAÇÃO ENTRE TELAS ----------
const navItens = document.querySelectorAll(".nav-item");
const views = {
  resumo: document.getElementById("view-resumo"),
  lancamentos: document.getElementById("view-lancamentos"),
  cartoes: document.getElementById("view-cartoes"),
};
navItens.forEach((btn) => {
  btn.addEventListener("click", () => {
    navItens.forEach((b) => b.classList.remove("ativo"));
    btn.classList.add("ativo");
    Object.values(views).forEach((v) => (v.hidden = true));
    views[btn.dataset.view].hidden = false;
  });
});

// ---------- CARTÕES ----------
const formCartao = document.getElementById("form-cartao");
const cartaoErro = document.getElementById("cartao-erro");

formCartao.addEventListener("submit", async (e) => {
  e.preventDefault();
  cartaoErro.hidden = true;
  const nome = document.getElementById("cartao-nome").value.trim();
  const virada = parseInt(document.getElementById("cartao-virada").value, 10);
  const vencimento = parseInt(document.getElementById("cartao-vencimento").value, 10);

  if (!nome || !virada || !vencimento) return;
  if (virada < 1 || virada > 31 || vencimento < 1 || vencimento > 31) {
    cartaoErro.textContent = "Os dias devem estar entre 1 e 31.";
    cartaoErro.hidden = false;
    return;
  }

  await addDoc(collection(db, "households", householdId, "cards"), {
    nome,
    virada,
    vencimento,
    criadoPorEmail: auth.currentUser.email,
  });
  formCartao.reset();
});

function renderizarCartoes() {
  const lista = document.getElementById("lista-cartoes");
  if (cartoes.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhum cartão cadastrado ainda.</p>';
    return;
  }
  lista.innerHTML = "";
  cartoes.forEach((c) => {
    const linha = document.createElement("div");
    linha.className = "linha-cartao";
    linha.innerHTML = `
      <div>
        <div class="linha-cartao-nome">${escapeHtml(c.nome)}</div>
        <div class="linha-cartao-datas">Vira dia ${c.virada} · vence dia ${c.vencimento}</div>
      </div>
      <button class="btn-excluir" data-id="${c.id}">excluir</button>
    `;
    linha.querySelector(".btn-excluir").addEventListener("click", async () => {
      const temLancamentos = lancamentos.some((l) => l.cartaoId === c.id);
      if (temLancamentos) {
        alert("Esse cartão tem lançamentos vinculados. Exclua os lançamentos primeiro.");
        return;
      }
      if (confirm(`Excluir o cartão "${c.nome}"?`)) {
        await deleteDoc(doc(db, "households", householdId, "cards", c.id));
      }
    });
    lista.appendChild(linha);
  });
}

function preencherSelectCartoes() {
  const select = document.getElementById("lanc-cartao");
  select.innerHTML = cartoes
    .map((c) => `<option value="${c.id}">${escapeHtml(c.nome)}</option>`)
    .join("");
}

// ---------- LANÇAMENTOS ----------
const grupoPagamento = document.getElementById("grupo-pagamento");
const camposCredito = document.getElementById("campos-credito");
grupoPagamento.addEventListener("change", () => {
  const tipo = grupoPagamento.querySelector("input:checked").value;
  camposCredito.hidden = tipo !== "credito";
  atualizarPreviewParcelas();
});

const grupoOwner = document.getElementById("grupo-owner");
const inputOwnerNome = document.getElementById("lanc-owner-nome");

// Monta os "pills" de pessoa a partir de firebase-config.js, mais uma
// opção livre "Outra pessoa" para convidados/pontuais.
grupoOwner.innerHTML =
  pessoas
    .map(
      (nome, i) =>
        `<label class="radio-pill"><input type="radio" name="owner" value="${escapeHtml(nome)}" ${i === 0 ? "checked" : ""} /> ${escapeHtml(nome)}</label>`
    )
    .join("") +
  `<label class="radio-pill"><input type="radio" name="owner" value="outro" /> Outra pessoa</label>`;

grupoOwner.addEventListener("change", () => {
  const tipo = grupoOwner.querySelector("input:checked").value;
  inputOwnerNome.hidden = tipo !== "outro";
  inputOwnerNome.required = tipo === "outro";
});

["lanc-data", "lanc-cartao", "lanc-parcelas"].forEach((id) => {
  document.getElementById(id).addEventListener("input", atualizarPreviewParcelas);
  document.getElementById(id).addEventListener("change", atualizarPreviewParcelas);
});

function atualizarPreviewParcelas() {
  const preview = document.getElementById("preview-parcelas");
  const tipo = grupoPagamento.querySelector("input:checked").value;
  if (tipo !== "credito") {
    preview.textContent = "";
    return;
  }
  const data = document.getElementById("lanc-data").value;
  const cartaoId = document.getElementById("lanc-cartao").value;
  const cartao = cartoes.find((c) => c.id === cartaoId);
  const parcelas = parseInt(document.getElementById("lanc-parcelas").value, 10) || 1;
  if (!data || !cartao) {
    preview.textContent = "";
    return;
  }
  const primeiraCompetencia = competenciaDaCompra(data, cartao.virada, cartao.vencimento);
  const lista = gerarCompetenciasParceladas(primeiraCompetencia, parcelas);
  if (parcelas === 1) {
    preview.textContent = `Vai para a fatura de ${nomeMesCompetencia(primeiraCompetencia)}.`;
  } else {
    preview.textContent = `De ${nomeMesCompetencia(lista[0])} até ${nomeMesCompetencia(lista[lista.length - 1])}.`;
  }
}

const formLancamento = document.getElementById("form-lancamento");
const lancErro = document.getElementById("lanc-erro");

formLancamento.addEventListener("submit", async (e) => {
  e.preventDefault();
  lancErro.hidden = true;

  const descricao = document.getElementById("lanc-descricao").value.trim();
  const valorTotal = parseFloat(document.getElementById("lanc-valor").value);
  const dataCompra = document.getElementById("lanc-data").value;
  const tipoOwner = grupoOwner.querySelector("input:checked").value;
  const owner = tipoOwner === "outro" ? inputOwnerNome.value.trim() : tipoOwner;
  const pagamento = grupoPagamento.querySelector("input:checked").value;

  if (!descricao || !valorTotal || !dataCompra) return;
  if (tipoOwner === "outro" && !owner) {
    lancErro.textContent = "Informe o nome da pessoa.";
    lancErro.hidden = false;
    return;
  }

  if (pagamento === "debito") {
    await addDoc(collection(db, "households", householdId, "expenses"), {
      descricao,
      valor: valorTotal,
      dataCompra,
      owner,
      pagamento: "debito",
      cartaoId: null,
      competencia: dataCompra.slice(0, 7),
      parcelaAtual: 1,
      parcelasTotal: 1,
      groupId: null,
      criadoPorEmail: auth.currentUser.email,
    });
  } else {
    const cartaoId = document.getElementById("lanc-cartao").value;
    const cartao = cartoes.find((c) => c.id === cartaoId);
    if (!cartao) {
      lancErro.textContent = "Cadastre um cartão antes de lançar uma compra no crédito.";
      lancErro.hidden = false;
      return;
    }
    const parcelasTotal = parseInt(document.getElementById("lanc-parcelas").value, 10) || 1;
    const primeiraCompetencia = competenciaDaCompra(dataCompra, cartao.virada, cartao.vencimento);
    const competencias = gerarCompetenciasParceladas(primeiraCompetencia, parcelasTotal);
    const valorParcela = Math.round((valorTotal / parcelasTotal) * 100) / 100;
    const groupId = crypto.randomUUID();

    const batch = writeBatch(db);
    competencias.forEach((competencia, i) => {
      const ref = doc(collection(db, "households", householdId, "expenses"));
      batch.set(ref, {
        descricao,
        valor: valorParcela,
        dataCompra,
        owner,
        pagamento: "credito",
        cartaoId,
        competencia,
        parcelaAtual: i + 1,
        parcelasTotal,
        groupId,
        criadoPorEmail: auth.currentUser.email,
      });
    });
    await batch.commit();
  }

  formLancamento.reset();
  camposCredito.hidden = true;
  inputOwnerNome.hidden = true;
  document.getElementById("preview-parcelas").textContent = "";
});

function renderizarLancamentos() {
  const lista = document.getElementById("lista-lancamentos");
  if (lancamentos.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhum lançamento ainda.</p>';
    return;
  }
  lista.innerHTML = "";
  lancamentos.slice(0, 40).forEach((l) => {
    const cartao = cartoes.find((c) => c.id === l.cartaoId);
    const meta = [];
    meta.push(new Date(l.dataCompra + "T12:00:00").toLocaleDateString("pt-BR"));
    meta.push(`de ${l.owner}`);
    if (l.criadoPorEmail) meta.push(`lançado por ${l.criadoPorEmail.split("@")[0]}`);
    if (l.pagamento === "credito") {
      meta.push(cartao ? cartao.nome : "cartão removido");
      if (l.parcelasTotal > 1) meta.push(`parcela ${l.parcelaAtual}/${l.parcelasTotal}`);
    }

    const linha = document.createElement("div");
    linha.className = "linha-lancamento";
    linha.innerHTML = `
      <div class="linha-lancamento-info">
        <span class="linha-lancamento-desc">${escapeHtml(l.descricao)}</span>
        <span class="linha-lancamento-meta">
          <span class="${l.pagamento === "credito" ? "tag-credito" : "tag-debito"}">${l.pagamento === "credito" ? "crédito" : "débito"}</span>
          · ${meta.join(" · ")}
        </span>
      </div>
      <span class="linha-lancamento-valor">${formatarMoeda(l.valor)}</span>
      <button class="btn-excluir" data-id="${l.id}">excluir</button>
    `;
    linha.querySelector(".btn-excluir").addEventListener("click", async () => {
      if (confirm("Excluir este lançamento?")) {
        await deleteDoc(doc(db, "households", householdId, "expenses", l.id));
      }
    });
    lista.appendChild(linha);
  });
}

// ---------- RESUMO ----------
document.getElementById("mes-anterior").addEventListener("click", () => {
  mesSelecionado = deslocarMes(mesSelecionado, -1);
  renderizarResumo();
});
document.getElementById("mes-proximo").addEventListener("click", () => {
  mesSelecionado = deslocarMes(mesSelecionado, 1);
  renderizarResumo();
});

function deslocarMes(competencia, n) {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(ano, mes - 1 + n, 1);
  return formatoAnoMes(d);
}

function renderizarResumo() {
  const label = nomeMesCompetencia(mesSelecionado);
  document.getElementById("mes-atual-label").textContent = label;
  document.getElementById("mes-atual-label-2").textContent = label;

  const doMes = lancamentos.filter((l) => l.competencia === mesSelecionado);
  const debitoMes = doMes.filter((l) => l.pagamento === "debito");
  const creditoMes = doMes.filter((l) => l.pagamento === "credito");

  const totalDebito = debitoMes.reduce((s, l) => s + l.valor, 0);
  const totalCredito = creditoMes.reduce((s, l) => s + l.valor, 0);

  document.getElementById("total-debito-valor").textContent = formatarMoeda(totalDebito);
  document.getElementById("total-credito-valor").textContent = formatarMoeda(totalCredito);
  document.getElementById("total-mes-valor").textContent = formatarMoeda(totalDebito + totalCredito);

  // Faturas por cartão, no mês selecionado
  const listaFaturas = document.getElementById("lista-faturas-cartao");
  if (cartoes.length === 0) {
    listaFaturas.innerHTML = '<p class="vazio">Nenhum cartão cadastrado ainda.</p>';
  } else {
    listaFaturas.innerHTML = "";
    cartoes.forEach((c) => {
      const totalCartao = creditoMes
        .filter((l) => l.cartaoId === c.id)
        .reduce((s, l) => s + l.valor, 0);
      const linha = document.createElement("div");
      linha.className = "linha-fatura";
      linha.innerHTML = `
        <span class="linha-fatura-nome">${escapeHtml(c.nome)}</span>
        <span class="linha-fatura-valor">${formatarMoeda(totalCartao)}</span>
      `;
      listaFaturas.appendChild(linha);
    });
  }

  // Quem deve o quê — acumulado geral (todos os meses)
  const porOwner = {};
  lancamentos.forEach((l) => {
    porOwner[l.owner] = (porOwner[l.owner] || 0) + l.valor;
  });

  const listaDevedores = document.getElementById("lista-devedores");
  const chaves = Object.keys(porOwner);
  if (chaves.length === 0) {
    listaDevedores.innerHTML = '<p class="vazio">Nenhum lançamento ainda.</p>';
  } else {
    listaDevedores.innerHTML = "";
    chaves
      .sort((a, b) => porOwner[b] - porOwner[a])
      .forEach((chave) => {
        const linha = document.createElement("div");
        linha.className = "linha-devedor";
        linha.innerHTML = `
          <span class="linha-devedor-nome">${escapeHtml(chave)}</span>
          <span class="linha-devedor-valor">${formatarMoeda(porOwner[chave])}</span>
        `;
        listaDevedores.appendChild(linha);
      });
  }

  const totalGeral = Object.values(porOwner).reduce((s, v) => s + v, 0);
  document.getElementById("total-geral-valor").textContent = formatarMoeda(totalGeral);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
