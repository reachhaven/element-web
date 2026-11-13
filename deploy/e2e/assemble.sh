#!/bin/sh
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Joins the two recordings of a run side by side, captions each step from
# steps.json and adds a title card and an end card: <output>/end-to-end.mp4.
# Needs ffmpeg with libfreetype and fontconfig, and jq.
#
#   E2E_TITLE='Title card text' deploy/e2e/assemble.sh [output dir]
set -eu

out=$(cd "${1:-$(dirname "$0")/output}" && pwd)
steps="$out/steps.json"
[ -f "$steps" ] || {
    echo "assemble: $steps not found, run the suite first" >&2
    exit 1
}
videos=$(jq '.videos | length' "$steps")
[ "$videos" -eq 2 ] || {
    echo "assemble: steps.json lists $videos recordings instead of two" >&2
    exit 1
}
title="${E2E_TITLE:-$(jq -r '.title // "End-to-end run"' "$steps")}"
font="${E2E_FONT:-Sans}"
background=black
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

text() {
    printf '%s' "$2" > "$tmp/$1.txt"
    printf "drawtext=font='%s':expansion=none:textfile=%s/%s.txt" "$font" "$tmp" "$1"
}

fit() {
    longest=$(printf '%s\n' "$2" | awk '{ if (length($0) > n) n = length($0) } END { print n + 0 }')
    if [ "$longest" -gt 0 ] && [ $((3400 / longest)) -lt "$1" ]; then echo $((3400 / longest)); else echo "$1"; fi
}

for i in 0 1; do
    file=$(jq -r ".videos[$i].file" "$steps")
    if [ -z "$file" ] || [ ! -f "$out/$file" ]; then
        echo "assemble: recording $i is missing from $out; the run ended before the browser closed" >&2
        exit 1
    fi
done

base=$(jq '[.videos[].startedAt] | min' "$steps")
jq -r --argjson base "$base" '
    def seconds: (. - $base) / 1000;
    .steps as $s
    | ($s | map(.flow) | reduce .[] as $f ([]; if last == $f then . else . + [$f] end)) as $flows
    | ([$s[].end] | max) as $last
    | (range(0; $flows | length) as $i
     | ($s | map(select(.flow == $flows[$i])) | first.at) as $from
     | ($s | map(select(.flow == $flows[$i + 1])) | first.at // $last) as $to
     | ["flow", $i, ($from | seconds), ($to | seconds), $flows[$i]]),
        (range(0; $s | length) as $i
     | $s[$i] as $step
     | ($step.at | seconds) as $from
     | ([$from + 3, (($s[$i + 1].at // ($step.at + 3000)) | seconds)] | min) as $to
     | ["caption", $i, $from, $to,
                if $step.status == "skipped" then "Skipped: \($step.title)\n\($step.reason)"
                elif $step.status == "failed" then "Failed: \($step.title)"
                elif $step.note then "\($step.title)\n\($step.note)"
                else $step.title end])
    | @tsv' "$steps" > "$tmp/texts.tsv"

filters="$tmp/filters.txt"
{
    for i in 0 1; do
        printf '[%s:v]tpad=start_duration=%s:start_mode=add:color=%s,scale=960:600,setsar=1,fps=25[v%s];\n' \
            "$i" "$(jq ".videos[$i].startedAt - $base | . / 1000" "$steps")" "$background" "$i"
    done
    printf '[v0][v1]hstack=inputs=2,pad=1920:1080:0:200:color=%s' "$background"
    for i in 0 1; do
        printf ',%s:fontsize=40:fontcolor=white:x=%s-text_w/2:y=130' \
            "$(text "name$i" "$(jq -r ".videos[$i].name" "$steps")")" "$((480 + i * 960))"
    done
    while IFS="$(printf '\t')" read -r kind i from to caption; do
        if [ "$kind" = flow ]; then
            printf ',%s:fontsize=30:fontcolor=silver:x=(w-text_w)/2:y=48' "$(text "flow$i" "$caption")"
        else
            caption=$(printf '%b' "$caption")
            printf ',%s:fontsize=%s:line_spacing=10:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=18' \
                "$(text "caption$i" "$caption")" "$(fit 38 "$caption")"
            printf ':x=(w-text_w)/2:y=860'
        fi
        printf ":enable='between(t,%s,%s)'" "$from" "$to"
    done < "$tmp/texts.tsv"
    printf ',format=yuv420p[body];\n'
    card() {
        printf 'color=c=%s:s=1920x1080:r=25:d=3,%s:fontsize=%s:fontcolor=white' "$background" "$(text "$1" "$2")" \
            "$(fit "$3" "$2")"
        printf ':x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p[%s];\n' "$1"
    }
    card title "$title" 64
    card end "$(jq -r '[.steps[] | .status] | "\(map(select(. == "passed")) | length) steps passed, \(map(select(. == "skipped")) | length) skipped, \(map(select(. == "failed")) | length) failed"' "$steps")" 48
    printf '[title][body][end]concat=n=3:v=1:a=0[out]\n'
} > "$filters"

ffmpeg -loglevel error -y -i "$out/$(jq -r '.videos[0].file' "$steps")" -i "$out/$(jq -r '.videos[1].file' "$steps")" \
    -filter_complex_script "$filters" -map '[out]' \
    -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -movflags +faststart "$out/end-to-end.mp4"
echo "assemble: $out/end-to-end.mp4"
