'use strict';

// Colores por categoría (los mismos que la planilla). Siempre acompañan al nombre.
const COLOR_CAT = {
  'alimentacion': 'var(--c-alimentacion)', 'movilidad': 'var(--c-movilidad)', 'servicios basicos': 'var(--c-servicios)',
  'varios': 'var(--c-varios)', 'chicos': 'var(--c-chicos)', 'consultorio': 'var(--c-consultorio)',
  'educacion': 'var(--c-educacion)', 'impuestos': 'var(--c-impuestos)', 'compras grandes': 'var(--c-grandes)',
  'ingresos': 'var(--ok)',
};
const colorCat = c => COLOR_CAT[normalizar(c)] || 'var(--tinta-3)';
// En la planilla las líneas están como las escribe ella (SUPERMERCADO); en la app se leen más cómodas
const SIGLAS = new Set(['upsa', 'soat', 'tec', 'mn', 'bnb', 'bmsc', 'cjn', 'bu', 'd.', 'c.', 'lib.']);
const PROPIOS = new Set(['ma.', 'nelfi', 'ever', 'cristo', 'rey', 'mateo', 'lucas', 'thais', 'kicks', 'outlander',
  'gran', 'vitara', 'navi', 'creta', 'binance']);
function bonito(t) {
  return String(t || '').toLowerCase().split(' ').map((w, i) => SIGLAS.has(w) ? w.toUpperCase()
    : (i === 0 || PROPIOS.has(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}
// El valor es lo que se escribe en la columna Persona de la planilla
const PERSONAS = [{ id: 'Ever', nombre: 'Ever' }, { id: 'Ma. Nelfi', nombre: 'Ma. Nelfi' }];

const $ = sel => document.querySelector(sel);

// ===== Guardado local (tolerante a navegadores que lo bloquean) =====
const local = {
  get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// ===== Formatos =====
const nf0 = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function numTxt(n) { const v = Math.round((Number(n) || 0) * 100) / 100; return Number.isInteger(v) ? nf0.format(v) : nf2.format(v); }
// Espacio que no se parte: "Bs 45" nunca queda en dos líneas
const bs = n => (Number(n) < 0 ? `-Bs\u00a0${numTxt(-n)}` : `Bs\u00a0${numTxt(n)}`);
const usd = n => (Number(n) < 0 ? `-$\u00a0${numTxt(-n)}` : `$\u00a0${numTxt(n)}`);
const enMoneda = (n, moneda) => moneda === 'USD' ? usd(n) : bs(n);

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Fecha de hoy en Bolivia, sin importar la zona horaria del celular
function hoyBolivia() {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = Number(x.value); });
  return new Date(p.year, p.month - 1, p.day);
}
const dd = n => String(n).padStart(2, '0');
const aIso = d => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
const deIso = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const mismoDia = (a, b) => aIso(a) === aIso(b);
const fmtDiaLargo = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDiaCorto = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric' });
const fmtMes = new Intl.DateTimeFormat('es-BO', { month: 'long', year: 'numeric' });
const fmtMesSolo = new Intl.DateTimeFormat('es-BO', { month: 'long' });
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);

function textoFecha(d) {
  const hoy = hoyBolivia();
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const largo = fmtDiaLargo.format(d);
  if (mismoDia(d, hoy)) return `Hoy, ${largo}`;
  if (mismoDia(d, ayer)) return `Ayer, ${largo}`;
  return mayus(largo);
}

// ===== Monto: se escribe con coma o punto =====
function limpiarMonto(txt) {
  let s = txt.replace(/[^\d.,]/g, '').replace(/\./g, ',');
  const i = s.indexOf(',');
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '').slice(0, 2);
  if (s.startsWith(',')) s = '0' + s;
  return s.replace(/^0+(?=\d)/, '');
}
const leerMonto = txt => parseFloat((txt || '').replace(',', '.')) || 0;

// ===== API =====
class ErrorApi extends Error {
  constructor(message, status, sinRed = false) { super(message); this.status = status; this.sinRed = sinRed; }
}

async function api(ruta, opciones = {}) {
  let resp;
  try {
    resp = await fetch(ruta, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, ...opciones });
  } catch {
    throw new ErrorApi('Sin conexión con el servidor.', 0, true);
  }
  let data = null;
  try { data = await resp.json(); } catch { /* nginx responde HTML en sus propios errores */ }
  if (resp.status === 401 && ruta !== '/api/login') mostrarLogin('Tu sesión venció. Volvé a entrar.');
  if (!resp.ok || !data || data.status !== 'success') {
    throw new ErrorApi((data && data.message) || `Error del servidor (${resp.status}). Probá de nuevo.`, resp.status);
  }
  return data;
}

function nuevoId() {
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${r}`;
}

// ===== Toast =====
let toastTimer;
function toast(texto, tipo = 'ok') {
  const el = $('#toast');
  const icono = tipo === 'ok' ? 'i-check' : tipo === 'offline' ? 'i-offline' : 'i-x';
  el.className = `toast ${tipo}`;
  el.innerHTML = `<svg class="ic"><use href="#${icono}"/></svg><span>${escapeHtml(texto)}</span>`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, tipo === 'ok' ? 2600 : 5000);
}

// ===== Catálogo (líneas, cuentas, reglas), guardado para usar sin señal =====
let CAT = local.get('qc_catalogo', null);

async function cargarCatalogo() {
  try {
    const c = await api('/api/catalogo');
    CAT = c;
    local.set('qc_catalogo', c);
    sugerirDesdeDetalle();
    pintarLinea(); pintarCuenta(); pintarFrecuentes();
  } catch (err) {
    if (!CAT && !err.sinRed && err.status !== 401) toast(err.message, 'error');
  }
}

const lineasDe = tipo => (CAT ? CAT.lineas.filter(l => l.tipo === tipo) : []);
const infoLinea = nombre => (CAT ? CAT.lineas.find(l => l.linea === nombre) : null);
const cuentasActivas = () => (CAT ? CAT.cuentas.filter(c => c.activa) : []);

function sugerirLinea(detalle, tipo) {
  if (!CAT || !detalle) return null;
  const d = ' ' + normalizar(detalle) + ' ';
  for (const [patron, linea] of CAT.reglas) {
    if (tipo && infoLinea(linea)?.tipo !== tipo) continue;  // "consulta": Salud si es gasto, Consultorio si es ingreso
    if (new RegExp('(?<![a-z0-9])' + patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(d)) return { linea, patron };
  }
  return null;
}

function cuentaPorDefecto(quien, medio) {
  const cs = cuentasActivas();
  const clave = `${quien} · ${medio}`;
  const recordada = local.get('qc_cuentas', {})[clave];
  return (recordada && cs.find(c => c.cuenta === recordada))
    || cs.find(c => c.defecto.includes(clave))
    || cs.find(c => c.medio === medio && c.dueno === quien && c.moneda === 'Bs')
    || cs.find(c => c.medio === medio && c.moneda === 'Bs')
    || cs[0] || null;
}

// ===== Pantallas =====
function mostrar(id) { for (const v of ['#vista-login', '#vista-autor', '#app']) $(v).hidden = v !== id; }

function mostrarLogin(error = '') {
  local.del('qc_entro');
  mostrar('#vista-login');
  $('#login-error').textContent = error;
  setTimeout(() => $('#clave').focus(), 50);
}

let volverA = null;
function mostrarAutor() {
  const actual = local.get('qc_autor', null);
  $('#lista-autores').innerHTML = PERSONAS.map(a => `
    <button type="button" class="autor-opcion" data-autor="${escapeHtml(a.id)}" aria-pressed="${a.id === actual}">
      <span class="chip-inicial">${escapeHtml(a.nombre[0])}</span>${escapeHtml(a.nombre)}
    </button>`).join('');
  mostrar('#vista-autor');
}

const persona = () => local.get('qc_autor', PERSONAS[0].id);

function pintarAutor() {
  const a = PERSONAS.find(x => x.id === persona()) || PERSONAS[0];
  $('#autor-inicial').textContent = a.nombre[0];
  $('#autor-nombre').textContent = a.nombre;
}

function entrarApp() {
  if (!local.get('qc_autor', null)) { mostrarAutor(); return; }
  pintarAutor();
  mostrar('#app');
  cambiarVista(volverA || 'registrar');
  volverA = null;
  pintarCuenta(); pintarFrecuentes();
  cargarCatalogo();
  enviarAutomaticos();
}

function cambiarVista(nombre) {
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.vista === nombre) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  for (const v of ['registrar', 'resumen', 'saldos']) $(`#vista-${v}`).hidden = v !== nombre;
  window.scrollTo(0, 0);
  if (nombre === 'resumen') cargarResumen();
  if (nombre === 'saldos') cargarSaldos();
}

// ===== Formulario =====
const estado = {
  fecha: null,            // null = hoy
  linea: null,            // línea elegida
  lineaManual: false,     // la eligió la persona (no la sugerencia)
  sugerida: null,         // {linea, patron}
  cuenta: null,           // cuenta elegida a mano (si no, la de por defecto)
};

const tipoActual = () => document.querySelector('input[name="tipo"]:checked').value;
const medioActual = () => document.querySelector('input[name="medio"]:checked')?.value || 'Banco';
const fechaActual = () => estado.fecha || hoyBolivia();

function cuentaActual() {
  if (estado.cuenta) return cuentasActivas().find(c => c.cuenta === estado.cuenta) || null;
  return cuentaPorDefecto(persona(), medioActual());
}

function pintarFecha() {
  $('#fecha-texto').textContent = textoFecha(fechaActual());
  $('#btn-fecha').textContent = estado.fecha ? 'Volver a hoy' : 'Cambiar';
}

function pintarLinea() {
  const l = estado.linea ? infoLinea(estado.linea) : null;
  $('#linea-nombre').textContent = estado.linea ? bonito(estado.linea) : (tipoActual() === 'Gasto' ? 'Elegí la línea' : 'Elegí de dónde viene');
  $('#linea-cat').textContent = l ? bonito(l.categoria) : '';
  $('#linea-punto').style.background = l ? colorCat(l.categoria) : 'var(--borde-fuerte)';
  $('#btn-linea').classList.toggle('vacia', !estado.linea);
  const pista = $('#linea-pista');
  if (estado.linea && !estado.lineaManual && estado.sugerida) {
    pista.innerHTML = `<svg class="ic"><use href="#i-magia"/></svg>Elegida sola por “${escapeHtml(estado.sugerida.patron)}”. Tocá para cambiarla.`;
  } else pista.textContent = '';
  actualizarBoton();
}

function pintarFrecuentes() {
  const tipo = tipoActual();
  const frec = ((CAT && CAT.frecuentes && CAT.frecuentes[persona()]) || []).filter(l => infoLinea(l)?.tipo === tipo);
  const base = frec.length ? frec : lineasDe(tipo).slice(0, 6).map(l => l.linea);
  $('#frecuentes').innerHTML = base.slice(0, 6).map(l => {
    const i = infoLinea(l);
    return `<button type="button" class="chip" data-linea="${escapeHtml(l)}" aria-pressed="${l === estado.linea}" style="--c:${colorCat(i && i.categoria)}"><span class="punto"></span>${escapeHtml(bonito(l))}</button>`;
  }).join('');
}

function pintarCuenta() {
  const c = cuentaActual();
  $('#cuenta-nombre').textContent = c ? `${c.cuenta}${c.moneda === 'USD' ? ' (en dólares)' : ''}` : 'Elegí la cuenta';
  actualizarBoton();
}

function pintarTipo() {
  const ingreso = tipoActual() === 'Ingreso';
  $('#detalle-label').textContent = ingreso ? '¿De qué?' : '¿En qué?';
  $('#detalle').placeholder = ingreso ? 'Ej.: sueldo septiembre, consultas' : 'Ej.: hipermaxi, pan, gasolina kicks';
  $('#linea-label').textContent = ingreso ? 'Tipo de ingreso' : 'Línea del presupuesto';
  $('#medio-label').textContent = ingreso ? 'Entró a' : 'Pagado con';
  if (estado.linea && infoLinea(estado.linea)?.tipo !== tipoActual()) { estado.linea = null; estado.lineaManual = false; }
  sugerirDesdeDetalle();
  pintarFrecuentes();
  pintarLinea();
}

function sugerirDesdeDetalle() {
  if (estado.lineaManual) return;
  const s = sugerirLinea($('#detalle').value, tipoActual());
  const valida = s && infoLinea(s.linea)?.tipo === tipoActual();
  estado.sugerida = valida ? s : null;
  estado.linea = valida ? s.linea : null;
}

function leerFormulario() {
  const c = cuentaActual();
  return {
    tipo: tipoActual(), monto: leerMonto($('#monto').value), detalle: $('#detalle').value.trim(),
    linea: estado.linea, cuenta: c ? c.cuenta : '', moneda: c ? c.moneda : 'Bs', fecha: aIso(fechaActual()),
  };
}

function faltante(f) {
  if (!(f.monto > 0)) return 'Ingresá el monto';
  if (!f.linea) return f.tipo === 'Gasto' ? 'Elegí la línea' : 'Elegí de dónde viene';
  if (!f.cuenta) return 'Elegí la cuenta';
  return '';
}

let enviando = false;
function actualizarBoton() {
  if (enviando) return;
  const f = leerFormulario();
  const falta = faltante(f);
  const btn = $('#btn-registrar');
  btn.disabled = !!falta;
  btn.innerHTML = falta ? escapeHtml(falta)
    : `Registrar <span class="num">${escapeHtml(enMoneda(f.monto, f.moneda))}</span> <span class="btn-sub">en ${escapeHtml(bonito(f.linea))}</span>`;
  $('#btn-lista').disabled = !!falta;
}

function armarRegistro(f) {
  return {
    id: nuevoId(), estado: 'lista', auto: false,
    ...f,
    payload: { fecha: f.fecha, tipo: f.tipo, linea: f.linea, monto: f.monto, cuenta: f.cuenta, persona: persona(), detalle: f.detalle,
      medio: cuentaActual()?.medio === 'Efectivo' ? 'Efectivo' : 'Banco' },
  };
}

function limpiarFormulario() {
  $('#monto').value = '';
  $('#detalle').value = '';
  estado.linea = null; estado.lineaManual = false; estado.sugerida = null;
  pintarLinea(); pintarFrecuentes();
  actualizarBoton();
}

// Si la persona corrigió la línea de un detalle corto, la app lo aprende (y la planilla también)
function aprender(f) {
  if (f.tipo !== 'Gasto' || !estado.lineaManual || !f.detalle) return;
  const palabra = normalizar(f.detalle);
  if (palabra.length < 3 || palabra.split(' ').length > 3) return;
  if (estado.sugerida && estado.sugerida.linea === f.linea) return;
  if (CAT) {
    CAT.reglas = [[palabra, f.linea], ...CAT.reglas.filter(r => r[0] !== palabra)].sort((a, b) => b[0].length - a[0].length);
    local.set('qc_catalogo', CAT);
  }
  api('/api/regla', { method: 'POST', body: JSON.stringify({ palabra, linea: f.linea, quien: persona() }) }).catch(() => {});
}

function recordarCuenta(f) {
  if (!estado.cuenta) return;
  const m = local.get('qc_cuentas', {});
  m[`${persona()} · ${medioActual()}`] = f.cuenta;
  local.set('qc_cuentas', m);
}

async function registrar(e) {
  e.preventDefault();
  const f = leerFormulario();
  if (faltante(f) || enviando) return;
  const reg = armarRegistro(f);
  aprender(f);
  recordarCuenta(f);

  if (!navigator.onLine) {
    guardarPendiente({ ...reg, auto: true });
    limpiarFormulario();
    toast('Sin señal: quedó guardado en el celular y se envía solo.', 'offline');
    return;
  }
  enviando = true;
  const btn = $('#btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    await enviarAlServidor(reg);
    limpiarFormulario();  // al instante: si ya empieza a escribir el siguiente, no se le borra
    toast(`Guardado: ${enMoneda(f.monto, f.moneda)} en ${bonito(f.linea)}`);
  } catch (err) {
    if (err.sinRed || err.status >= 500) {
      guardarPendiente({ ...reg, auto: true });
      limpiarFormulario();
      toast('Sin señal: quedó guardado en el celular y se envía solo.', 'offline');
    } else if (err.status !== 401) {
      toast(err.message, 'error');
    }
  } finally {
    enviando = false;
    actualizarBoton();
  }
}

function agregarALista() {
  const f = leerFormulario();
  if (faltante(f)) return;
  aprender(f);
  recordarCuenta(f);
  guardarPendiente(armarRegistro(f));
  limpiarFormulario();
  $('#monto').focus();
  toast(`Agregado a la lista: ${enMoneda(f.monto, f.moneda)}`);
}

// ===== Envío: el servidor acepta al instante y anota en la planilla por detrás =====
async function enviarAlServidor(reg) {
  await api('/api/registro', { method: 'POST', body: JSON.stringify({ ...reg.payload, id: reg.id }) });
  const { auto, estado: _e, error, ...guardar } = reg;
  local.set('qc_seguimiento', [...local.get('qc_seguimiento', []).filter(x => x.id !== reg.id), guardar]);
  resumenCache.clear(); saldosCache = null;
  pintarAnotando();
  seguir();
}

let seguimientoTimer = null;
function seguir(demora = 2500) {
  clearTimeout(seguimientoTimer);
  if (local.get('qc_seguimiento', []).length) seguimientoTimer = setTimeout(revisarSeguimiento, demora);
}

async function revisarSeguimiento() {
  const lista = local.get('qc_seguimiento', []);
  if (!lista.length || !navigator.onLine) { seguir(5000); return; }
  let r;
  try { r = await api(`/api/registros?ids=${lista.map(x => x.id).join(',')}`); } catch { seguir(8000); return; }
  const porId = Object.fromEntries(r.registros.map(x => [x.id, x]));
  const siguen = [];
  let errores = 0;
  for (const reg of lista) {
    const e = porId[reg.id];
    if (!e || e.estado === 'hecho') continue;
    if (e.estado === 'error') {
      errores++;
      guardarPendiente({ ...reg, id: nuevoId(), estado: 'lista', auto: false, error: `La planilla lo rechazó: ${e.error}` });
      continue;
    }
    siguen.push(reg);
  }
  local.set('qc_seguimiento', siguen);
  pintarAnotando();
  if (errores) toast(`${errores === 1 ? 'Un movimiento no se pudo anotar' : `${errores} movimientos no se pudieron anotar`}. Está en "Por registrar".`, 'error');
  seguir(siguen.length ? 3000 : 0);
}

function pintarAnotando() {
  const n = local.get('qc_seguimiento', []).length;
  const el = $('#anotando');
  el.hidden = n === 0;
  el.querySelector('span').textContent = n === 1 ? 'Anotando 1 movimiento en la planilla…' : `Anotando ${n} movimientos en la planilla…`;
}

// ===== Pendientes (lista y registros sin señal) =====
function pendientes() { return local.get('qc_pendientes', []).filter(p => p.payload && p.payload.linea); }
function guardarPendientes(lista) { local.set('qc_pendientes', lista); pintarPendientes(); }
function guardarPendiente(reg) { guardarPendientes([...pendientes(), reg]); }
function quitarPendiente(id) { guardarPendientes(pendientes().filter(p => p.id !== id)); }

let enviandoLista = false;
function pintarPendientes() {
  const lista = pendientes();
  $('#pendientes').hidden = lista.length === 0;
  if (!lista.length) return;
  $('#pendientes-total').textContent = bs(lista.reduce((s, p) => s + (p.tipo === 'Gasto' ? p.monto : 0), 0));
  const hoy = aIso(hoyBolivia());
  $('#pendientes-lista').innerHTML = lista.map(p => {
    const i = infoLinea(p.linea);
    const meta = [p.detalle, p.cuenta, p.fecha !== hoy ? textoFecha(deIso(p.fecha)) : '',
      p.auto ? 'Se envía solo al volver la señal' : '', p.error || ''].filter(Boolean).map(escapeHtml).join('. ');
    return `
      <li class="fila" style="--c:${colorCat(i && i.categoria)}">
        <span class="punto" aria-hidden="true"></span>
        <div class="fila-texto"><div class="fila-titulo">${p.tipo === 'Ingreso' ? 'Ingreso: ' : ''}${escapeHtml(bonito(p.linea))}</div>${meta ? `<div class="fila-meta">${meta}</div>` : ''}</div>
        <span class="fila-monto num${p.tipo === 'Ingreso' ? ' ingreso' : ''}">${escapeHtml(enMoneda(p.monto, p.moneda))}</span>
        <div class="fila-acciones"><button type="button" class="btn-icono" data-quitar="${p.id}" aria-label="Quitar de la lista"><svg class="ic"><use href="#i-x"/></svg></button></div>
      </li>`;
  }).join('');
  const btn = $('#btn-enviar-lista');
  if (!enviandoLista) {
    btn.disabled = false;
    btn.textContent = lista.length === 1 ? 'Registrar' : `Registrar los ${lista.length}`;
  }
}

// Manda de a uno; cada registro aceptado sale de la lista al instante (el id evita duplicados)
async function enviarLista(soloAutomaticos = false) {
  if (enviandoLista || !navigator.onLine) return;
  const cola = pendientes().filter(p => !soloAutomaticos || p.auto);
  if (!cola.length) return;
  enviandoLista = true;
  const btn = $('#btn-enviar-lista');
  btn.disabled = true;
  let ok = 0, ultimoError = '';
  for (let i = 0; i < cola.length; i++) {
    const p = cola[i];
    btn.textContent = `Guardando ${i + 1} de ${cola.length}…`;
    try {
      await enviarAlServidor(p);
      ok++;
      guardarPendientes(pendientes().filter(x => x.id !== p.id));
    } catch (err) {
      if (err.status === 401) break;
      ultimoError = err.message;
      guardarPendientes(pendientes().map(x => x.id !== p.id ? x : { ...x, error: err.sinRed ? '' : err.message }));
      if (err.sinRed || err.status >= 500) break;
    }
  }
  enviandoLista = false;
  pintarPendientes();
  if (ok === cola.length) toast(ok === 1 ? 'Guardado' : `${ok} movimientos guardados`);
  else if (!soloAutomaticos || ok > 0) toast(`${ok} de ${cola.length} guardados. ${ultimoError}`, 'error');
}

function enviarAutomaticos() { if (navigator.onLine) { enviarLista(true); seguir(0); } }
function pintarConexion() { $('#aviso-offline').hidden = navigator.onLine; }

// ===== Selector (hoja inferior) =====
let alElegir = null;
function abrirSelector(titulo, grupos, elegido, callback) {
  alElegir = callback;
  $('#selector-titulo').textContent = titulo;
  $('#selector-buscar').value = '';
  $('#selector-lista').innerHTML = grupos.map(g => `
    <div class="hoja-grupo" data-grupo>
      ${g.titulo ? `<p class="hoja-grupo-titulo" style="color:${g.color || 'var(--tinta-2)'}">${escapeHtml(bonito(g.titulo))}</p>` : ''}
      ${g.items.map(it => `<button type="button" class="hoja-item" data-valor="${escapeHtml(it.valor)}" data-buscar="${escapeHtml(normalizar(it.texto + ' ' + (g.titulo || '')))}" aria-pressed="${it.valor === elegido}">
        <span class="punto" style="background:${g.color || 'var(--tinta-3)'}"></span><span>${escapeHtml(it.texto)}</span>${it.sub ? `<span class="suave hoja-sub">${escapeHtml(it.sub)}</span>` : ''}
        ${it.valor === elegido ? '<svg class="ic"><use href="#i-check"/></svg>' : ''}</button>`).join('')}
    </div>`).join('');
  const dlg = $('#selector');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function cerrarSelector() {
  const dlg = $('#selector');
  if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
}

function elegirLinea() {
  const tipo = tipoActual();
  const grupos = [];
  for (const l of lineasDe(tipo)) {
    let g = grupos.find(x => x.titulo === l.categoria);
    if (!g) grupos.push(g = { titulo: l.categoria, color: colorCat(l.categoria), items: [] });
    g.items.push({ valor: l.linea, texto: bonito(l.linea) });
  }
  abrirSelector(tipo === 'Gasto' ? 'Línea del presupuesto' : 'Tipo de ingreso', grupos, estado.linea, v => {
    estado.linea = v; estado.lineaManual = true;
    pintarLinea(); pintarFrecuentes();
  });
}

function elegirCuenta() {
  const grupos = [];
  for (const c of cuentasActivas()) {
    const titulo = c.medio === 'Banco' ? 'Bancos' : c.medio;
    let g = grupos.find(x => x.titulo === titulo);
    if (!g) grupos.push(g = { titulo, items: [] });
    g.items.push({ valor: c.cuenta, texto: c.cuenta, sub: c.moneda === 'USD' ? 'dólares' : '' });
  }
  abrirSelector(tipoActual() === 'Gasto' ? '¿De qué cuenta salió?' : '¿A qué cuenta entró?', grupos, cuentaActual()?.cuenta, v => {
    estado.cuenta = v;
    const c = cuentasActivas().find(x => x.cuenta === v);
    if (c && c.medio !== 'Cripto') {
      const r = document.querySelector(`input[name="medio"][value="${c.medio}"]`);
      if (r) r.checked = true;
    }
    pintarCuenta();
  });
}

// ===== Resumen =====
const resumenCache = new Map();
let mesVista = null;
let intentosActualizar = 0;
let movimientosVisibles = 30;
const claveMes = d => `${d.getFullYear()}-${dd(d.getMonth() + 1)}`;

async function cargarResumen(forzar = false) {
  const hoy = hoyBolivia();
  if (!mesVista) mesVista = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const clave = claveMes(mesVista);
  const esActual = clave === claveMes(hoy);
  $('#t-resumen').textContent = mayus(fmtMes.format(mesVista));
  $('#mes-sig').disabled = esActual;
  const cuerpo = $('#resumen-cuerpo');

  const guardado = !forzar && resumenCache.get(clave);
  if (guardado && !guardado.actualizando) { pintarResumen(guardado, esActual); return; }
  const copia = guardado || local.get(`qc_res_${clave}`, null);
  if (copia) pintarResumen(copia, esActual);
  else cuerpo.innerHTML = '<div class="esqueleto" aria-label="Cargando"><i></i><i></i><i></i><i></i></div>';
  try {
    const data = await api(`/api/resumen?mes=${clave}`);
    resumenCache.set(clave, data);
    local.set(`qc_res_${clave}`, data);
    if (claveMes(mesVista) === clave) pintarResumen(data, esActual);
    if (data.actualizando && intentosActualizar < 4) {
      intentosActualizar++;
      setTimeout(() => { if (claveMes(mesVista) === clave && !$('#vista-resumen').hidden) cargarResumen(true); }, 3500);
    } else intentosActualizar = 0;
  } catch (err) {
    if (copia || err.status === 401 || claveMes(mesVista) !== clave) return;
    cuerpo.innerHTML = `<div class="error-bloque"><p>${escapeHtml(err.message)}</p>
      <button type="button" class="btn-secundario" id="btn-reintentar-resumen"><svg class="ic"><use href="#i-reintentar"/></svg>Reintentar</button></div>`;
    $('#btn-reintentar-resumen').onclick = () => cargarResumen(true);
  }
}

function barra(real, pres) {
  if (!pres) return `<span class="pista-barra sin-pres" aria-hidden="true"><i style="width:100%"></i></span>`;
  const pct = Math.min(real / pres, 1) * 100;
  return `<span class="pista-barra${real > pres ? ' pasado' : ''}" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
}

function textoUso(real, pres) {
  if (!pres) return 'Sin presupuesto';
  const q = pres - real;
  return q >= 0 ? `Quedan ${bs(q)}` : `Se pasó por ${bs(-q)}`;
}

function pintarResumen(r, esActual) {
  const cuerpo = $('#resumen-cuerpo');
  const nombreMes = fmtMesSolo.format(mesVista);
  const pres = r.presupuesto_mensual + r.presupuesto_anual;
  if (!r.gastado && !r.ingresos && !pres) {
    cuerpo.innerHTML = `<div class="vacio"><strong>Sin movimientos en ${escapeHtml(nombreMes)}</strong>Lo que registres este mes va a aparecer acá.</div>`;
    return;
  }
  const abiertas = new Set(local.get('qc_cat_abiertas', []));
  const pctTotal = pres ? r.gastado / pres : 0;

  const dias = [];
  for (const m of r.movimientos.slice(0, movimientosVisibles)) {
    if (!dias.length || dias[dias.length - 1].fecha !== m.fecha) dias.push({ fecha: m.fecha, items: [] });
    dias[dias.length - 1].items.push(m);
  }

  cuerpo.innerHTML = `
    <div class="total">
      <p class="total-texto-arriba">Gastado en ${escapeHtml(nombreMes)}</p>
      <p class="total-monto"><span class="moneda">Bs</span>${escapeHtml(numTxt(r.gastado))}</p>
      ${pres ? `<div class="total-barra">${barra(r.gastado, pres)}</div>
        <p class="total-texto">${Math.round(pctTotal * 100)}% de ${escapeHtml(bs(pres))} presupuestados. <strong>${escapeHtml(textoUso(r.gastado, pres))}</strong></p>`
        : '<p class="total-texto">Sin presupuesto cargado para este mes.</p>'}
      <div class="cifras">
        <div><span>Ingresos</span><strong class="num ingreso">${escapeHtml(bs(r.ingresos))}</strong></div>
        <div><span>Resultado</span><strong class="num ${r.resultado < 0 ? 'negativo' : 'ingreso'}">${escapeHtml(bs(r.resultado))}</strong></div>
        ${esActual ? `<div><span>Hoy</span><strong class="num">${escapeHtml(bs(r.hoy))}</strong></div>` : ''}
      </div>
      ${r.proyeccion ? `<div class="proyeccion">
        <span class="proyeccion-titulo">Proyección a fin de mes</span>
        <strong class="num">${escapeHtml(bs(Math.round(r.proyeccion.total)))}</strong>
        <span class="proyeccion-texto">Lo gastado hasta hoy más lo que se suele gastar del ${r.proyeccion.desde_dia} a fin de mes (${escapeHtml(bs(Math.round(r.proyeccion.resto)))}, promedio de ${r.proyeccion.meses.map(m => fmtMesSolo.format(new Date(2026, m - 1, 1))).join(', ')}).${pres ? ` Quedaría en ${Math.round(r.proyeccion.total / pres * 100)}% del presupuesto.` : ''}</span>
      </div>` : ''}
      ${r.anotando ? `<p class="anotando"><i aria-hidden="true"></i><span>${r.anotando} todavía anotándose en la planilla (ya están sumados)</span></p>` : ''}
    </div>

    <section class="bloque" aria-labelledby="t-cat">
      <h2 id="t-cat" class="bloque-titulo">Presupuesto contra real</h2>
      <ul class="cats">
        ${r.categorias.map(c => {
          const color = colorCat(c.categoria);
          const abierta = abiertas.has(c.categoria);
          return `<li class="cat" style="--c:${color}">
            <button type="button" class="cat-cabeza" data-cat="${escapeHtml(c.categoria)}" aria-expanded="${abierta}">
              <span class="cat-nombre"><span class="punto"></span>${escapeHtml(bonito(c.categoria))}</span>
              <span class="cat-monto num">${escapeHtml(bs(c.real))}</span>
              ${barra(c.real, c.presupuesto)}
              <span class="cat-uso">${escapeHtml(c.presupuesto ? `de ${bs(c.presupuesto)}. ${textoUso(c.real, c.presupuesto)}` : 'Sin presupuesto')}</span>
              <svg class="ic cat-flecha"><use href="#i-abajo"/></svg>
            </button>
            <ul class="lineas" ${abierta ? '' : 'hidden'}>
              ${c.lineas.map(l => `<li class="linea-fila">
                <span class="linea-nombre">${escapeHtml(bonito(l.linea))}${l.anual ? ' <span class="etiqueta">anual</span>' : ''}</span>
                <span class="num">${escapeHtml(bs(l.real))}</span>
                ${barra(l.real, l.presupuesto)}
                <span class="cat-uso">${escapeHtml(l.presupuesto ? `de ${bs(l.presupuesto)}. ${textoUso(l.real, l.presupuesto)}` : 'Sin presupuesto')}</span>
              </li>`).join('')}
            </ul>
          </li>`;
        }).join('')}
      </ul>
    </section>

    ${r.ingresos_por_linea.length ? `<section class="bloque" aria-labelledby="t-ing">
      <h2 id="t-ing" class="bloque-titulo">Ingresos</h2>
      <ul class="lista-simple">${r.ingresos_por_linea.map(i => `<li><span>${escapeHtml(bonito(i.linea))}</span><strong class="num ingreso">${escapeHtml(bs(i.monto))}</strong></li>`).join('')}</ul>
    </section>` : ''}

    ${Object.keys(r.por_persona).length ? `<section class="bloque" aria-labelledby="t-per">
      <h2 id="t-per" class="bloque-titulo">Gastado por persona</h2>
      <ul class="lista-simple">${Object.entries(r.por_persona).map(([p, v]) => `<li><span>${escapeHtml(p)}</span><strong class="num">${escapeHtml(bs(v))}</strong></li>`).join('')}</ul>
    </section>` : ''}

    <section class="bloque" aria-labelledby="t-mov">
      <h2 id="t-mov" class="bloque-titulo">Movimientos</h2>
      ${dias.map(d => `<div class="dia">
        <div class="dia-cabeza"><span>${escapeHtml(fmtDiaCorto.format(deIso(d.fecha)))}</span></div>
        <ul class="filas">${d.items.map(m => {
          const meta = [m.anotando ? 'Anotando en la planilla…' : '', m.detalle, m.persona, m.cuenta].filter(Boolean).map(escapeHtml).join(', ');
          return `<li class="fila fila-mov" style="--c:${colorCat(m.tipo === 'Ingreso' ? 'INGRESOS' : m.categoria)}">
            <span class="punto" aria-hidden="true"></span>
            <div class="fila-texto"><div class="fila-titulo">${escapeHtml(bonito(m.linea || m.tipo))}</div><div class="fila-meta">${meta}</div></div>
            <span class="fila-monto num${m.tipo === 'Ingreso' ? ' ingreso' : ''}">${m.tipo === 'Ingreso' ? '+' : ''}${escapeHtml(bs(m.monto_bs))}</span>
          </li>`;
        }).join('')}</ul></div>`).join('')}
      ${r.movimientos.length > movimientosVisibles ? `<button type="button" class="btn-secundario" id="btn-mas">Ver ${Math.min(30, r.movimientos.length - movimientosVisibles)} más</button>` : ''}
    </section>`;

  cuerpo.querySelectorAll('.cat-cabeza').forEach(b => b.addEventListener('click', () => {
    const lista = b.nextElementSibling;
    const abrir = lista.hidden;
    lista.hidden = !abrir;
    b.setAttribute('aria-expanded', String(abrir));
    const s = new Set(local.get('qc_cat_abiertas', []));
    if (abrir) s.add(b.dataset.cat); else s.delete(b.dataset.cat);
    local.set('qc_cat_abiertas', [...s]);
  }));
  const mas = $('#btn-mas');
  if (mas) mas.onclick = () => { movimientosVisibles += 30; pintarResumen(r, esActual); };
}

function moverMes(delta) {
  mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + delta, 1);
  movimientosVisibles = 30;
  cargarResumen();
}

// ===== Saldos =====
let saldosCache = null;
let cargandoFoto = false;
const fechaCorta = iso => iso.split('-').reverse().join('/');

async function cargarSaldos(forzar = false) {
  const cuerpo = $('#saldos-cuerpo');
  const copia = (!forzar && saldosCache) || local.get('qc_saldos', null);
  if (copia && !cargandoFoto) pintarSaldos(copia);
  else if (!copia) cuerpo.innerHTML = '<div class="esqueleto" aria-label="Cargando"><i></i><i></i><i></i></div>';
  try {
    const s = await api('/api/saldos');
    saldosCache = s;
    local.set('qc_saldos', s);
    if (!cargandoFoto) pintarSaldos(s);
    if (s.actualizando) setTimeout(() => { if (!$('#vista-saldos').hidden && !cargandoFoto) cargarSaldos(true); }, 4000);
  } catch (err) {
    if (copia || err.status === 401) return;
    cuerpo.innerHTML = `<div class="error-bloque"><p>${escapeHtml(err.message)}</p>
      <button type="button" class="btn-secundario" id="btn-reintentar-saldos"><svg class="ic"><use href="#i-reintentar"/></svg>Reintentar</button></div>`;
    $('#btn-reintentar-saldos').onclick = () => cargarSaldos(true);
  }
}

function pintarSaldos(s) {
  const cuerpo = $('#saldos-cuerpo');
  cuerpo.innerHTML = `
    <div class="total">
      <p class="total-texto-arriba">Ahorro real</p>
      <p class="total-monto"><span class="moneda">$</span>${escapeHtml(numTxt(s.ahorro_real_usd))}</p>
      <p class="total-texto">Todo en dólares ${escapeHtml(usd(s.todo_usd))}, menos el diezmo ${escapeHtml(usd(s.diezmo_usd))}.</p>
      <div class="cifras dos">
        <div><span>En bolivianos</span><strong class="num">${escapeHtml(bs(s.total_bs))}</strong></div>
        <div><span>En dólares</span><strong class="num">${escapeHtml(usd(s.total_usd))}</strong></div>
        <div><span>Dólar banco</span><strong class="num">${escapeHtml(nf2.format(s.tc_oficial))}</strong></div>
        <div><span>Dólar paralelo</span><strong class="num">${escapeHtml(nf2.format(s.tc_paralelo))}</strong></div>
      </div>
      <p class="pista">Las cuentas de banco se pasan a dólares con el dólar del banco; el efectivo, con el paralelo.</p>
      ${graficoAhorro(s.historia)}
    </div>

    <section class="bloque" aria-labelledby="t-cuentas">
      <h2 id="t-cuentas" class="bloque-titulo">Cuentas</h2>
      <ul class="filas">${s.cuentas.map(c => `
        <li class="fila fila-cuenta">
          <div class="fila-texto"><div class="fila-titulo">${escapeHtml(c.cuenta)}</div>
          <div class="fila-meta">${c.movimientos ? `${escapeHtml(enMoneda(c.foto.monto, c.moneda))} al ${escapeHtml(fechaCorta(c.foto.fecha))}, ${c.movimientos > 0 ? '+' : ''}${escapeHtml(numTxt(c.movimientos))} registrado después`
            : `Revisado el ${escapeHtml(fechaCorta(c.foto.fecha))}`}</div></div>
          <span class="fila-monto num">${escapeHtml(enMoneda(c.saldo, c.moneda))}</span>
        </li>`).join('')}</ul>
      <button type="button" class="btn-primario" id="btn-foto">Revisar saldos de hoy</button>
      <p class="pista">Anotá lo que muestra cada cuenta: se agrega una columna nueva en la hoja SALDOS.</p>
    </section>
    ${s.conciliacion ? `<section class="bloque" aria-labelledby="t-cuadra">
      <h2 id="t-cuadra" class="bloque-titulo">¿Cuadran los saldos?</h2>
      <p class="pista">Entre las revisiones del ${escapeHtml(fechaCorta(s.conciliacion.desde))} y el ${escapeHtml(fechaCorta(s.conciliacion.hasta))}, en bolivianos.</p>
      <ul class="lista-simple cuadra">
        <li><span>Cambió la plata</span><strong class="num">${escapeHtml(bs(s.conciliacion.cambio))}</strong></li>
        <li><span>Ingresos anotados</span><strong class="num">${escapeHtml(bs(s.conciliacion.ingresos))}</strong></li>
        <li><span>Gastos anotados</span><strong class="num">${escapeHtml(bs(-s.conciliacion.gastos))}</strong></li>
        <li class="cuadra-total${Math.abs(s.conciliacion.sin_anotar) >= 1 ? ' descuadre' : ''}"><span>Sin anotar</span><strong class="num">${escapeHtml(bs(s.conciliacion.sin_anotar))}</strong></li>
      </ul>
      <p class="pista">${Math.abs(s.conciliacion.sin_anotar) < 1 ? 'Todo lo que se movió está anotado.'
        : s.conciliacion.sin_anotar < 0 ? 'Salió plata que no se anotó: gastos, transferencias o comisiones.' : 'Entró plata que no se anotó.'}</p>
    </section>` : ''}`;
  $('#btn-foto').onclick = () => pintarFormFoto(s);
}

// Evolución del ahorro real en cada revisión (línea simple, sin librerías)
function graficoAhorro(h) {
  if (!h || h.length < 2) return '';
  const w = 320, alto = 64, v = h.map(x => x.ahorro);
  const min = Math.min(...v), max = Math.max(...v), rango = max - min || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(alto - 4 - (y - min) / rango * (alto - 8)).toFixed(1)}`).join(' ');
  return `<figure class="evolucion">
    <svg viewBox="0 0 ${w} ${alto}" preserveAspectRatio="none" role="img" aria-label="Ahorro real de ${escapeHtml(usd(v[0]))} a ${escapeHtml(usd(v[v.length - 1]))}">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <figcaption><span>${escapeHtml(fechaCorta(h[0].fecha))}</span><span>Ahorro real en cada revisión</span><span>${escapeHtml(fechaCorta(h[h.length - 1].fecha))}</span></figcaption>
  </figure>`;
}

function pintarFormFoto(s) {
  cargandoFoto = true;
  const cuerpo = $('#saldos-cuerpo');
  cuerpo.innerHTML = `
    <form id="form-foto" class="bloque" novalidate>
      <h2 class="bloque-titulo">Saldos de hoy</h2>
      <p class="pista">Viene con lo que calcula la planilla. Cambiá solo lo que sea distinto.</p>
      <div class="foto-fila">
        <label for="foto-pendientes">Gastos pendientes (ya comprometidos)</label>
        <div class="foto-entrada"><span>Bs</span><input id="foto-pendientes" class="campo num" inputmode="decimal" value="${escapeHtml(String(s.pendientes || '').replace('.', ','))}"></div>
      </div>
      ${s.cuentas.map((c, i) => `
        <div class="foto-fila">
          <label for="foto-${i}">${escapeHtml(c.cuenta)}</label>
          <div class="foto-entrada"><span>${c.moneda === 'USD' ? '$' : 'Bs'}</span>
            <input id="foto-${i}" data-cuenta="${escapeHtml(c.cuenta)}" data-calc="${c.saldo}" class="campo num" inputmode="decimal" value="${escapeHtml(String(c.saldo).replace('.', ','))}"></div>
          <p class="foto-dif" id="foto-dif-${i}"></p>
        </div>`).join('')}
      <button class="btn-primario" type="submit">Guardar saldos</button>
      <button class="btn-secundario" type="button" id="foto-cancelar">Cancelar</button>
    </form>`;
  cuerpo.querySelectorAll('input[data-cuenta]').forEach((inp, i) => inp.addEventListener('input', () => {
    inp.value = limpiarMonto(inp.value);
    const dif = leerMonto(inp.value) - Number(inp.dataset.calc);
    $(`#foto-dif-${i}`).textContent = Math.abs(dif) >= 1 ? `${dif > 0 ? '+' : ''}${numTxt(dif)} contra lo calculado` : '';
  }));
  $('#foto-pendientes').addEventListener('input', e => { e.target.value = limpiarMonto(e.target.value); });
  $('#foto-cancelar').onclick = () => { cargandoFoto = false; pintarSaldos(s); };
  $('#form-foto').addEventListener('submit', async e => {
    e.preventDefault();
    const saldos = [...cuerpo.querySelectorAll('input[data-cuenta]')].map(inp => ({ cuenta: inp.dataset.cuenta, monto: leerMonto(inp.value) }));
    const btn = e.target.querySelector('.btn-primario');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await api('/api/saldos', { method: 'POST', body: JSON.stringify({ id: nuevoId(), fecha: aIso(hoyBolivia()), saldos, pendientes: leerMonto($('#foto-pendientes').value) }) });
      toast('Saldos guardados');
      cargandoFoto = false;
      saldosCache = null;
      pintarSaldos(s);
      setTimeout(() => { if (!$('#vista-saldos').hidden) cargarSaldos(true); }, 6000);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Guardar saldos';
    }
  });
}

// ===== Arranque =====
function conectarEventos() {
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const clave = $('#clave').value;
    if (!clave) { $('#login-error').textContent = 'Escribí la clave.'; return; }
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ clave }) });
      local.set('qc_entro', true);
      $('#clave').value = ''; $('#login-error').textContent = '';
      entrarApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
  });

  $('#lista-autores').addEventListener('click', e => {
    const b = e.target.closest('[data-autor]');
    if (!b) return;
    local.set('qc_autor', b.dataset.autor);
    estado.cuenta = null;
    entrarApp();
  });
  $('#btn-autor').addEventListener('click', () => {
    volverA = ['registrar', 'resumen', 'saldos'].find(v => !$(`#vista-${v}`).hidden) || 'registrar';
    mostrarAutor();
  });

  const monto = $('#monto');
  monto.addEventListener('input', () => {
    const limpio = limpiarMonto(monto.value);
    if (limpio !== monto.value) monto.value = limpio;
    actualizarBoton();
  });
  $('#detalle').addEventListener('input', () => { sugerirDesdeDetalle(); pintarLinea(); pintarFrecuentes(); });
  document.querySelectorAll('input[name="tipo"]').forEach(r => r.addEventListener('change', () => {
    estado.cuenta = null; pintarTipo(); pintarCuenta();
  }));
  document.querySelectorAll('input[name="medio"]').forEach(r => r.addEventListener('change', () => {
    local.set('qc_medio', medioActual());
    estado.cuenta = null; pintarCuenta();
  }));
  $('#btn-linea').addEventListener('click', elegirLinea);
  $('#btn-cuenta').addEventListener('click', elegirCuenta);
  $('#frecuentes').addEventListener('click', e => {
    const b = e.target.closest('[data-linea]');
    if (!b) return;
    estado.linea = b.dataset.linea; estado.lineaManual = true;
    pintarLinea(); pintarFrecuentes();
  });
  $('#form-mov').addEventListener('submit', registrar);
  $('#btn-lista').addEventListener('click', agregarALista);

  $('#btn-fecha').addEventListener('click', () => {
    const input = $('#fecha');
    if (estado.fecha) { estado.fecha = null; input.hidden = true; }
    else {
      input.hidden = false;
      input.max = aIso(hoyBolivia());
      input.value = aIso(hoyBolivia());
      input.focus();
      try { input.showPicker(); } catch { /* no todos los navegadores */ }
    }
    pintarFecha();
  });
  $('#fecha').addEventListener('change', e => {
    if (!e.target.value) return;
    const d = deIso(e.target.value);
    estado.fecha = mismoDia(d, hoyBolivia()) ? null : d;
    if (!estado.fecha) e.target.hidden = true;
    pintarFecha();
  });

  $('#pendientes-lista').addEventListener('click', e => {
    const q = e.target.closest('[data-quitar]');
    if (q) quitarPendiente(q.dataset.quitar);
  });
  $('#btn-enviar-lista').addEventListener('click', () => {
    if (!navigator.onLine) { toast('Sin señal. Se envían solos cuando vuelva.', 'offline'); return; }
    enviarLista(false);
  });

  // Selector
  $('#selector-lista').addEventListener('click', e => {
    const b = e.target.closest('[data-valor]');
    if (!b) return;
    cerrarSelector();
    if (alElegir) alElegir(b.dataset.valor);
  });
  $('#selector-cerrar').addEventListener('click', cerrarSelector);
  $('#selector').addEventListener('click', e => { if (e.target.id === 'selector') cerrarSelector(); });
  $('#selector-buscar').addEventListener('input', e => {
    const q = normalizar(e.target.value);
    document.querySelectorAll('#selector-lista .hoja-item').forEach(it => { it.hidden = !!q && !it.dataset.buscar.includes(q); });
    document.querySelectorAll('#selector-lista [data-grupo]').forEach(g => { g.hidden = ![...g.querySelectorAll('.hoja-item')].some(i => !i.hidden); });
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => cambiarVista(t.dataset.vista)));
  $('#mes-ant').addEventListener('click', () => moverMes(-1));
  $('#mes-sig').addEventListener('click', () => moverMes(1));
  $('#btn-salir').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* igual se sale */ }
    resumenCache.clear(); saldosCache = null;
    mostrarLogin();
  });

  window.addEventListener('online', () => { pintarConexion(); enviarAutomaticos(); });
  window.addEventListener('offline', pintarConexion);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!estado.fecha) pintarFecha();
    enviarAutomaticos();
  });
}

async function iniciar() {
  conectarEventos();
  const medio = local.get('qc_medio', 'Banco');
  const r = document.querySelector(`input[name="medio"][value="${medio}"]`);
  if (r) r.checked = true;
  pintarFecha(); pintarTipo(); pintarCuenta();
  pintarPendientes(); pintarAnotando(); pintarConexion();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* la app anda igual sin él */ });
  }
  try {
    const s = await api('/api/sesion');
    if (s.ok) { local.set('qc_entro', true); entrarApp(); } else mostrarLogin();
  } catch (err) {
    if (err.sinRed && local.get('qc_entro', false)) entrarApp();
    else mostrarLogin(err.sinRed ? 'Sin conexión. Conectate para entrar la primera vez.' : '');
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
