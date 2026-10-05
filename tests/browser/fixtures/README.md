# Browser test fixtures

The media the browser tests serve to the card, at the paths and names built by
`tests/browser/fixtures.ts`. Most requests reach them directly from the Vite dev
server. A test that needs a camera to misbehave gets copies from
`tests/browser/test-media.ts` instead.

## `still-red.png`

A 320x180 red image, 16:9. Everything the card draws as a still image: a
snapshot in the viewer, or a live view built from stills.

## `clip.webm`

Ten seconds of red at 64x48, VP8. Ten seconds so a test can watch it play
without it ending under the assertion.

The existing small fixture uses WebM because Playwright's bundled `ffmpeg`
has libvpx only. The separate Shinobi fixture below was encoded with a full
local FFmpeg installation and exercises MP4 decoding and seeking.

Rebuild it with ImageMagick and the `ffmpeg` Playwright installs alongside its
browsers:

```sh
convert tests/browser/fixtures/still-red.png -resize 64x48! /tmp/frame.jpg

for i in $(seq 100);
do
  cat /tmp/frame.jpg;
done > /tmp/frames.mjpeg

~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux -f image2pipe -vcodec mjpeg -r 10 \
  -i /tmp/frames.mjpeg -c:v libvpx -b:v 50k tests/browser/fixtures/clip.webm
```

## `shinobi-4k-h264.mp4`

Synthetic blue frames only: 120 seconds, 3840x2160, H.264, 5 frames/second,
one-second keyframe interval, no audio, MP4 fast-start. No camera footage is
included. SHA-256:
`583e7ba057467505e73deba42dcf5548ce6cabb9dd26ddae41e75526d1ac9ee3`.

Rebuilt with FFmpeg 8.0.1:

```sh
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i color=c=blue:s=3840x2160:r=5:d=120 \
  -c:v libx264 -threads 1 -preset ultrafast -pix_fmt yuv420p \
  -g 5 -movflags +faststart tests/browser/fixtures/shinobi-4k-h264.mp4
```

This establishes supported-fixture decoding, dimensions and seek behavior.
It does not establish decoding of original Clear HEVC/AAC recordings.
