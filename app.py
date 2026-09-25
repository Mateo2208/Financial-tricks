"""
QuickCash (financial.matsoto.dev): la app de la casa sobre la planilla "Finanzas de la casa".

- Escrituras (movimientos, fotos de saldos, reglas, TC): entran a una cola y responden al
  instante; la cola las lleva a la planilla por detrás, sin duplicar (cola.py).
- Lecturas: una copia de la planilla en caché, refrescada por detrás; lo que está en cola se
  suma al instante (planilla.py).
"""
import os
import re
import secrets
import threading
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import requests
from flask import Flask, request, jsonify, session, send_from_directory
from werkzeug.security import check_password_hash

import cola
import planilla

BASE = Path(__file__).resolve().parent
WEB = BASE / 'web'


def load_config():
    """
    config.env junto a app.py o variables de entorno (fuera de git: el repo es público).
      GS_URL      URL /exec del Apps Script que maneja la planilla
      GS_TOKEN    secreto compartido con el Apps Script
      CLAVE_HASH  hash de la clave de la casa (werkzeug generate_password_hash)
      SECRET_KEY  firma de la cookie de sesión
    """
    cfg = {}
    env_file = BASE / 'config.env'
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip()
    for k in ('GS_URL', 'GS_TOKEN', 'CLAVE_HASH', 'SECRET_KEY'):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    if not cfg.get('GS_URL'):
        raise RuntimeError('Falta GS_URL (config.env o variable de entorno)')
    return cfg


CFG = load_config()
GS_URL = CFG['GS_URL']
GS_TOKEN = CFG.get('GS_TOKEN', '')
API_TC = 'https://api.dolarbluebolivia.click/v1/officialRate'

app = Flask(__name__, static_folder=None)
app.config.update(
    SECRET_KEY=CFG.get('SECRET_KEY') or secrets.token_hex(32),
    SESSION_COOKIE_NAME='qc_sesion',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=365),
)

# Apps Script tarda 3-30 s. nginx corta a los 90 s; gunicorn a los 90 s (gunicorn.conf.py).
GS_TIMEOUT = 55


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
    Llama al Apps Script. Responde siempre HTTP 200, también cuando falla ({"error": "..."}),
    así que el éxito se decide por el cuerpo.
    """
    body = {**body, 'token': GS_TOKEN}
    t0 = time.time()
    try:
        r = requests.post(GS_URL, json=body, headers={'Content-Type': 'application/json'}, timeout=GS_TIMEOUT)
    except requests.exceptions.Timeout:
        log(f"{tag} TIMEOUT {GS_TIMEOUT}s")
        raise SheetError('Google Sheets tardó demasiado en responder.', 504)
    except requests.exceptions.RequestException as e:
        log(f"{tag} RequestException: {e}")
        raise SheetError(f'No se pudo conectar con Google Sheets: {e}', 502)
    log(f"{tag} -> {r.status_code} en {time.time() - t0:.1f}s ({len(r.content) // 1024} KB)")
    if r.status_code != 200:
        raise SheetError(f'Google Sheets respondió {r.status_code}', 502)
    try:
        data = r.json()
    except ValueError:
        # A veces Google responde "Script function not found: doGet" a un POST válido.
        # Lecturas: se repite una vez. Escrituras: la cola reintenta con el mismo id (no duplica).
        if reintentar:
            log(f"{tag} respuesta no JSON, reintento")
            return call_sheet(body, tag, reintentar=False)
        raise SheetError('Google Sheets devolvió una respuesta inesperada', 502)
    if not isinstance(data, dict) or data.get('error') or not data.get('success'):
        message = data.get('error') if isinstance(data, dict) else None
        raise SheetError(message or 'Google Sheets no confirmó la operación', 422)
    return data


def planilla_op(op, tag, reintentar=False, **kw):
    return call_sheet({'accion': 'planilla', 'op': op, **kw}, tag, reintentar)


# ===== Copia de la planilla en caché (compartida entre procesos vía SQLite) =====

CLAVE_CACHE = '__planilla__'
FRESCA = 300  # s
_refrescando = threading.Event()


def leer_planilla():
    t0 = time.time()
    d = planilla_op('leer', 'leer planilla', reintentar=True)
    cola.cache_guardar(CLAVE_CACHE, d, t0)
    return d, t0


def _refrescar():
    try:
        leer_planilla()
    except Exception as e:
        log(f"refresco de la planilla falló: {e!r}")
    finally:
        _refrescando.clear()


def datos():
    """-> (datos, ts de lectura, actualizando). Nunca espera a Google si ya hay copia."""
    ts, d, vencido = cola.cache_leer(CLAVE_CACHE)
    if d is None:
        d, ts = leer_planilla()
        return d, ts, False
    if (vencido or time.time() - ts > FRESCA) and not _refrescando.is_set():
        _refrescando.set()
        threading.Thread(target=_refrescar, daemon=True).start()
        return d, ts, True
    return d, ts, _refrescando.is_set()


def en_cola(ts):
    return cola.sin_reflejar(ts)


# ===== Envío de la cola a la planilla =====

def enviar(p, tag):
    op = p.get('op')
    if op == 'movimiento' and p['tipo'] == 'Gasto':
        r = planilla_op('gasto', f"{tag} gasto {p['fecha']} {p['linea']}", id=p['id'], fecha=p['fecha'],
                        autor=planilla.AUTOR.get(p.get('persona'), ''), columna=p.get('columna') or 'COMPRAS VARIOS',
                        medio=p.get('medio', 'Banco'), monto=p['monto'], glosa=p.get('detalle', ''),
                        linea=p['linea'], cuenta=p['cuenta'])
        return {'fila': r.get('donde')}
    if op == 'movimiento' and p['tipo'] == 'Ingreso':
        r = planilla_op('ingreso', f"{tag} ingreso {p['fecha']} {p['linea']}", id=p['id'], fecha=p['fecha'],
                        concepto=p.get('detalle') or p['linea'], medio=p.get('medio', 'Banco'), monto=p['monto'], cuenta=p['cuenta'])
        return {'fila': r.get('donde')}
    if op == 'saldos':
        r = planilla_op('saldos', f"{tag} saldos {p['fecha']}", **{k: v for k, v in p.items() if k != 'op'})
        return {'fila': r.get('donde')}
    if op == 'regla':
        planilla_op('regla', f"{tag} regla {p['palabra']}", palabra=p['palabra'], linea=p['linea'], quien=p.get('quien', ''))
        return {}
    raise SheetError(f'Operación desconocida: {op}', 422)


def al_confirmar(p):
    cola.cache_vencer(CLAVE_CACHE)


_tc = {'ts': 0, 'valor': None}


def tc_hoy():
    """Dólar oficial (BCB, para cuentas de banco) y paralelo (efectivo), de Dólar Blue Bolivia; caché 30 min."""
    if _tc['valor'] and time.time() - _tc['ts'] < 1800:
        return _tc['valor']
    try:
        j = requests.get(API_TC, timeout=10).json()['data']
        _tc.update(ts=time.time(), valor={'oficial': float(j['official']['sell']), 'paralelo': float(j['blue']['sell']),
                                          'fecha': planilla.hoy().isoformat()})
    except Exception as e:
        log(f"TC no disponible: {e!r}")
        if not _tc['valor']:
            ts, d, _ = cola.cache_leer(CLAVE_CACHE)
            u = (d or {}).get('saldos') or [{}]
            _tc['valor'] = {'oficial': u[-1].get('tc_oficial') or 10, 'paralelo': u[-1].get('tc_paralelo') or 10,
                            'fecha': u[-1].get('fecha', '')}
    return _tc['valor']


# ===== Sesión (clave de la casa) =====

_intentos = defaultdict(list)
MAX_INTENTOS = 5
VENTANA_INTENTOS = 600


def ip_cliente():
    return request.headers.get('X-Real-IP') or request.remote_addr or '?'


def requiere_sesion():
    if not session.get('ok'):
        return jsonify({'status': 'error', 'message': 'Tu sesión venció. Volvé a entrar.'}), 401
    return None


@app.route('/api/sesion', methods=['GET'])
def api_sesion():
    return jsonify({'status': 'success', 'ok': bool(session.get('ok'))})


@app.route('/api/login', methods=['POST'])
def api_login():
    ip = ip_cliente()
    now = time.time()
    _intentos[ip] = [t for t in _intentos[ip] if now - t < VENTANA_INTENTOS]
    if len(_intentos[ip]) >= MAX_INTENTOS:
        espera = int(VENTANA_INTENTOS - (now - _intentos[ip][0])) // 60 + 1
        return jsonify({'status': 'error', 'message': f'Demasiados intentos. Probá de nuevo en {espera} min.'}), 429
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


def _error(e):
    return jsonify({'status': 'error', 'message': e.message}), e.status_code


@app.route('/api/catalogo', methods=['GET'])
def api_catalogo():
    """Líneas, cuentas, reglas y las líneas más usadas por persona (últimos 120 días)."""
    if (r := requiere_sesion()):
        return r
    try:
        d, ts, act = datos()
    except SheetError as e:
        return _error(e)
    cat = planilla.catalogo(d)
    desde = (planilla.hoy() - timedelta(days=120)).isoformat()
    frecuentes = defaultdict(Counter)
    for m in planilla.movimientos(d, en_cola(ts)):
        if m['fecha'] >= desde and m['tipo'] in ('Gasto', 'Ingreso'):
            frecuentes[m['persona']][m['linea']] += 1
    cat['frecuentes'] = {p: [l for l, _ in c.most_common(8)] for p, c in frecuentes.items()}
    return jsonify({'status': 'success', **cat, 'actualizando': act})


@app.route('/api/registro', methods=['POST'])
def api_registro():
    """Acepta el movimiento al instante (202); la cola lo anota en la planilla."""
    if (r := requiere_sesion()):
        return r
    d = request.get_json(silent=True) or {}
    idr = str(d.get('id') or '')
    if not ID_VALIDO.match(idr):
        return jsonify({'status': 'error', 'message': 'Falta el id del registro'}), 400
    try:
        datetime.strptime(str(d.get('fecha')), '%Y-%m-%d')
        monto = float(d.get('monto'))
    except (TypeError, ValueError):
        return jsonify({'status': 'error', 'message': 'Fecha o monto inválidos'}), 400
    if d.get('tipo') not in ('Gasto', 'Ingreso', 'Transferencia', 'Ajuste') or not d.get('linea') or not d.get('cuenta'):
        return jsonify({'status': 'error', 'message': 'Faltan tipo, línea o cuenta'}), 400
    if d['tipo'] in ('Gasto', 'Ingreso') and monto <= 0:
        return jsonify({'status': 'error', 'message': 'El monto tiene que ser mayor a cero'}), 400
    try:
        cat = planilla.catalogo(datos()[0])
    except SheetError as e:
        return _error(e)
    info = {l['linea']: l for l in cat['lineas']}
    if d['linea'] not in info:
        return jsonify({'status': 'error', 'message': f"La línea {d['linea']} no existe en la planilla"}), 400
    if int(str(d['fecha'])[:4]) != int(datos()[0].get('anio', 0)):
        return jsonify({'status': 'error', 'message': 'Esa fecha es de otra gestión.'}), 400
    p = {'op': 'movimiento', 'fecha': d['fecha'], 'tipo': d['tipo'], 'linea': str(d['linea'])[:80],
         'monto': round(monto, 2), 'cuenta': str(d['cuenta'])[:80], 'persona': str(d.get('persona', ''))[:40],
         'detalle': str(d.get('detalle', ''))[:160], 'medio': 'Efectivo' if d.get('medio') == 'Efectivo' else 'Banco',
         'columna': info[d['linea']].get('columna') or 'COMPRAS VARIOS'}
    cola.encolar(idr, p)
    return jsonify({'status': 'success', 'id': idr, 'estado': 'pendiente'}), 202


@app.route('/api/registros', methods=['GET'])
def api_registros():
    if (r := requiere_sesion()):
        return r
    ids = [i for i in (request.args.get('ids') or '').split(',') if ID_VALIDO.match(i)][:100]
    return jsonify({'status': 'success', 'registros': cola.estados(ids)})


@app.route('/api/resumen', methods=['GET'])
def api_resumen():
    if (r := requiere_sesion()):
        return r
    mes = request.args.get('mes') or planilla.hoy().strftime('%Y-%m')
    if not re.fullmatch(r'\d{4}-\d{2}', mes):
        return jsonify({'status': 'error', 'message': 'Mes inválido (AAAA-MM)'}), 400
    try:
        d, ts, act = datos()
    except SheetError as e:
        return _error(e)
    res = planilla.resumen(d, mes, en_cola(ts))
    res['actualizando'] = act
    return jsonify(res)


@app.route('/api/saldos', methods=['GET'])
def api_saldos():
    if (r := requiere_sesion()):
        return r
    try:
        d, ts, act = datos()
    except SheetError as e:
        return _error(e)
    res = planilla.saldos(d, tc_hoy(), en_cola(ts))
    res['actualizando'] = act
    return jsonify(res)


@app.route('/api/saldos', methods=['POST'])
def api_foto():
    """Revisión de saldos: lo que muestra cada cuenta hoy -> columna nueva en SALDOS.
    {id, fecha, saldos: [{cuenta, monto}], pendientes}"""
    if (r := requiere_sesion()):
        return r
    d = request.get_json(silent=True) or {}
    idr = str(d.get('id') or '')
    if not ID_VALIDO.match(idr):
        return jsonify({'status': 'error', 'message': 'Falta el id'}), 400
    try:
        datetime.strptime(str(d.get('fecha')), '%Y-%m-%d')
        montos = {str(x['cuenta']): round(float(x['monto']), 2) for x in d.get('saldos') or []}
        pendientes = round(float(d.get('pendientes') or 0), 2)
    except (TypeError, ValueError, KeyError):
        return jsonify({'status': 'error', 'message': 'Saldos inválidos'}), 400
    try:
        dat, ts, _ = datos()
    except SheetError as e:
        return _error(e)
    cat = planilla.catalogo(dat)
    etiqueta = {c['cuenta']: c['etiqueta'] for c in cat['cuentas']}
    valores = {etiqueta[c]: v for c, v in montos.items() if c in etiqueta}
    if not valores:
        return jsonify({'status': 'error', 'message': 'No hay saldos para guardar'}), 400
    tc = tc_hoy()
    s = planilla.saldos(dat, tc, en_cola(ts))
    cola.encolar(idr, {'op': 'saldos', 'fecha': d['fecha'], 'valores': valores, 'pendientes': pendientes,
                       'tc_oficial': tc['oficial'], 'tc_paralelo': tc['paralelo'],
                       'diezmo_bs': s['diezmo_bs'], 'diezmo_usd': s['diezmo_usd']})
    return jsonify({'status': 'success', 'id': idr}), 202


@app.route('/api/regla', methods=['POST'])
def api_regla():
    """La app aprende: 'si el detalle dice X, va a la línea Y'."""
    if (r := requiere_sesion()):
        return r
    d = request.get_json(silent=True) or {}
    palabra = planilla.normalizar(d.get('palabra'))
    if not palabra or len(palabra) < 3 or len(palabra.split()) > 3 or not d.get('linea'):
        return jsonify({'status': 'error', 'message': 'Regla inválida'}), 400
    idr = 'regla-' + re.sub(r'[^a-z0-9]', '-', palabra)[:40] + '-' + secrets.token_hex(3)
    cola.encolar(idr, {'op': 'regla', 'palabra': palabra, 'linea': str(d['linea'])[:80],
                       'quien': str(d.get('quien', 'QuickCash'))[:40]})
    return jsonify({'status': 'success'}), 202


# ===== Front =====

@app.route('/')
def front_index():
    resp = send_from_directory(WEB, 'index.html')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/sw.js')
def front_sw():
    resp = send_from_directory(WEB, 'sw.js')
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


@app.route('/<path:archivo>')
def front_static(archivo):
    if archivo.startswith('api/'):
        return jsonify({'status': 'error', 'message': 'No encontrado'}), 404
    return send_from_directory(WEB, archivo)


@app.after_request
def cabeceras_seguridad(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'same-origin')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    return resp


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'message': 'QuickCash', 'en_cola': cola.pendientes_totales()}), 200


# El enviador de la cola arranca con cada proceso; solo uno toma el lock y envía
cola.arrancar_enviador(enviar, SheetError, log, al_confirmar=al_confirmar)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
