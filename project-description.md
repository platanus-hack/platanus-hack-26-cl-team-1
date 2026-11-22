# Cortafuego

**El incendio del 2 de febrero de 2024 en Viña del Mar, Quilpué y Villa Alemana, simulado sobre el terreno,
el viento y las calles reales.** Cambia el clima, dibuja un cortafuego o adelanta la alerta, y mira hasta dónde
llega el fuego y cuántos hogares alcanzan a salir.

## El problema

En los cerros de Viña del Mar el fuego avanzó más rápido de lo que muchas familias alcanzaron a evacuar. Un
informe científico apuntó al trazado de las calles y a la falta de simulacros. En enero de 2026 volvió a pasar
en Penco y Lirquén. Las comunas, las forestales y las distribuidoras planifican cortafuegos, rutas de
evacuación y alertas, pero casi nunca pueden probar esas decisiones contra el fuego antes de que ocurra.

## Qué hace Cortafuego

1. **Reconstruye el lugar con datos abiertos reales:** relieve (Copernicus), vegetación (ESA WorldCover),
   viviendas y calles (Overture / OpenStreetMap) y el clima hora a hora de esa tarde (ERA5 vía Open-Meteo).
2. **Simula el fuego en el navegador:** la velocidad de propagación depende del combustible, el viento, la
   humedad, la temperatura, la sequía y la pendiente (modelos McArthur y CSIRO), con propagación elíptica y
   pavesas que saltan cortafuegos angostos.
3. **Simula la evacuación de cada hogar:** a pie o en auto por las calles reales, con un tiempo de preparación
   después de la alerta, y calcula qué calles quedan cortadas por el fuego y cuántos hogares no alcanzarían a
   salir.
4. **Te deja cambiar las decisiones:** viento, humedad, temperatura y sequía; focos; cortafuegos dibujados
   sobre el mapa; calles cerradas y salidas de emergencia nuevas; y la hora de la alerta. Todo se recalcula en
   segundos.
5. **Se contrasta con la realidad:** la cicatriz del incendio medida por Sentinel-2 y los focos satelitales de
   NASA FIRMS se pueden superponer al resultado del modelo, y el ritmo del avance se mide contra el satélite
   GOES-16 (una imagen cada 10 minutos) y las pasadas VIIRS y MODIS, tanto si el fuego simulado va adelantado
   como atrasado.

## Lo que no es

Es una herramienta de prevención y planificación: explora escenarios, no predice ni atribuye
responsabilidades. En memoria de las víctimas.

## Equipo

Alonso Gac ([@alonsogm4](https://github.com/alonsogm4)), Anaís Neira
([@chichitaocss](https://github.com/chichitaocss)) y José Cañete ([@josecannete](https://github.com/josecannete)).
