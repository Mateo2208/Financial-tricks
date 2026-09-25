#!/bin/sh
# Sube el código a Google y actualiza la implementación de producción SIN cambiar la URL /exec.
# El ID de la implementación ES la URL (con él cualquiera escribe en la hoja): vive en
# .deployment-id, fuera de git. Si falta: `clasp list-deployments` y copiar el que usa
# ~/Financial-tricks/.gs_url en el VPS.
set -e
cd "$(dirname "$0")"
ID=$(cat .deployment-id)
clasp push --force
clasp deploy -i "$ID" -d "${1:-deploy $(date +%F)}"
