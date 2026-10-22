/**
 * herdr-dsh — report a DeepSeek Harness (DSH) TUI to Herdr as a first-class
 * agent, using Herdr's documented agent self-reporting API.
 *
 * The plugin is inert outside a Herdr pane. Inside one it reports:
 *   - `working` / `idle` from DSH's `agent/status` event,
 *   - `blocked` while an approval or user question waits for a human,
 *   - a resume command for the root session,
 *   - `release-agent` when the process exits.
 *
 * @module herdr-dsh
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'herdr-dsh'

const SOURCE = 'dsh'
const AGENT = 'dsh'
const DEFAULT_RESUME_BIN = 'deepseek'
const DEBUG_LOG = join(tmpdir(), 'dsh-herdr-report.log')

const env = process.env
const enabled = env.HERDR_ENV === '1'
  && typeof env.HERDR_PANE_ID === 'string' && env.HERDR_PANE_ID.length > 0
  && typeof env.HERDR_BIN_PATH === 'string' && env.HERDR_BIN_PATH.length > 0

/** Stable identity for the running set: the agent id, else the session id. */
const agentKey = agent => agent?.id ?? agent?.session?.id ?? agent

/**
 * Build the reporter for one plugin instance. Reports are sent as short-lived
 * detached CLI calls so a slow or missing Herdr never blocks the agent.
 * @param {{ resumeBin: string }} options - resume command name.
 */
function createReporter({ resumeBin }) {
  let seq = Date.now() * 1000
  let lastState
  let lastResume
  let sessionId
  const running = new Set()
  let blocked = 0

  const state = () => {
    if (blocked > 0) return 'blocked'
    return running.size > 0 ? 'working' : 'idle'
  }

  const resumeArgs = () => sessionId === undefined
    ? undefined
    : [resumeBin, `--resume=${sessionId}`]

  const send = args => {
    if (env.DSH_HERDR_DEBUG === '1') {
      try { appendFileSync(DEBUG_LOG, `${JSON.stringify(args)}\n`) } catch {}
    }
    try {
      const child = spawn(env.HERDR_BIN_PATH, args, { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
    } catch {
      // A report must never fail the agent turn.
    }
  }

  const report = (next = state(), force = false) => {
    if (!enabled) return
    const resume = resumeArgs()
    const resumeKey = resume === undefined ? '' : resume.join('\u0000')
    if (!force && next === lastState && resumeKey === lastResume) return
    lastState = next
    lastResume = resumeKey
    seq += 1
    const args = [
      'pane', 'report-agent', env.HERDR_PANE_ID,
      '--source', SOURCE,
      '--agent', AGENT,
      '--state', next,
      '--seq', String(seq),
    ]
    if (sessionId !== undefined) args.push('--agent-session-id', sessionId)
    if (resume !== undefined) args.push('--', ...resume)
    send(args)
  }

  const release = () => {
    if (!enabled) return
    seq += 1
    try {
      spawnSync(env.HERDR_BIN_PATH, [
        'pane', 'release-agent', env.HERDR_PANE_ID,
        '--source', SOURCE,
        '--agent', AGENT,
        '--seq', String(seq),
      ], { stdio: 'ignore', timeout: 500 })
    } catch {
      // Herdr also clears the agent when the pane returns to its shell.
    }
  }

  return {
    report,
    release,
    setSession(id) {
      const next = typeof id === 'string' && id.length > 0 ? id : undefined
      if (next === sessionId) return
      sessionId = next
      report('idle', true)
    },
    start(agent) {
      running.add(agentKey(agent))
      report()
    },
    stop(agent) {
      running.delete(agentKey(agent))
      report()
    },
    enterBlocked() {
      blocked += 1
      report()
    },
    leaveBlocked() {
      blocked = Math.max(0, blocked - 1)
      report()
    },
  }
}

/**
 * Mount the integration. DSH calls this with the plugin config from the
 * profile patch; `resumeBin` may also be set with DSH_HERDR_RESUME_BIN.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {{ resumeBin?: string }} [config] - optional plugin config.
 */
export function apply(ctx, config = {}) {
  if (!enabled) return

  const resumeBin = typeof config?.resumeBin === 'string' && config.resumeBin.length > 0
    ? config.resumeBin
    : (env.DSH_HERDR_RESUME_BIN || DEFAULT_RESUME_BIN)
  const reporter = createReporter({ resumeBin })

  ctx.on('session/created', session => {
    // Subagent sessions carry a parent; the TUI's own resumable session is the root.
    if (session?.parentSession !== undefined && session?.parentSession !== null) return
    reporter.setSession(typeof session?.id === 'string' ? session.id : String(session?.id ?? ''))
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') reporter.start(agent)
    else if (status === 'idle') reporter.stop(agent)
  })

  // A disposed agent that never reached idle must not leave `working` pinned.
  ctx.on('agent/disposed', ({ agent }) => reporter.stop(agent))

  // A pending approval or question is the one state idle/running cannot express.
  ctx.on('approval/request', async (request, next) => {
    reporter.enterBlocked()
    try {
      return await next()
    } finally {
      reporter.leaveBlocked()
    }
  })

  ctx.on('user-questions/request', async (request, next) => {
    reporter.enterBlocked()
    try {
      return await next()
    } finally {
      reporter.leaveBlocked()
    }
  })

  process.once('exit', () => reporter.release())
}
