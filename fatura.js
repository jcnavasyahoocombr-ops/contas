// Lógica de datas: para que mês (competência) uma compra no crédito deve ser
// lançada, dado o dia de virada (fechamento) e o dia de vencimento do cartão.

/**
 * Soma "n" meses a um par {ano, mes} (mes é 0-indexado, como em Date).
 */
function addMonths(ano, mes, n) {
  const d = new Date(ano, mes + n, 1);
  return { ano: d.getFullYear(), mes: d.getMonth() };
}

/**
 * Dado o dia da compra e o dia de virada (fechamento) do cartão,
 * retorna a qual ciclo de fatura a compra pertence: {ano, mes} do
 * MÊS DE FECHAMENTO daquele ciclo.
 *
 * Regra: se a compra acontece NO dia de virada ou depois, ela entra
 * na fatura que fecha no mês seguinte. Se acontece antes do dia de
 * virada, entra na fatura que fecha no mês corrente.
 */
function cicloDeFechamento(dataCompra, diaVirada) {
  const diaCompra = dataCompra.getDate();
  let ano = dataCompra.getFullYear();
  let mes = dataCompra.getMonth();

  if (diaCompra >= diaVirada) {
    const prox = addMonths(ano, mes, 1);
    ano = prox.ano;
    mes = prox.mes;
  }
  return { ano, mes };
}

/**
 * A partir do ciclo de fechamento, calcula o mês de VENCIMENTO
 * (mês de competência que aparece no resumo — é quando a fatura
 * efetivamente vence e você paga).
 */
function mesDeVencimento(cicloFechamento, diaVirada, diaVencimento) {
  let { ano, mes } = cicloFechamento;
  // Se o vencimento cai num dia numérico menor que o de virada,
  // é porque o vencimento acontece no mês seguinte ao fechamento
  // (ex: fecha dia 28, vence dia 5 -> vence no mês seguinte).
  if (diaVencimento < diaVirada) {
    const prox = addMonths(ano, mes, 1);
    ano = prox.ano;
    mes = prox.mes;
  }
  return { ano, mes };
}

/**
 * Formata {ano, mes} (mes 0-indexado) como "YYYY-MM".
 */
export function formatCompetencia(anoMes) {
  const mesStr = String(anoMes.mes + 1).padStart(2, "0");
  return `${anoMes.ano}-${mesStr}`;
}

/**
 * Função principal: dado a data da compra e os dados do cartão,
 * retorna a string de competência "YYYY-MM" em que a 1ª parcela
 * (ou a compra à vista no crédito) deve cair.
 */
export function competenciaDaCompra(dataCompraISO, diaVirada, diaVencimento) {
  const dataCompra = new Date(dataCompraISO + "T12:00:00");
  const ciclo = cicloDeFechamento(dataCompra, diaVirada);
  const venc = mesDeVencimento(ciclo, diaVirada, diaVencimento);
  return formatCompetencia(venc);
}

/**
 * Gera a lista de competências ("YYYY-MM") para uma compra parcelada,
 * a partir da competência da 1ª parcela.
 */
export function gerarCompetenciasParceladas(primeiraCompetencia, totalParcelas) {
  const [anoStr, mesStr] = primeiraCompetencia.split("-");
  const anoBase = parseInt(anoStr, 10);
  const mesBase = parseInt(mesStr, 10) - 1;

  const lista = [];
  for (let i = 0; i < totalParcelas; i++) {
    const { ano, mes } = addMonths(anoBase, mesBase, i);
    lista.push(formatCompetencia({ ano, mes }));
  }
  return lista;
}

/**
 * Nome do mês por extenso em pt-BR a partir de "YYYY-MM".
 */
export function nomeMesCompetencia(competencia) {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(ano, mes - 1, 1);
  const nome = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}
