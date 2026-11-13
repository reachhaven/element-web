#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Fails when the fork carries a brand. Compared with the commit where the fork
# leaves upstream (the merge base of HEAD and the upstream ref), it fails on
#   - a path, or a line of text, the fork adds that matches one of
#     WHITE_LABEL_PATTERNS, lines with an SPDX-FileCopyrightText tag aside;
#   - a change to upstream's app icons and logos;
#   - a raster image the fork adds or changes outside test and screenshot
#     directories, since its content cannot be searched.
# The patterns are extended regular expressions, one per line, matched without
# regard to case. They come from outside the tree (in CI the WHITE_LABEL_PATTERNS
# secret), so the fork never names the brands it keeps out.
#
# Usage: WHITE_LABEL_PATTERNS=... deploy/web/check-white-label.sh [<upstream ref>]
# The ref defaults to upstream/develop. Uncommitted changes and untracked files
# that git does not ignore count as added.
set -euo pipefail
shopt -s inherit_errexit

base="${1:-upstream/develop}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf '%s\n' "${WHITE_LABEL_PATTERNS:-}" | tr -d '\r' | { grep -v '^[[:space:]]*$' || true; } > "$work/patterns"
if [ ! -s "$work/patterns" ]; then
    echo "WHITE_LABEL_PATTERNS is empty. Set it to the brand words, host names and colours to keep out of the fork, as extended regular expressions, one per line." >&2
    exit 2
fi
status=0
grep -E -f "$work/patterns" /dev/null 2> "$work/error" || status=$?
if [ "$status" -gt 1 ]; then
    echo "WHITE_LABEL_PATTERNS holds a pattern grep cannot use: $(cat "$work/error")" >&2
    exit 2
fi
if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
    echo "$base is not a commit. Fetch upstream's develop or name the upstream commit to compare with." >&2
    exit 2
fi
if ! fork_point=$(git merge-base "$base" HEAD); then
    echo "HEAD and $base share no history here. Fetch both in full to find where the fork leaves upstream." >&2
    exit 2
fi
cd "$(git rev-parse --show-toplevel)"

# The paths the fork adds or changes, NUL-separated.
{
    git diff -z --name-only --no-renames --diff-filter=d "$fork_point" --
    git ls-files -z --others --exclude-standard
} > "$work/paths"

# Every such path, and every line of text the fork adds, as <path>:<line>.
while IFS= read -r -d '' path; do
    printf '%s\n' "$path"
    if [ -L "$path" ]; then
        printf '%s:%s\n' "$path" "$(readlink "$path")"
    elif [ -f "$path" ] && grep -Iq '' -- "$path"; then
        if git ls-files --error-unmatch -- "$path" > /dev/null 2>&1; then
            git diff --text --no-ext-diff --no-color --unified=0 --no-renames "$fork_point" -- "$path" |
                source_path=$path awk '/^@@/ { body = 1; next } body && /^\+/ { print ENVIRON["source_path"] ":" substr($0, 2) }'
        else
            source_path=$path awk '{ print ENVIRON["source_path"] ":" $0 }' "$path"
        fi
    fi
done < "$work/paths" > "$work/added"

grep -v 'SPDX-FileCopyrightText' "$work/added" > "$work/scanned" || [ $? -eq 1 ]
status=0
grep -i -E -f "$work/patterns" "$work/scanned" > "$work/hits" || status=$?
if [ "$status" -gt 1 ]; then
    exit 2
fi
result=0
if [ -s "$work/hits" ]; then
    echo "Paths and lines the fork adds that match WHITE_LABEL_PATTERNS:"
    cat "$work/hits"
    result=1
fi

logos=(apps/web/res/vector-icons apps/web/res/themes/element/img/logos
    apps/web/res/img/element-desktop-logo.svg apps/web/res/img/element-shiny.svg
    apps/web/src/vector/mobile_guide/assets/element-logo.svg
    apps/desktop/build/icon.png apps/desktop/build/icon.ico apps/desktop/build/icon.icon)
changed=$(
    git diff --name-only "$fork_point" -- "${logos[@]}"
    git ls-files --others --exclude-standard -- "${logos[@]}"
)
if [ -n "$changed" ]; then
    echo "App icons or logos that differ from upstream:"
    printf '%s\n' "$changed"
    result=1
fi

tr '\0' '\n' < "$work/paths" |
    { grep -i -E '\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?)$' || true; } |
    { grep -v -E '(^|/)(test|tests|__tests__|fixtures?|playwright|__vis__|__screenshots__|snapshots)/' || true; } \
        > "$work/images"
if [ -s "$work/images" ]; then
    echo "Raster images the fork adds or changes outside test and screenshot directories:"
    cat "$work/images"
    result=1
fi

if [ "$result" -eq 0 ]; then
    echo "Nothing the fork adds matches WHITE_LABEL_PATTERNS, upstream's icons and logos are unchanged, and the fork adds no raster image."
fi
exit "$result"
