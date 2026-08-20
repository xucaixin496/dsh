/**
 * Plugin-store routes for the desktop fork: a catalog of community DSH
 * plugins discovered from the real publishing surfaces (the npm registry's
 * `dsh-plugin`/`deepseek-harness` keywords, the GitHub `dsh-plugin` topic,
 * and the community's curated awesome-dsh-plugin list), cached under the
 * deployment root so the browser never hammers any of them, plus an install
 * route that runs the CLI's own `dsh plugin --profile web add <spec>` flow.
 *
 * The catalog is the store's single source of truth: search happens entirely
 * in the browser against the cached list (instant, no extra requests), and an
 * install spec is accepted only when it names a catalog entry, so the route
 * never becomes a generic pnpm-execution hole. Registered only when the
 * desktop deployment's settings file exists, so stock installs are
 * unaffected. All reads and writes stay under the deployment root.
 * @module dsh-apiproxy/plugin-store
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'

const execFileAsync = promisify(execFile)

const SETTINGS_PATH = 'D:\\DeepSeekHarness\\settings.json'
/** Deployment root derived from the settings file location (installer-relative). */
const ROOT = dirname(SETTINGS_PATH)
const NODE_DIR = join(ROOT, 'node', 'node-v24.19.0-win-x64')
/** The fork's built CLI entry, the same file the desktop launcher boots. */
const CLI_JS = join(ROOT, 'fork', 'apps', 'cli', 'lib', 'bin.js')
const PROFILE_DIR = join(ROOT, 'home', 'profiles', 'web')
const CACHE_DIR = join(ROOT, 'cache', 'plugin-store')
const CATALOG_PATH = join(CACHE_DIR, 'catalog.json')

/** How long a fetched catalog stays fresh before the next open refetches it. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000
/** npm registry search page size (the registry caps it at 250). */
const NPM_PAGE_SIZE = 250
/** Upper bound on catalog entries pulled from each npm keyword query. */
const NPM_MAX_ITEMS = 1000
/** npm keyword queries whose results are all installable-by-name candidates. */
const NPM_QUERIES = ['keywords:dsh-plugin', 'keywords:deepseek-harness'] as const
/** GitHub topic pages (updated-desc), each up to 100 repositories. */
const GITHUB_PAGES = 2
/** The community's curated list, served as raw text by the GitHub contents API. */
const CURATED_README_URL = 'https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/contents/README.md'
/** Per-request network timeout; a slow registry must not wedge the store. */
const FETCH_TIMEOUT_MS = 20_000
/** pnpm add can take minutes (dependency resolution plus optional builds). */
const INSTALL_TIMEOUT_MS = 900_000

/** One entry in the store catalog. */
export interface StorePlugin {
  /** Display name: the npm package name, or `owner/repo` for GitHub-only hosts. */
  name: string
  /** One-line description from the source. */
  description: string
  /** Latest version when the entry came from npm. */
  version?: string
  /** Where the entry was discovered. */
  source: 'npm' | 'github'
  /** Exact spec handed to `dsh plugin add` (npm name or `github:owner/repo`). */
  spec: string
  /** npm keywords, useful for search. */
  keywords?: string[]
  /** Star count when the entry came from GitHub. */
  stars?: number
  /** Repository home page when known. */
  homepage?: string
}

interface CachedCatalog {
  fetchedAt: string
  plugins: StorePlugin[]
}

/** Route shape accepted by the webServer seam (structural, no package import). */
export interface PluginStoreRouteSpec {
  kind: 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
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

/** One npm registry search hit (subset of the registry's response shape). */
interface NpmHit {
  package?: {
    name?: unknown
    version?: unknown
    description?: unknown
    keywords?: unknown
    links?: { repository?: unknown; homepage?: unknown }
  }
}

/** One GitHub repository search hit (subset of the API's response shape). */
interface GithubHit {
  full_name?: unknown
  name?: unknown
  description?: unknown
  stargazers_count?: unknown
  html_url?: unknown
  pushed_at?: unknown
}

/** One curated-list entry: the repo plus the category section it sits in. */
interface CuratedEntry {
  fullName: string
  description: string
  category: string
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, { headers, signal })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} from ${url}`)
  return (await response.json()) as unknown
}

/** Pull every npm package carrying a harness keyword, paged, deduped by name. */
async function fetchNpmPlugins(signal: AbortSignal): Promise<StorePlugin[]> {
  const plugins: StorePlugin[] = []
  const seen = new Set<string>()
  for (const query of NPM_QUERIES) {
    const total = await (async (): Promise<number> => {
      const body = await fetchJson(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${String(NPM_PAGE_SIZE)}&from=0`,
        { accept: 'application/json' },
        signal,
      ) as { total?: unknown }
      return typeof body.total === 'number' ? body.total : 0
    })()
    const pages = Math.min(total, NPM_MAX_ITEMS) > 0
      ? Math.ceil(Math.min(total, NPM_MAX_ITEMS) / NPM_PAGE_SIZE)
      : 0
    for (let page = 0; page < pages; page++) {
      const body = await fetchJson(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}`
        + `&size=${String(NPM_PAGE_SIZE)}&from=${String(page * NPM_PAGE_SIZE)}`,
        { accept: 'application/json' },
        signal,
      ) as { objects?: NpmHit[] }
      for (const hit of body.objects ?? []) {
        const pkg = hit.package
        if (typeof pkg?.name !== 'string' || seen.has(pkg.name)) continue
        seen.add(pkg.name)
        plugins.push({
          name: pkg.name,
          description: typeof pkg.description === 'string' ? pkg.description : '',
          ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
          source: 'npm',
          spec: pkg.name,
          ...(Array.isArray(pkg.keywords)
            ? { keywords: pkg.keywords.filter((value): value is string => typeof value === 'string') }
            : {}),
          ...(typeof pkg.links?.homepage === 'string'
            ? { homepage: pkg.links.homepage }
            : typeof pkg.links?.repository === 'string'
              ? { homepage: pkg.links.repository }
              : {}),
        })
      }
    }
  }
  return plugins
}

/** Parse the awesome-dsh-plugin README into categorized repo entries. */
async function fetchCuratedPlugins(signal: AbortSignal): Promise<CuratedEntry[]> {
  const response = await fetch(CURATED_README_URL, {
    signal,
    headers: { accept: 'application/vnd.github.raw', 'user-agent': 'dsh-desktop-store' },
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)} from ${CURATED_README_URL}`)
  const markdown = await response.text()
  const entries: CuratedEntry[] = []
  const seen = new Set<string>()
  let category = ''
  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = /^###\s+(.+)$/.exec(rawLine)
    if (heading !== null) {
      category = (heading[1] ?? '').trim()
      continue
    }
    const entryLinePattern = new RegExp(
      '^-\\s+\\[([A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+)\\]\\(https:\\/\\/github\\.com\\/'
        + '[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+\\)\\s*-\\s*(.+)$',
    )
    const entry = entryLinePattern.exec(rawLine)
    if (entry === null) continue
    const fullName = entry[1] ?? ''
    if (seen.has(fullName)) continue
    seen.add(fullName)
    entries.push({ fullName, description: (entry[2] ?? '').trim(), category })
  }
  return entries
}

/** Turn one curated repo entry into a GitHub-spec catalog entry. */
function curatedToPlugin(entry: CuratedEntry): StorePlugin {
  return {
    name: entry.fullName,
    description: entry.description,
    source: 'github',
    spec: `github:${entry.fullName}`,
    ...(entry.category === '' ? {} : { keywords: [entry.category] }),
  }
}

/** True when a topic-tagged repository is plausibly a plugin, not a hub or the core repo. */
function isPluginRepo(hit: GithubHit): boolean {
  if (typeof hit.full_name !== 'string' || typeof hit.name !== 'string') return false
  if (hit.full_name === 'deepseek-ai/deepseek-harness') return false
  const name = hit.name
  // Directories and hub repos tag themselves too; their names carry the tell.
  if (/^awesome[_-]/i.test(name)) return false
  // The community convention is `dsh-*` (or an explicit *plugin* name).
  return /^dsh/i.test(name) || /dsh-plugin/i.test(name) || /plugin/i.test(name)
}

/** Pull the freshest GitHub `dsh-plugin`-topic repositories. */
async function fetchGithubPlugins(signal: AbortSignal): Promise<StorePlugin[]> {
  const plugins: StorePlugin[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= GITHUB_PAGES; page++) {
    const body = await fetchJson(
      'https://api.github.com/search/repositories?q=topic:dsh-plugin&sort=updated'
      + `&order=desc&per_page=100&page=${String(page)}`,
      { accept: 'application/vnd.github+json', 'user-agent': 'dsh-desktop-store' },
      signal,
    ) as { items?: GithubHit[] }
    for (const hit of body.items ?? []) {
      if (typeof hit.full_name !== 'string' || seen.has(hit.full_name)) continue
      if (!isPluginRepo(hit)) continue
      seen.add(hit.full_name)
      plugins.push({
        name: hit.full_name,
        description: typeof hit.description === 'string' ? hit.description : '',
        source: 'github',
        spec: `github:${hit.full_name}`,
        ...(typeof hit.stargazers_count === 'number' ? { stars: hit.stargazers_count } : {}),
        ...(typeof hit.html_url === 'string' ? { homepage: hit.html_url } : {}),
      })
    }
  }
  return plugins
}

/** Normalize a name for npm/GitHub dedupe (scope, case, underscores). */
function normalizedName(name: string): string {
  return name.replace(/^@[^/]+\//, '').toLowerCase().replace(/_/g, '-')
}

/** Merge all sources, preferring the npm entry when the same plugin ships there. */
function mergeCatalog(
  npm: readonly StorePlugin[],
  github: readonly StorePlugin[],
  curated: readonly CuratedEntry[],
): StorePlugin[] {
  const npmNames = new Set(npm.map(plugin => normalizedName(plugin.name)))
  const merged = [...npm]
  const seen = new Set(merged.map(plugin => plugin.spec))
  for (const source of [github, curated.map(curatedToPlugin)]) {
    for (const plugin of source) {
      if (npmNames.has(normalizedName(plugin.name)) || seen.has(plugin.spec)) continue
      merged.push(plugin)
      seen.add(plugin.spec)
    }
  }
  return merged
}

/** Read the last cached catalog, or nothing when the cache is absent or corrupt. */
function readCachedCatalog(): CachedCatalog | undefined {
  try {
    if (!existsSync(CATALOG_PATH)) return undefined
    const parsed = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Partial<CachedCatalog>
    if (typeof parsed.fetchedAt !== 'string' || !Array.isArray(parsed.plugins)) return undefined
    return { fetchedAt: parsed.fetchedAt, plugins: parsed.plugins as StorePlugin[] }
  } catch {
    return undefined
  }
}

function writeCachedCatalog(catalog: CachedCatalog): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(CATALOG_PATH, JSON.stringify(catalog), 'utf8')
  } catch {
    // A read-only deployment still gets a live catalog; the cache is best-effort.
  }
}

/**
 * Fetch all sources fresh and cache the merged result. Sources fail
 * independently: a rate-limited or unreachable publisher must not freeze the
 * rest of the catalog, so each fetch degrades to an empty contribution and
 * the merged result is only rejected when every source came back empty.
 */
async function refreshCatalog(): Promise<CachedCatalog> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * (NPM_MAX_ITEMS / NPM_PAGE_SIZE))
  try {
    const settle = async <T>(fetchFn: (signal: AbortSignal) => Promise<T[]>): Promise<T[]> => {
      try {
        return await fetchFn(controller.signal)
      } catch {
        return []
      }
    }
    const [npm, github, curated] = await Promise.all([
      settle(fetchNpmPlugins),
      settle(fetchGithubPlugins),
      settle(fetchCuratedPlugins),
    ])
    const plugins = mergeCatalog(npm, github, curated)
    if (plugins.length === 0) throw new Error('all plugin-store sources failed')
    const catalog: CachedCatalog = {
      fetchedAt: new Date().toISOString(),
      plugins,
    }
    writeCachedCatalog(catalog)
    return catalog
  } finally {
    clearTimeout(timer)
  }
}

/** Serve a catalog: the cache when fresh, a network refresh otherwise (stale-on-failure). */
async function loadCatalog(force: boolean): Promise<CachedCatalog> {
  const cached = readCachedCatalog()
  if (!force && cached !== undefined
    && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
    return cached
  }
  try {
    return await refreshCatalog()
  } catch (error) {
    if (cached !== undefined) return cached
    throw error
  }
}

/** Package names and bundle layers currently installed in the web profile. */
function readInstalled(): string[] {
  try {
    if (!existsSync(join(PROFILE_DIR, 'package.json'))) return []
    const manifest = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown } }
    }
    const names = new Set<string>()
    for (const name of Object.keys(manifest.dependencies ?? {})) names.add(name)
    if (Array.isArray(manifest.dsh?.profile?.bundles)) {
      for (const name of manifest.dsh.profile.bundles) {
        if (typeof name === 'string') names.add(name)
      }
    }
    return [...names]
  } catch {
    return []
  }
}

/** Validate a store install target against the current catalog and install it. */
async function installFromCatalog(spec: string): Promise<{ name: string; restart: boolean }> {
  const catalog = await loadCatalog(false)
  const plugin = catalog.plugins.find(entry => entry.spec === spec)
  if (plugin === undefined) {
    throw new Error('该插件不在商店目录中，请刷新后重试')
  }
  const nodeExe = join(NODE_DIR, 'node.exe')
  if (!existsSync(nodeExe)) throw new Error(`未找到 Node.js：${nodeExe}`)
  if (!existsSync(CLI_JS)) throw new Error(`未找到 DeepSeek Harness 程序：${CLI_JS}`)
  const env = {
    ...process.env,
    PATH: `${NODE_DIR};${process.env.PATH ?? ''}`,
    DSH_HOME: join(ROOT, 'home'),
    DSH_AGENTS_HOME: join(ROOT, 'agents'),
    NPM_CONFIG_CACHE: join(ROOT, 'cache', 'npm'),
    TEMP: join(ROOT, 'tmp'),
    TMP: join(ROOT, 'tmp'),
  }
  await execFileAsync(nodeExe, [CLI_JS, 'plugin', '--profile', 'web', 'add', plugin.spec], {
    cwd: ROOT,
    env,
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  })
  return { name: plugin.name, restart: true }
}

/** Register the store routes; a no-op when the fork checkout is absent. */
export function registerPluginStoreRoutes(webServer: { register(route: PluginStoreRouteSpec): unknown }): void {
  if (!existsSync(SETTINGS_PATH) && !existsSync(CLI_JS)) return
  webServer.register({
    kind: 'prefix',
    path: '/api/store',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'POST' || !trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        if (url.pathname.endsWith('/list')) {
          let body: unknown = {}
          try {
            body = JSON.parse(await readRequestBody(req)) as unknown
          } catch {
            body = {}
          }
          const force = (body as { force?: unknown }).force === true
          const catalog = await loadCatalog(force)
          sendJson(res, 200, {
            ok: true,
            fetchedAt: catalog.fetchedAt,
            plugins: catalog.plugins,
            installed: readInstalled(),
          })
          return
        }
        if (url.pathname.endsWith('/install')) {
          const body = JSON.parse(await readRequestBody(req)) as { spec?: unknown }
          if (typeof body.spec !== 'string' || body.spec === '') {
            sendJson(res, 400, { ok: false, error: '缺少安装目标' })
            return
          }
          sendJson(res, 200, { ok: true, ...await installFromCatalog(body.spec) })
          return
        }
        sendJson(res, 404, { error: 'not found' })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}

/** Buffer a small JSON request body (store calls carry at most a force flag). */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}
