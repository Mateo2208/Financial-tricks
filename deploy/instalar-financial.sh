#!/bin/bash
# Instala QuickCash nuevo en financial.matsoto.dev, EN PARALELO al servicio actual
# (financialtricks / sheet.matsoto.dev / puerto 5001), que no se toca.
# Correr una vez, con sudo:  ssh -t personal 'sudo bash ~/quickcash/deploy/instalar-financial.sh'
set -euo pipefail
USUARIO=mateo2208
DIR=/home/$USUARIO/quickcash
DOMINIO=financial.matsoto.dev
PUERTO=5002

[ "$(id -u)" = 0 ] || { echo "Correr con sudo"; exit 1; }
[ -f "$DIR/config.env" ] || { echo "Falta $DIR/config.env"; exit 1; }

echo "== 1/4 servicio systemd quickcash (puerto $PUERTO)"
cat > /etc/systemd/system/quickcash.service <<UNIT
[Unit]
Description=QuickCash nuevo (financial.matsoto.dev)
After=network.target

[Service]
User=$USUARIO
Group=www-data
WorkingDirectory=$DIR
Environment="PATH=$DIR/venv/bin"
ExecStart=$DIR/venv/bin/gunicorn -w 2 -b 127.0.0.1:$PUERTO app:app
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
# El gunicorn de prueba lanzado a mano ocupa el puerto: bajarlo antes
pkill -u $USUARIO -f "gunicorn -w 2 -b 127.0.0.1:$PUERTO" || true
sleep 1
systemctl daemon-reload
systemctl enable --now quickcash
sleep 2
systemctl is-active quickcash

echo "== 2/4 nginx $DOMINIO -> 127.0.0.1:$PUERTO"
cat > /etc/nginx/sites-available/$DOMINIO <<NGINX
server {
    server_name $DOMINIO;

    location / {
        proxy_pass http://127.0.0.1:$PUERTO;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Google Sheets tarda hasta ~30 s por registro; la app corta a los 55 s
        proxy_read_timeout 90s;
    }

    client_max_body_size 1M;
    listen 80;
}
NGINX
ln -sf /etc/nginx/sites-available/$DOMINIO /etc/nginx/sites-enabled/$DOMINIO
nginx -t
systemctl reload nginx

echo "== 3/4 certificado SSL"
certbot --nginx -d $DOMINIO --non-interactive --redirect --keep-until-expiring
nginx -t && systemctl reload nginx

echo "== 4/4 verificación"
curl -s -o /dev/null -w "https://$DOMINIO/ -> %{http_code}\n" https://$DOMINIO/
curl -s -o /dev/null -w "servicio actual (5001) -> %{http_code}\n" http://127.0.0.1:5001/health
echo "Listo."
