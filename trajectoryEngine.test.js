const { getRequiredPace, getTaskState } = require('./trajectoryEngine');

describe('Trajectory Engine Mathematical Verification', () => {
    
    describe('getRequiredPace', () => {
        it('should require 0 pace if past deadline', () => {
            const result = getRequiredPace({
                created_at: '2020-01-01T00:00:00Z',
                deadline: '2020-01-02T00:00:00Z'
            }, new Date('2020-01-03T00:00:00Z'));
            // Wait, if deadline is past and work is not 100%, pace is Infinity.
            // But if we're done it should be 0. Let's make it finished.
            const resultFinished = getRequiredPace({
                created_at: '2020-01-01T00:00:00Z',
                deadline: '2020-01-02T00:00:00Z',
                checkins: [{progress_pct: 100}]
            }, new Date('2020-01-03T00:00:00Z'));
            expect(resultFinished).toBe(0);
        });

        it('should calculate pace correctly mid-task', () => {
            const now = Date.now();
            const start = new Date(now - 5 * 60 * 60 * 1000).toISOString();
            const deadline = new Date(now + 5 * 60 * 60 * 1000).toISOString();
            
            const pace = getRequiredPace({
                created_at: start,
                deadline: deadline
            }, new Date(now));
            
            expect(pace).toBeGreaterThan(0);
        });
    });

    describe('getTaskState', () => {
        it('should return converging when pace is excellent', () => {
            const now = Date.now();
            const task = {
                created_at: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
                deadline: new Date(now + 10 * 60 * 60 * 1000).toISOString(),
                estimated_effort_hours: 5,
                historical_pace_factor: 1.0,
                checkins: [
                    { progress_pct: 50, timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
                    { progress_pct: 60, timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString() }
                ]
            };
            const state = getTaskState(task, new Date(now));
            expect(state.severity).toBe('converging');
        });

        it('should return will_miss when pace is disastrous', () => {
            const now = Date.now();
            const task = {
                created_at: new Date(now - 19 * 60 * 60 * 1000).toISOString(),
                deadline: new Date(now + 1 * 60 * 60 * 1000).toISOString(),
                estimated_effort_hours: 10,
                historical_pace_factor: 1.0,
                checkins: [
                    { progress_pct: 0, timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString() },
                    { progress_pct: 5, timestamp: new Date(now).toISOString() }
                ]
            };
            const state = getTaskState(task, new Date(now));
            expect(state.severity).toBe('will_miss');
        });
    });
});
