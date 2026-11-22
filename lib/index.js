/**
 * dsh-ponytail-official — DietrichGebert/ponytail 官方正文的自维护 DSH 插件
 *
 * 能力（对齐官方 instruction-tier 形态，PR #1020 验证路线的插件化封装）：
 * - always-on 规则注入：官方 AGENTS.md 原文，systemPrompt section，order 50
 * - 6 个 skill：ponytail / ponytail-review / ponytail-audit / ponytail-debt / ponytail-gain / ponytail-help
 *   正文与 frontmatter 逐字来自上游 tag（update-from-upstream.ps1 同步）
 * - 零 tool 注册、零配置面、零持久化状态；卸载即彻底消失
 *
 * 与 @wenaixi/dsh-ponytail 的差别：不做档位切换 / 配置面板 / 零缓存破坏，
 * 只做「官方最新正文 + 可装可卸」。内容真源是本包内的 skills/ 与 AGENTS.md，
 * 由 update-from-upstream.ps1 从 D:\ponytail-upstream 同步。
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pkgVersion = '0.0.0'
try {
  pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version
} catch {
  // 版本读不到就按未知处理，启动检查会跳过比较
}

const UPSTREAM_RELEASES_LATEST = 'https://github.com/DietrichGebert/ponytail/releases/latest'
const UPSTREAM_API_LATEST = 'https://api.github.com/repos/DietrichGebert/ponytail/releases/latest'

export const name = 'ponytail-official'
export const inject = ['skills', 'systemPrompt']

const SKILL_RANK = 550
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''))
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isNewer(latest, current) {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

let updateNotice = ''

function logSteps(message) {
  try {
    appendFileSync(join(tmpdir(), 'ponytail-steps.log'), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch {
    // 日志失败不影响功能
  }
}

function resolvePowerShell() {
  const root = process.env.SystemRoot || process.env.windir
  if (root) {
    const candidate = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // 落到 PATH 查找
    }
  }
  return 'powershell.exe'
}

function notify(title, message, options = {}) {
  const exe = resolvePowerShell()
  try {
    // 中文标题/正文经命令行传参会按系统 ANSI 解码而乱码，改为写 UTF-8 JSON 让脚本自己读
    const payloadPath = join(tmpdir(), `ponytail-toast-${process.pid}-${Date.now()}.json`)
    writeFileSync(payloadPath, JSON.stringify({ title, message, force: Boolean(options.force) }), 'utf8')
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(pkgRoot, 'notify.ps1'),
      '-Payload',
      payloadPath,
    ]
    // 不用 detached：Electron 的 job object 会在父隔离后回收 detached 子进程，
    // 导致 PowerShell 根本没执行。execFile 让子进程正常跑完，回调里回收错误。
    execFile(exe, args, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) {
        logSteps(`notify exec error: ${err?.message ?? err} | stderr=${String(stderr || '').slice(0, 200)}`)
      } else {
        logSteps('notify exec ok')
      }
    })
    logSteps(`notify queued (${exe})`)
  } catch (err) {
    logSteps(`notify threw: ${err?.message ?? err}`)
  }
}

async function fetchLatestTag(ctx) {
  // 通道 1：releases/latest 的 302 重定向，最终 URL 里带 tag。走 github.com 主页域名，
  // 不受 API 的 60 次/小时匿名限流影响，是首选。
  try {
    const res = await fetch(UPSTREAM_RELEASES_LATEST, {
      redirect: 'follow',
      headers: { 'user-agent': 'dsh-ponytail-official' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const m = /\/releases\/tag\/([^/?#]+)/.exec(res.url)
      if (m) return decodeURIComponent(m[1])
      ctx.logger.debug('[ponytail-official] releases/latest 未落在 tag URL 上')
    } else {
      ctx.logger.debug(`[ponytail-official] releases/latest 返回 HTTP ${res.status}`)
    }
  } catch (err) {
    ctx.logger.debug(`[ponytail-official] releases/latest 请求失败：${err?.message ?? err}`)
  }

  // 通道 2：GitHub API 兜底，可能被匿名限流（403）。
  try {
    const res = await fetch(UPSTREAM_API_LATEST, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-ponytail-official' },
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) {
      const data = await res.json()
      if (data?.tag_name) return data.tag_name
    } else {
      ctx.logger.debug(`[ponytail-official] API 通道返回 HTTP ${res.status}`)
    }
  } catch (err) {
    ctx.logger.debug(`[ponytail-official] API 通道请求失败：${err?.message ?? err}`)
  }

  return null
}

async function checkUpstream(ctx) {
  const latest = await fetchLatestTag(ctx)
  if (!latest) {
    ctx.logger.debug('[ponytail-official] 上游版本检查未拿到结果（离线或不可达），本轮跳过')
    return
  }
  if (!isNewer(latest, pkgVersion)) {
    ctx.logger.info(`[ponytail-official] 已对齐上游（当前 v${pkgVersion}）`)
    return
  }
  updateNotice = `\n\nUpstream ponytail ${latest} is available; this plugin pins v${pkgVersion}. Mention it once to the user in their language and point them to update-from-upstream.ps1 for a weekend update.`
  ctx.logger.warn(`[ponytail-official] 上游有新版本：${latest}（当前 v${pkgVersion}），运行 update-from-upstream.ps1 更新`)
  notify('ponytail 有上游更新', `${latest} 已发布（当前 v${pkgVersion}）。周末运行 update-from-upstream.ps1 更新。`, { force: true })
}

function readString(data, key) {
  const v = data[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function findClosingFrontmatter(raw, start) {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nl = raw.indexOf('\n', lineStart)
    const lineEnd = nl < 0 ? raw.length : nl
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '').trimEnd() === '---') {
      return { start: lineStart, bodyStart: nl < 0 ? raw.length : nl + 1 }
    }
    if (nl < 0) return undefined
    lineStart = nl + 1
  }
  return undefined
}

function parseFrontmatter(raw) {
  const clean = raw.replace(/^\uFEFF/, '')
  const firstNl = clean.indexOf('\n')
  if (firstNl < 0) return undefined
  if (clean.slice(0, firstNl).replace(/\r$/, '').trimEnd() !== '---') return undefined
  const start = firstNl + 1
  const closing = findClosingFrontmatter(clean, start)
  if (!closing) return undefined
  let parsed
  try {
    parsed = parse(clean.slice(start, closing.start))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed, body: clean.slice(closing.bodyStart) }
}

async function parseSkillFile(path, signal) {
  let raw
  try {
    raw = await readFile(path, { encoding: 'utf8', signal })
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw (signal?.reason ?? err)
    }
    return undefined
  }
  return parseFrontmatter(raw)
}

export class OfficialPonytailProvider {
  constructor(ctx, control) {
    this.ctx = ctx
    this.control = control
    this.name = 'ponytail-official'
    this.skillDir = join(pkgRoot, 'skills')
  }

  invalidate() {
    try {
      this.control.invalidate()
    } catch {
      // 容错：失效失败不阻断，宿主保留旧缓存到下次自然失效
    }
  }

  async list(options) {
    const signal = options?.signal
    signal?.throwIfAborted()
    const skillDir = this.skillDir
    let entries
    try {
      entries = await readdir(skillDir, { withFileTypes: true, signal })
    } catch (err) {
      const code = err?.code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        this.ctx.logger.warn(`[ponytail-official] skill 目录不存在: ${skillDir}`)
        return { candidates: [], complete: false }
      }
      throw err
    }
    const candidates = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted()
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.')) continue
      const skillPath = join(skillDir, entry.name, 'SKILL.md')
      const parsed = await parseSkillFile(skillPath, signal)
      if (!parsed) {
        this.ctx.logger.warn(`[ponytail-official] 跳过 ${entry.name}: 缺少或无效的 SKILL.md`)
        continue
      }
      const name = readString(parsed.data, 'name')
      const description = readString(parsed.data, 'description')
      if (!name || !description || !SKILL_NAME_RE.test(name)) {
        this.ctx.logger.warn(`[ponytail-official] 跳过 ${entry.name}: frontmatter 缺 name/description 或名称非法`)
        continue
      }
      const dir = dirname(skillPath)
      candidates.push({
        name,
        description,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'bundled',
        provider: this.name,
        resourceBase: { kind: 'directory', path: dir },
        path: skillPath,
        rank: SKILL_RANK,
        locator: { path: skillPath, directory: dir },
      })
    }
    return candidates
  }

  async get(candidate, options) {
    const signal = options?.signal
    signal?.throwIfAborted()
    const locator = typeof candidate.locator === 'object' && candidate.locator !== null
      ? candidate.locator
      : undefined
    const targetPath = locator?.path ?? candidate.path
    if (!targetPath) return undefined
    const parsed = await parseSkillFile(targetPath, signal)
    if (!parsed) return undefined
    const name = readString(parsed.data, 'name')
    if (!name || name !== candidate.name) return undefined
    const description = readString(parsed.data, 'description') ?? candidate.description
    const dir = dirname(targetPath)
    return {
      name,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      provider: this.name,
      resourceBase: { kind: 'directory', path: dir },
      path: targetPath,
      content: parsed.body.trim(),
    }
  }
}

export function apply(ctx) {
  logSteps(`apply start pid=${process.pid} version=${pkgVersion}`)
  try {
    appendFileSync(
      join(tmpdir(), 'ponytail-plugin-loaded.log'),
      `${new Date().toISOString()} pid=${process.pid} version=${pkgVersion}\n`,
      'utf8',
    )
  } catch {
    // 标记写不进去不影响主功能
  }

  const skills = ctx.skills
  skills.registerProvider((control) => new OfficialPonytailProvider(ctx, control))
  logSteps('provider registered')

  let rulesBody = ''
  try {
    rulesBody = readFileSync(join(pkgRoot, 'AGENTS.md'), 'utf8').replace(/^\uFEFF/, '').trim()
  } catch (err) {
    ctx.logger.warn(`[ponytail-official] AGENTS.md 读取失败（规则注入为空）: ${err?.message ?? err}`)
  }

  const systemPrompt = ctx.systemPrompt
  systemPrompt.section({
    name: 'ponytail-official',
    order: 50,
    text: () => rulesBody + updateNotice,
  })
  logSteps(`prompt section registered (rules ${rulesBody.length} chars)`)

  void checkUpstream(ctx).catch((err) => {
    ctx.logger.debug(`[ponytail-official] 上游版本检查失败（离线或限流）：${err?.message ?? err}`)
  })

  ctx.logger.info(`[ponytail-official] 已激活 — 官方规则注入 + 6 skills（skillDir: ${join(pkgRoot, 'skills')}）`)

  // 任务完成 / 失败通知：只在你不在 DSH 窗口时弹（前台判断在 notify.ps1 里做）。
  //
  // 事件通道说明（cordis 的 _resolve 会 shift 掉 thisArg 与事件名，监听器实际只收到
  // 一个 payload，所以这里一律用 args.find 找带特征字段的对象，不依赖位置）：
  //   1. session/event —— turn/end 是 session.append 记录的会话事件，走这条广播
  //   2. turn/end —— 部分版本会直接通过 agent dispatch 发同名 cordis 事件
  //   3. agent/status —— running → idle 作为兜底
  const anyCtx = ctx
  const timers = []
  let lastTurnNotifyAt = 0
  let lastAgentStatus = null
  const watchedAgents = new WeakSet()

  const logEvent = (tag) => {
    try {
      appendFileSync(join(tmpdir(), 'ponytail-events.log'), `${new Date().toISOString()} ${tag}\n`, 'utf8')
    } catch {
      // 日志写不进去不影响功能
    }
  }

  const notifyTurnDone = () => {
    const now = Date.now()
    if (now - lastTurnNotifyAt < 5000) return
    lastTurnNotifyAt = now
    logEvent('=> notify turn done')
    notify('DSH 任务完成', '这一轮已经跑完，可以回来看了')
  }

  anyCtx.on('session/event', (...args) => {
    const event = args.find((a) => a && typeof a === 'object' && typeof a.type === 'string')
    if (!event) return
    if (event.type === 'turn/end') {
      logEvent('session/event turn/end')
      notifyTurnDone()
    } else if (event.type === 'turn/start') {
      logEvent('session/event turn/start')
    }
  })

  anyCtx.on('turn/end', () => {
    logEvent('cordis turn/end')
    notifyTurnDone()
  })

  anyCtx.on('agent/status', (...args) => {
    const payload = args.find((a) => a && typeof a.status === 'string')
    if (!payload) {
      logEvent('agent/status no-payload')
      return
    }
    logEvent(`agent/status ${payload.status}`)
    const prev = lastAgentStatus
    lastAgentStatus = payload.status
    if (prev === 'running' && payload.status === 'idle') notifyTurnDone()
  })

  anyCtx.on('agent/created', (...args) => {
    const payload = args.find((a) => a && typeof a === 'object')
    const agent = payload?.agent
    logEvent(`agent/created hasAgent=${Boolean(agent)}`)
    if (!agent || watchedAgents.has(agent)) return
    watchedAgents.add(agent)
    let last = agent.status
    const timer = setInterval(() => {
      let status
      try {
        status = agent.status
      } catch {
        return
      }
      if (last === 'running' && status === 'idle') {
        logEvent('agent.status poll running->idle')
        notifyTurnDone()
      }
      last = status
    }, 1000)
    timers.push(timer)
    if (typeof timer.unref === 'function') timer.unref()
  })

  anyCtx.on('agent/error', (...args) => {
    const payload = args.find((a) => a && typeof a === 'object')
    const detail = payload?.error?.message ?? payload?.message ?? ''
    logEvent('agent/error')
    notify('DSH 任务出错', detail ? String(detail).slice(0, 120) : '这一轮出错了，回来看看')
  })

  logSteps('event listeners registered')
  logSteps(`powershell path = ${resolvePowerShell()}`)

  ctx.effect(() => () => {
    for (const timer of timers) {
      try { clearInterval(timer) } catch { /* 已失效 */ }
    }
    ctx.logger.info('[ponytail-official] 已卸载 — provider 与 prompt 段已移除')
  })

  logSteps('apply done')
}

export default { name, inject, apply }
