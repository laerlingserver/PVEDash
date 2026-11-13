# Running with Docker

Prebuilt images: `laerlingserver/pvedash:latest` (Docker Hub) and `ghcr.io/laerlingserver/pvedash:latest` (GitHub Container Registry).

```sh
docker run -d --name pvedash --restart unless-stopped \
  -p 3000:3000 \
  -e PVE_HOST=pve.example.com:8006 \
  laerlingserver/pvedash:latest
```

To build it yourself instead: `docker build -t pvedash .` and run `pvedash`.

Or `docker compose up -d` using the `docker-compose.yml` in the repo (edit `PVE_HOST` first).

| Variable | Default | Purpose |
|---|---|---|
| `PVE_HOST` | – | Proxmox host to connect to (required unless `ALLOWED_HOSTS` is set). |
| `ALLOWED_HOSTS` | – | Comma-separated hosts selectable on the login form. |
| `PVE_INSECURE_TLS` | `false` | `true` skips certificate verification (self-signed certs). |
| `PVE_CA_CERT` | – | Path (inside the container) to a CA certificate to trust; preferred over disabling verification. |
| `TRUST_PROXY` | `false` | Set `true` behind an HTTPS reverse proxy so the session cookie gets the `Secure` flag. |

The UI is then at `http://<docker-host>:3000`. With `-p 127.0.0.1:3000:3000` it is only reachable from the Docker host itself, which is what you want behind a reverse proxy on the same host, but gives `ERR_CONNECTION_REFUSED` from other machines.

Login is plain HTTP unless you add a reverse proxy; see [[Reverse-Proxy]].
