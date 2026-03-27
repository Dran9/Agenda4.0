const { google } = require('googleapis');

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
  const calendar = getCalendar();
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: startDateTime, timeZone: 'America/La_Paz' },
      end: { dateTime: endDateTime, timeZone: 'America/La_Paz' },
    },
  });
  return res.data;
}

async function deleteEvent(calendarId, eventId) {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId, eventId });
}

async function updateEventSummary(calendarId, eventId, summary) {
  const calendar = getCalendar();
  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { summary },
  });
  return res.data;
}

module.exports = { getOAuthClient, getCalendar, listEvents, createEvent, deleteEvent, updateEventSummary };
