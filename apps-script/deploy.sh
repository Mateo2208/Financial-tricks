#!/bin/sh
# Publica el Apps Script en un destino, sin cambiar su URL /exec:
#   ./deploy.sh pruebas "mensaje"   copia de la planilla (PRUEBAS QuickCash)
#   ./deploy.sh prod "mensaje"      planilla real FINANCIAL TRICKS - GESTION 2026
#
# Por destino (todo fuera de git; el ID de implementación ES la URL con la que se
# lee y escribe la hoja):
#   .clasp.<destino>.json          proyecto (scriptId)
#   .secreto.<destino>.js          const TOKEN = "..." (igual a GS_TOKEN del servidor)
#   .deployment-id.<destino>       implementación web a actualizar; si no existe se crea
#                                  una nueva y se guarda su ID.
set -e
cd "$(dirname "$0")"
DEST="$1"; MSG="${2:-deploy $(date +%F)}"
case "$DEST" in prod|pruebas) ;; *) echo "Uso: ./deploy.sh prod|pruebas [mensaje]"; exit 1;; esac

if [ -f ".secreto.$DEST.js" ]; then
  cp ".secreto.$DEST.js" Secreto.js
else
  rm -f Secreto.js  # sin TOKEN el script rechaza todo: no publicar a medias
  echo "Falta .secreto.$DEST.js"; exit 1
fi
trap 'rm -f Secreto.js' EXIT

clasp -P "$PWD/.clasp.$DEST.json" push --force
if [ -f ".deployment-id.$DEST" ]; then
  clasp -P "$PWD/.clasp.$DEST.json" deploy -i "$(cat .deployment-id.$DEST)" -d "$MSG"
else
  clasp -P "$PWD/.clasp.$DEST.json" deploy -d "$MSG" | tee /dev/stderr | grep -oE 'AKfyc[A-Za-z0-9_-]+' | head -1 > ".deployment-id.$DEST"
  echo "Nueva implementación: https://script.google.com/macros/s/$(cat .deployment-id.$DEST)/exec"
fi
