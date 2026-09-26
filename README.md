# Financial Tricks · QuickCash

Registro de los gastos e ingresos de la casa en una planilla de Google Sheets, con una app web
para cargarlos rápido desde el celular.

La planilla es la fuente de verdad y sigue siendo **una planilla que se usa y edita a mano**:
la app solo escribe en ella y la lee. Los datos y el contexto familiar no van en este repo
(es público): viven en `privado/`, fuera de git.

## Qué hay

| | Rama | Dónde corre | Estado |
|---|---|---|---|
| **QuickCash** (app nueva) | `quickcash-nuevo` | `https://financial.matsoto.dev` (VPS2, servicio `quickcash`, puerto 5002) | en prueba con la planilla nueva |
| **Planilla "GESTIÓN <año>"** | `quickcash-nuevo` (`apps-script/Construir.js`) | Google Sheets | en prueba; se genera con un script |
| App vieja | `main` | GitHub Pages → `sheet.matsoto.dev` (servicio `financialtricks`, puerto 5001) | **en uso**, escribe en la planilla original |

Mientras la versión nueva está en prueba, la vieja y la planilla original siguen funcionando y no
se tocan. El cambio definitivo está en [`docs/MIGRACION.md`](docs/MIGRACION.md).

## La planilla

Un archivo por gestión con las hojas de siempre, mejoradas por dentro
(detalle en [`docs/PLANILLA.md`](docs/PLANILLA.md)):

- **RESUMEN**: el mes elegido (gastado, presupuesto, ingresos, resultado), proyección a fin de mes,
  categorías, ahorro real y "¿cuadran los saldos?".
- **PRESUPUESTO MENSUAL**: la tabla de presupuesto y, debajo, lo gastado de verdad.
- **GASTOS DIARIOS**: categorías en columnas, una fila por gasto, un bloque plegable por mes.
- **REPORTE DE EGRESOS**: una fila por día; ingresos a mano o desde la app, egresos automáticos.
- **SALDOS**: una columna por revisión de cuentas, con dólar oficial y paralelo.
- **CONFIG** (oculta): líneas del presupuesto, reglas, cuentas y registro de la app.

## QuickCash

- **Registrar** un gasto o ingreso: el monto, el detalle ("hipermaxi") y la línea del presupuesto se
  elige sola desde un diccionario que vive en la planilla (y aprende cuando se corrige). La cuenta
  se recuerda por persona y medio de pago.
- **Resumen** del mes: presupuesto contra real por categoría y línea, proyección, movimientos.
- **Saldos**: ahorro real en dólares, cuentas, revisión de saldos (agrega una columna en SALDOS) y
  conciliación entre revisiones.
- Responde al instante: las escrituras entran a una cola persistente (SQLite) y un proceso las
  lleva a la planilla por detrás, con id idempotente (reintentar nunca duplica).
- Funciona sin señal (service worker): lo registrado se envía solo al volver la conexión.
- Clave de la casa (una por familia), sesión de un año por celular. Diseño en blanco y negro.

### Piezas

| Archivo | Qué hace |
|---|---|
| `app.py` | Flask: sesión, API (`/api/registro`, `/api/resumen`, `/api/saldos`, `/api/catalogo`, `/api/regla`), front estático |
| `cola.py` | cola persistente de escrituras + caché compartida de la lectura de la planilla |
| `planilla.py` | cálculos del lado del servidor: resumen, proyección, saldos, conciliación (los mismos que las fórmulas de la hoja) |
| `web/` | front (HTML/CSS/JS sin dependencias), service worker, íconos |
| `apps-script/` | motor en Google Apps Script (sincronizado con `clasp`): construye la planilla y atiende lecturas y escrituras |
| `gunicorn.conf.py` | timeouts (Google tarda 3-30 s) e hilos |
| `deploy/instalar-financial.sh` | instalación única en el VPS: servicio systemd, nginx y SSL |

### Configuración (VPS: `~/quickcash/config.env`, fuera de git)

```
GS_URL=https://script.google.com/macros/s/<implementación>/exec
GS_TOKEN=<secreto compartido con apps-script/.secreto.<destino>.js>
CLAVE_HASH=<werkzeug generate_password_hash de la clave de la casa>
SECRET_KEY=<aleatorio>
```

### Desplegar

```bash
git push                                   # rama quickcash-nuevo
ssh personal 'cd ~/quickcash && git pull && kill -HUP $(systemctl show -p MainPID --value quickcash)'
```

Cambios del front: subir `VERSION` en `web/sw.js` y el `?v=` de `index.html` para que los celulares
tomen la versión nueva.

Apps Script (motor):

```bash
cd apps-script && ./deploy.sh pruebas "mensaje"    # o prod; misma URL /exec siempre
```

`deploy.sh` exige un destino explícito (no hay `.clasp.json` por defecto): así nunca se publica en
producción por accidente. `Volcado.js` (lectura completa de planillas, para análisis) no se publica en prod.

### Probar en local

```bash
GS_URL=... GS_TOKEN=... CLAVE_HASH=... SECRET_KEY=dev \
  uv run --with flask==3.0.0 --with requests==2.31.0 flask --app app run --port 5055
```

(En macOS el puerto 5000 lo usa AirPlay.) Probar escrituras solo contra una planilla de prueba.

## Cosas que conviene saber

- Google Apps Script es lento e inestable: 3 a 30 s por operación y a veces responde 404 **habiendo
  escrito**. Por eso toda escritura lleva id y la cola reintenta sin duplicar.
- Con configuración regional de Bolivia las fórmulas usan `;`, y Google convierte "AGOSTO 2026" en una
  fecha: los títulos de mes son "GASTOS DE AGOSTO 2026".
- `SUMIFS` con una lista de criterios traída de otra hoja devuelve 0: se usa `SUMPRODUCT(ISNUMBER(MATCH(...)))`.
- Borrar hojas grandes a veces falla ("falló al acceder al documento"): el importador reintenta.
- Tipo de cambio: las cuentas de banco se pasan a dólares con el oficial (BCB) y el efectivo y Binance
  con el paralelo; ambos salen de la API de Dólar Blue Bolivia.
