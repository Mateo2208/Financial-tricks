# gunicorn lee este archivo solo al arrancar desde esta carpeta (WorkingDirectory del servicio).
# Lo que se pasa por línea de comandos (-w, -b) tiene prioridad.

# Apps Script tarda 10-30 s por fila; el default de 30 s mataba al worker a mitad de
# la respuesta y nginx devolvía 502 aunque la fila ya estaba escrita.
# Tiene que ser mayor que GS_TIMEOUT de app.py.
timeout = 90

# Casi todo el tiempo es esperar a Google: con hilos, una petición lenta no bloquea a las demás.
worker_class = "gthread"
threads = 4
