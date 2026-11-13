#!/bin/sh
# SPDX-FileCopyrightText: 2026 vDL Digital Ventures
#
# SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only

# Writes the suite's sample media into <dir>: a PNG, a JPEG, an MP4 with VP9
# video and Opus audio, and an animated GIF. Needs ImageMagick and ffmpeg.
set -eu

dir="${1:?usage: $0 <dir>}"
mkdir -p "$dir"

convert -size 1200x800 gradient:steelblue-lightblue -fill gold -draw 'circle 900,220 900,120' \
    -fill seagreen -draw 'polygon 0,800 0,560 300,420 620,600 900,470 1200,620 1200,800' \
    "$dir/landscape.png"

convert -seed 7 -size 1024x768 plasma:sienna-royalblue -blur 0x2 -quality 88 "$dir/photo.jpg"

ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=640x360:rate=25:duration=6 \
    -f lavfi -i sine=frequency=440:duration=6 -c:v libvpx-vp9 -b:v 800k -deadline realtime \
    -cpu-used 8 -c:a libopus -b:a 64k -movflags +faststart -shortest "$dir/clip.mp4"

frames="$dir/.frames"
mkdir -p "$frames"
i=0
while [ "$i" -lt 12 ]; do
    x=$((40 + i * 20))
    convert -size 320x200 xc:ivory -fill slateblue -draw "circle $x,100 $((x + 28)),100" \
        "$frames/$(printf '%02d' "$i").png"
    i=$((i + 1))
done
convert -delay 8 -loop 0 "$frames"/*.png "$dir/animation.gif"
rm -r "$frames"
