// Construye "GESTIÓN <año>" con las 4 hojas de siempre de la planilla de la casa, mejoradas por
// dentro, más una hoja CONFIG oculta:
//   PRESUPUESTO MENSUAL  su tabla (mensual y anual) + debajo, la misma tabla con lo gastado de verdad
//   GASTOS DIARIOS       categorías en columnas, una fila por gasto, un bloque plegable por mes
//   REPORTE DE EGRESOS   un bloque por mes con una fila por día: ingresos (a mano o desde la app) y
//                        egresos que se llenan solos desde GASTOS DIARIOS
//   SALDOS               cuentas en filas, una columna por revisión, con TC oficial y paralelo
//   CONFIG (oculta)      líneas, reglas, cuentas y registro de la app
// Los totales usan SUMIFS por fecha o por línea: no se rompen al agregar filas.
// Fórmulas en configuración es_BO (separador ";"). El catálogo y los datos llegan por parámetro
// desde privado/ (el repo es público).

const MESES_ = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const H_ = { resumen: "RESUMEN", presupuesto: "PRESUPUESTO MENSUAL", gastos: "GASTOS DIARIOS", reporte: "REPORTE DE EGRESOS",
  saldos: "SALDOS", config: "CONFIG" };

// Colores de la planilla de siempre
const C_ = {
  titulo: "#e26b0a", amarillo: "#ffff66", totalFondo: "#fce4d6", totalTexto: "#1f4e9a",
  borde: "#a6a6a6", encabezado: "#f2f2f2", mes: "#fff2cc", texto: "#000000", gris: "#7f7f7f",
  rojoFondo: "#f4cccc", rojoTexto: "#990000", verdeFondo: "#d9ead3",
  cat: {
    "SERVICIOS BÁSICOS": "#fff2cc", "MOVILIDAD": "#fde9d9", "ALIMENTACIÓN": "#ddebf7", "VARIOS": "#e2efda",
    "CHICOS": "#fce4ec", "CONSULTORIO": "#f3e1fa", "EDUCACIÓN": "#fff9e6", "IMPUESTOS": "#e7eef7",
    "COMPRAS GRANDES": "#eceff1", "OTROS": "#f3f3f3",
  },
  col: { COMIDA: "#ddebf7", TRANSPORTE: "#fde9d9", "COMPRAS VARIOS": "#e2efda", "SERVICIOS BÁSICOS": "#fff2cc" },
};
const F_BS = '"Bs"#,##0.00;"-Bs"#,##0.00;""';
const F_USD = '"$us "#,##0.00;"-$us "#,##0.00;""';
const F_NUM = '#,##0.00;-#,##0.00;""';
const F_FECHA = "dd/mm/yyyy";
const COLS_GASTO_ = ["COMIDA", "TRANSPORTE", "COMPRAS VARIOS", "SERVICIOS BÁSICOS"];

const planillaOps_ = {};
const AVISOS_ = [];

// params: {anio, titulo, catalogo: {grupos:[[grupo, [[línea, columnaGastos, tabla]]]], ingresos:[[línea, diezmo]]},
//          cuentas: [[cuenta, etiqueta SALDOS, dueño, moneda, medio, tc (Oficial/Paralelo), por defecto]]}
planillaOps_.construir = function (ss, params) {
  if (!params.catalogo || !params.anio || !params.cuentas) throw new Error("Faltan anio, catalogo o cuentas");
  const tmp = ss.getSheetByName("_tmp") || ss.insertSheet("_tmp");
  ss.getSheets().forEach(sh => { if (sh.getName() !== "_tmp") borrarHoja_(ss, sh); });
  [H_.resumen, H_.presupuesto, H_.gastos, H_.reporte, H_.saldos, H_.config].forEach((n, i) => ss.insertSheet(n, i));
  ss.deleteSheet(tmp);
  ss.setSpreadsheetLocale("es_BO");
  ss.setSpreadsheetTimeZone("America/La_Paz");
  ss.rename(params.titulo || ("FINANCIAL TRICKS - GESTIÓN " + params.anio));
  const anio = params.anio;
  hojaConfig_(ss, params);
  hojaGastos_(ss, anio);
  hojaReporte_(ss, anio, params.saldo_inicial_efectivo || 0);
  hojaSaldos_(ss, params.cuentas);
  const filasPres = hojaPresupuesto_(ss, anio, params.catalogo);
  hojaResumen_(ss, anio, params.catalogo, filasPres);
  [H_.resumen, H_.presupuesto, H_.gastos, H_.reporte, H_.saldos].forEach(n => ss.getSheetByName(n).setHiddenGridlines(true));
  ss.getSheetByName(H_.config).hideSheet();
  ss.setActiveSheet(ss.getSheetByName(H_.resumen));
  return { success: true, hojas: ss.getSheets().map(s => s.getName()), avisos: AVISOS_ };
};

// ===== utilidades =====

// Google a veces falla al borrar hojas grandes o con grupos de filas: reintentar y, si no, apartarla
function borrarHoja_(ss, sh) {
  for (let i = 0; i < 4; i++) {
    try { ss.deleteSheet(sh); return; } catch (e) { SpreadsheetApp.flush(); Utilities.sleep(1500 * (i + 1)); }
  }
  sh.setName("_borrar_" + Date.now()); sh.hideSheet();
  AVISOS_.push("No se pudo borrar una hoja vieja: quedó oculta como " + sh.getName());
}

function fecha_(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);
}

function ultimaFila_(sh) {
  const a1 = sh.getRange("A1");
  if (a1.isBlank()) return 0;
  if (sh.getRange("A2").isBlank()) return 1;
  return a1.getNextDataCell(SpreadsheetApp.Direction.DOWN).getRow();
}

function bordes_(r) {
  r.setBorder(true, true, true, true, true, true, C_.borde, SpreadsheetApp.BorderStyle.SOLID);
  return r;
}

function base_(sh, filas, cols) {
  if (sh.getMaxRows() < filas) sh.insertRowsAfter(sh.getMaxRows(), filas - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setFontFamily("Arial").setFontSize(10)
    .setVerticalAlignment("middle");
}

function tituloHoja_(sh, fila, col, ancho, texto) {
  sh.getRange(fila, col, 1, ancho).merge().setValue(texto).setFontSize(14).setFontWeight("bold")
    .setFontColor(C_.titulo).setHorizontalAlignment("center").setBackground(C_.encabezado);
  sh.setRowHeight(fila, 34);
}

function congelar_(sh, filas, cols) {
  try { if (filas !== null) sh.setFrozenRows(filas); } catch (e) { AVISOS_.push(sh.getName() + " filas: " + e.message); }
  try { if (cols !== null) sh.setFrozenColumns(cols); } catch (e) { AVISOS_.push(sh.getName() + " columnas: " + e.message); }
}

function dias_(anio, m) { return new Date(anio, m, 0).getDate(); }

function columnaLetra_(c) {
  let s = "";
  while (c > 0) { const r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

function estiloTotal_(r) {
  r.setFontWeight("bold").setFontColor(C_.totalTexto).setBackground(C_.totalFondo);
  bordes_(r);
}

// ===== CONFIG (oculta) =====

function hojaConfig_(ss, p) {
  const sh = ss.getSheetByName(H_.config);
  base_(sh, 1500, 40);
  const lineas = [];
  p.catalogo.grupos.forEach(([g, ls]) => ls.forEach(([l, col, tabla]) => lineas.push([g, l, col, tabla || "Mensual", "Gasto", ""])));
  p.catalogo.ingresos.forEach(([l, dz]) => lineas.push(["INGRESOS", l, "", "", "Ingreso", dz]));
  sh.getRange(1, 1, 1, 6).setValues([["GRUPO", "LÍNEA", "COLUMNA EN GASTOS DIARIOS", "TABLA", "TIPO", "¿DIEZMO?"]]);
  sh.getRange(2, 1, lineas.length, 6).setValues(lineas);
  sh.getRange(1, 8, 1, 3).setValues([["SI EL DETALLE DICE", "VA A LA LÍNEA", "AGREGADA POR"]]);
  sh.getRange(1, 12, 1, 7).setValues([["CUENTA", "FILA EN SALDOS", "DUEÑO", "MONEDA", "MEDIO", "TIPO DE CAMBIO", "POR DEFECTO PARA"]]);
  sh.getRange(2, 12, p.cuentas.length, 7).setValues(p.cuentas);
  sh.getRange(1, 20, 1, 4).setValues([["ID APP", "OPERACIÓN", "HOJA Y FILA", "FECHA"]]);
  sh.getRange(1, 25, 1, 1).setValues([["AUTOR"]]);
  sh.getRange(2, 25, 2, 1).setValues([["EVER"], ["MA. NELFI"]]);
  sh.getRange("1:1").setFontWeight("bold").setBackground(C_.encabezado);
  congelar_(sh, 1, null);
}

// ===== GASTOS DIARIOS =====
// Columnas: B fecha, C autor, D:K montos (4 categorías × tarjeta/efectivo), L glosa, M total (fórmula),
// N línea, O cuenta, P id (oculta). Por mes: fila título, filas de gastos (grupo plegable, con una
// fila vacía al final para escribir a mano), fila TOTAL.

function hojaGastos_(ss, anio) {
  const sh = ss.getSheetByName(H_.gastos);
  base_(sh, 12 * 4 + 10, 16);
  tituloHoja_(sh, 2, 2, 14, "REGISTRO DE GASTOS DIARIOS - GESTIÓN " + anio);
  sh.getRange("B3:B4").merge().setValue("FECHA");
  sh.getRange("C3:C4").merge().setValue("AUTOR");
  COLS_GASTO_.forEach((c, i) => {
    const col = 4 + i * 2;
    sh.getRange(3, col, 1, 2).merge().setValue(c).setBackground(C_.col[c]);
    sh.getRange(4, col, 1, 2).setValues([["TARJETA / QR", "EFECTIVO"]]).setBackground(C_.col[c]);
  });
  sh.getRange("L3:L4").merge().setValue("GLOSA");
  sh.getRange("M3:M4").merge().setValue("TOTAL");
  sh.getRange("N3:N4").merge().setValue("LÍNEA DEL PRESUPUESTO");
  sh.getRange("O3:O4").merge().setValue("CUENTA");
  sh.getRange("P3:P4").merge().setValue("ID");
  const enc = sh.getRange("B3:P4");
  enc.setFontWeight("bold").setHorizontalAlignment("center").setWrap(true);
  sh.getRange("B3:C4").setBackground(C_.encabezado); sh.getRange("L3:P4").setBackground(C_.encabezado);
  bordes_(enc);
  // Total de la gestión (fila 5)
  sh.getRange("B5:C5").merge().setValue("TOTAL GESTIÓN " + anio);
  for (let c = 4; c <= 11; c++) {
    const L = columnaLetra_(c);
    sh.getRange(5, c).setFormula(`=SUMIFS(${L}$6:${L};$B$6:$B;">="&DATE(${anio};1;1);$B$6:$B;"<="&DATE(${anio};12;31))`);
  }
  estiloTotal_(sh.getRange("B5:O5"));
  let fila = 6;
  const grupos = [];
  for (let m = 1; m <= 12; m++) {
    // "AGOSTO 2026" solo lo convierte Google en la fecha 1/8/2026: por eso "GASTOS DE AGOSTO 2026"
    sh.getRange(fila, 2, 1, 14).merge().setValue("GASTOS DE " + MESES_[m - 1] + " " + anio).setFontWeight("bold")
      .setBackground(C_.amarillo).setHorizontalAlignment("left");
    const vacia = fila + 1;
    formatoFilaGasto_(sh, vacia);
    const total = fila + 2;
    sh.getRange(total, 2, 1, 2).merge().setValue("TOTAL " + MESES_[m - 1]);
    for (let c = 4; c <= 11; c++) {
      const L = columnaLetra_(c);
      sh.getRange(total, c).setFormula(
        `=SUMIFS(${L}$6:${L};$B$6:$B;">="&DATE(${anio};${m};1);$B$6:$B;"<="&EOMONTH(DATE(${anio};${m};1);0))`);
    }
    estiloTotal_(sh.getRange(total, 2, 1, 14));
    grupos.push(vacia);
    fila = total + 1;
  }
  // Total por fila (M): una sola fórmula para filas de gastos y de totales, también las agregadas a mano
  sh.getRange("M5").setFormula('=ARRAYFORMULA(IF(ISNUMBER(B5:B)+REGEXMATCH(B5:B&"";"^TOTAL");MMULT(IF(ISNUMBER(D5:K);D5:K;0);SEQUENCE(8;1;1;0));))');
  sh.getRange("D5:M").setNumberFormat(F_NUM);
  sh.getRange("B6:B").setNumberFormat(F_FECHA);
  [[1, 16], [2, 92], [3, 88], [12, 230], [13, 100], [14, 170], [15, 170], [16, 90]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  for (let c = 4; c <= 11; c++) sh.setColumnWidth(c, 88);
  congelar_(sh, 5, 0);
  sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  grupos.forEach(r => sh.getRange(r, 1, 1, 1).shiftRowGroupDepth(1));
  sh.hideColumns(16);
  sh.setTabColor(C_.titulo);
}

// Formato, listas y bordes de una fila de gasto (también al insertar desde la app)
function formatoFilaGasto_(sh, fila) {
  sh.getRange(fila, 2, 1, 15).setBackground(null).setFontWeight("normal").setFontColor(C_.texto);
  bordes_(sh.getRange(fila, 2, 1, 14));
  sh.getRange(fila, 2).setNumberFormat(F_FECHA);
  sh.getRange(fila, 4, 1, 10).setNumberFormat(F_NUM);
  const cfg = sh.getParent().getSheetByName(H_.config);
  const dv = (rango) => SpreadsheetApp.newDataValidation().requireValueInRange(rango, true).setAllowInvalid(true).build();
  sh.getRange(fila, 3).setDataValidation(dv(cfg.getRange("Y2:Y10")));
  sh.getRange(fila, 14).setDataValidation(dv(cfg.getRange("B2:B200")));
  sh.getRange(fila, 15).setDataValidation(dv(cfg.getRange("L2:L40")));
}

// ===== REPORTE DE EGRESOS =====
// Por mes: título, encabezado, una fila por día, TOTAL. B fecha, C concepto de ingresos,
// D:E ingresos (efectivo, banco), F:G egresos (automáticos desde GASTOS DIARIOS), H saldo de efectivo,
// I cuenta del ingreso, J ids (oculta).

function hojaReporte_(ss, anio, saldoInicial) {
  const sh = ss.getSheetByName(H_.reporte);
  base_(sh, 12 * 36 + 10, 10);
  tituloHoja_(sh, 2, 2, 8, "REPORTE DE INGRESOS Y EGRESOS - GESTIÓN " + anio);

  let fila = 5;
  const G = `'${H_.gastos}'`;
  const grupos = [];
  const dvC = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName(H_.config).getRange("L2:L40"), true).setAllowInvalid(true).build();
  for (let m = 1; m <= 12; m++) {
    sh.getRange(fila, 2, 1, 8).merge().setValue("REPORTE DE " + MESES_[m - 1] + " " + anio).setFontWeight("bold")
      .setBackground(C_.amarillo);
    const e1 = fila + 1;
    sh.getRange(e1, 2, 2, 1).merge().setValue("FECHA");
    sh.getRange(e1, 3, 2, 1).merge().setValue("CONCEPTO DEL INGRESO");
    sh.getRange(e1, 4, 1, 2).merge().setValue("INGRESOS");
    sh.getRange(e1, 6, 1, 2).merge().setValue("EGRESOS");
    sh.getRange(e1, 8, 2, 1).merge().setValue("RESULTADO DEL DÍA");
    sh.getRange(e1, 9, 2, 1).merge().setValue("CUENTA DEL INGRESO");
    sh.getRange(e1 + 1, 4, 1, 4).setValues([["EFECTIVO", "BANCO", "EFECTIVO", "BANCO"]]);
    const enc = sh.getRange(e1, 2, 2, 8);
    enc.setFontWeight("bold").setHorizontalAlignment("center").setBackground(C_.encabezado).setWrap(true);
    sh.getRange(e1, 4, 2, 2).setBackground(C_.verdeFondo);
    sh.getRange(e1, 6, 2, 2).setBackground(C_.rojoFondo);
    bordes_(enc);
    const d0 = e1 + 2, n = dias_(anio, m);
    const fechas = [], formulas = [];
    for (let d = 1; d <= n; d++) {
      const r = d0 + d - 1;
      fechas.push([new Date(anio, m - 1, d)]);
      const ef = ["E", "G", "I", "K"].map(L => `SUMIFS(${G}!${L}:${L};${G}!B:B;B${r})`).join("+");
      const bk = ["D", "F", "H", "J"].map(L => `SUMIFS(${G}!${L}:${L};${G}!B:B;B${r})`).join("+");
      formulas.push([`=${ef}`, `=${bk}`, `=D${r}+E${r}-F${r}-G${r}`]);
    }
    sh.getRange(d0, 2, n, 1).setValues(fechas).setNumberFormat(F_FECHA);
    sh.getRange(d0, 6, n, 3).setFormulas(formulas);
    sh.getRange(d0, 4, n, 5).setNumberFormat(F_NUM);
    bordes_(sh.getRange(d0, 2, n, 8));
    sh.getRange(d0, 9, n, 1).setDataValidation(dvC);
    const t = d0 + n;
    sh.getRange(t, 2, 1, 2).merge().setValue("TOTAL " + MESES_[m - 1]);
    sh.getRange(t, 4, 1, 5).setFormulas([[`=SUM(D${d0}:D${t - 1})`, `=SUM(E${d0}:E${t - 1})`, `=SUM(F${d0}:F${t - 1})`,
      `=SUM(G${d0}:G${t - 1})`, `=SUM(H${d0}:H${t - 1})`]]).setNumberFormat(F_NUM);
    estiloTotal_(sh.getRange(t, 2, 1, 8));
    grupos.push([e1, t - e1]);
    fila = t + 2;
  }
  [[1, 16], [2, 92], [3, 230], [4, 100], [5, 100], [6, 100], [7, 100], [8, 110], [9, 190], [10, 80]]
    .forEach(([c, w]) => sh.setColumnWidth(c, w));
  congelar_(sh, 3, null);
  sh.setRowGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
  grupos.forEach(([r, n]) => sh.getRange(r, 1, n, 1).shiftRowGroupDepth(1));
  const finde = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($B1);WEEKDAY($B1;2)>5)')
    .setFontColor(C_.gris).setRanges([sh.getRange("B1:B")]).build();
  sh.setConditionalFormatRules([finde]);  // sin rojo diario: gastar un día sin cobrar es lo normal
  sh.hideColumns(10);
  sh.setTabColor(C_.totalTexto);
}

// ===== SALDOS =====
// Filas fijas; una columna por revisión desde F. La columna E dice con qué TC se pasa cada cuenta a
// dólares: "Oficial" (banco) o "Paralelo" (efectivo en dólares, Binance, efectivo en casa).

const SALDOS_FILAS_ = {
  fecha: 2, bs0: 3, bsN: 8, totalBs: 9, pendientes: 11, bsMenos: 12,
  tcOficial: 14, tcParalelo: 15, bsEnUsd: 16,
  usd0: 18, usdN: 21, totalUsd: 22, general: 24, diezmoBs: 26, diezmoUsd: 27, ahorro: 29, ahorroPeriodo: 30,
};

function hojaSaldos_(ss, cuentas) {
  const sh = ss.getSheetByName(H_.saldos);
  base_(sh, 40, 260);
  const F = SALDOS_FILAS_;
  const etiquetas = {};
  const bs = cuentas.filter(c => c[3] === "Bs"), usd = cuentas.filter(c => c[3] === "USD");
  bs.slice(0, 6).forEach((c, i) => { etiquetas[F.bs0 + i] = c[1]; });
  usd.slice(0, 4).forEach((c, i) => { etiquetas[F.usd0 + i] = c[1]; });
  Object.assign(etiquetas, {
    [F.fecha]: "FECHA DE REVISIÓN", [F.totalBs]: "TOTAL BOLIVIANOS", [F.pendientes]: "GASTOS PENDIENTES",
    [F.bsMenos]: "TOTAL SALDO MENOS GASTOS EN BS", [F.tcOficial]: "TIPO DE CAMBIO OFICIAL (BANCO)",
    [F.tcParalelo]: "TIPO DE CAMBIO PARALELO", [F.bsEnUsd]: "BOLIVIANOS CONVERTIDOS EN $US",
    [F.totalUsd]: "TOTAL DÓLARES", [F.general]: "TOTAL GENERAL EN $US", [F.diezmoBs]: "DIEZMO EN BS",
    [F.diezmoUsd]: "DIEZMO EN $US", [F.ahorro]: "AHORRO REAL EN $US (SIN DIEZMO)", [F.ahorroPeriodo]: "AHORRO DESDE LA REVISIÓN ANTERIOR",
  });
  Object.entries(etiquetas).forEach(([f, t]) => sh.getRange(Number(f), 2, 1, 3).merge().setValue(t));
  sh.getRange(F.fecha, 5).setValue("TC QUE USA");
  cuentas.forEach(c => {
    const fila = Object.keys(etiquetas).find(k => etiquetas[k] === c[1]);
    if (fila) sh.getRange(Number(fila), 5).setValue(c[5]);
  });
  sh.getRange(F.fecha, 2, 1, 4).setFontWeight("bold").setBackground(C_.amarillo);
  [F.totalBs, F.totalUsd].forEach(f => sh.getRange(f, 2, 1, 3).setFontWeight("bold").setBackground("#dce6f1"));
  [F.bsEnUsd, F.general, F.ahorro].forEach(f => sh.getRange(f, 2, 1, 3).setFontWeight("bold").setBackground(C_.amarillo));
  [F.tcOficial, F.tcParalelo].forEach(f => sh.getRange(f, 2, 1, 3).setFontColor(C_.gris));
  sh.getRange(F.bs0, 2, F.ahorroPeriodo - F.bs0 + 1, 4).setWrap(true);
  sh.getRange(F.bs0, 5, F.ahorroPeriodo - F.bs0 + 1, 1).setFontColor(C_.gris).setHorizontalAlignment("center");
  [[1, 16], [2, 110], [3, 110], [4, 90], [5, 84]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  for (let c = 6; c <= 60; c++) sh.setColumnWidth(c, 112);
  congelar_(sh, 2, 5);
  bordesEtiquetasSaldos_(sh);
  sh.setTabColor("#38761d");
}

// Fórmulas y formatos de una columna de SALDOS (al importar y cuando la app agrega una revisión)
function formatoColumnaSaldos_(sh, col) {
  const F = SALDOS_FILAS_, L = columnaLetra_(col), P = col > 6 ? columnaLetra_(col - 1) : null;
  const conv = (f0, fN) => {
    const partes = [];
    for (let f = f0; f <= fN; f++) partes.push(`IF($E${f}="Paralelo";N(${L}${f})/${L}${F.tcParalelo};N(${L}${f})/${L}${F.tcOficial})`);
    return partes.join("+");
  };
  sh.getRange(F.totalBs, col).setFormula(`=SUM(${L}${F.bs0}:${L}${F.bsN})`);
  sh.getRange(F.bsMenos, col).setFormula(`=${L}${F.totalBs}-${L}${F.pendientes}`);
  // Los gastos pendientes salen del banco: se descuentan al TC oficial
  sh.getRange(F.bsEnUsd, col).setFormula(`=IFERROR(${conv(F.bs0, F.bsN)}-N(${L}${F.pendientes})/${L}${F.tcOficial};"")`);
  sh.getRange(F.totalUsd, col).setFormula(`=SUM(${L}${F.usd0}:${L}${F.usdN})`);
  sh.getRange(F.general, col).setFormula(`=IFERROR(${L}${F.bsEnUsd}+${L}${F.totalUsd};"")`);
  sh.getRange(F.ahorro, col).setFormula(`=IFERROR(${L}${F.general}-N(${L}${F.diezmoUsd});"")`);
  if (P) sh.getRange(F.ahorroPeriodo, col).setFormula(`=IFERROR(${L}${F.ahorro}-${P}${F.ahorro};"")`);
  sh.getRange(F.fecha, col).setNumberFormat(F_FECHA).setFontWeight("bold").setBackground(C_.amarillo).setHorizontalAlignment("center");
  sh.getRange(F.bs0, col, F.bsMenos - F.bs0 + 1, 1).setNumberFormat(F_BS);
  sh.getRange(F.diezmoBs, col).setNumberFormat(F_BS);
  sh.getRange(F.tcOficial, col, 2, 1).setNumberFormat("0.00").setFontColor(C_.gris);
  sh.getRange(F.bsEnUsd, col).setNumberFormat(F_USD).setFontWeight("bold").setBackground(C_.amarillo);
  sh.getRange(F.usd0, col, F.totalUsd - F.usd0 + 1, 1).setNumberFormat(F_USD);
  [F.general, F.diezmoUsd, F.ahorro, F.ahorroPeriodo].forEach(f => sh.getRange(f, col).setNumberFormat(F_USD));
  [F.general, F.ahorro].forEach(f => sh.getRange(f, col).setFontWeight("bold").setBackground(C_.amarillo));
  [F.totalBs, F.totalUsd].forEach(f => sh.getRange(f, col).setFontWeight("bold").setBackground("#dce6f1"));
  bordesColumna_(sh, col, 1);
}

function bordesColumna_(sh, col, ancho) {
  const F = SALDOS_FILAS_;
  [[F.fecha, 1], [F.bs0, F.totalBs - F.bs0 + 1], [F.pendientes, 2], [F.tcOficial, 3], [F.usd0, F.totalUsd - F.usd0 + 1],
    [F.general, 1], [F.diezmoBs, 2], [F.ahorro, 2]].forEach(([f, n]) => bordes_(sh.getRange(f, col, n, ancho)));
}

function bordesEtiquetasSaldos_(sh) { bordesColumna_(sh, 2, 4); }

// ===== PRESUPUESTO MENSUAL =====
// Arriba: la tabla de ella (líneas × meses, mensual y anual). Debajo: la misma tabla con lo gastado de
// verdad (desde GASTOS DIARIOS, por línea y mes), en rojo lo que se pasó del presupuesto.

function hojaPresupuesto_(ss, anio, catalogo) {
  const sh = ss.getSheetByName(H_.presupuesto);
  base_(sh, 260, 17);
  const G = `'${H_.gastos}'`;
  const mensual = [], anual = [];
  catalogo.grupos.forEach(([g, ls]) => ls.forEach(([l, col, tabla]) => ((tabla || "Mensual") === "Anual" ? anual : mensual).push([g, l])));
  let fila = 2;
  const bloque = (titulo, lineas, esReal) => {
    tituloHoja_(sh, fila, 2, 15, titulo);
    const enc = fila + 2;
    sh.getRange(enc, 2, 1, 15).setValues([["", "", ...MESES_, "TOTAL"]]).setFontWeight("bold").setHorizontalAlignment("center");
    sh.getRange(enc, 4, 1, 13).setBackground(C_.amarillo);
    bordes_(sh.getRange(enc, 2, 1, 15));
    let r = enc + 1;
    const inicio = r;
    const filasLinea = {};
    let g0 = r, gActual = null;
    const cerrarGrupo = (hasta) => {
      if (gActual === null) return;
      const rg = sh.getRange(g0, 2, hasta - g0 + 1, 1);
      if (hasta > g0) rg.merge();
      rg.setValue(gActual).setFontWeight("bold").setFontColor(C_.titulo).setHorizontalAlignment("center").setWrap(true);
      sh.getRange(g0, 2, hasta - g0 + 1, 2).setBackground(C_.cat[gActual] || C_.cat.OTROS);
    };
    lineas.forEach(([g, l]) => {
      if (g !== gActual) { cerrarGrupo(r - 1); gActual = g; g0 = r; }
      sh.getRange(r, 3).setValue(l).setHorizontalAlignment("center");
      filasLinea[l] = r;
      if (esReal) {
        const formulas = MESES_.map((_, i) =>
          `=SUMIFS(${G}!$M:$M;${G}!$N:$N;$C${r};${G}!$B:$B;">="&DATE(${anio};${i + 1};1);${G}!$B:$B;"<="&EOMONTH(DATE(${anio};${i + 1};1);0))`);
        sh.getRange(r, 4, 1, 12).setFormulas([formulas]);
      }
      sh.getRange(r, 16).setFormula(`=SUM(D${r}:O${r})`);
      r++;
    });
    cerrarGrupo(r - 1);
    sh.getRange(r, 2, 1, 2).merge().setValue("TOTAL");
    sh.getRange(r, 4, 1, 13).setFormulas([MESES_.map((_, i) => `=SUM(${columnaLetra_(4 + i)}${inicio}:${columnaLetra_(4 + i)}${r - 1})`)
      .concat([`=SUM(P${inicio}:P${r - 1})`])]);
    estiloTotal_(sh.getRange(r, 2, 1, 15));
    sh.getRange(inicio, 4, r - inicio + 1, 13).setNumberFormat(F_BS);
    bordes_(sh.getRange(inicio, 2, r - inicio + 1, 15));
    sh.getRange(inicio, 16, r - inicio, 1).setFontWeight("bold");
    fila = r + 3;
    return filasLinea;
  };
  const pm = bloque("PLANILLA DE PRESUPUESTO MENSUAL GESTIÓN " + anio, mensual, false);
  const pa = bloque("PLANILLA DE PRESUPUESTO ANUAL GESTIÓN " + anio, anual, false);
  const rm = bloque("GASTADO DE VERDAD - MENSUAL " + anio, mensual, true);
  const ra = bloque("GASTADO DE VERDAD - ANUAL " + anio, anual, true);
  // Rojo si lo gastado pasa lo presupuestado en esa misma línea y mes (las dos tablas tienen el mismo orden)
  const reglas = [];
  [[rm, pm], [ra, pa]].forEach(([real, pres]) => {
    const r0 = Math.min(...Object.values(real)), p0 = Math.min(...Object.values(pres));
    const n = Object.keys(real).length;
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND(N(OFFSET(D${r0};${p0 - r0};0))>0;N(D${r0})>N(OFFSET(D${r0};${p0 - r0};0)))`)
      .setBackground(C_.rojoFondo).setFontColor(C_.rojoTexto).setRanges([sh.getRange(r0, 4, n, 12)]).build());
  });
  sh.setConditionalFormatRules(reglas);
  [[1, 16], [2, 130], [3, 190]].forEach(([c, w]) => sh.setColumnWidth(c, w));
  for (let c = 4; c <= 16; c++) sh.setColumnWidth(c, 104);
  sh.setTabColor("#e69138");
  // Dónde quedó cada línea (para cargar el presupuesto y para la app)
  const cfg = ss.getSheetByName(H_.config);
  const mapa = [];
  Object.entries(pm).forEach(([l, r]) => mapa.push([l, "Mensual", r, rm[l]]));
  Object.entries(pa).forEach(([l, r]) => mapa.push([l, "Anual", r, ra[l]]));
  cfg.getRange(1, 27, 1, 4).setValues([["LÍNEA", "TABLA", "FILA PRESUPUESTO", "FILA REAL"]]);
  cfg.getRange(2, 27, mapa.length, 4).setValues(mapa);
  return { pm, pa, rm, ra };
}

// ===== RESUMEN =====
// Lo importante del mes elegido: cifras, proyección, categorías, ahorro y si cuadran los saldos.
// Todo sale de las otras hojas (las categorías, de las tablas de PRESUPUESTO): nunca se contradicen.

function hojaResumen_(ss, anio, catalogo, f) {
  const sh = ss.getSheetByName(H_.resumen);
  base_(sh, 60, 30);
  const P = `'${H_.presupuesto}'`, G = `'${H_.gastos}'`, R = `'${H_.reporte}'`, S = H_.saldos, C = H_.config;
  const cfg = ss.getSheetByName(C);
  // Listas de apoyo en CONFIG: meses y líneas mensuales (para la proyección)
  cfg.getRange(1, 32, 1, 2).setValues([["MESES", "LÍNEAS MENSUALES"]]);
  cfg.getRange(2, 32, 12, 1).setValues(MESES_.map(m => [m]));
  const mensuales = Object.keys(f.pm);
  cfg.getRange(2, 33, mensuales.length, 1).setValues(mensuales.map(l => [l]));
  const LM = `${C}!$AG$2:$AG$${mensuales.length + 1}`;

  tituloHoja_(sh, 2, 2, 11, "RESUMEN - GESTIÓN " + anio);
  sh.getRange("B4").setValue("MES").setFontWeight("bold").setHorizontalAlignment("right");
  const mes = sh.getRange("C4");
  mes.setValue(MESES_[Number(Utilities.formatDate(new Date(), "America/La_Paz", "M")) - 1])
    .setFontWeight("bold").setFontSize(12).setBackground(C_.amarillo).setHorizontalAlignment("center");
  mes.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(cfg.getRange("AF2:AF13"), true).build());
  bordes_(mes);
  // Ayudantes (columna Z, oculta): mes, inicio, fin, día de corte, ¿es el mes en curso?
  sh.getRange("Z1:Z5").setFormulas([
    [`=MATCH($C$4;${C}!$AF$2:$AF$13;0)`], [`=DATE(${anio};$Z$1;1)`], [`=EOMONTH($Z$2;0)`],
    [`=IF($Z$5;DAY(TODAY());DAY($Z$3))`], [`=AND(TODAY()>=$Z$2;TODAY()<=$Z$3)`]]);
  const enMes = (hoja, col) => `SUMIFS(${hoja}!$${col}:$${col};${hoja}!$B:$B;">="&$Z$2;${hoja}!$B:$B;"<="&$Z$3)`;
  const gastado = enMes(G, "M");
  const ingresos = `(${enMes(R, "D")}+${enMes(R, "E")})`;
  const filaTotal = o => Math.max(...Object.values(o)) + 1;
  const presMes = `(INDEX(${P}!$D$${filaTotal(f.pm)}:$O$${filaTotal(f.pm)};1;$Z$1)+INDEX(${P}!$D$${filaTotal(f.pa)}:$O$${filaTotal(f.pa)};1;$Z$1))`;

  // Tarjetas del mes
  const tarjeta = (col, etiqueta, formula, formato, nota) => {
    sh.getRange(6, col).setValue(etiqueta).setFontSize(9).setFontColor(C_.gris).setFontWeight("bold");
    sh.getRange(7, col).setFormula(formula).setFontSize(15).setFontWeight("bold").setNumberFormat(formato);
    if (nota) sh.getRange(8, col).setFormula(nota).setFontSize(9).setFontColor(C_.gris);
    const caja = sh.getRange(6, col, 3, 1);
    caja.setBorder(true, true, true, true, false, false, C_.borde, SpreadsheetApp.BorderStyle.SOLID).setBackground("#fafafa");
  };
  tarjeta(2, "GASTADO", "=" + gastado, F_BS, `=IF(${presMes}>0;TEXT(${gastado}/${presMes};"0%")&" del presupuesto";"")`);
  tarjeta(3, "PRESUPUESTO DEL MES", "=" + presMes, F_BS);
  tarjeta(4, "QUEDA", `=${presMes}-${gastado}`, F_BS, `=IF(${presMes}-${gastado}<0;"Se pasó del presupuesto";"")`);
  tarjeta(5, "INGRESOS", "=" + ingresos, F_BS);
  tarjeta(6, "RESULTADO DEL MES", `=${ingresos}-${gastado}`, F_BS, `=IF(${ingresos}-${gastado}<0;"Salió más de lo que entró";"Entró más de lo que salió")`);

  // Proyección: gastado hasta hoy + lo que en promedio se gastó desde mañana a fin de mes en los 3 meses anteriores
  // (solo líneas mensuales: una matrícula de julio no infla la proyección de septiembre)
  // (SUMIFS con una lista de criterios devuelve 0 si la lista viene de otra hoja: por eso MATCH)
  const resto = k => `IF($Z$1-${k}<1;"";SUMPRODUCT(ISNUMBER(MATCH(${G}!$N$6:$N$5000;${LM};0))*(${G}!$B$6:$B$5000>DATE(${anio};$Z$1-${k};MIN($Z$4;DAY(EOMONTH(DATE(${anio};$Z$1-${k};1);0)))))*(${G}!$B$6:$B$5000<=EOMONTH(DATE(${anio};$Z$1-${k};1);0));${G}!$M$6:$M$5000))`;
  sh.getRange("Z6").setFormula(`=IFERROR(AVERAGE(FILTER({${resto(1)};${resto(2)};${resto(3)}};{${resto(1)};${resto(2)};${resto(3)}}<>""));0)`);
  sh.getRange("B10:F10").merge().setValue("PROYECCIÓN A FIN DE MES").setFontSize(9).setFontColor(C_.gris).setFontWeight("bold");
  sh.getRange("B11").setFormula(`=IF($Z$5;${gastado}+$Z$6;${gastado})`).setFontSize(15).setFontWeight("bold").setNumberFormat(F_BS);
  sh.getRange("C11:F11").merge().setFormula(
    `=IF($Z$5;"Gastado hasta hoy "&TEXT(${gastado};"#,##0")&" + lo que se suele gastar del "&($Z$4+1)&" a fin de mes ("&TEXT($Z$6;"#,##0")&", promedio de los 3 meses anteriores)"&IF(${presMes}>0;". Quedaría en "&TEXT((${gastado}+$Z$6)/${presMes};"0%")&" del presupuesto.";".");"El mes ya terminó: es el gasto final.")`)
    .setWrap(true).setFontColor(C_.gris).setVerticalAlignment("middle");
  sh.setRowHeight(11, 40);
  sh.getRange("B10:F11").setBorder(true, true, true, true, false, false, C_.borde, SpreadsheetApp.BorderStyle.SOLID).setBackground("#fafafa");

  // Por categoría (sale de las tablas de PRESUPUESTO: presupuesto y gastado de verdad)
  const r0 = 14;
  sh.getRange(r0 - 1, 2).setValue("POR CATEGORÍA").setFontWeight("bold").setFontColor(C_.titulo);
  sh.getRange(r0, 2, 1, 6).setValues([["CATEGORÍA", "PRESUPUESTO", "GASTADO", "QUEDA", "USO", ""]])
    .setFontWeight("bold").setBackground(C_.amarillo).setHorizontalAlignment("center");
  sh.getRange(r0, 6, 1, 2).merge();
  let r = r0 + 1;
  catalogo.grupos.forEach(([g, ls]) => {
    const pres = ls.map(([l]) => (f.pm[l] || f.pa[l]) ? `INDEX(${P}!$D$1:$O$400;${f.pm[l] || f.pa[l]};$Z$1)` : null).filter(Boolean);
    const real = ls.map(([l]) => (f.rm[l] || f.ra[l]) ? `INDEX(${P}!$D$1:$O$400;${f.rm[l] || f.ra[l]};$Z$1)` : null).filter(Boolean);
    sh.getRange(r, 2).setValue(g).setFontWeight("bold").setFontColor(C_.titulo).setBackground(C_.cat[g] || C_.cat.OTROS);
    sh.getRange(r, 3, 1, 3).setFormulas([["=" + pres.join("+"), "=" + real.join("+"), `=C${r}-D${r}`]]);
    sh.getRange(r, 6).setFormula(`=IF(C${r}>0;SPARKLINE(MIN(D${r}/C${r};1);{"charttype"\\"bar";"max"\\1;"color1"\\IF(D${r}>C${r};"#c0392b";"#e26b0a")});IF(D${r}>0;"sin presupuesto";""))`);
    sh.getRange(r, 7).setFormula(`=IF(C${r}>0;D${r}/C${r};"")`).setNumberFormat("0%").setHorizontalAlignment("right");
    r++;
  });
  sh.getRange(r, 2).setValue("TOTAL");
  sh.getRange(r, 3, 1, 3).setFormulas([[`=SUM(C${r0 + 1}:C${r - 1})`, `=SUM(D${r0 + 1}:D${r - 1})`, `=C${r}-D${r}`]]);
  sh.getRange(r, 7).setFormula(`=IF(C${r}>0;D${r}/C${r};"")`).setNumberFormat("0%");
  estiloTotal_(sh.getRange(r, 2, 1, 6));
  sh.getRange(r0 + 1, 3, r - r0, 3).setNumberFormat(F_BS);
  bordes_(sh.getRange(r0, 2, r - r0 + 1, 6));
  const neg = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C_.rojoTexto).setBold(true)
    .setRanges([sh.getRange(r0 + 1, 5, r - r0, 1), sh.getRange("D7"), sh.getRange("F7")]).build();

  // Ahorro (de SALDOS): última revisión, cambio y evolución
  const n = `COUNT(${S}!$F$2:$ZZ$2)`;
  const ultimo = fila => `INDEX(${S}!$F$${fila}:$ZZ$${fila};${n})`;
  const penultimo = fila => `INDEX(${S}!$F$${fila}:$ZZ$${fila};${n}-1)`;
  const SF = SALDOS_FILAS_;
  sh.getRange("I6:J6").merge().setValue("AHORRO REAL (SIN DIEZMO)").setFontSize(9).setFontColor(C_.gris).setFontWeight("bold");
  sh.getRange("I7:J7").merge().setFormula("=" + ultimo(SF.ahorro)).setFontSize(15).setFontWeight("bold").setNumberFormat(F_USD);
  sh.getRange("I8:L8").merge().setFormula(`="al "&TEXT(${ultimo(SF.fecha)};"dd/mm/yyyy")&"   "&IF(${ultimo(SF.ahorroPeriodo)}>=0;"+";"")&TEXT(${ultimo(SF.ahorroPeriodo)};"#,##0")&" $us desde la revisión anterior"`)
    .setFontSize(9).setFontColor(C_.gris);
  sh.getRange("K6:L7").merge().setFormula(`=SPARKLINE(${S}!$F$${SF.ahorro}:$ZZ$${SF.ahorro};{"charttype"\\"line";"color"\\"#1f4e9a";"linewidth"\\2})`);
  sh.getRange("I6:L8").setBorder(true, true, true, true, false, false, C_.borde, SpreadsheetApp.BorderStyle.SOLID).setBackground("#fafafa");

  // ¿Cuadran los saldos? Entre las dos últimas revisiones: cambio de la plata en Bs contra lo anotado
  sh.getRange("I10:L11").merge().setValue("¿CUADRAN LOS SALDOS?\nEntre las dos últimas revisiones, en bolivianos")
    .setFontSize(9).setFontColor(C_.gris).setFontWeight("bold").setWrap(true).setVerticalAlignment("top");
  const A = penultimo(SF.fecha), B = ultimo(SF.fecha);
  const entre = (hoja, col) => `SUMIFS(${hoja}!$${col}:$${col};${hoja}!$B:$B;">"&${A};${hoja}!$B:$B;"<="&${B})`;
  const filas = [
    ["Del", `=${A}`, F_FECHA], ["Al", `=${B}`, F_FECHA],
    ["Cambió la plata en Bs", `=${ultimo(SF.totalBs)}-${penultimo(SF.totalBs)}`, F_BS],
    ["Ingresos anotados", `=${entre(R, "D")}+${entre(R, "E")}`, F_BS],
    ["Gastos anotados", `=-${entre(G, "M")}`, F_BS],
    ["Sin anotar", `=K14-K15-K16`, F_BS],
  ];
  filas.forEach(([t, fo, fmt], i) => {
    sh.getRange(12 + i, 9, 1, 2).merge().setValue(t);
    sh.getRange(12 + i, 11, 1, 2).merge().setFormula(fo).setNumberFormat(fmt).setHorizontalAlignment("right");
  });
  sh.getRange("I17:L17").setFontWeight("bold");
  sh.getRange("I18:L18").merge().setFormula(`=IF(ABS(K17)<1;"Todo lo que se movió está anotado.";IF(K17<0;"Salió plata que no se anotó (gastos, transferencias o comisiones).";"Entró plata que no se anotó."))`)
    .setFontSize(9).setFontColor(C_.gris).setWrap(true);
  sh.getRange("I10:L18").setBorder(true, true, true, true, false, false, C_.borde, SpreadsheetApp.BorderStyle.SOLID).setBackground("#fafafa");
  const sinAnotar = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=ABS($K$17)>=1").setFontColor(C_.rojoTexto)
    .setRanges([sh.getRange("I17:L17")]).build();

  // Mes a mes
  const m0 = 21;
  sh.getRange(m0 - 1, 9).setValue("MES A MES").setFontWeight("bold").setFontColor(C_.titulo);
  sh.getRange(m0, 9, 1, 4).setValues([["MES", "INGRESOS", "GASTOS", "RESULTADO"]]).setFontWeight("bold").setBackground(C_.amarillo).setHorizontalAlignment("center");
  const fm = MESES_.map((mn, i) => {
    const ini = `DATE(${anio};${i + 1};1)`, fin = `EOMONTH(DATE(${anio};${i + 1};1);0)`;
    const sm = (hoja, col) => `SUMIFS(${hoja}!$${col}:$${col};${hoja}!$B:$B;">="&${ini};${hoja}!$B:$B;"<="&${fin})`;
    const rr = m0 + 1 + i;
    return [mn, `=${sm(R, "D")}+${sm(R, "E")}`, `=${sm(G, "M")}`, `=J${rr}-K${rr}`];
  });
  sh.getRange(m0 + 1, 9, 12, 1).setValues(fm.map(x => [x[0]]));
  sh.getRange(m0 + 1, 10, 12, 3).setFormulas(fm.map(x => x.slice(1))).setNumberFormat(F_BS);
  bordes_(sh.getRange(m0, 9, 13, 4));
  const negMes = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(C_.rojoTexto)
    .setRanges([sh.getRange(m0 + 1, 12, 12, 1)]).build();
  const mesElegido = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$I${m0 + 1}=$C$4`).setBold(true).setBackground(C_.mes)
    .setRanges([sh.getRange(m0 + 1, 9, 12, 4)]).build();
  sh.setConditionalFormatRules([neg, sinAnotar, negMes, mesElegido]);
  const graf = sh.newChart().asColumnChart().addRange(sh.getRange(m0, 9, 13, 3)).setNumHeaders(1)
    .setOption("title", "Ingresos y gastos por mes").setOption("legend", { position: "bottom" })
    .setOption("colors", ["#6aa84f", "#e26b0a"]).setPosition(r + 3, 2, 0, 0).setOption("width", 620).setOption("height", 280).build();
  sh.insertChart(graf);

  [[1, 16], [2, 150], [3, 160], [4, 150], [5, 150], [6, 150], [7, 54], [8, 24], [9, 120], [10, 120], [11, 120], [12, 120]]
    .forEach(([c, w]) => sh.setColumnWidth(c, w));
  sh.hideColumns(26);
  sh.setTabColor("#1f4e9a");
}

// ===== Operaciones de carga (importación) =====

// params.gastos: [[fecha, autor, [8 montos], glosa, línea, cuenta, id]]
planillaOps_.cargar_gastos = function (ss, params) {
  const sh = ss.getSheetByName(H_.gastos);
  const porMes = {};
  params.gastos.forEach(g => { const m = Number(g[0].slice(5, 7)); (porMes[m] = porMes[m] || []).push(g); });
  // de diciembre a enero: insertar filas no mueve los meses que faltan cargar
  for (let m = 12; m >= 1; m--) {
    const gs = (porMes[m] || []).sort((a, b) => a[0].localeCompare(b[0]));
    if (!gs.length) continue;
    const vacia = filaTituloMes_(sh, m) + 1;
    sh.insertRowsBefore(vacia, gs.length);
    const rango = sh.getRange(vacia, 2, gs.length, 15);
    sh.getRange(vacia + gs.length, 2, 1, 15).copyTo(rango, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(vacia + gs.length, 2, 1, 15).copyTo(rango, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    rango.setValues(gs.map(g => [fecha_(g[0]), g[1], ...g[2].map(v => v || ""), g[3], "", g[4], g[5] || "", g[6]]));
  }
  return { success: true };
};

function filaTituloMes_(sh, m) {
  const anioTxt = sh.getRange("B2").getDisplayValue().match(/\d{4}/)[0];
  const buscado = "GASTOS DE " + MESES_[m - 1] + " " + anioTxt;
  const hit = sh.getRange("B:B").createTextFinder(buscado).matchEntireCell(true).findNext();
  if (!hit) throw new Error("No encontré el mes " + buscado);
  return hit.getRow();
}

// params.ingresos: [[fecha, concepto, efectivo, banco, cuenta]]
planillaOps_.cargar_ingresos = function (ss, params) {
  const sh = ss.getSheetByName(H_.reporte);
  const fechas = sh.getRange("B1:B" + sh.getLastRow()).getValues();
  const filaDe = {};
  fechas.forEach((f, i) => { if (f[0] instanceof Date) filaDe[Utilities.formatDate(f[0], "America/La_Paz", "yyyy-MM-dd")] = i + 1; });
  params.ingresos.forEach(([f, c, ef, bk, cta]) => {
    const r = filaDe[f];
    if (!r) return;
    sh.getRange(r, 3, 1, 3).setValues([[c, ef || "", bk || ""]]);
    if (cta) sh.getRange(r, 9).setValue(cta);
  });
  return { success: true };
};

// params.columnas: [{fecha, valores: {etiqueta: monto}, tc_oficial, tc_paralelo, pendientes, diezmo_bs, diezmo_usd}]
planillaOps_.cargar_saldos = function (ss, params) {
  const sh = ss.getSheetByName(H_.saldos);
  params.columnas.forEach((c, i) => escribirColumnaSaldos_(sh, 6 + (params.desde || 0) + i, c));
  return { success: true };
};

function escribirColumnaSaldos_(sh, col, c) {
  const F = SALDOS_FILAS_;
  const etiquetas = sh.getRange(1, 2, F.ahorroPeriodo, 1).getValues().map(f => f[0]);
  sh.getRange(F.fecha, col).setValue(fecha_(c.fecha));
  Object.entries(c.valores).forEach(([et, v]) => {
    const i = etiquetas.indexOf(et);
    if (i >= 0) sh.getRange(i + 1, col).setValue(v);
  });
  sh.getRange(F.pendientes, col).setValue(c.pendientes || "");
  sh.getRange(F.tcOficial, col, 2, 1).setValues([[c.tc_oficial], [c.tc_paralelo]]);
  sh.getRange(F.diezmoBs, col, 2, 1).setValues([[c.diezmo_bs || ""], [c.diezmo_usd || ""]]);
  formatoColumnaSaldos_(sh, col);
}

// params.valores: {línea: {tabla: "Mensual"|"Anual", meses: [12]}}
planillaOps_.cargar_presupuesto = function (ss, params) {
  const sh = ss.getSheetByName(H_.presupuesto);
  const mapa = ss.getSheetByName(H_.config).getRange("AA2:AD200").getValues().filter(f => f[0]);
  mapa.forEach(([l, tabla, filaP]) => {
    const v = params.valores[l];
    if (v && v.tabla === tabla) sh.getRange(filaP, 4, 1, 12).setValues([v.meses.map(x => x || "")]);
  });
  return { success: true };
};

planillaOps_.cargar_reglas = function (ss, params) {
  ss.getSheetByName(H_.config).getRange(2, 8, params.reglas.length, 3).setValues(params.reglas);
  return { success: true };
};

// Deja plegados todos los meses menos el pedido (o el actual)
planillaOps_.plegar = function (ss, params) {
  const mes = params.mes || Number(Utilities.formatDate(new Date(), "America/La_Paz", "M"));
  [H_.gastos, H_.reporte].forEach(n => {
    const sh = ss.getSheetByName(n);
    const col = sh.getRange("B1:B" + sh.getLastRow()).getDisplayValues().map(f => f[0]);
    for (let m = 1; m <= 12; m++) {
      const i = col.findIndex(v => v.startsWith((n === H_.reporte ? "REPORTE DE " : "GASTOS DE ") + MESES_[m - 1] + " "));
      if (i < 0) continue;
      const g = sh.getRowGroup(i + 2, 1);
      if (!g) continue;
      if (m === mes) g.expand(); else g.collapse();
    }
  });
  return { success: true };
};

planillaOps_.info = function (ss) {
  return { success: true, url: ss.getUrl(), nombre: ss.getName(), hojas: ss.getSheets().map(s => [s.getName(), s.getLastRow(), s.isSheetHidden()]) };
};

// Revisión: celdas con error + valores visibles de rangos pedidos
planillaOps_.revisar = function (ss, params) {
  SpreadsheetApp.flush();
  const errores = {};
  ss.getSheets().forEach(sh => {
    const v = sh.getDataRange().getDisplayValues();
    const e = [];
    v.forEach((f, i) => f.forEach((x, j) => { if (/^#(REF|ERROR|N\/A|VALUE|NAME|DIV\/0|NUM)/.test(x)) e.push(sh.getRange(i + 1, j + 1).getA1Notation() + "=" + x); }));
    if (e.length) errores[sh.getName()] = e.slice(0, 15).concat(e.length > 15 ? ["… " + e.length + " en total"] : []);
  });
  const rangos = {};
  (params.rangos || []).forEach(r => { rangos[r] = ss.getRange(r).getDisplayValues().filter(f => f.some(x => x !== "")); });
  return { success: true, errores: errores, rangos: rangos };
};

// Evalúa fórmulas sueltas en una hoja temporal (para depurar)
planillaOps_.evaluar = function (ss, params) {
  const sh = ss.insertSheet("_prueba");
  try {
    const out = params.formulas.map((f, i) => {
      const c = sh.getRange(1 + i * 40, 1);
      c.setFormula(f);
      SpreadsheetApp.flush();
      return { formula: f.slice(0, 80), valor: c.getDisplayValue(), abajo: c.offset(1, 0, 3, 6).getDisplayValues() };
    });
    return { success: true, resultados: out };
  } finally {
    ss.deleteSheet(sh);
  }
};
