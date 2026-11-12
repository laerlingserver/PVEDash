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
| `PVE_HOST` | – | Proxmox host to connect to (required unless `ALLOWED_HOSTS` is set). |
| `ALLOWED_HOSTS` | – | Comma-separated hosts selectable on the login form. |
| `PVE_INSECURE_TLS` | `false` | `true` skips certificate verification (self-signed certs). |
| `PVE_CA_CERT` | – | Path (inside the container) to a CA certificate to trust; preferred over disabling verification. |
| `TRUST_PROXY` | `false` | Set `true` behind an HTTPS reverse proxy so the session cookie gets the `Secure` flag. |

The container listens on `0.0.0.0:3000`. Publish it on `127.0.0.1` only unless something else protects it.
