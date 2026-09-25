// Motor de la planilla nueva (vive en el proyecto de pruebas mientras se construye).
// La planilla se abre por id (propiedad PLANILLA_NUEVA). Ver docs/PLANILLA-NUEVA.md.

function planillaId_() {
  return PropertiesService.getScriptProperties().getProperty("PLANILLA_NUEVA");
}

function planilla_(params) {
  try {
    return planillaSinCapturar_(params);
  } catch (e) {
    return json_({ error: "Falló " + params.op + ": " + (e && e.message) + " | " + String(e && e.stack || "").split("\n").slice(0, 3).join(" < ") });
  }
}

function planillaSinCapturar_(params) {
  const op = params.op;
  if (op === "crear") {
    if (planillaId_() && !params.forzar) return json_({ error: "Ya existe: " + planillaId_() });
    const ss = SpreadsheetApp.create(params.titulo || "Finanzas de la casa");
    ss.setSpreadsheetLocale("es_BO");
    ss.setSpreadsheetTimeZone("America/La_Paz");
    PropertiesService.getScriptProperties().setProperty("PLANILLA_NUEVA", ss.getId());
    return json_({ success: true, id: ss.getId(), url: ss.getUrl() });
  }
  const ss = SpreadsheetApp.openById(planillaId_());
  if (op === "prueba_formula") {
    const sh = ss.getSheets()[0];
    sh.getRange("A1:A2").setValues([[1.5], [2]]);
    sh.getRange("B1").setFormula(params.formula);
    SpreadsheetApp.flush();
    return json_({ success: true, formula: sh.getRange("B1").getFormula(), valor: sh.getRange("B1").getDisplayValue() });
  }
  if (typeof planillaOps_ === "object" && planillaOps_[op]) return json_(planillaOps_[op](ss, params));
  return json_({ error: "op desconocida: " + op });
}


// ===== API de QuickCash sobre "GESTIÓN <año>" =====

const TZ_ = "America/La_Paz";
const iso_ = d => Utilities.formatDate(d, TZ_, "yyyy-MM-dd");

function tabla_(sh, fila, col, filas, cols) {
  return filas > 0 ? sh.getRange(fila, col, filas, cols).getValues() : [];
}

// Todo lo que la app necesita, en una lectura
planillaOps_.leer = function (ss) {
  const G = ss.getSheetByName(H_.gastos), R = ss.getSheetByName(H_.reporte);
  const S = ss.getSheetByName(H_.saldos), C = ss.getSheetByName(H_.config), P = ss.getSheetByName(H_.presupuesto);
  const gastos = [];
  tabla_(G, 6, 2, G.getLastRow() - 5, 15).forEach((f, i) => {
    if (f[0] instanceof Date) gastos.push([6 + i, iso_(f[0]), f[1], f.slice(2, 10).map(v => Number(v) || 0), f[10], f[12], f[13], f[14]]);
  });
  const ingresos = [];
  tabla_(R, 5, 2, R.getLastRow() - 4, 8).forEach(f => {
    if (f[0] instanceof Date && (Number(f[2]) || Number(f[3]))) ingresos.push([iso_(f[0]), f[1], Number(f[2]) || 0, Number(f[3]) || 0, f[7]]);
  });
  const mapa = tabla_(C, 2, 27, 200, 4).filter(f => f[0]);
  const presupuesto = mapa.map(([l, tabla, filaP]) => [l, tabla, P.getRange(filaP, 4, 1, 12).getValues()[0].map(v => Number(v) || 0)]);
  const F = SALDOS_FILAS_;
  const nCols = S.getLastColumn() - 5;
  const etiquetas = S.getRange(1, 2, F.ahorroPeriodo, 1).getValues().map(f => f[0]);
  const usa = S.getRange(1, 5, F.ahorroPeriodo, 1).getValues().map(f => f[0]);
  const saldos = [];
  if (nCols > 0) {
    const m = S.getRange(1, 6, F.ahorroPeriodo, nCols).getValues();
    for (let j = 0; j < nCols; j++) {
      if (!(m[F.fecha - 1][j] instanceof Date)) continue;
      const valores = {};
      [[F.bs0, F.bsN], [F.usd0, F.usdN]].forEach(([a, b]) => { for (let f = a; f <= b; f++) if (etiquetas[f - 1]) valores[etiquetas[f - 1]] = Number(m[f - 1][j]) || 0; });
      saldos.push({ fecha: iso_(m[F.fecha - 1][j]), valores, pendientes: Number(m[F.pendientes - 1][j]) || 0,
        tc_oficial: Number(m[F.tcOficial - 1][j]) || 0, tc_paralelo: Number(m[F.tcParalelo - 1][j]) || 0,
        diezmo_bs: Number(m[F.diezmoBs - 1][j]) || 0, diezmo_usd: Number(m[F.diezmoUsd - 1][j]) || 0 });
    }
  }
  const tcUsa = {};
  etiquetas.forEach((e, i) => { if (e && usa[i]) tcUsa[e] = usa[i]; });
  const anio = Number(G.getRange("B2").getDisplayValue().match(/\d{4}/)[0]);
  return {
    success: true, anio, gastos, ingresos, presupuesto, saldos, tc_usa: tcUsa,
    lineas: tabla_(C, 2, 1, 200, 6).filter(f => f[1]),
    reglas: tabla_(C, 2, 8, 1400, 3).filter(f => f[0]),
    cuentas: tabla_(C, 2, 12, 40, 7).filter(f => f[0]),
  };
};

// Registro de lo que escribió la app (CONFIG, columnas T:W): hace idempotentes las escrituras
function yaHecho_(ss, id) {
  const cache = CacheService.getScriptCache();
  const c = cache.get("op_" + id);
  if (c) return c;
  const hit = ss.getSheetByName(H_.config).getRange("T:T").createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? ss.getSheetByName(H_.config).getRange(hit.getRow(), 22).getValue() || "hecho" : null;
}

function anotar_(ss, id, op, donde) {
  const C = ss.getSheetByName(H_.config);
  const col = C.getRange("T1:T").getValues();
  let r = col.findIndex(f => !f[0]); if (r < 0) r = col.length;
  C.getRange(r + 1, 20, 1, 4).setValues([[id, op, donde, new Date()]]);
  CacheService.getScriptCache().put("op_" + id, donde, 21600);
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { error: "La planilla está ocupada. Intenta de nuevo." }; }
  try { return fn(); } finally { lock.releaseLock(); }
}

function anioDe_(ss) { return Number(ss.getSheetByName(H_.gastos).getRange("B2").getDisplayValue().match(/\d{4}/)[0]); }

// Gasto: params {id, fecha, autor, columna, medio (Banco|Efectivo), monto, glosa, linea, cuenta}
planillaOps_.gasto = function (ss, p) {
  return conLock_(() => {
    const previo = yaHecho_(ss, p.id);
    if (previo) return { success: true, repetido: true, donde: previo };
    if (Number(p.fecha.slice(0, 4)) !== anioDe_(ss)) return { error: "La fecha es de otra gestión (" + p.fecha.slice(0, 4) + ")." };
    const sh = ss.getSheetByName(H_.gastos);
    const m = Number(p.fecha.slice(5, 7));
    const titulo = filaTituloMes_(sh, m);
    const col = sh.getRange(titulo + 1, 2, 400, 1).getValues();
    const fecha = fecha_(p.fecha);
    // antes de la primera fila con fecha posterior; si no hay, antes de la última fila del mes (la vacía)
    let destino = null, ultima = titulo + 1;
    for (let i = 0; i < col.length; i++) {
      const v = col[i][0];
      if (typeof v === "string" && v.indexOf("TOTAL") === 0) { ultima = titulo + i; break; }
      if (v instanceof Date && v > fecha && destino === null) destino = titulo + 1 + i;
    }
    if (destino === null) destino = ultima;
    sh.insertRowBefore(destino);
    const fila = destino, modelo = destino + 1;
    sh.getRange(modelo, 2, 1, 15).copyTo(sh.getRange(fila, 2, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sh.getRange(modelo, 2, 1, 15).copyTo(sh.getRange(fila, 2, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    if (sh.getRowGroupDepth(fila) === 0) sh.getRange(fila, 1).shiftRowGroupDepth(1);
    const montos = ["", "", "", "", "", "", "", ""];
    const i = COLS_GASTO_.indexOf(p.columna);
    montos[(i < 0 ? 2 : i) * 2 + (p.medio === "Efectivo" ? 1 : 0)] = Number(p.monto);
    sh.getRange(fila, 2, 1, 15).setValues([[fecha, p.autor || "", ...montos, p.glosa || "", "", p.linea || "", p.cuenta || "", p.id]]);
    const donde = H_.gastos + "!" + fila;
    anotar_(ss, p.id, "gasto", donde);
    return { success: true, donde };
  });
};

// Ingreso: params {id, fecha, concepto, medio, monto, cuenta} -> se suma en la fila del día del reporte
planillaOps_.ingreso = function (ss, p) {
  return conLock_(() => {
    const previo = yaHecho_(ss, p.id);
    if (previo) return { success: true, repetido: true, donde: previo };
    if (Number(p.fecha.slice(0, 4)) !== anioDe_(ss)) return { error: "La fecha es de otra gestión (" + p.fecha.slice(0, 4) + ")." };
    const sh = ss.getSheetByName(H_.reporte);
    const col = sh.getRange("B1:B" + sh.getLastRow()).getValues();
    const r = col.findIndex(f => f[0] instanceof Date && iso_(f[0]) === p.fecha) + 1;
    if (!r) return { error: "No encontré el día " + p.fecha + " en el reporte." };
    const fila = sh.getRange(r, 3, 1, 8).getValues()[0];  // C:J
    const concepto = fila[0] ? fila[0] + " + " + p.concepto : p.concepto;
    const c = p.medio === "Efectivo" ? 0 : 1;
    const montos = [fila[1], fila[2]];
    montos[c] = (Number(montos[c]) || 0) + Number(p.monto);
    sh.getRange(r, 3, 1, 3).setValues([[concepto, montos[0] || "", montos[1] || ""]]);
    if (!fila[6] && p.cuenta) sh.getRange(r, 9).setValue(p.cuenta);
    sh.getRange(r, 10).setValue(fila[7] ? fila[7] + "," + p.id : p.id);
    const donde = H_.reporte + "!" + r;
    anotar_(ss, p.id, "ingreso", donde);
    return { success: true, donde };
  });
};

// Revisión de saldos: params {id, fecha, valores: {etiqueta: monto}, tc_oficial, tc_paralelo, pendientes, diezmo_bs, diezmo_usd}
planillaOps_.saldos = function (ss, p) {
  return conLock_(() => {
    const previo = yaHecho_(ss, p.id);
    if (previo) return { success: true, repetido: true, donde: previo };
    const sh = ss.getSheetByName(H_.saldos);
    const fechas = sh.getRange(SALDOS_FILAS_.fecha, 6, 1, Math.max(1, sh.getLastColumn() - 5)).getValues()[0];
    let col = 6;
    fechas.forEach((f, j) => { if (f instanceof Date) col = 6 + j + 1; });
    const ultima = fechas.filter(f => f instanceof Date).pop();
    if (ultima && iso_(ultima) === p.fecha) col -= 1;  // misma fecha: se reemplaza esa revisión
    if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 20);
    escribirColumnaSaldos_(sh, col, p);
    sh.setColumnWidth(col, 112);
    const donde = H_.saldos + "!" + columnaLetra_(col);
    anotar_(ss, p.id, "saldos", donde);
    return { success: true, donde };
  });
};

// Regla nueva o corregida: params {palabra, linea, quien}
planillaOps_.regla = function (ss, p) {
  return conLock_(() => {
    const sh = ss.getSheetByName(H_.config);
    const col = sh.getRange("H2:H1500").getValues();
    const i = col.findIndex(f => String(f[0]) === p.palabra);
    const libre = col.findIndex(f => !f[0]);
    const r = 2 + (i >= 0 ? i : libre);
    sh.getRange(r, 8, 1, 3).setValues([[p.palabra, p.linea, p.quien || "QuickCash"]]);
    return { success: true };
  });
};
