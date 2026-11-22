// Typed wrapper around the simulation worker. Runs are coalesced: while one is in flight, only the newest
// requested scenario is kept and sent when the worker is free.
import type { FromWorker, RunResult, ToWorker } from './protocol'
import type { Scenario } from './scenario'

export interface SimCallbacks {
  onReady: (loadMs: number, prepareMs: number) => void
  onResult: (r: RunResult, roundTripMs: number) => void
  onError: (message: string) => void
  onBusy: (busy: boolean) => void
}

export class SimClient {
  private worker: Worker
  private nextId = 1
  private inFlight: { id: number; sentAt: number } | null = null
  private pending: Scenario | null = null
  private ready = false

  constructor(private cb: SimCallbacks) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data)
    this.worker.onerror = (ev) => {
      ev.preventDefault()
      this.inFlight = null
      this.cb.onBusy(false)
      this.cb.onError(`El simulador falló: ${ev.message || 'error desconocido en el worker'}`)
    }
  }

  /** The worker loads the dataset itself; `synthetic` must match what the UI loaded. */
  init(synthetic: boolean) {
    this.ready = false
    this.send({ type: 'init', synthetic })
  }

  run(scenario: Scenario) {
    this.pending = scenario
    this.pump()
  }

  dispose() {
    this.worker.terminate()
  }

  private pump() {
    if (!this.ready || this.inFlight || !this.pending) return
    const scenario = this.pending
    this.pending = null
    const id = this.nextId++
    this.inFlight = { id, sentAt: performance.now() }
    this.cb.onBusy(true)
    this.send({ type: 'run', id, scenario })
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg)
  }

  private handle(msg: FromWorker) {
    if (msg.type === 'ready') {
      this.ready = true
      this.cb.onReady(msg.loadMs, msg.prepareMs)
      this.pump()
      return
    }
    const sentAt = this.inFlight?.sentAt ?? performance.now()
    this.inFlight = null
    if (msg.type === 'result') this.cb.onResult(msg.result, performance.now() - sentAt)
    else this.cb.onError(msg.message)
    if (!this.pending) this.cb.onBusy(false)
    this.pump()
  }
}
