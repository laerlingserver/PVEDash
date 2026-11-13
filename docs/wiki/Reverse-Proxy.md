# Reverse proxy (HTTPS)

PVEDash sends Proxmox credentials through a login form, so always serve it over HTTPS.
Run it with `TRUST_PROXY=true` and publish port 3000 on loopback only (`127.0.0.1:3000:3000`). Replace `pvedash.example.com`.

## Caddy (automatic certificates)

```
pvedash.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name pvedash.example.com;
    ssl_certificate     /etc/letsencrypt/live/pvedash.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pvedash.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
server { listen 80; server_name pvedash.example.com; return 301 https://$host$request_uri; }
```

## Traefik (Docker labels)

```yaml
services:
  pvedash:
    build: .
    environment: { PVE_HOST: "pve.example.com:8006", TRUST_PROXY: "true" }
    labels:
      - traefik.enable=true
      - traefik.http.routers.pvedash.rule=Host(`pvedash.example.com`)
      - traefik.http.routers.pvedash.entrypoints=websecure
      - traefik.http.routers.pvedash.tls.certresolver=letsencrypt
      - traefik.http.services.pvedash.loadbalancer.server.port=3000
```

## Notes
- Serve at the domain root; sub-path hosting (`/pvedash/`) is not supported.
- The proxy must forward `X-Forwarded-Proto`, otherwise the cookie won't be marked `Secure`.
- Consider extra access control (VPN, SSO/forward-auth) in front: anyone who reaches the login page can attempt to sign in to Proxmox.
