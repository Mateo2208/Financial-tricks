# Planilla nueva: diseño

Reemplazo de la planilla de gestión anual por una sola planilla continua (no una por año), que
sigue siendo una planilla editable a mano, con QuickCash sincronizado con todas sus hojas.
Los datos y el contexto familiar no van en este repo (es público): viven en `privado/`.

## Principios

1. **Una sola fuente de verdad:** la hoja `Movimientos` (una fila por movimiento). Todo lo demás
   son vistas calculadas con fórmulas que no se rompen al agregar filas (rangos de columna
   completa, `SUMIFS`/`QUERY`, sin insertar filas ni combinar celdas en los datos).
2. **Sigue siendo de ellos:** se puede escribir a mano en cualquier tabla, filtrar, y crear hojas
   propias. Listas desplegables en vez de texto libre donde importa (cuenta, línea, persona).
3. **La app escribe al final de la tabla** (append): rápido, sin bloqueos ni celdas combinadas.
4. **Cuenta exacta en cada movimiento:** los saldos se calculan solos; las fotos de saldos
   quedan como control y muestran la diferencia.
5. **Línea del presupuesto automática** desde el detalle, con un diccionario editable (`Reglas`).
6. **Tipo de cambio automático** desde la API de Dólar Blue Bolivia, con opción de fijarlo a mano.

## Hojas

| Hoja | Qué tiene | Quién escribe |
|---|---|---|
| **Inicio** | El mes elegido: presupuesto vs real por línea, ingresos vs egresos, saldos, ahorro. | fórmulas |
| **Movimientos** | Fecha, tipo (Gasto / Ingreso / Transferencia / Ajuste), categoría, línea, monto, moneda, cuenta, persona, detalle, origen, id. | app y a mano |
| **Diario** | La vista por día como la matriz de siempre (categoría × efectivo/banco), generada. | fórmulas |
| **Reporte** | Ingresos y egresos por día y medio, saldo de efectivo de la casa (reemplaza REPORTE DE EGRESOS). | fórmulas |
| **Presupuesto** | Líneas × meses (mensual y anual), con real y diferencia al lado. | a mano |
| **Saldos** | Fotos de saldos por fecha y cuenta; saldo calculado; diferencia; total en $; diezmo; ahorro real. | app y a mano |
| **Cuentas** | Cuentas, dueño, moneda, saldo inicial, cuenta por defecto por persona y medio. | a mano |
| **Reglas** | palabra → línea. | a mano (y la app aprende) |
| **Listas** | Categorías y líneas, personas, tipos. | a mano |
| **TC** | Tipo de cambio por fecha (automático + manual). | script |

## Tipos de movimiento

- **Gasto** e **Ingreso**: lo de siempre.
- **Transferencia**: entre cuentas propias (dos filas enlazadas, no cuenta como gasto).
- **Ajuste**: diferencia entre la foto de saldos y el saldo calculado (lo "no registrado").
- **Egreso sin detalle**: importado del reporte viejo cuando no estaba en el libro diario.

## Importación

2025 y 2026 desde las planillas viejas (script en `privado/extraer.py`): gastos del libro diario,
ingresos y egresos sin detalle del reporte, fotos de saldos con su TC, presupuestos. Lo que no se
puede clasificar queda marcado para revisar.
