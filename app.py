import os
import secrets
import threading
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, request, jsonify, session, send_from_directory
from flask_cors import CORS
from werkzeug.security import check_password_hash

BASE = Path(__file__).resolve().parent
WEB = BASE / 'web'


def load_config():
    """
    Configuración desde variables de entorno o desde config.env / .gs_url junto a app.py
    (fuera de git: el repo es público y con estos valores se lee y escribe la hoja).
      GS_URL          URL /exec del Apps Script
      GS_TOKEN        secreto compartido con el Apps Script (Secreto.js)
      CLAVE_HASH      hash de la clave familiar (werkzeug generate_password_hash)
      SECRET_KEY      firma de la cookie de sesión
    """
    cfg = {}
    env_file = BASE / 'config.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip()
    legacy = BASE / '.gs_url'
    if 'GS_URL' not in cfg and legacy.exists():
        cfg['GS_URL'] = legacy.read_text().strip()
    for k in ('GS_URL', 'GS_TOKEN', 'CLAVE_HASH', 'SECRET_KEY'):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    if not cfg.get('GS_URL'):
        raise RuntimeError('Falta GS_URL (config.env, .gs_url o variable de entorno)')
    return cfg


CFG = load_config()
GS_URL = CFG['GS_URL']
GS_TOKEN = CFG.get('GS_TOKEN', '')

app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=CFG.get('SECRET_KEY') or secrets.token_hex(32),
    SESSION_COOKIE_NAME='qc_sesion',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=365),
)

# Solo las rutas viejas (/proxy/*) aceptan otro origen: las usa la versión de GitHub Pages
# mientras siga en uso. La app nueva vive en el mismo dominio que la API.
CORS(app, resources={
    r"/proxy/*": {
        "origins": ["https://mateo2208.github.io"],
        "methods": ["POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Accept"]
    }
})

# Apps Script tarda 3-30 s. nginx corta a los 60 s (proxy_read_timeout por defecto),
# así que respondemos antes para que el front reciba un mensaje y no un 502 de nginx.
# El timeout de gunicorn (gunicorn.conf.py) tiene que ser mayor que este.
GS_TIMEOUT = 55

BOLIVIA = timezone(timedelta(hours=-4))
CATEGORIAS = ['comida', 'movilidad', 'varios', 'servicios']
METODOS = ['tarjeta', 'efectivo']
CAMPOS = [f'{c}_{m}' for c in CATEGORIAS for m in METODOS]  # orden de las columnas D:K


def log(msg):
    print(f"[gs] {msg}", flush=True)


class SheetError(Exception):
    """Error con mensaje para el usuario y código HTTP."""

    def __init__(self, message, status_code):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def call_sheet(body, tag):
    """
    Llama al Apps Script y devuelve su respuesta si salió bien.
    El Apps Script responde siempre HTTP 200, también cuando falla ({"error": "..."}),
    así que el éxito se decide por el cuerpo, no por el código.
    """
    body = dict(body)
    if GS_TOKEN:
        body['token'] = GS_TOKEN
    t0 = time.time()
    try:
        gs_response = requests.post(
            GS_URL,
            json=body,
            headers={'Content-Type': 'application/json'},
            timeout=GS_TIMEOUT
        )
    except requests.exceptions.Timeout:
        log(f"{tag} TIMEOUT {GS_TIMEOUT}s")
        raise SheetError(
            'Google Sheets tardó demasiado en responder. Puede que se haya guardado igual: '
            'revisá la hoja antes de reintentar.', 504)
    except requests.exceptions.RequestException as e:
        log(f"{tag} RequestException: {e}")
        raise SheetError(f'No se pudo conectar con Google Sheets: {e}', 502)

    elapsed = time.time() - t0
    log(f"{tag} -> {gs_response.status_code} en {elapsed:.1f}s: {gs_response.text[:160]!r}")

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


def send_to_sheet(entry, tag):
    """Escribe una fila (payload del formulario: fecha, autor, glosa, <categoria>_<metodo>)."""
    return call_sheet(entry, f"{tag} fecha={entry.get('fecha')}")


# ===== Resumen (lectura) =====

_cache = {}
_cache_lock = threading.Lock()
RESUMEN_TTL = 120  # s; cada escritura invalida el mes que tocó


def leer_mes(mes):
    """Filas crudas de un mes ('MM/AAAA') desde el Apps Script, con caché corta."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(mes)
        if hit and now - hit[0] < RESUMEN_TTL:
            return hit[1]
    data = call_sheet({'accion': 'resumen', 'mes': mes}, f"resumen mes={mes}")
    filas = data.get('filas') or []
    with _cache_lock:
        _cache[mes] = (now, filas)
    return filas


def invalidar_mes(fecha):
    """fecha 'dd/MM/yyyy' -> borra la caché de ese mes."""
    if isinstance(fecha, str) and len(fecha) == 10:
        with _cache_lock:
            _cache.pop(fecha[3:], None)


def armar_resumen(mes, filas):
    hoy = datetime.now(BOLIVIA).strftime('%d/%m/%Y')
    por_categoria = {c: {m: 0.0 for m in METODOS} for c in CATEGORIAS}
    por_autor = defaultdict(float)
    por_dia = defaultdict(float)
    movimientos = []

    for f in filas:
        montos = []
        for x in (f.get('montos') or [])[:8]:
            try:
                montos.append(float(x or 0))
            except (TypeError, ValueError):
                montos.append(0.0)
        montos += [0.0] * (8 - len(montos))
        total_fila = sum(montos)
        if not total_fila:
            continue
        for i, v in enumerate(montos):
            if v:
                c, m = CAMPOS[i].split('_')
                por_categoria[c][m] += v
                movimientos.append({
                    'fila': f.get('fila'),
                    'fecha': f.get('fecha'),
                    'autor': f.get('autor') or '',
                    'categoria': c,
                    'metodo': m,
                    'monto': round(v, 2),
                    'glosa': f.get('glosa') or '',
                })
        por_autor[f.get('autor') or 'Sin autor'] += total_fila
        por_dia[f.get('fecha')] += total_fila

    def clave_fecha(s):
        d, m, a = s.split('/')
        return (a, m, d)

    movimientos.sort(key=lambda x: (clave_fecha(x['fecha']), x['fila'] or 0), reverse=True)
    total = sum(sum(v.values()) for v in por_categoria.values())
    return {
        'status': 'success',
        'mes': mes,
        'total': round(total, 2),
        'hoy': round(por_dia.get(hoy, 0.0), 2),
        'tarjeta': round(sum(v['tarjeta'] for v in por_categoria.values()), 2),
        'efectivo': round(sum(v['efectivo'] for v in por_categoria.values()), 2),
        'categorias': {c: {m: round(v, 2) for m, v in d.items()} for c, d in por_categoria.items()},
        'autores': {a: round(v, 2) for a, v in sorted(por_autor.items(), key=lambda x: -x[1])},
        'dias': {d: round(v, 2) for d, v in sorted(por_dia.items(), key=lambda x: clave_fecha(x[0]))},
        'movimientos': movimientos,
    }


# ===== Sesión (clave familiar) =====

_intentos = defaultdict(list)  # ip -> timestamps de claves erradas
MAX_INTENTOS = 5
VENTANA_INTENTOS = 600


def ip_cliente():
    return request.headers.get('X-Real-IP') or request.remote_addr or '?'


def logueado():
    return bool(session.get('ok'))


def requiere_sesion():
    if not logueado():
        return jsonify({'status': 'error', 'message': 'Tu sesión venció. Volvé a entrar.'}), 401
    return None


@app.route('/api/sesion', methods=['GET'])
def api_sesion():
    return jsonify({'status': 'success', 'ok': logueado()})


@app.route('/api/login', methods=['POST'])
def api_login():
    ip = ip_cliente()
    now = time.time()
    _intentos[ip] = [t for t in _intentos[ip] if now - t < VENTANA_INTENTOS]
    if len(_intentos[ip]) >= MAX_INTENTOS:
        espera = int(VENTANA_INTENTOS - (now - _intentos[ip][0])) // 60 + 1
        return jsonify({'status': 'error',
                        'message': f'Demasiados intentos. Probá de nuevo en {espera} min.'}), 429

    clave = str((request.get_json(silent=True) or {}).get('clave', ''))
    if not CFG.get('CLAVE_HASH') or not check_password_hash(CFG['CLAVE_HASH'], clave):
        _intentos[ip].append(now)
        log(f"login fallido ip={ip}")
        return jsonify({'status': 'error', 'message': 'Clave incorrecta.'}), 401

    _intentos.pop(ip, None)
    session.permanent = True
    session['ok'] = True
    return jsonify({'status': 'success'})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'status': 'success'})


# ===== API de la app =====

@app.route('/api/registro', methods=['POST'])
def api_registro():
    if (r := requiere_sesion()):
        return r
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get('fecha'):
        return jsonify({'status': 'error', 'message': 'Faltan datos del registro'}), 400
    # Solo los campos que entiende la hoja
    entry = {k: data[k] for k in ['fecha', 'autor', 'glosa', *CAMPOS] if k in data}
    try:
        result = send_to_sheet(entry, 'registro')
    except SheetError as e:
        if e.status_code == 504:
            invalidar_mes(entry.get('fecha'))
        return jsonify({'status': 'error', 'message': e.message}), e.status_code
    invalidar_mes(entry.get('fecha'))
    return jsonify({'status': 'success', 'row': result.get('row')})


@app.route('/api/resumen', methods=['GET'])
def api_resumen():
    if (r := requiere_sesion()):
        return r
    mes = request.args.get('mes') or datetime.now(BOLIVIA).strftime('%m/%Y')
    try:
        datetime.strptime(mes, '%m/%Y')
    except ValueError:
        return jsonify({'status': 'error', 'message': 'Mes inválido (MM/AAAA)'}), 400
    try:
        filas = leer_mes(mes)
    except SheetError as e:
        return jsonify({'status': 'error', 'message': e.message}), e.status_code
    return jsonify(armar_resumen(mes, filas))


# ===== Front (financial.matsoto.dev) =====

@app.route('/')
def front_index():
    resp = send_from_directory(WEB, 'index.html')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/sw.js')
def front_sw():
    # El service worker se sirve desde la raíz para controlar todo el sitio
    resp = send_from_directory(WEB, 'sw.js')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/<path:archivo>')
def front_static(archivo):
    if archivo.startswith(('api/', 'proxy/')):
        return jsonify({'status': 'error', 'message': 'No encontrado'}), 404
    return send_from_directory(WEB, archivo)


@app.after_request
def cabeceras_seguridad(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    return resp


# ===== Rutas viejas (versión de GitHub Pages vía sheet.matsoto.dev) =====

@app.route('/proxy/gsheet', methods=['POST', 'OPTIONS'])
def proxy_gsheet():
    """Proxy de un registro para la versión vieja del front (GitHub Pages)."""
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

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

    invalidar_mes(data.get('fecha'))
    return jsonify({'status': 'success', **result}), 200


@app.route('/proxy/gsheet/batch', methods=['POST', 'OPTIONS'])
def proxy_gsheet_batch():
    """Lote para la versión vieja del front; ya no lo usa (manda de a un registro)."""
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

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
            invalidar_mes(entry.get('fecha'))
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


if __name__ == '__main__':
    # Desarrollo local: sin HTTPS la cookie Secure solo viaja a localhost
    app.run(host='127.0.0.1', port=5000, debug=True)
