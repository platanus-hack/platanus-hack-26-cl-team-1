# Cortafuego

<img src="./project-logo.png" alt="Logo de Cortafuego" width="160" />

**Cuando un incendio se acerca a un barrio, ¿qué puede darles más tiempo a las personas para salir?**

Cortafuego es un simulador de incendios y evacuación construido a partir del incendio del 2 de febrero de
2024 en Viña del Mar, Quilpué y Villa Alemana. Reúne datos reales del relieve, la vegetación, las viviendas,
las calles y el clima para explorar cómo distintas condiciones y decisiones cambian el avance del fuego
y las posibilidades de salir de los hogares que están en su camino.

La idea es que las comunidades y quienes planifican la prevención puedan preguntarse "¿qué pasaría si…?"
antes de tener que tomar esas decisiones en una emergencia.

**[Abrir Cortafuego](https://cortafuego.app)** · Platanus Hack 26 · Categoría Simulaciones

## Qué puedes explorar

- **Otro clima:** cambia el viento, la humedad, la temperatura y la sequía para ver cómo se propaga el fuego.
- **Prevención sobre el mapa:** mueve los focos o dibuja cortafuegos. El modelo también contempla las
  pavesas que pueden llevar el fuego al otro lado de una franja despejada.
- **Tiempo para evacuar:** ajusta la hora de la alerta, cierra calles o agrega salidas de emergencia y
  revisa qué hogares quedarían con su vía de escape cortada por el fuego.
- **Decisiones frente a frente:** guarda un escenario base y compáralo con una alternativa.

La aplicación abre con un escenario hipotético que usa el pronóstico del tiempo de hoy. También puedes
explorar el escenario histórico de 2024. Ambos usan el mismo territorio y los focos de inicio de 2024.

## Cómo funciona

El territorio se reconstruye con datos abiertos: relieve de Copernicus, vegetación de ESA WorldCover,
edificios y calles de Overture / OpenStreetMap, y clima de Open-Meteo. El modelo de fuego considera el
combustible, la pendiente, el viento y las pavesas. El de evacuación recorre la red de calles a pie o en auto
e incluye un tiempo de preparación antes de salir. Las observaciones satelitales de Sentinel-2 y NASA FIRMS
sirven como referencia para contrastar la simulación histórica.

Las simulaciones se ejecutan en el navegador mediante un web worker. La aplicación está construida con
React, TypeScript y MapLibre. Los datos se preparan previamente con un proceso en Python.

## Equipo

Creado por Alonso Felipe Gac Monárdez ([@alonsogm4](https://github.com/alonsogm4)),
Anaís Neira Zúñiga ([@chichitaocss](https://github.com/chichitaocss)) y
José Rodolfo Cañete López ([@josecannete](https://github.com/josecannete)).
