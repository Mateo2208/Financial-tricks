// Motor de la planilla nueva (vive en el proyecto de pruebas mientras se construye).
// La planilla se abre por id (propiedad PLANILLA_NUEVA). Ver docs/PLANILLA-NUEVA.md.

function planillaId_() {
  return PropertiesService.getScriptProperties().getProperty("PLANILLA_NUEVA");
}

function planilla_(params) {
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

// ===== API de QuickCash sobre la planilla nueva =====

function valoresTabla_(sh, columnas) {
  const n = ultimaFila_(sh);
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, columnas).getValues().map(f => f.map(v =>
    v instanceof Date ? Utilities.formatDate(v, "America/La_Paz", "yyyy-MM-dd") : v));
}

// Todo lo que la app necesita, en una sola lectura.
planillaOps_.leer = function (ss) {
  const hoja = n => ss.getSheetByName(n);
  return {
    success: true,
    movimientos: valoresTabla_(hoja("Movimientos"), 11),   // A:K
    cuentas: valoresTabla_(hoja("Cuentas"), 12),
    listas: valoresTabla_(hoja("Listas"), 4),
    reglas: valoresTabla_(hoja("Reglas"), 3),
    presupuesto: valoresTabla_(hoja("Presupuesto"), 16),
    tc: valoresTabla_(hoja("TC"), 4),
    fotos: valoresTabla_(hoja("Fotos de saldos"), 3),
    diezmo: hoja("Diezmo").getRange("C5:C8").getValues().map(f => f[0] instanceof Date
      ? Utilities.formatDate(f[0], "America/La_Paz", "yyyy-MM-dd") : f[0]),
  };
};

// Escrituras idempotentes: cada una trae un id; si ya se escribió, no se repite.
function yaEscrito_(ss, hojaNombre, id) {
  const cache = CacheService.getScriptCache();
  const previo = cache.get("pl_" + id);
  if (previo) return Number(previo);
  const sh = ss.getSheetByName(hojaNombre);
  const hit = sh.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function conLock_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { error: "La planilla está ocupada. Intenta de nuevo." }; }
  try { return fn(); } finally { lock.releaseLock(); }
}

// params.filas: [[id, fecha, tipo, linea, monto, cuenta, persona, detalle, revisar, origen]]
planillaOps_.registrar = function (ss, params) {
  return conLock_(() => {
    const sh = ss.getSheetByName("Movimientos");
    const nuevas = [], filasEscritas = {};
    params.filas.forEach(f => {
      const fila = yaEscrito_(ss, "Movimientos", f[0]);
      if (fila) filasEscritas[f[0]] = fila; else nuevas.push(f);
    });
    if (nuevas.length) {
      const desde = ultimaFila_(sh) + 1;
      const falta = desde + nuevas.length - 1 - sh.getMaxRows();
      if (falta > 0) sh.insertRowsAfter(sh.getMaxRows(), falta + 500);
      const ahora = new Date();
      sh.getRange(desde, 1, nuevas.length, 11).setValues(nuevas.map(f =>
        [f[0], fecha_(f[1]), f[2], f[3], f[4], f[5], f[6], f[7] || "", f[8] || "", f[9] || "QuickCash", ahora]));
      SpreadsheetApp.flush();
      const cache = CacheService.getScriptCache();
      nuevas.forEach((f, i) => { filasEscritas[f[0]] = desde + i; cache.put("pl_" + f[0], String(desde + i), 21600); });
    }
    return { success: true, filas: filasEscritas };
  });
};

// Foto de saldos: params.id, params.fecha, params.saldos: [[cuenta, monto]], params.nota
planillaOps_.foto = function (ss, params) {
  return conLock_(() => {
    const cache = CacheService.getScriptCache();
    if (cache.get("pl_" + params.id)) return { success: true, repetido: true };
    const sh = ss.getSheetByName("Fotos de saldos");
    const desde = ultimaFila_(sh) + 1;
    const filas = params.saldos.map(([c, m]) => [fecha_(params.fecha), c, m]);
    sh.getRange(desde, 1, filas.length, 3).setValues(filas);
    if (params.nota) sh.getRange(desde, 5, filas.length, 1).setValue(params.nota);
    cache.put("pl_" + params.id, "1", 21600);
    return { success: true, filas: filas.length };
  });
};

// Regla nueva o corregida: params.palabra, params.linea, params.quien
planillaOps_.regla = function (ss, params) {
  return conLock_(() => {
    const sh = ss.getSheetByName("Reglas");
    const hit = sh.getRange("A:A").createTextFinder(params.palabra).matchEntireCell(true).findNext();
    if (hit) sh.getRange(hit.getRow(), 2, 1, 2).setValues([[params.linea, params.quien || "QuickCash"]]);
    else sh.getRange(ultimaFila_(sh) + 1, 1, 1, 3).setValues([[params.palabra, params.linea, params.quien || "QuickCash"]]);
    return { success: true };
  });
};

// Tipo de cambio del día: params.fecha, params.paralelo, params.oficial, params.fuente (no duplica la fecha)
planillaOps_.tc = function (ss, params) {
  return conLock_(() => {
    const sh = ss.getSheetByName("TC");
    const n = ultimaFila_(sh);
    const ultima = n >= 2 ? Utilities.formatDate(sh.getRange(n, 1).getValue(), "America/La_Paz", "yyyy-MM-dd") : "";
    if (ultima === params.fecha) {
      sh.getRange(n, 2, 1, 3).setValues([[params.paralelo, params.oficial || "", params.fuente || ""]]);
    } else {
      sh.getRange(n + 1, 1, 1, 4).setValues([[fecha_(params.fecha), params.paralelo, params.oficial || "", params.fuente || ""]]);
    }
    return { success: true };
  });
};
