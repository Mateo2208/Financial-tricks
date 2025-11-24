# Financial Tricks - API Backend

## 📋 Descripción
API Flask que funciona como proxy para enviar datos a Google Sheets Apps Script desde la aplicación web Financial Tricks.

## 🚀 Inicio Rápido

### 1. Instalar dependencias
```bash
pip install -r requirements.txt
```

### 2. Ejecutar servidor
```bash
python app.py
```

El servidor estará disponible en `http://localhost:5000`

## 📡 Endpoints Disponibles

### POST /proxy/gsheet
Proxy que reenvía datos a Google Sheets Apps Script.

**Ejemplo de payload:**
```json
{
  "fecha": "23/11/2025",
  "autor": "Mateo",
  "glosa": "Almuerzo",
  "comida_efectivo": 50
}
```

**Respuesta exitosa:**
```json
{
  "status": "success",
  "message": "Data saved to Google Sheets"
}
```

### GET /health
Verifica el estado del servidor.

**Respuesta:**
```json
{
  "status": "healthy",
  "message": "Financial Tricks API is running"
}
```

### GET /
Muestra información sobre los endpoints disponibles.

## 🔧 Configuración

El servidor está configurado para:
- **Host:** `0.0.0.0` (acepta conexiones externas)
- **Puerto:** `5000`
- **CORS:** Habilitado para todas las peticiones `/proxy/*`
- **Debug:** Activado (solo para desarrollo)

## 🛡️ Características

✅ Manejo de errores completo  
✅ CORS configurado correctamente  
✅ Timeout de 30 segundos para peticiones a Google Sheets  
✅ Validación de datos de entrada  
✅ Health check endpoint  

## 📝 Notas

- El servidor debe estar corriendo para que la aplicación web (`index.html`) funcione correctamente
- Asegúrate de que el archivo `script.js` esté configurado para apuntar a `http://localhost:5000/proxy/gsheet`
- Para producción, considera usar un servidor WSGI como Gunicorn o uWSGI

## 🔗 Google Apps Script URL
El proxy reenvía las peticiones a:
```
https://script.google.com/macros/s/AKfycbzwSeHcsMsqZqt6qcCFnWaQSHHnnh5-RWupo1IPRdpElM4vw8yK8isNDDBQl8NqS3Po/exec
```

## 🐛 Troubleshooting

### Error de CORS
Si ves errores de CORS en la consola del navegador, asegúrate de que el servidor Flask esté corriendo.

### Timeout
Si las peticiones tardan mucho, puede ser que Google Sheets esté ocupado. El timeout está configurado a 30 segundos.

### Puerto ocupado
Si el puerto 5000 está en uso, puedes cambiarlo en `app.py` modificando el parámetro `port`.
