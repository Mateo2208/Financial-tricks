// Apps Script de la hoja (Extensiones → Apps Script). Sincronizado con clasp:
// se edita acá y se publica con ./deploy.sh (misma URL /exec).
//
//  - Toda petición trae `token`, que tiene que coincidir con TOKEN (Secreto.js, fuera de
//    git). Sin él la URL /exec sola no alcanza para leer ni escribir la hoja.
//  - accion "resumen": devuelve las filas de un mes de GASTOS DIARIOS (solo lectura).
//  - Sin accion: registra un gasto (lógica original de la hoja).
//  - id_registro: el servidor reintenta tras un timeout; CacheService recuerda los ids
//    escritos (6 h) para que el reintento no duplique la fila.
//  - LockService: si dos personas registran a la vez, la segunda espera a que termine
//    la primera en vez de insertar y combinar celdas sobre la misma fila.
//  - C:L se escribe en una sola llamada (setValues): respuesta más rápida.

const HOJA_GASTOS = "GASTOS DIARIOS";
const FIRST_DATA_ROW = 5;      // primera fila con fechas

function doPost(e) {
  let params;
  try {
    params = JSON.parse(e.postData.contents || "{}");
  } catch (err) {
    return json_({ error: "Petición inválida." });
  }
  if (typeof TOKEN === "undefined" || !TOKEN || params.token !== TOKEN) {
    return json_({ error: "No autorizado." });
  }
  if (params.accion === "resumen") {
    return resumen_(params);
  }
  if (params.accion === "planilla" && typeof planilla_ === "function") {
    return planilla_(params);  // motor de la planilla nueva (Planilla.js)
  }
  if (params.accion === "volcado" && typeof volcado_ === "function") {
    return volcado_(params);  // solo existe en pruebas (Volcado.js)
  }
  return registrar_(params);
}

// Filas de un mes: [{fila, fecha "dd/MM/yyyy", autor, montos[8] (D:K), glosa}]
function resumen_(params) {
  try {
    const mes = String(params.mes || ""); // "MM/yyyy"
    if (!/^\d{2}\/\d{4}$/.test(mes)) return json_({ error: "Falta params.mes (MM/yyyy)." });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(HOJA_GASTOS);
    if (!sheet) return json_({ error: "La hoja '" + HOJA_GASTOS + "' no existe." });

    const tz = ss.getSpreadsheetTimeZone();
    const lastRow = sheet.getLastRow();
    if (lastRow < FIRST_DATA_ROW) return json_({ success: true, mes: mes, filas: [] });

    // B:L de una vez. En los bloques combinados la fecha solo está en la primera fila.
    const vals = sheet.getRange(FIRST_DATA_ROW, 2, lastRow - FIRST_DATA_ROW + 1, 11).getValues();
    const filas = [];
    let fecha = null;
    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      if (r[0] instanceof Date) {
        fecha = Utilities.formatDate(r[0], tz, "dd/MM/yyyy");
      } else if (typeof r[0] === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(r[0].trim())) {
        fecha = r[0].trim();
      }
      if (!fecha || fecha.slice(3) !== mes) continue;
      const montos = r.slice(2, 10).map(v => (typeof v === "number" ? v : parseFloat(v) || 0));
      if (!r[1] && montos.every(v => !v)) continue; // día sin gastos
      filas.push({ fila: FIRST_DATA_ROW + i, fecha: fecha, autor: String(r[1] || ""), montos: montos, glosa: String(r[10] || "") });
    }
    return json_({ success: true, mes: mes, filas: filas });
  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  }
}

function registrar_(params) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ error: "La hoja está ocupada con otro registro. Intenta de nuevo." });
  }

  try {
    // Reintento de un registro ya escrito (el servidor no supo la respuesta): no duplicar.
    // Dentro del lock, así dos intentos simultáneos del mismo id no pasan los dos.
    const idRegistro = String(params.id_registro || "");
    const cache = CacheService.getScriptCache();
    if (idRegistro) {
      const previa = cache.get("reg_" + idRegistro);
      if (previa) return json_({ success: true, row: Number(previa), repetido: true });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("GASTOS DIARIOS");
    if (!sheet) {
      return json_({ error: "La hoja 'GASTOS DIARIOS' no existe." });
    }

    // ===== ESTRUCTURA REAL DE TU HOJA =====
    const FIRST_DATA_ROW = 5;      // primera fila con fechas
    const COL_FECHA = 2;           // B
    const COL_AUTOR = 3;           // C  (C:L = autor, 8 montos, glosa)
    const COL_GLOSA = 12;          // L
    const COL_TOTAL = 13;          // M

    const tz = ss.getSpreadsheetTimeZone();
    const fechaBuscada = (params.fecha || "").trim(); // "dd/MM/yyyy"
    if (!fechaBuscada) return json_({ error: "Falta params.fecha (dd/MM/yyyy)." });

    const lastRow = sheet.getLastRow();
    if (lastRow < FIRST_DATA_ROW) return json_({ error: "No hay filas de datos." });

    // Leer todas las fechas desde B5 hasta BlastRow
    const numRows = lastRow - FIRST_DATA_ROW + 1;
    const fechas = sheet.getRange(FIRST_DATA_ROW, COL_FECHA, numRows, 1).getValues();

    // Encontrar la fila BASE (la primera fila donde coincide la fecha)
    let baseRow = null;
    for (let i = 0; i < fechas.length; i++) {
      const v = fechas[i][0];
      if (!v) continue;
      const s = Utilities.formatDate(new Date(v), tz, "dd/MM/yyyy");
      if (s === fechaBuscada) {
        baseRow = FIRST_DATA_ROW + i;
        break;
      }
    }
    if (!baseRow) return json_({ error: "Fecha no encontrada en columna B." });

    // Determinar bloque del día (si B está mergeado o no)
    const baseDateCell = sheet.getRange(baseRow, COL_FECHA);
    let blockStart = baseRow;
    let blockEnd = baseRow;

    const merges = baseDateCell.getMergedRanges();
    if (merges.length) {
      blockStart = merges[0].getRow();
      blockEnd = merges[0].getLastRow();
    }

    // Ver si la fila base ya tiene datos (C:L)
    const baseRowData = sheet
      .getRange(baseRow, COL_AUTOR, 1, (COL_GLOSA - COL_AUTOR + 1))
      .getValues()[0];

    const baseTieneDatos = baseRowData.some(v => v !== "" && v !== null);

    let targetRow = baseRow;

    if (baseTieneDatos) {
      // 1) Desmergear el bloque de B si aplica
      if (merges.length) {
        merges[0].breakApart();
      }

      // 2) Insertar fila al final del bloque
      sheet.insertRowAfter(blockEnd);
      targetRow = blockEnd + 1;

      // 3) Colocar fecha en nueva fila (B)
      sheet.getRange(targetRow, COL_FECHA).setValue(params.fecha);

      // 4) Mergear nuevamente todo el bloque (B)
      sheet.getRange(blockStart, COL_FECHA, targetRow - blockStart + 1, 1).merge();
    }

    // ===== Escribir datos en la fila destino (C:L de una vez) =====
    sheet.getRange(targetRow, COL_AUTOR, 1, COL_GLOSA - COL_AUTOR + 1).setValues([[
      params.autor ?? "",
      params.comida_tarjeta ?? "",
      params.comida_efectivo ?? "",
      params.movilidad_tarjeta ?? "",
      params.movilidad_efectivo ?? "",
      params.varios_tarjeta ?? "",
      params.varios_efectivo ?? "",
      params.servicios_tarjeta ?? "",
      params.servicios_efectivo ?? "",
      params.glosa ?? ""
    ]]);

    // Total (M)
    sheet.getRange(targetRow, COL_TOTAL).setFormula(`=SUM(D${targetRow}:K${targetRow})`);

    SpreadsheetApp.flush();
    if (idRegistro) cache.put("reg_" + idRegistro, String(targetRow), 21600); // 6 h
    return json_({ success: true, row: targetRow });

  } catch (err) {
    return json_({ error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Prueba desde el editor (solo lectura): Ejecutar → testResumen, ver el registro.
function testResumen() {
  const mes = Utilities.formatDate(new Date(), "America/La_Paz", "MM/yyyy");
  const r = doPost({ postData: { contents: JSON.stringify({ token: TOKEN, accion: "resumen", mes: mes }) } });
  Logger.log(r.getContent().slice(0, 2000));
}
