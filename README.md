# Family Skylight

Family Skylight is a local-first household calendar and shared-list display designed for a Raspberry Pi 3.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `SKYLIGHT_ENCRYPTION_KEY` to a persistent base64-encoded 32-byte key. This encrypts secret iCal URLs before they are stored in SQLite.
    ```sh
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    ```
3. Install packages with `npm ci` or `npm install`.
4. Start development mode with `npm run dev`, then open `http://localhost:5173`.

For the Pi deployment, run `npm run build` and then `npm start`. The Fastify process serves the compiled UI and API at port 3000 by default. Set `PORT` to change it.

## Raspberry Pi installation

Install the color emoji font before starting Chromium. This is required because Raspberry Pi OS does not include a font with the emoji glyphs used by the application:

```bash
sudo apt update
sudo apt install -y fonts-noto-color-emoji
fc-cache -f -v
```

Restart Chromium after installing the font (or reboot the Pi):

```bash
pkill chromium || true
```

On the Pi, ensure the checkout is at `/Github/family-skylight`, is owned by `jhart`, and has a configured `.env` file. Node.js and npm must be available to `jhart`. Then run:

```bash
cd /Github/family-skylight
./scripts/install-pi.sh
```

The installer stops a previous Family Skylight process, fast-forwards the checkout with `git pull`, installs locked dependencies, builds the app, and creates/enables the `family-skylight` systemd service. The service runs `npm start` as `jhart` at boot, without an interactive login. Application data and `.env` are retained.

Use `sudo systemctl status family-skylight` to check the service and `sudo journalctl -u family-skylight -f` to follow its logs.

### Touchscreen and squeekboard

The app leaves extra scroll space below every page so content can be moved above squeekboard when the keyboard opens. Chromium should be configured to resize its viewport when the on-screen keyboard appears. If Chromium is launched by a desktop shortcut or kiosk script, use its normal Wayland session and add these flags to that launch command:

```bash
chromium --enable-features=UseOzonePlatform --ozone-platform=wayland
```

Do not use `--disable-touch-adjustment` or a launch mode that forces a fixed desktop viewport. After changing the launcher, restart Chromium. You can confirm the keyboard integration with:

```bash
pgrep -a squeekboard
```

### Desktop shortcut

To launch the production app as a fullscreen desktop shortcut, create `~/.local/share/applications/family-skylight.desktop` as `jhart`:

```ini
[Desktop Entry]
Type=Application
Name=Family Skylight
Comment=Open the Family Skylight household display
Exec=chromium --kiosk --start-fullscreen --no-first-run --no-default-browser-check --disable-infobars --disable-session-crashed-bubble --password-store=basic --enable-features=UseOzonePlatform --ozone-platform=wayland --enable-wayland-ime http://localhost:3000
Terminal=false
Categories=Utility;
```

The `--kiosk` and `--start-fullscreen` flags hide browser controls and other bars. The Wayland and IME flags keep Chromium compatible with squeekboard and allow the viewport to resize when the on-screen keyboard opens. After creating or changing the shortcut, restart Chromium; it can be launched from the desktop application menu as **Family Skylight**.

## Google Calendar behavior

- Add each calendar using its **Secret address in iCal format** from Google Calendar’s Integrate calendar settings.
- Secret iCal URLs must use HTTPS and a Google Calendar address. They are encrypted in SQLite, never returned by the API, and never displayed after saving.
- The app persists sources, calendar selections, cached events, lists, dashboard layout, and theme in `data/family-skylight.db`.
- Events refresh on initial selection and every hour thereafter. If a refresh fails, cached events remain visible and the source reports its error.

## MVP boundaries

Family Skylight intentionally does not create or edit Google Calendar events, send reminders, or support household accounts and permissions. It is a trusted, local household display with editable shared lists.
