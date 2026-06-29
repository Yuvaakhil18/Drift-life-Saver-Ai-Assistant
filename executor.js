const { google } = require('googleapis');
const ds = require('./datastore');

async function executeAction(task, decision, oauth2Client) {
    if (!decision || !decision.name || !decision.args) return;
    
    const { name, args } = decision;
    const task_id = task.task_id;
    
    // Default log entry structure
    let logEntry = {
        timestamp: new Date().toISOString(),
        action: name,
        task_id,
        reasoning: args.reasoning || args.evidence || "No reasoning provided",
        reasoning_trace: args.reasoning_trace || null,
        confidence_pct: args.confidence_pct || 0,
        revision_condition: args.revision_condition || null
    };

    // Store the pending revision condition directly on the task for the feedback loop
    if (args.revision_condition) {
        task.pending_revision_condition = {
            condition: args.revision_condition,
            action: name,
            expected_progress: task.computed_state ? task.computed_state.required_pace : 5 
        };
    }

    // Clear previous UI and error states
    delete task.ui_state;
    delete task.execution_error;

    switch (name) {
        case 'silent_reshuffle':
            try {
                if (oauth2Client && oauth2Client.credentials && oauth2Client.credentials.access_token) {
                    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
                    await calendar.events.insert({
                        calendarId: 'primary',
                        requestBody: {
                            summary: `[Reshuffled] ${task.title}`,
                            description: 'Agent invisibly corrected time blocks.',
                            start: { dateTime: new Date(Date.now() + 60*60*1000).toISOString() }, 
                            end: { dateTime: new Date(Date.now() + 2*60*60*1000).toISOString() }
                        }
                    });
                    logEntry.status = "success";
                    task.ui_state = { type: 'silent', message: 'Task schedule invisibly reshuffled on Calendar' };
                } else {
                    logEntry.status = "failed_no_auth";
                    task.execution_error = "Calendar API tokens missing. Please authenticate via /auth.";
                }
            } catch (err) {
                logEntry.status = "error";
                logEntry.error = err.message;
                task.execution_error = "Calendar API Error: " + err.message;
            }
            break;

        case 'send_nudge':
            task.ui_state = { 
                type: 'nudge', 
                message: args.next_action, 
                link: args.resource_link || "#" 
            };
            logEntry.status = "success";
            break;

        case 'propose_renegotiation':
            task.ui_state = {
                type: 'renegotiation',
                trade_task_id: args.trade_task_id,
                message: args.reasoning,
                trade_args: args
            };
            logEntry.status = "pending_user";
            break;

        case 'escalate_honestly':
            task.ui_state = {
                type: 'escalation',
                miss_by: args.projected_miss_by_hours,
                message: args.evidence
            };
            logEntry.status = "success";
            break;
            
        default:
            logEntry.status = "unknown_action";
            break;
    }
    
    task.activity_log = task.activity_log || [];
    task.activity_log.push(logEntry);
}

function recordEfficacyOutcome(task, new_progress_pct) {
    if (!task.pending_revision_condition) return;

    const { action, expected_progress } = task.pending_revision_condition;
    
    const lastProgress = task.checkins && task.checkins.length > 0 ? task.checkins[task.checkins.length-1].progress_pct : 0;
    const progressDelta = new_progress_pct - lastProgress;
    
    let outcome = "no_effect";
    if (progressDelta >= expected_progress) {
        outcome = "closed_gap";
    } else if (progressDelta > 0) {
        outcome = "partial";
    }
    
    ds.addIntervention(task.task_id, action, outcome);
    
    delete task.pending_revision_condition;
}

module.exports = { executeAction, recordEfficacyOutcome };
