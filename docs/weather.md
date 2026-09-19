For this app, I’d use Open-Meteo.

  It is global, needs no API key or account, supports current conditions plus daily/hourly forecasts, and is free for non-commercial use up to 10,000 calls/day. It uses
  a simple JSON endpoint and requires attribution—ideal for a personal Raspberry Pi household display. Open-Meteo

  Good alternatives:

  - National Weather Service API — best if the household location is in the U.S. It is free, provides seven-day and hourly forecasts, plus official alerts. It requires
    a coordinate-to-grid lookup first, so integration is a little more involved. NWS API

  - WeatherAPI.com — global coverage, easy condition icons/text, and a free plan with 100,000 calls/month and a 3-day forecast. It requires an API key and provider
    credit/link. Pricing, documentation

  For the dashboard, I’d have the server fetch and cache one Open-Meteo response for the configured household coordinates every 30–60 minutes. From that single
  response:

  - The Today panel gets current temperature, condition, high/low, and precipitation chance.
  - A new weekly panel gets each day’s high/low, condition icon, and precipitation chance.

  That keeps weather credentials out of the browser, minimizes requests, and remains light enough for the Pi 3.

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

─ Conversation recap ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  The task is to add dashboard weather widgets: a Today forecast panel and a weekly forecast panel. Open-Meteo was recommended because it is global, keyless, and
  supports current, daily, and hourly forecasts; implementation details are still undecided.