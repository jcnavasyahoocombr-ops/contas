# Livro de Contas

Site pessoal de controle de gastos: cadastro de cartões (com dia de virada e
vencimento), lançamentos em débito ou crédito (com parcelamento automático
jogando cada parcela no mês certo), e resumo de quem deve o quê.

Funciona 100% no navegador (HTML/CSS/JS puro) e usa o **Firebase** como
"servidor": Authentication para o login e Firestore como banco de dados.
Não precisa rodar nada em Node nem ter um backend seu — o Firebase faz esse
papel.

## Passo 1 — Criar o projeto no Firebase (grátis)

1. Acesse https://console.firebase.google.com/ e clique em **"Adicionar projeto"**.
2. Dê um nome (ex: `livro-de-contas`) e siga o assistente (pode desativar o Google Analytics, não é necessário).
3. Dentro do projeto, clique no ícone **</>** ("Web") para registrar um app da Web.
4. Dê um apelido (ex: `site`) e clique em "Registrar app". **Não** marque a opção de Firebase Hosting.
5. O Firebase vai mostrar um bloco `firebaseConfig = { ... }`. Copie esses valores para o arquivo `firebase-config.js` deste projeto, substituindo os textos `COLE_AQUI...`.

## Passo 2 — Ativar o login por e-mail/senha

1. No menu lateral do console, vá em **Build > Authentication**.
2. Clique em "Get started" (ou "Vamos lá").
3. Na aba **Sign-in method**, clique em **E-mail/senha**, ative e salve.

## Passo 3 — Criar o banco de dados (Firestore)

1. No menu lateral, vá em **Build > Firestore Database**.
2. Clique em "Criar banco de dados".
3. Escolha uma localização (ex: `southamerica-east1` — São Paulo) e comece em **modo de produção**.
4. Ainda não cole as regras agora — primeiro os dois precisam criar a própria
   conta (próximo passo), porque as regras precisam do UID de cada um.

## Passo 3.5 — Configuração para uso em casal

Este site já vem pronto para dois logins separados acessando os **mesmos
dados** (o "espaço da casa"). Para configurar:

1. Rode o site localmente (veja Passo 4 abaixo) e, na tela de login, cada
   pessoa clica em **"Criar conta"** com o próprio e-mail e senha — uma de
   cada vez.
2. No Firebase Console, vá em **Authentication > Users**. Você vai ver as
   duas contas criadas, cada uma com um **UID** (uma sequência de letras e
   números). Copie o UID de cada pessoa.
3. Abra o arquivo `firestore.rules` deste projeto e substitua
   `COLE_AQUI_O_UID_DA_PESSOA_1` e `COLE_AQUI_O_UID_DA_PESSOA_2` pelos UIDs
   copiados.
4. No console do Firebase, vá em **Firestore Database > Regras**, cole o
   conteúdo atualizado do `firestore.rules` e clique em "Publicar".
5. (Opcional, mas recomendado) Em **Authentication > Settings > User
   actions**, desative "Enable create (sign-up)" para que mais ninguém
   consiga criar uma terceira conta pela tela de login.

A partir daí, os dois logins enxergam e editam os mesmos cartões e
lançamentos — e a regra do Firestore garante que só vocês dois (pelos UIDs)
conseguem ler ou escrever ali, mesmo que o link do site seja público.

Se um dia quiserem trocar os nomes usados no formulário ("de quem é essa
conta"), edite a lista `pessoas` em `firebase-config.js`.

## Passo 4 — Testar localmente antes de publicar

Como os arquivos usam `type="module"`, alguns navegadores bloqueiam abrir o
`index.html` direto por `file://`. O jeito mais simples é rodar um servidor
local:

```bash
# dentro da pasta do projeto
python3 -m http.server 8000
```

Depois abra `http://localhost:8000` no navegador, crie sua conta (botão
"Criar conta") com seu e-mail e uma senha, e teste.

## Passo 5 — Subir para o GitHub e publicar com GitHub Pages

1. Crie um repositório novo no GitHub (pode deixar **privado** — isso protege
   só o código-fonte; quem protege os *dados* é a regra do Firestore do Passo 3).
2. Suba todos os arquivos desta pasta para o repositório.
3. No repositório, vá em **Settings > Pages**.
   - Se o repositório for privado, publicar Pages a partir dele exige uma
     conta GitHub Pro (pequena mensalidade). Se preferir não pagar nada,
     deixe o repositório **público** — o código-fonte fica visível, mas os
     dados continuam protegidos pelo login do Firebase.
4. Em "Branch", selecione `main` (ou a branch que você usou) e a pasta `/ (root)`. Salve.
5. Em alguns minutos o GitHub mostra o link do site (algo como
   `https://seuusuario.github.io/nome-do-repositorio/`).

## Passo 6 — Conferir o acesso restrito

Se você já fez o Passo 3.5 (configuração para casal), o acesso já está
restrito aos dois UIDs cadastrados na regra do Firestore — mesmo que alguém
consiga criar uma terceira conta, essa conta não vai conseguir ler nem
escrever nada, porque o UID dela não está na lista de `ehDoCasal()`. O
"Enable create (sign-up)" do Passo 3.5 é só uma camada extra pra deixar a
tela de login mais limpa, não é o que protege os dados.

## Estrutura dos arquivos

```
index.html          — estrutura da página (login + app)
style.css            — visual (tema "livro-razão")
app.js                — lógica: login, Firestore, telas
fatura.js             — cálculo de em qual mês cada parcela de crédito cai
firebase-config.js    — suas credenciais do Firebase (preencher)
firestore.rules       — regra de segurança do banco de dados
```

## Como funciona o cálculo da fatura

Você cadastra, por cartão, o **dia de virada** (fechamento) e o **dia de
vencimento**. Quando lança uma compra no crédito:

- Se a compra foi **antes** do dia de virada, ela entra na fatura que fecha
  naquele mesmo mês.
- Se foi **no dia de virada ou depois**, entra na fatura do mês seguinte.
- O mês que aparece no Resumo é o mês de **vencimento** dessa fatura (quando
  ela efetivamente vence).
- Se a compra for parcelada, cada parcela cai automaticamente no mês
  seguinte à anterior.

Lançamentos no **débito** não passam por essa lógica — ficam registrados no
mês da própria data da compra.
