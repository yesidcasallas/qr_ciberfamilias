# Proyecto CiberFamilias — Dentro del teléfono

Simulador 3D de ciberseguridad en **primera persona** para un semillero universitario.
Un teléfono te lleva al mundo que hay dentro de él y debes cruzarlo **sin caer en
fraudes**: ignorar los cebos, resistir la ingeniería social, registrar tu correo solo en
el sitio oficial y encontrar la salida. Hecho con **Astro** + **three.js**, estética minimalista.

> 100 % educativo. Por defecto nada de lo que escribes se envía ni se guarda; si se configura
> Supabase, solo se guarda con autorización (ver «Guardar respuestas en Supabase»).
> Los sitios y mensajes "fraudulentos" solo sirven para aprender a reconocerlos.

**Integrantes:** Laura Tatiana · Daniel Casallas · Yasmin Becerra

## El recorrido

1. **Entras al teléfono.** Un teléfono llega flotando y su pantalla muestra en vivo el
   mundo de adentro; la cámara se mete en ella y apareces en el pasillo.
2. **El estafador.** Un encapuchado te sigue y **aplica ingeniería social según lo que
   haces**. Te habla en voz alta y su subtítulo rotula cada técnica: *confianza*,
   *autoridad*, *urgencia*, *prueba social*, *cebo*, *pretexto*, *miedo*, *psicología inversa*…
   Una vez te ofrece un **"atajo" para salir**: aceptarlo es caer (te roba la cuenta);
   alejarte es resistirlo.
3. **Las 3 ventanas.** Se ven iguales; solo las distingue su **dirección**. Escribes tu
   correo **sobre la ventana elegida**: si es falsa, te muestra que le entregaste tus
   datos y un **portal** te devuelve al inicio; si es la oficial (`registro.universidad.edu`),
   el correo queda registrado y se abre la barrera.
4. **Objetos de fraude:** grabadora (vishing), USB (baiting), QR (quishing), Wi‑Fi gratis
   (red gemela), cargador (juice jacking). Su lección aparece en una tarjeta 3D.
5. **La salida no es obvia:** una **TV vieja apagada**, a un lado. Al encenderla escribes
   tu universidad **sobre su pantalla**; la TV te absorbe y sales del teléfono.
6. **Final:** la cámara sale del teléfono y su pantalla muestra los créditos del
   **Proyecto CiberFamilias**, el agradecimiento, tus datos y las integrantes y el integrante.

Todo se muestra **en la escena** (sin ventanas modales). Al escribir, la cámara encuadra
la pantalla para que siempre veas lo que tecleas, también con el teclado del celular.

## Controles

- **Escritorio:** WASD/flechas para caminar · arrastrar para mirar · clic directo sobre un objeto o un campo para usarlo (o **E** con el mouse encima) · Enter o «Enviar» envían, Esc cancela.
- **Celular:** joystick para caminar · arrastrar para mirar · tocar directo un objeto o un campo, como en cualquier app · «Enviar» o la tecla ↵ del teclado envían; cerrar el teclado cancela.
- Si tocas algo que está lejos, te pide acercarte.
- El botón o gesto de «atrás» del celular no saca del simulador: avisa que sigues dentro del teléfono.
- Tocar durante la entrada la salta. Botón de sonido arriba a la derecha.

## Páginas

| Ruta | Qué es |
|---|---|
| `/` | Portal y página principal (destino del QR): presenta el Proyecto CiberFamilias y deja elegir entre el simulador y el formulario. |
| `/simulador` | El simulador 3D. |
| `/formulario` | Versión sencilla: correo y universidad, y agradecimiento. Guarda en Supabase solo si está configurado y la persona lo autoriza. |
| `/qr` | Pantalla para proyectar: el QR que lleva a la página principal del mismo sitio (botón o tecla **F**: pantalla completa). Con `?url=https://…` apunta a otra dirección. |

En una presentación local, abre `/qr` con la dirección de red que muestra `pnpm dev`
(Network, por ejemplo `http://192.168.x.x:4321/qr`): los celulares no pueden abrir `localhost`.
Ya publicado, el QR apunta solo a la página principal del sitio publicado.

## Comandos (pnpm)

```sh
pnpm install
pnpm dev       # http://localhost:4321 (accesible desde el teléfono en la misma red Wi-Fi)
pnpm build     # genera dist/
pnpm preview
pnpm test      # pruebas de las reglas del dominio (src/entities) y de la regla de dependencias
```

## Desplegar gratis

Sitio estático (`dist/`): funciona en **Vercel** (detecta Astro), **Netlify**
(build `pnpm build`, publish `dist`) o **Cloudflare Pages** (preset Astro).

## Guardar respuestas en Supabase

Sin configurar nada, el sitio no guarda ni envía datos (y las páginas lo dicen). Para guardar las
respuestas en Supabase:

1. En el proyecto de Supabase, **SQL Editor**: pega `supabase/respuestas.sql` y dale **Run**. Crea la
   tabla `respuestas` y sus permisos.
2. Pon la URL del proyecto y la clave publicable (`sb_publishable_…`) en un archivo `.env`
   (ver `.env.example`) y reinicia `pnpm dev`:
   `PUBLIC_SUPABASE_URL=https://….supabase.co` y `PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…`.
3. Al publicar en Vercel o Netlify, agrega esas dos variables con esos mismos nombres en la
   configuración del proyecto (en Astro empiezan por `PUBLIC_`, no por `NEXT_PUBLIC_`) y vuelve a desplegar.

La clave publicable queda a la vista en el código de la página, y está hecha para eso: con ella solo
se pueden **agregar** filas. Nadie puede leer, cambiar ni borrar respuestas con esa clave; se ven en
**Table Editor → respuestas** con la sesión del equipo. Nunca pongas en el sitio la clave secreta
(`sb_secret_…`).

Con Supabase configurado aparece una casilla de autorización (Ley 1581 de 2012) en el formulario,
obligatoria para enviar, y en la entrada del simulador, opcional. Se guardan fecha, origen, correo
y universidad; del simulador, además, en cuántos señuelos cayó y si resistió al estafador. Lo que
se escribe en las ventanas falsas nunca se guarda. Como la clave es pública, alguien podría agregar
filas falsas (se borran desde el Table Editor).

## Modelos 3D, voz y licencias (todo de uso libre)

| Recurso | Origen | Licencia |
|---|---|---|
| `public/models/RobotExpressive.glb` | Ejemplos oficiales de three.js. Modelo de Tomás Laulhé, modificaciones de Don McCurdy. | **CC0 1.0** (dominio público) |
| `public/models/tv_retro.glb` | Modelado para este proyecto en **Blender** (software libre) mediante scripts de Python. | Obra propia del equipo; se publica como **CC0 1.0** |
| `public/models/estafador.glb` | Modelado y animado para este proyecto en **Blender** (animaciones *Idle* y *Beckon*). | Obra propia del equipo; se publica como **CC0 1.0** |
| Voz del estafador | Síntesis de voz del navegador (Web Speech API): no usa archivos. | — |
| Sonidos | Sintetizados en tiempo real con WebAudio. | — |

El teléfono, el pasillo, las ventanas, los objetos, el portal y el cielo se generan por
código con three.js, sin assets externos.

Software usado: [three.js](https://threejs.org) (MIT), [Astro](https://astro.build) (MIT),
[qrcode](https://github.com/soldair/node-qrcode) (MIT),
[Blender](https://www.blender.org) (GPL; los modelos creados con Blender pertenecen a sus autores).

## Estructura

Se está migrando por fases a **Clean Architecture**. La capa central ya existe: las reglas del dominio
viven en `src/entities/`, en JavaScript puro (sin three.js, DOM ni configuración), y la escena y las
páginas solo les avisan lo que pasa.

- `src/entities/participacion.js` — cuándo un correo y una universidad son válidos (simulador y formulario).
- `src/entities/recorrido.js` — trampas, cebos, resistencia al estafador y el resumen que muestran los créditos.
- `src/entities/tacticas.js` — frases del estafador rotuladas con su técnica y la regla para elegir la que toca.
- `test/` — pruebas de las entidades (`pnpm test`), incluida una que impide que importen algo de afuera.
- `src/pages/simulador.astro` — HUD e intro del simulador.
- `src/pages/index.astro`, `formulario.astro`, `qr.astro` — portal (página principal), formulario sencillo y pantalla del QR
  (con `src/layouts/Ciber.astro`, `src/components/Seal.astro` y `src/styles/ciber.css`, aparte del simulador).
- `src/scripts/main.js` — une todo: renderer, bloom, modelos glTF, bucle.
- `src/scripts/phone.js` — el teléfono: entrada al mundo y salida (su pantalla renderiza el mundo en vivo).
- `src/scripts/world.js` — el mundo: pasillo, ventanas, objetos, TV oculta, pantallas en las que se escribe.
- `src/scripts/player.js` — controlador en primera persona (teclado, joystick y toque directo).
- `src/scripts/game.js` — flujo del juego: escribir sobre pantallas, portal de regreso, salida, tarjeta de lección
  (el puntaje lo lleva `recorrido.js`).
- `src/scripts/scammer.js` — el estafador: te sigue y habla; arma el contexto y `tacticas.js` elige la técnica.
- `src/scripts/ending.js` — final: créditos del Proyecto CiberFamilias en la pantalla del teléfono.
- `src/scripts/environment.js` — cielo, columnas y partículas.
- `src/scripts/portal.js` — portal de regreso al inicio.
- `src/scripts/audio.js` — sonido sintetizado y voz.
- `src/scripts/registro.js` — guarda las respuestas autorizadas en Supabase (tabla de `supabase/respuestas.sql`).

## Inspiración

Ejemplos de three.js y [bruno-simon.com](https://bruno-simon.com) (dirección de arte y sensación de juego).
