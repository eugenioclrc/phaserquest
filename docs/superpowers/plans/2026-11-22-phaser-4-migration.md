# Plan de implementación de Phaser 4

> **Para agentes** Usá `superpowers:subagent-driven-development` para implementar y revisar cada tarea por separado, o `superpowers:executing-plans` para ejecutar el plan en una sola sesión. Marcá los pasos tras comprobar su resultado.

**Objetivo** Promover el cliente Phaser 4 a `/` cuando permita jugar y continuar partidas con las funciones del cliente clásico.

**Arquitectura** La vista previa en `src/phaser4/` es el punto de partida. El adaptador Socket.IO entrega datos tipados a la escena y a los controles HTML. Bun ejecuta el servidor, que conserva la autoridad sobre movimiento, combate, botín y persistencia.

**Stack** Phaser 4.2.1, TypeScript estricto en el cliente, Vite, Bun 1.3.10 o posterior, Socket.IO y MongoDB.

**Especificación** El [alcance y criterio de aceptación](#alcance-y-criterio-de-aceptación) están en este documento.

## Alcance y criterio de aceptación

La vista previa en `/phaser4.html` ya crea y recupera personajes, carga las cinco capas, mueve jugadores y permite conversar entre perfiles. El cliente clásico en `/` sirve de referencia durante la migración.

El cliente nuevo debe cubrir sincronización por áreas, movimiento y puertas, NPC y diálogo, combate y reaparición, objetos y cofres, equipo, ayuda, logros, sonido, chat y reinicio de personaje. El corte requiere comprobar esos flujos en Chromium de escritorio, una sesión con viewport táctil emulado y otro navegador de escritorio. El HUD y los formularios pueden usar HTML, con los mismos controles y resultados que espera el jugador.

## Restricciones globales

- Reutilizar el mapa, atlas, sonidos, catálogos y guardados existentes. Mantener `playerID` como el ObjectId persistente y el ID numérico como identificador de sesión.
- Preservar la estructura de los documentos en MongoDB y el formato binario de `shared/CoDec.ts`. Cualquier ajuste de compatibilidad a un evento Socket.IO debe aceptar a ambos clientes.
- Extender el único caso de `test/codec.test.ts` para proteger el protocolo. Usar pruebas de navegador con una base aislada para los flujos de juego.
- Mantener `bun run typecheck`, `bun test` y `bun run build` como puerta de verificación de cada entrega. Registrar un commit por tarea durante la ejecución, con el cambio de ruta y la limpieza en commits separados.
- Conectar el adaptador Socket.IO, la escena y el HUD mediante eventos. El cálculo de vida, daño, caída de objetos y guardado corresponde al servidor.

## Foco de revisión

| Riesgo | Comprobación y tarea |
| --- | --- |
| Los dos codecs cambian juntos y la ida y vuelta sigue pasando | Comparar bytes de `init` y `update` contra la base actual. Tarea 1. |
| El área `0`, un cruce de zona o una reconexión deja jugadores duplicados o ausentes | Probar ausencia de campos y valor `0`, y repetir el cruce con dos perfiles. Tarea 2. |
| Un toque apunta a otra casilla al mover el formulario o entrar por una puerta | Comprobar el destino observado por el segundo cliente antes y después de cambiar el layout. Tarea 3. |
| Un ataque o cofre adyacente pierde su acción por tener una ruta de una casilla | Probar acciones `3` y `4` desde una casilla vecina. Tareas 4 y 5. |
| El guardado se reemplaza al recargar, cambiar de cliente o recibir un error temporal | Abrir el mismo ObjectId y comprobar equipo y progreso antes y después del cambio, con un perfil adicional para concurrencia. Tareas 2, 7 y 8. |

## Cómo ejecutar las verificaciones

Instalá con `bun install --frozen-lockfile` y usá una instancia local de MongoDB de pruebas. Las dos rutas de un mismo perfil deben compartir esquema, host y puerto para compartir `localStorage`.

```sh
bun run typecheck
bun test
bun run build
MONGODB_DB=phaserQuest_p4_acceptance bun run dev -p 8081
```

Para probar `dist/`, detené desarrollo y ejecutá `MONGODB_DB=phaserQuest_p4_acceptance bun run start -p 8081`. Usá `http://127.0.0.1:8081` en ambos modos. Los perfiles concurrentes necesitan IDs persistentes distintos. Para comprobar migración de guardados usá un solo perfil y cambiá de ruta de forma secuencial.

Para pruebas que requieren posiciones fijas, creá personajes en la base desechable y ajustá únicamente sus documentos de prueba con el navegador cerrado. Los puntos `(44, 234)` y `(46, 234)` sirven para chat. Para distinguir equipo inicial de equipo recuperado, usá `leatherarmor` y `sword2` en un personaje de prueba. Un paso corto solo confirma movimiento. El guardado de posición ocurre al terminar un recorrido exterior con `x < 92` a más de 30 casillas Manhattan del último guardado, o al equipar una mejora en exteriores.

## Tarea 1. Fijar el protocolo y el punto de partida

**Archivos** `test/codec.test.ts`, `shared/CoDec.ts`, `js/server/Encoder.ts`, `src/Decoder.ts`. Durante esta tarea solo cambia el test.

**Interfaz** `encode(packet, schema)` devuelve el `ArrayBuffer` que consume `Decoder.decode(buffer, schema)`.

- [ ] Registrar el diff actual y validar ambos clientes antes de iniciar la migración de paridad. Crear un personaje, moverlo, volver a entrar con el mismo ID y enviar chat entre perfiles usando la vista previa.
- [ ] Dentro del test existente, fijar los bytes del paquete de actualización actual y agregar el paquete `init` que figura abajo. Comparar los bytes antes de decodificar y después comparar el objeto decodificado con el paquete original.
- [ ] Ejecutar `bun test test/codec.test.ts`. Confirmar que pasa y que editar un byte esperado temporalmente produce un fallo. Restaurar el valor de referencia.
- [ ] Guardar el punto de partida de la vista previa y el test de compatibilidad para las tareas siguientes.

El paquete `init` contiene `stamp: 123456789`, `nbconnected: 1`, `nbAOIhorizontal: 6`, `lastAOIid: 96` y `player: { id: 513, x: 0, y: 0, aoi: 0, name: 'Scout', inFight: false, alive: true }`.

| Paquete | Bytes hexadecimales de la versión actual |
| --- | --- |
| `init` | `1f075bcd1501060060072b02010000000000000553636f75740100` |
| `update` del test actual | `1f0000075bcd15024401070b02010028010e0553636f757401010101000407020050030029010e004c5701070d0201000101020000000000` |

## Tarea 2. Completar sesiones y áreas de interés

**Archivos** `src/phaser4/protocol.ts`, `src/phaser4/connection.ts`, `src/phaser4/WorldScene.ts` y `src/phaser4/main.ts`. Referencias en `shared/AOIutils.ts`, `src/Game.js` (`updateDisplayList`) y `src/Client.js`.

**Interfaz** Pasar `nbAOIhorizontal` y `lastAOIid` de `init` a `WorldScene.enter`. Añadir `aoi?: number` a `PlayerSnapshot` y a sus actualizaciones parciales. Hacer que `connection.move(path, orientation): boolean` indique si se envió la acción, y trasladar ese resultado a `WorldScene`.

- [ ] Reproducir el cruce de zona que deja un avatar fuera del área visible en la vista previa. Con dos personajes, salir del área y sus vecinas y volver a entrar.
- [ ] Aplicar `newplayers`, cambios de área y `disconnected` por ID de sesión. Retirar avatares fuera del vecindario y permitir su alta posterior sin duplicados. Tratar `aoi: 0` como un valor presente.
- [ ] Tras perder la conexión, detener los envíos y la animación local de rutas nuevas hasta recibir una inicialización. Solicitar el ObjectId confirmado previamente y rehidratar la escena con el ID de sesión devuelto por `init`. Mantener un solo temporizador para `wait` y conservar el guardado ante `dbError` temporal.
- [ ] Probar `wait` antes de `init` y un `dbError` con `retryable: true` usando datos de prueba. Comprobar una sola entrada al mundo y el mismo valor de `playerID` tras volver a intentar.
- [ ] Verificar reconexión, recarga y cruce de zonas con clásico y Phaser 4 conectados al mismo servidor. Intentar mover al personaje durante la desconexión y comprobar que queda en su casilla. Verificar un único documento en MongoDB y que el chat funciona al volver al área.

## Tarea 3. Cerrar movimiento, puertas y cámara

**Archivos** `src/phaser4/WorldScene.ts`, `src/phaser4/main.ts` y `src/phaser4/preview.css`. Referencias en `src/Game.js` (`displayMap`, `createDoorsMap`, seguimiento interior y exterior), `src/Player.js` y `assets/maps/minimap_client.json`.

**Interfaz** `WorldScene.reset(tile: Tile)` corrige la posición cuando responde el servidor. El cálculo de rutas devuelve `Tile[]` en las unidades que espera `path`.

- [ ] Registrar en el clásico una ruta exterior y tres puertas de referencia del mapa. La entrada `(80, 211)` lleva a `(155, 311)` con cámara fija. La entrada `(71, 3)` lleva a `(155, 71)` con seguimiento acotado. La salida `(127, 120)` lleva a `(65, 125)` en exteriores.
- [ ] Portar la orientación y los límites de cámara de cada puerta. Convertir las coordenadas de propiedades Tiled de texto a número. Preservar la colisión `c`, el orden de suelo, personajes y techos, y la separación entre casillas y píxeles. Mantener el límite de 60 nodos y 28 casillas Manhattan que comprueba el servidor.
- [ ] Mostrar una indicación del destino y detener el movimiento local al aplicar un `reset`. Recalcular los límites del canvas al cambiar la posición de los formularios y el estado.
- [ ] Recorrer los mismos trayectos con mouse y toque emulado. Comprobar que una casilla de pared se rechaza, que el destino tocado coincide con el que observa el segundo perfil y que salir de una puerta restaura la cámara exterior.

## Tarea 4. Incorporar combate y reaparición

**Archivos** `src/phaser4/protocol.ts`, `src/phaser4/connection.ts`, `src/phaser4/WorldScene.ts`, `src/phaser4/main.ts` y `phaser4.html`. Revisar la pérdida de objetivo en `js/server/GameServer.js`. Referencias en `src/Monster.js`, `src/Being.js`, `src/Game.js`, `js/server/Player.js` y `assets/sprites/atlas4.json`.

**Interfaz** Ampliar `WorldUpdate` con `newmonsters` y `monsters` y `PersonalUpdate` con `hp` y `killed`, según `CoDec`. Definir `PathAction` como `{ action: 0 } | { action: 3; id: number } | { action: 4; x: number; y: number }`. `connection.move(path, orientation, action?): boolean` usa `{ action: 0 }` por defecto. La ruta de una casilla se admite para las acciones adyacentes `3` y `4`.

El alta de un monstruo incluye `id`, posición y tipo `monster`. Las actualizaciones son parciales y su ruta contiene `path: Tile[]` y `delta`. Añadir `targetID` e `inFight` al estado de jugadores. Cada entrada de `hp` tiene `hp`, `target` y, cuando existe, `from`.

- [ ] Reproducir en el clásico un ataque a un monstruo ya adyacente, un ataque que requiere acercarse y una muerte del jugador. Registrar el evento disparado y el punto de reaparición.
- [ ] Renderizar altas, rutas, bajas y estados de monstruos desde los paquetes existentes. Usar el atlas y las animaciones del monstruo correspondiente. Validar que el objetivo sigue presente tanto al aceptar la ruta en `handlePath` como al ejecutarla en `checkAction`.
- [ ] Reflejar daño y vida del servidor, mostrar el control de reaparición durante la muerte y enviar `revive` una vez por clic. Aplicar la posición de reaparición y restablecer la vida de la barra con el estado revivido.
- [ ] Probar ataque adyacente, acercamiento, objetivo que desaparece, muerte y regreso al punto guardado. Confirmar que otro perfil ve el resultado y que el cliente vuelve a aceptar movimiento.

## Tarea 5. Incorporar botín, cofres y equipo

**Archivos** `src/phaser4/protocol.ts`, `src/phaser4/WorldScene.ts`, `src/phaser4/connection.ts`, `src/phaser4/main.ts` y `phaser4.html`. Referencias en `src/Item.js`, `src/Player.js`, `src/Game.js` y `assets/json/db.json`.

**Interfaz** Añadir `newitems` e `items` a `WorldUpdate` y `used` y `noPick` a `PersonalUpdate`. Resolver los IDs de equipo a las claves del catálogo antes de guardarlas como `armor` o `weapon`.

- [ ] Ejercitar la apertura de un cofre adyacente, el consumo de un objeto y el intento de recoger equipo inferior en el clásico. Guardar los cambios que devuelve el servidor.
- [ ] Mostrar altas y cambios de visibilidad de objetos. Enviar `action: 4` para abrir un cofre y `action: 0` para llegar al botín. Aplicar los cambios de arma y armadura del servidor al avatar, al HUD y al guardado local.
- [ ] Mostrar los resultados de `used` y `noPick`. Comprobar con dos perfiles que la recogida retira el objeto y que un cofre se abre una sola vez.
- [ ] Desde exteriores, equipar una mejora, recargar y verificar que MongoDB y los dos clientes muestran el equipo guardado.

## Tarea 6. Recuperar NPC y diálogo

**Archivos** `src/phaser4/WorldScene.ts`. Referencias en `assets/json/entities_client.json`, `assets/json/db.json`, `assets/sprites/atlas1.json`, `src/NPC.js`, `src/Game.js` (`displayNPC`, `handleCharClick`) y `src/Being.js`.

**Interfaz** Identificar cada NPC por su posición en el mapa para guardar el turno de diálogo durante la partida. Informar al controlador del primer diálogo para desbloquear su logro.

- [ ] Elegir un NPC de varias líneas. Registrar la aproximación, la orientación, la última línea y el ciclo al volver a hablar.
- [ ] Cargar las entidades y los atlas actuales. Marcar la casilla del NPC como bloqueada. Al seleccionarlo, caminar hasta su casilla adyacente y mostrar el diálogo mediante el ciclo local, también cuando el jugador ya está frente a él.
- [ ] Probar el ciclo completo de diálogo, incluida la interacción que oculta el globo antes de volver a la primera línea. Probar también un NPC inaccesible y el clic adyacente. Verificar que el servidor recibe solo la acción de movimiento para aproximarse.

## Tarea 7. Completar controles de sesión y presentación

**Archivos** `phaser4.html`, `src/phaser4/main.ts`, `src/phaser4/preview.css`, `src/phaser4/connection.ts`, `src/phaser4/WorldScene.ts`, `server.js` y `js/server/GameServer.js`. Referencias en `src/Home.js`, `src/Client.js`, `src/Game.js` y `assets/json/db.json`.

**Interfaz** Conservar `ach<id>` y `killed_<id>` en `localStorage`. Alimentar la vista de logros desde los eventos de diálogo, botín, muerte del enemigo y ubicación. Ampliar `delete({ id }, ack?)` para que el servidor pueda devolver `{ ok: boolean }` después de la operación en MongoDB. El cliente clásico puede omitir el acuse.

- [ ] Probar ayuda, logros, audio y el flujo confirmar o cancelar reinicio en el clásico. Sembrar en el perfil de prueba un logro alcanzado y un contador de muertes de `9`.
- [ ] Portar ayuda, listado de los ocho logros, desbloqueos y notificaciones sin perder el progreso local. Comprobar que el siguiente derribo incrementa el contador de `9` a `10`.
- [ ] Habilitar audio tras una interacción, usando los marcadores del catálogo y los archivos MP3/OGG. Probar el control de sonido, incluido el silencio durante combate y notificaciones.
- [ ] Portar el reinicio desde la pantalla de personaje con confirmación explícita. Ante fallo o timeout conservar el guardado. Ante éxito retirar las claves de personaje y logros del juego, conservando el resto de las claves del origen.
- [ ] Probar cancelación, fallo, borrado y pérdida del acuse después de un borrado exitoso con un personaje desechable. Confirmar que un reintento sobre un documento ya borrado permite limpiar el guardado local.
- [ ] Probar que Enter y el botón envían un solo mensaje, que se puede operar la interfaz con teclado y que el chat y el HUD caben en portrait y landscape.

## Tarea 8. Promover Phaser 4 y retirar Phaser 2

**Archivos** `index.html`, `phaser4.html`, `vite.config.mts`, `server.js`, `package.json`, `bun.lock`, `README.md`, `AGENTS.md` y `src/phaser4/phaser4.d.ts`. El plugin y los módulos clásicos se eliminan al completar la segunda parte.

**Interfaz** `/` carga el cliente Phaser 4. `/phaser4.html` lleva a `/` para conservar marcadores. El origen, el servidor de juego, el formato de guardado y las rutas de recursos de juego permanecen compatibles con el despliegue anterior.

- [ ] Ejecutar la prueba de paridad completa antes del corte. Abrir un guardado existente en clásico, Phaser 4 y clásico, en ese orden. Comparar el ObjectId, la casilla guardada, el equipo y los logros. Probar chat y movimiento entre clientes concurrentes en perfiles distintos.
- [ ] Guardar el artefacto desplegable completo que aún contiene Phaser 2, incluidos código del servidor, dependencias, recursos y `dist/`. Registrar qué revisión y artefacto se restauran si falla el corte.
- [ ] Promover Phaser 4 a `index.html`, retirar el enlace al cliente clásico y hacer que `/phaser4.html` redirija a `/`. Verificar apertura directa y recarga de ambas URLs usando la compilación de producción. Registrar este corte en su propio commit.
- [ ] Retirar los módulos clásicos `src/{Being,Client,Factory,Game,Home,Human,Item,Monster,NPC,Player,entry-game,phaser-game}.js`, `js/phaser-input.js` y las dos rutas antiguas de `/vendor/`. Reemplazar el alias `phaser4` por la dependencia `phaser@4.2.1`, usar sus tipos publicados y retirar la declaración del alias. Conservar los módulos compartidos y el Decoder.
- [ ] Actualizar documentación y lockfile. Instalar desde el lockfile en una copia limpia y repetir tipos, test, build y las pruebas de producción en Chromium y otro navegador. Confirmar movimiento táctil emulado en `/`, apertura del mismo guardado y ausencia de peticiones de Phaser 2. Registrar la limpieza en un segundo commit.
- [ ] Si el corte falla, restaurar el artefacto completo anterior y comprobar que el mismo ObjectId abre con su equipo y progreso en `/`.
