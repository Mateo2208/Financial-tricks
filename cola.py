"""
Cola de registros: el celular recibe respuesta en milisegundos y el envío a Google
Sheets (3-30 s por fila) pasa en segundo plano.

- Persistente (SQLite en datos/quickcash.db): un reinicio del servicio no pierde nada.
- Un solo enviador entre todos los procesos de gunicorn (flock sobre datos/cola.lock),
  así las filas llegan a la hoja de a una y en orden.
- Cada registro viaja con su id (`id_registro`). El Apps Script recuerda los ids ya
  escritos, así que reintentar después de un timeout no duplica la fila.
- También guarda la caché del resumen por mes, compartida entre procesos.
"""
import fcntl
import json
import sqlite3
import threading
import time
from pathlib import Path

DIR = Path(__file__).resolve().parent / 'datos'
DB = DIR / 'quickcash.db'
LOCK = DIR / 'cola.lock'

MAX_INTENTOS = 12
ENVIANDO_COLGADO = 180  # s: un 'enviando' más viejo que esto quedó de un proceso que murió

_despertar = threading.Event()


def conn():
    DIR.mkdir(exist_ok=True)
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def iniciar_db():
    # Los procesos de gunicorn arrancan a la vez: crear tablas y pasar a WAL de a uno
    DIR.mkdir(exist_ok=True)
    with open(DIR / 'init.lock', 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        _crear_tablas()


def _crear_tablas():
    with conn() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('''CREATE TABLE IF NOT EXISTS registros (
            id TEXT PRIMARY KEY,
            creado REAL NOT NULL,
            actualizado REAL NOT NULL,
            mes TEXT NOT NULL,
            payload TEXT NOT NULL,
            estado TEXT NOT NULL,          -- pendiente | enviando | hecho | error
            intentos INTEGER NOT NULL DEFAULT 0,
            proximo REAL NOT NULL DEFAULT 0,
            fila INTEGER,
            error TEXT
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS registros_estado ON registros (estado, proximo)')
        c.execute('''CREATE TABLE IF NOT EXISTS resumen_cache (
            mes TEXT PRIMARY KEY,
            ts REAL NOT NULL,              -- cuándo se leyó de Google
            filas TEXT NOT NULL,
            vencido INTEGER NOT NULL DEFAULT 0
        )''')


# ===== Registros =====

def encolar(id_registro, payload):
    """Guarda el registro. Si el id ya existe (el celular reintentó) no hace nada."""
    ahora = time.time()
    fecha = payload.get('fecha', '')
    with conn() as c:
        c.execute('''INSERT OR IGNORE INTO registros (id, creado, actualizado, mes, payload, estado)
                     VALUES (?, ?, ?, ?, ?, 'pendiente')''',
                  (id_registro, ahora, ahora, fecha[3:], json.dumps(payload, ensure_ascii=False)))
    _despertar.set()


def estados(ids):
    if not ids:
        return []
    with conn() as c:
        q = f"SELECT id, estado, fila, error, intentos FROM registros WHERE id IN ({','.join('?' * len(ids))})"
        return [dict(r) for r in c.execute(q, ids)]


def del_mes_sin_confirmar(mes, desde_ts):
    """Registros del mes que la caché del resumen todavía no refleja."""
    with conn() as c:
        rows = c.execute('''SELECT id, payload, estado, fila FROM registros
                            WHERE mes = ? AND (estado IN ('pendiente', 'enviando')
                                               OR (estado = 'hecho' AND actualizado > ?))''',
                         (mes, desde_ts)).fetchall()
    return [{**dict(r), 'payload': json.loads(r['payload'])} for r in rows]


def pendientes_totales():
    with conn() as c:
        return c.execute("SELECT COUNT(*) FROM registros WHERE estado IN ('pendiente', 'enviando')").fetchone()[0]


# ===== Caché del resumen =====

def cache_leer(mes):
    """-> (ts, filas, vencido) o (None, None, True) si nunca se leyó."""
    with conn() as c:
        r = c.execute('SELECT ts, filas, vencido FROM resumen_cache WHERE mes = ?', (mes,)).fetchone()
    return (r['ts'], json.loads(r['filas']), bool(r['vencido'])) if r else (None, None, True)


def cache_guardar(mes, filas, ts):
    with conn() as c:
        c.execute('INSERT OR REPLACE INTO resumen_cache (mes, ts, filas, vencido) VALUES (?, ?, ?, 0)',
                  (mes, ts, json.dumps(filas, ensure_ascii=False)))


def cache_vencer(mes):
    """La hoja cambió: se sigue mostrando la copia mientras se refresca."""
    with conn() as c:
        c.execute('UPDATE resumen_cache SET vencido = 1 WHERE mes = ?', (mes,))


# ===== Enviador =====

def _espera(intentos):
    return min(5 * 2 ** intentos, 600)  # 10 s, 20 s, 40 s ... hasta 10 min


def _procesar_uno(enviar, SheetError, log):
    ahora = time.time()
    with conn() as c:
        c.execute('''UPDATE registros SET estado = 'pendiente', actualizado = ?
                     WHERE estado = 'enviando' AND actualizado < ?''', (ahora, ahora - ENVIANDO_COLGADO))
        r = c.execute('''SELECT * FROM registros WHERE estado = 'pendiente' AND proximo <= ?
                         ORDER BY creado LIMIT 1''', (ahora,)).fetchone()
        if not r:
            return False
        c.execute("UPDATE registros SET estado = 'enviando', actualizado = ? WHERE id = ?", (ahora, r['id']))

    payload = {**json.loads(r['payload']), 'id_registro': r['id']}
    try:
        res = enviar(payload, f"cola {r['id'][:8]}")
        with conn() as c:
            c.execute('''UPDATE registros SET estado = 'hecho', fila = ?, error = NULL, actualizado = ?
                         WHERE id = ?''', (res.get('row'), time.time(), r['id']))
        cache_vencer(r['mes'])
    except SheetError as e:
        intentos = r['intentos'] + 1
        # 422 = la planilla lo rechazó (fecha inexistente, sin permiso): reintentar no sirve
        definitivo = e.status_code == 422 or intentos >= MAX_INTENTOS
        with conn() as c:
            c.execute('''UPDATE registros SET estado = ?, intentos = ?, proximo = ?, error = ?, actualizado = ?
                         WHERE id = ?''',
                      ('error' if definitivo else 'pendiente', intentos,
                       time.time() + _espera(intentos), e.message, time.time(), r['id']))
        log(f"cola {r['id'][:8]} {'ERROR' if definitivo else 'reintento'} ({intentos}): {e.message}")
    return True


def _bucle(enviar, SheetError, log):
    DIR.mkdir(exist_ok=True)
    lock = open(LOCK, 'w')
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            time.sleep(20)  # otro proceso es el enviador; tomar la posta si muere
    log('cola: este proceso es el enviador')
    while True:
        try:
            trabajo = _procesar_uno(enviar, SheetError, log)
        except Exception as e:  # nunca matar el hilo
            log(f"cola: fallo inesperado {e!r}")
            trabajo = False
            time.sleep(5)
        if not trabajo:
            _despertar.wait(2)
            _despertar.clear()


def arrancar_enviador(enviar, SheetError, log):
    iniciar_db()
    threading.Thread(target=_bucle, args=(enviar, SheetError, log), daemon=True, name='cola').start()
