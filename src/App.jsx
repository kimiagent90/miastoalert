import { useEffect, useMemo, useState } from 'react'
import { GoogleMap, LoadScript, MarkerF } from '@react-google-maps/api'
import './App.css'

const STORAGE_KEY_TOKEN = 'miastoalert_token'
const STORAGE_KEY_CITY = 'miastoalert_city'
const STORAGE_KEY_ROLE = 'miastoalert_role'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// Stolice województw (w tym województwa z dwiema stolicami).
const CITY_CENTERS = {
  Białystok: { lat: 53.1325, lng: 23.1688 },
  Bydgoszcz: { lat: 53.1235, lng: 18.0084 },
  Gdańsk: { lat: 54.352, lng: 18.6466 },
  'Gorzów Wielkopolski': { lat: 52.7325, lng: 15.2369 },
  Katowice: { lat: 50.2649, lng: 19.0238 },
  Kielce: { lat: 50.8661, lng: 20.6286 },
  Kraków: { lat: 50.0647, lng: 19.945 },
  Lublin: { lat: 51.2465, lng: 22.5684 },
  Łódź: { lat: 51.7592, lng: 19.455 },
  Olsztyn: { lat: 53.7784, lng: 20.4801 },
  Opole: { lat: 50.6751, lng: 17.9213 },
  Poznań: { lat: 52.4064, lng: 16.9252 },
  Rzeszów: { lat: 50.0413, lng: 21.999 },
  Szczecin: { lat: 53.4285, lng: 14.5528 },
  Toruń: { lat: 53.0138, lng: 18.5984 },
  Warszawa: { lat: 52.2297, lng: 21.0122 },
  Wrocław: { lat: 51.1079, lng: 17.0385 },
  'Zielona Góra': { lat: 51.9356, lng: 15.5062 },
}

const DEFAULT_CITY = 'Warszawa'

function getStoredAuth() {
  const token = localStorage.getItem(STORAGE_KEY_TOKEN) || null
  const city = localStorage.getItem(STORAGE_KEY_CITY) || null
  const role = localStorage.getItem(STORAGE_KEY_ROLE) || 'user'
  return { token, city, role }
}

async function apiRequest(path, options = {}) {
  const { token } = getStoredAuth()
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    const message = data?.message || 'Wystąpił błąd.'
    throw new Error(message)
  }

  return data
}

function formatTime(ts) {
  const date = new Date(ts)
  return date.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function App() {
  const [auth, setAuth] = useState(() => getStoredAuth())
  const [citySelection, setCitySelection] = useState(auth.city || DEFAULT_CITY)
  const [isCityModalOpen, setIsCityModalOpen] = useState(!auth.token || !auth.city)
  const [mapCenter, setMapCenter] = useState(
    CITY_CENTERS[auth.city || DEFAULT_CITY] || CITY_CENTERS[DEFAULT_CITY],
  )
  const [activeTab, setActiveTab] = useState('mapa')
  const [filterMinutes, setFilterMinutes] = useState(30)
  const [reports, setReports] = useState([])
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [selectedType, setSelectedType] = useState('policja')
  const [street, setStreet] = useState('')
  const [busNumber, setBusNumber] = useState('')
  const [direction, setDirection] = useState('')
  const [selectedPosition, setSelectedPosition] = useState(null)
  const [loadingReports, setLoadingReports] = useState(false)
  const [submittingReport, setSubmittingReport] = useState(false)
  const [toast, setToast] = useState(null)
  const [adminOverview, setAdminOverview] = useState(null)
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [installPromptEvent, setInstallPromptEvent] = useState(null)

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    let timeout
    if (toast) {
      timeout = setTimeout(() => setToast(null), 3200)
    }
    return () => {
      if (timeout) clearTimeout(timeout)
    }
  }, [toast])

  useEffect(() => {
    if (!auth.city) return
    setMapCenter(CITY_CENTERS[auth.city] || CITY_CENTERS[DEFAULT_CITY])
  }, [auth.city])

  async function handleSelectCity() {
    try {
      const selected = citySelection || DEFAULT_CITY
      const data = await apiRequest('/api/auth/anonymous', {
        method: 'POST',
        body: JSON.stringify({ city: selected }),
      })
      localStorage.setItem(STORAGE_KEY_TOKEN, data.token)
      localStorage.setItem(STORAGE_KEY_CITY, data.user.city)
      localStorage.setItem(STORAGE_KEY_ROLE, data.user.role || 'user')
      const nextAuth = {
        token: data.token,
        city: data.user.city,
        role: data.user.role || 'user',
      }
      setAuth(nextAuth)
      setIsCityModalOpen(false)
      setMapCenter(CITY_CENTERS[data.user.city] || CITY_CENTERS[DEFAULT_CITY])
      setToast('Miasto zapisane. Zgłoszenia będą widoczne tylko z wybranego miasta.')
      await loadReports(nextAuth.city, filterMinutes)
    } catch (e) {
      setToast(e.message)
    }
  }

  async function handleLoginOwner(event) {
    event.preventDefault()
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })
      localStorage.setItem(STORAGE_KEY_TOKEN, data.token)
      localStorage.setItem(STORAGE_KEY_CITY, data.user.city)
      localStorage.setItem(STORAGE_KEY_ROLE, data.user.role || 'user')
      const nextAuth = {
        token: data.token,
        city: data.user.city,
        role: data.user.role || 'user',
      }
      setAuth(nextAuth)
      setAuthModalOpen(false)
      setToast('Zalogowano do panelu administracyjnego.')
      await loadReports(nextAuth.city, filterMinutes)
      if (nextAuth.role === 'owner' || nextAuth.role === 'moderator') {
        setActiveTab('admin')
        await loadAdminOverview()
      }
    } catch (e) {
      setToast(e.message)
    }
  }

  async function loadReports(forCity = auth.city, minutes = filterMinutes) {
    if (!forCity) return
    try {
      setLoadingReports(true)
      const data = await apiRequest(
        `/api/reports?city=${encodeURIComponent(forCity)}&sinceMinutes=${minutes}`,
      )
      setReports(data.reports || [])
    } catch (e) {
      setToast(e.message)
    } finally {
      setLoadingReports(false)
    }
  }

  useEffect(() => {
    if (!auth.city || !auth.token) return
    loadReports(auth.city, filterMinutes)
    const id = setInterval(() => {
      loadReports(auth.city, filterMinutes)
    }, 60_000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.city, auth.token, filterMinutes])

  async function handleSubmitReport(event) {
    event.preventDefault()
    if (!selectedPosition) {
      setToast('Kliknij na mapie, aby wskazać miejsce zgłoszenia.')
      return
    }
    if (!street.trim()) {
      setToast('Ulica / przystanek jest wymagany.')
      return
    }
    try {
      setSubmittingReport(true)
      await apiRequest('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          type: selectedType,
          street: street.trim(),
          busNumber: busNumber.trim() || null,
          direction: direction.trim() || null,
          lat: selectedPosition.lat,
          lng: selectedPosition.lng,
        }),
      })
      setStreet('')
      setBusNumber('')
      setDirection('')
      setToast('Zgłoszenie zostało dodane.')
      await loadReports()
    } catch (e) {
      setToast(e.message)
    } finally {
      setSubmittingReport(false)
    }
  }

  async function handleConfirmReport(id) {
    try {
      await apiRequest(`/api/reports/${id}/confirm`, { method: 'POST' })
      setToast('Potwierdzono zgłoszenie.')
      await loadReports()
    } catch (e) {
      setToast(e.message)
    }
  }

  async function loadAdminOverview() {
    try {
      setLoadingAdmin(true)
      const data = await apiRequest('/api/admin/overview')
      setAdminOverview(data)
    } catch (e) {
      setToast(e.message)
    } finally {
      setLoadingAdmin(false)
    }
  }

  async function handleAdminAction(path, method, successMessage, body) {
    try {
      await apiRequest(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      })
      setToast(successMessage)
      await Promise.all([loadAdminOverview(), loadReports()])
    } catch (e) {
      setToast(e.message)
    }
  }

  const isAdmin = auth.role === 'owner' || auth.role === 'moderator'

  const mapCenterMemo = useMemo(
    () => mapCenter || CITY_CENTERS[DEFAULT_CITY],
    [mapCenter],
  )

  const markers = reports.map((r) => ({
    id: r.id,
    position: { lat: Number(r.lat), lng: Number(r.lng) },
    type: r.type,
    street: r.street,
    busNumber: r.bus_number,
    direction: r.direction,
    createdAt: r.created_at,
    confirmations: Number(r.confirmations_count || 0),
  }))

  function emojiForType(type) {
    if (type === 'kontrola') return '🎫'
    return '🚓'
  }

  const selectedReport = useMemo(() => {
    if (!selectedReportId) return null
    return reports.find((r) => r.id === selectedReportId) || null
  }, [reports, selectedReportId])

  async function handleInstallClick() {
    if (installPromptEvent) {
      installPromptEvent.prompt()
      setInstallPromptEvent(null)
    } else {
      setToast(
        'Aby dodać do ekranu głównego na iOS, użyj przycisku Udostępnij w Safari i wybierz „Dodaj do ekranu początkowego”.',
      )
    }
  }

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="app-header">
          <div className="app-header-left">
            <div>
              <div className="app-title">MiastoAlert</div>
              <div className="glass-subtitle">
                Mapa zgłoszeń • {auth.city || 'wybierz miasto'}
              </div>
            </div>
            <span className="app-badge">Na żywo 24/7</span>
          </div>
          <div className="app-header-right">
            <div className="pill">
              <span className="pill-dot" />
              <span className="pill-label">Tryb</span>
              <span className="pill-value">Miasto</span>
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className="map-container">
            {GOOGLE_MAPS_KEY ? (
              <LoadScript googleMapsApiKey={GOOGLE_MAPS_KEY}>
                <GoogleMap
                  mapContainerStyle={{ width: '100%', height: '100%' }}
                  center={mapCenterMemo}
                  zoom={13}
                  options={{
                    disableDefaultUI: true,
                    clickableIcons: false,
                    styles: [
                      {
                        elementType: 'geometry',
                        stylers: [{ color: '#020617' }],
                      },
                      {
                        elementType: 'labels.text.fill',
                        stylers: [{ color: '#e5e7eb' }],
                      },
                      {
                        elementType: 'labels.text.stroke',
                        stylers: [{ color: '#020617' }],
                      },
                      {
                        featureType: 'road',
                        elementType: 'geometry',
                        stylers: [{ color: '#111827' }],
                      },
                      {
                        featureType: 'water',
                        elementType: 'geometry',
                        stylers: [{ color: '#0b1120' }],
                      },
                    ],
                  }}
                  onClick={(e) => {
                    if (!e.latLng) return
                    setSelectedPosition({
                      lat: e.latLng.lat(),
                      lng: e.latLng.lng(),
                    })
                  }}
                >
                  {markers.map((m) => (
                    <MarkerF
                      key={m.id}
                      position={m.position}
                      label={{
                        text: emojiForType(m.type),
                        fontSize: '22px',
                      }}
                      animation={window.google?.maps?.Animation?.DROP}
                      onClick={() => {
                        setSelectedReportId(m.id)
                      }}
                    />
                  ))}
                  {selectedPosition && (
                    <MarkerF
                      position={selectedPosition}
                      label={{
                        text: '📍',
                        fontSize: '20px',
                      }}
                    />
                  )}
                </GoogleMap>
              </LoadScript>
            ) : (
              <div className="map-overlay-top">
                <div className="glass-card">
                  <div className="glass-title">
                    Brak klucza Google Maps (VITE_GOOGLE_MAPS_API_KEY)
                  </div>
                  <p className="glass-subtitle">
                    Skonfiguruj zmienną środowiskową, aby wyświetlić mapę.
                  </p>
                </div>
              </div>
            )}

            <div className="map-overlay-top">
              <div className="map-chips">
                <button
                  type="button"
                  className={`chip-button ${filterMinutes === 30 ? 'active' : ''}`}
                  onClick={() => setFilterMinutes(30)}
                >
                  <span>⏱</span> 30 min
                </button>
                <button
                  type="button"
                  className={`chip-button ${filterMinutes === 60 ? 'active' : ''}`}
                  onClick={() => setFilterMinutes(60)}
                >
                  <span>🕒</span> 60 min
                </button>
              </div>
            </div>

            {activeTab === 'mapa' && (
              <div className="map-overlay-bottom">
                <div className="glass-card">
                  <div className="glass-header">
                    <div>
                      <div className="glass-title">Dodaj zgłoszenie</div>
                      <div className="glass-subtitle">
                        Wybierz miejsce na mapie i uzupełnij szczegóły. Aby zobaczyć opis,
                        stuknij w marker.
                      </div>
                    </div>
                    <span className="badge-soft">
                      {auth.city || 'Brak miasta'}
                    </span>
                  </div>
                  <form onSubmit={handleSubmitReport}>
                    <div className="form-grid">
                      <div className="form-column">
                        <div className="field">
                          <span className="field-label">Typ zgłoszenia</span>
                          <div className="pill-row">
                            <button
                              type="button"
                              className={`pill-toggle ${
                                selectedType === 'policja' ? 'active' : ''
                              }`}
                              onClick={() => setSelectedType('policja')}
                            >
                              <span>🚓</span> Policja
                            </button>
                            <button
                              type="button"
                              className={`pill-toggle ${
                                selectedType === 'kontrola' ? 'active' : ''
                              }`}
                              onClick={() => setSelectedType('kontrola')}
                            >
                              <span>🎫</span> Kontrola
                            </button>
                          </div>
                        </div>
                        <div className="field">
                          <span className="field-label">Ulica / przystanek</span>
                          <input
                            className="field-input"
                            placeholder="np. Aleje Jerozolimskie 17 / Metro Centrum"
                            value={street}
                            onChange={(e) => setStreet(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="form-column">
                        <div className="field">
                          <span className="field-label">Numer autobusu (opcjonalnie)</span>
                          <input
                            className="field-input"
                            placeholder="np. 180"
                            value={busNumber}
                            onChange={(e) => setBusNumber(e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <span className="field-label">Kierunek (opcjonalnie)</span>
                          <input
                            className="field-input"
                            placeholder="np. w stronę Centrum"
                            value={direction}
                            onChange={(e) => setDirection(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="form-grid" style={{ marginTop: '0.6rem' }}>
                      <div className="form-column">
                        <span className="inline-text">
                          Zgłoszenia znikają automatycznie po 60 minutach. Filtr
                          pokazuje domyślnie ostatnie {filterMinutes} min.
                        </span>
                      </div>
                      <div
                        className="form-column"
                        style={{ alignItems: 'flex-end', justifyContent: 'flex-end' }}
                      >
                        <button
                          type="submit"
                          className="primary-button"
                          disabled={submittingReport || !auth.token || !auth.city}
                        >
                          <span>{selectedType === 'policja' ? '🚓' : '🎫'}</span>
                          <span>Dodaj zgłoszenie</span>
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {activeTab === 'mapa' && (
              <div className="map-overlay-bottom" style={{ bottom: '11.4rem' }}>
                <div className="glass-card" style={{ padding: '0.85rem 1rem 0.95rem' }}>
                  <div className="glass-header" style={{ marginBottom: '0.45rem' }}>
                    <div>
                      <div className="glass-title">Szczegóły zgłoszenia</div>
                      <div className="glass-subtitle">
                        {selectedReport
                          ? 'Stuknij 👍 aby potwierdzić (raz na użytkownika).'
                          : 'Stuknij w marker na mapie, aby zobaczyć opis.'}
                      </div>
                    </div>
                    <span className="badge-soft">
                      {loadingReports ? 'Ładowanie…' : `Zgłoszenia: ${reports.length}`}
                    </span>
                  </div>

                  {selectedReport ? (
                    <div className="report-item">
                      <div className="report-main">
                        <div className="report-emoji">
                          {emojiForType(selectedReport.type)}
                        </div>
                        <div className="report-text">
                          <div className="report-line-strong">
                            {selectedReport.street}
                          </div>
                          <div className="report-line-muted">
                            Typ zgłoszenia:{' '}
                            {selectedReport.type === 'kontrola'
                              ? 'Kontrola biletów'
                              : 'Policja'}
                          </div>
                          <div className="report-line-muted">
                            {selectedReport.bus_number
                              ? `Numer autobusu: ${selectedReport.bus_number}`
                              : 'Numer autobusu: brak'}
                          </div>
                          <div className="report-line-muted">
                            {selectedReport.direction
                              ? `Kierunek: ${selectedReport.direction}`
                              : 'Kierunek: brak'}
                          </div>
                        </div>
                      </div>
                      <div className="report-meta">
                        <span className="meta-chip">
                          ⏱ {formatTime(selectedReport.created_at)}
                        </span>
                        <button
                          type="button"
                          className="confirm-button"
                          onClick={() => handleConfirmReport(selectedReport.id)}
                        >
                          <span>👍</span> {selectedReport.confirmations_count || 0}
                        </button>
                        <button
                          type="button"
                          className="admin-small-button"
                          onClick={() => setSelectedReportId(null)}
                        >
                          Zamknij
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="inline-text">
                      {reports.length === 0
                        ? 'Brak zgłoszeń w wybranym przedziale czasu.'
                        : 'Wybierz marker na mapie, aby zobaczyć szczegóły.'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'admin' && isAdmin && (
              <section className="admin-panel">
                <div className="admin-header">
                  <div>
                    <div className="admin-title">Panel administracyjny</div>
                    <div className="glass-subtitle">
                      {auth.role === 'owner' ? 'Właściciel' : 'Moderator'} • {auth.city}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="admin-small-button"
                    onClick={loadAdminOverview}
                  >
                    Odśwież
                  </button>
                </div>
                <div className="admin-sections">
                  <div className="admin-card">
                    <div className="admin-card-title">Użytkownicy</div>
                    <div className="admin-list">
                      {loadingAdmin && (
                        <div className="inline-text">Ładowanie użytkowników…</div>
                      )}
                      {!loadingAdmin &&
                        adminOverview?.users?.map((u) => (
                          <div key={u.id} className="admin-row">
                            <div className="admin-row-main">
                              <span>
                                {u.id.slice(0, 8)} • {u.city}
                              </span>
                              <span className="glass-subtitle">
                                Rola: {u.role} • Ocena: {u.rating}{' '}
                                {u.banned ? '• Zbanowany' : ''}
                              </span>
                            </div>
                            <div className="admin-row-actions">
                              {auth.role === 'owner' && (
                                <>
                                  <button
                                    type="button"
                                    className="admin-small-button"
                                    onClick={() =>
                                      handleAdminAction(
                                        `/api/admin/users/${u.id}/role`,
                                        'POST',
                                        'Zmieniono rolę użytkownika.',
                                        {
                                          role: u.role === 'moderator' ? 'user' : 'moderator',
                                        },
                                      )
                                    }
                                  >
                                    Rola: {u.role === 'moderator' ? 'Użytkownik' : 'Moderator'}
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-small-button"
                                    onClick={() =>
                                      handleAdminAction(
                                        `/api/admin/users/${u.id}/reset-city`,
                                        'POST',
                                        'Miasto użytkownika zostało zresetowane.',
                                      )
                                    }
                                  >
                                    Reset miasta
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="admin-small-button danger"
                                onClick={() =>
                                  handleAdminAction(
                                    `/api/admin/users/${u.id}/ban`,
                                    'POST',
                                    u.banned
                                      ? 'Użytkownik został odblokowany.'
                                      : 'Użytkownik został zablokowany.',
                                    { banned: !u.banned },
                                  )
                                }
                              >
                                {u.banned ? 'Odblokuj' : 'Zablokuj'}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                  <div className="admin-card">
                    <div className="admin-card-title">Zgłoszenia</div>
                    <div className="admin-list">
                      {loadingAdmin && (
                        <div className="inline-text">Ładowanie zgłoszeń…</div>
                      )}
                      {!loadingAdmin &&
                        adminOverview?.reports?.map((r) => (
                          <div key={r.id} className="admin-row">
                            <div className="admin-row-main">
                              <span>
                                {emojiForType(r.type)} {r.street}
                              </span>
                              <span className="glass-subtitle">
                                {r.city} • {formatTime(r.created_at)}
                              </span>
                            </div>
                            <div className="admin-row-actions">
                              <button
                                type="button"
                                className="admin-small-button danger"
                                onClick={() =>
                                  handleAdminAction(
                                    `/api/admin/reports/${r.id}`,
                                    'DELETE',
                                    'Zgłoszenie zostało usunięte.',
                                  )
                                }
                              >
                                Usuń zgłoszenie
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <nav className="bottom-nav">
            <div className="bottom-nav-inner">
              <button
                type="button"
                className={`nav-button ${activeTab === 'mapa' ? 'active' : ''}`}
                onClick={() => setActiveTab('mapa')}
              >
                <span>🗺</span>
                <div>Mapa</div>
              </button>
              <button
                type="button"
                className="nav-button"
                onClick={handleInstallClick}
              >
                <span>⬇️</span>
                <div>Instaluj</div>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className={`nav-button ${activeTab === 'admin' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('admin')
                    if (!adminOverview) {
                      loadAdminOverview()
                    }
                  }}
                >
                  <span>🛡</span>
                  <div>Panel</div>
                </button>
              )}
            </div>
          </nav>
        </main>

        {toast && <div className="toast">{toast}</div>}

        {isCityModalOpen && (
          <div className="city-modal-backdrop">
            <div className="city-modal">
              <div className="city-modal-title">Wybierz miasto</div>
              <div className="city-modal-subtitle">
                Zgłoszenia na mapie będą filtrowane tylko dla wybranego miasta. Nie
                możesz zmienić miasta samodzielnie – w razie potrzeby zrobi to moderator.
              </div>
              <div className="city-list">
                {Object.keys(CITY_CENTERS).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`city-chip ${citySelection === c ? 'selected' : ''}`}
                    onClick={() => setCitySelection(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="city-modal-footer">
                <div className="city-hint">
                  Twoje miasto zostanie zapisane na tym urządzeniu.
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleSelectCity}
                >
                  <span>✅</span>
                  <span>Ustaw miasto</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {auth.role !== 'owner' && auth.role !== 'moderator' && (
          <div
            style={{
              position: 'fixed',
              right: '0.8rem',
              top: '3.2rem',
              zIndex: 25,
            }}
          >
            <button
              type="button"
              className="admin-small-button"
              onClick={() => setAuthModalOpen(true)}
            >
              Zaloguj do panelu
            </button>
          </div>
        )}

        {authModalOpen && (
          <div className="auth-modal">
            <div className="auth-modal-inner">
              <div className="auth-modal-title">Logowanie właściciela</div>
              <p className="glass-subtitle">
                Użyj danych OWNER_EMAIL i OWNER_PASSWORD skonfigurowanych w środowisku
                backendu.
              </p>
              <form onSubmit={handleLoginOwner}>
                <div className="field">
                  <span className="field-label">Email</span>
                  <input
                    className="field-input"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="właściciel@miastoalert.pl"
                  />
                </div>
                <div className="field" style={{ marginTop: '0.45rem' }}>
                  <span className="field-label">Hasło</span>
                  <input
                    className="field-input"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="hasło właściciela"
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '0.7rem',
                    gap: '0.6rem',
                  }}
                >
                  <button
                    type="button"
                    className="admin-small-button"
                    onClick={() => setAuthModalOpen(false)}
                  >
                    Zamknij
                  </button>
                  <button type="submit" className="primary-button">
                    <span>🛡</span>
                    <span>Zaloguj</span>
                  </button>
                </div>
              </form>
              <p className="install-tip">
                Dane logowania ustawiasz w zmiennych środowiskowych backendu:{' '}
                OWNER_EMAIL i OWNER_PASSWORD.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
