import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_URL = "https://bailemos-api.onrender.com";

const ciudadesIniciales = [
  { id: 1, nombre: "Málaga" },
  { id: 2, nombre: "Madrid" },
  { id: 3, nombre: "Barcelona" },
  { id: 4, nombre: "Valencia" },
  { id: 5, nombre: "Sevilla" }
];

const estilosDisponibles = ["BACHATA", "SALSA", "KIZOMBA", "MERENGUE", "URBANO", "OTRO"];
const estilosEvento = ["BACHATA", "SALSA", "KIZOMBA", "OTRO"];
const MAX_FOTO_MB = 5;
const MAX_VIDEO_MB = 25;
const SPOTIFY_BAILEMOS_URL = "https://open.spotify.com/search/bachata%20salsa%20kizomba";
const PROFILE_PHOTO_KEY = "bailemos_profile_photo";
const EVENTS_CACHE_KEY = "bailemos_events_cache";
const CITIES_CACHE_KEY = "bailemos_cities_cache";
const PROFILE_CACHE_KEY = "bailemos_profile_cache";
const NOTIFICATION_SNAPSHOT_KEY = "bailemos_notification_snapshot";
const UNREAD_MESSAGES_KEY = "bailemos_unread_messages_count";
const FAVORITE_PLACES_KEY = "bailemos_favorite_places";

function storageGet(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Si el dispositivo no permite guardar mas datos, la app sigue funcionando sin cache.
  }
}

function leerArchivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function detectarEstilosEvento(texto) {
  const contenido = (texto || "").toUpperCase();
  const detectados = estilosEvento.filter((estilo) => contenido.includes(estilo));
  return detectados.length ? detectados : ["BACHATA"];
}

function claveLugarFavorito(evento) {
  const ciudad = (evento?.ciudadNombre || "").trim().toLowerCase();
  const lugar = (evento?.lugarNombre || evento?.titulo || "").trim().toLowerCase();
  return `${ciudad}::${lugar}`;
}

function nombreLugarFavorito(evento) {
  const lugar = evento?.lugarNombre || evento?.titulo || "Lugar BAILEMOS";
  const ciudad = evento?.ciudadNombre || "Ciudad pendiente";
  return `${lugar} - ${ciudad}`;
}

function crearSnapshotNotificaciones(solicitudes = [], chats = []) {
  return {
    solicitudes: solicitudes.map((item) => String(item.id || item.usuarioId)).sort(),
    chats: chats
      .map((chat) => `${chat.otroUsuarioId || chat.chatId}:${chat.ultimoMensaje || ""}`)
      .sort()
  };
}

function contarNovedadesNotificaciones(anterior, actual) {
  if (!anterior) return { total: 0, solicitudes: 0, mensajes: 0 };
  const solicitudesPrevias = new Set(anterior.solicitudes || []);
  const chatsPrevios = new Set(anterior.chats || []);
  const solicitudes = (actual.solicitudes || []).filter((item) => !solicitudesPrevias.has(item)).length;
  const mensajes = (actual.chats || []).filter((item) => !chatsPrevios.has(item)).length;
  return { total: solicitudes + mensajes, solicitudes, mensajes };
}

function leerNoLeidos() {
  const valor = Number(localStorage.getItem(UNREAD_MESSAGES_KEY) || 0);
  return Number.isFinite(valor) ? valor : 0;
}

function guardarNoLeidos(valor) {
  localStorage.setItem(UNREAD_MESSAGES_KEY, String(Math.max(0, valor)));
}

function actualizarBadgeIcono(total) {
  try {
    if ("setAppBadge" in navigator && total > 0) {
      navigator.setAppBadge(total);
    } else if ("clearAppBadge" in navigator && total <= 0) {
      navigator.clearAppBadge();
    }
  } catch {
    // Algunos navegadores no soportan badge en el icono. La app sigue funcionando.
  }
}

async function mostrarNotificacionLocal(titulo, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      registration.showNotification(titulo, {
        body,
        icon: "/bailemos_logo.jpeg",
        badge: "/bailemos_logo.jpeg",
        tag: "bailemos-notificaciones"
      });
      return;
    }
  } catch {
    // Si el service worker no esta listo, usamos Notification normal.
  }

  try {
    new Notification(titulo, { body, icon: "/bailemos_logo.jpeg" });
  } catch {
    // Navegador sin soporte completo.
  }
}

async function leerErrorServidor(response, fallback = "No se pudo completar la acción.") {
  try {
    const text = await response.text();
    if (!text) return fallback;
    const data = JSON.parse(text);
    return data.mensaje || data.message || data.error || fallback;
  } catch {
    return fallback;
  }
}

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("bailemos_session");
    return saved ? JSON.parse(saved) : null;
  });
  const [screen, setScreen] = useState(session ? "home" : "welcome");
  const [events, setEvents] = useState(() => storageGet(EVENTS_CACHE_KEY, []));
  const [event, setEvent] = useState(null);
  const [ciudades, setCiudades] = useState(() => storageGet(CITIES_CACHE_KEY, ciudadesIniciales));
  const [ciudadActiva, setCiudadActiva] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [miPerfil, setMiPerfil] = useState(() => storageGet(PROFILE_CACHE_KEY, null));
  const [fotoPerfilInicio, setFotoPerfilInicio] = useState(() => localStorage.getItem(PROFILE_PHOTO_KEY) || "");
  const [avisosMensajes, setAvisosMensajes] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    return "Notification" in window ? Notification.permission : "unsupported";
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const authHeaders = useMemo(() => {
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  }, [session]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (session) {
      if (!event && events.length) setEvent(events[0]);
      cargarInicio();
      cargarAvisos();
    }
  }, [session]);

  useEffect(() => {
    if (!session?.token) return;
    const interval = window.setInterval(cargarAvisos, 45000);
    return () => window.clearInterval(interval);
  }, [session?.token, authHeaders]);

  useEffect(() => {
    actualizarBadgeIcono(avisosMensajes);
  }, [avisosMensajes]);

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Error ${response.status}`);
    return response.json();
  }

  async function cargarInicio() {
    setLoading(events.length === 0);
    try {
      const [eventosResult, ciudadesResult, activaResult, perfilResult] = await Promise.allSettled([
        api("/eventos"),
        api("/ciudades"),
        api("/usuarios/ciudad-activa/me", { headers: authHeaders }),
        api("/perfil/me", { headers: authHeaders })
      ]);

      if (eventosResult.status === "fulfilled") {
        const eventosData = eventosResult.value || [];
        setEvents(eventosData);
        storageSet(EVENTS_CACHE_KEY, eventosData);
        setEvent((actual) => {
          if (!eventosData.length) return null;
          return eventosData.find((item) => Number(item.id) === Number(actual?.id)) || eventosData[0];
        });
      }

      if (ciudadesResult.status === "fulfilled") {
        const ciudadesData = ciudadesResult.value?.length ? ciudadesResult.value : ciudadesIniciales;
        setCiudades(ciudadesData);
        storageSet(CITIES_CACHE_KEY, ciudadesData);
      }

      setCiudadActiva(activaResult.status === "fulfilled" ? activaResult.value : null);

      if (perfilResult.status === "fulfilled") {
        const perfilResponse = perfilResult.value;
        setMiPerfil(perfilResponse);
        storageSet(PROFILE_CACHE_KEY, perfilResponse);
        const foto = perfilResponse?.fotoData || perfilResponse?.fotoUrl || "";
        if (foto) {
          localStorage.setItem(PROFILE_PHOTO_KEY, foto);
          setFotoPerfilInicio(foto);
        }
      }
    } catch {
      setNotice("No se pudieron cargar los datos. Prueba de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function cargarAvisos() {
    if (!session?.token) {
      setAvisosMensajes(0);
      actualizarBadgeIcono(0);
      return;
    }

    try {
      const [solicitudesResponse, chatsResponse] = await Promise.all([
        fetch(`${API_URL}/social/amistad/solicitudes`, { headers: authHeaders }),
        fetch(`${API_URL}/chat/privados`, { headers: authHeaders })
      ]);
      if (!solicitudesResponse.ok) throw new Error();
      const solicitudes = await solicitudesResponse.json();
      const chats = chatsResponse.ok ? await chatsResponse.json() : [];
      const snapshotAnterior = storageGet(NOTIFICATION_SNAPSHOT_KEY, null);
      const snapshotActual = crearSnapshotNotificaciones(solicitudes, chats);
      const novedades = contarNovedadesNotificaciones(snapshotAnterior, snapshotActual);

      if (snapshotAnterior && novedades.total > 0) {
        const noLeidos = leerNoLeidos() + novedades.mensajes;
        guardarNoLeidos(noLeidos);
        const texto = novedades.solicitudes > 0
          ? "Tienes una nueva solicitud de amistad en BAILEMOS."
          : "Tienes un nuevo mensaje en BAILEMOS.";
        mostrarNotificacionLocal("BAILEMOS!", texto);
      }

      storageSet(NOTIFICATION_SNAPSHOT_KEY, snapshotActual);
      setAvisosMensajes((solicitudes.length || 0) + leerNoLeidos());
    } catch {
      setAvisosMensajes(0);
    }
  }

  async function activarNotificaciones() {
    if (!("Notification" in window)) {
      setNotice("Este dispositivo o navegador no permite notificaciones web.");
      setNotificationPermission("unsupported");
      return;
    }

    try {
      const permiso = await Notification.requestPermission();
      setNotificationPermission(permiso);
      if (permiso === "granted") {
        setNotice("Notificaciones activadas.");
        mostrarNotificacionLocal("BAILEMOS!", "Te avisaremos cuando tengas mensajes o solicitudes.");
        cargarAvisos();
      } else {
        setNotice("No se activaron las notificaciones. Puedes permitirlas desde ajustes del navegador.");
      }
    } catch {
      setNotice("No se pudieron activar las notificaciones.");
    }
  }

  function abrirMensajes() {
    guardarNoLeidos(0);
    setAvisosMensajes(0);
    actualizarBadgeIcono(0);
    setScreen("messages");
    window.setTimeout(cargarAvisos, 250);
  }

  function guardarSesion(data) {
    localStorage.setItem("bailemos_session", JSON.stringify(data));
    setSession(data);
    setScreen("home");
  }

  function cerrarSesion() {
    localStorage.removeItem("bailemos_session");
    localStorage.removeItem(PROFILE_PHOTO_KEY);
    localStorage.removeItem(PROFILE_CACHE_KEY);
    localStorage.removeItem(NOTIFICATION_SNAPSHOT_KEY);
    localStorage.removeItem(UNREAD_MESSAGES_KEY);
    setSession(null);
    setMiPerfil(null);
    setFotoPerfilInicio("");
    setAvisosMensajes(0);
    actualizarBadgeIcono(0);
    setScreen("welcome");
    setNotice("");
  }

  async function marcarAsistencia(tipo) {
    if (!event) {
      setNotice("Primero publica o selecciona un evento.");
      return;
    }

    const rutas = {
      interesado: `/eventos/${event.id}/interesado`,
      voy: `/eventos/${event.id}/voy`,
      noVoy: `/eventos/${event.id}/no-voy`
    };
    const mensajes = {
      interesado: "Marcado como interesado.",
      voy: "Ya apareces como asistente.",
      noVoy: "Marcado como no voy."
    };

    try {
      await api(rutas[tipo], { method: "POST", headers: authHeaders });
      setNotice(mensajes[tipo]);
      cargarInicio();
    } catch {
      setNotice("No se pudo guardar tu respuesta.");
    }
  }

  async function marcarCiudad(ciudad) {
    try {
      const data = await api(`/usuarios/ciudad-activa/${ciudad.id}`, {
        method: "POST",
        headers: authHeaders
      });
      setCiudadActiva(data);
      setScreen("city");
    } catch {
      setNotice("No se pudo activar la ciudad.");
    }
  }

  if (screen === "welcome") {
    return <WelcomePro onLogin={() => setScreen("login")} onRegister={() => setScreen("register")} onLegal={() => setScreen("legal-public")} />;
  }

  if (screen === "login") {
    return <LoginPro onBack={() => setScreen("welcome")} onSuccess={guardarSesion} onForgot={() => setScreen("forgot-password")} />;
  }

  if (screen === "register") {
    return <RegisterPro onBack={() => setScreen("welcome")} onSuccess={guardarSesion} />;
  }

  if (screen === "forgot-password") {
    return <ForgotPassword onBack={() => setScreen("login")} />;
  }

  if (screen === "legal-public") {
    return <LegalPanel onBack={() => setScreen("welcome")} />;
  }

  return (
    <main className="app-shell">
      <Header
        session={session}
        perfil={miPerfil}
        fotoPerfilInicio={fotoPerfilInicio}
        avisosMensajes={avisosMensajes}
        notificationPermission={notificationPermission}
        onEnableNotifications={activarNotificaciones}
        onOpenMessages={abrirMensajes}
        onLogout={cerrarSesion}
      />
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}

      {screen === "home" && (
        <HomeView
          session={session}
          loading={loading}
          event={event}
          events={events}
          ciudades={ciudades}
          ciudadActiva={ciudadActiva}
          onInteresado={() => marcarAsistencia("interesado")}
          onVoy={() => marcarAsistencia("voy")}
          onNoVoy={() => marcarAsistencia("noVoy")}
          onSelectEvent={setEvent}
          onOpenChat={() => setScreen(event ? "event-chat" : "general-chat")}
          onOpenGeneralChat={() => setScreen("general-chat")}
          onOpenPeople={() => setScreen("people")}
          onOpenFriends={() => setScreen("friends")}
          onOpenMessages={abrirMensajes}
          avisosMensajes={avisosMensajes}
          onOpenProfile={() => setScreen("profile")}
          onOpenBailaCar={() => setScreen("bailacar")}
          onOpenPublish={() => setScreen("publish-event")}
          onOpenMagic={() => setScreen("magic")}
          onOpenRating={() => setScreen("rating")}
          onOpenOrganizer={() => setScreen("organizer")}
          onOpenAdmin={() => setScreen("admin")}
          onOpenLegal={() => setScreen("legal")}
          onOpenNotifications={() => setScreen("notifications")}
          onOpenPro={() => setScreen("pro")}
          onOpenEventDetail={() => setScreen("event-detail")}
          onEditEvent={() => {
            setEditingEvent(event);
            setScreen("edit-event");
          }}
          onOpenAttendees={() => setScreen("attendees")}
          onCiudad={marcarCiudad}
          authHeaders={authHeaders}
        />
      )}

      {screen === "legal" && <LegalPanel onBack={() => setScreen("home")} />}

      {screen === "notifications" && (
        <NotificationsPanel authHeaders={authHeaders} events={events} onBack={() => setScreen("home")} />
      )}

      {screen === "pro" && <ProductReadinessPanel onBack={() => setScreen("home")} />}

      {screen === "event-detail" && event && (
        <EventDetailPanel
          event={event}
          onBack={() => setScreen("home")}
          onInteresado={() => marcarAsistencia("interesado")}
          onVoy={() => marcarAsistencia("voy")}
          onNoVoy={() => marcarAsistencia("noVoy")}
          onOpenAttendees={() => setScreen("attendees")}
          onOpenChat={() => setScreen("event-chat")}
          onOpenBailaCar={() => setScreen("bailacar")}
        />
      )}

      {screen === "attendees" && event && (
        <AttendeesPanel
          event={event}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onOpenProfile={(persona) => {
            setSelectedUser({ usuarioId: persona.usuarioId, nombre: persona.nombre, rol: persona.rol });
            setScreen("public-profile");
          }}
        />
      )}

      {screen === "admin" && (
        <AdminPanel authHeaders={authHeaders} session={session} onBack={() => setScreen("home")} />
      )}

      {screen === "event-chat" && (
        <ChatPanel
          title={event ? `Chat: ${event.titulo}` : "Chat general"}
          endpointGet={event ? `/chat/evento/${event.id}` : "/chat/general"}
          endpointPost={event ? `/chat/evento/${event.id}/mensajes` : "/chat/general/mensajes"}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "general-chat" && (
        <ChatPanel
          title="Chat general BAILEMOS"
          endpointGet="/chat/general"
          endpointPost="/chat/general/mensajes"
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "city" && (
        <CityPanel
          ciudadActiva={ciudadActiva}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onRate={(usuarioId) => setScreen(`rating:${usuarioId}`)}
          onMessage={(persona) => {
            setSelectedUser({ usuarioId: persona.usuarioId, nombre: persona.nombre, rol: persona.rol });
            setScreen("private-chat");
          }}
        />
      )}

      {screen === "people" && (
        <PeoplePanel
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onOpenProfile={(persona) => {
            setSelectedUser(persona);
            setScreen("public-profile");
          }}
          onMessage={(persona) => {
            setSelectedUser(persona);
            setScreen("private-chat");
          }}
          onRate={(usuarioId) => setScreen(`rating:${usuarioId}`)}
        />
      )}

      {screen === "friends" && (
        <FriendsPanel
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onOpenProfile={(persona) => {
            setSelectedUser(persona);
            setScreen("public-profile");
          }}
          onMessage={(persona) => {
            setSelectedUser(persona);
            setScreen("private-chat");
          }}
        />
      )}

      {screen === "public-profile" && selectedUser && (
        <PublicProfilePanel
          user={selectedUser}
          events={events}
          authHeaders={authHeaders}
          onBack={() => setScreen("people")}
          onOpenMessages={abrirMensajes}
          onMessage={(persona) => {
            setSelectedUser(persona);
            setScreen("private-chat");
          }}
        />
      )}

      {screen === "messages" && (
        <MessagesPanel
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onOpen={(chat) => {
            setSelectedUser({
              usuarioId: chat.otroUsuarioId,
              nombre: chat.otroUsuarioNombre,
              rol: chat.otroUsuarioRol
            });
            setScreen("private-chat");
          }}
          onUpdated={cargarAvisos}
        />
      )}

      {screen === "profile" && (
        <ProfilePanel
          session={session}
          ciudades={ciudades}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onSaved={(perfil) => {
            const updated = { ...session, nombre: perfil.nombre || session.nombre };
            const foto = perfil.fotoData || perfil.fotoUrl || "";
            localStorage.setItem("bailemos_session", JSON.stringify(updated));
            if (foto) {
              localStorage.setItem(PROFILE_PHOTO_KEY, foto);
              setFotoPerfilInicio(foto);
            }
            setSession(updated);
            setMiPerfil(perfil);
            setNotice("Perfil actualizado.");
            setScreen("home");
          }}
        />
      )}

      {screen === "organizer" && (
        <OrganizerPortal
          ciudades={ciudades}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onCreated={(created) => {
            setNotice("Evento importado/publicado.");
            setEvent(created);
            cargarInicio();
            setScreen("home");
          }}
        />
      )}

      {screen === "private-chat" && selectedUser && (
        <ChatPanel
          title={`Chat con ${selectedUser.nombre}`}
          endpointGet={`/chat/privado/${selectedUser.usuarioId}`}
          endpointPost={`/chat/privado/${selectedUser.usuarioId}/mensajes`}
          authHeaders={authHeaders}
          onBack={() => setScreen("people")}
        />
      )}

      {screen === "bailacar" && (
        <BailaCar onBack={() => setScreen("home")} event={event} authHeaders={authHeaders} />
      )}

      {screen === "publish-event" && (
        <PublishEvent
          ciudades={ciudades}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
          onCreated={(created) => {
            setNotice("Evento publicado.");
            setEvent(created);
            cargarInicio();
            setScreen("home");
          }}
        />
      )}

      {screen === "edit-event" && editingEvent && (
        <PublishEvent
          ciudades={ciudades}
          authHeaders={authHeaders}
          editingEvent={editingEvent}
          onBack={() => setScreen("home")}
          onCreated={(updated) => {
            setNotice("Evento actualizado.");
            setEvent(updated);
            setEditingEvent(null);
            cargarInicio();
            setScreen("home");
          }}
        />
      )}

      {screen === "magic" && (
        <MagicPanel
          events={events}
          ciudades={ciudades}
          ciudadActiva={ciudadActiva}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "rating" && (
        <RatingPanel session={session} authHeaders={authHeaders} onBack={() => setScreen("home")} />
      )}

      {screen.startsWith("rating:") && (
        <RatingPanel
          session={session}
          authHeaders={authHeaders}
          defaultUserId={Number(screen.split(":")[1])}
          onBack={() => setScreen("city")}
        />
      )}
    </main>
  );
}

function Welcome({ onLogin, onRegister }) {
  return (
    <main className="welcome">
      <img className="logo hero-logo" src="/bailemos_logo.jpeg" alt="BAILEMOS!" />
      <h1>BAILEMOS!</h1>
      <p>Baila. Conecta. Vive el baile.</p>
      <div className="stack">
        <button className="primary" onClick={onLogin}>Iniciar sesión</button>
        <button className="secondary" onClick={onRegister}>Crear cuenta</button>
      </div>
    </main>
  );
}

function Login({ onBack, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      });
      onSuccess(data);
    } catch {
      alert("Usuario o contraseña incorrectos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Entrar" onBack={onBack}>
      <form onSubmit={submit} className="stack">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contrasena" type="password" required />
        <button className="primary" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </AuthCard>
  );
}

function Register({ onBack, onSuccess }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState("BAILADOR");
  const [codigoAdmin, setCodigoAdmin] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          email,
          password,
          rol: codigoAdmin.trim() ? "SUPER_ADMIN" : rol,
          codigoAdmin: codigoAdmin.trim() || null
        })
      }).then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      });
      onSuccess(data);
    } catch {
      alert("No se pudo crear la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Crear cuenta" onBack={onBack}>
      <form onSubmit={submit} className="stack">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" required />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contrasena" type="password" minLength="6" required />
        <div className="segmented">
          <button type="button" className={rol === "BAILADOR" ? "active" : ""} onClick={() => setRol("BAILADOR")}>Bailador</button>
          <button type="button" className={rol === "PROFESIONAL" ? "active" : ""} onClick={() => setRol("PROFESIONAL")}>Profesional</button>
        </div>
        <input value={codigoAdmin} onChange={(e) => setCodigoAdmin(e.target.value)} placeholder="Código privado admin (solo Jonathan)" type="password" />
        <button className="primary" disabled={busy}>{busy ? "Creando..." : "Crear cuenta"}</button>
      </form>
    </AuthCard>
  );
}

function AuthCard({ title, onBack, children }) {
  return (
    <main className="app-shell auth-page">
      <button className="back" onClick={onBack}>Volver</button>
      <img className="logo" src="/bailemos_logo.jpeg" alt="BAILEMOS!" />
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function WelcomePro({ onLogin, onRegister, onLegal }) {
  return (
    <main className="welcome">
      <img className="logo hero-logo" src="/bailemos_logo.jpeg" alt="BAILEMOS!" />
      <h1>BAILEMOS!</h1>
      <p>Baila. Conecta. Vive el baile.</p>
      <div className="stack">
        <button className="primary" onClick={onLogin}>Iniciar sesion</button>
        <button className="secondary" onClick={onRegister}>Crear cuenta</button>
        <button className="ghost center-button" onClick={onLegal}>Privacidad y condiciones</button>
      </div>
    </main>
  );
}

function LoginPro({ onBack, onSuccess, onForgot }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) throw new Error();
      onSuccess(await response.json());
    } catch {
      alert("Usuario o contrasena incorrectos.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Entrar" onBack={onBack}>
      <form onSubmit={submit} className="stack">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contrasena" type="password" required />
        <button className="primary" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
        <button type="button" className="ghost center-button" onClick={onForgot}>Olvide mi contrasena</button>
      </form>
    </AuthCard>
  );
}

function RegisterPro({ onBack, onSuccess }) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState("BAILADOR");
  const [codigoAdmin, setCodigoAdmin] = useState("");
  const [aceptoLegal, setAceptoLegal] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!aceptoLegal) {
      alert("Debes aceptar las condiciones, la politica de privacidad y las normas de comunidad.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          email,
          password,
          rol: codigoAdmin.trim() ? "SUPER_ADMIN" : rol,
          codigoAdmin: codigoAdmin.trim() || null
        })
      });
      if (!response.ok) {
        alert(await leerErrorServidor(response, "No se pudo crear la cuenta."));
        return;
      }
      onSuccess(await response.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Crear cuenta" onBack={onBack}>
      <form onSubmit={submit} className="stack">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" required />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contrasena" type="password" minLength="6" required />
        <div className="segmented">
          <button type="button" className={rol === "BAILADOR" ? "active" : ""} onClick={() => setRol("BAILADOR")}>Bailador</button>
          <button type="button" className={rol === "PROFESIONAL" ? "active" : ""} onClick={() => setRol("PROFESIONAL")}>Profesional</button>
        </div>
        <input value={codigoAdmin} onChange={(e) => setCodigoAdmin(e.target.value)} placeholder="Codigo privado admin (solo Jonathan)" type="password" />
        <label className="check-row">
          <input type="checkbox" checked={aceptoLegal} onChange={(e) => setAceptoLegal(e.target.checked)} />
          <span>Acepto condiciones, privacidad y normas de comunidad.</span>
        </label>
        <button className="primary" disabled={busy}>{busy ? "Creando..." : "Crear cuenta"}</button>
      </form>
    </AuthCard>
  );
}

function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nuevoPassword, setNuevoPassword] = useState("");
  const [mensaje, setMensaje] = useState("");

  async function solicitar(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/auth/password/forgot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      alert(await leerErrorServidor(response, "No se pudo generar el codigo."));
      return;
    }
    const data = await response.json();
    setMensaje(data.codigoTemporal ? `Codigo temporal: ${data.codigoTemporal}` : data.mensaje);
  }

  async function cambiar(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/auth/password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codigo, nuevaPassword: nuevoPassword })
    });
    if (!response.ok) {
      alert(await leerErrorServidor(response, "No se pudo cambiar la contrasena."));
      return;
    }
    alert("Contrasena actualizada. Ya puedes iniciar sesion.");
    onBack();
  }

  return (
    <AuthCard title="Recuperar cuenta" onBack={onBack}>
      <form className="card stack" onSubmit={solicitar}>
        <h3>1. Generar codigo</h3>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
        <button className="primary">Generar codigo temporal</button>
        {mensaje && <p className="notice-text">{mensaje}</p>}
      </form>
      <form className="card stack" onSubmit={cambiar}>
        <h3>2. Cambiar contrasena</h3>
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Codigo" required />
        <input value={nuevoPassword} onChange={(e) => setNuevoPassword(e.target.value)} placeholder="Nueva contrasena" type="password" minLength="6" required />
        <button className="primary">Actualizar contrasena</button>
      </form>
    </AuthCard>
  );
}

function Header({
  session,
  perfil,
  fotoPerfilInicio,
  avisosMensajes = 0,
  notificationPermission,
  onEnableNotifications,
  onOpenMessages,
  onLogout
}) {
  const fotoPerfil = perfil?.fotoData || perfil?.fotoUrl || fotoPerfilInicio || "/bailemos_logo.jpeg";
  const nombre = perfil?.nombreArtistico || session?.nombre || "bailador";
  const notificacionesActivas = notificationPermission === "granted";

  return (
    <header className="topbar">
      <img className="header-profile-photo" src={fotoPerfil} alt={nombre} />
      <div className="hello-copy">
        <strong>Hola {nombre}</strong>
        <span>Hoy es un buen dia para bailar. Vamos a ello.</span>
      </div>
      <button
        className={`icon-action ${avisosMensajes > 0 ? "with-badge" : ""}`}
        onClick={onOpenMessages}
        title="Mensajes"
        aria-label="Abrir mensajes"
      >
        M
        {avisosMensajes > 0 && <span className="badge">{avisosMensajes}</span>}
      </button>
      {!notificacionesActivas && notificationPermission !== "unsupported" && (
        <button className="icon-action" onClick={onEnableNotifications} title="Activar notificaciones" aria-label="Activar notificaciones">
          N
        </button>
      )}
      <button className="ghost" onClick={onLogout}>Salir</button>
    </header>
  );
}

function Home({
  session,
  loading,
  event,
  events,
  ciudades,
  ciudadActiva,
  onVoy,
  onOpenChat,
  onOpenGeneralChat,
  onOpenPeople,
  onOpenFriends,
  onOpenMessages,
  avisosMensajes = 0,
  onOpenProfile,
  onOpenBailaCar,
  onOpenPublish,
  onOpenMagic,
  onOpenRating,
  onOpenOrganizer,
  onOpenAdmin,
  onOpenAttendees,
  onCiudad,
  authHeaders
}) {
  const esAdmin = session?.rol === "ADMIN" || session?.rol === "SUPER_ADMIN";
  const esPerfilProfesional = ["PROFESIONAL", "ORGANIZADOR", "ACADEMIA", "SALA", "ADMIN", "SUPER_ADMIN"].includes(session?.rol);

  return (
    <section className="screen">
      <div className="accent" />
      <h2>Donde se baila hoy</h2>
      <input className="search" placeholder="Buscar eventos, ciudades o salas" />

      <div className="quick-grid">
        {esPerfilProfesional && <button onClick={onOpenPublish}>Publicar evento</button>}
        <button onClick={onOpenMagic}>Haz tu magia</button>
        <button onClick={onOpenPeople}>Gente</button>
        <button onClick={onOpenFriends}>Mis amigos</button>
        <button className={avisosMensajes > 0 ? "with-badge" : ""} onClick={onOpenMessages}>
          Mensajes
          {avisosMensajes > 0 && <span className="badge">{avisosMensajes}</span>}
        </button>
        <button onClick={onOpenProfile}>Mi perfil</button>
        <button onClick={onOpenGeneralChat}>Chat general</button>
        {esPerfilProfesional && <button onClick={onOpenOrganizer}>Portal salas</button>}
        <button onClick={onOpenRating}>Valorar</button>
        {esAdmin && <button onClick={onOpenAdmin}>Admin</button>}
      </div>

      <article className="card feature-card">
        <small>{event?.ciudadNombre || "BAILEMOS!"}</small>
        <h3>{loading ? "Cargando eventos..." : event?.titulo || "No hay eventos publicados"}</h3>
        <p>{event ? `${event.lugarNombre || "Lugar pendiente"} - Van ${event.asistentes || 0} personas` : "Puedes publicar un evento o entrar al chat general."}</p>
        <div className="actions">
          <button className="primary" onClick={onVoy} disabled={!event}>Voy</button>
          <button className="secondary" onClick={onOpenAttendees} disabled={!event}>Quién va</button>
          <button className="secondary" onClick={onOpenChat}>{event ? "Chat evento" : "Chat general"}</button>
        </div>
        <button className="secondary full-button" onClick={onOpenBailaCar}>BailaCar</button>
      </article>

      <section className="card">
        <h3>Playlist BAILEMOS</h3>
        <p>Musica para calentar la pista: bachata, salsa y kizomba.</p>
        <a className="primary link-button" href={SPOTIFY_BAILEMOS_URL} target="_blank" rel="noreferrer">Escuchar en Spotify</a>
      </section>

      <section className="card">
        <h3>Estoy en una ciudad</h3>
        <p>{ciudadActiva ? `Ahora estás en ${ciudadActiva.ciudadNombre}` : "Elige ciudad para ver gente, eventos y chat local."}</p>
        <div className="chips">
          {ciudades.map((ciudad) => (
            <button key={ciudad.id} onClick={() => onCiudad(ciudad)}>{ciudad.nombre}</button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Eventos disponibles</h3>
        <div className="list">
          {events.length === 0 && <p className="muted">Aún no hay eventos. Publica el primero.</p>}
          {events.map((item) => (
            <div key={item.id} className="list-row">
              <strong>{item.titulo}</strong>
              <span>{item.ciudadNombre} - {item.lugarNombre}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function HomeView({
  session,
  loading,
  event,
  events,
  ciudades,
  ciudadActiva,
  onInteresado,
  onVoy,
  onNoVoy,
  onSelectEvent,
  onOpenChat,
  onOpenGeneralChat,
  onOpenPeople,
  onOpenFriends,
  onOpenMessages,
  avisosMensajes = 0,
  onOpenProfile,
  onOpenBailaCar,
  onOpenPublish,
  onOpenMagic,
  onOpenRating,
  onOpenOrganizer,
  onOpenAdmin,
  onOpenLegal,
  onOpenNotifications,
  onOpenPro,
  onOpenEventDetail,
  onEditEvent,
  onOpenAttendees,
  onCiudad
}) {
  const esAdmin = session?.rol === "ADMIN" || session?.rol === "SUPER_ADMIN";
  const esPerfilProfesional = ["PROFESIONAL", "ORGANIZADOR", "ACADEMIA", "SALA", "ADMIN", "SUPER_ADMIN"].includes(session?.rol);
  const puedeEditarEvento = Boolean(event && esPerfilProfesional && (esAdmin || Number(event.organizadorId) === Number(session?.usuarioId)));
  const cartelActual = event?.cartelData || event?.cartelUrl || "";
  const [busqueda, setBusqueda] = useState("");
  const [busquedaActiva, setBusquedaActiva] = useState("");
  const [lugaresFavoritos, setLugaresFavoritos] = useState(() => storageGet(FAVORITE_PLACES_KEY, []));

  const normalizar = (valor) => (valor || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const eventosFiltrados = useMemo(() => {
    const texto = normalizar(busquedaActiva);
    const filtrados = texto ? events.filter((item) => {
      const contenido = [
        item.titulo,
        item.descripcion,
        item.ciudadNombre,
        item.lugarNombre,
        item.direccion,
        item.tipoEvento,
        item.djNombre,
        item.profesorNombre,
        item.nivel,
        item.telefonoContacto,
        item.instagram,
        item.enlaceExterno,
        ...(item.estilos || [])
      ].join(" ");
      return normalizar(contenido).includes(texto);
    }) : events;

    return [...filtrados].sort((a, b) => {
      const aFavorito = lugaresFavoritos.includes(claveLugarFavorito(a)) ? 1 : 0;
      const bFavorito = lugaresFavoritos.includes(claveLugarFavorito(b)) ? 1 : 0;
      if (aFavorito !== bFavorito) return bFavorito - aFavorito;
      return new Date(a.fechaInicio || 0) - new Date(b.fechaInicio || 0);
    });
  }, [busquedaActiva, events, lugaresFavoritos]);

  const lugaresFavoritosActivos = useMemo(() => {
    const mapa = new Map();
    events.forEach((item) => {
      const clave = claveLugarFavorito(item);
      if (lugaresFavoritos.includes(clave) && !mapa.has(clave)) {
        mapa.set(clave, { clave, nombre: nombreLugarFavorito(item), evento: item });
      }
    });
    return Array.from(mapa.values());
  }, [events, lugaresFavoritos]);

  function esLugarFavorito(item) {
    return lugaresFavoritos.includes(claveLugarFavorito(item));
  }

  function alternarLugarFavorito(item) {
    const clave = claveLugarFavorito(item);
    const siguiente = lugaresFavoritos.includes(clave)
      ? lugaresFavoritos.filter((favorito) => favorito !== clave)
      : [...lugaresFavoritos, clave];
    setLugaresFavoritos(siguiente);
    storageSet(FAVORITE_PLACES_KEY, siguiente);
  }

  function buscarEventos(eventSubmit) {
    eventSubmit.preventDefault();
    setBusquedaActiva(busqueda.trim());
  }

  function elegirEvento(item) {
    onSelectEvent(item);
    setBusquedaActiva(busqueda.trim() || item.ciudadNombre || item.lugarNombre || "");
  }

  return (
    <section className="screen">
      <div className="accent" />
      <section className="home-status">
        <div>
          <small>BAILEMOS hoy</small>
          <strong>{events.length}</strong>
          <span>{events.length === 1 ? "evento disponible" : "eventos disponibles"}</span>
        </div>
        <div>
          <small>Mensajes</small>
          <strong>{avisosMensajes}</strong>
          <span>{avisosMensajes === 1 ? "aviso pendiente" : "avisos pendientes"}</span>
        </div>
      </section>
      <h2>Donde se baila hoy</h2>
      <form className="search-row" onSubmit={buscarEventos}>
        <input
          className="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Busca Malaga, Barcelona, sala, bachata, salsa..."
        />
        <button className="primary">Buscar</button>
      </form>

      <div className="quick-grid">
        <button className="primary" onClick={onOpenEventDetail} disabled={!event}>Evento elegido</button>
        <button className="primary" onClick={onVoy} disabled={!event}>Voy</button>
        {esPerfilProfesional && <button onClick={onOpenPublish}>Publicar evento</button>}
        <button onClick={onOpenMagic}>Haz tu magia</button>
        <button onClick={onOpenPeople}>Gente</button>
        <button onClick={onOpenFriends}>Mis amigos</button>
        <button className={avisosMensajes > 0 ? "with-badge" : ""} onClick={onOpenMessages}>
          Mensajes
          {avisosMensajes > 0 && <span className="badge">{avisosMensajes}</span>}
        </button>
        <button onClick={onOpenProfile}>Mi perfil</button>
        <button onClick={onOpenGeneralChat}>Chat general</button>
        {esPerfilProfesional && <button onClick={onOpenOrganizer}>Portal salas</button>}
        <button onClick={onOpenRating}>Valorar</button>
        <button onClick={onOpenNotifications}>Notificaciones</button>
        <button onClick={onOpenLegal}>Legal</button>
        <button onClick={onOpenPro}>Producto Pro</button>
        {esAdmin && <button onClick={onOpenAdmin}>Admin</button>}
      </div>

      <article className="card feature-card">
        <small>{event ? "Lugar elegido" : "BAILEMOS!"}</small>
        <h3>{loading ? "Cargando eventos..." : event ? (event.lugarNombre || event.titulo) : "No hay eventos publicados"}</h3>
        {event && <p className="event-title-line">{event.titulo} - {event.ciudadNombre}</p>}
        {cartelActual ? (
          <img className="event-poster" src={cartelActual} alt={`Cartel de ${event.titulo}`} />
        ) : (
          <div className="event-poster empty-poster">Cartel pendiente</div>
        )}
        <p>
          {event
            ? `${event.lugarNombre || "Lugar pendiente"} - Van ${event.asistentes || 0} personas`
            : "Puedes publicar un evento o entrar al chat general."}
        </p>
        {event && (
          <button className="favorite-place-button" type="button" onClick={() => alternarLugarFavorito(event)}>
            {esLugarFavorito(event) ? "Quitar de favoritos" : "Marcar sitio favorito"}
          </button>
        )}
        <div className="actions attendance-actions">
          <button className="secondary" onClick={onInteresado} disabled={!event}>Interesado</button>
          <button className="primary" onClick={onVoy} disabled={!event}>Voy</button>
          <button className="secondary" onClick={onNoVoy} disabled={!event}>No voy</button>
        </div>
        <div className="actions">
          <button className="secondary" onClick={onOpenEventDetail} disabled={!event}>Ver mas</button>
          <button className="secondary" onClick={onOpenAttendees} disabled={!event}>Quien va</button>
          <button className="secondary" onClick={onOpenChat}>{event ? "Chat evento" : "Chat general"}</button>
        </div>
        <button className="secondary full-button" onClick={onOpenBailaCar}>BailaCar</button>
        {puedeEditarEvento && (
          <button className="secondary full-button" type="button" onClick={onEditEvent}>Editar evento</button>
        )}
      </article>

      <section className="card">
        <h3>Playlist BAILEMOS</h3>
        <p>Musica para calentar la pista: bachata, salsa y kizomba.</p>
        <a className="primary link-button" href={SPOTIFY_BAILEMOS_URL} target="_blank" rel="noreferrer">Escuchar en Spotify</a>
      </section>

      <section className="card">
        <h3>Estoy en una ciudad</h3>
        <p>{ciudadActiva ? `Ahora estas en ${ciudadActiva.ciudadNombre}` : "Elige ciudad para ver gente, eventos y chat local."}</p>
        <div className="chips">
          {ciudades.map((ciudad) => (
            <button key={ciudad.id} onClick={() => onCiudad(ciudad)}>{ciudad.nombre}</button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>{busquedaActiva ? `Resultados para "${busquedaActiva}"` : "Eventos disponibles"}</h3>
        {lugaresFavoritosActivos.length > 0 && (
          <div className="favorite-strip">
            <strong>Sitios favoritos</strong>
            {lugaresFavoritosActivos.map((favorito) => (
              <button key={favorito.clave} type="button" onClick={() => elegirEvento(favorito.evento)}>
                {favorito.nombre}
              </button>
            ))}
          </div>
        )}
        <div className="list">
          {eventosFiltrados.length === 0 && <p className="muted">No hay fiestas para esa busqueda todavia. Publica una o prueba otra ciudad.</p>}
          {eventosFiltrados.slice(0, 8).map((item) => (
            <div key={item.id} className={`event-result-wrap ${Number(item.id) === Number(event?.id) ? "active" : ""} ${esLugarFavorito(item) ? "favorite" : ""}`}>
              <button className="list-row event-result" onClick={() => elegirEvento(item)}>
                <strong>{esLugarFavorito(item) ? "Favorito - " : ""}{item.titulo}</strong>
                <span>{item.ciudadNombre} - {item.lugarNombre || "Lugar pendiente"} - Van {item.asistentes || 0}</span>
                <small>{item.estilos?.join(" / ") || "Bachata / Salsa / Kizomba"}</small>
              </button>
              <button className="favorite-mini" type="button" onClick={() => alternarLugarFavorito(item)}>
                {esLugarFavorito(item) ? "Quitar" : "Favorito"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function CityPanel({ ciudadActiva, authHeaders, onBack, onRate, onMessage }) {
  const ciudadId = ciudadActiva?.ciudadId;
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    if (!ciudadId) return;
    fetch(`${API_URL}/usuarios/ciudad/${ciudadId}`, { headers: authHeaders })
      .then((response) => response.json())
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, [ciudadId]);

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>{ciudadActiva?.ciudadNombre || "Ciudad"}</h2>
      <p className="muted">Personas conectadas a esta ciudad.</p>
      <div className="card">
        {personas.length === 0 ? (
          <p>Todavía no hay personas conectadas.</p>
        ) : (
          personas.map((persona) => (
            <div className="list-row with-action" key={persona.usuarioId}>
              <span>
                <strong>{persona.nombre}</strong>
                <small>{persona.rol}{persona.amigoMio ? " - Amigo" : ""}</small>
              </span>
              <div className="mini-actions">
                <button className="secondary compact" onClick={() => onMessage(persona)}>Mensaje</button>
                <button className="secondary compact" onClick={() => onRate(persona.usuarioId)}>Valorar</button>
              </div>
            </div>
          ))
        )}
      </div>
      <ChatPanel
        embedded
        title={`Chat de ${ciudadActiva?.ciudadNombre || "ciudad"}`}
        endpointGet={ciudadId ? `/chat/ciudad/${ciudadId}` : "/chat/general"}
        endpointPost={ciudadId ? `/chat/ciudad/${ciudadId}/mensajes` : "/chat/general/mensajes"}
        authHeaders={authHeaders}
      />
    </section>
  );
}

function AttendeesPanel({ event, authHeaders, onBack, onOpenProfile }) {
  const [asistentes, setAsistentes] = useState([]);

  useEffect(() => {
    if (!event?.id) return;
    fetch(`${API_URL}/eventos/${event.id}/asistentes`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : [])
      .then(setAsistentes)
      .catch(() => setAsistentes([]));
  }, [event?.id]);

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h3>Quién va</h3>
      <p className="muted">{event.titulo}</p>
      <div className="card">
      {asistentes.length === 0 ? (
        <p className="muted">Aún no hay asistentes confirmados.</p>
      ) : (
        asistentes.map((persona) => (
          <button className="list-row person-link full-width" key={persona.usuarioId} onClick={() => onOpenProfile(persona)}>
            <strong>{persona.nombre} {persona.amigoMio && <span className="friend-badge">Amigo</span>}</strong>
            <span>{persona.rol}</span>
          </button>
        ))
      )}
      </div>
    </section>
  );
}

function EventDetailPanel({ event, onBack, onInteresado, onVoy, onNoVoy, onOpenAttendees, onOpenChat, onOpenBailaCar }) {
  const cartel = event?.cartelData || event?.cartelUrl || "";
  const fechaInicio = event?.fechaInicio ? new Date(event.fechaInicio).toLocaleString("es-ES") : "Fecha pendiente";
  const fechaFin = event?.fechaFin ? new Date(event.fechaFin).toLocaleString("es-ES") : "Sin hora de fin";
  const precio = event?.precio === null || event?.precio === undefined ? "Precio no indicado" : `${event.precio} €`;

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Informacion del evento</h2>
      <article className="card feature-card">
        <small>{event.ciudadNombre}</small>
        <h3>{event.titulo}</h3>
        {cartel ? (
          <img className="event-poster" src={cartel} alt={`Cartel de ${event.titulo}`} />
        ) : (
          <div className="event-poster empty-poster">Cartel pendiente</div>
        )}
        <div className="detail-grid">
          <div>
            <strong>Sala o lugar</strong>
            <span>{event.lugarNombre || "Lugar pendiente"}</span>
          </div>
          <div>
            <strong>Ciudad</strong>
            <span>{event.ciudadNombre}</span>
          </div>
          <div>
            <strong>Direccion</strong>
            <span>{event.direccion || "Direccion pendiente"}</span>
          </div>
          <div>
            <strong>Inicio</strong>
            <span>{fechaInicio}</span>
          </div>
          <div>
            <strong>Fin</strong>
            <span>{fechaFin}</span>
          </div>
          <div>
            <strong>Precio</strong>
            <span>{precio}</span>
          </div>
          <div>
            <strong>Estilos</strong>
            <span>{event.estilos?.join(" / ") || "No indicado"}</span>
          </div>
          <div>
            <strong>Tipo de evento</strong>
            <span>{event.tipoEvento || "Social / fiesta de baile"}</span>
          </div>
          <div>
            <strong>Nivel recomendado</strong>
            <span>{event.nivel || "Todos los niveles"}</span>
          </div>
          <div>
            <strong>DJ</strong>
            <span>{event.djNombre || "No indicado"}</span>
          </div>
          <div>
            <strong>Profesor / clase</strong>
            <span>{event.profesorNombre || "No indicado"}</span>
          </div>
          <div>
            <strong>Contacto</strong>
            <span>{event.telefonoContacto || "No indicado"}</span>
          </div>
          <div>
            <strong>Instagram</strong>
            <span>{event.instagram || "No indicado"}</span>
          </div>
          <div>
            <strong>Personas que van</strong>
            <span>{event.asistentes || 0}</span>
          </div>
          <div>
            <strong>Organizador</strong>
            <span>{event.organizadorNombre || "Organizador pendiente"}</span>
          </div>
        </div>
        {event.descripcion && (
          <section className="event-description">
            <strong>Descripcion</strong>
            <p>{event.descripcion}</p>
          </section>
        )}
        {event.enlaceExterno && (
          <a className="primary link-button" href={event.enlaceExterno} target="_blank" rel="noreferrer">
            Abrir enlace oficial del evento
          </a>
        )}
        <div className="actions attendance-actions">
          <button className="secondary" onClick={onInteresado}>Interesado</button>
          <button className="primary" onClick={onVoy}>Voy</button>
          <button className="secondary" onClick={onNoVoy}>No voy</button>
        </div>
        <div className="actions">
          <button className="secondary" onClick={onOpenAttendees}>Quien va</button>
          <button className="secondary" onClick={onOpenChat}>Chat evento</button>
          <button className="secondary" onClick={onOpenBailaCar}>BailaCar</button>
        </div>
      </article>
    </section>
  );
}

function AdminPanel({ authHeaders, session, onBack }) {
  const [usuarios, setUsuarios] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [form, setForm] = useState({ nombre: "", email: "", password: "", rol: "ADMIN" });
  const esSuperAdmin = session?.rol === "SUPER_ADMIN";

  async function cargar() {
    try {
      const [usuariosResponse, eventosResponse] = await Promise.all([
        fetch(`${API_URL}/admin/usuarios`, { headers: authHeaders }),
        fetch(`${API_URL}/admin/eventos`, { headers: authHeaders })
      ]);
      setUsuarios(usuariosResponse.ok ? await usuariosResponse.json() : []);
      setEventos(eventosResponse.ok ? await eventosResponse.json() : []);
    } catch {
      setUsuarios([]);
      setEventos([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function crearAdmin(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/admin/usuarios/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      alert("No se pudo crear el administrador.");
      return;
    }

    setForm({ nombre: "", email: "", password: "", rol: "ADMIN" });
    cargar();
  }

  async function accionAdmin(path, method, mensajeError) {
    const response = await fetch(`${API_URL}${path}`, { method, headers: authHeaders });
    if (!response.ok) {
      alert(mensajeError);
      return;
    }
    cargar();
  }

  async function cambiarRolUsuario(usuarioId, rol) {
    const response = await fetch(`${API_URL}/admin/usuarios/${usuarioId}/rol`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ rol })
    });

    if (!response.ok) {
      alert(await leerErrorServidor(response, "No se pudo cambiar el rol del usuario."));
      cargar();
      return;
    }

    cargar();
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Panel Admin</h2>
      <p className="muted">Gestión interna de BAILEMOS.</p>

      {esSuperAdmin && (
        <form className="card stack" onSubmit={crearAdmin}>
          <h3>Crear administrador restringido</h3>
          <input value={form.nombre} onChange={(e) => setField("nombre", e.target.value)} placeholder="Nombre" required />
          <input value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="Email" type="email" required />
          <input value={form.password} onChange={(e) => setField("password", e.target.value)} placeholder="Contraseña" type="password" required />
          <select value={form.rol} onChange={(e) => setField("rol", e.target.value)}>
            <option value="ADMIN">Admin</option>
            <option value="ORGANIZADOR">Organizador</option>
            <option value="SALA">Sala</option>
            <option value="ACADEMIA">Academia</option>
          </select>
          <button className="primary">Crear usuario administrativo</button>
        </form>
      )}

      <section className="card">
        <h3>Usuarios</h3>
        {usuarios.map((usuario) => (
          <div className="list-row with-action" key={usuario.id}>
            <span>
              <strong>{usuario.nombre}</strong>
              <small>{usuario.email} - {usuario.rol} - {usuario.activo ? "Activo" : "Desactivado"}</small>
            </span>
            <div className="mini-actions">
              {esSuperAdmin && usuario.rol !== "SUPER_ADMIN" && (
                <select className="compact-select" value={usuario.rol} onChange={(event) => cambiarRolUsuario(usuario.id, event.target.value)}>
                  <option value="BAILADOR">Bailador</option>
                  <option value="PROFESIONAL">Profesional</option>
                  <option value="ORGANIZADOR">Organizador</option>
                  <option value="SALA">Sala</option>
                  <option value="ACADEMIA">Academia</option>
                  <option value="ADMIN">Admin</option>
                </select>
              )}
              {usuario.activo ? (
                <button className="secondary compact" onClick={() => accionAdmin(`/admin/usuarios/${usuario.id}`, "DELETE", "No se pudo desactivar el usuario.")}>Desactivar</button>
              ) : (
                <button className="secondary compact" onClick={() => accionAdmin(`/admin/usuarios/${usuario.id}/activar`, "PUT", "No se pudo activar el usuario.")}>Activar</button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Eventos, fiestas y actividades</h3>
        {eventos.length === 0 ? <p className="muted">No hay eventos.</p> : eventos.map((evento) => (
          <div className="list-row with-action" key={evento.id}>
            <span>
              <strong>{evento.titulo}</strong>
              <small>{evento.ciudadNombre} - {evento.lugarNombre || "Lugar pendiente"} - {evento.activo ? "Activo" : "Eliminado"}</small>
            </span>
            {evento.activo && (
              <button className="secondary compact" onClick={() => accionAdmin(`/admin/eventos/${evento.id}`, "DELETE", "No se pudo eliminar el evento.")}>Eliminar</button>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}

function NotificationsPanel({ authHeaders, events, onBack }) {
  const [solicitudes, setSolicitudes] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/social/amistad/solicitudes`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : [])
      .then(setSolicitudes)
      .catch(() => setSolicitudes([]));
  }, []);

  const proximos = [...events]
    .sort((a, b) => new Date(a.fechaInicio || 0) - new Date(b.fechaInicio || 0))
    .slice(0, 3);

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Notificaciones</h2>
      <p className="muted">Actividad importante de tu comunidad BAILEMOS.</p>
      <section className="card">
        <h3>Solicitudes de amistad</h3>
        {solicitudes.length === 0 ? <p className="muted">No tienes solicitudes pendientes.</p> : solicitudes.map((item) => (
          <div className="list-row" key={item.id}>
            <strong>{item.nombre}</strong>
            <span>Quiere conectar contigo para bailar.</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>Eventos recomendados</h3>
        {proximos.length === 0 ? <p className="muted">Todavia no hay eventos publicados.</p> : proximos.map((item) => (
          <div className="list-row" key={item.id}>
            <strong>{item.titulo}</strong>
            <span>{item.ciudadNombre} - {item.lugarNombre || "Lugar pendiente"}</span>
          </div>
        ))}
      </section>
    </section>
  );
}

function LegalPanel({ onBack }) {
  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Legal y seguridad</h2>
      <section className="card stack">
        <h3>Politica de privacidad</h3>
        <p>BAILEMOS trata los datos de perfil, eventos, mensajes y actividad social para permitir que la comunidad conecte, organice planes de baile y mejore la experiencia.</p>
        <p>No vendemos datos personales. Los usuarios pueden solicitar revision, bloqueo o eliminacion de su cuenta.</p>
      </section>
      <section className="card stack">
        <h3>Terminos y condiciones</h3>
        <p>El usuario debe usar BAILEMOS con respeto. No se permite acoso, suplantacion, contenido ofensivo, spam, fraude o uso comercial no autorizado.</p>
        <p>Los eventos publicados por salas, academias u organizadores son responsabilidad de quien los publica.</p>
      </section>
      <section className="card stack">
        <h3>Normas de comunidad</h3>
        <p>Respeto, consentimiento y seguridad son obligatorios. BAILEMOS puede bloquear perfiles, ocultar contenido o limitar funciones si detecta abuso.</p>
      </section>
      <section className="card stack">
        <h3>Pagos y entradas</h3>
        <p>La compra de entradas y pagos premium se activara cuando la pasarela este conectada. Antes de cobrar, se mostraran precio, condiciones y politica de devolucion.</p>
      </section>
    </section>
  );
}

function ProductReadinessPanel({ onBack }) {
  const items = [
    ["Base social", "Chat, amistad, bloqueo, valoraciones y recomendaciones ya estan en marcha."],
    ["Eventos", "Busqueda, Voy/No voy/Interesado, asistentes, chat de evento y BailaCar funcionan sobre backend."],
    ["Organizadores", "Ya existe portal para publicar eventos; falta verificacion comercial y panel de estadisticas."],
    ["Legal", "Textos base visibles; falta revision juridica profesional antes de vender a gran escala."],
    ["Pagos", "Pendiente conectar Stripe/TPV para entradas, premium o reservas."],
    ["Eventos reales", "Pendiente importador definitivo desde fuentes externas y moderacion."],
    ["App movil", "La PWA ya sirve para iPhone/Android; Android nativa debe sincronizarse con la web."]
  ];

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Producto Pro</h2>
      <p className="muted">Estado real de BAILEMOS para preparar venta, demos y colaboradores.</p>
      <div className="card stack">
        {items.map(([titulo, texto]) => (
          <div className="readiness-row" key={titulo}>
            <strong>{titulo}</strong>
            <span>{texto}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PeoplePanel({ authHeaders, onBack, onOpenProfile, onMessage, onRate }) {
  const [personas, setPersonas] = useState([]);
  const [busqueda, setBusqueda] = useState("");

  async function cargar() {
    try {
      const response = await fetch(`${API_URL}/usuarios`, { headers: authHeaders });
      if (!response.ok) throw new Error();
      setPersonas(await response.json());
    } catch {
      setPersonas([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const filtradas = personas.filter((persona) => {
    const texto = `${persona.nombre} ${persona.email} ${persona.rol} ${persona.ciudadNombre || ""}`.toLowerCase();
    return texto.includes(busqueda.toLowerCase());
  });

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Bailadores y profesionales</h2>
      <p className="muted">{filtradas.length} personas registradas visibles para ti.</p>
      <input className="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, ciudad o rol" />
      <section className="card">
        {filtradas.length === 0 ? (
          <p className="muted">Todavía no hay otros usuarios registrados.</p>
        ) : (
          filtradas.map((persona) => (
            <div className="list-row with-action" key={persona.usuarioId}>
              <button className="person-link" onClick={() => onOpenProfile(persona)}>
                <strong>{persona.nombre}</strong>
                <small>{persona.rol}{persona.ciudadNombre ? ` - ${persona.ciudadNombre}` : ""}</small>
                <small>{persona.meGusta || 0} me gusta - {persona.recomendaciones || 0} recomendaciones</small>
                {persona.amigoMio && <small>Amigo</small>}
                {persona.bloqueadoPorMi && <small>Bloqueado por ti</small>}
              </button>
              <div className="mini-actions">
                <button className="primary compact" onClick={() => onOpenProfile(persona)}>Ver perfil</button>
                <button className="secondary compact" onClick={() => onRate(persona.usuarioId)}>Valorar</button>
              </div>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

function PublicProfilePanel({ user, events, authHeaders, onBack, onMessage, onOpenMessages }) {
  const [perfil, setPerfil] = useState(null);
  const [social, setSocial] = useState(null);
  const [valoraciones, setValoraciones] = useState([]);
  const [recomendaciones, setRecomendaciones] = useState([]);
  const [comentarioValoracion, setComentarioValoracion] = useState("");
  const [puntuacion, setPuntuacion] = useState(5);
  const [comentarioRecomendacion, setComentarioRecomendacion] = useState("");
  const [eventoRecomendado, setEventoRecomendado] = useState("");

  async function cargarPerfil() {
    if (!user?.usuarioId || Number.isNaN(Number(user.usuarioId))) {
      alert("No se pudo abrir este perfil porque falta el identificador del usuario.");
      return;
    }

    try {
      const [perfilResponse, socialResponse, valoracionesResponse, recomendacionesResponse] = await Promise.all([
        fetch(`${API_URL}/perfil/${user.usuarioId}`, { headers: authHeaders }),
        fetch(`${API_URL}/social/usuario/${user.usuarioId}/resumen`, { headers: authHeaders }),
        fetch(`${API_URL}/valoraciones/usuario/${user.usuarioId}`, { headers: authHeaders }),
        fetch(`${API_URL}/social/usuario/${user.usuarioId}/recomendaciones`, { headers: authHeaders })
      ]);

      setPerfil(perfilResponse.ok ? await perfilResponse.json() : null);
      setSocial(socialResponse.ok ? await socialResponse.json() : null);
      setValoraciones(valoracionesResponse.ok ? await valoracionesResponse.json() : []);
      setRecomendaciones(recomendacionesResponse.ok ? await recomendacionesResponse.json() : []);
    } catch {
      setPerfil(null);
      setSocial(null);
      setValoraciones([]);
      setRecomendaciones([]);
    }
  }

  useEffect(() => {
    cargarPerfil();
  }, [user.usuarioId]);

  async function accionSocial(path, method) {
    if (!user?.usuarioId || Number.isNaN(Number(user.usuarioId))) {
      alert("Abre un perfil válido para completar esta acción.");
      return;
    }

    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders }
    });

    if (!response.ok) {
      alert(await leerErrorServidor(response));
      return;
    }

    setSocial(await response.json());
    cargarPerfil();
  }

  function textoBotonAmistad() {
    if (social?.amigoMio) return "Quitar amigo";
    if (social?.solicitudAmistadEnviada) return "Cancelar solicitud";
    if (social?.solicitudAmistadRecibida) return "Responder solicitud";
    return "Enviar solicitud de amistad";
  }

  function gestionarAmistad() {
    if (social?.amigoMio) {
      accionSocial(`/social/usuario/${user.usuarioId}/amigo`, "DELETE");
      return;
    }

    if (social?.solicitudAmistadEnviada) {
      accionSocial(`/social/usuario/${user.usuarioId}/solicitud-amistad`, "DELETE");
      return;
    }

    if (social?.solicitudAmistadRecibida) {
      alert("Te envio una solicitud. Entra en Mensajes para aceptar o rechazar.");
      onOpenMessages?.();
      return;
    }

    accionSocial(`/social/usuario/${user.usuarioId}/solicitud-amistad`, "POST");
  }

  async function guardarValoracion(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/valoraciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        evaluadoId: user.usuarioId,
        puntuacion: Number(puntuacion),
        comentario: comentarioValoracion
      })
    });

    if (!response.ok) {
      alert("No se pudo guardar la valoración.");
      return;
    }

    setComentarioValoracion("");
    cargarPerfil();
  }

  async function guardarRecomendacion(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/social/usuario/${user.usuarioId}/recomendar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        comentario: comentarioRecomendacion,
        eventoId: eventoRecomendado ? Number(eventoRecomendado) : null
      })
    });

    if (!response.ok) {
      alert("No se pudo guardar la recomendación.");
      return;
    }

    setComentarioRecomendacion("");
    setEventoRecomendado("");
    cargarPerfil();
  }

  const bloqueado = social?.bloqueadoPorMi || social?.meTieneBloqueado;
  const nombre = perfil?.nombreArtistico || perfil?.nombre || user.nombre;
  const estadoRelacion = social?.amigoMio
    ? "Amigo"
    : social?.solicitudAmistadEnviada
      ? "Solicitud enviada"
      : social?.solicitudAmistadRecibida
        ? "Te envio solicitud"
        : "Aun no sois amigos";

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <article className="card public-profile">
        {(perfil?.fotoData || perfil?.fotoUrl) ? <img className="profile-preview" src={perfil.fotoData || perfil.fotoUrl} alt={nombre} /> : <img className="profile-preview" src="/bailemos_logo.jpeg" alt={nombre} />}
        <h2>{nombre}</h2>
        <p className="muted">{perfil?.rol || user.rol}{perfil?.ciudadNombre ? ` - ${perfil.ciudadNombre}` : ""}</p>
        <span className={`relation-pill ${social?.amigoMio ? "active" : ""}`}>{estadoRelacion}</span>
        {perfil?.biografia && <p>{perfil.biografia}</p>}
        <div className="stats-row">
          <span>{social?.meGusta || 0} me gusta</span>
          <span>{social?.recomendaciones || 0} recomendaciones</span>
          <span>{valoraciones.length} valoraciones</span>
        </div>
        {perfil?.estilos?.length > 0 && (
          <div className="chips readonly">
            {perfil.estilos.map((estilo) => <span key={estilo}>{estilo}</span>)}
          </div>
        )}
        {(perfil?.videoData || perfil?.videoUrl) && (
          <video className="profile-video" src={perfil.videoData || perfil.videoUrl} controls playsInline />
        )}
        {(perfil?.spotifyUrl || SPOTIFY_BAILEMOS_URL) && (
          <a className="secondary link-button" href={perfil?.spotifyUrl || SPOTIFY_BAILEMOS_URL} target="_blank" rel="noreferrer">
            Escuchar playlist
          </a>
        )}
      </article>

      <div className="quick-grid">
        <button className="primary" onClick={() => onMessage(user)} disabled={bloqueado}>Chatear</button>
        <button onClick={() => accionSocial(`/social/usuario/${user.usuarioId}/me-gusta`, social?.meGustaMio ? "DELETE" : "POST")}>
          {social?.meGustaMio ? "Quitar BAILEMOS!" : "BAILEMOS! me gusta"}
        </button>
        <button onClick={gestionarAmistad}>{textoBotonAmistad()}</button>
        <button onClick={() => accionSocial(`/social/usuario/${user.usuarioId}/bloquear`, social?.bloqueadoPorMi ? "DELETE" : "POST")}>
          {social?.bloqueadoPorMi ? "Desbloquear" : "Bloquear"}
        </button>
      </div>

      {social?.meTieneBloqueado && <p className="notice-text">Esta persona te tiene bloqueado. No puedes contactar por chat.</p>}
      {social?.bloqueadoPorMi && <p className="notice-text">Tienes bloqueada a esta persona. Desbloquea para volver a contactar.</p>}

      <form className="card stack" onSubmit={guardarValoracion}>
        <h3>Valorar a {nombre}</h3>
        <select value={puntuacion} onChange={(event) => setPuntuacion(event.target.value)}>
          <option value="5">5 - Excelente</option>
          <option value="4">4 - Muy bien</option>
          <option value="3">3 - Bien</option>
          <option value="2">2 - Mejorable</option>
          <option value="1">1 - Mala experiencia</option>
        </select>
        <textarea value={comentarioValoracion} onChange={(event) => setComentarioValoracion(event.target.value)} placeholder="Cuenta como fue bailar o trabajar con esta persona" />
        <button className="primary">Guardar valoración</button>
      </form>

      <form className="card stack" onSubmit={guardarRecomendacion}>
        <h3>Recomendar</h3>
        <textarea value={comentarioRecomendacion} onChange={(event) => setComentarioRecomendacion(event.target.value)} placeholder="Ejemplo: recomiendo bailar con esta persona, o recomiendo este evento/lugar al que voy" />
        <select value={eventoRecomendado} onChange={(event) => setEventoRecomendado(event.target.value)}>
          <option value="">Sin evento concreto</option>
          {events.map((evento) => <option key={evento.id} value={evento.id}>{evento.titulo}</option>)}
        </select>
        <button className="primary">Guardar recomendación</button>
      </form>

      <section className="card">
        <h3>Valoraciones visibles</h3>
        {valoraciones.length === 0 ? <p className="muted">Aún no hay valoraciones.</p> : valoraciones.map((item) => (
          <div className="list-row" key={item.id}>
            <strong>{item.puntuacion}/5 - {item.autorNombre}</strong>
            <span>{item.comentario || "Sin comentario"}</span>
          </div>
        ))}
      </section>

      <section className="card">
        <h3>Recomendaciones visibles</h3>
        {recomendaciones.length === 0 ? <p className="muted">Aún no hay recomendaciones.</p> : recomendaciones.map((item) => {
          const evento = events.find((event) => Number(event.id) === Number(item.eventoId));
          return (
            <div className="list-row" key={item.id}>
              <strong>{item.autorNombre}</strong>
              <span>{item.comentario || "Recomienda a esta persona"}</span>
              {evento && <span>Evento recomendado: {evento.titulo}</span>}
            </div>
          );
        })}
      </section>
    </section>
  );
}

function FriendsPanel({ authHeaders, onBack, onOpenProfile, onMessage }) {
  const [amigos, setAmigos] = useState([]);
  const [loading, setLoading] = useState(true);

  async function cargar() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/social/amigos`, { headers: authHeaders });
      if (!response.ok) throw new Error();
      setAmigos(await response.json());
    } catch {
      setAmigos([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function accion(usuarioId, path, method, mensajeOk) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders }
    });

    if (!response.ok) {
      alert(await leerErrorServidor(response, "No se pudo completar la accion."));
      return;
    }

    alert(mensajeOk);
    cargar();
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Mis amigos</h2>
      <p className="muted">Tus contactos de baile para chatear, ver perfil, valorar o bloquear.</p>

      <section className="card friend-summary">
        <strong>{amigos.length}</strong>
        <span>{amigos.length === 1 ? "amigo conectado a tu red BAILEMOS" : "amigos conectados a tu red BAILEMOS"}</span>
      </section>

      <section className="card">
        {loading ? (
          <p className="muted">Cargando amigos...</p>
        ) : amigos.length === 0 ? (
          <p className="muted">Aun no tienes amigos. Entra en Gente y envia una solicitud.</p>
        ) : (
          amigos.map((amigo) => (
            <div className="friend-card" key={amigo.usuarioId}>
              <div>
                <strong>{amigo.nombre}</strong>
                <span>{amigo.rol}</span>
              </div>
              <div className="mini-actions">
                <button className="primary compact" onClick={() => onMessage(amigo)}>Chatear</button>
                <button className="secondary compact" onClick={() => onOpenProfile(amigo)}>Ver perfil</button>
                <button
                  className="secondary compact"
                  onClick={() => accion(amigo.usuarioId, `/social/usuario/${amigo.usuarioId}/amigo`, "DELETE", "Amigo eliminado.")}
                >
                  Quitar
                </button>
                <button
                  className="secondary compact"
                  onClick={() => accion(amigo.usuarioId, `/social/usuario/${amigo.usuarioId}/bloquear`, "POST", "Usuario bloqueado.")}
                >
                  Bloquear
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </section>
  );
}

function MessagesPanel({ authHeaders, onBack, onOpen, onUpdated }) {
  const [chats, setChats] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);

  async function cargar() {
    try {
      const [chatsResponse, solicitudesResponse] = await Promise.all([
        fetch(`${API_URL}/chat/privados`, { headers: authHeaders }),
        fetch(`${API_URL}/social/amistad/solicitudes`, { headers: authHeaders })
      ]);
      setChats(chatsResponse.ok ? await chatsResponse.json() : []);
      setSolicitudes(solicitudesResponse.ok ? await solicitudesResponse.json() : []);
      onUpdated?.();
    } catch {
      setChats([]);
      setSolicitudes([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function responderSolicitud(solicitud, accion) {
    const url = accion === "aceptar"
      ? `${API_URL}/social/usuario/${solicitud.usuarioId}/solicitud-amistad/aceptar`
      : `${API_URL}/social/amistad/solicitudes/${solicitud.id}/${accion}`;

    let response = await fetch(url, {
      method: "POST",
      headers: authHeaders
    });

    if (!response.ok && accion === "aceptar") {
      response = await fetch(`${API_URL}/social/amistad/solicitudes/${solicitud.id}/aceptar`, {
        method: "POST",
        headers: authHeaders
      });
    }

    if (!response.ok) {
      alert(await leerErrorServidor(response, "No se pudo responder la solicitud."));
      return;
    }

    await cargar();
    alert(accion === "aceptar" ? "Solicitud aceptada. Ya sois amigos y podéis chatear." : "Solicitud rechazada.");
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Mis mensajes</h2>
      <p className="muted">Tus conversaciones privadas dentro de BAILEMOS.</p>
      <section className="message-summary">
        <div>
          <strong>{solicitudes.length}</strong>
          <span>solicitudes</span>
        </div>
        <div>
          <strong>{chats.length}</strong>
          <span>conversaciones</span>
        </div>
      </section>
      <section className="card">
        <h3>Solicitudes de amistad</h3>
        {solicitudes.length === 0 ? (
          <p className="muted">No tienes solicitudes pendientes.</p>
        ) : (
          solicitudes.map((solicitud) => (
            <div className="list-row with-action" key={solicitud.id}>
              <span>
                <strong>{solicitud.nombre}</strong>
                <small>{solicitud.rol}</small>
              </span>
              <div className="mini-actions">
                <button className="primary compact" onClick={() => responderSolicitud(solicitud, "aceptar")}>Aceptar</button>
                <button className="secondary compact" onClick={() => responderSolicitud(solicitud, "rechazar")}>Rechazar</button>
              </div>
            </div>
          ))
        )}
      </section>
      <section className="card">
        <h3>Conversaciones privadas</h3>
        {chats.length === 0 ? (
          <p className="muted">Aún no tienes conversaciones. Entra en Gente y escribe a alguien.</p>
        ) : (
          chats.map((chat) => (
            <button className="conversation-row" key={`${chat.chatId || "amigo"}-${chat.otroUsuarioId}`} onClick={() => onOpen(chat)}>
              <span>
                <strong>{chat.otroUsuarioNombre}</strong>
                <small>{chat.otroUsuarioRol}</small>
              </span>
              <em>{chat.ultimoMensaje}</em>
            </button>
          ))
        )}
      </section>
    </section>
  );
}

function ProfilePanel({ session, ciudades, authHeaders, onBack, onSaved }) {
  const [form, setForm] = useState({
    nombreArtistico: "",
    biografia: "",
    ciudadId: "",
    nivel: "PRINCIPIANTE",
    estilos: [],
    fotoUrl: "",
    fotoData: "",
    videoUrl: "",
    videoData: "",
    spotifyUrl: SPOTIFY_BAILEMOS_URL,
    verificacionSolicitada: false,
    perfilVerificado: false,
    verificacionDescripcion: "",
    instagram: "",
    tiktok: "",
    youtube: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function cargarPerfil() {
      try {
        const response = await fetch(`${API_URL}/perfil/me`, { headers: authHeaders });
        if (!response.ok) throw new Error();
        const perfil = await response.json();
        setForm({
          nombreArtistico: perfil.nombreArtistico || perfil.nombre || session?.nombre || "",
          biografia: perfil.biografia || "",
          ciudadId: perfil.ciudadId || "",
          nivel: perfil.nivel || "PRINCIPIANTE",
          estilos: perfil.estilos || [],
          fotoUrl: perfil.fotoUrl || "",
          fotoData: perfil.fotoData || "",
          videoUrl: perfil.videoUrl || "",
          videoData: perfil.videoData || "",
          spotifyUrl: perfil.spotifyUrl || SPOTIFY_BAILEMOS_URL,
          verificacionSolicitada: perfil.verificacionSolicitada || false,
          perfilVerificado: perfil.perfilVerificado || false,
          verificacionDescripcion: perfil.verificacionDescripcion || "",
          instagram: perfil.instagram || "",
          tiktok: perfil.tiktok || "",
          youtube: perfil.youtube || ""
        });
      } catch {
        alert("No se pudo cargar tu perfil.");
      } finally {
        setLoading(false);
      }
    }

    cargarPerfil();
  }, []);

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleEstilo(estilo) {
    setForm((current) => ({
      ...current,
      estilos: current.estilos.includes(estilo)
        ? current.estilos.filter((item) => item !== estilo)
        : [...current.estilos, estilo]
    }));
  }

  async function cargarFotoArchivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      alert("La foto debe ser JPG o PNG.");
      return;
    }

    if (file.size > MAX_FOTO_MB * 1024 * 1024) {
      alert(`La foto es demasiado grande. Usa una imagen de menos de ${MAX_FOTO_MB} MB.`);
      return;
    }

    setField("fotoData", await leerArchivoComoDataUrl(file));
  }

  async function cargarVideoArchivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) {
      alert("El video debe ser MP4, WebM o MOV.");
      return;
    }

    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      alert(`El video es demasiado grande. Usa un video corto de menos de ${MAX_VIDEO_MB} MB.`);
      return;
    }

    setField("videoData", await leerArchivoComoDataUrl(file));
  }

  async function guardar(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        ciudadId: form.ciudadId ? Number(form.ciudadId) : null,
        fotoUrl: form.fotoUrl || null,
        fotoData: form.fotoData || null,
        videoUrl: form.videoUrl || null,
        videoData: form.videoData || null,
        spotifyUrl: form.spotifyUrl || null,
        verificacionSolicitada: form.verificacionSolicitada,
        verificacionDescripcion: form.verificacionDescripcion || null,
        instagram: form.instagram || null,
        tiktok: form.tiktok || null,
        youtube: form.youtube || null
      };

      const response = await fetch(`${API_URL}/perfil/me`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error();
      onSaved(await response.json());
    } catch {
      alert("No se pudo guardar tu perfil.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="screen">
        <button className="back" onClick={onBack}>Volver</button>
        <h2>Mi perfil</h2>
        <p className="muted">Cargando perfil...</p>
      </section>
    );
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Mi perfil</h2>
      <p className="muted">Edita como te ve la comunidad BAILEMOS.</p>

      <form className="card stack" onSubmit={guardar}>
        {(form.fotoData || form.fotoUrl) && <img className="profile-preview" src={form.fotoData || form.fotoUrl} alt="Foto de perfil" />}
        <input value={form.nombreArtistico} onChange={(e) => setField("nombreArtistico", e.target.value)} placeholder="Nombre artístico" />
        <textarea value={form.biografia} onChange={(e) => setField("biografia", e.target.value)} placeholder="Biografía" />
        <select value={form.ciudadId} onChange={(e) => setField("ciudadId", e.target.value)}>
          <option value="">Ciudad principal</option>
          {ciudades.map((ciudad) => <option key={ciudad.id} value={ciudad.id}>{ciudad.nombre}</option>)}
        </select>
        <select value={form.nivel} onChange={(e) => setField("nivel", e.target.value)}>
          <option value="PRINCIPIANTE">Principiante</option>
          <option value="INTERMEDIO">Intermedio</option>
          <option value="AVANZADO">Avanzado</option>
          <option value="PROFESIONAL">Profesional</option>
        </select>
        <div className="chips">
          {estilosDisponibles.map((estilo) => (
            <button type="button" key={estilo} className={form.estilos.includes(estilo) ? "chip-active" : ""} onClick={() => toggleEstilo(estilo)}>{estilo}</button>
          ))}
        </div>
        <input value={form.fotoUrl} onChange={(e) => setField("fotoUrl", e.target.value)} placeholder="URL de foto de perfil" />
        <label className="file-picker">
          Subir foto JPG/PNG hasta {MAX_FOTO_MB} MB
          <input type="file" accept="image/jpeg,image/png" onChange={cargarFotoArchivo} />
        </label>
        <input value={form.videoUrl} onChange={(e) => setField("videoUrl", e.target.value)} placeholder="URL de video bailando" />
        <label className="file-picker">
          Subir video corto MP4/WebM/MOV hasta {MAX_VIDEO_MB} MB
          <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={cargarVideoArchivo} />
        </label>
        {(form.videoData || form.videoUrl) && (
          <video className="profile-video" src={form.videoData || form.videoUrl} controls playsInline />
        )}
        <input value={form.spotifyUrl} onChange={(e) => setField("spotifyUrl", e.target.value)} placeholder="Playlist Spotify" />
        <section className="verification-box">
          <strong>{form.perfilVerificado ? "Perfil verificado" : form.verificacionSolicitada ? "Verificacion solicitada" : "Verificacion profesional"}</strong>
          <p>Usa esto si eres profesor, DJ, fotografo, sala, academia u organizador.</p>
          <textarea
            value={form.verificacionDescripcion}
            onChange={(e) => setField("verificacionDescripcion", e.target.value)}
            placeholder="Describe tu actividad profesional, sala, academia, redes o experiencia."
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.verificacionSolicitada}
              onChange={(e) => setField("verificacionSolicitada", e.target.checked)}
              disabled={form.perfilVerificado}
            />
            <span>Solicitar verificacion profesional</span>
          </label>
        </section>
        <input value={form.instagram} onChange={(e) => setField("instagram", e.target.value)} placeholder="Instagram" />
        <input value={form.tiktok} onChange={(e) => setField("tiktok", e.target.value)} placeholder="TikTok" />
        <input value={form.youtube} onChange={(e) => setField("youtube", e.target.value)} placeholder="YouTube" />
        <button className="primary" disabled={saving}>{saving ? "Guardando..." : "Guardar perfil"}</button>
      </form>
    </section>
  );
}

function ChatPanel({ title, endpointGet, endpointPost, authHeaders, onBack, embedded = false }) {
  const [mensajes, setMensajes] = useState([]);
  const [mensaje, setMensaje] = useState("");
  const [blocked, setBlocked] = useState(false);

  async function cargar() {
    if (!endpointGet) return;
    try {
      const response = await fetch(`${API_URL}${endpointGet}`, { headers: authHeaders });
      if (response.status === 403) {
        setBlocked(true);
        setMensajes([]);
        return;
      }
      if (!response.ok) throw new Error();
      setBlocked(false);
      setMensajes(await response.json());
    } catch {
      setMensajes([]);
    }
  }

  useEffect(() => {
    cargar();
  }, [endpointGet]);

  async function enviar(event) {
    event.preventDefault();
    if (!mensaje.trim() || !endpointPost) return;

    const response = await fetch(`${API_URL}${endpointPost}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ mensaje: mensaje.trim() })
    });

    if (response.status === 403) {
      setBlocked(true);
      alert("No se puede enviar el mensaje porque hay un bloqueo activo.");
      return;
    }

    if (!response.ok) {
      alert("No se pudo enviar el mensaje.");
      return;
    }

    setMensaje("");
    cargar();
  }

  return (
    <section className={embedded ? "chat-embedded" : "screen"}>
      {!embedded && <button className="back" onClick={onBack}>Volver</button>}
      <h2>{title}</h2>
      <div className="chat-box">
        {blocked ? (
          <p className="muted">No se puede contactar porque hay un bloqueo activo.</p>
        ) : mensajes.length === 0 ? (
          <p className="muted">Todavía no hay mensajes. Escribe el primero.</p>
        ) : (
          mensajes.map((item) => (
            <div className="message" key={item.id}>
              <strong>{item.nombreUsuario}</strong>
              <span>{item.mensaje}</span>
            </div>
          ))
        )}
      </div>
      <form className="composer" onSubmit={enviar}>
        <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Escribe un mensaje" disabled={blocked} />
        <button className="primary" disabled={blocked}>Enviar</button>
      </form>
    </section>
  );
}

function BailaCar({ onBack, event, authHeaders }) {
  const [tipo, setTipo] = useState("BUSCO_COCHE");
  const [salida, setSalida] = useState("");
  const [hora, setHora] = useState("");
  const [plazas, setPlazas] = useState("");
  const [comentario, setComentario] = useState("");
  const [viajes, setViajes] = useState([]);

  async function cargarViajes() {
    const query = event?.id ? `?eventoId=${event.id}` : "";
    try {
      const response = await fetch(`${API_URL}/bailacar${query}`, { headers: authHeaders });
      if (!response.ok) throw new Error();
      setViajes(await response.json());
    } catch {
      setViajes([]);
    }
  }

  useEffect(() => {
    cargarViajes();
  }, [event?.id]);

  async function publicar(eventSubmit) {
    eventSubmit.preventDefault();
    await fetch(`${API_URL}/bailacar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        eventoId: event?.id || null,
        tipo,
        ciudadSalida: salida,
        horaSalida: hora,
        plazas: plazas ? Number(plazas) : null,
        comentario
      })
    });
    setSalida("");
    setHora("");
    setPlazas("");
    setComentario("");
    cargarViajes();
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>BailaCar</h2>
      <p className="muted">Organiza tu transporte para eventos de baile y encuentros de la comunidad BAILEMOS.</p>
      <form className="card stack" onSubmit={publicar}>
        <div className="segmented">
          <button type="button" className={tipo === "BUSCO_COCHE" ? "active" : ""} onClick={() => setTipo("BUSCO_COCHE")}>Busco coche</button>
          <button type="button" className={tipo === "OFREZCO_PLAZAS" ? "active" : ""} onClick={() => setTipo("OFREZCO_PLAZAS")}>Ofrezco plazas</button>
        </div>
        <input value={salida} onChange={(e) => setSalida(e.target.value)} placeholder="Ciudad o zona de salida" required />
        <input value={hora} onChange={(e) => setHora(e.target.value)} placeholder="Hora aproximada" required />
        <input value={plazas} onChange={(e) => setPlazas(e.target.value)} placeholder="Plazas disponibles" inputMode="numeric" />
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario, ruta o condiciones" />
        <button className="primary">Publicar en BailaCar</button>
      </form>

      <section className="card">
        <h3>Viajes publicados</h3>
        {viajes.length === 0 ? <p className="muted">Aún no hay viajes publicados.</p> : viajes.map((viaje) => (
          <div className="list-row" key={viaje.id}>
            <strong>{viaje.tipo === "OFREZCO_PLAZAS" ? "Ofrece plazas" : "Busca coche"} - {viaje.nombreUsuario}</strong>
            <span>{viaje.ciudadSalida} - {viaje.horaSalida} - Plazas: {viaje.plazas || "Pendiente"}</span>
            {viaje.comentario && <span>{viaje.comentario}</span>}
          </div>
        ))}
      </section>
    </section>
  );
}

function PublishEvent({ ciudades, authHeaders, onBack, onCreated, editingEvent = null }) {
  const [form, setForm] = useState({
    titulo: editingEvent?.titulo || "",
    descripcion: editingEvent?.descripcion || "",
    ciudadId: editingEvent?.ciudadId || ciudades[0]?.id || 1,
    lugarNombre: editingEvent?.lugarNombre || "",
    direccion: editingEvent?.direccion || "",
    fechaInicio: editingEvent?.fechaInicio ? editingEvent.fechaInicio.slice(0, 16) : "",
    fechaFin: editingEvent?.fechaFin ? editingEvent.fechaFin.slice(0, 16) : "",
    precio: editingEvent?.precio ?? "",
    cartelUrl: editingEvent?.cartelUrl || "",
    cartelData: editingEvent?.cartelData || "",
    tipoEvento: editingEvent?.tipoEvento || "",
    djNombre: editingEvent?.djNombre || "",
    profesorNombre: editingEvent?.profesorNombre || "",
    nivel: editingEvent?.nivel || "",
    telefonoContacto: editingEvent?.telefonoContacto || "",
    instagram: editingEvent?.instagram || "",
    enlaceExterno: editingEvent?.enlaceExterno || "",
    estilos: editingEvent?.estilos?.length ? editingEvent.estilos : ["BACHATA"]
  });
  const [textoImportado, setTextoImportado] = useState("");

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleEstilo(estilo) {
    setForm((current) => ({
      ...current,
      estilos: current.estilos.includes(estilo)
        ? current.estilos.filter((item) => item !== estilo)
        : [...current.estilos, estilo]
    }));
  }

  async function cargarCartelArchivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("El cartel debe ser una imagen.");
      return;
    }

    setField("cartelData", await leerArchivoComoDataUrl(file));
  }

  function prepararDesdeTexto() {
    const lineas = textoImportado
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean);
    const primeraLinea = lineas[0] || "";
    const url = textoImportado.match(/https?:\/\/\S+/i)?.[0] || "";
    const precio = textoImportado.match(/(\d+([,.]\d{1,2})?)\s*(€|eur|euros)/i)?.[1]?.replace(",", ".") || "";

    setForm((current) => ({
      ...current,
      titulo: current.titulo || primeraLinea || "Evento BAILEMOS",
      descripcion: current.descripcion || textoImportado,
      precio: current.precio || precio,
      cartelUrl: current.cartelUrl || url,
      enlaceExterno: current.enlaceExterno || url,
      estilos: detectarEstilosEvento(textoImportado)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      ...form,
      ciudadId: Number(form.ciudadId),
      fechaInicio: form.fechaInicio,
      fechaFin: form.fechaFin || null,
      precio: form.precio ? Number(form.precio) : null,
      latitud: null,
      longitud: null,
      cartelUrl: form.cartelUrl || null,
      cartelData: form.cartelData || null
    };

    const response = await fetch(`${API_URL}/eventos${editingEvent?.id ? `/${editingEvent.id}` : ""}`, {
      method: editingEvent?.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      alert(editingEvent ? "No se pudo actualizar el evento." : "No se pudo publicar el evento.");
      return;
    }

    onCreated(await response.json());
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>{editingEvent ? "Editar evento" : "Publicar evento"}</h2>
      <section className="card stack">
        <h3>Detectar estilos automáticamente</h3>
        <textarea value={textoImportado} onChange={(event) => setTextoImportado(event.target.value)} placeholder="Pega texto del evento. Si pone Bachata, Salsa o Kizomba, BAILEMOS los marcará automáticamente." />
        <button className="secondary" type="button" onClick={prepararDesdeTexto}>Rellenar con este texto</button>
      </section>
      <form className="card stack" onSubmit={submit}>
        <input value={form.titulo} onChange={(e) => setField("titulo", e.target.value)} placeholder="Nombre del evento" required />
        <select value={form.ciudadId} onChange={(e) => setField("ciudadId", e.target.value)}>
          {ciudades.map((ciudad) => <option key={ciudad.id} value={ciudad.id}>{ciudad.nombre}</option>)}
        </select>
        <input value={form.lugarNombre} onChange={(e) => setField("lugarNombre", e.target.value)} placeholder="Sala, disco o academia" />
        <select value={form.tipoEvento} onChange={(e) => setField("tipoEvento", e.target.value)}>
          <option value="">Tipo de evento</option>
          <option value="Social">Social</option>
          <option value="Clase + social">Clase + social</option>
          <option value="Concierto">Concierto</option>
          <option value="Festival">Festival</option>
          <option value="Workshop">Workshop</option>
          <option value="Otro">Otro</option>
        </select>
        <select value={form.nivel} onChange={(e) => setField("nivel", e.target.value)}>
          <option value="">Nivel recomendado</option>
          <option value="Todos los niveles">Todos los niveles</option>
          <option value="Principiante">Principiante</option>
          <option value="Intermedio">Intermedio</option>
          <option value="Avanzado">Avanzado</option>
        </select>
        <input value={form.djNombre} onChange={(e) => setField("djNombre", e.target.value)} placeholder="DJ invitado o DJ residente" />
        <input value={form.profesorNombre} onChange={(e) => setField("profesorNombre", e.target.value)} placeholder="Profesor, clase o artista invitado" />
        <input value={form.direccion} onChange={(e) => setField("direccion", e.target.value)} placeholder="Dirección" />
        <label className="field-label">
          <span>Fecha y hora de inicio del evento</span>
          <input value={form.fechaInicio} onChange={(e) => setField("fechaInicio", e.target.value)} type="datetime-local" required />
        </label>
        <label className="field-label">
          <span>Fecha y hora de fin (opcional)</span>
          <input value={form.fechaFin} onChange={(e) => setField("fechaFin", e.target.value)} type="datetime-local" />
        </label>
        <input value={form.precio} onChange={(e) => setField("precio", e.target.value)} placeholder="Precio" inputMode="decimal" />
        <input value={form.telefonoContacto} onChange={(e) => setField("telefonoContacto", e.target.value)} placeholder="Telefono o WhatsApp de contacto" />
        <input value={form.instagram} onChange={(e) => setField("instagram", e.target.value)} placeholder="Instagram del evento o sala" />
        <input value={form.enlaceExterno} onChange={(e) => setField("enlaceExterno", e.target.value)} placeholder="Enlace de entradas, web o informacion" />
        <input value={form.cartelUrl} onChange={(e) => setField("cartelUrl", e.target.value)} placeholder="URL del cartel o Instagram" />
        <label className="file-picker">
          Subir cartel desde tu dispositivo
          <input type="file" accept="image/*" onChange={cargarCartelArchivo} />
        </label>
        {(form.cartelData || form.cartelUrl) && (
          <img className="event-poster" src={form.cartelData || form.cartelUrl} alt="Vista previa del cartel" />
        )}
        <textarea value={form.descripcion} onChange={(e) => setField("descripcion", e.target.value)} placeholder="Descripción" />
        <div className="chips">
          {estilosEvento.map((estilo) => (
            <button type="button" key={estilo} className={form.estilos.includes(estilo) ? "chip-active" : ""} onClick={() => toggleEstilo(estilo)}>{estilo}</button>
          ))}
        </div>
        <button className="primary">{editingEvent ? "Guardar cambios" : "Publicar evento"}</button>
      </form>
    </section>
  );
}

function OrganizerPortal({ ciudades, authHeaders, onBack, onCreated }) {
  const [texto, setTexto] = useState("");
  const [form, setForm] = useState({
    titulo: "",
    descripcion: "",
    ciudadId: ciudades[0]?.id || 1,
    lugarNombre: "",
    direccion: "",
    fechaInicio: "",
    fechaFin: "",
    precio: "",
    cartelUrl: "",
    cartelData: "",
    tipoEvento: "",
    djNombre: "",
    profesorNombre: "",
    nivel: "",
    telefonoContacto: "",
    instagram: "",
    enlaceExterno: "",
    estilos: ["BACHATA"]
  });

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleEstilo(estilo) {
    setForm((current) => ({
      ...current,
      estilos: current.estilos.includes(estilo)
        ? current.estilos.filter((item) => item !== estilo)
        : [...current.estilos, estilo]
    }));
  }

  async function cargarCartelPortalArchivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("El cartel debe ser una imagen.");
      return;
    }

    setField("cartelData", await leerArchivoComoDataUrl(file));
  }

  function prepararDesdeTexto() {
    const lineas = texto
      .split("\n")
      .map((linea) => linea.trim())
      .filter(Boolean);
    const primeraLinea = lineas[0] || "";
    const url = texto.match(/https?:\/\/\S+/i)?.[0] || "";
    const precio = texto.match(/(\d+([,.]\d{1,2})?)\s*(€|eur|euros)/i)?.[1]?.replace(",", ".") || "";

    setForm((current) => ({
      ...current,
      titulo: current.titulo || primeraLinea || "Evento BAILEMOS",
      descripcion: current.descripcion || texto,
      precio: current.precio || precio,
      cartelUrl: current.cartelUrl || url,
      enlaceExterno: current.enlaceExterno || url,
      estilos: detectarEstilosEvento(texto)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      ...form,
      ciudadId: Number(form.ciudadId),
      fechaInicio: form.fechaInicio,
      fechaFin: form.fechaFin || null,
      precio: form.precio ? Number(form.precio) : null,
      latitud: null,
      longitud: null,
      cartelUrl: form.cartelUrl || null,
      cartelData: form.cartelData || null
    };

    const response = await fetch(`${API_URL}/eventos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      alert("No se pudo publicar el evento.");
      return;
    }

    onCreated(await response.json());
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Portal de salas y organizadores</h2>
      <p className="muted">Publica eventos reales o pega texto/enlace de una publicación para prepararlo más rápido.</p>

      <section className="card stack">
        <h3>Importar desde publicación</h3>
        <textarea value={texto} onChange={(event) => setTexto(event.target.value)} placeholder="Pega aquí texto de Instagram, web, cartel o descripción del evento" />
        <button className="secondary" type="button" onClick={prepararDesdeTexto}>Preparar evento con este texto</button>
      </section>

      <form className="card stack" onSubmit={submit}>
        <h3>Datos del evento</h3>
        <input value={form.titulo} onChange={(event) => setField("titulo", event.target.value)} placeholder="Nombre del evento" required />
        <select value={form.ciudadId} onChange={(event) => setField("ciudadId", event.target.value)}>
          {ciudades.map((ciudad) => <option key={ciudad.id} value={ciudad.id}>{ciudad.nombre}</option>)}
        </select>
        <input value={form.lugarNombre} onChange={(event) => setField("lugarNombre", event.target.value)} placeholder="Sala, disco, academia u organizador" />
        <select value={form.tipoEvento} onChange={(event) => setField("tipoEvento", event.target.value)}>
          <option value="">Tipo de evento</option>
          <option value="Social">Social</option>
          <option value="Clase + social">Clase + social</option>
          <option value="Concierto">Concierto</option>
          <option value="Festival">Festival</option>
          <option value="Workshop">Workshop</option>
          <option value="Otro">Otro</option>
        </select>
        <select value={form.nivel} onChange={(event) => setField("nivel", event.target.value)}>
          <option value="">Nivel recomendado</option>
          <option value="Todos los niveles">Todos los niveles</option>
          <option value="Principiante">Principiante</option>
          <option value="Intermedio">Intermedio</option>
          <option value="Avanzado">Avanzado</option>
        </select>
        <input value={form.djNombre} onChange={(event) => setField("djNombre", event.target.value)} placeholder="DJ invitado o DJ residente" />
        <input value={form.profesorNombre} onChange={(event) => setField("profesorNombre", event.target.value)} placeholder="Profesor, clase o artista invitado" />
        <input value={form.direccion} onChange={(event) => setField("direccion", event.target.value)} placeholder="Dirección" />
        <label className="field-label">
          <span>Fecha y hora de inicio del evento</span>
          <input value={form.fechaInicio} onChange={(event) => setField("fechaInicio", event.target.value)} type="datetime-local" required />
        </label>
        <label className="field-label">
          <span>Fecha y hora de fin (opcional)</span>
          <input value={form.fechaFin} onChange={(event) => setField("fechaFin", event.target.value)} type="datetime-local" />
        </label>
        <input value={form.precio} onChange={(event) => setField("precio", event.target.value)} placeholder="Precio" inputMode="decimal" />
        <input value={form.telefonoContacto} onChange={(event) => setField("telefonoContacto", event.target.value)} placeholder="Telefono o WhatsApp de contacto" />
        <input value={form.instagram} onChange={(event) => setField("instagram", event.target.value)} placeholder="Instagram del evento o sala" />
        <input value={form.enlaceExterno} onChange={(event) => setField("enlaceExterno", event.target.value)} placeholder="Enlace de entradas, web o informacion" />
        <input value={form.cartelUrl} onChange={(event) => setField("cartelUrl", event.target.value)} placeholder="URL del cartel, web o Instagram" />
        <label className="file-picker">
          Subir cartel desde tu dispositivo
          <input type="file" accept="image/*" onChange={cargarCartelPortalArchivo} />
        </label>
        {(form.cartelData || form.cartelUrl) && (
          <img className="event-poster" src={form.cartelData || form.cartelUrl} alt="Vista previa del cartel" />
        )}
        <textarea value={form.descripcion} onChange={(event) => setField("descripcion", event.target.value)} placeholder="Descripción completa" />
        <div className="chips">
          {estilosEvento.map((estilo) => (
            <button type="button" key={estilo} className={form.estilos.includes(estilo) ? "chip-active" : ""} onClick={() => toggleEstilo(estilo)}>{estilo}</button>
          ))}
        </div>
        <button className="primary">Publicar evento real</button>
      </form>
    </section>
  );
}

function MagicPanel({ events, ciudades, ciudadActiva, onBack }) {
  const [ciudadId, setCiudadId] = useState(ciudadActiva?.ciudadId || ciudades[0]?.id || 1);
  const [estilo, setEstilo] = useState("BACHATA");
  const eventosCiudad = events.filter((event) => Number(event.ciudadId) === Number(ciudadId));
  const elegido = eventosCiudad.find((event) => event.estilos?.includes(estilo)) || eventosCiudad[0] || events[0];
  const ciudad = ciudades.find((item) => Number(item.id) === Number(ciudadId));

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Haz tu magia</h2>
      <p className="muted">BAILEMOS te propone un plan rápido según ciudad y estilo.</p>
      <div className="card stack">
        <select value={ciudadId} onChange={(e) => setCiudadId(e.target.value)}>
          {ciudades.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select>
        <select value={estilo} onChange={(e) => setEstilo(e.target.value)}>
          {estilosDisponibles.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <article className="card feature-card">
        <small>{ciudad?.nombre || "BAILEMOS"}</small>
        <h3>{elegido ? elegido.titulo : "Publica el primer evento de esta ciudad"}</h3>
        <p>{elegido ? `${elegido.lugarNombre || "Lugar pendiente"} - ${elegido.fechaInicio || ""}` : "Cuando haya eventos, aquí aparecerá una recomendación automática."}</p>
      </article>
    </section>
  );
}

function RatingPanel({ session, authHeaders, defaultUserId, onBack }) {
  const [evaluadoId, setEvaluadoId] = useState(defaultUserId || session?.usuarioId || "");
  const [puntuacion, setPuntuacion] = useState(5);
  const [comentario, setComentario] = useState("");
  const [valoraciones, setValoraciones] = useState([]);

  async function cargar() {
    if (!evaluadoId) return;
    try {
      const response = await fetch(`${API_URL}/valoraciones/usuario/${evaluadoId}`, { headers: authHeaders });
      if (!response.ok) throw new Error();
      setValoraciones(await response.json());
    } catch {
      setValoraciones([]);
    }
  }

  useEffect(() => {
    cargar();
  }, [evaluadoId]);

  async function enviar(event) {
    event.preventDefault();
    const response = await fetch(`${API_URL}/valoraciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        evaluadoId: Number(evaluadoId),
        puntuacion: Number(puntuacion),
        comentario
      })
    });

    if (!response.ok) {
      alert("No se pudo guardar la valoración.");
      return;
    }

    setComentario("");
    cargar();
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Valoraciones</h2>
      <form className="card stack" onSubmit={enviar}>
        <input value={evaluadoId} onChange={(e) => setEvaluadoId(e.target.value)} placeholder="ID del bailador/profesional" inputMode="numeric" required />
        <select value={puntuacion} onChange={(e) => setPuntuacion(e.target.value)}>
          <option value="5">5 - Excelente</option>
          <option value="4">4 - Muy bien</option>
          <option value="3">3 - Bien</option>
          <option value="2">2 - Mejorable</option>
          <option value="1">1 - Mala experiencia</option>
        </select>
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Cuenta como fue bailar o trabajar con esta persona" />
        <button className="primary">Guardar valoración</button>
      </form>
      <section className="card">
        <h3>Valoraciones recibidas</h3>
        {valoraciones.length === 0 ? <p className="muted">Aún no hay valoraciones.</p> : valoraciones.map((item) => (
          <div className="list-row" key={item.id}>
            <strong>{item.puntuacion}/5 - {item.autorNombre}</strong>
            <span>{item.comentario || "Sin comentario"}</span>
          </div>
        ))}
      </section>
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
