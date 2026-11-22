# Ojo

**Un supervisor que te mira hacer una tarea paso a paso y te habla:** te dice qué sigue o te corrige en el
momento en que te equivocas.

## El problema

Casi cualquier tarea práctica es una receta: armar un circuito, montar un robot, preparar un procedimiento,
seguir una checklist de despegue. Cuando no la haces seguido te saltas pasos, los haces en otro orden o los
haces mal, y nadie está mirando.

## Qué hace Ojo

1. **Conoce la receta.** Cada tarea es un grafo de pasos sobre un vocabulario de acciones visibles
   (`poner el LED`, `conectar el portapilas a los rieles`…). El grafo dice qué pasos son válidos ahora, así
   que Ojo no puede sugerir algo sin sentido: un paso fuera de orden es una transición ilegal, y cada receta
   describe además sus errores típicos (acción equivocada, paso a medias) y cómo corregirlos.
2. **Mira.** Un modelo de visión y lenguaje (Qwen3-VL 8B en una RTX 5090) mira la cámara y dice qué acción
   estás haciendo, o "no estoy seguro". Si no está seguro, Ojo se queda callado.
3. **Decide.** Un controlador avanza la receta, detecta errores (paso fuera de orden, acción equivocada,
   paso a medias) y elige qué decir.
4. **Habla.** En español, sin hablar encima de sí mismo ni repetir la misma frase seguida: "Bien. Ahora pon la resistencia…" o "Ojo, el LED está al revés;
   gíralo para que la pata larga quede en la fila de la resistencia".

## Tareas de la demo

- **Linterna en protoboard:** LED, resistencia de 220 Ω, pulsador y portapilas con cables jumper.
- **Robot explorador:** motores, ruedas, servo, sensor ultrasónico y cableado.
- **Lavado de manos.**
- **Despegue de un Cessna 172** en un simulador en el navegador, pensado para practicar sin hardware y
  cometer errores a propósito (la lectura del panel por el modelo de visión aún se está afinando).

## Cómo está hecho

- **Recetas nuevas generadas con Claude** a partir de una frase (así se hicieron la linterna y el robot).
  Toda receta, generada o escrita a mano, se valida contra el vocabulario de acciones antes de entrar a la
  librería.
- **Simulador simbólico** que genera miles de ejecuciones con errores y ruido de percepción, para entrenar y
  medir el controlador sin horas de video.
- **Controlador:** un autómata con reglas (el de la demo) y, como alternativa, una red GRU pequeña por tarea
  entrenada en el simulador. En el despegue del C172 con ruido de percepción simulado medio, la GRU termina en
  el estado correcto en el 93,8% de las ejecuciones contra 37,4% de las reglas y da unas 8 veces menos falsas
  alarmas (0,42 contra 3,51 por ejecución), aunque detecta menos errores (38,7% contra 55,6%)
  (`training/results/controller.md`).
- **Percepción** servida con vLLM en una RTX 5090, con 3 cuadros por llamada y hasta 3 llamadas a la vez:
  unos 0,84 s por llamada (p50) y 2,8 observaciones por segundo (`app.perception.bench --stream`, decisión
  D-018 en `agent-kb/decisions.md`).
- **Voz** en español con ElevenLabs o con la voz del navegador, con una cola en la que una corrección corta
  la frase anterior en vez de hablarle encima.

## Equipo

Alonso Gac ([@alonsogm4](https://github.com/alonsogm4)), Anaís Neira
([@chichitaocss](https://github.com/chichitaocss)) y José Cañete ([@josecannete](https://github.com/josecannete)).
