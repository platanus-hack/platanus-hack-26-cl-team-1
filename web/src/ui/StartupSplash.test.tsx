import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StartupSplash } from './StartupSplash'
import logo from './logoGeometry.generated.json'

const render = (ready = false, failed = false) => renderToStaticMarkup(
  <StartupSplash ready={ready} failed={failed} message="Cargando terreno…">
    <main>Contenido de la aplicación</main>
  </StartupSplash>,
)

describe('StartupSplash', () => {
  it('uses the canonical flame and firebreak geometry in an animated SVG mask', () => {
    const html = render()
    expect(html).toContain(`d="${logo.flamePath}"`)
    expect(html).toContain(`d="${logo.cutPath}"`)
    expect(html).toContain('class="splash-cut"')
    expect(html).toContain('pathLength="1"')
    expect(html).toContain('aria-hidden="true" focusable="false"')
  })

  it('keeps the actual app mounted but inert while announcing real loading status', () => {
    const html = render()
    expect(html).toContain('class="startup-content" inert="" aria-hidden="true"')
    expect(html).toContain('<main>Contenido de la aplicación</main>')
    expect(html).toContain('<p role="status">Cargando terreno…</p>')
    expect(html).toContain('Omitir animación')
  })

  it('keeps a fast-loading app mounted while the one-shot intro finishes', () => {
    expect(render(true)).toContain('class="startup-splash"')
    expect(render(true)).not.toContain('is-leaving')
  })

  it('never obscures an error or leaves the app inert when loading fails', () => {
    const html = render(false, true)
    expect(html).not.toContain('<section')
    expect(html).not.toContain('inert=""')
    expect(html).not.toContain('aria-hidden="true"')
    expect(html).toContain('<main>Contenido de la aplicación</main>')
  })

  it('assigns unique mask IDs so multiple logo instances cannot interfere', () => {
    const html = renderToStaticMarkup(
      <>
        <StartupSplash ready={false} failed={false} message="Cargando…">Uno</StartupSplash>
        <StartupSplash ready={false} failed={false} message="Cargando…">Dos</StartupSplash>
      </>,
    )
    const ids = Array.from(html.matchAll(/<mask id="([^"]+)"/g), (match) => match[1])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(html).toContain(`mask="url(#${id})"`)
  })
})
