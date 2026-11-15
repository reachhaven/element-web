#!/bin/sh
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Checks an image against the deployment contract (README.md, "Deployment
# contract"): starts it with an invented brand on 127.0.0.1:${TEST_PORT:-18080},
# checks it over HTTP, then checks that bad settings stop it.
# Usage: deploy/web/test-image.sh <image>. Needs docker, curl and jq.
set -eu

image=${1:?usage: deploy/web/test-image.sh <image>}
port=${TEST_PORT:-18080}
url="http://localhost:$port"
container="element-web-test-$$"
work=$(mktemp -d)
failures=0

cleanup() {
    docker rm -f "$container" "$container-refused" > /dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT INT TERM

check() {
    description=$1
    shift
    if "$@" > "$work/check.log" 2>&1; then
        echo "ok   $description"
    else
        echo "FAIL $description"
        sed 's/^/     /' "$work/check.log"
        failures=$((failures + 1))
    fi
}

# Fetches $1 into $work/body and its headers into $work/headers.
fetch() {
    curl -sS -o "$work/body" -D "$work/headers" "$url$1"
}

status_is() {
    head -n 1 "$work/headers" | grep -q " $1 "
}

header_is() {
    tr -d '\r' < "$work/headers" | grep -qix "$1: $2"
}

answers() {
    fetch "$1" && status_is "$2"
}

no_cache() {
    fetch "$1" && status_is 200 && header_is cache-control no-cache
}

body_has() {
    fetch "$1" && status_is 200 && grep -qF "$2" "$work/body"
}

body_lacks() {
    fetch "$1" && status_is 200 && ! grep -qF "$2" "$work/body"
}

# $1 serves the bytes of the file $2.
serves() {
    fetch "$1" && status_is 200 && cmp "$work/body" "$2"
}

config_is() {
    fetch /config.json && status_is 200 && jq -e "$1" "$work/body" > /dev/null
}

manifest_is() {
    fetch /manifest.json && status_is 200 && jq -e "$1" "$work/body" > /dev/null
}

redirects() {
    fetch "$1" && status_is 302 && header_is location "$2"
}

# The hashed copy of the 24 pixel icon that index.html links serves the file $1.
hashed_tab_icon() {
    fetch / && icon=$(grep -o 'vector-icons/24\.[0-9a-f]*\.png' "$work/body" | head -n 1) &&
        [ -n "$icon" ] && serves "/$icon" "$1"
}

logs_have() {
    docker logs "$container" 2>&1 | grep -qF "$1"
}

start() {
    docker rm -f "$container" > /dev/null 2>&1 || true
    docker run -d --name "$container" -p "127.0.0.1:$port:80" "$@" "$image" > /dev/null
    tries=0
    until curl -fsS -o /dev/null "$url/config.json" 2> /dev/null; do
        tries=$((tries + 1))
        if [ "$tries" -ge 60 ] || [ "$(docker inspect -f '{{.State.Running}}' "$container")" != true ]; then
            echo "The container did not start:"
            docker logs "$container" 2>&1 | sed 's/^/     /'
            exit 1
        fi
        sleep 0.5
    done
}

# Runs the image with the options after $1 and expects it to stop with an
# error that contains $1.
refuses() {
    message=$1
    shift
    if timeout 60 docker run --rm --name "$container-refused" "$@" "$image" > "$work/refused.log" 2>&1; then
        echo "The container stopped without an error:"
        cat "$work/refused.log"
        return 1
    fi
    if ! grep -qF "$message" "$work/refused.log"; then
        echo "The container stopped without \"$message\":"
        cat "$work/refused.log"
        return 1
    fi
}

image_env() {
    docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image" | sed -n "s/^$1=\(..*\)\$/\1/p"
}

repository=$(image_env SOURCE_REPOSITORY_URL)
commit=$(image_env SOURCE_COMMIT)
if [ -n "$repository" ] && [ -n "$commit" ]; then
    expected_source="$repository/tree/$commit"
    set --
else
    expected_source=https://source.example.org/tree/test
    set -- -e "WEB_CLIENT_SOURCE_URL=$expected_source"
fi

# The invented brand. Icons and logos are placeholder bytes: the image copies
# them and never reads them.
brand="$work/brand"
mkdir -p "$brand/icons"
printf 'favicon' > "$brand/favicon.png"
for size in 32 192 512; do
    printf 'icon %s' "$size" > "$brand/icons/Icon-$size.png"
done
printf 'maskable 192' > "$brand/icons/Icon-maskable-192.png"
printf 'logo png' > "$brand/logo.png"
printf '<svg xmlns="http://www.w3.org/2000/svg"/>' > "$brand/logo.svg"
cat > "$brand/config.json" << 'EOF'
{
    "brand": "Name From The Brand Config",
    "default_theme": "dark",
    "branding": {
        "logo_link_url": "https://brand-config.example.org",
        "welcome_background_url": "brand/background.jpg"
    },
    "setting_defaults": {
        "UIFeature.shareSocial": true
    }
}
EOF
cat > "$brand/manifest.json" << 'EOF'
{
    "name": "Name From The Brand Manifest",
    "display": "fullscreen"
}
EOF

echo "A brand directory with every file, and every variable:"
start -v "$brand:/brand:ro" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org \
    -e WEB_CLIENT_URL="$url/" \
    -e WEB_CLIENT_APP_NAME="Example Chat" \
    -e WEB_CLIENT_PRIVACY_URL=https://example.org/privacy \
    -e WEB_CLIENT_WELCOME_TEXT="Hello" \
    "$@"
check "/ serves the app with the name as title" body_has / "<title>Example Chat</title>"
check "/ answers with Cache-Control: no-cache" no_cache /
check "index.html names the app for home screens" body_has / '<meta name="application-name" content="Example Chat">'
check "index.html has the brand logo as og:image" \
    body_has / "<meta property=\"og:image\" content=\"$url/brand/logo.png\""
check "/config.json answers with Cache-Control: no-cache" no_cache /config.json
check "a variable beats the brand config: brand" config_is '.brand == "Example Chat"'
check "the brand config beats the defaults: default_theme" config_is '.default_theme == "dark"'
check "a variable beats the brand config: branding.logo_link_url" \
    config_is ".branding.logo_link_url == \"$url\""
check "objects merge key by key: branding.welcome_background_url stays" \
    config_is '.branding.welcome_background_url == "brand/background.jpg"'
check "objects merge key by key: setting_defaults" \
    config_is '.setting_defaults == {"UIFeature.identityServer": false, "UIFeature.shareSocial": true}'
check "the image defaults stay" config_is '.disable_custom_urls and .disable_guests and .disable_3pid_login
    and .show_labs_settings == false and .features.feature_wysiwyg_composer
    and .sso_redirect_options.immediate and .integrations_ui_url == null'
check "the homeserver is https://WEB_CLIENT_HOMESERVER" config_is '.default_server_config["m.homeserver"]
    == {"base_url": "https://matrix.example.org", "server_name": "matrix.example.org"}'
check "the OAuth client metadata sits on WEB_CLIENT_URL" config_is ".oidc_metadata == {
    \"client_uri\": \"$url\", \"policy_uri\": \"$url/privacy\", \"tos_uri\": \"$url/privacy\",
    \"logo_uri\": \"$url/brand/logo.png\"}"
check "the sign-in screens show logo.svg" config_is '.branding.auth_header_logo_url == "brand/logo.svg"'
check "source_code_url is $expected_source" config_is ".source_code_url == \"$expected_source\""
check "/brand/logo.png is served" serves /brand/logo.png "$brand/logo.png"
check "/brand/logo.png answers with Cache-Control: no-cache" no_cache /brand/logo.png
check "/privacy redirects to WEB_CLIENT_PRIVACY_URL" redirects /privacy https://example.org/privacy
check "/version answers with Cache-Control: no-cache" no_cache /version
check "the manifest carries the name" manifest_is '.name == "Example Chat" and .short_name == "Example Chat"'
check "the brand manifest is merged" manifest_is '.display == "fullscreen"'
check "the manifest lists no native apps" manifest_is 'has("related_applications") | not'
check "the manifest lists the maskable icon" manifest_is '.icons | any(.purpose == "maskable"
    and .src == "brand/icons/Icon-maskable-192.png" and .sizes == "192x192")'
check "/manifest.json answers with Cache-Control: no-cache" no_cache /manifest.json
check "favicon.png is the tab icon" serves /vector-icons/24.png "$brand/favicon.png"
check "favicon.png is the hashed tab icon index.html links" hashed_tab_icon "$brand/favicon.png"
check "the 120 pixel icon is Icon-192.png" serves /vector-icons/120.png "$brand/icons/Icon-192.png"
check "the 512 pixel icon is Icon-512.png" serves /vector-icons/512.png "$brand/icons/Icon-512.png"
check "the 1024 pixel icon is the largest, Icon-512.png" serves /vector-icons/1024.png "$brand/icons/Icon-512.png"
check "/vector-icons/ answers with Cache-Control: no-cache" no_cache /vector-icons/512.png
check "logo.svg replaces the app logo" serves /themes/element/img/logos/element-logo.svg "$brand/logo.svg"
check "logo.png replaces the logo of the error page" \
    serves /themes/element/img/logos/element-app-logo.png "$brand/logo.png"
check "the welcome text is noted as ignored" logs_have "WEB_CLIENT_WELCOME_TEXT is ignored"

stock="$work/stock"
mkdir -p "$stock"
docker run --rm --entrypoint cat "$image" /usr/share/element-web/stock/vector-icons/24.png > "$stock/24.png"
docker run --rm --entrypoint cat "$image" /usr/share/element-web/stock/themes/element/img/logos/element-logo.svg \
    > "$stock/element-logo.svg"
docker run --rm --entrypoint cat "$image" /usr/share/element-web/stock/manifest.json > "$stock/manifest.json"

echo "A brand directory with only config.json, no privacy URL, an explicit source URL:"
named="$work/named"
mkdir -p "$named"
printf '{"brand": "Example Chat"}' > "$named/config.json"
start -v "$named:/brand:ro" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org:8448 \
    -e WEB_CLIENT_URL="HTTP://localhost:$port" \
    -e WEB_CLIENT_SOURCE_URL=https://source.example.org/tree/explicit
check "the brand config names the app" body_has / "<title>Example Chat</title>"
check "the scheme of WEB_CLIENT_URL is lower-cased" config_is ".oidc_metadata.client_uri == \"$url\""
check "index.html has no og:image" body_lacks / 'og:image'
check "WEB_CLIENT_SOURCE_URL wins" config_is '.source_code_url == "https://source.example.org/tree/explicit"'
check "the OAuth client metadata has no logo" config_is '.oidc_metadata | has("logo_uri") | not'
check "the sign-in screens keep the app logo" config_is '.branding | has("auth_header_logo_url") | not'
check "the server name keeps its port" \
    config_is '.default_server_config["m.homeserver"].base_url == "https://matrix.example.org:8448"'
check "/privacy answers 404" answers /privacy 404
check "the tab icon is the app's own" serves /vector-icons/24.png "$stock/24.png"
check "the logo is the app's own" serves /themes/element/img/logos/element-logo.svg "$stock/element-logo.svg"
check "the manifest keeps the app's icons" \
    manifest_is ".icons == $(jq -c .icons "$stock/manifest.json")"

echo "An empty brand directory, another user ID in the root group:"
empty="$work/empty"
mkdir -p "$empty"
start --user 1000:0 -v "$empty:/brand:ro" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org \
    -e WEB_CLIENT_URL="$url" \
    -e WEB_CLIENT_APP_NAME="Example Chat" \
    -e WEB_CLIENT_SOURCE_URL=https://source.example.org/tree/explicit
check "WEB_CLIENT_APP_NAME names the app" body_has / "<title>Example Chat</title>"
check "the tab icon is the app's own" serves /vector-icons/24.png "$stock/24.png"
docker rm -f "$container" > /dev/null

echo "Settings that stop the container:"
set -- -e WEB_CLIENT_HOMESERVER=matrix.example.org -e WEB_CLIENT_URL=https://chat.example.org \
    -e WEB_CLIENT_SOURCE_URL=https://source.example.org
check "no WEB_CLIENT_HOMESERVER" refuses "WEB_CLIENT_HOMESERVER is not set" \
    -e WEB_CLIENT_URL=https://chat.example.org -e WEB_CLIENT_APP_NAME=Chat
check "a URL as WEB_CLIENT_HOMESERVER" refuses "WEB_CLIENT_HOMESERVER is not a server name" \
    -e WEB_CLIENT_HOMESERVER=https://matrix.example.org -e WEB_CLIENT_URL=https://chat.example.org
check "a port above 65535 in WEB_CLIENT_HOMESERVER" refuses "WEB_CLIENT_HOMESERVER is not a server name" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org:65536 -e WEB_CLIENT_URL=https://chat.example.org
check "no WEB_CLIENT_URL" refuses "WEB_CLIENT_URL is not set" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org -e WEB_CLIENT_APP_NAME=Chat
check "a query in WEB_CLIENT_URL" refuses "WEB_CLIENT_URL is not an http(s) URL without query or fragment" \
    -e WEB_CLIENT_HOMESERVER=matrix.example.org -e WEB_CLIENT_URL="https://chat.example.org/?a=b"
check "no app name" refuses "The app name must be a non-empty line of text" "$@"
check "a quote in WEB_CLIENT_PRIVACY_URL" refuses "WEB_CLIENT_PRIVACY_URL is not an http(s) URL" "$@" \
    -e WEB_CLIENT_APP_NAME=Chat -e WEB_CLIENT_PRIVACY_URL='https://example.org/"; return 200 "x'
check "a broken percent-encoding in WEB_CLIENT_PRIVACY_URL" refuses "WEB_CLIENT_PRIVACY_URL is not an http(s) URL" \
    "$@" -e WEB_CLIENT_APP_NAME=Chat -e WEB_CLIENT_PRIVACY_URL=https://example.org/%zz
printf '["not", "an", "object"]' > "$work/array.json"
check "a brand config that is not an object" refuses "/brand/config.json must be one JSON object" "$@" \
    -e WEB_CLIENT_APP_NAME=Chat -v "$work/array.json:/brand/config.json:ro"
printf '{"broken": ' > "$work/broken.json"
check "a brand config that is not JSON" refuses "/brand/config.json must be one JSON object" "$@" \
    -e WEB_CLIENT_APP_NAME=Chat -v "$work/broken.json:/brand/config.json:ro"
check "a brand manifest that is not an object" refuses "/brand/manifest.json must be one JSON object" "$@" \
    -e WEB_CLIENT_APP_NAME=Chat -v "$work/array.json:/brand/manifest.json:ro"

if [ "$failures" -gt 0 ]; then
    echo "$failures checks failed"
    exit 1
fi
echo "All checks passed"
