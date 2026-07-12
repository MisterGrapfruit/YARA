import { getAccessToken } from '../auth/googleAuth.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function getAuthHeaders() {
  const token = getAccessToken();
  if (!token) {
    throw new Error('Google access token is required for Calendar API calls.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'omit',
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders()
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Calendar API error ${response.status}: ${message}`);
  }

  return response.json();
}

function getNextDate(dateString) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

export async function createMealEvent(entry, recipe) {
  const event = {
    summary: `${recipe.title} (${entry.servings} servings)`,
    description: recipe.instructions || '',
    start: { date: entry.date },
    end: { date: getNextDate(entry.date) },
    reminders: { useDefault: true }
  };

  return requestJson(`${CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    body: JSON.stringify(event)
  });
}

export async function listUpcomingEvents(maxResults = 20) {
  const today = new Date().toISOString();
  return requestJson(`${CALENDAR_API}/calendars/primary/events?timeMin=${encodeURIComponent(today)}&maxResults=${maxResults}&orderBy=startTime&singleEvents=true`);
}
