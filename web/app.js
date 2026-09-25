'use strict';

// ===== Datos fijos de la planilla =====
const CATEGORIAS = [
  { id: 'comida', nombre: 'Comida', icono: 'i-comida', color: 'var(--c-comida)' },
  { id: 'movilidad', nombre: 'Transporte', icono: 'i-movilidad', color: 'var(--c-movilidad)' },
  { id: 'varios', nombre: 'Compras varias', icono: 'i-varios', color: 'var(--c-varios)' },
  { id: 'servicios', nombre: 'Servicios básicos', icono: 'i-servicios', color: 'var(--c-servicios)' },
];
const CAT = Object.fromEntries(CATEGORIAS.map(c => [c.id, c]));
const METODO_NOMBRE = { tarjeta: 'Tarjeta', efectivo: 'Efectivo' };
// El valor es lo que se escribe en la columna AUTOR de la hoja
const AUTORES = [
  { id: 'EVER', nombre: 'Ever' },
  { id: 'MA. NELFI', nombre: 'Ma. Nelfi' },
];

const $ = sel => document.querySelector(sel);

// ===== Guardado local (tolerante a navegadores que lo bloquean) =====
const local = {
  get(k, def) {
    try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

// ===== Formatos =====
const fmtNumero = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
function bs(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = Number.isInteger(v) ? fmtNumero.format(v)
    : new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return `Bs ${s}`;
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Fecha de hoy en Bolivia, sin importar la zona horaria del celular
function hoyBolivia() {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/La_Paz', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = Number(x.value); });
  return new Date(p.year, p.month - 1, p.day);
}
const dd = n => String(n).padStart(2, '0');
const aPlanilla = d => `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`;      // dd/MM/yyyy
const aInput = d => `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;         // yyyy-MM-dd
const deInput = s => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const dePlanilla = s => { const [d, m, a] = s.split('/').map(Number); return new Date(a, m - 1, d); };
const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDiaLargo = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDiaCorto = new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric' });
const fmtMes = new Intl.DateTimeFormat('es-BO', { month: 'long', year: 'numeric' });
const fmtMesSolo = new Intl.DateTimeFormat('es-BO', { month: 'long' });

function textoFecha(d) {
  const hoy = hoyBolivia();
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const largo = fmtDiaLargo.format(d);
  if (mismoDia(d, hoy)) return `Hoy, ${largo}`;
  if (mismoDia(d, ayer)) return `Ayer, ${largo}`;
  return largo.charAt(0).toUpperCase() + largo.slice(1);
}

// ===== Monto: se escribe con coma o punto, se guarda como número =====
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
    resp = await fetch(ruta, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      ...opciones,
    });
  } catch {
    throw new ErrorApi('Sin conexión con el servidor.', 0, true);
  }
  let data = null;
  try { data = await resp.json(); } catch { /* nginx responde HTML en sus propios errores */ }
  if (resp.status === 401 && ruta !== '/api/login') {
    mostrarLogin('Tu sesión venció. Volvé a entrar.');
  }
  if (!resp.ok || !data || data.status !== 'success') {
    throw new ErrorApi((data && data.message) || `Error del servidor (${resp.status}). Probá de nuevo.`, resp.status);
  }
  return data;
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

// ===== Pantallas =====
function mostrar(id) {
  for (const v of ['#vista-login', '#vista-autor', '#app']) $(v).hidden = v !== id;
}

function mostrarLogin(error = '') {
  local.del('qc_entro');
  mostrar('#vista-login');
  $('#login-error').textContent = error;
  setTimeout(() => $('#clave').focus(), 50);
}

let volverA = null;
function mostrarAutor() {
  const actual = local.get('qc_autor', null);
  $('#lista-autores').innerHTML = AUTORES.map(a => `
    <button type="button" class="autor-opcion" data-autor="${escapeHtml(a.id)}" aria-pressed="${a.id === actual}">
      <span class="chip-inicial">${escapeHtml(a.nombre[0])}</span>${escapeHtml(a.nombre)}
    </button>`).join('');
  mostrar('#vista-autor');
}

function pintarAutor() {
  const a = AUTORES.find(x => x.id === local.get('qc_autor', null)) || AUTORES[0];
  $('#autor-inicial').textContent = a.nombre[0];
  $('#autor-nombre').textContent = a.nombre;
}

function entrarApp() {
  if (!local.get('qc_autor', null)) { mostrarAutor(); return; }
  pintarAutor();
  mostrar('#app');
  cambiarVista(volverA || 'registrar');
  volverA = null;
  enviarAutomaticos();
}

function cambiarVista(nombre) {
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.vista === nombre) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  $('#vista-registrar').hidden = nombre !== 'registrar';
  $('#vista-resumen').hidden = nombre !== 'resumen';
  window.scrollTo(0, 0);
  if (nombre === 'resumen') cargarResumen();
}

// ===== Formulario =====
let fechaElegida = null; // null = hoy

function fechaActual() { return fechaElegida || hoyBolivia(); }

function pintarFecha() {
  $('#fecha-texto').textContent = textoFecha(fechaActual());
  $('#btn-fecha').textContent = fechaElegida ? 'Volver a hoy' : 'Cambiar';
}

function leerFormulario() {
  const categoria = document.querySelector('input[name="categoria"]:checked')?.value || '';
  const metodo = document.querySelector('input[name="metodo"]:checked')?.value || '';
  const monto = leerMonto($('#monto').value);
  const glosa = $('#glosa').value.trim();
  return { categoria, metodo, monto, glosa, fecha: aPlanilla(fechaActual()) };
}

function faltante(f) {
  if (!(f.monto > 0)) return 'Ingresá el monto';
  if (!f.categoria) return 'Elegí la categoría';
  if (!f.metodo) return 'Elegí tarjeta o efectivo';
  return '';
}

let enviando = false;
function actualizarBoton() {
  const f = leerFormulario();
  const falta = faltante(f);
  const btn = $('#btn-registrar');
  if (enviando) return;
  btn.disabled = !!falta;
  btn.innerHTML = falta ? escapeHtml(falta) : `Registrar <span class="num">${escapeHtml(bs(f.monto))}</span>`;
  $('#btn-lista').disabled = !!falta;
}

function armarRegistro(f) {
  const payload = { fecha: f.fecha, autor: local.get('qc_autor', AUTORES[0].id), glosa: f.glosa };
  payload[`${f.categoria}_${f.metodo}`] = f.monto;
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, payload, ...f, estado: 'lista', auto: false };
}

function limpiarFormulario() {
  $('#monto').value = '';
  $('#glosa').value = '';
  document.querySelectorAll('input[name="categoria"]').forEach(i => { i.checked = false; });
  $('#monto-error').textContent = '';
  actualizarBoton();
}

async function registrar(e) {
  e.preventDefault();
  const f = leerFormulario();
  if (faltante(f) || enviando) return;
  const reg = armarRegistro(f);

  if (!navigator.onLine) {
    guardarPendiente({ ...reg, auto: true });
    limpiarFormulario();
    toast('Sin señal: quedó guardado en el celular y se envía solo.', 'offline');
    return;
  }

  enviando = true;
  const btn = $('#btn-registrar');
  btn.disabled = true;
  btn.textContent = 'Registrando…';
  try {
    await api('/api/registro', { method: 'POST', body: JSON.stringify(reg.payload) });
    const input = $('#monto');
    input.classList.add('registrado');
    setTimeout(() => { input.classList.remove('registrado'); limpiarFormulario(); }, 420);
    toast(`Registrado: ${bs(f.monto)} en ${CAT[f.categoria].nombre}`);
    resumenCache.delete(f.fecha.slice(3));
  } catch (err) {
    if (err.sinRed) {
      guardarPendiente({ ...reg, auto: true });
      limpiarFormulario();
      toast('Sin señal: quedó guardado en el celular y se envía solo.', 'offline');
    } else if (err.status === 504) {
      guardarPendiente({ ...reg, estado: 'dudoso' });
      limpiarFormulario();
      toast('La planilla tardó demasiado. Quedó en "Por registrar": revisá la hoja antes de reenviar.', 'error');
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
  guardarPendiente(armarRegistro(f));
  limpiarFormulario();
  $('#monto').focus();
  toast(`Agregado a la lista: ${bs(f.monto)}`);
}

// ===== Pendientes (lista y registros sin señal) =====
function pendientes() { return local.get('qc_pendientes', []); }
function guardarPendientes(lista) { local.set('qc_pendientes', lista); pintarPendientes(); }
function guardarPendiente(reg) { guardarPendientes([...pendientes(), reg]); }
function quitarPendiente(id) { guardarPendientes(pendientes().filter(p => p.id !== id)); }

function pintarPendientes() {
  const lista = pendientes();
  $('#pendientes').hidden = lista.length === 0;
  if (!lista.length) return;
  const total = lista.reduce((s, p) => s + p.monto, 0);
  $('#pendientes-total').textContent = bs(total);
  const hoy = aPlanilla(hoyBolivia());
  $('#pendientes-lista').innerHTML = lista.map(p => {
    const c = CAT[p.categoria];
    const meta = [
      p.glosa,
      p.fecha !== hoy ? textoFecha(dePlanilla(p.fecha)) : '',
      p.auto && p.estado === 'lista' ? 'Se envía solo al volver la señal' : '',
      p.error || '',
    ].filter(Boolean).map(escapeHtml).join('. ');
    const dudoso = p.estado === 'dudoso';
    return `
      <li class="fila" style="--c:${c.color}">
        <span class="punto" aria-hidden="true"></span>
        <div class="fila-texto">
          <div class="fila-titulo">${escapeHtml(c.nombre)}, ${escapeHtml(METODO_NOMBRE[p.metodo].toLowerCase())}</div>
          ${dudoso ? '<div class="fila-estado dudoso">Puede que ya esté en la planilla. Revisá antes de reenviar.</div>' : ''}
          ${meta ? `<div class="fila-meta">${meta}</div>` : ''}
        </div>
        <span class="fila-monto num">${escapeHtml(bs(p.monto))}</span>
        <div class="fila-acciones">
          ${dudoso ? `<button type="button" class="btn-icono" data-reenviar="${p.id}" aria-label="Reenviar ${escapeHtml(bs(p.monto))}"><svg class="ic"><use href="#i-reintentar"/></svg></button>` : ''}
          <button type="button" class="btn-icono" data-quitar="${p.id}" aria-label="Quitar ${escapeHtml(bs(p.monto))} de la lista"><svg class="ic"><use href="#i-x"/></svg></button>
        </div>
      </li>`;
  }).join('');
  const enviables = lista.filter(p => p.estado !== 'dudoso');
  const btn = $('#btn-enviar-lista');
  btn.hidden = enviables.length === 0;
  const totalEnv = enviables.reduce((s, p) => s + p.monto, 0);
  if (!enviandoLista) {
    btn.disabled = false;
    btn.innerHTML = enviables.length === 1
      ? `Registrar <span class="num">${escapeHtml(bs(totalEnv))}</span>`
      : `Registrar los ${enviables.length} <span class="num">(${escapeHtml(bs(totalEnv))})</span>`;
  }
}

let enviandoLista = false;
// Manda de a uno; cada registro confirmado sale de la lista al instante, así un
// corte a mitad de camino no deja duplicados al reintentar.
async function enviarLista(soloAutomaticos = false, soloId = null) {
  if (enviandoLista || !navigator.onLine) return;
  const cola = pendientes().filter(p => soloId ? p.id === soloId
    : (p.estado !== 'dudoso' && (!soloAutomaticos || p.auto)));
  if (!cola.length) return;
  enviandoLista = true;
  const btn = $('#btn-enviar-lista');
  btn.disabled = true;
  let ok = 0, ultimoError = '';
  for (let i = 0; i < cola.length; i++) {
    const p = cola[i];
    btn.textContent = `Registrando ${i + 1} de ${cola.length}…`;
    try {
      await api('/api/registro', { method: 'POST', body: JSON.stringify(p.payload) });
      ok++;
      resumenCache.delete(p.fecha.slice(3));
      guardarPendientes(pendientes().filter(x => x.id !== p.id));
    } catch (err) {
      if (err.status === 401) break;
      ultimoError = err.message;
      guardarPendientes(pendientes().map(x => x.id !== p.id ? x : {
        ...x, estado: err.status === 504 ? 'dudoso' : 'lista', error: err.sinRed ? '' : err.message,
      }));
      if (err.sinRed) break;
    }
  }
  enviandoLista = false;
  pintarPendientes();
  if (ok === cola.length) {
    toast(ok === 1 ? 'Registrado en la planilla' : `${ok} gastos registrados en la planilla`);
  } else if (!soloAutomaticos || ok > 0) {
    toast(`${ok} de ${cola.length} registrados. ${ultimoError}`, 'error');
  }
}

function enviarAutomaticos() { if (navigator.onLine) enviarLista(true); }

function pintarConexion() {
  $('#aviso-offline').hidden = navigator.onLine;
}

// ===== Resumen =====
const resumenCache = new Map(); // "MM/AAAA" -> respuesta
let mesVista = null;             // Date del día 1 del mes que se ve

function claveMes(d) { return `${dd(d.getMonth() + 1)}/${d.getFullYear()}`; }

async function cargarResumen(forzar = false) {
  const hoy = hoyBolivia();
  if (!mesVista) mesVista = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const clave = claveMes(mesVista);
  const esMesActual = mesVista.getFullYear() === hoy.getFullYear() && mesVista.getMonth() === hoy.getMonth();
  const titulo = fmtMes.format(mesVista);
  $('#t-resumen').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  $('#mes-sig').disabled = esMesActual;
  const cuerpo = $('#resumen-cuerpo');

  const guardado = !forzar && resumenCache.get(clave);
  if (guardado) { pintarResumen(guardado, esMesActual); return; }

  cuerpo.innerHTML = '<div class="esqueleto" aria-label="Cargando"><i></i><i></i><i></i><i></i></div>';
  try {
    const data = await api(`/api/resumen?mes=${encodeURIComponent(clave)}`);
    resumenCache.set(clave, data);
    local.set(`qc_resumen_${clave}`, data);
    if (claveMes(mesVista) === clave) pintarResumen(data, esMesActual);
  } catch (err) {
    if (err.status === 401 || claveMes(mesVista) !== clave) return;
    const viejo = local.get(`qc_resumen_${clave}`, null);
    if (viejo) {
      pintarResumen(viejo, esMesActual);
      cuerpo.insertAdjacentHTML('afterbegin',
        `<div class="aviso"><svg class="ic"><use href="#i-offline"/></svg><span>Mostrando lo último que se cargó en este celular. ${escapeHtml(err.message)}</span></div>`);
      return;
    }
    cuerpo.innerHTML = `
      <div class="error-bloque">
        <p>${escapeHtml(err.message)}</p>
        <button type="button" class="btn-secundario" id="btn-reintentar-resumen"><svg class="ic"><use href="#i-reintentar"/></svg>Reintentar</button>
      </div>`;
    $('#btn-reintentar-resumen').onclick = () => cargarResumen(true);
  }
}

let movimientosVisibles = 30;

function pintarResumen(r, esMesActual) {
  const cuerpo = $('#resumen-cuerpo');
  const nombreMes = fmtMesSolo.format(mesVista);
  if (!r.total) {
    cuerpo.innerHTML = `<div class="vacio"><strong>Sin gastos en ${escapeHtml(nombreMes)}</strong>Lo que registres este mes va a aparecer acá.</div>`;
    return;
  }

  const cats = CATEGORIAS
    .map(c => ({ ...c, t: r.categorias[c.id].tarjeta, e: r.categorias[c.id].efectivo }))
    .map(c => ({ ...c, total: c.t + c.e }))
    .sort((a, b) => b.total - a.total);
  const max = Math.max(...cats.map(c => c.total), 1);
  const pctTarjeta = r.total ? (r.tarjeta / r.total) * 100 : 0;

  // Movimientos agrupados por día (ya vienen del más nuevo al más viejo)
  const dias = [];
  for (const m of r.movimientos.slice(0, movimientosVisibles)) {
    if (!dias.length || dias[dias.length - 1].fecha !== m.fecha) dias.push({ fecha: m.fecha, items: [] });
    dias[dias.length - 1].items.push(m);
  }
  const autorNombre = id => (AUTORES.find(a => a.id === id) || { nombre: id }).nombre;

  cuerpo.innerHTML = `
    <div class="total">
      <p class="total-monto"><span class="moneda">Bs</span>${escapeHtml(bs(r.total).slice(3))}</p>
      <p class="total-texto">gastados en ${escapeHtml(nombreMes)}${esMesActual ? `. Hoy: <strong class="num">${escapeHtml(bs(r.hoy))}</strong>` : ''}</p>
    </div>

    <section class="bloque" aria-labelledby="t-pago">
      <h2 id="t-pago" class="bloque-titulo">Cómo se pagó</h2>
      <div class="reparto" role="img" aria-label="Tarjeta ${Math.round(pctTarjeta)}%, efectivo ${Math.round(100 - pctTarjeta)}%">
        <i class="tarjeta" style="width:${pctTarjeta}%"></i><i class="efectivo" style="width:${100 - pctTarjeta}%"></i>
      </div>
      <div class="reparto-leyenda">
        <span><i class="cuadrito" style="background:var(--tinta)"></i>Tarjeta <strong class="num">${escapeHtml(bs(r.tarjeta))}</strong></span>
        <span><i class="cuadrito" style="background:var(--tinta-3)"></i>Efectivo <strong class="num">${escapeHtml(bs(r.efectivo))}</strong></span>
      </div>
    </section>

    <section class="bloque" aria-labelledby="t-cat">
      <h2 id="t-cat" class="bloque-titulo">Por categoría</h2>
      <ul class="barras">
        ${cats.map(c => `
          <li class="barra-cat" style="--c:${c.color}">
            <span class="barra-cat-nombre"><svg class="ic"><use href="#${c.icono}"/></svg>${escapeHtml(c.nombre)}</span>
            <span class="barra-cat-monto num">${escapeHtml(bs(c.total))}</span>
            <span class="barra-cat-pista" aria-hidden="true"><i style="width:${(c.total / max) * 100}%"></i></span>
            ${c.t && c.e ? `<span class="barra-cat-detalle">Tarjeta ${escapeHtml(bs(c.t))}, efectivo ${escapeHtml(bs(c.e))}</span>`
              : c.total ? `<span class="barra-cat-detalle">Todo con ${c.t ? 'tarjeta' : 'efectivo'}</span>` : ''}
          </li>`).join('')}
      </ul>
    </section>

    <section class="bloque" aria-labelledby="t-autor">
      <h2 id="t-autor" class="bloque-titulo">Por persona</h2>
      <ul class="autores-lista">
        ${Object.entries(r.autores).map(([a, v]) => `
          <li><span>${escapeHtml(autorNombre(a))}</span><strong class="num">${escapeHtml(bs(v))}</strong></li>`).join('')}
      </ul>
    </section>

    <section class="bloque" aria-labelledby="t-mov">
      <h2 id="t-mov" class="bloque-titulo">Movimientos</h2>
      ${dias.map(d => `
        <div class="dia">
          <div class="dia-cabeza"><span>${escapeHtml(fmtDiaCorto.format(dePlanilla(d.fecha)))}</span><span class="num">${escapeHtml(bs(r.dias[d.fecha]))}</span></div>
          <ul class="filas">
            ${d.items.map(m => {
              const c = CAT[m.categoria];
              const meta = [m.glosa, autorNombre(m.autor), METODO_NOMBRE[m.metodo]].filter(Boolean).map(escapeHtml).join(', ');
              return `
                <li class="fila" style="--c:${c.color}">
                  <span class="punto" aria-hidden="true"></span>
                  <div class="fila-texto"><div class="fila-titulo">${escapeHtml(c.nombre)}</div><div class="fila-meta">${meta}</div></div>
                  <span class="fila-monto num">${escapeHtml(bs(m.monto))}</span>
                </li>`;
            }).join('')}
          </ul>
        </div>`).join('')}
      ${r.movimientos.length > movimientosVisibles
        ? `<button type="button" class="btn-secundario" id="btn-mas">Ver ${Math.min(30, r.movimientos.length - movimientosVisibles)} más</button>` : ''}
    </section>`;

  const mas = $('#btn-mas');
  if (mas) mas.onclick = () => { movimientosVisibles += 30; pintarResumen(r, esMesActual); };
}

function moverMes(delta) {
  mesVista = new Date(mesVista.getFullYear(), mesVista.getMonth() + delta, 1);
  movimientosVisibles = 30;
  cargarResumen();
}

// ===== Arranque =====
function armarCategorias() {
  $('#categorias').innerHTML = CATEGORIAS.map(c => `
    <label class="categoria">
      <input type="radio" name="categoria" value="${c.id}">
      <span style="--c:${c.color}"><svg class="ic"><use href="#${c.icono}"/></svg>${escapeHtml(c.nombre)}</span>
    </label>`).join('');
}

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
      $('#clave').value = '';
      $('#login-error').textContent = '';
      entrarApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });

  $('#lista-autores').addEventListener('click', e => {
    const b = e.target.closest('[data-autor]');
    if (!b) return;
    local.set('qc_autor', b.dataset.autor);
    entrarApp();
  });
  $('#btn-autor').addEventListener('click', () => {
    volverA = $('#vista-resumen').hidden ? 'registrar' : 'resumen';
    mostrarAutor();
  });

  const monto = $('#monto');
  monto.addEventListener('input', () => {
    const limpio = limpiarMonto(monto.value);
    if (limpio !== monto.value) monto.value = limpio;
    actualizarBoton();
  });
  $('#form-gasto').addEventListener('change', e => {
    if (e.target.name === 'metodo') local.set('qc_metodo', e.target.value);
    actualizarBoton();
  });
  $('#form-gasto').addEventListener('submit', registrar);
  $('#btn-lista').addEventListener('click', agregarALista);

  $('#btn-fecha').addEventListener('click', () => {
    const input = $('#fecha');
    if (fechaElegida) {
      fechaElegida = null;
      input.hidden = true;
    } else {
      input.hidden = false;
      input.max = aInput(hoyBolivia());
      input.value = aInput(hoyBolivia());
      input.focus();
      try { input.showPicker(); } catch { /* no todos los navegadores */ }
    }
    pintarFecha();
  });
  $('#fecha').addEventListener('change', e => {
    if (!e.target.value) return;
    const d = deInput(e.target.value);
    fechaElegida = mismoDia(d, hoyBolivia()) ? null : d;
    if (!fechaElegida) e.target.hidden = true;
    pintarFecha();
  });

  $('#pendientes-lista').addEventListener('click', e => {
    const quitar = e.target.closest('[data-quitar]');
    if (quitar) { quitarPendiente(quitar.dataset.quitar); return; }
    const reenviar = e.target.closest('[data-reenviar]');
    if (reenviar) enviarLista(false, reenviar.dataset.reenviar);
  });
  $('#btn-enviar-lista').addEventListener('click', () => {
    if (!navigator.onLine) { toast('Sin señal. Se envían solos cuando vuelva.', 'offline'); return; }
    enviarLista(false);
  });

  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => cambiarVista(t.dataset.vista)));
  $('#mes-ant').addEventListener('click', () => moverMes(-1));
  $('#mes-sig').addEventListener('click', () => moverMes(1));
  $('#btn-salir').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* igual se sale */ }
    resumenCache.clear();
    mostrarLogin();
  });

  window.addEventListener('online', () => { pintarConexion(); enviarAutomaticos(); });
  window.addEventListener('offline', pintarConexion);
  // Al volver a la app (p. ej. al día siguiente) la fecha pasa a la de hoy
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!fechaElegida) pintarFecha();
    enviarAutomaticos();
  });
}

async function iniciar() {
  armarCategorias();
  conectarEventos();
  const metodo = local.get('qc_metodo', null);
  if (metodo) {
    const r = document.querySelector(`input[name="metodo"][value="${metodo}"]`);
    if (r) r.checked = true;
  }
  pintarFecha();
  pintarPendientes();
  pintarConexion();
  actualizarBoton();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* la app anda igual sin él */ });
  }

  try {
    const s = await api('/api/sesion');
    if (s.ok) { local.set('qc_entro', true); entrarApp(); } else mostrarLogin();
  } catch (err) {
    // Sin red: si este celular ya había entrado, se puede seguir registrando offline
    if (err.sinRed && local.get('qc_entro', false)) entrarApp(); else mostrarLogin(err.sinRed ? 'Sin conexión. Conectate para entrar la primera vez.' : '');
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
