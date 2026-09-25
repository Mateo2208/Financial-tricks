import os
import re
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

import cola

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
# La planilla cierra cada mes con una fila de totales cuyo "autor" es el nombre del mes:
# no es un gasto, sumarla duplica el total.
MESES = {'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
         'SEPTIEMBRE', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'}


def normalizar_autor(autor):
    """'EVER ', 'Ever' -> 'EVER'; 'MA.NELFI' -> 'MA. NELFI' (en la hoja hay de todo)."""
    a = ' '.join(str(autor or '').upper().split())
    return a.replace('MA.NELFI', 'MA. NELFI')


def log(msg):
    print(f"[gs] {msg}", flush=True)


class SheetError(Exception):
    """Error con mensaje para el usuario y código HTTP."""

    def __init__(self, message, status_code):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def call_sheet(body, tag, reintentar=False):
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
        # A veces Google responde su página "Script function not found: doGet" a un POST
        # válido. En lecturas se repite una vez; una escritura nunca (podría duplicar).
        if reintentar:
            log(f"{tag} respuesta no JSON, reintento")
            return call_sheet(body, tag, reintentar=False)
        raise SheetError('Google Sheets devolvió una respuesta inesperada', 502)

    if not isinstance(data, dict) or data.get('error') or not data.get('success'):
        message = data.get('error') if isinstance(data, dict) else None
        raise SheetError(message or 'Google Sheets no confirmó el registro', 422)

    return data


def send_to_sheet(entry, tag):
    """Escribe una fila (payload del formulario: fecha, autor, glosa, <categoria>_<metodo>)."""
    return call_sheet(entry, f"{tag} fecha={entry.get('fecha')}")


# ===== Resumen (lectura) =====

RESUMEN_FRESCO = 120  # s; más viejo que esto se muestra igual y se refresca por detrás
_refrescando = set()
_refrescando_lock = threading.Lock()


def leer_de_google(mes):
    """Filas crudas de un mes ('MM/AAAA') desde el Apps Script; guarda la caché compartida."""
    t0 = time.time()
    data = call_sheet({'accion': 'resumen', 'mes': mes}, f"resumen mes={mes}", reintentar=True)
    filas = data.get('filas') or []
    cola.cache_guardar(mes, filas, t0)
    return filas, t0


def _refrescar(mes):
    try:
        leer_de_google(mes)
    except Exception as e:
        log(f"refresco resumen {mes} falló: {e!r}")
    finally:
        with _refrescando_lock:
            _refrescando.discard(mes)


def filas_del_mes(mes):
    """
    Devuelve (filas, ts, actualizando). Si hay copia se responde al instante con ella y, si
    está vieja o la hoja cambió, se refresca en segundo plano (el celular vuelve a pedir).
    """
    ts, filas, vencido = cola.cache_leer(mes)
    if filas is None:
        filas, ts = leer_de_google(mes)
        return filas, ts, False
    if vencido or time.time() - ts > RESUMEN_FRESCO:
        with _refrescando_lock:
            lanzar = mes not in _refrescando
            _refrescando.add(mes)
        if lanzar:
            threading.Thread(target=_refrescar, args=(mes,), daemon=True).start()
        return filas, ts, True
    return filas, ts, False


def filas_de_la_cola(mes, ts, filas):
    """Registros aceptados que la copia del resumen todavía no incluye."""
    ya = {f.get('fila') for f in filas}
    extra = []
    for r in cola.del_mes_sin_confirmar(mes, ts):
        if r['estado'] == 'hecho' and r['fila'] in ya:
            continue
        p = r['payload']
        extra.append({
            'fila': None, 'fecha': p.get('fecha'), 'autor': p.get('autor', ''), 'glosa': p.get('glosa', ''),
            'montos': [p.get(k, 0) or 0 for k in CAMPOS],
            'anotando': r['estado'] != 'hecho',
        })
    return extra


def armar_resumen(mes, filas):
    hoy = datetime.now(BOLIVIA).strftime('%d/%m/%Y')
    por_categoria = {c: {m: 0.0 for m in METODOS} for c in CATEGORIAS}
    por_autor = defaultdict(float)
    por_dia = defaultdict(float)
    movimientos = []

    anotando = 0
    for f in filas:
        autor = normalizar_autor(f.get('autor'))
        if autor in MESES or autor.startswith('TOTAL'):
            continue
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
                    'autor': autor,
                    'categoria': c,
                    'metodo': m,
                    'monto': round(v, 2),
                    'glosa': f.get('glosa') or '',
                    'anotando': bool(f.get('anotando')),
                })
        anotando += 1 if f.get('anotando') else 0
        por_autor[autor or 'Sin autor'] += total_fila
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
        'anotando': anotando,
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

ID_VALIDO = re.compile(r'^[A-Za-z0-9-]{8,64}$')


@app.route('/api/registro', methods=['POST'])
def api_registro():
    """
    Acepta el registro y responde al instante (202); el envío a la hoja lo hace la cola.
    El id lo genera el celular: si reintenta el mismo registro, no se duplica.
    """
    if (r := requiere_sesion()):
        return r
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get('fecha'):
        return jsonify({'status': 'error', 'message': 'Faltan datos del registro'}), 400
    id_registro = str(data.get('id') or '')
    if not ID_VALIDO.match(id_registro):
        return jsonify({'status': 'error', 'message': 'Falta el id del registro'}), 400
    try:
        datetime.strptime(str(data['fecha']), '%d/%m/%Y')
    except ValueError:
        return jsonify({'status': 'error', 'message': 'Fecha inválida'}), 400
    # Solo los campos que entiende la hoja
    entry = {k: data[k] for k in ['fecha', 'autor', 'glosa', *CAMPOS] if k in data}
    if not any(float(entry.get(k) or 0) > 0 for k in CAMPOS):
        return jsonify({'status': 'error', 'message': 'Falta el monto'}), 400
    cola.encolar(id_registro, entry)
    return jsonify({'status': 'success', 'id': id_registro, 'estado': 'pendiente'}), 202


@app.route('/api/registros', methods=['GET'])
def api_registros():
    """Estado de registros encolados: ?ids=a,b,c"""
    if (r := requiere_sesion()):
        return r
    ids = [i for i in (request.args.get('ids') or '').split(',') if ID_VALIDO.match(i)][:100]
    return jsonify({'status': 'success', 'registros': cola.estados(ids)})


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
        filas, ts, actualizando = filas_del_mes(mes)
    except SheetError as e:
        return jsonify({'status': 'error', 'message': e.message}), e.status_code
    resumen = armar_resumen(mes, filas + filas_de_la_cola(mes, ts, filas))
    resumen['leido'] = int(ts)
    resumen['actualizando'] = actualizando
    return jsonify(resumen)


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

    cola.cache_vencer(str(data.get('fecha', ''))[3:])
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
            cola.cache_vencer(str(entry.get('fecha', ''))[3:])
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


# El enviador de la cola arranca con cada proceso; solo uno toma el lock y envía
cola.arrancar_enviador(send_to_sheet, SheetError, log)


if __name__ == '__main__':
    # Desarrollo local: sin HTTPS la cookie Secure solo viaja a localhost
    app.run(host='127.0.0.1', port=5000, debug=True)
