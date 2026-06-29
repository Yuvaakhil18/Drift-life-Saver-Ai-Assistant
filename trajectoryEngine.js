/**
 * trajectoryEngine.js
 * 
 * Pure-logic trajectory engine for "Drift".
 * Tracks convergence/divergence from deadlines.
 */

// Helper to calculate hours between two dates
function hoursBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return (d2 - d1) / (1000 * 60 * 60);
}

/**
 * 1. getRequiredPace
 * @param {Object} task 
 * @param {Date|string|number} now 
 * @returns {number} Required pace in % per hour
 */
function getRequiredPace(task, now = new Date()) {
    const checkins = task.checkins || [];
    // Sort checkins by timestamp ascending just to be safe
    const sortedCheckins = [...checkins].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const latest_progress_pct = sortedCheckins.length > 0 
        ? sortedCheckins[sortedCheckins.length - 1].progress_pct 
        : 0;
        
    const remaining_work_pct = 100 - latest_progress_pct;
    const remaining_time_hours = hoursBetween(now, task.deadline);
    
    if (remaining_work_pct <= 0) return 0; // Finished
    if (remaining_time_hours <= 0) return Infinity; // Missed deadline and not finished
    
    return remaining_work_pct / remaining_time_hours;
}

/**
 * 2. getActualPace
 * @param {Object} task 
 * @returns {number|null} Actual pace in % per hour, or null if < 2 checkins
 */
function getActualPace(task) {
    const checkins = task.checkins || [];
    if (checkins.length < 2) return null;
    
    const sortedCheckins = [...checkins].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const last = sortedCheckins[sortedCheckins.length - 1];
    const prev = sortedCheckins[sortedCheckins.length - 2];
    
    const time_diff_hours = hoursBetween(prev.timestamp, last.timestamp);
    if (time_diff_hours <= 0) return 0; // Avoid division by zero if timestamps are identical
    
    const progress_diff = last.progress_pct - prev.progress_pct;
    return progress_diff / time_diff_hours;
}

/**
 * 3. getDivergence
 * @param {Object} task 
 * @param {Date|string|number} now 
 * @returns {Object} { divergence: number|null, severity: string }
 */
function getDivergence(task, now = new Date()) {
    const required_pace = getRequiredPace(task, now);
    const actual_pace = getActualPace(task);
    
    if (actual_pace === null) {
        return { divergence: null, severity: 'unknown_no_data' };
    }
    
    const divergence = required_pace - actual_pace;
    
    let severity = "";
    if (divergence <= 0) {
        severity = "converging";
    } else if (divergence <= 0.5) {
        severity = "mild_risk";
    } else if (divergence <= 1.5) {
        severity = "real_risk";
    } else {
        severity = "will_miss";
    }
    
    return { divergence, severity };
}

/**
 * 4. updateHistoricalPaceFactor
 * @param {Object} task 
 * @param {number} actual_hours_taken 
 * @returns {number} New historical pace factor
 */
function updateHistoricalPaceFactor(task, actual_hours_taken) {
    const current_factor = task.historical_pace_factor !== undefined ? task.historical_pace_factor : 1.0;
    const estimated = task.estimated_effort_hours;
    
    if (!estimated || estimated <= 0) return current_factor;
    
    const new_factor = actual_hours_taken / estimated;
    
    // Weighted average: weight recent task as 0.7, historical as 0.3
    const ALPHA = 0.7; 
    return (ALPHA * new_factor) + ((1 - ALPHA) * current_factor);
}

/**
 * 5. getInterventionEfficacy
 * @param {string} task_id 
 * @param {string} intervention_type 
 * @param {Array} intervention_history Array of intervention objects
 * @returns {Object|null} Efficacy stats or null if no history
 */
function getInterventionEfficacy(task_id, intervention_type, intervention_history = []) {
    const relevant = intervention_history.filter(i => i.task_id === task_id && i.intervention_type === intervention_type);
    
    if (relevant.length === 0) return null;
    
    let closed_gap = 0;
    let partial = 0;
    let no_effect = 0;
    
    relevant.forEach(record => {
        if (record.outcome === 'closed_gap') closed_gap++;
        else if (record.outcome === 'partial') partial++;
        else if (record.outcome === 'no_effect') no_effect++;
    });
    
    // We can define success rate as (closed_gap + 0.5 * partial) / total, or simply track raw counts
    const total = relevant.length;
    const success_rate = (closed_gap + (0.5 * partial)) / total;
    
    return {
        total,
        closed_gap,
        partial,
        no_effect,
        success_rate,
        description: `Worked (closed gap) ${closed_gap}/${total} times`
    };
}

/**
 * 6. getTaskState
 * Primary interface for Phase 2.
 * @param {Object} task 
 * @param {Date|string|number} now 
 * @returns {Object} 
 */
function getTaskState(task, now = new Date()) {
    const checkins = task.checkins || [];
    const num_checkins = checkins.length;
    
    // Confidence heuristic based on check-in volume
    let confidence_pct = 0;
    if (num_checkins === 1) confidence_pct = 20;
    else if (num_checkins === 2) confidence_pct = 50;
    else if (num_checkins === 3) confidence_pct = 75;
    else if (num_checkins >= 4) confidence_pct = 95;
    
    const required_pace = getRequiredPace(task, now);
    const actual_pace = getActualPace(task);
    const { divergence, severity } = getDivergence(task, now);
    
    return {
        divergence,
        severity,
        required_pace,
        actual_pace,
        confidence_pct
    };
}

// ---------------------------------------------------------
// INLINE TESTS
// ---------------------------------------------------------
if (require.main === module) {
    console.log("Running Trajectory Engine Tests...\n");
    let passed = 0;
    let total = 0;

    function assertEqual(actual, expected, testName) {
        total++;
        // Allow small floating point differences
        const isMatch = (typeof actual === 'number' && typeof expected === 'number') 
            ? Math.abs(actual - expected) < 0.0001
            : JSON.stringify(actual) === JSON.stringify(expected);
            
        if (isMatch) {
            console.log(`✅ ${testName}`);
            passed++;
        } else {
            console.error(`❌ ${testName}`);
            console.error(`   Expected: ${JSON.stringify(expected)}`);
            console.error(`   Actual:   ${JSON.stringify(actual)}`);
        }
    }

    const now = new Date('2026-06-28T12:00:00Z');

    // MOCK TASK 1: On track
    const taskOnTrack = {
        task_id: 't1',
        deadline: new Date('2026-06-28T22:00:00Z').toISOString(), // 10 hours from now
        estimated_effort_hours: 5,
        historical_pace_factor: 1.0,
        checkins: [
            { timestamp: new Date('2026-06-28T08:00:00Z').toISOString(), progress_pct: 0 },
            { timestamp: new Date('2026-06-28T10:00:00Z').toISOString(), progress_pct: 20 },
            { timestamp: new Date('2026-06-28T12:00:00Z').toISOString(), progress_pct: 50 } // Now
        ]
    };

    // 1. getRequiredPace
    // Remaining work = 100 - 50 = 50%
    // Remaining time = 10 hours
    // Required pace = 50 / 10 = 5% per hour
    assertEqual(getRequiredPace(taskOnTrack, now), 5, "getRequiredPace - calculates correctly");

    // 2. getActualPace
    // Last two checkins: 10:00 (20%) to 12:00 (50%)
    // Diff progress = 30%, Diff time = 2 hours
    // Actual pace = 30 / 2 = 15% per hour
    assertEqual(getActualPace(taskOnTrack), 15, "getActualPace - uses last two checkins");

    // 3. getDivergence
    // Required = 5, Actual = 15
    // Divergence = 5 - 15 = -10 (converging)
    const divOnTrack = getDivergence(taskOnTrack, now);
    assertEqual(divOnTrack.divergence, -10, "getDivergence - calculates negative divergence");
    assertEqual(divOnTrack.severity, "converging", "getDivergence - classifies as converging");

    // MOCK TASK 2: Falling behind
    const taskBehind = {
        task_id: 't2',
        deadline: new Date('2026-06-28T14:00:00Z').toISOString(), // 2 hours from now
        checkins: [
            { timestamp: new Date('2026-06-28T10:00:00Z').toISOString(), progress_pct: 10 },
            { timestamp: new Date('2026-06-28T11:00:00Z').toISOString(), progress_pct: 15 },
            { timestamp: new Date('2026-06-28T12:00:00Z').toISOString(), progress_pct: 20 } // Now
        ]
    };

    // Remaining work = 80%. Remaining time = 2 hours. Required pace = 40% / hr
    assertEqual(getRequiredPace(taskBehind, now), 40, "getRequiredPace - falling behind");
    // Actual pace = (20 - 15) / 1 hr = 5% / hr
    assertEqual(getActualPace(taskBehind), 5, "getActualPace - falling behind");
    // Divergence = 40 - 5 = 35 (> 1.5, will_miss)
    assertEqual(getDivergence(taskBehind, now).severity, "will_miss", "getDivergence - will_miss");

    // MOCK TASK 3: No checkins
    const taskNew = {
        task_id: 't3',
        deadline: new Date('2026-06-28T22:00:00Z').toISOString(), // 10 hours
        checkins: []
    };
    assertEqual(getActualPace(taskNew), null, "getActualPace - handles < 2 checkins");
    assertEqual(getDivergence(taskNew, now).severity, "unknown_no_data", "getDivergence - handles no data");

    // 4. updateHistoricalPaceFactor
    const taskForFactor = { estimated_effort_hours: 10, historical_pace_factor: 1.0 };
    // actual = 15 hours. new_factor = 1.5. 
    // formula: 0.7 * 1.5 + 0.3 * 1.0 = 1.05 + 0.3 = 1.35
    assertEqual(updateHistoricalPaceFactor(taskForFactor, 15), 1.35, "updateHistoricalPaceFactor - blends correctly");

    // 5. getInterventionEfficacy
    const history = [
        { task_id: 't1', intervention_type: 'nudge', outcome: 'closed_gap', timestamp: '...' },
        { task_id: 't1', intervention_type: 'nudge', outcome: 'no_effect', timestamp: '...' },
        { task_id: 't1', intervention_type: 'nudge', outcome: 'partial', timestamp: '...' },
        { task_id: 't2', intervention_type: 'nudge', outcome: 'closed_gap', timestamp: '...' }
    ];
    const efficacy = getInterventionEfficacy('t1', 'nudge', history);
    assertEqual(efficacy.total, 3, "getInterventionEfficacy - total count");
    assertEqual(efficacy.closed_gap, 1, "getInterventionEfficacy - closed_gap count");
    assertEqual(efficacy.partial, 1, "getInterventionEfficacy - partial count");
    // success_rate = (1 + 0.5 * 1) / 3 = 1.5 / 3 = 0.5
    assertEqual(efficacy.success_rate, 0.5, "getInterventionEfficacy - success rate calculation");
    assertEqual(getInterventionEfficacy('t1', 'warning', history), null, "getInterventionEfficacy - no history returns null");

    // 6. getTaskState
    const state = getTaskState(taskOnTrack, now);
    assertEqual(state.confidence_pct, 75, "getTaskState - confidence based on 3 checkins");
    assertEqual(state.divergence, -10, "getTaskState - returns divergence");
    assertEqual(state.severity, "converging", "getTaskState - returns severity");

    console.log(`\nTests completed: ${passed}/${total} passed.`);
}

module.exports = {
    getRequiredPace,
    getActualPace,
    getDivergence,
    updateHistoricalPaceFactor,
    getInterventionEfficacy,
    getTaskState
};
