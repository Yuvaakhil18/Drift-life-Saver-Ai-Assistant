require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const ds = require('./datastore');
const { seedDatabase } = require('./seed');
const { decideIntervention, reportInterventionEfficacy } = require('./agent');
const { executeAction, recordEfficacyOutcome } = require('./executor');
const { getTaskState } = require('./trajectoryEngine');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use('/demo', express.static(path.join(__dirname, 'public')));

// Seed DB on startup
seedDatabase();

// In-memory token storage
let userTokens = null;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Define scopes
const scopes = [
  'https://www.googleapis.com/auth/calendar.events'
];

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend/dist')));

app.get('/auth-status', (req, res) => {
  const success = req.query.success;
  const eventCreated = req.query.eventCreated;
  
  let html = `
    <html>
      <head>
        <title>Calendar Integration</title>
        <style>
          body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f2f5; }
          .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; }
          button { background: #4285f4; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 16px; cursor: pointer; margin-top: 10px; }
          button:hover { background: #3367d6; }
          .success { color: green; font-weight: bold; margin-top: 15px; }
          .error { color: red; font-weight: bold; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Google Calendar Setup</h1>
  `;

  if (eventCreated === 'true') {
    html += `
          <div class="success">✅ Test Event Created Successfully!</div>
          <p>Check your Google Calendar for "Agent Connection Test".</p>
    `;
  } else if (eventCreated === 'false') {
    html += `
          <div class="error">❌ Failed to create event. Check server console.</div>
    `;
  } else if (success === 'true') {
    html += `
          <div class="success">✅ Calendar Connected!</div>
          <p>Now, let's create a test event.</p>
          <form action="/create-event" method="POST">
            <button type="submit">Create Test Event</button>
          </form>
    `;
  } else {
    html += `
          <p>Click below to authorize access to your Google Calendar.</p>
          <button onclick="window.location.href='/auth'">Connect Calendar</button>
    `;
  }

  html += `
        </div>
      </body>
    </html>
  `;
  res.send(html);
});

app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.send('Error: No code provided');
  }
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    userTokens = tokens; // Store in memory
    res.redirect('/auth-status?success=true');
  } catch (error) {
    console.error('Error retrieving access token', error);
    res.send('Error retrieving access token');
  }
});

app.post('/create-event', async (req, res) => {
  if (!userTokens) {
    return res.redirect('/auth-status');
  }

  oauth2Client.setCredentials(userTokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary: 'Agent Connection Test',
    description: 'A test event created to verify Google Calendar API integration.',
    start: {
      dateTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes from now
      timeZone: 'UTC',
    },
    end: {
      dateTime: new Date(Date.now() + 40 * 60 * 1000).toISOString(), // 40 minutes from now
      timeZone: 'UTC',
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    console.log('Event created: %s', response.data.htmlLink);
    res.redirect('/auth-status?eventCreated=true');
  } catch (error) {
    console.error('Error creating event:', error);
    res.redirect('/auth-status?eventCreated=false');
  }
});

// --- DRIFT DEMO ROUTES ---
app.get('/api/demo/state', (req, res) => {
  const tasks = ds.getTasks().map(t => {
    const computed = getTaskState(t);
    if (t.forced_severity) {
      computed.severity = t.forced_severity;
    }
    return {
      ...t,
      computed_state: computed
    };
  });
  res.json({ tasks });
});

app.post('/api/demo/reset', (req, res) => {
  seedDatabase();
  res.json({ success: true });
});

app.post('/api/demo/checkin', async (req, res) => {
  const { task_id, progress_pct } = req.body;
  const task = ds.getTask(task_id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  // 1. Close efficacy feedback loop on previous intervention
  recordEfficacyOutcome(task, progress_pct);

  // 2. Advance time by 1 hour from last checkin
  const checkins = task.checkins || [];
  let lastTime = new Date().getTime();
  if (checkins.length > 0) {
      lastTime = new Date(checkins[checkins.length - 1].timestamp).getTime();
  }
  const newTimestamp = new Date(lastTime + 1 * 60 * 60 * 1000).toISOString();
  
  ds.addCheckin(task_id, progress_pct, newTimestamp);
  
  // Clear any forced severity since we have new data
  delete task.forced_severity;
  
  // 3. Instantly re-trigger intervention decision
  const decisionResult = await decideIntervention(task_id);
  if (decisionResult) {
      task.latest_decision = decisionResult.decision;
      // 4. Execute the chosen action
      await executeAction(task, decisionResult.decision, oauth2Client);
  }
  
  res.json({ success: true });
});

app.post('/api/demo/action/confirm', async (req, res) => {
    const { task_id } = req.body;
    const task = ds.getTask(task_id);
    if (!task || !task.ui_state || task.ui_state.type !== 'renegotiation') {
        return res.status(400).json({ error: 'No pending renegotiation' });
    }

    try {
        if (oauth2Client && oauth2Client.credentials && oauth2Client.credentials.access_token) {
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            // Mock Calendar Swap
            await calendar.events.insert({
                calendarId: 'primary',
                requestBody: {
                    summary: `[Swapped] ${task.title} <-> ${task.ui_state.trade_task_id}`,
                    description: 'Agent renegotiated and swapped event slots.',
                    start: { dateTime: new Date(Date.now() + 60*60*1000).toISOString() }, 
                    end: { dateTime: new Date(Date.now() + 2*60*60*1000).toISOString() }
                }
            });
            task.ui_state = { type: 'silent', message: 'Successfully swapped tasks on Google Calendar.' };
            res.json({ success: true });
        } else {
            task.execution_error = "Calendar API tokens missing. Please authenticate via /auth.";
            res.status(401).json({ error: 'Auth required' });
        }
    } catch (err) {
        task.execution_error = "Calendar API Error: " + err.message;
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/demo/force', (req, res) => {
  const { task_id, severity } = req.body;
  const task = ds.getTask(task_id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  task.forced_severity = severity;
  task.latest_decision = "FORCED";
  res.json({ success: true });
});

// Catch-all route to serve the React index.html for unknown routes
app.get(/(.*)/, (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

// Global Error Handler (Security & Availability)
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
