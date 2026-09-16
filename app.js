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
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, householdId, pessoas, categorias } from "./firebase-config.js";
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
let salariosPorMes = {}; // { "2026-09": { "Eu": 5000, "Parceiro(a)": 4500 }, ... }
let mesSelecionado = formatoAnoMes(new Date());
let categoriaFiltro = "todas";

function formatoAnoMes(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatarMoeda(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Quanto do limite de um cartão está "comprometido" num determinado mês:
 * soma de todas as parcelas (de qualquer compra, feita em qualquer mês)
 * cuja competência ainda não chegou/passou até esse mês — ou seja, ainda
 * não foram pagas. Assim que o mês da parcela passa (a fatura é paga),
 * ela para de contar e o limite "volta".
 */
function limiteUsadoNoMes(cartaoId, mes) {
  return lancamentos
    .filter((l) => l.pagamento === "credito" && l.cartaoId === cartaoId && l.competencia >= mes)
    .reduce((s, l) => s + l.valor, 0);
}

// ---------- AUTENTICAÇÃO ----------
const telaCarregando = document.getElementById("tela-carregando");
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
let unsubSalarios = null;

onAuthStateChanged(auth, (user) => {
  telaCarregando.hidden = true;
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
    if (unsubSalarios) unsubSalarios();
    cartoes = [];
    lancamentos = [];
    salariosPorMes = {};
  }
});

function iniciarListeners() {
  const refCartoes = query(collection(db, "households", householdId, "cards"), orderBy("nome"));
  unsubCartoes = onSnapshot(refCartoes, (snap) => {
    cartoes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarCartoes();
    preencherSelectCartoes();
    renderizarResumo();
    renderizarLancamentos();
  });

  const refLanc = query(collection(db, "households", householdId, "expenses"), orderBy("dataCompra", "desc"));
  unsubLancamentos = onSnapshot(refLanc, (snap) => {
    lancamentos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderizarLancamentos();
    renderizarResumo();
    renderizarPlanilha();
  });

  const refSalarios = collection(db, "households", householdId, "salarios");
  unsubSalarios = onSnapshot(refSalarios, (snap) => {
    salariosPorMes = {};
    snap.docs.forEach((d) => {
      salariosPorMes[d.id] = d.data().valores || {};
    });
    renderizarPlanilha();
  });
}

// ---------- NAVEGAÇÃO ENTRE TELAS ----------
const navItens = document.querySelectorAll(".nav-item");
const views = {
  resumo: document.getElementById("view-resumo"),
  planilha: document.getElementById("view-planilha"),
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
const inputCartaoLimite = document.getElementById("cartao-limite");
const btnSalvarCartao = document.getElementById("btn-salvar-cartao");
const btnCancelarEdicaoCartao = document.getElementById("btn-cancelar-edicao-cartao");
aplicarMascaraDinheiro(inputCartaoLimite);

let cartaoEditandoId = null;

function entrarModoEdicaoCartao(c) {
  cartaoEditandoId = c.id;
  document.getElementById("cartao-nome").value = c.nome;
  document.getElementById("cartao-virada").value = c.virada;
  document.getElementById("cartao-vencimento").value = c.vencimento;
  inputCartaoLimite.value = c.limite > 0 ? formatarMascaraDinheiro(String(Math.round(c.limite * 100))) : "";
  btnSalvarCartao.textContent = "Salvar alterações";
  btnCancelarEdicaoCartao.hidden = false;
  document.getElementById("cartao-nome").scrollIntoView({ behavior: "smooth", block: "center" });
}

function sairModoEdicaoCartao() {
  cartaoEditandoId = null;
  formCartao.reset();
  btnSalvarCartao.textContent = "Adicionar cartão";
  btnCancelarEdicaoCartao.hidden = true;
}

btnCancelarEdicaoCartao.addEventListener("click", sairModoEdicaoCartao);

formCartao.addEventListener("submit", async (e) => {
  e.preventDefault();
  cartaoErro.hidden = true;
  const nome = document.getElementById("cartao-nome").value.trim();
  const virada = parseInt(document.getElementById("cartao-virada").value, 10);
  const vencimento = parseInt(document.getElementById("cartao-vencimento").value, 10);
  const limiteValor = lerValorMascarado(inputCartaoLimite);
  const limite = isNaN(limiteValor) ? 0 : limiteValor;

  if (!nome || !virada || !vencimento) return;
  if (virada < 1 || virada > 31 || vencimento < 1 || vencimento > 31) {
    cartaoErro.textContent = "Os dias devem estar entre 1 e 31.";
    cartaoErro.hidden = false;
    return;
  }

  if (cartaoEditandoId) {
    await setDoc(
      doc(db, "households", householdId, "cards", cartaoEditandoId),
      { nome, virada, vencimento, limite },
      { merge: true }
    );
    sairModoEdicaoCartao();
  } else {
    await addDoc(collection(db, "households", householdId, "cards"), {
      nome,
      virada,
      vencimento,
      limite,
      criadoPorEmail: auth.currentUser.email,
    });
    formCartao.reset();
  }
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
        <div class="linha-cartao-datas">Vira dia ${c.virada} · vence dia ${c.vencimento}${c.limite ? ` · limite ${formatarMoeda(c.limite)}` : ""}</div>
      </div>
      <div class="linha-cartao-acoes">
        <button class="btn-excluir btn-editar" data-id="${c.id}">editar</button>
        <button class="btn-excluir" data-id="${c.id}">excluir</button>
      </div>
    `;
    linha.querySelector(".btn-editar").addEventListener("click", () => entrarModoEdicaoCartao(c));
    linha.querySelectorAll(".btn-excluir:not(.btn-editar)")[0].addEventListener("click", async () => {
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

const grupoCategoria = document.getElementById("grupo-categoria");
const inputCategoriaNome = document.getElementById("lanc-categoria-nome");

grupoCategoria.innerHTML =
  categorias
    .map(
      (nome, i) =>
        `<label class="radio-pill"><input type="radio" name="categoria" value="${escapeHtml(nome)}" ${i === 0 ? "checked" : ""} /> ${escapeHtml(nome)}</label>`
    )
    .join("") +
  `<label class="radio-pill"><input type="radio" name="categoria" value="outra" /> Outra</label>`;

grupoCategoria.addEventListener("change", () => {
  const tipo = grupoCategoria.querySelector("input:checked").value;
  inputCategoriaNome.hidden = tipo !== "outra";
  inputCategoriaNome.required = tipo === "outra";
});

// Filtro de categoria na lista de lançamentos do mês
const filtroCategoria = document.getElementById("filtro-categoria");
filtroCategoria.addEventListener("change", () => {
  categoriaFiltro = filtroCategoria.value;
  renderizarLancamentos();
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

// ---------- CAMPO DE VALOR COM MÁSCARA DE DINHEIRO ----------
// O usuário só digita números (ex: "2000000") e o campo formata
// sozinho como "R$ 20.000,00" — sem depender de digitar ponto/vírgula
// no lugar certo, o que é bem mais confiável (principalmente no celular).
function formatarMascaraDinheiro(valorAtual) {
  let digitos = valorAtual.replace(/\D/g, "");
  digitos = digitos.replace(/^0+(?=\d)/, ""); // tira zeros à esquerda
  if (digitos === "") return "";
  while (digitos.length < 3) digitos = "0" + digitos; // garante ao menos "0,00"
  const reaisStr = digitos.slice(0, -2);
  const centavosStr = digitos.slice(-2);
  const reaisFormatado = reaisStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${reaisFormatado},${centavosStr}`;
}

function aplicarMascaraDinheiro(inputEl) {
  inputEl.addEventListener("input", () => {
    inputEl.value = formatarMascaraDinheiro(inputEl.value);
  });
}

/**
 * Lê o valor numérico (em reais) de um campo com a máscara acima.
 * Retorna NaN se estiver vazio.
 */
function lerValorMascarado(inputEl) {
  const digitos = inputEl.value.replace(/\D/g, "");
  if (digitos === "") return NaN;
  return parseInt(digitos, 10) / 100;
}

const inputValor = document.getElementById("lanc-valor");
aplicarMascaraDinheiro(inputValor);

const formLancamento = document.getElementById("form-lancamento");
const lancErro = document.getElementById("lanc-erro");

formLancamento.addEventListener("submit", async (e) => {
  e.preventDefault();
  lancErro.hidden = true;

  const descricao = document.getElementById("lanc-descricao").value.trim();
  const valorTotal = lerValorMascarado(document.getElementById("lanc-valor"));
  const dataCompra = document.getElementById("lanc-data").value;
  const tipoOwner = grupoOwner.querySelector("input:checked").value;
  const owner = tipoOwner === "outro" ? inputOwnerNome.value.trim() : tipoOwner;
  const tipoCategoria = grupoCategoria.querySelector("input:checked").value;
  const categoria = tipoCategoria === "outra" ? inputCategoriaNome.value.trim() : tipoCategoria;
  const pagamento = grupoPagamento.querySelector("input:checked").value;

  if (!descricao || !dataCompra) return;
  if (!valorTotal || isNaN(valorTotal) || valorTotal <= 0) {
    lancErro.textContent = "Digite um valor válido.";
    lancErro.hidden = false;
    return;
  }
  if (tipoCategoria === "outra" && !categoria) {
    lancErro.textContent = "Informe o nome da categoria.";
    lancErro.hidden = false;
    return;
  }
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
      categoria,
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
        categoria,
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
  inputCategoriaNome.hidden = true;
  document.getElementById("preview-parcelas").textContent = "";
});

function renderizarLancamentos() {
  const doMes = lancamentos.filter((l) => l.competencia === mesSelecionado);

  // Resumo por categoria (sempre com TODOS os lançamentos do mês, sem aplicar o filtro)
  const porCategoria = {};
  doMes.forEach((l) => {
    const cat = l.categoria || "Outros";
    porCategoria[cat] = (porCategoria[cat] || 0) + l.valor;
  });
  const resumoCategorias = document.getElementById("resumo-categorias");
  const categoriasDoMes = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]);
  resumoCategorias.innerHTML = categoriasDoMes
    .map(
      (cat) => `
        <div class="tag-categoria">
          <span class="tag-categoria-nome">${escapeHtml(cat)}</span>
          <span class="tag-categoria-valor">${formatarMoeda(porCategoria[cat])}</span>
        </div>`
    )
    .join("");

  // Popula o filtro com as categorias que existem neste mês, preservando a seleção atual se possível
  const filtroCategoria = document.getElementById("filtro-categoria");
  const selecaoAtual = categoriaFiltro;
  filtroCategoria.innerHTML =
    `<option value="todas">Todas</option>` +
    categoriasDoMes.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
  filtroCategoria.value = categoriasDoMes.includes(selecaoAtual) ? selecaoAtual : "todas";
  categoriaFiltro = filtroCategoria.value;

  // Lista filtrada
  const lista = document.getElementById("lista-lancamentos");
  const filtrados =
    categoriaFiltro === "todas" ? doMes : doMes.filter((l) => (l.categoria || "Outros") === categoriaFiltro);

  if (filtrados.length === 0) {
    lista.innerHTML = '<p class="vazio">Nenhum lançamento neste mês.</p>';
    return;
  }
  lista.innerHTML = "";
  filtrados.forEach((l) => {
    const cartao = cartoes.find((c) => c.id === l.cartaoId);
    const meta = [];
    meta.push(new Date(l.dataCompra + "T12:00:00").toLocaleDateString("pt-BR"));
    meta.push(l.categoria || "Outros");
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
document.getElementById("mes-anterior").addEventListener("click", () => irParaMes(-1));
document.getElementById("mes-proximo").addEventListener("click", () => irParaMes(1));
document.getElementById("mes-anterior-planilha").addEventListener("click", () => irParaMes(-1));
document.getElementById("mes-proximo-planilha").addEventListener("click", () => irParaMes(1));

const inputMesResumo = document.getElementById("mes-input-resumo");
const inputMesPlanilha = document.getElementById("mes-input-planilha");
inputMesResumo.value = mesSelecionado;
inputMesPlanilha.value = mesSelecionado;
inputMesResumo.addEventListener("change", (e) => {
  if (e.target.value) definirMes(e.target.value);
});
inputMesPlanilha.addEventListener("change", (e) => {
  if (e.target.value) definirMes(e.target.value);
});

function irParaMes(delta) {
  definirMes(deslocarMes(mesSelecionado, delta));
}

function definirMes(novoMes) {
  mesSelecionado = novoMes;
  inputMesResumo.value = mesSelecionado;
  inputMesPlanilha.value = mesSelecionado;
  renderizarResumo();
  renderizarLancamentos();
  renderizarPlanilha();
}

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

      let limiteHtml = "";
      if (c.limite > 0) {
        const usado = limiteUsadoNoMes(c.id, mesSelecionado);
        const disponivel = c.limite - usado;
        const pct = Math.max(0, Math.min(100, (usado / c.limite) * 100));
        limiteHtml = `
          <div class="linha-fatura-limite">
            <span>Limite usado: ${formatarMoeda(usado)} de ${formatarMoeda(c.limite)}</span>
            <span class="${disponivel >= 0 ? "saldo-positivo" : "saldo-negativo"}">${formatarMoeda(disponivel)} disponível</span>
          </div>
          <div class="barra-limite"><div class="barra-limite-preenchida" style="width:${pct}%"></div></div>
        `;
      }

      linha.innerHTML = `
        <div class="linha-fatura-topo">
          <span class="linha-fatura-nome">${escapeHtml(c.nome)}</span>
          <span class="linha-fatura-valor">${formatarMoeda(totalCartao)}</span>
        </div>
        ${limiteHtml}
      `;
      listaFaturas.appendChild(linha);
    });
  }

  // Quem deve o quê — só "outras pessoas" (terceiros/convidados), acumulado
  // desde sempre, porque essa dívida não tem "mês" — some quando a pessoa
  // paga de volta. Rosi/Julio (o casal) ficam de fora daqui: o saldo deles
  // mês a mês já é tratado na tela Planilha, contra o salário.
  const porOwner = {};
  lancamentos
    .filter((l) => !pessoas.includes(l.owner))
    .forEach((l) => {
      porOwner[l.owner] = (porOwner[l.owner] || 0) + l.valor;
    });

  const listaDevedores = document.getElementById("lista-devedores");
  const chaves = Object.keys(porOwner);
  if (chaves.length === 0) {
    listaDevedores.innerHTML = '<p class="vazio">Nenhuma compra de outra pessoa registrada.</p>';
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

// ---------- PLANILHA (colunas por pessoa: gasto x salário) ----------
function renderizarPlanilha() {
  document.getElementById("mes-atual-label-planilha").textContent = nomeMesCompetencia(mesSelecionado);

  const valoresSalario = salariosPorMes[mesSelecionado] || {};
  const doMes = lancamentos.filter((l) => l.competencia === mesSelecionado);

  const container = document.getElementById("colunas-planilha");
  container.innerHTML = "";
  let saldoGeral = 0;

  pessoas.forEach((pessoa) => {
    const gastosPessoa = doMes.filter((l) => l.owner === pessoa);
    const totalGasto = gastosPessoa.reduce((s, l) => s + l.valor, 0);
    const salario = valoresSalario[pessoa] || 0;
    const saldo = salario - totalGasto;
    saldoGeral += saldo;

    const valorInicial =
      salario > 0 ? formatarMascaraDinheiro(String(Math.round(salario * 100))) : "";

    const linhasHtml =
      gastosPessoa.length === 0
        ? '<p class="vazio">Nenhum gasto neste mês.</p>'
        : gastosPessoa
            .map(
              (l) => `
          <div class="coluna-pessoa-linha">
            <span class="coluna-pessoa-linha-desc">${escapeHtml(l.descricao)}</span>
            <span class="coluna-pessoa-linha-valor">${formatarMoeda(l.valor)}</span>
          </div>`
            )
            .join("");

    const coluna = document.createElement("div");
    coluna.className = "coluna-pessoa";
    coluna.innerHTML = `
      <h3 class="coluna-pessoa-nome">${escapeHtml(pessoa)}</h3>
      <label>
        Salário do mês
        <input type="text" class="input-salario" inputmode="numeric" placeholder="R$ 0,00" value="${valorInicial}" />
      </label>
      <div class="coluna-pessoa-lista">${linhasHtml}</div>
      <div class="coluna-pessoa-subtotal">
        <span>Total gasto</span>
        <span>${formatarMoeda(totalGasto)}</span>
      </div>
      <div class="coluna-pessoa-saldo">
        <span>Saldo</span>
        <strong class="${saldo >= 0 ? "saldo-positivo" : "saldo-negativo"}">${formatarMoeda(saldo)}</strong>
      </div>
    `;

    const inputSalario = coluna.querySelector(".input-salario");
    aplicarMascaraDinheiro(inputSalario);
    inputSalario.addEventListener("change", async () => {
      const novoValor = lerValorMascarado(inputSalario);
      const valorFinal = isNaN(novoValor) ? 0 : novoValor;
      const atualizados = { ...(salariosPorMes[mesSelecionado] || {}), [pessoa]: valorFinal };
      await setDoc(
        doc(db, "households", householdId, "salarios", mesSelecionado),
        { valores: atualizados },
        { merge: true }
      );
    });

    container.appendChild(coluna);
  });

  // Pessoas "extras": quem apareceu em "Outra pessoa" nos lançamentos deste
  // mês, mas não está na lista fixa de pessoas do casal. Ganham uma coluna
  // simples (só os gastos, sem salário/saldo) — e só aparecem se tiverem
  // algum lançamento no mês.
  const nomesExtras = [...new Set(doMes.map((l) => l.owner).filter((o) => !pessoas.includes(o)))];

  nomesExtras.forEach((nome) => {
    const gastosPessoa = doMes.filter((l) => l.owner === nome);
    const totalGasto = gastosPessoa.reduce((s, l) => s + l.valor, 0);

    const linhasHtml = gastosPessoa
      .map(
        (l) => `
          <div class="coluna-pessoa-linha">
            <span class="coluna-pessoa-linha-desc">${escapeHtml(l.descricao)}</span>
            <span class="coluna-pessoa-linha-valor">${formatarMoeda(l.valor)}</span>
          </div>`
      )
      .join("");

    const coluna = document.createElement("div");
    coluna.className = "coluna-pessoa coluna-pessoa--extra";
    coluna.innerHTML = `
      <h3 class="coluna-pessoa-nome">${escapeHtml(nome)}</h3>
      <p class="coluna-pessoa-extra-tag">Outra pessoa</p>
      <div class="coluna-pessoa-lista">${linhasHtml}</div>
      <div class="coluna-pessoa-subtotal">
        <span>Total gasto</span>
        <span>${formatarMoeda(totalGasto)}</span>
      </div>
    `;
    container.appendChild(coluna);
  });

  const saldoGeralEl = document.getElementById("saldo-geral-planilha");
  saldoGeralEl.textContent = formatarMoeda(saldoGeral);
  saldoGeralEl.className = saldoGeral >= 0 ? "saldo-positivo" : "saldo-negativo";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
