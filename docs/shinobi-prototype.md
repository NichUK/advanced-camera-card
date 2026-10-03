# Shinobi recording prototype

Work tracked against [upstream issue #1594](https://github.com/dermotduffy/advanced-camera-card/issues/1594).

This branch experiments with a Shinobi camera engine using the existing card's
media browser, recording gallery and timeline. It is not a functioning Shinobi
engine yet. The HA-side integration and research live in the companion
`NichUK/homeassistant-shinobi` project.

## First acceptance target

Select a historical time, find the completed recording that covers it, play the
original Clear main-stream file and seek to the corresponding offset. Show gaps
explicitly rather than silently moving to another recording. Then validate
advancing into the next clip on desktop and iPhone.

Start by adapting the motionEye/Reolink browse-media engines. Improve the
Shinobi integration's day/hour navigation so all recordings can be reached;
its existing 100-clips-per-day cap is unsuitable for continuous recording.
Keep API credentials on the HA server, and use authenticated media access with
byte-range support. Preserve recording and retention settings.

## Reuse investigation

[elad-bar/ha-shinobi](https://github.com/elad-bar/ha-shinobi) contains prior work
on archive endpoints, thumbnails and proxying. Study its behaviour and API
patterns. No explicit licence file was found in that repository, so source
code has not been copied into this fork. The card's own MIT-licensed engines
provide the initial implementation base.

## Validation before deployment

- Timestamp handling across site timezones, midnight and daylight-saving changes.
- More than 100 clips, missing intervals, adjacent clips and overlapping clips.
- Access through HA without exposing the Shinobi API key to card configuration.
- Partial-file seeking and Clear HEVC playback on desktop and iPhone.
- Camera-engine/config tests and coverage, strict TypeScript and production build.

Multi-file export and a compatibility viewing stream are later features.
