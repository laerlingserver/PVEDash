# PVEDash

A cloud-console-style web UI for Proxmox VE: overview dashboard, searchable instance list (VMs + LXC containers),
one-click start/shutdown/reboot, size-preset launcher, live metrics, snapshots, storage, nodes and activity log.

No dependencies; requires Node 18+.

```sh
PVE_HOST=pve.example.com:8006 npm start     # http://127.0.0.1:3000
```

| Variable | Default | Purpose |
|---|---|---|
| `PVE_HOST` | – | Lock to one Proxmox host. If unset, the login form asks for the host. |
| `PVE_INSECURE_TLS` | `true` | Accept self-signed Proxmox certificates. Set `false` to verify. |
| `PORT` / `BIND` | `3000` / `127.0.0.1` | Listen address. Put behind HTTPS if you bind publicly. |

Sign in with a Proxmox user/password or an API token. Credentials stay in an in-memory server session
(HttpOnly cookie) and are never sent to the browser. Sessions expire after 2 hours and are lost on restart.

Limitations: no two-factor password login (use an API token); the console button opens Proxmox's own noVNC page.
