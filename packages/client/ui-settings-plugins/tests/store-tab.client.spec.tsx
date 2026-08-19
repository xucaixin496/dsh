// @vitest-environment jsdom
/**
 * The store tab: loads the host catalog once, filters it locally on every
 * keystroke, and installs a catalog entry through the store route.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StoreTab } from '../src/client/StoreTab.tsx'
import type { StoreTabProps } from '../src/client/StoreTab.tsx'
import type { StorePlugin } from '../src/client/StoreTab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function t(key: keyof typeof en, params?: Record<string, string | number>): string {
  let text = en[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replace(`{${name}}`, String(value))
    }
  }
  return text
}

const catalog: StorePlugin[] = [
  {
    name: 'dshmarket',
    description: 'Visual plugin market inside DeepSeek Harness',
    version: '1.9.0',
    source: 'npm',
    spec: 'dshmarket',
    keywords: ['marketplace', 'plugin-manager'],
  },
  {
    name: 'some-org/dsh-tui',
    description: 'Terminal UI for DeepSeek Harness',
    source: 'github',
    spec: 'github:some-org/dsh-tui',
    stars: 42,
  },
]

function fetchJsonOk(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}

function renderStore() {
  const props = { t } as unknown as StoreTabProps
  render(<StoreTab {...props} />)
}

describe('StoreTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => fetchJsonOk({
      ok: true,
      fetchedAt: '2026-08-16T00:00:00.000Z',
      plugins: catalog,
      installed: ['dshmarket'],
    })))
  })

  it('loads the catalog and renders one row per plugin', async () => {
    renderStore()

    expect(await screen.findByText('dshmarket')).toBeTruthy()
    expect(screen.getByText('some-org/dsh-tui')).toBeTruthy()
    expect(screen.getByText(/2 plugins/)).toBeTruthy()
  })

  it('filters locally as the query changes', async () => {
    renderStore()
    await screen.findByText('dshmarket')

    fireEvent.change(screen.getByPlaceholderText(en.storeSearchPlaceholder), {
      target: { value: 'terminal' },
    })

    expect(screen.queryByText('dshmarket')).toBeNull()
    expect(screen.getByText('some-org/dsh-tui')).toBeTruthy()
    expect(screen.getByText(/1 plugins/)).toBeTruthy()
  })

  it('marks catalog entries already installed in the profile', async () => {
    renderStore()

    expect(await screen.findByText(en.storeInstalled)).toBeTruthy()
    expect(screen.getByText('dshmarket').closest('li')?.textContent).toContain(en.storeInstalled)
    expect(screen.getByText('some-org/dsh-tui').closest('li')?.textContent).toContain(en.storeInstall)
  })

  it('matches a git-hosted entry by its repository basename', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fetchJsonOk({
      ok: true,
      fetchedAt: '2026-08-16T00:00:00.000Z',
      plugins: catalog,
      installed: ['dshmarket', 'dsh-tui'],
    })))
    renderStore()

    expect(await screen.findByText('some-org/dsh-tui')).toBeTruthy()
    expect(screen.getByText('some-org/dsh-tui').closest('li')?.textContent).toContain(en.storeInstalled)
  })

  it('installs a catalog entry and reports the restart requirement', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/store/install')) {
        return fetchJsonOk({ ok: true, name: 'some-org/dsh-tui', restart: true })
      }
      return fetchJsonOk({
        ok: true,
        fetchedAt: '2026-08-16T00:00:00.000Z',
        plugins: catalog,
        installed: ['dshmarket'],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderStore()
    await screen.findByText('some-org/dsh-tui')

    fireEvent.click(screen.getAllByRole('button', { name: en.storeInstall })[0]!)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/store/install',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText(en.storeInstalledNow.replace('{name}', 'some-org/dsh-tui'))).toBeTruthy()
    expect(screen.getByText('some-org/dsh-tui').closest('li')?.textContent).toContain(en.storeInstalled)
  })

  it('surfaces a failed load instead of a row list', async () => {
    vi.stubGlobal('fetch', vi.fn(() => fetchJsonOk({ ok: false, error: 'offline' })))
    renderStore()

    expect(await screen.findByText(en.storeFailed.replace('{reason}', 'offline'))).toBeTruthy()
  })

  it('shows a plain-text server answer instead of a JSON parse crash', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      'content type must be application/json',
      { status: 415, headers: { 'content-type': 'text/plain' } },
    ))))
    renderStore()

    expect(await screen.findByText(
      en.storeFailed.replace('{reason}', 'content type must be application/json'),
    )).toBeTruthy()
  })
})
