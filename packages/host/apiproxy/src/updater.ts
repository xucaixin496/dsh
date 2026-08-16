/**
 * Git-based self-update routes for the desktop fork: check origin for new
 * commits and apply them (pull + install + build). Registered when the fork
 * checkout is present (the desktop deployment marker); a missing settings
 * file falls back to the fork's default repository so a fresh install works
 * before the user ever opens the settings dialog. Stock installs, which have
 * no fork checkout, are unaffected. All commands run inside the fork
 * repository with the D-drive Node toolchain. The client restarts the app
 * after a successful apply.
 * @module dsh-apiproxy/updater
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'

const execFileAsync = promisify(execFile)

const SETTINGS_PATH = 'D:\\DeepSeekHarness\\settings.json'
/** Deployment root derived from the settings file location (installer-relative). */
const ROOT = dirname(SETTINGS_PATH)
const REPO_DIR = join(ROOT, 'fork')
/** The fork's built CLI entry — presence marks this as a desktop deployment. */
const CLI_JS = join(REPO_DIR, 'apps', 'cli', 'lib', 'bin.js')
const NODE_DIR = join(ROOT, 'node', 'node-v24.19.0-win-x64')
const STORE_DIR = join(ROOT, 'research', '.pnpm-store')
/** Update target for installs that never configured a repository. */
const DEFAULT_REPO_URL = 'https://github.com/xucaixin496/dsh.git'

interface UpdaterSettings {
  RepoUrl?: string
}

function readSettings(): UpdaterSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as UpdaterSettings
  } catch {
    return {}
  }
}

async function run(file: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(file, [...args], {
      cwd: REPO_DIR,
      env: { ...process.env, ...(env ?? {}) },
      timeout: 900_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    return `${stdout}\n${stderr}`.trim()
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    const detail = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim()
    throw new Error(detail === '' ? (e.message ?? 'command failed') : detail)
  }
}

function pnpmEnv(): Record<string, string> {
  return {
    CI: 'true',
    npm_config_confirm_modules_purge: 'false',
    NPM_CONFIG_CACHE: join(ROOT, 'cache', 'npm'),
    DSH_HOME: join(ROOT, 'home'),
    DSH_AGENTS_HOME: join(ROOT, 'agents'),
    TEMP: join(ROOT, 'tmp'),
    TMP: join(ROOT, 'tmp'),
    PATH: `${NODE_DIR};${process.env.PATH ?? ''}`,
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Loopback + same-origin trust fence (mirrors dsh-files upload routes). */
function trusted(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function checkUpdate(): Promise<Record<string, unknown>> {
  const settings = readSettings()
  const configured = (settings.RepoUrl ?? '').trim()
  // A settings file that exists but leaves the field blank is a user's
  // explicit "no remote" choice; a missing file is an unconfigured install
  // that should track the fork's own repository by default.
  const url = configured !== '' ? configured : existsSync(SETTINGS_PATH) ? '' : DEFAULT_REPO_URL
  if (url === '') return { ok: false, error: '未配置更新仓库' }
  const remote = (await run('git', ['remote', 'get-url', 'origin'])).trim()
  if (remote === '' || remote.startsWith('fatal')) {
    await run('git', ['remote', 'add', 'origin', url])
  } else if (remote !== url) {
    await run('git', ['remote', 'set-url', 'origin', url])
  }
  await run('git', ['fetch', '--quiet', 'origin'])
  let branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (branch === '' || branch.startsWith('fatal')) branch = 'main'
  const local = (await run('git', ['rev-parse', '--short', 'HEAD'])).trim()
  const remoteHead = (await run('git', ['rev-parse', '--short', `origin/${branch}`])).trim()
  const countText = (await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`])).trim()
  const count = Number.parseInt(countText, 10) || 0
  return { ok: true, available: count > 0, count, local, remote: remoteHead, repo: url }
}

async function applyUpdate(): Promise<Record<string, unknown>> {
  let branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (branch === '' || branch.startsWith('fatal')) branch = 'main'
  await run('git', ['pull', '--ff-only', 'origin', branch])
  const pnpm = `${NODE_DIR}\\node_modules\\pnpm\\bin\\pnpm.cjs`
  await run(pnpm, ['install', '--store-dir', STORE_DIR, '--registry', 'https://registry.npmmirror.com'], pnpmEnv())
  await run(pnpm, ['run', 'build'], pnpmEnv())
  return { ok: true }
}

/** Route shape accepted by the webServer seam (structural, no package import). */
export interface UpdaterRouteSpec {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
}

/** Register the updater routes; a no-op when the fork checkout is absent. */
export function registerUpdaterRoutes(webServer: { register(route: UpdaterRouteSpec): unknown }): void {
  if (!existsSync(SETTINGS_PATH) && !existsSync(CLI_JS)) return
  webServer.register({
    kind: 'prefix',
    path: '/api/updater',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'POST' || !trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        if (url.pathname.endsWith('/check')) {
          sendJson(res, 200, await checkUpdate())
          return
        }
        if (url.pathname.endsWith('/apply')) {
          sendJson(res, 200, await applyUpdate())
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
