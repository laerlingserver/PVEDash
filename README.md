# PVEDash

A cloud-console-style web UI for Proxmox VE: overview dashboard, searchable instance list (VMs + LXC containers),
one-click start/shutdown/reboot, size-preset launcher, live metrics, snapshots, storage, nodes and activity log.

No dependencies; requires Node 18+.

```sh
PVE_HOST=pve.example.com:8006 npm start     # http://127.0.0.1:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `PVE_HOST` | – | Proxmox host to connect to (required unless `ALLOWED_HOSTS` is set). |
| `ALLOWED_HOSTS` | – | Comma-separated hosts users may pick on the login form (when `PVE_HOST` is unset). |
| `PVE_INSECURE_TLS` | `false` | Set `true` to skip certificate verification (self-signed certs). |
| `PVE_CA_CERT` | – | Path to a CA/self-signed certificate to trust instead of disabling verification. |
| `PORT` / `BIND` | `3000` / `127.0.0.1` | Listen address. Put behind HTTPS if you bind publicly. |

Sign in with a Proxmox user/password or an API token. Credentials stay in an in-memory server session
(HttpOnly cookie) and are never sent to the browser. Sessions expire after 2 hours and are lost on restart.

Limitations: no two-factor password login (use an API token); the console button opens Proxmox's own noVNC page.

## Docker & reverse proxy

Prebuilt image: `laerlingserver/pvedash:latest` (Docker Hub). `docker compose up -d` (edit `PVE_HOST` in `docker-compose.yml`). Setup guides live in [`docs/wiki`](docs/wiki)
(Docker, Reverse-Proxy) and are mirrored to the GitHub wiki.
