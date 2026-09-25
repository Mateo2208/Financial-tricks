"""
Modelo de la planilla nueva del lado del servidor: catálogo, resumen del mes (presupuesto
contra real) y saldos, calculados sobre la última lectura de la planilla más lo que está en la
cola y todavía no llegó a la hoja. La planilla hace las mismas cuentas con fórmulas; esto es
para que la app responda al instante sin esperar a Google.
"""
import re
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

BOLIVIA = timezone(timedelta(hours=-4))


def hoy():
    return datetime.now(BOLIVIA).date()


def num(x):
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def normalizar(s):
    s = unicodedata.normalize('NFD', str(s or '').lower())
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(re.sub(r'[^a-z0-9 ]', ' ', s).split())


# ===== Catálogo =====

def catalogo(d):
    lineas = [{'categoria': c, 'linea': l, 'tipo': t, 'diezmo': dz == 'Sí'}
              for c, l, t, dz in d['listas'] if l]
    cuentas = []
    for f in d['cuentas']:
        if not f[0]:
            continue
        defecto = [x.strip() for x in str(f[10] or '').split(',') if x.strip()]
        cuentas.append({'cuenta': f[0], 'dueno': f[1], 'moneda': f[2] or 'Bs', 'medio': f[3] or 'Banco',
                        'defecto': defecto, 'activa': f[11] != 'No'})
    reglas = [[normalizar(p), l] for p, l, *_ in d['reglas'] if p and l]
    reglas.sort(key=lambda r: -len(r[0]))
    personas = sorted({f[1] for f in d['cuentas'] if f[1]}) or ['Ever', 'Ma. Nelfi']
    return {'lineas': lineas, 'cuentas': cuentas, 'reglas': reglas, 'personas': personas}


# ===== Movimientos =====

def movimientos(d, en_cola=()):
    """Movimientos de la hoja + los de la cola que la hoja todavía no tiene (por id)."""
    lineas = {l: c for c, l, *_ in d['listas']}
    ids = set()
    out = []
    for f in d['movimientos']:
        if not f[1]:
            continue
        ids.add(f[0])
        out.append(_mov(f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], lineas, anotando=False, revisar=f[8]))
    for p in en_cola:
        if p['id'] in ids:
            continue
        out.append(_mov(p['id'], p['fecha'], p['tipo'], p['linea'], p['monto'], p['cuenta'], p['persona'],
                        p.get('detalle', ''), lineas, anotando=True))
    return out


def _mov(i, fecha, tipo, linea, monto, cuenta, persona, detalle, lineas, anotando, revisar=''):
    m = num(monto)
    return {'id': i, 'fecha': str(fecha)[:10], 'tipo': tipo, 'linea': linea or '', 'categoria': lineas.get(linea, 'Sin categoría'),
            'monto': m, 'cuenta': cuenta or '', 'persona': persona or '', 'detalle': detalle or '',
            'anotando': anotando, 'revisar': revisar or ''}


def efecto(m):
    return -m['monto'] if m['tipo'] == 'Gasto' else m['monto']


# ===== Tipo de cambio =====

def tc_en(d, dia):
    """Último TC con fecha <= dia (como la planilla); 10 si no hay."""
    mejor = None
    for f, paralelo, *_ in d['tc']:
        if f and str(f)[:10] <= dia and num(paralelo):
            mejor = num(paralelo)
    return mejor or 10.0


def monto_bs(d, cuentas, m):
    c = cuentas.get(m['cuenta'])
    if c and c['moneda'] == 'USD':
        return m['monto'] * tc_en(d, m['fecha'])
    return m['monto']


# ===== Resumen del mes =====

def resumen(d, mes, en_cola=()):
    """mes 'AAAA-MM' -> presupuesto contra real por línea, ingresos, movimientos."""
    cat = catalogo(d)
    cuentas = {c['cuenta']: c for c in cat['cuentas']}
    anio, nmes = int(mes[:4]), int(mes[5:7])
    movs = [m for m in movimientos(d, en_cola) if m['fecha'][:7] == mes]
    hoy_s = hoy().isoformat()

    real = defaultdict(float)
    ingresos = defaultdict(float)
    por_persona = defaultdict(float)
    gasto_total = ingreso_total = gasto_hoy = 0.0
    for m in movs:
        v = monto_bs(d, cuentas, m)
        m['monto_bs'] = round(v, 2)
        if m['tipo'] == 'Gasto':
            real[m['linea']] += v
            gasto_total += v
            por_persona[m['persona'] or 'Sin persona'] += v
            if m['fecha'] == hoy_s:
                gasto_hoy += v
        elif m['tipo'] == 'Ingreso':
            ingresos[m['linea']] += v
            ingreso_total += v

    pres_mensual = defaultdict(float)
    pres_anual = defaultdict(float)
    for f in d['presupuesto']:
        if str(f[0]).split('.')[0] != str(anio) or not f[3]:
            continue
        v = num(f[3 + nmes])
        (pres_anual if f[1] == 'Anual' else pres_mensual)[f[3]] += v

    categorias = []
    por_cat = defaultdict(list)
    for l in cat['lineas']:
        if l['tipo'] != 'Gasto':
            continue
        p = pres_mensual.get(l['linea'], 0) + pres_anual.get(l['linea'], 0)
        r = real.get(l['linea'], 0)
        if p or r:
            por_cat[l['categoria']].append({'linea': l['linea'], 'presupuesto': round(p, 2), 'real': round(r, 2),
                                            'anual': l['linea'] in pres_anual and pres_anual[l['linea']] > 0})
    # líneas usadas que no están en Listas (escritas a mano)
    conocidas = {l['linea'] for l in cat['lineas']}
    for linea, r in real.items():
        if linea not in conocidas:
            por_cat['Sin categoría'].append({'linea': linea or '(sin línea)', 'presupuesto': 0, 'real': round(r, 2), 'anual': False})
    orden_cat = list(dict.fromkeys(l['categoria'] for l in cat['lineas'])) + ['Sin categoría']
    for c in orden_cat:
        if por_cat.get(c):
            ls = por_cat[c]
            categorias.append({'categoria': c, 'presupuesto': round(sum(x['presupuesto'] for x in ls), 2),
                               'real': round(sum(x['real'] for x in ls), 2), 'lineas': ls})

    movs.sort(key=lambda m: (m['fecha'], m['id']), reverse=True)
    return {
        'status': 'success', 'mes': mes,
        'gastado': round(gasto_total, 2), 'ingresos': round(ingreso_total, 2),
        'resultado': round(ingreso_total - gasto_total, 2), 'hoy': round(gasto_hoy, 2),
        'presupuesto_mensual': round(sum(pres_mensual.values()), 2),
        'presupuesto_anual': round(sum(pres_anual.values()), 2),
        'categorias': categorias,
        'ingresos_por_linea': [{'linea': k, 'monto': round(v, 2)} for k, v in sorted(ingresos.items(), key=lambda x: -x[1])],
        'por_persona': {k: round(v, 2) for k, v in sorted(por_persona.items(), key=lambda x: -x[1])},
        'movimientos': movs,
        'anotando': sum(1 for m in movs if m['anotando']),
    }


# ===== Saldos =====

def saldos(d, en_cola=()):
    cat = catalogo(d)
    movs = movimientos(d, en_cola)
    hoy_s = hoy().isoformat()
    tc = tc_en(d, hoy_s)
    fecha_tc = max((str(f)[:10] for f, *_ in d['tc'] if f and str(f)[:10] <= hoy_s), default='')
    ultimas_fotos = {}
    for f, c, m in d['fotos']:
        if c and (c not in ultimas_fotos or str(f)[:10] >= ultimas_fotos[c][0]):
            ultimas_fotos[c] = (str(f)[:10], num(m))

    cuentas = []
    for f in d['cuentas']:
        if not f[0] or f[11] == 'No':
            continue
        nombre, moneda, inicial, desde = f[0], f[2] or 'Bs', num(f[4]), str(f[5])[:10]
        saldo = inicial + sum(efecto(m) for m in movs if m['cuenta'] == nombre and m['fecha'] > desde)
        foto = ultimas_fotos.get(nombre)
        dif = None
        if foto and foto[0] > desde:
            calc_en_foto = inicial + sum(efecto(m) for m in movs if m['cuenta'] == nombre and desde < m['fecha'] <= foto[0])
            dif = round(foto[1] - calc_en_foto, 2)
        cuentas.append({'cuenta': nombre, 'dueno': f[1], 'moneda': moneda, 'medio': f[3], 'saldo': round(saldo, 2),
                        'foto': {'fecha': foto[0], 'monto': foto[1]} if foto else None, 'diferencia': dif})

    total_bs = sum(c['saldo'] for c in cuentas if c['moneda'] == 'Bs')
    total_usd = sum(c['saldo'] for c in cuentas if c['moneda'] == 'USD')
    todo_usd = total_bs / tc + total_usd

    # Diezmo: acumulado de antes + % de los ingresos marcados, convertido con el TC de fin de mes
    prev_bs, prev_usd, hasta, pct = (d['diezmo'] + [0, 0, '', 0.1])[:4]
    hasta = str(hasta)[:10]
    pct = num(pct) or 0.1
    con_diezmo = {l['linea'] for l in cat['lineas'] if l['diezmo']}
    por_mes = defaultdict(float)
    for m in movs:
        if m['tipo'] == 'Ingreso' and m['linea'] in con_diezmo and m['fecha'] > hasta:
            por_mes[m['fecha'][:7]] += m['monto']
    diezmo_bs = num(prev_bs) + sum(v * pct for v in por_mes.values())
    diezmo_usd = num(prev_usd)
    for mes, v in por_mes.items():
        a, mm = int(mes[:4]), int(mes[5:7])
        fin = (date(a + (mm == 12), mm % 12 + 1, 1) - timedelta(days=1)).isoformat()
        diezmo_usd += v * pct / tc_en(d, fin)

    return {
        'status': 'success', 'tc': tc, 'fecha_tc': fecha_tc,
        'total_bs': round(total_bs, 2), 'total_usd': round(total_usd, 2), 'todo_usd': round(todo_usd, 2),
        'diezmo_bs': round(diezmo_bs, 2), 'diezmo_usd': round(diezmo_usd, 2),
        'ahorro_real_usd': round(todo_usd - diezmo_usd, 2),
        'cuentas': cuentas,
    }
