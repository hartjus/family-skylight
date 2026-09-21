# Family Skylight MVP User Stories

## Product decisions

- A single trusted household administrator uses the application; there are no accounts or roles in MVP.
- Calendar events are read-only in Family Skylight and originate only from Google Calendar. Each calendar is imported using its secret Google iCal URL.
- The application refreshes calendar data automatically at least once per hour and shows the most recent successful sync time or an error state.
- The administrator chooses one shared Dashboard and Calendar database refresh interval: 1, 5, 15, 30, or 60 minutes (default: 5). Open screens adopt a changed interval after their next scheduled refresh.
- The dashboard contains a full-width current-week panel plus today, coming-up, and shared-list snapshot tiles. The administrator can move tiles and resize standard tiles; the layout persists.
- Shared-list items contain text and completion state only. Completed items remain visible until deleted.
- List deletion requires confirmation and permanently deletes its items.
- Calendar views show an event title, Pacific time or all-day state, location when supplied by Google Calendar, and configured calendar color. Month navigation is unrestricted.
- Recurring events are materialized from the first day of the Pacific-time month six calendar months ago through 12 calendar months ahead; Google Calendar remains the source of truth for that rolling cache.
- Calendar editing, reminders, notifications, due dates, and item assignments are out of scope for MVP.
- Both light and dark themes are supported.
- Sensitive data, including secret iCal URLs, is encrypted before storage in the SQLite database and is never exposed through the UI or application configuration.
- Weather forecasts use Open-Meteo for the configured household location. The server caches a single forecast response for 30 minutes; all temperatures are displayed in Fahrenheit and the UI credits Open-Meteo.

## Priority key

- **P0** — required for a usable MVP
- **P1** — required for the agreed MVP experience, but can follow the P0 foundation

## Epic: Calendar sources and synchronization

### US-01 — Add a secret Google iCal feed

**Priority:** P0

As a household administrator, I want to add a calendar’s secret Google iCal URL so that its events can appear in the household display without requiring a Google sign-in flow.

**Acceptance criteria:**

- The admin can provide a secret Google Calendar iCal URL and an optional display name.
- The app validates that the URL is an HTTPS Google Calendar iCal feed before saving it.
- The app retrieves and reads the feed before adding it as a calendar source.
- An invalid, inaccessible, or unreadable URL is not saved and presents an actionable error.

### US-02 — Protect secret iCal feeds

**Priority:** P0

As a household administrator, I want secret iCal URLs protected after setup so that calendar access is not exposed through the household display.

**Acceptance criteria:**

- Secret iCal URLs are encrypted before being saved in SQLite.
- The API and administration UI never return or display a saved secret iCal URL.
- Secret URLs are excluded from application logs and user-facing error messages.
- Removing a calendar removes its encrypted secret URL and cached event data.

### US-03 — Select calendars and assign colors

**Priority:** P0

As a household administrator, I want to manage each imported calendar and assign an event color so that everyone can distinguish their schedules.

**Acceptance criteria:**

- The admin can view every imported calendar source.
- The admin can include or exclude each imported calendar independently.
- The admin can assign a distinct display color to each imported calendar.
- The assigned color is used consistently on the dashboard and month view.
- Multiple imported calendars can be included at once.

### US-04 — Remove an imported calendar

**Priority:** P0

As a household administrator, I want to remove an imported calendar so that outdated household schedules no longer appear.

**Acceptance criteria:**

- The admin can remove an imported calendar and its source.
- The calendar’s cached events no longer appear after removal.
- Removal deletes the encrypted secret iCal URL.
- Removal does not affect lists, dashboard layout, or other imported calendars.

### US-05 — Keep imported events current

**Priority:** P0

As a household member, I want the displayed events to refresh automatically so that the display reflects changes made in the source calendars.

**Acceptance criteria:**

- The system attempts a background refresh for every included source at least once per hour.
- A successful refresh adds, updates, and removes events to match the source calendar data.
- The UI shows the time of the last successful synchronization.
- If a refresh fails, previously synchronized events remain visible and the UI shows that the source may be stale.
- A later successful refresh clears the error state and updates the last-successful-sync time.

### US-05a — Display recurring calendar events

**Priority:** P0

As a household member, I want recurring Google Calendar events to appear on their actual occurrence dates so that the household schedule is complete.

**Acceptance criteria:**

- On each successful sync, the app expands recurring Google iCal events from the first day of the Pacific-time month six calendar months ago through the following 12 calendar months.
- The app honors recurrence rules, added dates, excluded dates, cancelled occurrences, and single-occurrence overrides from the Google iCal feed.
- Generated occurrences retain the source event’s title, location, all-day state, and calendar color; overridden values take precedence where supplied.
- The next successful sync replaces cached generated occurrences with the latest source data; Google Calendar remains the source of truth.
- The app preserves the previous cache and shows a sync error if recurrence processing fails.

## Epic: Dashboard

### US-06 — View today's schedule and tasks

**Priority:** P0

As a household member, I want a dashboard view of today's events and incomplete list items so that I can quickly see what needs attention.

**Acceptance criteria:**

- The dashboard shows today's events from all included calendars using each calendar's configured color.
- Each dashboard event is displayed in a box shaded with its configured calendar color.
- Timed events show their time in Pacific time; all-day events are identified as all-day.
- Events with a Google Calendar location display that location.
- Timed events that have ended today remain visible with a lighter calendar-color shade and strikethrough text; all-day events remain active for the whole day.
- The dashboard shows incomplete items from shared lists as today's tasks.
- Empty event and task states clearly indicate that there is nothing to show.

### US-07 — View upcoming events

**Priority:** P0

As a household member, I want to see the remaining events in the current calendar week on the dashboard so that I can plan ahead.

**Acceptance criteria:**

- The dashboard includes at most five events starting during the next three Pacific-time calendar days.
- Each event shows its title, date when needed, Pacific time or all-day state, calendar color, and location when present.
- Events from all included calendars are presented together in chronological order.

### US-07a — View the current week by day

**Priority:** P1

As a household member, I want a full-width Sunday–Saturday panel on the dashboard so that I can see each day’s events in their weekly context.

**Acceptance criteria:**

- The dashboard includes a full-width panel for the current Pacific-time week, Sunday through Saturday.
- Each day displays its events under the corresponding day heading.
- Events retain their calendar color, past-event styling, and event-detail interaction.
- The panel remains usable on narrow touch screens through horizontal scrolling.
- Prev and Next controls display the prior or following Sunday–Saturday week from cached database events.
- A Current control returns the panel to the current Pacific-time week.

### US-08 — View shared-list snapshots

**Priority:** P1

As a household member, I want a compact snapshot of every shared list on the dashboard so that I can check household work without opening each list.

**Acceptance criteria:**

- The dashboard includes a snapshot for every existing shared list.
- Each snapshot identifies its list and uses that list's color.
- Incomplete items are distinguishable from completed items.
- A list with no items has a clear empty state.

### US-09 — Arrange the dashboard

**Priority:** P1

As a household administrator, I want to move and resize dashboard tiles so that the display matches my household's priorities.

**Acceptance criteria:**

- In Arrange tiles mode, a user can drag tiles by their dedicated handle to reorder the masonry layout using touch, pointer, or keyboard input.
- In Arrange tiles mode, a user can drag a standard tile's resize grip to switch it between half and full width; the current-week panel remains full width.
- The arrangement is retained after reloading or restarting the application.
- Event and tile controls remain usable outside Arrange tiles mode on touchscreen and desktop input.

## Epic: Aggregate monthly calendar

### US-10 — View an aggregated monthly calendar

**Priority:** P0

As a household member, I want a month grid containing events from all included calendars so that I can see the household schedule at a glance.

**Acceptance criteria:**

- The screen displays a conventional calendar grid for the selected month.
- Every cached event from included calendars occurring in that month is represented on its day.
- Recurring instances are available for the six previous Pacific-time calendar months and 12 calendar months ahead; standalone events remain available when present in the source feed.
- Event representations include title, Pacific time or all-day state, configured calendar color, and location when space permits.
- Days with no events and months with no events render clearly.

### US-11 — Navigate between months

**Priority:** P0

As a household member, I want Next and Previous controls on the calendar so that I can review any past or future month with available cached event data.

**Acceptance criteria:**

- Selecting Next displays the following month; selecting Previous displays the preceding month.
- Navigation is available without a fixed past or future range limit, even when the selected month has no cached events.
- The displayed month and year are always clear.
- Navigation controls work with touch and desktop pointer input.

## Epic: Shared lists

### US-12 — Create and maintain list items

**Priority:** P0

As a household member, I want to add, edit, and delete items in shared lists so that the lists remain useful to everyone.

**Acceptance criteria:**

- The Shared Lists screen displays every existing list and its assigned color.
- A user can add a text item to any list.
- A user can change an item's text.
- A user can delete an item.
- Item changes persist after reloading or restarting the application.

### US-13 — Complete and retain list items

**Priority:** P0

As a household member, I want to mark list items complete while keeping them visible briefly so that completed work is recognizable without permanently cluttering the list.

**Acceptance criteria:**

- A user can mark an item complete and later mark it incomplete.
- Completed items remain visible in their original list for 24 hours, then are filtered from list and dashboard views.
- Completed items use strikethrough and muted gray styling that is visually distinct from incomplete items.
- Completion state persists after reloading or restarting the application.

## Epic: Administration

### US-14 — Create and color a shared list

**Priority:** P0

As a household administrator, I want to create a named, colored shared list so that household activities can be grouped and recognized.

**Acceptance criteria:**

- The admin can create a list with a non-empty name and a selected color.
- A newly created list appears in Shared Lists and as a dashboard snapshot.
- The selected color is used consistently in both views.

### US-15 — Delete a shared list

**Priority:** P0

As a household administrator, I want to delete an obsolete shared list so that it no longer clutters the household display.

**Acceptance criteria:**

- Deleting a list requires an explicit confirmation that its items will be permanently removed.
- Confirming deletion removes the list, all of its items, and its dashboard snapshot.
- Cancelling confirmation leaves the list and its items unchanged.

## Cross-cutting quality stories

### US-16 — Use the application on the household display and desktop

**Priority:** P1

As a household member, I want the application to work well by touch on the household display and by pointer on a desktop so that it is practical in either setting.

**Acceptance criteria:**

- Primary navigation and interactive controls have touch-friendly targets.
- All primary workflows can be completed with a desktop pointer.
- Text, colors, completion styling, and errors remain legible at the supported display sizes.

### US-17 — Operate within the device constraints

**Priority:** P1

As a household administrator, I want the application to remain responsive on a Raspberry Pi 3 so that the always-on display is reliable.

**Acceptance criteria:**

- The UI, lightweight API, and SQLite data layer are suitable for deployment on a Raspberry Pi 3.
- Normal dashboard, calendar, list, and administration actions remain responsive while background synchronization runs.
- A sync failure does not prevent viewing previously stored calendar or list data.

### US-18 — Select a display theme

**Priority:** P1

As a household member, I want to use the display in either a light or dark theme so that it is comfortable to read in changing household lighting.

**Acceptance criteria:**

- The application provides both light and dark themes.
- The active theme is applied consistently to the dashboard, monthly calendar, shared lists, and administration views.
- Text, event colors, list colors, completion styling, and error states remain legible in either theme.
- The selected theme persists after reloading or restarting the application.

### US-19 — Protect sensitive calendar credentials

**Priority:** P0

As a household administrator, I want secret calendar URLs stored safely so that adding a Google Calendar does not expose its iCal URL.

**Acceptance criteria:**

- Secret iCal URLs are encrypted before being stored in the SQLite database.
- Secret URLs are not rendered in the administration UI, logs, API responses, or user-facing error messages.
- Removing a calendar source removes its encrypted URL along with its imported calendar data.

### US-20 — Collapse the navigation menu

**Priority:** P1

As a household member, I want to collapse the left navigation menu to icons so that the display has more room for calendar content.

**Acceptance criteria:**

- A control switches the left menu between full labels and an icon-only rail.
- Each icon-only navigation item has an accessible label and a hover tooltip on desktop.
- Navigation and theme controls remain available in either menu state.

### US-21 — View event details

**Priority:** P1

As a household member, I want to open an event to see its details so that I can quickly confirm its schedule and location.

**Acceptance criteria:**

- Tapping or clicking an event on the dashboard or month calendar opens a modal.
- The modal shows the event title, calendar name/color, Pacific start and end time (or all-day status), and location when present.
- The modal can be dismissed with touch, pointer, or keyboard controls.


### US-22 - Dashboard refresh

**Priority:** P1

As a household member, I want to see the latest events with a minimal delay so that I have accurate information.

**Acceptance criteria:**

- The Admin page provides one shared Dashboard and Calendar refresh interval, in minutes: 1, 5, 15, 30, or 60. The default is 5 minutes.
- Dashboard and Calendar re-query their existing database-backed API endpoints at the selected interval; this does not trigger a Google Calendar sync.
- An already-open Dashboard or Calendar reads the setting at its next scheduled refresh and uses a changed interval for subsequent refreshes.
- Polling does not overlap an in-progress page request, and timers are cleaned up when leaving the screen.

### US-23 — Configure household weather

**Priority:** P1

As a household administrator, I want to set the household weather location so that the dashboard shows a relevant local forecast.

**Acceptance criteria:**

- The Admin page accepts a postal/ZIP code or city plus an optional ISO country code (default: US).
- The system validates the location using Open-Meteo geocoding before saving its resolved coordinates.
- The saved location is shown in Administration and can be changed later.

### US-24 — View weather forecasts

**Priority:** P1

As a household member, I want to see today's conditions and the weekly forecast so that I can plan around the weather.

**Acceptance criteria:**

- The Dashboard Today tile shows the current temperature, condition icon, daily high/low, and maximum precipitation chance in Fahrenheit.
- The Dashboard includes a seven-day forecast panel with condition icons, Fahrenheit high/low temperatures, and precipitation chances.
- Weather data is requested only through the local API and cached server-side for 30 minutes; a saved forecast remains visible if a later refresh fails.
- The dashboard clearly prompts for weather setup when no location has been configured and credits Open-Meteo when weather is configured.
