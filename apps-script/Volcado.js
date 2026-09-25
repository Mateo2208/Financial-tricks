// SOLO PRUEBAS (no se publica en prod: ver .claspignore.prod).
// Lectura completa de una planilla para analizarla: valores visibles, fórmulas y
// celdas combinadas de cada hoja. No escribe nada.
const PLANILLAS_LEGIBLES = {
  actual: "1stCfzaenBh6S34sAEbnvOOT8R7sLOPID-1Y3ZpPa5ws",
  gestion2025: "1sQlyhP-EYydcT60QMIEgT6Rqz-4QFqT6yS9-59xKABw",
};

function volcado_(params) {
  const id = PLANILLAS_LEGIBLES[params.planilla];
  if (!id) return json_({ error: "planilla desconocida" });
  const ss = SpreadsheetApp.openById(id);
  const hojas = ss.getSheets().map(sh => {
    const rango = sh.getDataRange();
    const formulas = rango.getFormulas();
    const f = {};
    formulas.forEach((fila, i) => fila.forEach((x, j) => { if (x) f[i + "," + j] = x; }));
    return {
      nombre: sh.getName(),
      oculta: sh.isSheetHidden(),
      filas: rango.getNumRows(),
      columnas: rango.getNumColumns(),
      valores: rango.getDisplayValues(),
      formulas: f,
      combinadas: rango.getMergedRanges().map(m => m.getA1Notation()),
      notas: rango.getNotes().flatMap((fila, i) => fila.map((n, j) => n ? { celda: i + "," + j, nota: n } : null)).filter(Boolean),
    };
  });
  return json_({ success: true, nombre: ss.getName(), zona: ss.getSpreadsheetTimeZone(), hojas: hojas });
}
