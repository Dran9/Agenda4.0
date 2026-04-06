const { google } = require('googleapis');

const LA_PAZ_TZ = 'America/La_Paz';

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oAuth2Client;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getOAuthClient() });
}

async function listEvents(calendarId, timeMin, timeMax) {
  const calendar = getCalendar();
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return res.data.items || [];
}

async function createEvent(calendarId, { summary, description, startDateTime, endDateTime }) {
  return createCalendarEvent(calendarId, {
    summary,
    description,
    startDateTime,
    endDateTime,
  });
}

async function createCalendarEvent(calendarId, { summary, description, startDateTime, endDateTime, recurrence }) {
  const calendar = getCalendar();
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: LA_PAZ_TZ },
      end: { dateTime: endDateTime, timeZone: LA_PAZ_TZ },
      recurrence: Array.isArray(recurrence) && recurrence.length > 0 ? recurrence : undefined,
    },
  });
  return res.data;
}

async function createRecurringEvent(calendarId, { summary, description, startDateTime, endDateTime, recurrenceRule }) {
  return createCalendarEvent(calendarId, {
    summary,
    description,
    startDateTime,
    endDateTime,
    recurrence: recurrenceRule ? [recurrenceRule] : [],
  });
}

async function deleteEvent(calendarId, eventId) {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
}

async function getEvent(calendarId, eventId) {
  const calendar = getCalendar();
  const res = await calendar.events.get({ calendarId, eventId });
  return res.data;
}

async function updateEvent(calendarId, eventId, updates = {}) {
  const calendar = getCalendar();
  const requestBody = {};

  if (updates.summary !== undefined) requestBody.summary = updates.summary;
  if (updates.description !== undefined) requestBody.description = updates.description;
  if (updates.startDateTime !== undefined) {
    requestBody.start = { dateTime: updates.startDateTime, timeZone: LA_PAZ_TZ };
  }
  if (updates.endDateTime !== undefined) {
    requestBody.end = { dateTime: updates.endDateTime, timeZone: LA_PAZ_TZ };
  }
  if (updates.recurrence !== undefined) {
    requestBody.recurrence = Array.isArray(updates.recurrence) && updates.recurrence.length > 0
      ? updates.recurrence
      : undefined;
  }

  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody,
  });
  return res.data;
}

async function updateEventSummary(calendarId, eventId, summary) {
  return updateEvent(calendarId, eventId, { summary });
}

module.exports = {
  getOAuthClient,
  getCalendar,
  listEvents,
  createEvent,
  createRecurringEvent,
  createCalendarEvent,
  getEvent,
  updateEvent,
  deleteEvent,
  updateEventSummary,
};
