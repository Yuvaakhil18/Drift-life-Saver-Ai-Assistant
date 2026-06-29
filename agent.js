/**
 * agent.js
 * Implements decideIntervention using Gemini function calling.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const ds = require('./datastore');
const { getTaskState, getInterventionEfficacy } = require('./trajectoryEngine');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction: `You are a task-trajectory agent. You do not manage to-do lists — you manage momentum. You receive a task's divergence state, the user's other scheduled tasks, and a history of which interventions have worked or failed for this user before. Choose exactly ONE intervention by calling exactly one tool.

Rules:
- Check intervention_efficacy history FIRST. If a given intervention type has already failed twice for this task, do not repeat it — escalate to the next tier even if divergence alone would normally suggest a lighter touch. Example: if send_nudge has outcome no_effect twice for this task, you MUST call propose_renegotiation or escalate_honestly next, even if divergence alone would suggest a lighter intervention.
- If divergence is mild_risk, there is unscheduled time today, AND silent_reshuffle hasn't already failed for this task, use silent_reshuffle. Never bother the user if the problem is fixable invisibly.
- If silent correction isn't possible or has failed before, use send_nudge with the smallest possible next step — never 'finish the task,' always the next 10-20 minutes of it.
- If nudges have failed twice for this task, use propose_renegotiation — identify the lowest-priority task in today's schedule and propose trading its slot.
- Only use escalate_honestly if severity is will_miss even after attempting the above. Be factual, not motivational. State the projected miss time and the data behind it, including the user's historical_pace_factor if relevant ('based on 3 similar past tasks, you typically take 60% longer than estimated'). Do not soften this with encouragement.
- Always include confidence_pct, grounded in real efficacy history when available — do not invent a high-confidence number with no data behind it; default to a moderate, honest confidence (e.g. 50-60%) when history is thin.
- Always include a revision_condition for non-terminal actions.
- Always include reasoning_trace: a short, honest explanation of what you weighed and why, especially when two tasks or strategies were in tension. This should read like a judgment call, not a status update.
- Never call more than one tool. Never return plain text instead of a tool call.`,
  tools: [{
    functionDeclarations: [
      {
        name: "silent_reshuffle",
        description: "Invisibly correct mild risk by shifting time blocks if unscheduled time exists.",
        parameters: {
          type: "OBJECT",
          properties: {
            task_id: { type: "STRING" },
            new_chunk_size_pct: { type: "NUMBER" },
            new_time_block: { type: "STRING" },
            confidence_pct: { type: "NUMBER" },
            revision_condition: { type: "STRING" },
            reasoning_trace: { type: "STRING" }
          },
          required: ["task_id", "new_chunk_size_pct", "new_time_block", "confidence_pct", "revision_condition", "reasoning_trace"]
        }
      },
      {
        name: "send_nudge",
        description: "Send a gentle nudge with the smallest possible next step.",
        parameters: {
          type: "OBJECT",
          properties: {
            task_id: { type: "STRING" },
            next_action: { type: "STRING" },
            resource_link: { type: "STRING" },
            confidence_pct: { type: "NUMBER" },
            revision_condition: { type: "STRING" },
            reasoning_trace: { type: "STRING" }
          },
          required: ["task_id", "next_action", "resource_link", "confidence_pct", "revision_condition", "reasoning_trace"]
        }
      },
      {
        name: "propose_renegotiation",
        description: "Propose trading a time slot with the lowest-priority task in today's schedule.",
        parameters: {
          type: "OBJECT",
          properties: {
            task_id: { type: "STRING" },
            trade_task_id: { type: "STRING" },
            reasoning: { type: "STRING" },
            confidence_pct: { type: "NUMBER" },
            revision_condition: { type: "STRING" },
            reasoning_trace: { type: "STRING" }
          },
          required: ["task_id", "trade_task_id", "reasoning", "confidence_pct", "revision_condition", "reasoning_trace"]
        }
      },
      {
        name: "escalate_honestly",
        description: "Escalate honestly when a deadline will be missed.",
        parameters: {
          type: "OBJECT",
          properties: {
            task_id: { type: "STRING" },
            projected_miss_by_hours: { type: "NUMBER" },
            evidence: { type: "STRING" },
            confidence_pct: { type: "NUMBER" },
            reasoning_trace: { type: "STRING" }
          },
          required: ["task_id", "projected_miss_by_hours", "evidence", "confidence_pct", "reasoning_trace"]
        }
      }
    ]
  }]
});

async function decideIntervention(task_id) {
    const task = ds.getTask(task_id);
    if (!task) return null;
    
    const state = getTaskState(task);
    
    // Only intervene if not converging
    if (state.severity === 'converging') {
        return { decision: { name: "None (On Track)", args: {} }, state };
    }

    const otherTasks = ds.getTasks().filter(t => t.task_id !== task_id);
    const efficacyHistory = ds.getInterventionHistory().filter(h => h.task_id === task_id);
    
    const userMessage = `
TASK TRAJECTORY STATE:
${JSON.stringify({ task, state }, null, 2)}

USER'S OTHER SCHEDULED TASKS:
${JSON.stringify(otherTasks, null, 2)}

INTERVENTION EFFICACY HISTORY:
${JSON.stringify(efficacyHistory, null, 2)}
    `;

    try {
        const chat = model.startChat();
        let result = await chat.sendMessage(userMessage);
        let call = result.response.functionCalls() && result.response.functionCalls()[0];

        if (!call) {
            console.log("Agent returned plain text, retrying to force tool call...");
            const retryMessage = "You must respond with a tool call. Please select an intervention.";
            result = await chat.sendMessage(retryMessage);
            call = result.response.functionCalls() && result.response.functionCalls()[0];
        }

        if (call) {
            // Reject and retry if reasoning_trace is missing or generic placeholder
            if (!call.args.reasoning_trace || call.args.reasoning_trace.length < 20 || call.args.reasoning_trace.toLowerCase().includes("this is the best action")) {
                console.log("Agent returned generic reasoning_trace, retrying...");
                const retryMessage = "Your reasoning_trace was too generic or missing. Provide a real 1-2 sentence judgment call explaining your trade-off.";
                result = await chat.sendMessage(retryMessage);
                call = result.response.functionCalls() && result.response.functionCalls()[0];
            }
        }

        if (call) {
            ds.logActivity(call.name, task_id, JSON.stringify(call.args));
            return { decision: call, state };
        } else {
            console.warn("Agent returned plain text instead of tool call after retry.");
            return { decision: { name: "Agent Failed to Call Tool", args: { text: result.response.text() } }, state };
        }

    } catch (error) {
        console.error("Gemini API Error:", error);
        return { decision: { name: "API Error", args: { error: error.message } }, state };
    }
}

function reportInterventionEfficacy(task_id, intervention_type, outcome) {
    ds.addIntervention(task_id, intervention_type, outcome);
}

module.exports = { decideIntervention, reportInterventionEfficacy };
