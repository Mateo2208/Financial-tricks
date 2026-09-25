import os
import time
from pathlib import Path

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)

# Enable CORS for all routes
CORS(app, resources={
    r"/proxy/*": {
        "origins": "*",
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Accept"]
    }
})


def load_gs_url():
    """
    URL del Apps Script: variable de entorno GS_URL o archivo .gs_url junto a app.py.
    No va en el código porque el repo es público y con ella cualquiera escribe en la hoja.
    """
    url = os.environ.get('GS_URL', '').strip()
    if not url:
        path = Path(__file__).with_name('.gs_url')
        if path.exists():
            url = path.read_text().strip()
    if not url:
        raise RuntimeError('Falta GS_URL (variable de entorno o archivo .gs_url)')
    return url


GS_URL = load_gs_url()

# Apps Script tarda 10-30 s en escribir. nginx corta a los 60 s (proxy_read_timeout por defecto),
# así que respondemos antes para que el front reciba un mensaje y no un 502 de nginx.
# El timeout de gunicorn (gunicorn.conf.py) tiene que ser mayor que este.
GS_TIMEOUT = 55


def log(msg):
    print(f"[gs] {msg}", flush=True)


class SheetError(Exception):
    """Error con mensaje para el usuario y código HTTP."""

    def __init__(self, message, status_code):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def send_to_sheet(entry, tag):
    """
    Envía una fila al Apps Script y devuelve su respuesta si la guardó.
    El Apps Script responde siempre HTTP 200, también cuando falla ({"error": "..."}),
    así que el éxito se decide por el cuerpo, no por el código.
    """
    t0 = time.time()
    try:
        gs_response = requests.post(
            GS_URL,
            json=entry,
            headers={'Content-Type': 'application/json'},
            timeout=GS_TIMEOUT
        )
    except requests.exceptions.Timeout:
        log(f"{tag} fecha={entry.get('fecha')} TIMEOUT {GS_TIMEOUT}s")
        raise SheetError(
            'Google Sheets tardó demasiado en responder. Puede que se haya guardado igual: '
            'revisá la hoja antes de reintentar.', 504)
    except requests.exceptions.RequestException as e:
        log(f"{tag} fecha={entry.get('fecha')} RequestException: {e}")
        raise SheetError(f'No se pudo conectar con Google Sheets: {e}', 502)

    elapsed = time.time() - t0
    log(f"{tag} fecha={entry.get('fecha')} -> {gs_response.status_code} en {elapsed:.1f}s: "
        f"{gs_response.text[:200]!r}")

    if gs_response.status_code != 200:
        raise SheetError(f'Google Sheets respondió {gs_response.status_code}', 502)

    try:
        data = gs_response.json()
    except ValueError:
        raise SheetError('Google Sheets devolvió una respuesta inesperada', 502)

    if not isinstance(data, dict) or data.get('error') or not data.get('success'):
        message = data.get('error') if isinstance(data, dict) else None
        raise SheetError(message or 'Google Sheets no confirmó el registro', 422)

    return data


def preflight():
    response = jsonify({'status': 'ok'})
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type, Accept')
    response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
    return response, 200


@app.route('/proxy/gsheet', methods=['POST', 'OPTIONS'])
def proxy_gsheet():
    """
    Proxy endpoint for Google Sheets Apps Script
    Forwards POST requests to the Google Apps Script URL
    """
    if request.method == 'OPTIONS':
        return preflight()

    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({
            'status': 'error',
            'message': 'No data provided'
        }), 400

    try:
        result = send_to_sheet(data, 'single')
    except SheetError as e:
        return jsonify({'status': 'error', 'message': e.message}), e.status_code
    except Exception as e:
        log(f"single Exception: {e!r}")
        return jsonify({
            'status': 'error',
            'message': f'Internal server error: {str(e)}'
        }), 500

    return jsonify({'status': 'success', **result}), 200


@app.route('/proxy/gsheet/batch', methods=['POST', 'OPTIONS'])
def proxy_gsheet_batch():
    """
    Batch proxy endpoint for Google Sheets Apps Script
    Accepts an array of entries and sends each one to the Google Apps Script.
    El front ya no lo usa (manda las filas de a una para no chocar con el timeout de nginx);
    queda por compatibilidad.
    """
    if request.method == 'OPTIONS':
        return preflight()

    data = request.get_json(silent=True)

    if not data or not isinstance(data, list):
        return jsonify({
            'status': 'error',
            'message': 'Expected an array of entries'
        }), 400

    if len(data) > 50:
        return jsonify({
            'status': 'error',
            'message': 'Maximum 50 entries per batch'
        }), 400

    results = []
    errors = []

    for i, entry in enumerate(data):
        try:
            result = send_to_sheet(entry, f"batch {i + 1}/{len(data)}")
            results.append({'index': i, 'status': 'success', 'data': result})
        except SheetError as e:
            errors.append({'index': i, 'status': 'error', 'message': e.message})
        except Exception as e:
            log(f"batch Exception: {e!r}")
            errors.append({'index': i, 'status': 'error', 'message': str(e)})

    status_code = 200 if not errors else 207
    return jsonify({
        'status': 'partial' if errors else 'success',
        'results': results,
        'errors': errors,
        'total': len(data),
        'successful': len(results),
        'failed': len(errors)
    }), status_code


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'Financial Tricks API is running'
    }), 200


@app.route('/', methods=['GET'])
def index():
    """Root endpoint - shows available routes"""
    return jsonify({
        'message': 'Financial Tricks API',
        'endpoints': {
            '/proxy/gsheet': 'POST - Proxy to Google Sheets (single)',
            '/proxy/gsheet/batch': 'POST - Proxy to Google Sheets (batch)',
            '/health': 'GET - Health check'
        }
    }), 200


if __name__ == '__main__':
    # Run the Flask app in debug mode
    app.run(
        host='0.0.0.0',  # Allow external connections
        port=5000,       # Port 5000
        debug=True       # Enable debug mode for development
    )
