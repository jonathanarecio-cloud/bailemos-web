import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_URL = "https://bailemos-api.onrender.com";

const ciudadesIniciales = [
  { id: 1, nombre: "Malaga" },
  { id: 2, nombre: "Madrid" },
  { id: 3, nombre: "Barcelona" },
  { id: 4, nombre: "Valencia" },
  { id: 5, nombre: "Sevilla" }
];

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
      cargarInicio();
    }
  }, [session]);

  async function api(path, options = {}) {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Error ${response.status}`);
    }

    return response.json();
  }

  async function cargarInicio() {
    setLoading(true);
    try {
      const [eventosData, ciudadesData] = await Promise.all([
        api("/eventos"),
        api("/ciudades")
      ]);
      setEvents(eventosData || []);
      setEvent(eventosData?.[0] || null);
      setCiudades(ciudadesData?.length ? ciudadesData : ciudadesIniciales);
      try {
        const activa = await api("/usuarios/ciudad-activa/me", { headers: authHeaders });
        setCiudadActiva(activa);
      } catch {
        setCiudadActiva(null);
      }
    } catch (error) {
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
    if (!event) return;
    try {
      await api(`/eventos/${event.id}/voy`, {
        method: "POST",
        headers: authHeaders
      });
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
          session={session}
          loading={loading}
          event={event}
          events={events}
          ciudades={ciudades}
          ciudadActiva={ciudadActiva}
          onVoy={marcarVoy}
          onOpenChat={() => setScreen("event-chat")}
          onOpenBailaCar={() => setScreen("bailacar")}
          onCiudad={marcarCiudad}
        />
      )}

      {screen === "event-chat" && (
        <ChatPanel
          title={event ? `Chat: ${event.titulo}` : "Chat del evento"}
          endpointGet={event ? `/chat/evento/${event.id}` : null}
          endpointPost={event ? `/chat/evento/${event.id}/mensajes` : null}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "city" && (
        <CityPanel
          ciudadActiva={ciudadActiva}
          authHeaders={authHeaders}
          onBack={() => setScreen("home")}
        />
      )}

      {screen === "bailacar" && (
        <BailaCar onBack={() => setScreen("home")} event={event} />
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
        <button className="primary" onClick={onLogin}>Iniciar sesion</button>
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

function Home({ loading, event, events, ciudades, ciudadActiva, onVoy, onOpenChat, onOpenBailaCar, onCiudad }) {
  return (
    <section className="screen">
      <div className="accent" />
      <h2>Donde se baila hoy</h2>
      <input className="search" placeholder="Buscar eventos, ciudades o salas" />

      <div className="quick-grid">
        <button>Mi calendario</button>
        <button>Mi valoracion</button>
      </div>

      <article className="card feature-card">
        <small>{event?.ciudadNombre || "BAILEMOS!"}</small>
        <h3>{loading ? "Cargando eventos..." : event?.titulo || "No hay eventos publicados"}</h3>
        <p>{event ? `${event.lugarNombre || "Lugar pendiente"} · Van ${event.asistentes || 0} personas` : "Cuando haya eventos reales, apareceran aqui."}</p>
        <div className="actions">
          <button className="primary" onClick={onVoy} disabled={!event}>Voy</button>
          <button className="secondary" onClick={onOpenChat} disabled={!event}>Chat</button>
          <button className="secondary" onClick={onOpenBailaCar} disabled={!event}>BailaCar</button>
        </div>
      </article>

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
        <h3>Eventos disponibles</h3>
        <div className="list">
          {events.map((item) => (
            <div key={item.id} className="list-row">
              <strong>{item.titulo}</strong>
              <span>{item.ciudadNombre} · {item.lugarNombre}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function CityPanel({ ciudadActiva, authHeaders, onBack }) {
  const ciudadId = ciudadActiva?.ciudadId;
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    if (!ciudadId) return;
    fetch(`${API_URL}/usuarios/ciudad/${ciudadId}`)
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
          <p>Todavia no hay personas conectadas.</p>
        ) : (
          personas.map((persona) => (
            <div className="list-row" key={persona.usuarioId}>
              <strong>{persona.nombre}</strong>
              <span>{persona.rol}</span>
            </div>
          ))
        )}
      </div>
      <ChatPanel
        embedded
        title={`Chat de ${ciudadActiva?.ciudadNombre || "ciudad"}`}
        endpointGet={ciudadId ? `/chat/ciudad/${ciudadId}` : null}
        endpointPost={ciudadId ? `/chat/ciudad/${ciudadId}/mensajes` : null}
        authHeaders={authHeaders}
      />
    </section>
  );
}

function ChatPanel({ title, endpointGet, endpointPost, authHeaders, onBack, embedded = false }) {
  const [mensajes, setMensajes] = useState([]);
  const [mensaje, setMensaje] = useState("");

  async function cargar() {
    if (!endpointGet) return;
    try {
      const response = await fetch(`${API_URL}${endpointGet}`);
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

    await fetch(`${API_URL}${endpointPost}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ mensaje: mensaje.trim() })
    });
    setMensaje("");
    cargar();
  }

  return (
    <section className={embedded ? "chat-embedded" : "screen"}>
      {!embedded && <button className="back" onClick={onBack}>Volver</button>}
      <h2>{title}</h2>
      <div className="chat-box">
        {mensajes.length === 0 ? (
          <p className="muted">Todavia no hay mensajes.</p>
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
        <input value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Escribe un mensaje" />
        <button className="primary">Enviar</button>
      </form>
    </section>
  );
}

function BailaCar({ onBack, event }) {
  const [tipo, setTipo] = useState("Busco coche");
  const [salida, setSalida] = useState("");
  const [hora, setHora] = useState("");
  const [plazas, setPlazas] = useState("");
  const [comentario, setComentario] = useState("");
  const [publicado, setPublicado] = useState(null);

  function publicar(eventSubmit) {
    eventSubmit.preventDefault();
    setPublicado({ tipo, salida, hora, plazas, comentario });
    setSalida("");
    setHora("");
    setPlazas("");
    setComentario("");
  }

  return (
    <section className="screen">
      <button className="back" onClick={onBack}>Volver</button>
      <h2>BailaCar</h2>
      <p className="muted">Comparte trayecto para {event?.titulo || "el evento"}.</p>
      <form className="card stack" onSubmit={publicar}>
        <div className="segmented">
          <button type="button" className={tipo === "Busco coche" ? "active" : ""} onClick={() => setTipo("Busco coche")}>Busco coche</button>
          <button type="button" className={tipo === "Ofrezco plazas" ? "active" : ""} onClick={() => setTipo("Ofrezco plazas")}>Ofrezco plazas</button>
        </div>
        <input value={salida} onChange={(e) => setSalida(e.target.value)} placeholder="Ciudad o zona de salida" required />
        <input value={hora} onChange={(e) => setHora(e.target.value)} placeholder="Hora aproximada" required />
        <input value={plazas} onChange={(e) => setPlazas(e.target.value)} placeholder="Plazas disponibles" inputMode="numeric" />
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentario, ruta o condiciones" />
        <button className="primary">Publicar en BailaCar</button>
      </form>
      {publicado && (
        <article className="card">
          <h3>{publicado.tipo}</h3>
          <p>Salida: {publicado.salida}</p>
          <p>Hora: {publicado.hora}</p>
          <p>Plazas: {publicado.plazas || "Pendiente"}</p>
          <p>{publicado.comentario || "Sin comentario"}</p>
        </article>
      )}
    </section>
  );
}

createRoot(document.getElementById("root")).render(<App />);
