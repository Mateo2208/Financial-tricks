function updateSubMenu() {
  const type = document.getElementById("type").value;
  const incomeMenu = document.getElementById("incomeMenu");
  const expenseMenu = document.getElementById("expenseMenu");

  if (type === "Ingreso") {
    incomeMenu.style.display = "block";
    expenseMenu.style.display = "none";
  } else if (type === "Egreso") {
    expenseMenu.style.display = "block";
    incomeMenu.style.display = "none";
  } else {
    incomeMenu.style.display = "none";
    expenseMenu.style.display = "none";
  }
}

function updatePaymentOptions() {
  const category = document.getElementById("category").value;
  const paymentTypeDiv = document.getElementById("paymentType");
  if (category) {
      paymentTypeDiv.style.display = "block";
  } else {
      paymentTypeDiv.style.display = "none";
  }
}

window.onload = function () {
  // Manejar la pantalla de carga
  const splashScreen = document.getElementById('splashScreen');
  setTimeout(() => {
      splashScreen.style.opacity = '0';
      setTimeout(() => {
          splashScreen.style.display = 'none';
      }, 500);
  }, 1200);

  const dateField = document.getElementById('date');
  const now = new Date();
  const boliviaTimeOffset = -4 * 60; // -04:00 en minutos
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const boliviaTime = new Date(utc + boliviaTimeOffset * 60000);
  const formattedDate = boliviaTime.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  dateField.value = formattedDate;
};

document.getElementById('financeForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const popup = document.getElementById('popup');

  // Simula el envío al Google Sheet
  fetch('https://tu-url-google-sheet.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
          author: document.getElementById('author').value,
          category: document.getElementById('category').value,
          paymentMethod: document.getElementById('paymentMethod').value,
          amount: document.getElementById('amount').value,
          glosa: document.getElementById('glosa').value || '',
          date: document.getElementById('date').value,
      }),
  })
      .then((response) => {
          if (response.ok) {
              // Muestra el popup de éxito
              popup.textContent = '¡Envío realizado con éxito!';
              popup.className = ''; // Limpia clases previas (en caso de error)
              popup.style.display = 'block';

              setTimeout(() => {
                  popup.style.display = 'none';
              }, 1200); // Ocultar después de 1.2 segundos
          } else {
              throw new Error('Error en la respuesta del servidor');
          }
      })
      .catch((error) => {
          // Muestra el popup de error
          popup.textContent = 'Error al enviar. Inténtalo nuevamente.';
          popup.className = 'error';
          popup.style.display = 'block';

          setTimeout(() => {
              popup.style.display = 'none';
          }, 3000); // Ocultar después de 3 segundos
      });
});
