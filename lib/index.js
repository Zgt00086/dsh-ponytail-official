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
import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const name = 'ponytail-official'
export const inject = ['skills', 'systemPrompt']

const SKILL_RANK = 550
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
  const skills = ctx.skills
  skills.registerProvider((control) => new OfficialPonytailProvider(ctx, control))

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
    text: () => rulesBody,
  })

  ctx.logger.info(`[ponytail-official] 已激活 — 官方规则注入 + 6 skills（skillDir: ${join(pkgRoot, 'skills')}）`)

  ctx.effect(() => () => {
    ctx.logger.info('[ponytail-official] 已卸载 — provider 与 prompt 段已移除')
  })
}

export default { name, inject, apply }
