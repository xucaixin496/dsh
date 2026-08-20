/**
 * Plugin-store tab: browse and install community DSH plugins from the desktop
 * deployment's catalog. The catalog arrives as one cached snapshot from the
 * host (npm `dsh-plugin` keyword plus the GitHub topic), so search filters it
 * locally — instant on every keystroke, with no per-key request or rate-limit
 * pressure. Installing runs the same `dsh plugin` flow the CLI documents and
 * takes effect after the app restarts.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Button, IconRefreshOutline14, IconSearchOutline16, Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './StoreTab.module.css'

/** One catalog entry (wire shape mirrored from the host route). */
export interface StorePlugin {
  name: string
  description: string
  version?: string
  source: 'npm' | 'github'
  spec: string
  keywords?: string[]
  stars?: number
  homepage?: string
}

interface StoreListResult {
  ok?: boolean
  plugins?: StorePlugin[]
  installed?: string[]
  fetchedAt?: string
  error?: string
}

interface StoreInstallResult {
  ok?: boolean
  name?: string
  error?: string
}

/** Parse a store response, surfacing non-JSON bodies as readable errors. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (!response.ok) {
      throw new Error(typeof parsed.error === 'string' ? parsed.error : `HTTP ${String(response.status)}`)
    }
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) {
      const message = text.trim().slice(0, 200)
      throw new Error(message === '' ? `HTTP ${String(response.status)}` : message)
    }
    throw error
  }
}

/** Human-readable failure text without the JS "Error:" prefix. */
function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/** Full component props: the standard plugins-locale seat. */
export type StoreTabProps = PropsLocale<'settings.plugins'>

/** How many catalog rows render before the "show more" control. */
const PAGE_SIZE = 50

/** Match one query against everything a plugin's card could be searched by. */
function matchesQuery(plugin: StorePlugin, query: string): boolean {
  if (query === '') return true
  return [
    plugin.name,
    plugin.description,
    plugin.source,
    ...(plugin.keywords ?? []),
  ].some(field => field.toLowerCase().includes(query))
}

/** True when the installed manifest names this plugin's package. */
function isInstalled(plugin: StorePlugin, installed: ReadonlySet<string>): boolean {
  if (installed.has(plugin.name) || installed.has(plugin.spec)) return true
  // A git-hosted entry installs under the package name its manifest declares,
  // which is almost always the repository basename.
  return plugin.source === 'github'
    && installed.has(plugin.name.slice(plugin.name.indexOf('/') + 1))
}

/**
 * Render the plugin store: a search box over the host's cached catalog, a
 * refresh control, and per-plugin install buttons that report restart-once
 * semantics after a successful install.
 * @param props - the plugins locale seat.
 * @returns the store surface.
 */
export function StoreTab({ t }: StoreTabProps) {
  const [plugins, setPlugins] = useState<StorePlugin[] | null>(null)
  const [installed, setInstalled] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = async (force = false): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await readJson(await fetch(`/api/store/list${force ? '?force=1' : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: force ? JSON.stringify({ force: true }) : '{}',
      })) as StoreListResult
      if (response.ok !== true) {
        setError(t('storeFailed', { reason: response.error ?? 'unknown' }))
        return
      }
      setPlugins(response.plugins ?? [])
      setInstalled(new Set(response.installed ?? []))
      setFetchedAt(response.fetchedAt ?? '')
    } catch (reason) {
      setError(t('storeFailed', { reason: errorText(reason) }))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void load() }, [])

  const normalized = query.trim().toLowerCase()
  const matches = useMemo(
    () => (plugins ?? []).filter(plugin => matchesQuery(plugin, normalized)),
    [plugins, normalized],
  )
  useEffect(() => { setVisible(PAGE_SIZE) }, [normalized])

  const install = async (plugin: StorePlugin): Promise<void> => {
    setInstalling(plugin.spec)
    setError('')
    setNotice('')
    try {
      const response = await readJson(await fetch('/api/store/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec: plugin.spec }),
      })) as StoreInstallResult
      if (response.ok !== true) {
        setError(t('storeFailed', { reason: response.error ?? 'unknown' }))
        return
      }
      const name = response.name ?? plugin.name
      setInstalled(previous => new Set([...previous, name]))
      setNotice(t('storeInstalledNow', { name }))
    } catch (reason) {
      setError(t('storeFailed', { reason: errorText(reason) }))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className={css.store}>
      <div className={css.toolbar}>
        <div className={css.search}>
          <Input
            icon={<IconSearchOutline16 />}
            placeholder={t('storeSearchPlaceholder')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutline14 />}
          disabled={busy}
          onClick={() => { void load(true) }}
        >
          {t('storeRefresh')}
        </Button>
      </div>
      {plugins !== null && (
        <p className={css.meta}>
          {t('storeCount', { count: matches.length })}
          {fetchedAt !== '' ? ` · ${t('storeUpdatedAt', { time: new Date(fetchedAt).toLocaleString() })}` : ''}
        </p>
      )}
      {error !== '' && <p className={css.error} role="status">{error}</p>}
      {notice !== '' && <p className={css.notice} role="status">{notice}</p>}
      {plugins === null
        ? <p className={css.empty}>{t(busy ? 'storeLoading' : 'storeUnavailable')}</p>
        : matches.length === 0
          ? <p className={css.empty}>{t('storeEmpty')}</p>
          : (
            <ul className={css.list}>
              {matches.slice(0, visible).map((plugin) => {
                const installedHere = isInstalled(plugin, installed)
                return (
                  <li key={plugin.spec} className={css.item}>
                    <div className={css.itemText}>
                      <span className={css.itemName}>{plugin.name}</span>
                      <span className={css.itemDescription}>
                        {plugin.description === '' ? t('storeNoDescription') : plugin.description}
                      </span>
                    </div>
                    <div className={css.itemMeta}>
                      <span className={css.source}>
                        {plugin.source === 'npm' ? t('storeSourceNpm') : t('storeSourceGitHub')}
                      </span>
                      {plugin.stars !== undefined && <span className={css.stars}>★ {plugin.stars}</span>}
                    </div>
                    <div className={css.itemAction}>
                      {installedHere
                        ? <span className={css.installedBadge}>{t('storeInstalled')}</span>
                        : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={installing !== null}
                            onClick={() => { void install(plugin) }}
                          >
                            {installing === plugin.spec ? t('storeInstalling') : t('storeInstall')}
                          </Button>
                        )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
      {plugins !== null && matches.length > visible && (
        <Button variant="ghost" size="sm" onClick={() => { setVisible(current => current + PAGE_SIZE) }}>
          {t('storeShowMore', { count: matches.length - visible })}
        </Button>
      )}
      <p className={css.note}>{t('storeSecurityNote')}</p>
    </div>
  )
}
