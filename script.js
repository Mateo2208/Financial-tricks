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
  const splashScreen = document.getElementById("splashScreen");
  setTimeout(() => {
    splashScreen.style.opacity = "0";
    setTimeout(() => {
      splashScreen.style.display = "none";
    }, 500);
  }, 1200);

  const dateField = document.getElementById("date");
  const now = new Date();
  const boliviaTime = new Date(now.getTime() - (now.getTimezoneOffset() + 240) * 60000);
  const year = boliviaTime.getFullYear();
  const month = String(boliviaTime.getMonth() + 1).padStart(2, "0");
  const day = String(boliviaTime.getDate()).padStart(2, "0");

  const formattedDate = `${year}-${month}-${day}`;
  dateField.value = formattedDate;
};

document.getElementById("financeForm").addEventListener("submit", function (e) {
  e.preventDefault();

  const popup = document.getElementById("popup");
  const dateInput = document.getElementById("date").value;
  const [year, month, day] = dateInput.split("-");
  const dateObj = new Date(Number(year), Number(month) - 1, Number(day));
  const formattedDay = ("0" + dateObj.getDate()).slice(-2);
  const formattedMonth = ("0" + (dateObj.getMonth() + 1)).slice(-2);
  const formattedYear = dateObj.getFullYear();
  const formattedDate = `${formattedDay}/${formattedMonth}/${formattedYear}`;

  const author = document.getElementById("author").value;
  const category = document.getElementById("category").value.toLowerCase();
  const paymentMethod = document.getElementById("paymentMethod").value.toLowerCase();
  const amount = parseFloat(document.getElementById("amount").value) || 0;
  const glosa = document.getElementById("glosa").value || "";

  const jsonBody = {
    fecha: formattedDate,
    autor: author,
    glosa: glosa,
  };

  if (category === "comida") {
    if (paymentMethod === "tarjeta") jsonBody.comida_tarjeta = amount;
    if (paymentMethod === "efectivo") jsonBody.comida_efectivo = amount;
  } else if (category === "movilidad") {
    if (paymentMethod === "tarjeta") jsonBody.movilidad_tarjeta = amount;
    if (paymentMethod === "efectivo") jsonBody.movilidad_efectivo = amount;
  } else if (category === "varios") {
    if (paymentMethod === "tarjeta") jsonBody.varios_tarjeta = amount;
    if (paymentMethod === "efectivo") jsonBody.varios_efectivo = amount;
  } else if (category === "servicios") {
    if (paymentMethod === "tarjeta") jsonBody.servicios_tarjeta = amount;
    if (paymentMethod === "efectivo") jsonBody.servicios_efectivo = amount;
  } else if (category === "servicios básicos") {
    if (paymentMethod === "tarjeta") jsonBody.servicios_tarjeta = amount;
    if (paymentMethod === "efectivo") jsonBody.servicios_efectivo = amount;
  }

  fetch("https://www.dolarbluebolivia.click/proxy/gsheet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  })
    .then((response) => {
      console.log("Respuesta HTTP:", response);
      if (response.ok) {
        return response.json();
      } else {
        throw new Error("Error en la respuesta del servidor");
      }
    })
    .then((data) => {
      console.log("Respuesta del servidor:", data);
      popup.textContent = "¡Envío realizado con éxito!";
      popup.className = "";
      popup.style.display = "block";

      setTimeout(() => {
        location.reload(); // Recargar la página
      }, 1200);
    })
    .catch((error) => {
      console.error("Error durante el envío:", error);
      popup.textContent = "Error al enviar. Inténtalo nuevamente.";
      popup.className = "error";
      popup.style.display = "block";

      setTimeout(() => {
        popup.style.display = "none";
      }, 3000);
    });
});
