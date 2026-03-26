// ===== UTILITY FUNCTIONS =====
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function getBoliviaTime() {
  const now = new Date();
  return new Date(now.getTime() - (now.getTimezoneOffset() + 240) * 60000);
}

// ===== QUEUE MANAGEMENT =====
let entryQueue = [];

function loadQueueFromStorage() {
  const saved = localStorage.getItem('financeQueue');
  if (saved) {
    try {
      entryQueue = JSON.parse(saved);
    } catch (e) {
      entryQueue = [];
    }
  }
}

function saveQueueToStorage() {
  localStorage.setItem('financeQueue', JSON.stringify(entryQueue));
}

function getFormData() {
  const dateInput = document.getElementById("dateInput").value;
  const [year, month, day] = dateInput.split("-");
  const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
  const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;

  const author = document.getElementById("author").value;
  const category = document.getElementById("category").value;
  const paymentMethod = document.getElementById("paymentMethod").value;
  const amount = parseFloat(document.getElementById("amount").value) || 0;
  const glosa = document.getElementById("glosa").value || "";

  const categoryMap = {
    "comida": "comida",
    "movilidad": "movilidad",
    "varios": "varios",
    "servicios básicos": "servicios"
  };

  const categoryKey = categoryMap[category.toLowerCase()];
  const fieldName = `${categoryKey}_${paymentMethod.toLowerCase()}`;

  const payload = {
    fecha: formattedDate,
    autor: author,
    glosa: glosa,
  };
  payload[fieldName] = amount;

  return {
    display: {
      category: category,
      paymentMethod: paymentMethod,
      amount: amount,
      glosa: glosa,
      date: formattedDate,
      author: author
    },
    payload: payload
  };
}

function isFormComplete() {
  const amount = parseFloat(document.getElementById("amount").value);
  const author = document.getElementById("author").value;
  const category = document.getElementById("category").value;
  const paymentMethod = document.getElementById("paymentMethod").value;
  return amount > 0 && author && category && paymentMethod;
}

function addToQueue() {
  if (!validateForm()) return;

  const entry = getFormData();
  entryQueue.push(entry);
  saveQueueToStorage();
  updateQueueUI();
  resetFormPartial();

  // Brief visual feedback
  const addBtn = document.getElementById('addToQueueBtn');
  addBtn.innerHTML = '<i class="fas fa-check me-1"></i>Agregado';
  addBtn.classList.add('btn-success');
  addBtn.classList.remove('btn-outline-primary');
  setTimeout(() => {
    addBtn.innerHTML = '<i class="fas fa-plus me-1"></i>Nuevo ingreso';
    addBtn.classList.remove('btn-success');
    addBtn.classList.add('btn-outline-primary');
  }, 600);
}

function removeFromQueue(index) {
  entryQueue.splice(index, 1);
  saveQueueToStorage();
  updateQueueUI();
}

function clearQueue() {
  entryQueue = [];
  saveQueueToStorage();
  updateQueueUI();
}

function resetFormPartial() {
  // Keep author and date, reset the rest
  document.getElementById("category").value = "";
  document.getElementById("paymentMethod").value = "";
  document.getElementById("amount").value = "";
  document.getElementById("glosa").value = "";
  document.getElementById("paymentType").style.display = "none";
}

function updateQueueUI() {
  const queueSection = document.getElementById('queueSection');
  const queueList = document.getElementById('queueList');
  const queueCount = document.getElementById('queueCount');
  const queueTotal = document.getElementById('queueTotal');
  const submitBtn = document.getElementById('submitBtn');

  if (entryQueue.length > 0) {
    queueSection.style.display = 'block';
    queueCount.textContent = entryQueue.length;

    // Calculate total
    const total = entryQueue.reduce((sum, e) => sum + e.display.amount, 0);
    queueTotal.textContent = total.toFixed(2);

    // Render items
    queueList.innerHTML = entryQueue.map((entry, i) => `
      <div class="queue-item">
        <div class="queue-item-info">
          <span class="queue-item-category">${entry.display.category}</span>
          <span class="queue-item-separator">·</span>
          <span class="queue-item-method">${entry.display.paymentMethod}</span>
          <span class="queue-item-amount">$${entry.display.amount.toFixed(2)}</span>
          ${entry.display.glosa ? `<span class="queue-item-glosa">${entry.display.glosa}</span>` : ''}
        </div>
        <button type="button" class="queue-item-remove" onclick="removeFromQueue(${i})">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `).join('');

    submitBtn.innerHTML = `<i class="fas fa-check-double me-1"></i>Registrar todos (${entryQueue.length})`;
  } else {
    queueSection.style.display = 'none';
    submitBtn.innerHTML = '<i class="fas fa-check me-1"></i>Registrar';
  }
}
// ===== FORM FUNCTIONALITY =====
function updatePaymentOptions() {
  const category = document.getElementById("category").value;
  const paymentTypeDiv = document.getElementById("paymentType");

  if (category) {
    paymentTypeDiv.style.display = "block";
    paymentTypeDiv.style.opacity = "0";
    setTimeout(() => {
      paymentTypeDiv.style.opacity = "1";
      paymentTypeDiv.style.transition = "opacity 0.3s ease-in-out";
    }, 50);
  } else {
    paymentTypeDiv.style.display = "none";
  }
}

function showToast(type, title, message, autoReload = true) {
  const toast = document.getElementById('responseToast');
  const toastIcon = document.getElementById('toastIcon');
  const toastTitle = document.getElementById('toastTitle');
  const toastMessage = document.getElementById('toastMessage');

  if (type === 'success') {
    toastIcon.className = 'fas fa-check-circle text-success me-2';
    toastTitle.textContent = 'Éxito';
    toast.className = 'toast show';
  } else if (type === 'error') {
    toastIcon.className = 'fas fa-exclamation-circle text-danger me-2';
    toastTitle.textContent = 'Error';
    toast.className = 'toast show';
  }

  toastMessage.textContent = message;

  const bsToast = new bootstrap.Toast(toast, {
    autohide: true,
    delay: type === 'success' ? 1500 : 4000
  });
  bsToast.show();

  if (type === 'success' && autoReload) {
    setTimeout(() => {
      location.reload();
    }, 2000);
  }
}

function setLoadingState(isLoading) {
  const submitBtn = document.getElementById('submitBtn');
  const addBtn = document.getElementById('addToQueueBtn');
  const formElements = document.querySelectorAll('#financeForm input, #financeForm select');

  if (isLoading) {
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Enviando...';
    submitBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    formElements.forEach(el => el.disabled = true);
  } else {
    submitBtn.disabled = false;
    if (addBtn) addBtn.disabled = false;
    formElements.forEach(el => el.disabled = false);
    updateQueueUI();
  }
}

// ===== DATE MANAGEMENT =====
function initializeDateSystem() {
  const dateDisplay = document.getElementById('dateDisplay');
  const dateInput = document.getElementById('dateInput');
  const changeDateBtn = document.getElementById('changeDateBtn');

  let currentDate = getBoliviaTime();
  let isManualDate = false;

  updateDateDisplay();

  function updateDateDisplay() {
    if (isManualDate) {
      const selectedDate = new Date(dateInput.value + 'T00:00:00');
      dateDisplay.value = formatDisplayDate(selectedDate);
      changeDateBtn.innerHTML = '<i class="fas fa-undo"></i>';
      changeDateBtn.title = 'Hoy';
      changeDateBtn.className = 'btn btn-outline-secondary btn-sm border-start-0';
    } else {
      currentDate = getBoliviaTime();
      dateDisplay.value = formatDisplayDate(currentDate);
      changeDateBtn.innerHTML = '<i class="fas fa-edit"></i>';
      changeDateBtn.title = 'Cambiar';
      changeDateBtn.className = 'btn btn-outline-secondary btn-sm border-start-0';
    }
    dateInput.value = formatDate(isManualDate ? new Date(dateInput.value + 'T00:00:00') : currentDate);
  }

  changeDateBtn.addEventListener('click', function () {
    if (isManualDate) {
      isManualDate = false;
      dateInput.style.display = 'none';
      updateDateDisplay();
    } else {
      isManualDate = true;
      dateInput.style.display = 'block';
      dateInput.value = formatDate(currentDate);
      dateInput.focus();
      updateDateDisplay();
    }
  });

  dateInput.addEventListener('change', function () {
    if (this.value) {
      updateDateDisplay();
    }
  });

  setInterval(function () {
    if (!isManualDate) {
      updateDateDisplay();
    }
  }, 60000);
}

// ===== FORM VALIDATION =====
function validateForm() {
  const author = document.getElementById("author").value;
  const category = document.getElementById("category").value;
  const paymentMethod = document.getElementById("paymentMethod").value;
  const amount = parseFloat(document.getElementById("amount").value);

  if (!author) {
    showToast('error', 'Error', 'Selecciona el autor', false);
    return false;
  }
  if (!category) {
    showToast('error', 'Error', 'Selecciona una categoría', false);
    return false;
  }
  if (!paymentMethod) {
    showToast('error', 'Error', 'Selecciona método de pago', false);
    return false;
  }
  if (!amount || amount <= 0) {
    showToast('error', 'Error', 'Ingresa un monto válido', false);
    return false;
  }
  return true;
}

// ===== FORM SUBMISSION =====
function handleFormSubmit(e) {
  e.preventDefault();

  if (entryQueue.length > 0) {
    // Batch mode: silently include current form if it's complete
    if (isFormComplete()) {
      entryQueue.push(getFormData());
      saveQueueToStorage();
    }
    submitBatch();
  } else {
    // Single mode
    if (!validateForm()) return;
    submitSingle(getFormData().payload);
  }
}

function submitSingle(payload) {
  setLoadingState(true);

  fetch("https://sheet.matsoto.dev/proxy/gsheet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload),
  })
    .then(response => {
      if (response.ok) return response.json();
      throw new Error(`Error: ${response.status}`);
    })
    .then(data => {
      setLoadingState(false);
      showToast('success', 'Éxito', 'Registrado correctamente');
    })
    .catch(error => {
      console.error("Error:", error);
      setLoadingState(false);
      showToast('error', 'Error', 'Error de conexión. Intenta de nuevo.', false);
    });
}

function submitBatch() {
  setLoadingState(true);
  const payloads = entryQueue.map(e => e.payload);

  fetch("https://sheet.matsoto.dev/proxy/gsheet/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payloads),
  })
    .then(response => {
      if (response.ok || response.status === 207) return response.json();
      throw new Error(`Error: ${response.status}`);
    })
    .then(data => {
      setLoadingState(false);
      if (data.failed > 0) {
        // Keep only failed items in queue
        const failedIndices = new Set(data.errors.map(e => e.index));
        entryQueue = entryQueue.filter((_, i) => failedIndices.has(i));
        saveQueueToStorage();
        updateQueueUI();
        showToast('error', 'Parcial', `${data.successful} de ${data.total} registrados. ${data.failed} fallaron.`, false);
      } else {
        entryQueue = [];
        saveQueueToStorage();
        updateQueueUI();
        showToast('success', 'Éxito', `${data.total} registro${data.total > 1 ? 's' : ''} enviado${data.total > 1 ? 's' : ''} correctamente`);
      }
    })
    .catch(error => {
      console.error("Error batch:", error);
      setLoadingState(false);
      showToast('error', 'Error', 'Error de conexión. Intenta de nuevo.', false);
    });
}

// ===== INITIALIZATION =====
function initializeApp() {
  // Hide splash screen
  const splashScreen = document.getElementById("splashScreen");
  setTimeout(() => {
    splashScreen.style.opacity = "0";
    setTimeout(() => {
      splashScreen.style.display = "none";
    }, 400);
  }, 1000);

  // Initialize date system
  initializeDateSystem();

  // Load saved queue from localStorage
  loadQueueFromStorage();
  updateQueueUI();

  // Setup form submission
  document.getElementById("financeForm").addEventListener("submit", handleFormSubmit);

  // Setup queue buttons
  document.getElementById("addToQueueBtn").addEventListener("click", addToQueue);
  document.getElementById("clearQueueBtn").addEventListener("click", clearQueue);

  console.log('Finanzas App iniciada');
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', initializeApp);

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    const changeDateBtn = document.getElementById('changeDateBtn');
    if (changeDateBtn && changeDateBtn.classList.contains('btn-outline-secondary')) {
      initializeDateSystem();
    }
  }
});
