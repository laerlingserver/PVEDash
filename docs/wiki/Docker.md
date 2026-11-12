# Running with Docker

```sh
docker build -t pvedash .
docker run -d --name pvedash --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e PVE_HOST=pve.example.com:8006 \
  pvedash
```

Or `docker compose up -d` using the `docker-compose.yml` in the repo (edit `PVE_HOST` first).

| Variable | Default | Purpose |
|---|---|---|
| `PVE_HOST` | – | Lock to one Proxmox host (otherwise the login form asks). |
| `PVE_INSECURE_TLS` | `true` | Accept self-signed Proxmox certificates. |
| `TRUST_PROXY` | `false` | Set `true` behind an HTTPS reverse proxy so the session cookie gets the `Secure` flag. |

The container listens on `0.0.0.0:3000`. Publish it on `127.0.0.1` only unless something else protects it.
