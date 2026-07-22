# BAILEMOS! - Prueba Real Prioridad 1

Objetivo: confirmar que el flujo social principal funciona con usuarios reales antes de seguir metiendo funciones grandes.

## Usuarios necesarios

- Usuario A: Jonathan.
- Usuario B: amigo o familiar.
- Usuario C: otro amigo o familiar.

## Prueba 1 - Registro y perfil

1. Cada usuario crea cuenta.
2. Cada usuario entra en Mi perfil.
3. Sube foto.
4. Añade ciudad principal.
5. Añade estilos favoritos.
6. Guarda perfil.
7. Cierra y vuelve a abrir la app.

Resultado esperado: la sesion sigue abierta y la foto/perfil se mantienen.

## Prueba 2 - Comunidad y amistad

1. Usuario A entra en Comunidad BAILEMOS.
2. Busca al Usuario B.
3. Entra en su perfil.
4. Pulsa Enviar solicitud de amistad.
5. Usuario B entra en Mensajes.
6. Usuario B acepta.
7. Ambos entran en Mis amigos.

Resultado esperado: A y B aparecen como amigos.

## Prueba 3 - Chat privado

1. Usuario A entra en Mis amigos.
2. Pulsa Chatear con Usuario B.
3. Usuario A envía un mensaje.
4. Usuario B abre Mensajes.
5. Usuario B responde.

Resultado esperado: ambos ven la conversación.

## Prueba 4 - Valoraciones

1. Usuario A entra en Mis amigos.
2. Pulsa Valorar sobre Usuario B.
3. Escribe una valoración.
4. Usuario B abre su perfil público desde otro usuario.

Resultado esperado: la valoración aparece visible.

## Prueba 5 - Bloqueo

1. Usuario A entra en perfil de Usuario B.
2. Pulsa Bloquear.
3. Intenta chatear.
4. Luego pulsa Desbloquear.
5. Intenta chatear otra vez.

Resultado esperado: bloqueado no permite contacto; desbloqueado permite volver a contactar.

## Prueba 6 - Evento

1. Usuario profesional o admin publica un evento.
2. Usuario A busca ciudad y fecha.
3. Selecciona evento.
4. Pulsa Voy.
5. Entra en Quien va.
6. Abre Chat evento.
7. Abre BailaCar.

Resultado esperado: el evento aparece, asistentes funciona, chat evento abre y BailaCar carga.

## Anotar fallos

Para cada fallo apuntar:

- Usuario afectado.
- Pantalla.
- Boton pulsado.
- Mensaje de error exacto.
- Captura si se puede.
- Hora aproximada.
