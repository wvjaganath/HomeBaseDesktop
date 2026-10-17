# syntax=docker/dockerfile:1
#
# The official Caddy image, made to run unprivileged. Its binary carries a file
# capability (cap_net_bind_service) so root-less Caddy can bind :80/:443; with
# all capabilities dropped and no-new-privileges the kernel refuses to exec
# such a binary. HomeBase listens on 8080/8443 inside the container instead,
# so the capability is simply removed.
ARG CADDY_IMAGE=caddy:2-alpine
FROM ${CADDY_IMAGE}
# Refuse anything older than 2.11.4 (2026 security fixes); a Caddy 3 needs a
# review of the Caddyfile first.
RUN setcap -r /usr/bin/caddy \
 && v="$(caddy version | sed -E 's/^v([0-9]+)\.([0-9]+)\.([0-9]+).*/\1 \2 \3/')" \
 && set -- $v && [ "$1" -eq 2 ] && { [ "$2" -gt 11 ] || { [ "$2" -eq 11 ] && [ "$3" -ge 4 ]; }; } \
 && caddy version
USER 10001:10001
EXPOSE 8080 8443
