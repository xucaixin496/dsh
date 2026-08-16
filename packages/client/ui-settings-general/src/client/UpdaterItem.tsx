/** General-settings item: check and apply git updates for the desktop fork. */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './UpdaterItem.module.css'

interface CheckResult {
  ok?: boolean
  available?: boolean
  count?: number
  local?: string
  remote?: string
  repo?: string
  error?: string
}

interface ApplyResult {
  ok?: boolean
  error?: string
}

/** Full component props: the standard settings-locale seat. */
export type UpdaterItemProps = PropsLocale<'settings'>

/**
 * The updater item: shows the configured repository, a check button, and an
 * apply button that only lights after a check found new commits. The host
 * routes run git/pnpm; the app must be restarted after a successful apply.
 * @param props - the settings locale seat.
 * @returns the updater row.
 */
export function UpdaterItem({ t }: UpdaterItemProps) {
  const [status, setStatus] = useState('')
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [repo, setRepo] = useState('')

  const check = async (): Promise<void> => {
    setBusy(true)
    setAvailable(false)
    setStatus(t('updater.checking'))
    try {
      const response = (await (await fetch('/api/updater/check', { method: 'POST' })).json()) as CheckResult
      if (response.repo !== undefined) setRepo(response.repo)
      if (response.ok !== true) {
        setStatus(t('updater.failed', { reason: response.error ?? 'unknown' }))
        return
      }
      setAvailable(response.available === true)
      setStatus(response.available === true
        ? t('updater.available', { count: response.count ?? 0, local: response.local ?? '', remote: response.remote ?? '' })
        : t('updater.latest', { hash: response.local ?? '' }))
    } catch (error) {
      setStatus(t('updater.failed', { reason: String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setAvailable(false)
    setStatus(t('updater.applying'))
    try {
      const response = (await (await fetch('/api/updater/apply', { method: 'POST' })).json()) as ApplyResult
      setStatus(response.ok === true ? t('updater.applyDone') : t('updater.failed', { reason: response.error ?? 'unknown' }))
    } catch (error) {
      setStatus(t('updater.failed', { reason: String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.card}>
      <div className={css.row}>
        <span className={css.label}>{t('updater.repo')}</span>
        <code className={css.repo}>{repo === '' ? t('updater.unconfigured') : repo}</code>
      </div>
      <div className={css.row}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void check() }}>
          {t('updater.check')}
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !available} onClick={() => { void apply() }}>
          {t('updater.update')}
        </Button>
      </div>
      {status !== '' && (
        <div className={css.status} role="status">{status}</div>
      )}
    </div>
  )
}
