# Product Requirements Document
This document describes the requirements for the project 'Family Skylight' which is an aggregated calendar application designed to run on minimal resource computing platforms. The requirements in this document are not to be violated.

All calendar data originates from a Google Calendar.
Calendars from more than one user can be imported.
Multiple calendars from a user can be imported.


# High level requirements

Functions:
* Dashboard - semi customizable
* Aggregate calendar screen
* Shared Lists
* Admin page
    * Manage calendars
    * Manage lists

Screens:
* Dashboard
    Provides an aggregate view of the days events and tasks. Provides a view of upcoming events for the week
    Provides a snapshot of content in shared lists
* Calendar screen
    A screen with a calendar like grid, dispalying events for the entire month.
    The month can be "scrolled" via 'Next' and 'Prev' navigation elements.
* Shared lists
    Displays all lists. Items in the lists can be created/updated/deleted/completed.
    Each list has a different color associated with it.
    Completed items are still displayed, but are struckthrough and grayed out.
* Admin page
    * User calendars can be added or removed.
    * Assign a color to the calendar's events which will be displayed in this application.
    * Create/Delete new shared lists

# Architecture
This application is designed to run on a Raspberry PI 3 platform. CPU and memory are limited. A three tiered architecture is applicable here:
* UI layer for presentation
* API layer
* Data layer

The UI layer should be composed using React and the Mantine UI library.
The API layer is intended to be a lightweight API to manage the data and application.
The database is a SQLite database.

# Other notes
* The dashboard should be using a masonry layout where tiles can be resized and moved around.
* The application should be touchscreen friendly and work on a desktop.
* Both light and dark themes are supported.
* Any sensitive data, such as oauth tokens, should be stored in the dataabse.
