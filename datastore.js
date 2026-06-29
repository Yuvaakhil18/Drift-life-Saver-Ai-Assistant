/**
 * datastore.js
 * In-memory mock database for Drift demo.
 */

let tasks = {};
let interventions = [];
let activity_log = [];

function getTasks() {
    return Object.values(tasks);
}

function getTask(task_id) {
    return tasks[task_id];
}

function saveTask(task) {
    tasks[task.task_id] = task;
}

function addCheckin(task_id, progress_pct, timestamp = new Date().toISOString()) {
    if (!tasks[task_id]) return;
    if (!tasks[task_id].checkins) tasks[task_id].checkins = [];
    tasks[task_id].checkins.push({ timestamp, progress_pct });
}

function addIntervention(task_id, type, outcome, timestamp = new Date().toISOString()) {
    interventions.push({ task_id, intervention_type: type, outcome, timestamp });
}

function getInterventionHistory() {
    return interventions;
}

function logActivity(action, task_id, reasoning, timestamp = new Date().toISOString()) {
    activity_log.push({ timestamp, action, task_id, reasoning });
}

function clearAll() {
    tasks = {};
    interventions = [];
    activity_log = [];
}

module.exports = {
    getTasks,
    getTask,
    saveTask,
    addCheckin,
    addIntervention,
    getInterventionHistory,
    logActivity,
    clearAll
};
