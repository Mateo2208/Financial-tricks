# La planilla "GESTIÓN <año>"

Se genera entera con `apps-script/Construir.js` (op `construir`) y se llena con el importador
privado. Todo lo que se ve se puede rehacer idéntico: nada se arma a mano.

## Principios

1. **Es la planilla de siempre, mejorada por dentro.** Mismas hojas, mismos nombres, mismas líneas
   del presupuesto escritas como las escribe quien la usa. Un intento anterior de 12 hojas "tipo base
   de datos" se descartó: era correcto pero no servía para quien la usa.
2. **Por gestión y por mes.** Un archivo por año; en las hojas diarias, un bloque por mes que se pliega.
3. **Los totales no se rompen.** Todo suma con `SUMIFS` por fecha o por línea sobre columnas enteras:
   se pueden agregar o insertar filas a mano sin arreglar fórmulas.
4. **Se escribe en un solo lugar.** Los egresos del reporte y lo gastado del presupuesto salen solos de
   GASTOS DIARIOS; el RESUMEN sale de las demás hojas. Nunca hay dos totales distintos del mismo mes.
5. **Sin textos que expliquen lo obvio.** Solo títulos y datos.

## Hojas

### RESUMEN
Selector de mes (celda C4). Tarjetas: gastado, presupuesto del mes (mensual + anual), queda,
ingresos, resultado. Proyección a fin de mes. Categorías (presupuesto, gastado, queda, uso con
barra). A la derecha: ahorro real con su evolución, "¿cuadran los saldos?" y mes a mes con gráfico.

- **Proyección** (solo el mes en curso): gastado hasta hoy + el promedio de lo gastado desde mañana a
  fin de mes en los 3 meses anteriores de la gestión, contando solo líneas **mensuales** (un pago
  anual no infla la proyección).
- **¿Cuadran los saldos?**: entre las dos últimas revisiones de SALDOS, el cambio del total en
  bolivianos contra ingresos − gastos anotados en ese período. La diferencia es plata que se movió
  sin anotarse (retiros, transferencias, comisiones, gastos olvidados).

### PRESUPUESTO MENSUAL
Arriba, el presupuesto (líneas × meses): tabla mensual y tabla anual (pagos de una o dos veces al año).
Debajo, las mismas dos tablas con **lo gastado de verdad** (SUMIFS sobre GASTOS DIARIOS por línea y
mes). Rojo cuando una línea tenía presupuesto y se pasó; las líneas sin presupuesto no se pintan.

### GASTOS DIARIOS
Columnas: fecha, autor, cuatro categorías × (tarjeta/QR, efectivo), glosa, total (fórmula única en
M5 que cubre también las filas agregadas a mano), línea del presupuesto, cuenta, id (oculta). Fila 5:
total de la gestión. Por mes: título "GASTOS DE <MES> <AÑO>", filas de gastos agrupadas (plegables,
con una fila vacía al final para escribir a mano) y total del mes.

### REPORTE DE EGRESOS
Por mes: una fila por día con concepto e ingresos (efectivo, banco), egresos del día (automáticos
desde GASTOS DIARIOS), resultado del día y cuenta del ingreso. Varios ingresos del mismo día se suman
en la misma fila ("concepto 1 + concepto 2").

### SALDOS
Cuentas en filas, una columna por revisión (desde F). Columna E: con qué tipo de cambio se pasa cada
cuenta a dólares: **Oficial** (cuentas de banco) o **Paralelo** (efectivo en casa, efectivo en
dólares, Binance). Filas de tipo de cambio oficial y paralelo por revisión, gastos pendientes, diezmo
(Bs y $) y ahorro real (total en dólares menos el diezmo).

### CONFIG (oculta)
Líneas (grupo, línea, columna de GASTOS DIARIOS, tabla mensual/anual, tipo, ¿diezmo?), reglas
(palabra → línea), cuentas (etiqueta en SALDOS, dueño, moneda, medio, tipo de cambio, por defecto
para), registro de escrituras de la app (idempotencia), mapa de filas del presupuesto, listas de apoyo.

## Diseño

Identidad "sobrio azul marino" (solo en la planilla; la app es blanco y negro): marino `#1f2a44`
en títulos y meses, gris azulado en encabezados y totales, un único acento dorado `#c9a227` para lo
elegido (mes del RESUMEN) y el ahorro real, rojo `#b3261e` solo para alertas. Tipografía Inter.
Tokens en `C_` de `Construir.js`.

## Qué hace la app sobre la planilla (`apps-script/Planilla.js`)

| op | Efecto |
|---|---|
| `leer` | todo lo que la app necesita en una lectura (~150 KB) |
| `gasto` | inserta la fila en su mes, en orden de fecha y dentro del grupo plegable |
| `ingreso` | suma el ingreso en la fila del día del reporte |
| `saldos` | agrega (o reemplaza, si es el mismo día) la columna de la revisión |
| `regla` | agrega o corrige una regla palabra → línea |

Todas con lock y con id: si llega dos veces el mismo id, no se repite.
