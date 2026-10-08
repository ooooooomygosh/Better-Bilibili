#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures
ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=480x270:rate=24' -t 24 -an -c:v libx264 -preset ultrafast -profile:v baseline -level 3.0 -pix_fmt yuv420p -g 48 -keyint_min 48 -sc_threshold 0 -b:v 600k -movflags +dash+global_sidx -y fixtures/video.mp4
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 24 -vn -c:a aac -b:a 64k -frag_duration 2000000 -movflags +dash+global_sidx -y fixtures/audio.mp4
