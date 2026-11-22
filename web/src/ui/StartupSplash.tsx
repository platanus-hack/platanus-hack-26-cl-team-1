import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import logo from './logoGeometry.generated.json'
import './StartupSplash.css'

/** A one-shot brand reveal; data loading and the first simulation continue underneath. */
export function StartupSplash({
  ready,
  failed,
  message,
  children,
}: {
  ready: boolean
  failed: boolean
  message: string
  children: ReactNode
}) {
  const maskId = useId()
  const [introComplete, setIntroComplete] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      setReducedMotion(preference.matches)
      if (preference.matches) setIntroComplete(true)
    }
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  // Never leave errors behind an overlay, or await an animation disabled by reduced motion.
  useEffect(() => {
    if (failed || (ready && reducedMotion)) setDismissed(true)
  }, [failed, ready, reducedMotion])

  const visible = !dismissed && !failed
  const leaving = ready && introComplete

  return (
    <>
      <div className="startup-content" inert={visible} aria-hidden={visible || undefined}>
        {children}
      </div>
      {visible && (
        <section
          className={`startup-splash${leaving ? ' is-leaving' : ''}`}
          aria-label="Cargando Cortafuego"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && leaving) setDismissed(true)
          }}
        >
          <div className="splash-identity">
            <svg
              className={`splash-mark${introComplete ? ' is-complete' : ''}`}
              viewBox={logo.viewBox}
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">
                  <rect width="1000" height="1000" fill="white" />
                  <path
                    className="splash-cut"
                    d={logo.cutPath}
                    stroke="black"
                    strokeWidth={logo.cutWidth}
                    pathLength="1"
                    onAnimationEnd={() => setIntroComplete(true)}
                  />
                </mask>
              </defs>
              <g className="splash-flame">
                <g transform={logo.symbolTransform}>
                  <path d={logo.flamePath} fill={logo.color} mask={`url(#${maskId})`} />
                  <path
                    className="splash-cut-glint"
                    d={logo.cutPath}
                    pathLength="1"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray="0.06 0.94"
                  />
                </g>
              </g>
            </svg>
            <h1>Cortafuego</h1>
            <div className="splash-status">
              <p role="status">{message}</p>
              <span className="splash-loading-line" aria-hidden="true" />
            </div>
          </div>
          {!introComplete && (
            <button className="splash-skip" type="button" onClick={() => setIntroComplete(true)}>
              Omitir animación
            </button>
          )}
          <p className="splash-caption">Simulación para la prevención</p>
        </section>
      )}
    </>
  )
}
