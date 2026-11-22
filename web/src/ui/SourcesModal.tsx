import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { Dataset } from '../data/load'
import { DEFAULT_EVAC_PARAMS } from '../engine/evac'

export function SourcesModal({ data, onClose }: { data: Dataset; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  // Turns every URL in a citation into a link (trailing punctuation stays outside the link).
  const linkify = (v: string) => {
    const parts: (string | ReactElement)[] = []
    const re = /https?:\/\/[^\s)]+[^\s).,;:]/g
    let last = 0
    for (let m = re.exec(v); m; m = re.exec(v)) {
      parts.push(v.slice(last, m.index))
      parts.push(
        <a key={m.index} href={m[0]} target="_blank" rel="noreferrer">
          {m[0]}
        </a>,
      )
      last = m.index + m[0].length
    }
    parts.push(v.slice(last))
    return parts
  }
  const weatherListed = Object.values(data.grid.sources).includes(data.weather.source)
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="modal-body">
        <div className="modal-head">
          <h2>Fuentes y supuestos</h2>
          <button type="button" className="btn small ghost" onClick={() => ref.current?.close()}>
            Cerrar
          </button>
        </div>
        <p className="memorial">
          En memoria de las víctimas. Herramienta de prevención y planificación: explora escenarios, no predice ni atribuye responsabilidades.
        </p>

        <h3>Datos</h3>
        {data.synthetic && <div className="alert warn">Se están usando datos de prueba sintéticos: los resultados no representan el territorio real.</div>}
        <dl className="sources">
          {Object.entries(data.grid.sources).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{linkify(v)}</dd>
            </div>
          ))}
          {!weatherListed && (
            <div>
              <dt>Clima</dt>
              <dd>{linkify(data.weather.source)}</dd>
            </div>
          )}
        </dl>
        <p className="small muted">
          Grilla de {data.grid.rows} × {data.grid.cols} celdas de {data.grid.cellM} m · {(data.buildings.length / 3).toLocaleString('es-CL')} edificaciones ·{' '}
          {data.roads.edges.length.toLocaleString('es-CL')} tramos de calle.
        </p>

        <h3>Modelo de fuego</h3>
        <ul>
          <li>Velocidad de propagación según McArthur Mk5 (bosque y matorral) y CSIRO (pastizal), con viento, humedad, temperatura y factor de sequía.</li>
          <li>Pendiente y viento combinados en un solo vector; propagación elíptica alrededor de esa dirección.</li>
          <li>Tiempos de llegada por propagación de tiempo mínimo de viaje sobre la grilla de celdas.</li>
          <li>Pavesas: focos secundarios a favor del viento, hasta una distancia proporcional a la velocidad del viento.</li>
          <li>Los cortafuegos eliminan el combustible bajo la línea dibujada, con el ancho elegido.</li>
        </ul>

        <h3>Modelo de evacuación</h3>
        <ul>
          <li>Cada hogar sale por la red de calles hacia la zona segura más cercana, a pie o en auto.</li>
          <li>Búsqueda de la salida más tardía posible en el grafo de calles: una calle deja de servir cuando el fuego llega a ella o a su lado, con un margen de seguridad.</li>
          <li>Tránsito a flujo libre (sin congestión) y tiempo de preparación con distribución lognormal tras la alerta.</li>
          <li>
            Evacuación espontánea: una parte de los hogares ({Math.round(DEFAULT_EVAC_PARAMS.cueShare * 100)} % por defecto) empieza a prepararse cuando
            el fuego llega a menos de cierta distancia de su casa ({DEFAULT_EVAC_PARAMS.cueRadiusM.toLocaleString('es-CL')} m por defecto), si eso ocurre
            antes de la alerta. En una encuesta a hogares tras el incendio de Gatlinburg (EE.&nbsp;UU., 2016),
            el 82 % evacuó y la mayoría lo hizo al ver, oír u oler el fuego; pocos citaron una orden oficial (
            <a href="https://doi.org/10.6028/NIST.TN.2103" target="_blank" rel="noreferrer">
              NIST TN 2103
            </a>
            ).
          </li>
          <li>Zona segura: punto de la red lejos de vegetación combustible y que no se quema en el escenario.</li>
        </ul>

        <h3>Limitaciones</h3>
        <ul>
          <li>Es un modelo simplificado: no reproduce el comportamiento real del fuego ni de las personas, y no reemplaza la planificación profesional.</li>
          <li>El clima es una serie horaria en un solo punto (reanálisis ERA5), no el viento local en cada quebrada.</li>
          <li>La propagación entre viviendas se aproxima con clases de combustible urbano; no modela casas una por una.</li>
          <li>La evacuación no considera congestión, cortes por accidentes, ni la decisión de quedarse o volver.</li>
          <li>Los resultados sirven para comparar escenarios entre sí, no como cifras absolutas.</li>
        </ul>
      </div>
    </dialog>
  )
}
