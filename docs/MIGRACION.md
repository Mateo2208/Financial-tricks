# Cambio definitivo a la versión nueva

Hoy la versión nueva (QuickCash + planilla "GESTIÓN 2026 (NUEVA)") está en prueba y la vieja
(GitHub Pages + `sheet.matsoto.dev` + planilla original) sigue en uso. Pasos para el cambio, en orden.
Ninguno se hace sin el OK explícito del dueño.

1. **Congelar la vieja un momento** (avisar en casa que no registren por unos minutos).
2. **Volcar la planilla original** con `Volcado.js` (datos al día) y regenerar los datos:
   `privado/extraer.py`.
3. **Reconstruir la planilla nueva** con los datos al día: `privado/importar.py`. Revisar RESUMEN,
   GASTOS DIARIOS y SALDOS contra la original.
4. **Motor propio de producción**: crear un proyecto de Apps Script para la planilla nueva (o
   ligar el actual), publicarlo con `./deploy.sh prod`, autorizarlo una vez desde el navegador y
   poner su URL `/exec` y su token en `~/quickcash/config.env`. Recargar el servicio.
5. **Compartir la planilla** con la cuenta de Google de quien la usa (editor).
6. **Instalar la app** en los celulares (financial.matsoto.dev → "Agregar a inicio") y entrar con la
   clave de la casa.
7. **Retirar la vieja**: desactivar GitHub Pages, bajar el servicio `financialtricks` y el sitio
   `sheet.matsoto.dev`, archivar las implementaciones viejas del Apps Script original.
8. **Repo privado**: pasar `Mateo2208/Financial-tricks` a privado (decidido: al terminar, no antes).
9. **Unir ramas**: `quickcash-nuevo` pasa a ser `main`.
