/**
 * seed.js
 * Injects deterministic seed data into the datastore.
 */
const ds = require('./datastore');

function seedDatabase() {
    ds.clearAll();
    const now = new Date();

    // Task 1: "Pay AWS Server Bill" -> converging
    // Steady on-pace check-ins
    const t1 = {
        task_id: 't1',
        title: 'Pay AWS Server Bill',
        created_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        deadline: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
        estimated_effort_hours: 10,
        historical_pace_factor: 1.0,
        checkins: [
            { timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), progress_pct: 25 },
            { timestamp: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString(), progress_pct: 50 }
        ]
    };
    ds.saveTask(t1);

    // Task 2: "Final Round Tech Interview" -> mild_risk/real_risk
    // High historical_pace_factor, stalled checkins
    const t2 = {
        task_id: 't2',
        title: 'Final Round Tech Interview',
        created_at: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        estimated_effort_hours: 5,
        historical_pace_factor: 1.6, // Fake past completed instances
        checkins: [
            { timestamp: new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString(), progress_pct: 10 },
            { timestamp: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(), progress_pct: 12 } // stalled
        ]
    };
    ds.saveTask(t2);

    // Task 3: "Submit CS401 Project" -> will_miss
    // Missed checkins, pre-loaded failed nudge history
    const t3 = {
        task_id: 't3',
        title: 'Submit CS401 Project',
        created_at: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString(),
        deadline: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
        estimated_effort_hours: 8,
        historical_pace_factor: 1.0,
        checkins: [
            { timestamp: new Date(now.getTime() - 60 * 60 * 60 * 1000).toISOString(), progress_pct: 5 },
            { timestamp: new Date(now.getTime() - 40 * 60 * 60 * 1000).toISOString(), progress_pct: 10 }
            // Missed recent checkins
        ]
    };
    ds.saveTask(t3);
    
    // Seed intervention efficacy to prove memory mechanic
    ds.addIntervention('t3', 'nudge', 'no_effect', new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString());
    ds.addIntervention('t3', 'nudge', 'no_effect', new Date(now.getTime() - 15 * 60 * 60 * 1000).toISOString());

    // Add explicit past failures for Task 3 to trigger the efficacy feedback loop rules
    ds.addIntervention('t3', 'send_nudge', 'no_effect');
    ds.addIntervention('t3', 'send_nudge', 'no_effect');
    
    console.log("Database seeded successfully.");
}

module.exports = { seedDatabase };
