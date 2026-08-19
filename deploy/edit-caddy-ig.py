#!/usr/bin/env python3
# Add the §26 maintenance gate (with admin exemption) to the Innovation & Growth block
# (drepdao.176-102-64-240.sslip.io) of the Caddyfile. Idempotent.
import re, time, shutil, pathlib

CADDY = "/etc/caddy/Caddyfile"
HEADER = "drepdao.176-102-64-240.sslip.io {"
DIR = "/opt/drep-dao"
SNIPPET = (
    f"\troot * {DIR}\n\n"
    "\t# §26 — maintenance gate: while /opt/drep-dao/MAINTENANCE exists, everyone gets the\n"
    "\t# \"Short maintenance mode\" page (503). Toggled by deploy-guard.sh / the sysadmin panel;\n"
    "\t# checked per request, so no Caddy reload is needed. Admin panel + its API stay reachable.\n"
    "\t@maint {\n"
    "\t\tfile /MAINTENANCE\n"
    "\t\tnot path /admin* /api/v1/sysadmin/* /_next/* /favicon.ico /favicon.svg /icons/*\n"
    "\t}\n"
    "\thandle @maint {\n"
    "\t\trewrite * /maintenance.html\n"
    "\t\tfile_server {\n"
    "\t\t\tstatus 503\n"
    "\t\t}\n"
    "\t}\n"
)

lines = pathlib.Path(CADDY).read_text().split("\n")
out, i, changed = [], 0, 0
while i < len(lines):
    out.append(lines[i])
    if lines[i].strip() == HEADER:
        # find block end + whether gate already present
        j, depth, block = i + 1, 1, []
        while j < len(lines) and depth > 0:
            if lines[j].startswith("}"):
                depth -= 1
                if depth == 0:
                    break
            block.append(lines[j]); j += 1
        if not any("@maint" in b for b in block):
            k, inserted = i + 1, False
            while k < j:
                out.append(lines[k])
                if not inserted and lines[k].strip() == "encode zstd gzip":
                    out.append(SNIPPET.rstrip("\n")); inserted = True
                k += 1
            i = j; changed += 1
            continue
    i += 1

if changed:
    shutil.copy(CADDY, f"{CADDY}.bak.ig.{int(time.time())}")
    pathlib.Path(CADDY).write_text("\n".join(out))
print(f"I&G block updated: {changed}")
