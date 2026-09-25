"""
Modelo de la planilla "GESTIÓN <año>" del lado del servidor: catálogo, resumen del mes
(presupuesto contra real) y saldos, calculados sobre la última lectura de la planilla más lo que
está en la cola y todavía no llegó a la hoja.
"""
import re
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BOLIVIA = timezone(timedelta(hours=-4))
COLS = ['COMIDA', 'TRANSPORTE', 'COMPRAS VARIOS', 'SERVICIOS BÁSICOS']  # D:K de a pares (tarjeta, efectivo)
PERSONA = {'EVER': 'Ever', 'MA. NELFI': 'Ma. Nelfi', 'MA.NELFI': 'Ma. Nelfi'}
AUTOR = {'Ever': 'EVER', 'Ma. Nelfi': 'MA. NELFI'}


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
    lineas = [{'categoria': g, 'linea': l, 'columna': col, 'tabla': t, 'tipo': tipo, 'diezmo': dz == 'Sí'}
              for g, l, col, t, tipo, dz in d['lineas'] if l]
    cuentas = []
    for c in d['cuentas']:
        cuentas.append({'cuenta': c[0], 'etiqueta': c[1], 'dueno': c[2], 'moneda': c[3] or 'Bs', 'medio': c[4] or 'Banco',
                        'tc': c[5] or 'Oficial', 'defecto': [x.strip() for x in str(c[6] or '').split(',') if x.strip()],
                        'activa': True})
    reglas = [[normalizar(p), l] for p, l, *_ in d['reglas'] if p and l]
    reglas.sort(key=lambda r: -len(r[0]))
    return {'lineas': lineas, 'cuentas': cuentas, 'reglas': reglas, 'personas': ['Ever', 'Ma. Nelfi']}


def clasificar(texto, reglas, tipo, info):
    t = ' ' + normalizar(texto) + ' '
    for patron, linea in reglas:
        if info.get(linea, {}).get('tipo') == tipo and re.search(r'(?<![a-z0-9])' + re.escape(patron), t):
            return linea
    return None


# ===== Movimientos (de la hoja + de la cola) =====

def movimientos(d, en_cola=()):
    cat = catalogo(d)
    info = {l['linea']: l for l in cat['lineas']}
    out, ids = [], set()
    for fila, fecha, autor, montos, glosa, linea, cuenta, gid in d['gastos']:
        ids.add(gid)
        if not linea:  # fila escrita a mano sin línea: se deduce del detalle
            linea = clasificar(glosa, cat['reglas'], 'Gasto', info) or 'OTROS'
        for k, v in enumerate(montos):
            if v:
                out.append(_mov(gid or f'fila{fila}', fecha, 'Gasto', linea, v, cuenta, PERSONA.get(str(autor).strip().upper(), ''),
                                glosa, 'Efectivo' if k % 2 else 'Banco', info))
    for fecha, concepto, ef, bk, cuenta in d['ingresos']:
        linea = clasificar(concepto, cat['reglas'], 'Ingreso', info) or 'OTROS INGRESOS'
        for v, medio in ((ef, 'Efectivo'), (bk, 'Banco')):
            if v:
                out.append(_mov(f'ing-{fecha}-{medio}', fecha, 'Ingreso', linea, v, cuenta, '', concepto, medio, info))
    for p in en_cola:
        if p['id'] in ids:
            continue
        m = _mov(p['id'], p['fecha'], p['tipo'], p['linea'], p['monto'], p['cuenta'], p.get('persona', ''),
                 p.get('detalle', ''), p.get('medio', 'Banco'), info)
        m['anotando'] = True
        out.append(m)
    return out


def _mov(i, fecha, tipo, linea, monto, cuenta, persona, detalle, medio, info):
    return {'id': i, 'fecha': str(fecha)[:10], 'tipo': tipo, 'linea': linea or '',
            'categoria': info.get(linea, {}).get('categoria', 'OTROS') if tipo == 'Gasto' else 'INGRESOS',
            'monto': num(monto), 'cuenta': cuenta or '', 'persona': persona or '', 'detalle': detalle or '',
            'medio': medio, 'anotando': False}


# ===== Resumen del mes =====

def resumen(d, mes, en_cola=()):
    cat = catalogo(d)
    nmes = int(mes[5:7])
    movs = [m for m in movimientos(d, en_cola) if m['fecha'][:7] == mes]
    hoy_s = hoy().isoformat()
    real, ingresos, por_persona = defaultdict(float), defaultdict(float), defaultdict(float)
    gasto_total = ingreso_total = gasto_hoy = 0.0
    for m in movs:
        m['monto_bs'] = m['monto']
        if m['tipo'] == 'Gasto':
            real[m['linea']] += m['monto']
            gasto_total += m['monto']
            por_persona[m['persona'] or 'Sin autor'] += m['monto']
            if m['fecha'] == hoy_s:
                gasto_hoy += m['monto']
        else:
            ingresos[m['linea']] += m['monto']
            ingreso_total += m['monto']

    pres = {(l, t): meses[nmes - 1] for l, t, meses in d['presupuesto']}
    pres_mensual = sum(v for (l, t), v in pres.items() if t == 'Mensual')
    pres_anual = sum(v for (l, t), v in pres.items() if t == 'Anual')
    por_cat = defaultdict(list)
    for l in cat['lineas']:
        if l['tipo'] != 'Gasto':
            continue
        p = pres.get((l['linea'], l['tabla']), 0)
        r = real.get(l['linea'], 0)
        if p or r:
            por_cat[l['categoria']].append({'linea': l['linea'], 'presupuesto': round(p, 2), 'real': round(r, 2),
                                            'anual': l['tabla'] == 'Anual'})
    conocidas = {l['linea'] for l in cat['lineas']}
    for linea, r in real.items():
        if linea not in conocidas:
            por_cat['OTROS'].append({'linea': linea or '(sin línea)', 'presupuesto': 0, 'real': round(r, 2), 'anual': False})
    orden = list(dict.fromkeys(l['categoria'] for l in cat['lineas'] if l['tipo'] == 'Gasto'))
    categorias = [{'categoria': c, 'presupuesto': round(sum(x['presupuesto'] for x in por_cat[c]), 2),
                   'real': round(sum(x['real'] for x in por_cat[c]), 2), 'lineas': por_cat[c]}
                  for c in orden + [c for c in por_cat if c not in orden] if por_cat.get(c)]
    movs.sort(key=lambda m: (m['fecha'], m['id']), reverse=True)
    return {
        'status': 'success', 'mes': mes, 'gastado': round(gasto_total, 2), 'ingresos': round(ingreso_total, 2),
        'resultado': round(ingreso_total - gasto_total, 2), 'hoy': round(gasto_hoy, 2),
        'presupuesto_mensual': round(pres_mensual, 2), 'presupuesto_anual': round(pres_anual, 2),
        'categorias': categorias,
        'ingresos_por_linea': [{'linea': k, 'monto': round(v, 2)} for k, v in sorted(ingresos.items(), key=lambda x: -x[1])],
        'por_persona': {k: round(v, 2) for k, v in sorted(por_persona.items(), key=lambda x: -x[1])},
        'movimientos': movs, 'anotando': sum(1 for m in movs if m['anotando']),
    }


# ===== Saldos =====

def saldos(d, tc, en_cola=()):
    """tc: {'oficial': x, 'paralelo': y, 'fecha': 'AAAA-MM-DD'} (el del día, de Dólar Blue Bolivia)."""
    cat = catalogo(d)
    info = {l['linea']: l for l in cat['lineas']}
    ultima = d['saldos'][-1] if d['saldos'] else {'fecha': '1900-01-01', 'valores': {}, 'diezmo_bs': 0, 'diezmo_usd': 0}
    desde = ultima['fecha']
    movs = [m for m in movimientos(d, en_cola) if m['fecha'] > desde]
    cuentas = []
    total_bs_usd = total_usd = total_bs = 0.0
    for c in cat['cuentas']:
        foto = num(ultima['valores'].get(c['etiqueta']))
        mov = sum((m['monto'] if m['tipo'] == 'Ingreso' else -m['monto']) for m in movs if m['cuenta'] == c['cuenta'])
        saldo = foto + mov
        tasa = tc['paralelo'] if c['tc'] == 'Paralelo' else tc['oficial']
        if c['moneda'] == 'USD':
            total_usd += saldo
        else:
            total_bs += saldo
            total_bs_usd += saldo / tasa
        cuentas.append({'cuenta': c['cuenta'], 'etiqueta': c['etiqueta'], 'moneda': c['moneda'], 'tc': c['tc'],
                        'saldo': round(saldo, 2), 'foto': {'fecha': desde, 'monto': foto}, 'movimientos': round(mov, 2)})
    # Diezmo: el de la última revisión + el % de los ingresos marcados que entraron después
    ingresos_diezmo = sum(m['monto'] for m in movs if m['tipo'] == 'Ingreso' and info.get(m['linea'], {}).get('diezmo'))
    diezmo_bs = num(ultima.get('diezmo_bs')) + ingresos_diezmo * 0.10
    diezmo_usd = num(ultima.get('diezmo_usd')) + ingresos_diezmo * 0.10 / tc['oficial']
    pendientes = num(ultima.get('pendientes'))
    todo_usd = total_bs_usd - pendientes / tc['oficial'] + total_usd
    return {
        'status': 'success', 'tc_oficial': tc['oficial'], 'tc_paralelo': tc['paralelo'], 'fecha_tc': tc.get('fecha', ''),
        'ultima_revision': desde, 'pendientes': pendientes,
        'total_bs': round(total_bs, 2), 'total_usd': round(total_usd, 2), 'todo_usd': round(todo_usd, 2),
        'diezmo_bs': round(diezmo_bs, 2), 'diezmo_usd': round(diezmo_usd, 2), 'ahorro_real_usd': round(todo_usd - diezmo_usd, 2),
        'cuentas': cuentas,
    }
