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

function App() {
  const [session, setSession] = useState(() => {
    const saved = localStorage.getItem("bailemos_session");
    return saved ? JSON.parse(saved) : null;
  });
  const [screen, setScreen] = useState(session ? "home" : "welcome");
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [ciudades, setCiudades] = useState(ciudadesIniciales);
  const [ciudadActiva, setCiudadActiva] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
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
    if (session) cargarInicio();
  }, [session]);

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
    setLoading(true);
    try {
      const [eventosData, ciudadesData] = await Promise.all([api("/eventos"), api("/ciudades")]);
      setEvents(eventosData || []);
      setEvent(eventosData?.[0] || null);
      setCiudades(ciudadesData?.length ? ciudadesData : ciudadesIniciales);

      try {
        const activa = await api("/usuarios/ciudad-activa/me", { headers: authHeaders });
        setCiudadActiva(activa);
      } catch {
        setCiudadActiva(null);
      }
    } catch {
      setNotice("No se pudieron cargar los datos. Prueba de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  function guardarSesion(data) {
    localStorage.setItem("bailemos_session", JSON.stringify(data));
    setSession(data);
    setScreen("home");
  }

  function cerrarSesion() {
    localStorage.removeItem("bailemos_session");
    setSession(null);
    setScreen("welcome");
    setNotice("");
  }

  async function marcarVoy() {
    if (!event) {
      setNotice("Primero publica o selecciona un evento.");
      return;
    }

    try {
      await api(`/eventos/${event.id}/voy`, { method: "POST", headers: authHeaders });
      setNotice("Ya apareces como asistente.");
      cargarInicio();
    } catch {
      setNotice("No se pudo guardar tu asistencia.");
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
    return <Welcome onLogin={() => setScreen("login")} onRegister={() => setScreen("register")} />;
  }

  if (screen === "login") {
    return <Login onBack={() => setScreen("welcome")} onSuccess={guardarSesion} />;
  }

  if (screen === "register") {
    return <Register onBack={() => setScreen("welcome")} onSuccess={guardarSesion} />;
  }

  return (
    <main className="app-shell">
      <Header session={session} onLogout={cerrarSesion} />
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}

      {screen === "home" && (
        <Home
          loading={loading}
          event={event}
          events={events}
          ciudades={ciudades}
          ciudadActiva={ciudadActiva}
          onVoy={marcarVoy}
          onOpenChat={() => setScreen(event ? "event-chat" : "general-chat")}
          onOpenGeneralChat={() => setScreen("general-chat")}
          onOpenPeople={() => setScreen("people")}
          onOpenMessages={() => setScreen("messages")}
          onOpenProfile={() => setScreen("profile")}
          onOpenBailaCar={() => setScreen("bailacar")}
          onOpenPublish={() => setScreen("publish-event")}
          onOpenMagic={() => setScreen("magic")}
          onOpenRating={() => setScreen("rating")}
          onCiudad={marcarCiudad}
          authHeaders={authHeaders}
        />
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

      {screen === "public-profile" && selectedUser && (
        <PublicProfilePanel
          user={selectedUser}
          events={events}
          authHeaders={authHeaders}
          onBack={() => setScreen("people")}
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
            localStorage.setItem("bailemos_session", JSON.stringify(updated));
            setSession(updated);
            setNotice("Perfil actualizado.");
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
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, password, rol })
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

function Header({ session, onLogout }) {
  return (
    <header className="topbar">
      <img className="avatar" src="/bailemos_logo.jpeg" alt="" />
      <div>
        <strong>Hola {session?.nombre || "bailador"}</strong>
        <span>Hoy es un buen dia para bailar.</span>
      </div>
      <button className="ghost" onClick={onLogout}>Salir</button>
    </header>
  );
}

function Home({
  loading,
  event,
  events,
  ciudades,
  ciudadActiva,
  onVoy,
  onOpenChat,
  onOpenGeneralChat,
  onOpenPeople,
  onOpenMessages,
  onOpenProfile,
  onOpenBailaCar,
  onOpenPublish,
  onOpenMagic,
  onOpenRating,
  onCiudad,
  authHeaders
}) {
  return (
    <section className="screen">
      <div className="accent" />
      <h2>Donde se baila hoy</h2>
      <input className="search" placeholder="Buscar eventos, ciudades o salas" />

      <div className="quick-grid">
        <button onClick={onOpenPublish}>Publicar evento</button>
        <button onClick={onOpenMagic}>Haz tu magia</button>
        <button onClick={onOpenPeople}>Gente</button>
        <button onClick={onOpenMessages}>Mensajes</button>
        <button onClick={onOpenProfile}>Mi perfil</button>
        <button onClick={onOpenGeneralChat}>Chat general</button>
        <button onClick={onOpenRating}>Valorar</button>
      </div>

      <article className="card feature-card">
        <small>{event?.ciudadNombre || "BAILEMOS!"}</small>
        <h3>{loading ? "Cargando eventos..." : event?.titulo || "No hay eventos publicados"}</h3>
        <p>{event ? `${event.lugarNombre || "Lugar pendiente"} - Van ${event.asistentes || 0} personas` : "Puedes publicar un evento o entrar al chat general."}</p>
        <div className="actions">
          <button className="primary" onClick={onVoy} disabled={!event}>Voy</button>
          <button className="secondary" onClick={onOpenChat}>{event ? "Chat evento" : "Chat general"}</button>
          <button className="secondary" onClick={onOpenBailaCar}>BailaCar</button>
        </div>
      </article>

      {event && <EventAttendees event={event} authHeaders={authHeaders} />}

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

function EventAttendees({ event, authHeaders }) {
  const [asistentes, setAsistentes] = useState([]);

  useEffect(() => {
    if (!event?.id) return;
    fetch(`${API_URL}/eventos/${event.id}/asistentes`, { headers: authHeaders })
      .then((response) => response.ok ? response.json() : [])
      .then(setAsistentes)
      .catch(() => setAsistentes([]));
  }, [event?.id]);

  return (
    <section className="card">
      <h3>Quién va</h3>
      {asistentes.length === 0 ? (
        <p className="muted">Aún no hay asistentes confirmados.</p>
      ) : (
        asistentes.map((persona) => (
          <div className="list-row" key={persona.usuarioId}>
            <strong>{persona.nombre} {persona.amigoMio && <span className="friend-badge">Amigo</span>}</strong>
            <span>{persona.rol}</span>
          </div>
        ))
      )}
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

function PublicProfilePanel({ user, events, authHeaders, onBack, onMessage }) {
  const [perfil, setPerfil] = useState(null);
  const [social, setSocial] = useState(null);
  const [valoraciones, setValoraciones] = useState([]);
  const [recomendaciones, setRecomendaciones] = useState([]);
  const [comentarioValoracion, setComentarioValoracion] = useState("");
  const [puntuacion, setPuntuacion] = useState(5);
  const [comentarioRecomendacion, setComentarioRecomendacion] = useState("");
  const [eventoRecomendado, setEventoRecomendado] = useState("");

  async function cargarPerfil() {
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
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders }
    });

    if (!response.ok) {
      alert("No se pudo completar la acción.");
      return;
    }

    setSocial(await response.json());
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

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <article className="card public-profile">
        {(perfil?.fotoData || perfil?.fotoUrl) ? <img className="profile-preview" src={perfil.fotoData || perfil.fotoUrl} alt={nombre} /> : <img className="profile-preview" src="/bailemos_logo.jpeg" alt={nombre} />}
        <h2>{nombre}</h2>
        <p className="muted">{perfil?.rol || user.rol}{perfil?.ciudadNombre ? ` - ${perfil.ciudadNombre}` : ""}</p>
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
      </article>

      <div className="quick-grid">
        <button className="primary" onClick={() => onMessage(user)} disabled={bloqueado}>Chatear</button>
        <button onClick={() => accionSocial(`/social/usuario/${user.usuarioId}/me-gusta`, social?.meGustaMio ? "DELETE" : "POST")}>
          {social?.meGustaMio ? "Quitar BAILEMOS!" : "BAILEMOS! me gusta"}
        </button>
        <button onClick={() => accionSocial(`/social/usuario/${user.usuarioId}/amigo`, social?.amigoMio ? "DELETE" : "POST")}>
          {social?.amigoMio ? "Quitar amigo" : "Añadir amigo"}
        </button>
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

function MessagesPanel({ authHeaders, onBack, onOpen }) {
  const [chats, setChats] = useState([]);

  async function cargar() {
    try {
      const response = await fetch(`${API_URL}/chat/privados`, { headers: authHeaders });
      if (!response.ok) throw new Error();
      setChats(await response.json());
    } catch {
      setChats([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>Mis mensajes</h2>
      <p className="muted">Tus conversaciones privadas dentro de BAILEMOS.</p>
      <section className="card">
        {chats.length === 0 ? (
          <p className="muted">Aún no tienes conversaciones. Entra en Gente y escribe a alguien.</p>
        ) : (
          chats.map((chat) => (
            <button className="conversation-row" key={chat.chatId} onClick={() => onOpen(chat)}>
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

  function cargarFotoArchivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      alert("La foto debe ser JPG o PNG.");
      return;
    }

    if (file.size > 700 * 1024) {
      alert("La foto es demasiado grande. Usa una imagen de menos de 700 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setField("fotoData", reader.result);
    reader.readAsDataURL(file);
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
          Subir foto JPG/PNG
          <input type="file" accept="image/jpeg,image/png" onChange={cargarFotoArchivo} />
        </label>
        <input value={form.videoUrl} onChange={(e) => setField("videoUrl", e.target.value)} placeholder="URL de video bailando" />
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

function PublishEvent({ ciudades, authHeaders, onBack, onCreated }) {
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
      cartelUrl: form.cartelUrl || null
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
      <h2>Publicar evento</h2>
      <form className="card stack" onSubmit={submit}>
        <input value={form.titulo} onChange={(e) => setField("titulo", e.target.value)} placeholder="Nombre del evento" required />
        <select value={form.ciudadId} onChange={(e) => setField("ciudadId", e.target.value)}>
          {ciudades.map((ciudad) => <option key={ciudad.id} value={ciudad.id}>{ciudad.nombre}</option>)}
        </select>
        <input value={form.lugarNombre} onChange={(e) => setField("lugarNombre", e.target.value)} placeholder="Sala, disco o academia" />
        <input value={form.direccion} onChange={(e) => setField("direccion", e.target.value)} placeholder="Dirección" />
        <input value={form.fechaInicio} onChange={(e) => setField("fechaInicio", e.target.value)} type="datetime-local" required />
        <input value={form.fechaFin} onChange={(e) => setField("fechaFin", e.target.value)} type="datetime-local" />
        <input value={form.precio} onChange={(e) => setField("precio", e.target.value)} placeholder="Precio" inputMode="decimal" />
        <input value={form.cartelUrl} onChange={(e) => setField("cartelUrl", e.target.value)} placeholder="URL del cartel o Instagram" />
        <textarea value={form.descripcion} onChange={(e) => setField("descripcion", e.target.value)} placeholder="Descripción" />
        <div className="chips">
          {estilosEvento.map((estilo) => (
            <button type="button" key={estilo} className={form.estilos.includes(estilo) ? "chip-active" : ""} onClick={() => toggleEstilo(estilo)}>{estilo}</button>
          ))}
        </div>
        <button className="primary">Publicar evento</button>
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
