# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# The white-label image (README.md, "Deployment contract"). BASE_IMAGE is the
# element_web stage of apps/web/Dockerfile, built from the same commit; the build
# context is this directory.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG SOURCE_REPOSITORY_URL=
ARG SOURCE_COMMIT=
LABEL org.opencontainers.image.title="element-web" \
      org.opencontainers.image.description="Element Web, configured at start from WEB_CLIENT_* variables and /brand" \
      org.opencontainers.image.url=$SOURCE_REPOSITORY_URL \
      org.opencontainers.image.source=$SOURCE_REPOSITORY_URL \
      org.opencontainers.image.version=$SOURCE_COMMIT \
      org.opencontainers.image.revision=$SOURCE_COMMIT \
      org.opencontainers.image.licenses="AGPL-3.0-only OR GPL-3.0-only"
ENV SOURCE_REPOSITORY_URL=$SOURCE_REPOSITORY_URL \
    SOURCE_COMMIT=$SOURCE_COMMIT

USER root

RUN command -v jq > /dev/null || apk add --no-cache jq

# 50-apply-brand.sh rewrites these files at every start, from the copies kept here.
# Like the rest of the base image, they are writable for the root group, so the
# image also runs under another user ID in that group.
RUN set -eu; \
    cd /app; \
    for file in index.html manifest.json vector-icons/*.png \
        themes/element/img/logos/element-logo.svg themes/element/img/logos/element-app-logo.png; do \
        mkdir -p "/usr/share/element-web/stock/$(dirname "$file")"; \
        cp "$file" "/usr/share/element-web/stock/$file"; \
        chown nginx:root "$file"; \
        chmod g+w "$file"; \
    done

# Upstream's server block includes /etc/nginx/element-web/*.conf: locations.conf and
# the privacy.conf 40-render-config.sh writes.
COPY locations.conf /etc/nginx/element-web/locations.conf
RUN set -eu; \
    template=/etc/nginx/templates/default.conf.template; \
    if [ "$(grep -cx '}' "$template")" != 1 ]; then \
        echo "$template has no single closing brace for its server block" >&2; \
        exit 1; \
    fi; \
    sed -i 's|^}$|    include /etc/nginx/element-web/*.conf;\n}|' "$template"; \
    grep -q '^    include /etc/nginx/element-web/\*\.conf;$' "$template"; \
    chown nginx:root /etc/nginx/element-web; \
    chmod g+w /etc/nginx/element-web

COPY config.json /app/config.json
COPY --chmod=0755 render-config.sh /docker-entrypoint.d/40-render-config.sh
COPY --chmod=0755 apply-brand.sh /docker-entrypoint.d/50-apply-brand.sh

USER nginx

EXPOSE 80
