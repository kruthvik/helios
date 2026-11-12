# helios
music lyrics view &amp; player acting as a spotify device

![Helios playing music with animated lyrics and backgrounds](demo-small.gif)

## Setup

Requires Windows x64 and Spotify Premium.

1. Download and install Helios from [Releases](https://github.com/kruthvik/helios/releases/latest).
2. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Select Web API and Web Playback SDK.
3. Add `http://127.0.0.1:8898/callback` as a redirect URI in the app settings.
4. Open Helios, enter your Spotify app's client ID, and sign in. Select **Helios** as your playback device.

Spotify's development mode restrictions apply. Helios stores your Spotify refresh token unencrypted in local app data.

## Features

- Spotify playback controls and queue.
- Synced lyrics, adjustable timing, and support for your own lyric files.
- Animated backgrounds, effects, and an audio visualizer.
- Music videos and custom image, GIF, or video backgrounds.
- Custom layouts, a miniplayer, game mode, and a sleep timer.
