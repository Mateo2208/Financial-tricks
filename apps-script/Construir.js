// Construye la planilla nueva "Finanzas de la casa" desde cero (estructura, formato, fórmulas).
// Idempotente: borra y rehace las hojas. Los datos se cargan después con la op "cargar".
// Fórmulas en configuración regional es_BO: separador ";" y coma decimal.
// Diseño: docs/PLANILLA-NUEVA.md

const TEMA = {
  fuente: "Inter",
  tinta: "#141414", tinta2: "#6b6b6b", borde: "#e4e4e4", sutil: "#f6f6f6", fondo: "#ffffff",
  ok: "#15803d", pend: "#b45309", err: "#c62828",
  cat: {
    "Alimentación": "#d8432b", "Movilidad": "#2563c9", "Servicios básicos": "#0f8c7a", "Varios": "#7c4ddb",
    "Chicos": "#db2777", "Consultorio": "#0891b2", "Educación": "#ca8a04", "Impuestos": "#57534e",
    "Compras grandes": "#1e293b", "Sin detalle": "#9a9a9a", "Ingresos": "#15803d", "Movimientos internos": "#9a9a9a",
  },
};
const FMT_BS = '"Bs "#,##0.00;"-Bs "#,##0.00;"–"';
const FMT_USD = '"$ "#,##0.00;"-$ "#,##0.00;"–"';
const FMT_NUM = '#,##0.00;-#,##0.00;"–"';
const FMT_FECHA = "dd/mm/yyyy";
const HOJAS = ["Inicio", "Movimientos", "Presupuesto", "Saldos", "Fotos de saldos", "Diario", "Reporte",
  "Diezmo", "Cuentas", "Reglas", "Listas", "TC"];

const planillaOps_ = {};

planillaOps_.construir = function (ss, params) {
  // Hoja temporal para poder borrar todas las demás
  let tmp = ss.getSheetByName("_tmp") || ss.insertSheet("_tmp");
  ss.getSheets().forEach(sh => { if (sh.getName() !== "_tmp") ss.deleteSheet(sh); });
  HOJAS.forEach((n, i) => ss.insertSheet(n, i));
  ss.deleteSheet(tmp);
  ss.setSpreadsheetLocale("es_BO");
  ss.setSpreadsheetTimeZone("America/La_Paz");

  if (!params.catalogo) throw new Error("Falta params.catalogo");
  hojaListas_(ss, params.catalogo); hojaTC_(ss); hojaCuentas_(ss); hojaMovimientos_(ss); hojaReglas_(ss);
  hojaPresupuesto_(ss); hojaFotos_(ss); hojaDiezmo_(ss); hojaSaldos_(ss); hojaDiario_(ss);
  hojaReporte_(ss); hojaInicio_(ss);
  ss.setActiveSheet(ss.getSheetByName("Inicio"));
  return { success: true, hojas: ss.getSheets().map(s => s.getName()) };
};

// Añade filas al final de una tabla (columna A contigua). params: {hoja, filas, columna_inicio}
planillaOps_.cargar = function (ss, params) {
  const sh = ss.getSheetByName(params.hoja);
  const filas = params.filas || [];
  if (!filas.length) return { success: true, agregadas: 0 };
  const desde = ultimaFila_(sh) + 1;
  const col = params.columna_inicio || 1;
  const falta = desde + filas.length - 1 - sh.getMaxRows();
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta + 500);
  const datos = filas.map(f => f.map(v => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? fecha_(v) : v));
  sh.getRange(desde, col, datos.length, datos[0].length).setValues(datos);
  return { success: true, agregadas: datos.length, desde: desde };
};

// Reemplaza el contenido de datos de una tabla (desde la fila 2). params: {hoja, filas}
planillaOps_.reemplazar = function (ss, params) {
  const sh = ss.getSheetByName(params.hoja);
  const n = ultimaFila_(sh);
  const ancho = (params.filas[0] || []).length;
  if (n > 1 && ancho) sh.getRange(2, 1, n - 1, ancho).clearContent();
  return planillaOps_.cargar(ss, params);
};

planillaOps_.info = function (ss) {
  return { success: true, url: ss.getUrl(), hojas: ss.getSheets().map(s => [s.getName(), ultimaFila_(s)]) };
};

// ===== utilidades =====

function fecha_(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d);  // medianoche en la zona del script (La Paz), igual que la planilla
}

function ultimaFila_(sh) {
  const a1 = sh.getRange("A1");
  if (a1.isBlank()) return 0;
  if (sh.getRange("A2").isBlank()) return 1;
  return a1.getNextDataCell(SpreadsheetApp.Direction.DOWN).getRow();
}

function base_(sh, opts) {
  opts = opts || {};
  const rango = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  rango.setFontFamily(TEMA.fuente).setFontSize(10).setFontColor(TEMA.tinta).setVerticalAlignment("middle");
  if (opts.sinGrilla) sh.setHiddenGridlines(true);
}

function encabezado_(sh, fila, col, titulos, opts) {
  opts = opts || {};
  const r = sh.getRange(fila, col, 1, titulos.length);
  r.setValues([titulos]).setFontWeight("bold").setFontColor(opts.color || TEMA.tinta)
    .setBackground(opts.fondo || TEMA.sutil).setBorder(null, null, true, null, null, null, TEMA.borde, SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(fila, 30);
  return r;
}

function tabla_(sh, cols, anchos, opts) {
  encabezado_(sh, 1, 1, cols, opts);
  sh.setFrozenRows(1);
  anchos.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  const sobra = sh.getMaxColumns() - cols.length;
  if (sobra > 0 && !(opts && opts.conservarColumnas)) sh.deleteColumns(cols.length + 1, sobra);
}

function lista_(rango, fuente, estricto) {
  const regla = SpreadsheetApp.newDataValidation().requireValueInRange(fuente, true)
    .setAllowInvalid(!estricto).build();
  rango.setDataValidation(regla);
}

function listaValores_(rango, valores) {
  rango.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(valores, true).setAllowInvalid(false).build());
}

function titulo_(sh, celda, texto, sub) {
  sh.getRange(celda).setValue(texto).setFontSize(20).setFontWeight("bold");
  if (sub) sh.getRange(celda).offset(1, 0).setValue(sub).setFontColor(TEMA.tinta2);
}

function tarjeta_(sh, fila, col, etiqueta, formula, formato, nota) {
  sh.getRange(fila, col).setValue(etiqueta).setFontColor(TEMA.tinta2).setFontSize(9);
  const v = sh.getRange(fila + 1, col).setFormula(formula).setFontSize(18).setFontWeight("bold").setNumberFormat(formato);
  if (nota) sh.getRange(fila + 2, col).setFormula(nota).setFontColor(TEMA.tinta2).setFontSize(9);
  return v;
}

// ===== Hojas =====

// El catálogo (categorías, líneas, ingresos) llega en params.catalogo desde privado/: no va en el
// repo público. Formato: {gastos: [[categoría, [líneas]]], ingresos: [[línea, '¿Diezmo? Sí/No']]}

function hojaListas_(ss, catalogo) {
  const sh = ss.getSheetByName("Listas");
  base_(sh);
  const filas = [];
  catalogo.gastos.forEach(([c, ls]) => ls.forEach(l => filas.push([c, l, "Gasto", ""])));
  catalogo.ingresos.forEach(([l, d]) => filas.push(["Ingresos", l, "Ingreso", d]));
  filas.push(["Movimientos internos", "Transferencia", "Transferencia", ""]);
  filas.push(["Movimientos internos", "Ajuste de saldo", "Ajuste", ""]);
  tabla_(sh, ["Categoría", "Línea", "Tipo", "¿Diezmo? (ingresos)", "", "Persona", "", "Tipo de movimiento", "", "Meses con datos"],
    [150, 190, 110, 150, 24, 120, 24, 160, 24, 130], { conservarColumnas: true });
  sh.getRange(2, 1, filas.length, 4).setValues(filas);
  listaValores_(sh.getRange(2, 4, filas.length, 1), ["Sí", "No", ""]);
  sh.getRange(2, 6, 2, 1).setValues([["Ever"], ["Ma. Nelfi"]]);
  sh.getRange(2, 8, 4, 1).setValues([["Gasto"], ["Ingreso"], ["Transferencia"], ["Ajuste"]]);
  sh.getRange("J2").setFormula('=IFERROR(SORT(UNIQUE(FILTER(Movimientos!O2:O;Movimientos!O2:O<>""));1;FALSE);TEXT(TODAY();"yyyy-mm"))');
  // color por categoría
  filas.forEach((f, i) => sh.getRange(i + 2, 1).setFontColor(TEMA.cat[f[0]] || TEMA.tinta).setFontWeight("bold"));
  sh.setTabColor("#9a9a9a");
  sh.getRange("A1").setNote("Categorías y líneas. Se pueden agregar filas: aparecen solas en los desplegables y en la app.");
}

function hojaTC_(ss) {
  const sh = ss.getSheetByName("TC");
  base_(sh);
  tabla_(sh, ["Fecha", "Dólar paralelo (Bs por $)", "Dólar oficial", "Fuente"], [110, 190, 130, 260]);
  sh.getRange("A2:A").setNumberFormat(FMT_FECHA);
  sh.getRange("B2:C").setNumberFormat("0.00");
  sh.setTabColor("#9a9a9a");
  sh.getRange("B1").setNote("Tipo de cambio usado para pasar bolivianos a dólares. Lo actualiza solo QuickCash desde Dólar Blue Bolivia; se puede escribir uno a mano (gana el de la fecha más reciente).");
}

function hojaCuentas_(ss) {
  const sh = ss.getSheetByName("Cuentas");
  base_(sh);
  tabla_(sh, ["Cuenta", "Dueño", "Moneda", "Medio", "Saldo inicial", "Desde", "Saldo actual",
    "Última foto", "Fecha foto", "Diferencia con la foto", "Por defecto para", "Activa"],
    [240, 110, 80, 90, 130, 100, 140, 130, 100, 150, 170, 70]);
  const n = 30;
  listaValores_(sh.getRange(2, 3, n, 1), ["Bs", "USD"]);
  listaValores_(sh.getRange(2, 4, n, 1), ["Banco", "Efectivo", "Cripto"]);
  lista_(sh.getRange(2, 2, n, 1), ss.getSheetByName("Listas").getRange("F2:F"), false);
  listaValores_(sh.getRange(2, 12, n, 1), ["Sí", "No"]);
  sh.getRange("F2:F").setNumberFormat(FMT_FECHA);
  sh.getRange("I2:I").setNumberFormat(FMT_FECHA);
  sh.getRange("E2:H").setNumberFormat(FMT_NUM);
  sh.getRange("J2:J").setNumberFormat(FMT_NUM);
  for (let r = 2; r <= n + 1; r++) {
    sh.getRange(r, 7).setFormula(`=IF(A${r}="";"";E${r}+SUMIFS(Movimientos!Q:Q;Movimientos!F:F;A${r};Movimientos!B:B;">"&F${r}))`);
    sh.getRange(r, 9).setFormula(`=IF(A${r}="";"";IFERROR(1/(1/MAXIFS('Fotos de saldos'!A:A;'Fotos de saldos'!B:B;A${r}));""))`);
    sh.getRange(r, 8).setFormula(`=IF(I${r}="";"";SUMIFS('Fotos de saldos'!C:C;'Fotos de saldos'!B:B;A${r};'Fotos de saldos'!A:A;I${r}))`);
    sh.getRange(r, 10).setFormula(`=IF(OR(I${r}="";I${r}<=F${r});"";H${r}-(E${r}+SUMIFS(Movimientos!Q:Q;Movimientos!F:F;A${r};Movimientos!B:B;">"&F${r};Movimientos!B:B;"<="&I${r})))`);
  }
  sh.getRange("G1").setNote("Saldo inicial + todo lo registrado en Movimientos después de 'Desde'.");
  sh.getRange("J1").setNote("Foto de saldos menos lo que calcula la planilla a esa fecha. Si no es cero, hubo movimientos sin registrar: se corrige con un 'Ajuste de saldo'.");
  sh.getRange("K1").setNote("La app usa esta cuenta cuando esa persona paga con ese medio. Ej.: 'Ever · Banco'.");
  const f = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($J2);ABS($J2)>=1)')
    .setFontColor(TEMA.pend).setBold(true).setRanges([sh.getRange("J2:J")]).build();
  sh.setConditionalFormatRules([f]);
  sh.setTabColor("#9a9a9a");
}

function hojaMovimientos_(ss) {
  const sh = ss.getSheetByName("Movimientos");
  sh.insertRowsAfter(sh.getMaxRows(), 9000);  // espacio para años de movimientos
  base_(sh);
  const cols = ["ID", "Fecha", "Tipo", "Línea", "Monto", "Cuenta", "Persona", "Detalle", "Revisar", "Origen",
    "Registrado", "Categoría", "Medio", "Moneda", "Mes", "Monto en Bs", "Efecto en la cuenta", "Año"];
  tabla_(sh, cols, [90, 95, 95, 170, 110, 210, 95, 260, 150, 200, 140, 140, 80, 70, 75, 115, 120, 60]);
  // Columnas calculadas (L:R): una fórmula por columna, cubre las filas nuevas solas
  sh.getRange("L2").setFormula('=ARRAYFORMULA(IF(D2:D="";;IFERROR(XLOOKUP(D2:D;Listas!B2:B;Listas!A2:A);"Sin categoría")))');
  sh.getRange("M2").setFormula('=ARRAYFORMULA(IF(F2:F="";;IFERROR(XLOOKUP(F2:F;Cuentas!A2:A;Cuentas!D2:D);"")))');
  sh.getRange("N2").setFormula('=ARRAYFORMULA(IF(F2:F="";;IFERROR(XLOOKUP(F2:F;Cuentas!A2:A;Cuentas!C2:C);"Bs")))');
  sh.getRange("O2").setFormula('=ARRAYFORMULA(IF(B2:B="";;TEXT(B2:B;"yyyy-mm")))');
  sh.getRange("P2").setFormula('=ARRAYFORMULA(IF(E2:E="";;IF(N2:N="USD";E2:E*IFERROR(VLOOKUP(B2:B;TC!A2:B;2;TRUE);10);E2:E)))');
  sh.getRange("Q2").setFormula('=ARRAYFORMULA(IF(E2:E="";;IF(C2:C="Gasto";-E2:E;E2:E)))');
  sh.getRange("R2").setFormula('=ARRAYFORMULA(IF(B2:B="";;YEAR(B2:B)))');
  sh.getRange("L1:R1").setBackground("#ececec").setFontColor(TEMA.tinta2);
  sh.getRange("L1").setNote("Columnas grises: se calculan solas. No escribir en ellas.");
  // formatos y listas
  sh.getRange("B2:B").setNumberFormat(FMT_FECHA);
  sh.getRange("E2:E").setNumberFormat(FMT_NUM);
  sh.getRange("P2:Q").setNumberFormat(FMT_NUM);
  sh.getRange("K2:K").setNumberFormat("dd/mm/yyyy hh:mm");
  const hasta = sh.getMaxRows() - 1;
  lista_(sh.getRange(2, 3, hasta, 1), ss.getSheetByName("Listas").getRange("H2:H5"), true);
  lista_(sh.getRange(2, 4, hasta, 1), ss.getSheetByName("Listas").getRange("B2:B"), false);
  lista_(sh.getRange(2, 6, hasta, 1), ss.getSheetByName("Cuentas").getRange("A2:A"), false);
  lista_(sh.getRange(2, 7, hasta, 1), ss.getSheetByName("Listas").getRange("F2:F"), false);
  sh.getRange("A1").setNote("Una fila por movimiento. QuickCash agrega las suyas al final. Se puede escribir a mano: completar Fecha, Tipo, Línea, Monto, Cuenta y Persona (el ID puede quedar vacío).");
  sh.getRange("E1").setNote("Siempre positivo para gastos e ingresos. En transferencias y ajustes: negativo si sale de la cuenta, positivo si entra.");
  // Colores: ingresos en verde, marcados para revisar en ámbar
  const reglas = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Ingreso"').setFontColor(TEMA.ok)
      .setRanges([sh.getRange("E2:E")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$I2<>""').setBackground("#fef3c7")
      .setRanges([sh.getRange("I2:I")]).build(),
  ];
  sh.setConditionalFormatRules(reglas);
  sh.getRange(1, 1, sh.getMaxRows(), 18).createFilter();
  sh.setTabColor(TEMA.tinta);
}

function hojaReglas_(ss) {
  const sh = ss.getSheetByName("Reglas");
  base_(sh);
  tabla_(sh, ["Si el detalle dice…", "…va a la línea", "Agregada por"], [220, 200, 140]);
  lista_(sh.getRange(2, 2, sh.getMaxRows() - 1, 1), ss.getSheetByName("Listas").getRange("B2:B"), false);
  sh.getRange("A1").setNote("QuickCash elige la línea buscando estas palabras en el detalle (gana la más larga). Se pueden agregar, cambiar o borrar filas.");
  sh.setTabColor("#9a9a9a");
}

function hojaPresupuesto_(ss) {
  const sh = ss.getSheetByName("Presupuesto");
  base_(sh);
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  tabla_(sh, ["Año", "Tipo", "Categoría", "Línea", ...meses, "Total", "Real del año", "Diferencia"],
    [55, 80, 140, 180, ...meses.map(() => 85), 105, 110, 105]);
  sh.setFrozenColumns(4);
  const n = sh.getMaxRows() - 1;
  listaValores_(sh.getRange(2, 2, n, 1), ["Mensual", "Anual"]);
  lista_(sh.getRange(2, 4, n, 1), ss.getSheetByName("Listas").getRange("B2:B"), false);
  sh.getRange("C2").setFormula('=ARRAYFORMULA(IF(D2:D="";;IFERROR(XLOOKUP(D2:D;Listas!B2:B;Listas!A2:A);"")))');
  sh.getRange("Q2").setFormula('=ARRAYFORMULA(IF(D2:D="";;MMULT(IF(ISNUMBER(E2:P);E2:P;0);SEQUENCE(12;1;1;0))))');
  sh.getRange("R2").setFormula('=ARRAYFORMULA(IF(D2:D="";;SUMIFS(Movimientos!P:P;Movimientos!D:D;D2:D;Movimientos!R:R;A2:A;Movimientos!C:C;"Gasto")))');
  sh.getRange("S2").setFormula('=ARRAYFORMULA(IF(D2:D="";;Q2:Q-R2:R))');
  sh.getRange("C1").setBackground("#ececec").setFontColor(TEMA.tinta2);
  sh.getRange("Q1:S1").setBackground("#ececec").setFontColor(TEMA.tinta2);
  sh.getRange("E2:S").setNumberFormat(FMT_NUM);
  sh.getRange("A1").setNote("Lo que se espera gastar por línea y mes. 'Mensual' = gastos de todos los meses; 'Anual' = pagos de una o dos veces al año. Real y diferencia se calculan solos.");
  const reglas = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($S2);$S2<0)').setFontColor(TEMA.err).setBold(true)
      .setRanges([sh.getRange("S2:S")]).build(),
  ];
  sh.setConditionalFormatRules(reglas);
  sh.getRange(1, 1, sh.getMaxRows(), 19).createFilter();
  sh.setTabColor(TEMA.cat["Alimentación"]);
}

function hojaFotos_(ss) {
  const sh = ss.getSheetByName("Fotos de saldos");
  sh.insertRowsAfter(sh.getMaxRows(), 2000);
  base_(sh);
  tabla_(sh, ["Fecha", "Cuenta", "Saldo", "Moneda", "Nota"], [100, 240, 130, 80, 260]);
  sh.getRange("D2").setFormula('=ARRAYFORMULA(IF(B2:B="";;IFERROR(XLOOKUP(B2:B;Cuentas!A2:A;Cuentas!C2:C);"")))');
  sh.getRange("D1").setBackground("#ececec").setFontColor(TEMA.tinta2);
  sh.getRange("A2:A").setNumberFormat(FMT_FECHA);
  sh.getRange("C2:C").setNumberFormat(FMT_NUM);
  lista_(sh.getRange(2, 2, sh.getMaxRows() - 1, 1), ss.getSheetByName("Cuentas").getRange("A2:A"), false);
  sh.getRange("A1").setNote("Lo que mostraba cada cuenta el día que se revisó (como la hoja SALDOS de antes). QuickCash agrega una fila por cuenta cuando se cargan los saldos.");
  sh.getRange(1, 1, sh.getMaxRows(), 5).createFilter();
  sh.setTabColor("#9a9a9a");
}

function hojaDiezmo_(ss) {
  const sh = ss.getSheetByName("Diezmo");
  base_(sh, { sinGrilla: true });
  titulo_(sh, "B2", "Diezmo", "El 10% de los ingresos marcados con ¿Diezmo? = Sí en Listas, reservado dentro de las cuentas.");
  sh.getRange("B5:C8").setValues([
    ["Acumulado de antes (Bs)", ""], ["Acumulado de antes ($)", ""], ["Hasta la fecha", ""], ["Porcentaje", 0.1]]);
  sh.getRange("C7").setNumberFormat(FMT_FECHA);
  sh.getRange("C8").setNumberFormat("0%");
  sh.getRange("C5").setNumberFormat(FMT_NUM); sh.getRange("C6").setNumberFormat(FMT_NUM);
  sh.getRange("B5:B8").setFontColor(TEMA.tinta2);
  sh.getRange("C5:C8").setBackground("#fffbeb");
  encabezado_(sh, 10, 2, ["Mes", "Ingresos con diezmo", "Diezmo (Bs)", "TC", "Diezmo ($)"]);
  sh.getRange("B11").setFormula(
    '=ARRAYFORMULA(LET(meses;SORT(UNIQUE(FILTER(Movimientos!O2:O;Movimientos!C2:C="Ingreso";Movimientos!B2:B>C7)));' +
    'ing;MAP(meses;LAMBDA(m;SUMPRODUCT((Movimientos!O2:O=m)*(Movimientos!C2:C="Ingreso")*(IFERROR(XLOOKUP(Movimientos!D2:D;Listas!B2:B;Listas!D2:D);"")="Sí")*(Movimientos!B2:B>C7)*Movimientos!P2:P)));' +
    'tc;MAP(meses;LAMBDA(m;IFERROR(VLOOKUP(EOMONTH(DATEVALUE(m&"-01");0);TC!A2:B;2;TRUE);10)));' +
    'IFERROR(HSTACK(meses;ing;ing*C8;tc;ing*C8/tc);"")))');
  sh.getRange("C11:C").setNumberFormat(FMT_NUM); sh.getRange("D11:D").setNumberFormat(FMT_NUM);
  sh.getRange("E11:E").setNumberFormat("0.00"); sh.getRange("F11:F").setNumberFormat(FMT_NUM);
  sh.getRange("H10").setValue("Total reservado").setFontWeight("bold");
  sh.getRange("H11").setValue("En bolivianos").setFontColor(TEMA.tinta2);
  sh.getRange("I11").setFormula("=C5+SUM(D11:D)").setNumberFormat(FMT_BS).setFontWeight("bold");
  sh.getRange("H12").setValue("En dólares").setFontColor(TEMA.tinta2);
  sh.getRange("I12").setFormula("=C6+SUM(F11:F)").setNumberFormat(FMT_USD).setFontWeight("bold").setFontSize(14);
  [2, 3, 4, 5, 6, 7, 8, 9].forEach((c, i) => sh.setColumnWidth(c, [220, 170, 120, 70, 120, 24, 150, 150][i]));
  sh.setColumnWidth(1, 24);
  sh.setTabColor(TEMA.cat["Varios"]);
}

function hojaSaldos_(ss) {
  const sh = ss.getSheetByName("Saldos");
  base_(sh, { sinGrilla: true });
  sh.setColumnWidth(1, 24);
  titulo_(sh, "B2", "Saldos", "Calculados con lo registrado en Movimientos. Las fotos de saldos sirven de control.");
  tarjeta_(sh, 5, 2, "Total en bolivianos", '=SUMIFS(Cuentas!G:G;Cuentas!C:C;"Bs";Cuentas!L:L;"Sí")', FMT_BS);
  tarjeta_(sh, 5, 4, "Total en dólares (cuentas en $)", '=SUMIFS(Cuentas!G:G;Cuentas!C:C;"USD";Cuentas!L:L;"Sí")', FMT_USD);
  tarjeta_(sh, 5, 6, "Dólar paralelo hoy", '=IFERROR(VLOOKUP(TODAY();TC!A2:B;2;TRUE);10)', "0.00",
    '="Fuente: TC, "&TEXT(IFERROR(MAXIFS(TC!A:A;TC!A:A;"<="&TODAY());"");"dd/mm/yyyy")');
  tarjeta_(sh, 9, 2, "Todo en dólares", "=B6/F6+D6", FMT_USD);
  tarjeta_(sh, 9, 4, "Diezmo reservado", "=Diezmo!I12", FMT_USD);
  tarjeta_(sh, 9, 6, "Ahorro real", "=B10-D10", FMT_USD, '="Todo en dólares menos el diezmo"');
  sh.getRange("F10").setFontColor(TEMA.ok);
  [2, 3, 4, 5, 6, 7].forEach(c => sh.setColumnWidth(c, c % 2 ? 24 : 200));
  // Tabla por cuenta
  encabezado_(sh, 14, 2, ["Cuenta", "", "Saldo actual", "", "Moneda", "", "Diferencia con la última foto"]);
  sh.getRange("B15").setFormula('=FILTER(Cuentas!A2:A;Cuentas!A2:A<>"";Cuentas!L2:L="Sí")');
  sh.getRange("D15").setFormula('=FILTER(Cuentas!G2:G;Cuentas!A2:A<>"";Cuentas!L2:L="Sí")');
  sh.getRange("F15").setFormula('=FILTER(Cuentas!C2:C;Cuentas!A2:A<>"";Cuentas!L2:L="Sí")');
  sh.getRange("H15").setFormula('=FILTER(Cuentas!J2:J;Cuentas!A2:A<>"";Cuentas!L2:L="Sí")');
  sh.getRange("D15:D40").setNumberFormat(FMT_NUM); sh.getRange("H15:H40").setNumberFormat(FMT_NUM);
  sh.setColumnWidth(8, 200);
  // Historia de fotos como la hoja de antes: cuentas × fechas
  sh.getRange("B32").setValue("Historia de las fotos de saldos").setFontWeight("bold").setFontSize(12);
  sh.getRange("B33").setFormula("=QUERY('Fotos de saldos'!A1:C;\"select B, sum(C) where A is not null group by B pivot A label B 'Cuenta'\";1)");
  sh.insertColumnsAfter(sh.getMaxColumns(), 240);  // una columna por foto (como la hoja de antes)
  sh.getRange(34, 3, 30, 240).setNumberFormat(FMT_NUM);
  sh.getRange(33, 3, 1, 240).setNumberFormat(FMT_FECHA).setFontWeight("bold");
  sh.setTabColor(TEMA.ok);
}

function hojaDiario_(ss) {
  const sh = ss.getSheetByName("Diario");
  base_(sh, { sinGrilla: true });
  sh.setColumnWidth(1, 24);
  titulo_(sh, "B2", "Diario", "Gastos por día del mes elegido en Inicio, por categoría y medio (como la planilla de antes).");
  sh.getRange("B4").setValue("Mes").setFontColor(TEMA.tinta2);
  sh.getRange("C4").setFormula("=Inicio!C5").setFontWeight("bold");
  sh.getRange("B6").setFormula(
    '=IFERROR(QUERY(Movimientos!A1:R;"select B, sum(P) where C = \'Gasto\' and O = \'"&C4&"\' group by B pivot L, M label B \'Fecha\'";1);"Sin gastos este mes")');
  sh.getRange("B7:B45").setNumberFormat("ddd dd/mm");
  sh.getRange("C7:Z45").setNumberFormat(FMT_NUM);
  sh.getRange("B6:Z6").setFontWeight("bold").setWrap(true).setBackground(TEMA.sutil);
  sh.setColumnWidth(2, 110);
  for (let c = 3; c <= 26; c++) sh.setColumnWidth(c, 105);
  sh.setTabColor("#9a9a9a");
}

function hojaReporte_(ss) {
  const sh = ss.getSheetByName("Reporte");
  base_(sh, { sinGrilla: true });
  sh.setColumnWidth(1, 24);
  titulo_(sh, "B2", "Reporte", "Ingresos y egresos: por mes (arriba) y por día del mes elegido en Inicio (abajo).");
  sh.getRange("B5").setValue("Por mes").setFontWeight("bold").setFontSize(12);
  sh.getRange("B6").setFormula(
    '=IFERROR(QUERY(Movimientos!A1:R;"select O, sum(P) where C = \'Gasto\' or C = \'Ingreso\' group by O pivot C order by O desc label O \'Mes\'";1);"")');
  sh.getRange("E6").setValue("Resultado").setFontWeight("bold").setBackground(TEMA.sutil);
  sh.getRange("E7").setFormula('=ARRAYFORMULA(IF(B7:B30="";;D7:D30-C7:C30))');
  sh.getRange("C7:E30").setNumberFormat(FMT_NUM);
  sh.getRange("B6:E6").setBackground(TEMA.sutil).setFontWeight("bold");
  const r = SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(TEMA.err)
    .setRanges([sh.getRange("E7:E30")]).build();
  sh.setConditionalFormatRules([r]);
  sh.getRange("G5").setValue("Por día").setFontWeight("bold").setFontSize(12);
  sh.getRange("G6").setFormula(
    '=IFERROR(QUERY(Movimientos!A1:R;"select B, sum(P) where (C = \'Gasto\' or C = \'Ingreso\') and O = \'"&Inicio!C5&"\' group by B pivot C, M label B \'Fecha\'";1);"Sin movimientos este mes")');
  sh.getRange("G7:G45").setNumberFormat("ddd dd/mm");
  sh.getRange("H7:M45").setNumberFormat(FMT_NUM);
  sh.getRange("G6:M6").setBackground(TEMA.sutil).setFontWeight("bold").setWrap(true);
  [2, 3, 4, 5].forEach(c => sh.setColumnWidth(c, 115));
  sh.setColumnWidth(6, 24);
  for (let c = 7; c <= 13; c++) sh.setColumnWidth(c, 115);
  // gráfico: ingresos vs gastos por mes
  const ch = sh.newChart().asColumnChart().addRange(sh.getRange("B6:D30"))
    .setNumHeaders(1).setOption("title", "Ingresos y gastos por mes").setOption("legend", { position: "bottom" })
    .setOption("colors", [TEMA.cat["Alimentación"], TEMA.ok]).setOption("fontName", TEMA.fuente)
    .setPosition(33, 2, 0, 0).setOption("width", 640).setOption("height", 300).build();
  sh.insertChart(ch);
  sh.setTabColor("#9a9a9a");
}

function hojaInicio_(ss) {
  const sh = ss.getSheetByName("Inicio");
  base_(sh, { sinGrilla: true });
  sh.setColumnWidth(1, 24);
  titulo_(sh, "B2", "Finanzas de la casa", "Elegí el mes. Todo lo demás se calcula solo desde Movimientos y Presupuesto.");
  sh.getRange("B5").setValue("Mes").setFontColor(TEMA.tinta2);
  const mes = sh.getRange("C5");
  mes.setValue(Utilities.formatDate(new Date(), "America/La_Paz", "yyyy-MM")).setFontWeight("bold").setFontSize(12)
    .setBackground("#fffbeb").setHorizontalAlignment("left").setNumberFormat("@");
  lista_(mes, ss.getSheetByName("Listas").getRange("J2:J"), false);
  // Ayudantes ocultos: año y mes
  sh.getRange("Z1").setFormula("=VALUE(LEFT(C5;4))"); sh.getRange("Z2").setFormula("=VALUE(RIGHT(C5;2))");
  const G = 'SUMIFS(Movimientos!P:P;Movimientos!O:O;$C$5;Movimientos!C:C;"Gasto")';
  const I = 'SUMIFS(Movimientos!P:P;Movimientos!O:O;$C$5;Movimientos!C:C;"Ingreso")';
  const P = 'SUMPRODUCT((Presupuesto!A2:A=$Z$1)*(Presupuesto!B2:B="Mensual")*INDEX(Presupuesto!E2:P;0;$Z$2))';
  tarjeta_(sh, 7, 2, "Gastado", "=" + G, FMT_BS, `=IF(${P}=0;"Sin presupuesto cargado";TEXT(${G}/${P};"0%")&" del presupuesto mensual")`);
  tarjeta_(sh, 7, 4, "Presupuesto mensual", "=" + P, FMT_BS, `=IF(${P}-${G}>=0;"Quedan Bs "&TEXT(${P}-${G};"#,##0");"Se pasó por Bs "&TEXT(${G}-${P};"#,##0"))`);
  tarjeta_(sh, 7, 6, "Ingresos", "=" + I, FMT_BS);
  tarjeta_(sh, 7, 8, "Resultado del mes", `=${I}-${G}`, FMT_BS, '=IF(H8<0;"Se gastó más de lo que entró";"Entró más de lo que se gastó")');
  tarjeta_(sh, 11, 2, "Ahorro real", "=Saldos!F10", FMT_USD, '="Sin contar el diezmo"');
  tarjeta_(sh, 11, 4, "Dólar paralelo", "=Saldos!F6", "0.00");
  tarjeta_(sh, 11, 6, "Por revisar", '=COUNTIFS(Movimientos!I:I;"<>";Movimientos!A:A;"<>")-1', "0",
    '="movimientos marcados en Movimientos"');
  const rr = [
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(TEMA.err).setRanges([sh.getRange("H8")]).build(),
  ];
  [2, 3, 4, 5, 6, 7, 8, 9].forEach(c => sh.setColumnWidth(c, c % 2 ? 24 : 190));
  // Presupuesto vs real por línea
  sh.getRange("B15").setValue("Presupuesto contra real").setFontWeight("bold").setFontSize(12);
  encabezado_(sh, 16, 2, ["Categoría", "", "Línea", "", "Presupuesto", "", "Real", "", "Queda", "Uso"]);
  sh.getRange("B17").setFormula(
    '=ARRAYFORMULA(LET(tip;Listas!C2:C;lin;FILTER(Listas!B2:B;tip="Gasto");cat;FILTER(Listas!A2:A;tip="Gasto");' +
    'pres;MAP(lin;LAMBDA(l;SUMPRODUCT((Presupuesto!A2:A=$Z$1)*(Presupuesto!D2:D=l)*INDEX(Presupuesto!E2:P;0;$Z$2))));' +
    'real;MAP(lin;LAMBDA(l;SUMIFS(Movimientos!P:P;Movimientos!D:D;l;Movimientos!O:O;$C$5;Movimientos!C:C;"Gasto")));' +
    'v;(pres>0)+(real>0);vacio;MAP(lin;LAMBDA(x;""));' +
    'IFERROR(FILTER(HSTACK(cat;vacio;lin;vacio;pres;vacio;real;vacio;pres-real;IF(pres>0;real/pres;""));v);"Sin gastos ni presupuesto este mes")))');
  sh.getRange("F17:J120").setNumberFormat(FMT_NUM);
  sh.getRange("K17:K120").setNumberFormat("0%");
  sh.setColumnWidth(10, 190); sh.setColumnWidth(11, 80);
  const uso = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($K17);$K17>1)').setFontColor(TEMA.err).setBold(true)
      .setRanges([sh.getRange("J17:K120")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($K17);$K17>0.85;$K17<=1)').setFontColor(TEMA.pend)
      .setRanges([sh.getRange("K17:K120")]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($H17>0;$F17=0)').setFontColor(TEMA.pend)
      .setRanges([sh.getRange("F17:F120")]).build(),
  ];
  // Color de la categoría en la primera columna
  Object.keys(TEMA.cat).forEach(c => uso.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(c)
    .setFontColor(TEMA.cat[c]).setBold(true).setRanges([sh.getRange("B17:B120")]).build()));
  sh.setConditionalFormatRules(rr.concat(uso));
  // Gráfico: gasto por categoría del mes (ayudante en Z)
  sh.getRange("AB1").setValue("Categoría"); sh.getRange("AC1").setValue("Real");
  sh.getRange("AB2").setFormula(
    '=IFERROR(QUERY(Movimientos!A1:R;"select L, sum(P) where C = \'Gasto\' and O = \'"&C5&"\' group by L order by sum(P) desc label L \'\', sum(P) \'\'";0);"")');
  const ch = sh.newChart().asBarChart().addRange(sh.getRange("AB1:AC14")).setNumHeaders(1)
    .setOption("title", "Gasto del mes por categoría").setOption("legend", { position: "none" })
    .setOption("colors", [TEMA.tinta]).setOption("fontName", TEMA.fuente)
    .setPosition(4, 12, 0, 0).setOption("width", 460).setOption("height", 320).build();
  sh.insertChart(ch);
  sh.hideColumns(26, 4);
  sh.setTabColor(TEMA.tinta);
}

// Escribe valores en un rango exacto. params: {hoja, fila, columna, valores}
planillaOps_.escribir = function (ss, params) {
  const sh = ss.getSheetByName(params.hoja);
  const v = params.valores.map(f => f.map(x => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) ? fecha_(x) : x));
  const falta = params.fila + v.length - 1 - sh.getMaxRows();
  if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta + 500);
  sh.getRange(params.fila, params.columna, v.length, v[0].length).setValues(v);
  return { success: true, filas: v.length };
};

// Revisión: celdas con error en cada hoja + valores visibles de rangos pedidos. params: {rangos: ["Inicio!B5:K30"]}
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

// Evalúa fórmulas sueltas en una hoja temporal (para depurar). params: {formulas: [...]}
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
