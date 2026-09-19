# Family Skylight

Family Skylight is a local-first household calendar and shared-list display designed for a Raspberry Pi 3.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `SKYLIGHT_ENCRYPTION_KEY` to a persistent base64-encoded 32-byte key. This encrypts secret iCal URLs before they are stored in SQLite.
3. Install packages with `npm install`.
4. Start development mode with `npm run dev`, then open `http://localhost:5173`.

For the Pi deployment, run `npm run build` and then `npm start`. The Fastify process serves the compiled UI and API at port 3000 by default. Set `PORT` to change it.

## Google Calendar behavior

- Add each calendar using its **Secret address in iCal format** from Google Calendar’s Integrate calendar settings.
- Secret iCal URLs must use HTTPS and a Google Calendar address. They are encrypted in SQLite, never returned by the API, and never displayed after saving.
- The app persists sources, calendar selections, cached events, lists, dashboard layout, and theme in `data/family-skylight.db`.
- Events refresh on initial selection and every hour thereafter. If a refresh fails, cached events remain visible and the source reports its error.

## MVP boundaries

Family Skylight intentionally does not create or edit Google Calendar events, send reminders, or support household accounts and permissions. It is a trusted, local household display with editable shared lists.
