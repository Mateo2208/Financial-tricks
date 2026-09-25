// Apps Script de la hoja (Extensiones → Apps Script). Misma lógica que la versión
// original, con dos cambios:
//  - LockService: si dos personas registran a la vez, la segunda espera a que termine
//    la primera en vez de insertar y combinar celdas sobre la misma fila.
//  - C:L se escribe en una sola llamada (setValues) en vez de 10 setValue: menos
//    idas y vueltas a la hoja, respuesta más rápida.
//
// Para publicarlo sin cambiar la URL: Implementar → Administrar implementaciones →
// lápiz de la implementación activa → Versión: "Nueva versión" → Implementar.

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return json_({ error: "La hoja está ocupada con otro registro. Intenta de nuevo." });
  }

  try {
    const params = JSON.parse(e.postData.contents || "{}");

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

function testDoPost() {
  var e = {
    postData: {
      contents: JSON.stringify({
        fecha: "01/01/2026",
        autor: "EVER",
        comida_tarjeta: 170,
        comida_efectivo: 80,
        movilidad_tarjeta: 50,
        movilidad_efectivo: 30,
        varios_tarjeta: 200,
        varios_efectivo: 100,
        servicios_tarjeta: 300,
        servicios_efectivo: 150,
        glosa: "Compra adicional para evento"
      })
    }
  };
  var respuesta = doPost(e);
  Logger.log(respuesta.getContent());
}
