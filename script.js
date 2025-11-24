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

// ===== FORM FUNCTIONALITY =====
function updatePaymentOptions() {
  const category = document.getElementById("category").value;
  const paymentTypeDiv = document.getElementById("paymentType");

  if (category) {
    paymentTypeDiv.style.display = "block";
    // Add animation
    paymentTypeDiv.style.opacity = "0";
    setTimeout(() => {
      paymentTypeDiv.style.opacity = "1";
      paymentTypeDiv.style.transition = "opacity 0.3s ease-in-out";
    }, 50);
  } else {
    paymentTypeDiv.style.display = "none";
  }
}

function showToast(type, title, message) {
  const toast = document.getElementById('responseToast');
  const toastIcon = document.getElementById('toastIcon');
  const toastTitle = document.getElementById('toastTitle');
  const toastMessage = document.getElementById('toastMessage');

  // Configure toast based on type
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

  // Show toast using Bootstrap
  const bsToast = new bootstrap.Toast(toast, {
    autohide: true,
    delay: type === 'success' ? 1500 : 4000
  });
  bsToast.show();

  // Auto-reload on success
  if (type === 'success') {
    setTimeout(() => {
      location.reload();
    }, 2000);
  }
}

function setLoadingState(isLoading) {
  const submitBtn = document.querySelector('button[type="submit"]');
  const formElements = document.querySelectorAll('input, select, button');

  if (isLoading) {
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Enviando...';
    submitBtn.disabled = true;
    formElements.forEach(el => {
      if (el !== submitBtn) el.disabled = true;
    });
  } else {
    submitBtn.innerHTML = '<i class="fas fa-check me-1"></i>Registrar';
    submitBtn.disabled = false;
    formElements.forEach(el => el.disabled = false);
  }
}

// ===== DATE MANAGEMENT =====
function initializeDateSystem() {
  const dateDisplay = document.getElementById('dateDisplay');
  const dateInput = document.getElementById('dateInput');
  const changeDateBtn = document.getElementById('changeDateBtn');

  let currentDate = getBoliviaTime();
  let isManualDate = false;

  // Set initial date
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
      // Reset to current date
      isManualDate = false;
      dateInput.style.display = 'none';
      updateDateDisplay();
    } else {
      // Show date picker
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

  // Update current date every minute
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
    showToast('error', 'Error', 'Selecciona el autor');
    return false;
  }

  if (!category) {
    showToast('error', 'Error', 'Selecciona una categoría');
    return false;
  }

  if (!paymentMethod) {
    showToast('error', 'Error', 'Selecciona método de pago');
    return false;
  }

  if (!amount || amount <= 0) {
    showToast('error', 'Error', 'Ingresa un monto válido');
    return false;
  }

  return true;
}

// ===== FORM SUBMISSION =====
function handleFormSubmit(e) {
  e.preventDefault();

  if (!validateForm()) {
    return;
  }

  setLoadingState(true);

  // Get form data
  const dateInput = document.getElementById("dateInput").value;
  const [year, month, day] = dateInput.split("-");
  const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
  const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;

  const author = document.getElementById("author").value;
  const category = document.getElementById("category").value.toLowerCase();
  const paymentMethod = document.getElementById("paymentMethod").value.toLowerCase();
  const amount = parseFloat(document.getElementById("amount").value) || 0;
  const glosa = document.getElementById("glosa").value || "";

  // Build JSON payload
  const jsonBody = {
    fecha: formattedDate,
    autor: author,
    glosa: glosa,
  };

  // Map category and payment method to appropriate fields
  const categoryMap = {
    "comida": "comida",
    "movilidad": "movilidad",
    "varios": "varios",
    "servicios básicos": "servicios"
  };

  const categoryKey = categoryMap[category];
  const fieldName = `${categoryKey}_${paymentMethod}`;
  jsonBody[fieldName] = amount;

  // Submit to API
  fetch("https://sheet.matsoto.dev/proxy/gsheet", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(jsonBody),
  })
    .then((response) => {
      console.log("Respuesta HTTP:", response);
      if (response.ok) {
        return response.json();
      } else {
        throw new Error(`Error del servidor: ${response.status} ${response.statusText}`);
      }
    })
    .then((data) => {
      console.log("Respuesta del servidor:", data);
      setLoadingState(false);
      showToast('success', 'Éxito', 'Registrado correctamente');
    })
    .catch((error) => {
      console.error("Error durante el envío:", error);
      setLoadingState(false);
      showToast('error', 'Error', 'Error de conexión. Intenta de nuevo.');
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

  // Setup form submission
  document.getElementById("financeForm").addEventListener("submit", handleFormSubmit);

  console.log('Finanzas App iniciada');
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', initializeApp);

// Handle page visibility changes to update date
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    // Page became visible, update date if using current date
    const changeDateBtn = document.getElementById('changeDateBtn');
    if (changeDateBtn && changeDateBtn.classList.contains('btn-outline-secondary')) {
      initializeDateSystem();
    }
  }
});

