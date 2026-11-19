# syntax=docker/dockerfile:1
#
# Govee room sensors over Bluetooth (govee/listener.py), next to the hub.
# Talks to the host's Bluetooth service (BlueZ) through the D-Bus socket that
# docker-compose mounts in; answers the hub on the private `govee` network.
# Built from the repo root:  docker compose -f deploy/docker-compose.yml --profile govee build govee
ARG PYTHON_IMAGE=python:3.14-slim

FROM ${PYTHON_IMAGE} AS deps
COPY govee/requirements.txt /tmp/requirements.txt
# Exact versions with hashes, wheels only (no build scripts run).
RUN python -m pip install --no-cache-dir --disable-pip-version-check \
      --require-hashes --only-binary=:all: --target /opt/govee/site -r /tmp/requirements.txt

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONPATH=/opt/govee/site \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp
COPY --from=deps /opt/govee/site /opt/govee/site
COPY govee/listener.py /opt/govee/listener.py
# Code is root-owned and read-only.
RUN chmod -R a-w /opt/govee \
 && python -c "import bleak, govee_ble, home_assistant_bluetooth; print('govee deps ok')"
USER 10001:10001
EXPOSE 8686
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8686/health', timeout=4)"]
CMD ["python", "/opt/govee/listener.py"]
