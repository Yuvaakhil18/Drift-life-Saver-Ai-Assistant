import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function App() {
  const [tasks, setTasks] = useState([]);
  
  const loadState = useCallback(async () => {
    try {
      const res = await fetch('/api/demo/state');
      const data = await res.json();
      setTasks(data.tasks);
    } catch(err) {
      console.error(err);
    }
  }, []);

  const spokenLogs = useRef(new Set());
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const speakMessage = (text) => {
    if (!window.speechSynthesis) return;
    const cleanText = text.replace(/_/g, ' ');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    const goodVoice = voices.find(v => v.name.includes('Google UK English Female') || v.name.includes('Samantha') || v.name.includes('Google US English'));
    if (goodVoice) utterance.voice = goodVoice;
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (!initialLoadDone && tasks.length > 0) {
      const existing = new Set();
      tasks.forEach(t => {
        (t.activity_log || []).forEach(l => existing.add(t.task_id + l.timestamp));
      });
      spokenLogs.current = existing;
      setInitialLoadDone(true);
    } else if (initialLoadDone) {
      tasks.forEach(t => {
        (t.activity_log || []).forEach(l => {
          const key = t.task_id + l.timestamp;
          if (!spokenLogs.current.has(key) && l.reasoning_trace) {
            spokenLogs.current.add(key);
            speakMessage(l.reasoning_trace);
          }
        });
      });
    }
  }, [tasks, initialLoadDone]);

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 2000);
    return () => clearInterval(interval);
  }, [loadState]);

  const simulateCheckin = useCallback(async (taskId, progress) => {
    await fetch('/api/demo/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, progress_pct: progress })
    });
    loadState();
  }, [loadState]);

  const confirmAction = useCallback(async (taskId) => {
    await fetch('/api/demo/action/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId })
    });
    loadState();
  }, [loadState]);

  const formatChartData = useCallback((task) => {
    return (task.checkins || []).map((c, i) => ({
      time: `Checkin ${i+1}`,
      actual: c.progress_pct,
      required: Math.min(100, (i + 1) * task.computed_state?.required_pace || 0) // rough proxy for visualization
    }));
  }, []);

  const [isDemoing, setIsDemoing] = useState(false);
  const abortDemoRef = useRef(false);

  const stopDemoPitch = useCallback(() => {
    abortDemoRef.current = true;
    setIsDemoing(false);
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const handleDemoPitch = useCallback(async () => {
    abortDemoRef.current = false;
    setIsDemoing(true);

    const delay = (ms) => new Promise(resolve => {
      const start = Date.now();
      const check = setInterval(() => {
        if (abortDemoRef.current || Date.now() - start >= ms) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    // Task 1
    if (abortDemoRef.current) return;
    window.scrollTo({ top: 300, behavior: 'smooth' });
    await delay(1500);
    if (abortDemoRef.current) return;
    await simulateCheckin('t1', 50);
    await delay(6000);
    
    // Task 2
    if (abortDemoRef.current) return;
    window.scrollTo({ top: window.innerHeight + 300, behavior: 'smooth' });
    await delay(1500);
    if (abortDemoRef.current) return;
    await simulateCheckin('t2', 30); // stalled
    await delay(8000);

    // Task 3
    if (abortDemoRef.current) return;
    window.scrollTo({ top: (window.innerHeight * 2) + 300, behavior: 'smooth' });
    await delay(1500);
    if (abortDemoRef.current) return;
    await simulateCheckin('t3', 10); // severe stall + efficacy memory
    await delay(6000);
    
    if (!abortDemoRef.current) setIsDemoing(false);
  }, [simulateCheckin]);

  const hasActiveEscalation = tasks.some(t => t.computed_state?.severity === 'will_miss' || t.computed_state?.severity === 'real_risk');

  return (
    <div className="min-h-screen text-[#111111] pb-32 font-['Inter'] selection:bg-indigo-500/30">
      <div className="noise-bg" />
      
      {/* Minimal Header */}
      <header className="fixed top-0 w-full z-50 bg-[#F8F9FA]/80 backdrop-blur-md border-b border-[#EAEAEA]">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${hasActiveEscalation ? 'bg-[#ff3b30]' : 'bg-[#34c759]'}`} />
              <span className="font-semibold tracking-tight text-[#111111]">Drift Agent</span>
            </div>
            
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#F7F6F3] rounded-full border border-[#EAEAEA]">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#A0A0A0]">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#787774]">Google Calendar Synced</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isDemoing ? (
              <motion.button 
                whileHover={{ scale: 0.98 }}
                whileTap={{ scale: 0.95 }}
                onClick={stopDemoPitch}
                aria-label="Stop Demo Pitch"
                className="text-xs font-bold uppercase tracking-widest bg-[#ff3b30] text-white px-4 py-2 rounded-lg shadow-sm hover:bg-[#d72b22] transition-colors"
              >
                Stop Demo
              </motion.button>
            ) : (
              <motion.button 
                whileHover={{ scale: 0.98 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleDemoPitch}
                aria-label="Run Demo Pitch"
                className="text-xs font-bold uppercase tracking-widest bg-[#111111] text-white px-4 py-2 rounded-lg shadow-sm hover:bg-[#333333] transition-colors"
              >
                Run Demo Pitch
              </motion.button>
            )}
          </div>
        </div>
      </header>

      {/* Dynamic Bento Dashboard */}
      <main className="max-w-[1400px] mx-auto px-6 pt-28">
        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          
          {/* Hero Tile (Spans 2 columns on large screens) */}
          <motion.div 
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="col-span-1 md:col-span-2 bento-card p-10 bg-[#111111] text-white flex flex-col justify-between min-h-[400px]"
          >
            <div>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[1.05] mb-6">
                Never miss a<br/>
                <span className="text-[#787774]">deadline again.</span>
              </h1>
              <p className="text-lg md:text-xl text-[#787774] font-medium max-w-xl leading-relaxed">
                Drift proactively tracks your bills, assignments, and interviews. If you fall behind, the AI scheduling assistant automatically reallocates your calendar to save you.
              </p>
            </div>
            <div className="mt-12 flex gap-4">
              <motion.button 
                whileHover={{ scale: 0.98 }}
                whileTap={{ scale: 0.95 }}
                aria-label="Connect Google Calendar"
                className="bg-white text-[#111111] px-8 py-4 rounded-lg text-sm font-bold shadow-sm transition-colors"
                onClick={() => window.open('/auth', '_blank')}
              >
                Connect Calendar
              </motion.button>
            </div>
          </motion.div>

          {/* AI Scheduling Assistant Tile */}
          <motion.div 
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="col-span-1 bento-card p-8 bg-white flex flex-col justify-between min-h-[400px]"
          >
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="bg-[#111111] text-white p-2 rounded-lg text-sm">✨</div>
                <h2 className="font-bold text-[#111111] text-lg tracking-tight">AI Scheduling Assistant</h2>
              </div>
              
              <div className="space-y-6">
                <div className="relative pl-5 border-l-2 border-[#EAEAEA]">
                  <div className="absolute w-3 h-3 bg-[#EAEAEA] rounded-full -left-[7px] top-1" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A0A0A0] mb-1">10:00 AM</p>
                  <p className="text-sm font-bold text-[#787774]">Team Standup</p>
                </div>
                
                <div className="relative pl-5 border-l-2 border-[#111111]">
                  <div className="absolute w-3 h-3 bg-[#111111] rounded-full -left-[7px] top-1" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#111111] mb-1">2:00 PM</p>
                  <p className="text-sm font-bold text-[#111111]">Final Round Tech Interview</p>
                  <div className="mt-3 text-xs font-semibold text-[#787774] bg-[#F7F6F3] p-3 rounded-xl border border-[#EAEAEA]">
                    Reallocated +1hr from CS401 Project to create space for interview prep.
                  </div>
                </div>
                
                <div className="relative pl-5 border-l-2 border-[#EAEAEA]">
                  <div className="absolute w-3 h-3 bg-[#EAEAEA] rounded-full -left-[7px] top-1" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#A0A0A0] mb-1">6:00 PM</p>
                  <p className="text-sm font-bold text-[#787774]">Pay AWS Server Bill</p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Tasks as Bento Tiles */}
          {tasks.map((task, idx) => {
            const isWillMiss = task.computed_state?.severity === 'will_miss';
            const chartData = formatChartData(task);
            const latestProgress = task.checkins?.length > 0 ? task.checkins[task.checkins.length-1].progress_pct : 0;
            
            let taskIcon = "📋";
            let taskType = "Task";
            if (task.title.includes("Bill")) { taskIcon = "💳"; taskType = "Bill Payment"; }
            if (task.title.includes("Interview")) { taskIcon = "👔"; taskType = "Interview"; }
            if (task.title.includes("Project") || task.title.includes("Assignment")) { taskIcon = "🎓"; taskType = "Assignment"; }

            return (
              <motion.section 
                layout
                key={task.task_id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 30, delay: idx * 0.1 }}
                whileHover={{ scale: 1.01, boxShadow: "0 12px 40px rgba(0,0,0,0.06)" }}
                className={`bento-card p-8 flex flex-col gap-8 transition-colors duration-500 ${isWillMiss ? 'bg-[#FDEBEC] border-[#FDEBEC]' : 'bg-white'}`}
              >
                {/* Header */}
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                         <span className="text-base">{taskIcon}</span>
                         <span className="text-[10px] font-bold uppercase tracking-widest text-[#787774]">{taskType}</span>
                      </div>
                      <h2 className="text-2xl font-bold tracking-tight text-[#111111] leading-tight pr-4">{task.title}</h2>
                    </div>
                    <span className="text-sm font-semibold text-[#787774] bg-[#F7F6F3] px-3 py-1 rounded-full">{latestProgress}%</span>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                    task.computed_state?.severity === 'converging' ? 'bg-[#EDF3EC] text-[#346538]' :
                    task.computed_state?.severity === 'will_miss' ? 'bg-[#FDEBEC] text-[#9F2F2D]' :
                    'bg-[#FBF3DB] text-[#956400]'
                  }`}>
                    {(task.computed_state?.severity || 'unknown').replace('_', ' ')}
                  </span>
                </div>

                {/* Trajectory Sparkline */}
                <div className="h-32 bg-[#F7F6F3] rounded-2xl p-4 border border-[#EAEAEA] relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #EAEAEA', background: '#FFFFFF', color: '#111111', fontSize: '12px' }} itemStyle={{ color: '#111111' }} />
                      <Line type="monotone" dataKey="actual" stroke="#111111" strokeWidth={3} dot={{ r: 3, fill: '#111111' }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="required" stroke="#A0A0A0" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Agent Activity / UI State */}
                <div className="flex-1" aria-live="polite">
                  {task.ui_state ? (
                    <div className="bg-[#F7F6F3] p-4 rounded-2xl border border-[#EAEAEA]">
                      <p className="font-semibold text-sm text-[#111111] mb-2">{task.ui_state.message}</p>
                      {task.ui_state.type === 'nudge' && task.ui_state.link !== '#' && (
                        <a href={task.ui_state.link} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#111111] hover:underline">
                          Open Resource &rarr;
                        </a>
                      )}
                      {task.ui_state.type === 'renegotiation' && (
                        <button 
                          onClick={() => confirmAction(task.task_id)}
                          className="mt-2 w-full bg-[#111111] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-[#333333] transition-colors"
                        >
                          Accept Swap
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(task.activity_log || []).slice(-1).map((log, i) => (
                        <div key={i} className="text-sm">
                          <p className="font-semibold text-[#111111]">{log.action.replace('_', ' ')}</p>
                          <p className="text-[#787774] line-clamp-2 mt-1 leading-relaxed">{log.reasoning}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div className="pt-4 border-t border-[#EAEAEA] flex gap-2">
                  <motion.button 
                    whileHover={{ scale: 0.98 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => simulateCheckin(task.task_id, Math.min(100, latestProgress + 5))}
                    className="flex-1 bg-[#F7F6F3] border border-[#EAEAEA] py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-[#111111] hover:bg-[#EAEAEA] transition-colors"
                  >
                    +5%
                  </motion.button>
                  <motion.button 
                    whileHover={{ scale: 0.98 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => simulateCheckin(task.task_id, latestProgress)}
                    className="flex-1 bg-[#F7F6F3] border border-[#EAEAEA] py-2 rounded-lg text-[11px] font-bold uppercase tracking-widest text-[#111111] hover:bg-[#EAEAEA] transition-colors"
                  >
                    Stall
                  </motion.button>
                </div>

              </motion.section>
            );
          })}
        </motion.div>
      </main>

    </div>
  );
}

export default App;
