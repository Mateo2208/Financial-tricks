# Financial Tricks (QuickCash)

App web para registrar gastos diarios en una hoja de Google Sheets.

- **Front** (`index.html`, `script.js`, `styles.css`): GitHub Pages, `https://mateo2208.github.io/Financial-tricks/`. Se publica solo al hacer push a `main`.
- **API** (`app.py`): proxy Flask en `https://sheet.matsoto.dev` que reenvía cada registro al Apps Script de la hoja.
- **Apps Script** (`apps-script/Code.gs`): escribe la fila en la hoja `GASTOS DIARIOS`. Vive en Google (Extensiones → Apps Script); el archivo del repo es la copia de referencia.

## Configuración de la API

La URL del Apps Script **no va en el código** (el repo es público y con ella cualquiera escribe en la hoja).
Se lee de la variable de entorno `GS_URL` o del archivo `.gs_url` junto a `app.py` (ignorado por git):

```bash
echo 'https://script.google.com/macros/s/.../exec' > .gs_url
```

Local:

```bash
pip install -r requirements.txt
python app.py            # http://localhost:5000
```

Producción (VPS): servicio systemd `financialtricks`, gunicorn en `127.0.0.1:5001` detrás de nginx.
`gunicorn.conf.py` sube el timeout a 90 s: Apps Script tarda 10-30 s por fila y el default de 30 s
mataba al worker con la fila ya escrita. Para aplicar cambios de código: `kill -HUP <PID del master>`
o `sudo systemctl restart financialtricks`. Cada llamada a Google queda en
`journalctl -u financialtricks` con prefijo `[gs]` (duración y respuesta).

## Endpoints

### POST /proxy/gsheet

Un registro. Payload:

```json
{ "fecha": "25/09/2026", "autor": "EVER", "glosa": "Almuerzo", "comida_efectivo": 50 }
```

El campo del monto es `<categoría>_<método>`: `comida`, `movilidad`, `varios`, `servicios` × `tarjeta`, `efectivo`.

| Caso | HTTP | Cuerpo |
|---|---|---|
| Guardado | 200 | `{"status": "success", "success": true, "row": 123}` |
| La hoja lo rechazó (p. ej. fecha que no está en la columna B) | 422 | `{"status": "error", "message": "Fecha no encontrada en columna B."}` |
| Google no respondió en 55 s (puede haberse guardado igual) | 504 | `{"status": "error", "message": "..."}` |
| Error de Google / de conexión | 502 | `{"status": "error", "message": "..."}` |
| Sin datos | 400 | `{"status": "error", "message": "No data provided"}` |

Ojo: el Apps Script responde siempre HTTP 200, también cuando falla (`{"error": "..."}`). La API lo traduce a los códigos de arriba.

### POST /proxy/gsheet/batch

Array de hasta 50 registros, enviados uno tras otro. Responde 200 o 207 con `results`, `errors`, `successful`, `failed`.
El front ya no lo usa: manda la cola de a un registro para no pasar el timeout de nginx (60 s) y
para sacar de la cola cada registro confirmado (así un reintento no duplica filas).

### GET /health

`{"status": "healthy", "message": "Financial Tricks API is running"}`
