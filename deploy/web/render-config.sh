#!/bin/sh
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Writes config.json and the /privacy redirect before nginx starts. The keys come
# from the image's defaults (with any modules 18-load-element-modules.sh added),
# then /brand/config.json, then the WEB_CLIENT_* variables. Objects merge key by
# key; any other value replaces the one before it.
set -eu

config=/tmp/element-web-config/config.json
brand_config=/brand/config.json
privacy_conf=/etc/nginx/element-web/privacy.conf

log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "element-web: $*"
    fi
}

fail() {
    echo "element-web: $*" >&2
    exit 1
}

# True when $1 is one line that matches the extended regular expression $2,
# ignoring case, and its port, if it names one, lies between 1 and 65535.
valid() {
    [ "$(printf '%s\n' "$1" | wc -l)" -eq 1 ] && printf '%s\n' "$1" | grep -Eiq "$2" || return 1
    authority=${1#*://}
    authority=${authority%%[/?#]*}
    case $authority in
    \[*) port=${authority##*]} ;;
    *) port=${authority#"${authority%:*}"} ;;
    esac
    port=${port#:}
    [ -z "$port" ] || { [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; }
}

# RFC 3986, section 3: http and https URIs with a host name or IP literal, an
# optional port, and path, query and fragment characters or percent-encodings,
# without user information, whitespace, quotes, backslashes or dollar signs.
label='[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?'
host="($label(\.$label)*|\[[0-9A-Fa-f:.]+\])"
pchar="[/A-Za-z0-9._~!&'()*+,;=:@-]|%[0-9A-Fa-f]{2}"
url="https?://$host(:[0-9]{1,5})?(/($pchar)*)?"
base_url_re="^$url\$"
any_url_re="^$url(\?($pchar|\?)*)?(#($pchar|\?)*)?\$"
# Matrix specification, appendices, "Server Name": hostname [ ":" port ].
server_name_re="^$host(:[0-9]{1,5})?\$"

homeserver="${WEB_CLIENT_HOMESERVER:-}"
[ -n "$homeserver" ] ||
    fail "WEB_CLIENT_HOMESERVER is not set. Set it to the server name of the Matrix homeserver this client signs in to, for example matrix.example.org."
valid "$homeserver" "$server_name_re" ||
    fail "WEB_CLIENT_HOMESERVER is not a server name (a host name and an optional port, without scheme or path): $homeserver"

client_url="${WEB_CLIENT_URL:-}"
[ -n "$client_url" ] ||
    fail "WEB_CLIENT_URL is not set. Set it to the public URL of this web client, for example https://chat.example.org."
valid "$client_url" "$base_url_re" ||
    fail "WEB_CLIENT_URL is not an http(s) URL without query or fragment: $client_url"
scheme=$(printf '%s' "${client_url%%://*}" | tr '[:upper:]' '[:lower:]')
client_url=$(printf '%s' "$scheme://${client_url#*://}" | sed 's:/*$::')

privacy_url="${WEB_CLIENT_PRIVACY_URL:-}"
if [ -n "$privacy_url" ] && ! valid "$privacy_url" "$any_url_re"; then
    fail "WEB_CLIENT_PRIVACY_URL is not an http(s) URL: $privacy_url"
fi

source_url="${WEB_CLIENT_SOURCE_URL:-}"
if [ -z "$source_url" ] && [ -n "${SOURCE_REPOSITORY_URL:-}" ] && [ -n "${SOURCE_COMMIT:-}" ]; then
    source_url="${SOURCE_REPOSITORY_URL%/}/tree/$SOURCE_COMMIT"
fi
[ -n "$source_url" ] ||
    fail "No source code URL. Build the image with SOURCE_REPOSITORY_URL and SOURCE_COMMIT, or set WEB_CLIENT_SOURCE_URL to the source of this version."
valid "$source_url" "$any_url_re" ||
    fail "The source code URL is not an http(s) URL: $source_url"

brand_file=/dev/null
if [ -e "$brand_config" ]; then
    problem=$(jq -r -s 'if length != 1 then "it holds \(length) JSON values"
        elif (.[0] | type) != "object" then "it holds a JSON \(.[0] | type)"
        else "" end' "$brand_config" 2>&1) || true
    [ -z "$problem" ] || fail "/brand/config.json must be one JSON object, but $problem"
    brand_file=$brand_config
fi

logo_uri=
if [ -f /brand/logo.png ]; then
    logo_uri="$client_url/brand/logo.png"
fi
header_logo=
if [ -f /brand/logo.svg ]; then
    header_logo=brand/logo.svg
elif [ -f /brand/logo.png ]; then
    header_logo=brand/logo.png
fi

jq \
    --slurpfile brand "$brand_file" \
    --arg header_logo "$header_logo" \
    --arg homeserver "$homeserver" \
    --arg client_url "$client_url" \
    --arg logo_uri "$logo_uri" \
    --arg app_name "${WEB_CLIENT_APP_NAME:-}" \
    --arg source_url "$source_url" \
    '. * (if $header_logo == "" then {} else {branding: {auth_header_logo_url: $header_logo}} end)
    * ($brand[0] // {})
    * {
        default_server_config: {"m.homeserver": {base_url: "https://\($homeserver)", server_name: $homeserver}},
        branding: {logo_link_url: $client_url},
        oidc_metadata: (
            {client_uri: $client_url, policy_uri: "\($client_url)/privacy", tos_uri: "\($client_url)/privacy"}
            + (if $logo_uri == "" then {} else {logo_uri: $logo_uri} end)
        ),
        source_code_url: $source_url
    }
    * (if $app_name == "" then {} else {brand: $app_name} end)' \
    "$config" > "$config.tmp" || {
    rm -f "$config.tmp"
    fail "could not merge the configuration from $config, /brand/config.json and the environment"
}
name=$(jq -er '.brand | select(type == "string" and test("\\S") and (explode | all(. > 31 and . != 127)))' "$config.tmp") || {
    rm -f "$config.tmp"
    fail "The app name must be a non-empty line of text. Set WEB_CLIENT_APP_NAME or \"brand\" in /brand/config.json."
}
mv "$config.tmp" "$config"

if [ -n "${WEB_CLIENT_WELCOME_TEXT:-}" ]; then
    if jq -e '.sso_redirect_options.immediate == true' "$config" > /dev/null; then
        log "WEB_CLIENT_WELCOME_TEXT is ignored: Element Web has no welcome text, and with sso_redirect_options.immediate it shows no welcome page"
    else
        log "WEB_CLIENT_WELCOME_TEXT is ignored: Element Web has no welcome text; embedded_pages.welcome_url in /brand/config.json can name a welcome page"
    fi
fi
if [ -n "$privacy_url" ]; then
    printf 'location = /privacy {\n    return 302 "%s";\n}\n' "$privacy_url" > "$privacy_conf"
else
    : > "$privacy_conf"
    log "WEB_CLIENT_PRIVACY_URL is not set: /privacy answers 404, though the OAuth client registration names it as policy and terms"
fi
log "wrote config.json for $client_url as $name"
