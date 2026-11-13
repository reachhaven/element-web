#!/bin/sh
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Puts the brand into the app before nginx starts: the files a deployment mounts
# at /brand over the app's icons and logos, and the name from the config.json
# 40-render-config.sh wrote into index.html and manifest.json. Every start begins
# from the image's own copies of these files, so a file removed from /brand goes
# back to the app's own. The files are written in place: the nginx user owns
# them, not their directories.
set -eu

app=/app
stock=/usr/share/element-web/stock
brand=/brand
config=/tmp/element-web-config/config.json

log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "element-web: $*"
    fi
}

fail() {
    echo "element-web: $*" >&2
    exit 1
}

# Fails unless the file $1 holds one JSON object.
require_object() {
    problem=$(jq -r -s 'if length != 1 then "it holds \(length) JSON values"
        elif (.[0] | type) != "object" then "it holds a JSON \(.[0] | type)"
        else "" end' "$1" 2>&1) || true
    [ -z "$problem" ] || fail "$1 must be one JSON object, but $problem"
}

# Sizes of the files /brand/icons/<prefix><size>.png, smallest first.
icon_sizes() {
    find "$brand/icons" -maxdepth 1 -name "$1*.png" 2>/dev/null |
        sed -n "s:.*/$1\([0-9][0-9]*\)\.png\$:\1:p" | sort -n
}

# The brand file for an app icon of $1 pixels: favicon.png up to 32 pixels, the
# browser tab's size, else the smallest icons/Icon-<size>.png at least that
# large, else the largest one.
icon_for() {
    if [ "$1" -le 32 ] && [ -f "$brand/favicon.png" ]; then
        echo "$brand/favicon.png"
        return
    fi
    chosen=
    for size in $sizes; do
        chosen=$size
        [ "$size" -lt "$1" ] || break
    done
    if [ -n "$chosen" ]; then
        echo "$brand/icons/Icon-$chosen.png"
    fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

(cd "$stock" && find . -type f) | while read -r file; do
    cat "$stock/$file" > "$app/$file"
done

name=$(jq -er '.brand' "$config") || fail "$config has no app name; 40-render-config.sh writes it"
image=$(jq -r '.oidc_metadata.logo_uri // ""' "$config")

copied=0
sizes=$(icon_sizes Icon-)
for icon in "$stock"/vector-icons/*.png; do
    file=${icon##*/}
    size=${file%%.*}
    case $size in '' | *[!0-9]*) continue ;; esac
    source=$(icon_for "$size")
    if [ -n "$source" ]; then
        cat "$source" > "$app/vector-icons/$file"
        copied=$((copied + 1))
    fi
done
for logo in logo.svg:element-logo.svg logo.png:element-app-logo.png; do
    if [ -f "$brand/${logo%%:*}" ]; then
        cat "$brand/${logo%%:*}" > "$app/themes/element/img/logos/${logo#*:}"
        copied=$((copied + 1))
    fi
done

brand_manifest=/dev/null
if [ -e "$brand/manifest.json" ]; then
    require_object "$brand/manifest.json"
    brand_manifest=$brand/manifest.json
fi
jq \
    --slurpfile brand "$brand_manifest" \
    --arg name "$name" \
    --arg maskable "$(icon_sizes Icon-maskable- | tr '\n' ' ')" \
    'del(.related_applications) * ($brand[0] // {})
    | .name = $name
    | .short_name = $name
    | .icons += [$maskable | splits(" +") | select(. != "")
        | {src: "brand/icons/Icon-maskable-\(.).png", sizes: "\(.)x\(.)", type: "image/png", purpose: "maskable"}]' \
    "$stock/manifest.json" > "$work/manifest.json" || fail "could not write manifest.json"
cat "$work/manifest.json" > "$app/manifest.json"

jq -Rsj \
    --arg name "$name" \
    --arg image "$image" \
    'def rewrite($pattern; $with):
        if test($pattern) then sub($pattern; $with)
        else error("index.html has no match for \($pattern)") end;
    ($name | @html) as $n
    | rewrite("<title>[^<]*</title>"; "<title>\($n)</title>")
    | rewrite("<meta name=\"apple-mobile-web-app-title\" content=\"[^\"]*\"";
        "<meta name=\"apple-mobile-web-app-title\" content=\"\($n)\"")
    | rewrite("<meta name=\"application-name\" content=\"[^\"]*\"";
        "<meta name=\"application-name\" content=\"\($n)\"")
    | sub("Sorry, Element requires JavaScript"; "Sorry, \($n) requires JavaScript")
    | if $image == "" then sub("\\n *<meta property=\"og:image\"[^>]*>"; "")
      else sub("<meta property=\"og:image\" content=\"[^\"]*\"";
        "<meta property=\"og:image\" content=\"\($image | @html)\"") end' \
    "$stock/index.html" > "$work/index.html" || fail "could not write the app name into index.html"
cat "$work/index.html" > "$app/index.html"

if [ "$copied" -gt 0 ]; then
    log "replaced $copied icons and logos with files from /brand"
else
    log "no icons or logos in /brand, the app keeps its own"
fi
log "named the app $name in index.html and manifest.json"
