# Offline media fixtures

Tiny, synthetic 16×16 blue images/videos and 0.2-second sine audio created locally with ffmpeg for tests. No product, account or user material is included. Production code does not require ffmpeg and does not transcode uploads.

- `short.png/jpg/gif/webp`: four supported raster formats.
- `silent.mp4`, `short.webm`: video without an audio track.
- `with-audio.mp4`, `short.mov`: video with an audio track; byte identity must survive upload.
- `short.mp3/wav/m4a/aac`: supported audio containers/codecs. Audio-only MP4/M4A must not pass video validation.

Metadata tests use mediabunny 1.51.0. Raster tests check byte detection and forwarding to the existing AttachmentStore validator; they do not claim a replacement image decoder.
